import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, configPaths, loadConfig } from "../extensions/zotero/config.ts";

test("global config supplies defaults; trusted project config overrides scalars", async t => {
	const dir = await mkdtemp(join(tmpdir(), "zotero-config-")); const agent = join(dir, "agent"); await mkdir(agent); await mkdir(join(dir, ".pi"), { recursive: true });
	const previous = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = agent;
	try {
		await writeFile(join(agent, "zotero-pi.json"), JSON.stringify({ digestLevel: "heavy", maxPdfPages: 40 }));
		await writeFile(join(dir, ".pi", "zotero-pi.json"), JSON.stringify({ maxPdfPages: 12, digestLevel: "none" }));
		const untrusted = await loadConfig(dir, false);
		assert.equal(untrusted.digestLevel, "heavy"); assert.equal(untrusted.maxPdfPages, 40); assert.equal(untrusted.cacheDir, DEFAULT_CONFIG.cacheDir);
		const trusted = await loadConfig(dir, true);
		assert.equal(trusted.digestLevel, "none"); assert.equal(trusted.maxPdfPages, 12); assert.equal(trusted.maxContextChars, DEFAULT_CONFIG.maxContextChars);
		assert.equal(configPaths(dir, true).project, join(dir, ".pi", "zotero-pi.json"));
	} finally { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; await rm(dir, { recursive: true, force: true }); }
});
test("invalid levels, limits and unknown settings fail clearly", async t => {
	const dir = await mkdtemp(join(tmpdir(), "zotero-config-")); const agent = join(dir, "agent"); await mkdir(agent);
	const previous = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = agent;
	try {
		for (const bad of [{ digestLevel: "huge" }, { maxPdfPages: -1 }, { maxSourceChars: 1.5 }, { nope: true }]) {
			await writeFile(join(agent, "zotero-pi.json"), JSON.stringify(bad));
			await assert.rejects(loadConfig(dir, false), /zotero-pi: /);
		}
		await writeFile(join(agent, "zotero-pi.json"), JSON.stringify({ cacheDir: "~/cache", maxContextChars: 1000, digestLevel: "normal", maxPdfPages: 0, maxSourceChars: 0 }));
		const cfg = await loadConfig(dir, false); assert.ok(cfg.cacheDir.endsWith(join("cache"))); assert.equal(cfg.maxPdfPages, 0);
	} finally { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; await rm(dir, { recursive: true, force: true }); }
});
