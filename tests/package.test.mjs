import { test } from "node:test";
import assert from "node:assert/strict";
import { validateContents } from "../scripts/package.mjs";

const pkg = { license: "GPL-3.0-only", pi: { extensions: ["./extensions/zotero/index.ts"] } };
const files = ["package.json", "README.md", "LICENSE", "CHANGELOG.md", "CONTRIBUTING.md", "zotero-pi.example.json", ...["index", "api", "autocomplete", "config", "digest", "library", "storage", "workflow"].map(name => `extensions/zotero/${name}.ts`), "docs/releases.md"].map(path => ({ path }));
test("distribution includes the entire runtime helper graph and license", () => {
	assert.equal(validateContents(pkg, files).length, files.length);
});
test("private or unrelated files cannot ship", () => {
	for (const path of [".pi/sandbox.json", ".env", "node_modules/example/index.js", "paper.pdf", "library.bib", "papers/PAPER001/paper-card.md", "docs/../secret.md", "scripts/smoke-pi.mjs"]) assert.throws(() => validateContents(pkg, [...files, { path }]), /Unexpected\/private/);
});
test("missing runtime files or license fail distribution validation", () => {
	for (const path of ["LICENSE", "extensions/zotero/storage.ts", "README.md"]) assert.throws(() => validateContents(pkg, files.filter(file => file.path !== path)), /missing/);
});
test("manifest and license mismatches are rejected", () => {
	assert.throws(() => validateContents({ ...pkg, license: "MIT" }, files), /license/);
	assert.throws(() => validateContents({ ...pkg, pi: { extensions: [] } }, files), /manifest/);
});
test("duplicate distribution paths are rejected", () => {
	assert.throws(() => validateContents(pkg, [...files, files[0]]), /Duplicate/);
});
