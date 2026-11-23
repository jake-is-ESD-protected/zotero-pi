// SPDX-License-Identifier: GPL-3.0-only
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export function parseVersion(version) {
	const match = typeof version === "string" && version.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/);
	if (!match || match[4]?.split(".").some(part => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0"))) throw new Error(`Invalid release version: ${version}. Use MAJOR.MINOR.PATCH, optionally -rc.1; no leading zeros or build metadata.`);
	return { version, tag: `v${version}`, prerelease: Boolean(match[4]) };
}
export function releaseNotes(changelog, version) {
	parseVersion(version);
	const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const heading = new RegExp(`^## \\[${escaped}\\](?:[^\\n]*)$`, "m").exec(changelog);
	if (!heading) throw new Error(`CHANGELOG.md needs a ## [${version}] section.`);
	const tail = changelog.slice(heading.index + heading[0].length);
	const next = tail.search(/^## /m);
	const notes = (next < 0 ? tail : tail.slice(0, next)).trim();
	if (!notes) throw new Error(`CHANGELOG.md section ${version} must not be empty.`);
	return notes;
}
export async function metadata(root = ROOT, tag) {
	const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
	const release = parseVersion(pkg.version);
	if (tag !== undefined && tag !== release.tag) throw new Error(`Tag ${tag} must match package.json: ${release.tag}.`);
	return { ...release, notes: releaseNotes(await readFile(join(root, "CHANGELOG.md"), "utf8"), release.version) };
}
function git(root, args) {
	return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60000 }).trim();
}
function refExists(root, ref) {
	try { git(root, ["show-ref", "--verify", "--quiet", ref]); return true; }
	catch (error) { if (error.status === 1) return false; throw error; }
}
export async function verifyTag(root = ROOT, tag) {
	if (!tag) throw new Error("Pass the pushed tag to verify-tag.");
	const release = await metadata(root, tag);
	if (git(root, ["cat-file", "-t", `refs/tags/${tag}`]) !== "tag") throw new Error("Release tags must be annotated, not lightweight.");
	if (git(root, ["rev-parse", `${tag}^{commit}`]) !== git(root, ["rev-parse", "HEAD"])) throw new Error("Release checkout must be exactly the tagged commit.");
	try { git(root, ["merge-base", "--is-ancestor", "HEAD", "refs/remotes/origin/main"]); }
	catch { throw new Error("Release commit must be reachable from origin/main. Merge the release PR first."); }
	return release;
}
export async function createTag(root = ROOT, { push = false, dryRun = false } = {}) {
	const release = await metadata(root);
	if (git(root, ["status", "--porcelain"])) throw new Error("Working tree must be clean before tagging.");
	if (git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]) !== "main") throw new Error("Create releases from main after merging the release PR.");
	git(root, ["fetch", "origin", "main", "--tags"]);
	if (git(root, ["rev-parse", "HEAD"]) !== git(root, ["rev-parse", "refs/remotes/origin/main"])) throw new Error("main must match origin/main. Run git pull --ff-only and retry.");
	if (refExists(root, `refs/tags/${release.tag}`)) throw new Error(`Tag ${release.tag} already exists. Never move release tags; prepare a new version.`);
	if (dryRun) return { ...release, created: false, pushed: false };
	git(root, ["tag", "--annotate", release.tag, "--message", `zotero-pi ${release.version}`]);
	if (push) {
		try { git(root, ["push", "origin", `refs/tags/${release.tag}`]); }
		catch (error) { throw new Error(`Created local ${release.tag}, but push failed. Retry explicitly: git push origin refs/tags/${release.tag}. ${error.stderr?.toString().trim() ?? error.message}`); }
	}
	return { ...release, created: true, pushed: push };
}
async function main() {
	const [command = "check", ...args] = process.argv.slice(2);
	if (command === "check") {
		if (args.length > 1) throw new Error("Usage: release.mjs check [vVERSION]");
		console.log(`Release metadata valid: ${(await metadata(ROOT, args[0])).tag}`);
	} else if (command === "notes") {
		if (args.length !== 1) throw new Error("Usage: release.mjs notes vVERSION");
		console.log((await metadata(ROOT, args[0])).notes);
	} else if (command === "verify-tag") {
		if (args.length !== 1) throw new Error("Usage: release.mjs verify-tag vVERSION");
		console.log(`Verified annotated main-line release: ${(await verifyTag(ROOT, args[0])).tag}`);
	} else if (command === "tag") {
		if (args.some(a => !["--push", "--dry-run"].includes(a))) throw new Error("Usage: release.mjs tag [--push] [--dry-run]");
		const release = await createTag(ROOT, { push: args.includes("--push"), dryRun: args.includes("--dry-run") });
		console.log(`${release.created ? "Created" : "Would create"} annotated ${release.tag}${release.pushed ? " and pushed it" : ""}.`);
		if (release.created && !release.pushed) console.log(`Push when ready: git push origin refs/tags/${release.tag}`);
	} else throw new Error(`Unknown release command: ${command}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
	console.error(`Release refused: ${error.message}`); process.exitCode = 1;
});
