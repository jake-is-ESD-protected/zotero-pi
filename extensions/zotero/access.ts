import { readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, dirname, basename, isAbsolute, sep } from "node:path";

const DEFAULTS = { allowRead: [".", "~/.config", "~/.local", "Library"], allowWrite: [".", "/tmp"], denyWrite: [".env", ".env.*", "*.pem", "*.key"] };
async function json(path) {
	try { return JSON.parse(await readFile(path, "utf8")); }
	catch (e) { if (e.code === "ENOENT") return {}; throw new Error(`zotero-pi: Cannot read sandbox policy ${path}: ${e.message}`); }
}
function starMatch(value, pattern) {
	const regex = pattern.split("*").map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
	return new RegExp(`^${regex}$`).test(value);
}
async function canonical(path) {
	try { return await realpath(path); }
	catch (e) {
		if (e.code !== "ENOENT" && e.code !== "ENOTDIR") throw e;
		const parent = dirname(path);
		if (parent === path) return path;
		return join(await canonical(parent), basename(path));
	}
}
export class SandboxAccess {
	constructor({ cwd, enabled = true, global = {}, project = {} }) {
		this.cwd = cwd;
		this.enabled = enabled && (project.enabled ?? global.enabled ?? true);
		const combine = (section, key, defaults = []) => {
			const arrays = [global[section]?.[key], project[section]?.[key]].filter(v => v !== undefined);
			if (arrays.some(a => !Array.isArray(a) || a.some(v => typeof v !== "string"))) throw new Error(`zotero-pi: Invalid sandbox ${section}.${key} policy.`);
			return arrays.length ? arrays.flat() : defaults;
		};
		this.allowRead = combine("filesystem", "allowRead", DEFAULTS.allowRead);
		this.allowWrite = combine("filesystem", "allowWrite", DEFAULTS.allowWrite);
		this.denyWrite = combine("filesystem", "denyWrite", DEFAULTS.denyWrite);
		this.allowedDomains = combine("network", "allowedDomains");
		this.deniedDomains = combine("network", "deniedDomains");
		this.networkDisabled = project.network?.disabled ?? global.network?.disabled ?? false;
		this.filesystemDisabled = project.filesystem?.disabled ?? global.filesystem?.disabled ?? false;
	}
	static async load({ cwd, active, projectTrusted, noSandbox = false }) {
		if (!active || noSandbox) return new SandboxAccess({ cwd, enabled: false });
		const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
		const global = await json(join(agentDir, "sandbox.json"));
		const project = projectTrusted ? await json(join(cwd, ".pi", "sandbox.json")) : {};
		return new SandboxAccess({ cwd, global, project });
	}
	async matches(path, patterns) {
		const target = await canonical(resolve(path));
		for (const rule of patterns) {
			const expanded = rule === "~" ? homedir() : rule.startsWith("~/") ? join(homedir(), rule.slice(2)) : rule;
			const pattern = await canonical(isAbsolute(expanded) ? expanded : resolve(this.cwd, expanded));
			// Match pi-sandbox's saved-policy semantics: * spans separators;
			// non-glob rules cover their entire subtree. Other syntax is literal.
			if (rule.includes("*") ? starMatch(target, pattern) : target === pattern || target.startsWith(pattern.endsWith(sep) ? pattern : pattern + sep)) return true;
		}
		return false;
	}
	async read(path) {
		if (!this.enabled || this.filesystemDisabled) return;
		if (!await this.matches(path, [...this.allowRead, ...this.allowWrite])) this.blocked("read", path);
	}
	async write(path) {
		if (!this.enabled || this.filesystemDisabled) return;
		if (await this.matches(path, this.denyWrite) || this.denyWrite.some(rule => !rule.includes(sep) && rule !== "." && starMatch(basename(path), rule))) throw new Error(`zotero-pi: Sandbox denies writing ${path} (denyWrite). No permission was changed.`);
		if (!await this.matches(path, this.allowWrite)) this.blocked("write", path);
	}
	domain(host) {
		if (!this.enabled || this.networkDisabled) return;
		host = host.toLowerCase().replace(/\.+$/, "");
		const matches = rules => rules.some(rule => rule === "*" || host === rule || (rule.startsWith("*.") && (host === rule.slice(2) || host.endsWith(rule.slice(1)))));
		if (matches(this.deniedDomains)) throw new Error(`zotero-pi: Sandbox denies network access to ${host} (deniedDomains).`);
		if (!matches(this.allowedDomains)) this.blocked("domain", host);
	}
	blocked(kind, target) {
		throw new Error(`zotero-pi: Sandbox approval required. Run /sandbox-allow ${kind} ${target} and save permission for this project or all projects, then retry. For digest writes, approve the configured cache directory and its nested contents. PDFs need read access only. This extension cannot inspect pi-sandbox's private session-only grants and will not bypass them.`);
	}
}
