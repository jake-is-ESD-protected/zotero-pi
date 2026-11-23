// SPDX-License-Identifier: GPL-3.0-only
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const HELPERS = ["index", "api", "autocomplete", "config", "digest", "library", "storage", "workflow"];
const ROOT_FILES = ["package.json", "README.md", "LICENSE", "CHANGELOG.md", "CONTRIBUTING.md", "zotero-pi.example.json"];
export function validateContents(pkg, entries) {
	if (pkg.license !== "GPL-3.0-only") throw new Error("Package license must match the retained GPLv3 license.");
	if (pkg.pi?.extensions?.length !== 1 || pkg.pi.extensions[0] !== "./extensions/zotero/index.ts") throw new Error("Unexpected pi extension manifest.");
	const paths = entries.map(entry => entry.path);
	if (new Set(paths).size !== paths.length) throw new Error("Duplicate package paths.");
	for (const path of paths) {
		if (!(ROOT_FILES.includes(path) || /^docs\/[A-Za-z0-9_./-]+\.md$/.test(path) || /^extensions\/zotero\/[a-z-]+\.ts$/.test(path)) || path.split("/").includes("..")) throw new Error(`Unexpected/private package file: ${path}`);
	}
	for (const required of [...ROOT_FILES, ...HELPERS.map(name => `extensions/zotero/${name}.ts`)]) if (!paths.includes(required)) throw new Error(`Package is missing ${required}`);
	return paths;
}
function pack(root, destination) {
	const args = ["pack", "--ignore-scripts", "--json", ...(destination ? ["--pack-destination", destination] : ["--dry-run"])];
	const [result] = JSON.parse(execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120000 }));
	if (!result?.files || !result.filename) throw new Error("npm pack returned invalid metadata.");
	return result;
}
export async function checkPackage(root = ROOT) {
	const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
	const packed = pack(root);
	validateContents(pkg, packed.files);
	return packed;
}
export async function testPackage(root = ROOT) {
	const temporary = await mkdtemp(join(tmpdir(), "zotero-package-"));
	try {
		const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
		const packed = pack(root, temporary);
		validateContents(pkg, packed.files);
		execFileSync("tar", ["-xzf", join(temporary, packed.filename), "-C", temporary], { stdio: ["ignore", "pipe", "pipe"] });
		execFileSync(process.execPath, [join(root, "scripts", "smoke-pi.mjs")], {
			cwd: temporary, env: { ...process.env, PI_EXTENSION_ROOT: join(temporary, "package") }, stdio: "inherit", timeout: 120000,
		});
		return packed;
	} finally { await rm(temporary, { recursive: true, force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const command = process.argv[2] ?? "check";
	const work = command === "check" ? checkPackage() : command === "test" ? testPackage() : Promise.reject(new Error("Usage: package.mjs [check|test]"));
	work.then(result => console.log(`${command === "check" ? "Checked" : "Tested installed contents of"} ${result.filename}: ${result.files.length} distributable files.`)).catch(error => { console.error(error.stderr?.toString() || error.stack || error.message); process.exitCode = 1; });
}
