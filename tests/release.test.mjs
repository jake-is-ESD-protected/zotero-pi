import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseVersion, releaseNotes, metadata, createTag, verifyTag } from "../scripts/release.mjs";

function git(root, ...args) { return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
async function fixture(t) {
	const dir = await mkdtemp(join(tmpdir(), "zotero-release-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	const root = join(dir, "work"), remote = join(dir, "origin.git");
	await mkdir(root); git(dir, "init", "--bare", remote); git(root, "init", "-b", "main");
	git(root, "config", "user.name", "Release fixture"); git(root, "config", "user.email", "fixture@example.invalid");
	git(root, "config", "commit.gpgsign", "false"); git(root, "config", "tag.gpgsign", "false");
	await writeFile(join(root, "package.json"), JSON.stringify({ version: "1.2.3" }));
	await writeFile(join(root, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\n\n## [1.2.3]\n\n- Tested change.\n");
	git(root, "add", "."); git(root, "commit", "-m", "Fixture"); git(root, "remote", "add", "origin", remote); git(root, "push", "-u", "origin", "main");
	return { root, remote };
}
test("SemVer release tags support stable and prerelease versions", () => {
	assert.deepEqual(parseVersion("0.3.1"), { version: "0.3.1", tag: "v0.3.1", prerelease: false });
	assert.equal(parseVersion("1.0.0-rc.1").prerelease, true);
});
test("invalid or ambiguous release versions are refused", () => {
	for (const value of [undefined, "v1.2.3", "01.2.3", "1.2", "1.2.3-01", "1.2.3+local", "1.2.3;echo unsafe", "1.2.3-"]) assert.throws(() => parseVersion(value), /Invalid release version/);
});
test("release notes isolate the exact version", () => {
	const notes = releaseNotes("## [Unreleased]\nLater\n## [1.2.3] - prepared\n\n- This release.\n\n## [1.2.2]\nOld\n", "1.2.3");
	assert.equal(notes, "- This release.");
	assert.throws(() => releaseNotes("## [1.2.3]\n\n## [1.2.2]\nOld", "1.2.3"), /must not be empty/);
	assert.throws(() => releaseNotes("# Nothing", "1.2.3"), /needs a/);
});
test("tag must equal package version", async t => {
	const f = await fixture(t);
	assert.equal((await metadata(f.root, "v1.2.3")).version, "1.2.3");
	await assert.rejects(metadata(f.root, "v1.2.4"), /must match package.json/);
});
test("dry run creates no tag", async t => {
	const f = await fixture(t); const result = await createTag(f.root, { dryRun: true });
	assert.equal(result.created, false); assert.equal(git(f.root, "tag", "--list"), "");
});
test("creates an annotated tag and verifies main ancestry", async t => {
	const f = await fixture(t); const result = await createTag(f.root);
	assert.equal(result.created, true); assert.equal(result.pushed, false);
	assert.equal(git(f.root, "cat-file", "-t", "v1.2.3"), "tag");
	assert.equal((await verifyTag(f.root, "v1.2.3")).tag, "v1.2.3");
});
test("push mode sends only the release tag to the fixture remote", async t => {
	const f = await fixture(t); await createTag(f.root, { push: true });
	assert.match(git(f.root, "ls-remote", "origin", "refs/tags/v1.2.3"), /refs\/tags\/v1.2.3/);
});
test("existing tags cannot be moved or recreated", async t => {
	const f = await fixture(t); await createTag(f.root);
	const before = git(f.root, "rev-parse", "v1.2.3");
	await assert.rejects(createTag(f.root), /already exists/); assert.equal(git(f.root, "rev-parse", "v1.2.3"), before);
});
test("uncommitted work prevents tagging", async t => {
	const f = await fixture(t); await writeFile(join(f.root, "uncommitted.txt"), "work");
	await assert.rejects(createTag(f.root), /must be clean/);
});
test("feature branches cannot create release tags", async t => {
	const f = await fixture(t); git(f.root, "switch", "-c", "feature");
	await assert.rejects(createTag(f.root), /from main/);
});
test("unpublished local commits cannot be tagged", async t => {
	const f = await fixture(t); await writeFile(join(f.root, "new.txt"), "new"); git(f.root, "add", "."); git(f.root, "commit", "-m", "Not pushed");
	await assert.rejects(createTag(f.root), /must match origin\/main/);
});
test("release verification rejects lightweight tags", async t => {
	const f = await fixture(t); git(f.root, "tag", "v1.2.3");
	await assert.rejects(verifyTag(f.root, "v1.2.3"), /must be annotated/);
});
test("release verification rejects a non-tag checkout", async t => {
	const f = await fixture(t); await createTag(f.root);
	await writeFile(join(f.root, "new.txt"), "new"); git(f.root, "add", "."); git(f.root, "commit", "-m", "After tag");
	await assert.rejects(verifyTag(f.root, "v1.2.3"), /exactly the tagged commit/);
});
test("release verification rejects tags on unmerged commits", async t => {
	const f = await fixture(t); git(f.root, "switch", "-c", "unmerged");
	await writeFile(join(f.root, "new.txt"), "new"); git(f.root, "add", "."); git(f.root, "commit", "-m", "Unmerged"); git(f.root, "tag", "-a", "v1.2.3", "-m", "Unsafe tag");
	await assert.rejects(verifyTag(f.root, "v1.2.3"), /reachable from origin\/main/);
});
