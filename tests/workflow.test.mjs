import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReferenceWorkflow } from "../extensions/zotero/workflow.ts";
import { cachePaths, readOptional } from "../extensions/zotero/storage.ts";

async function setup(t) {
	const dir = await mkdtemp(join(tmpdir(), "zotero-workflow-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	const items = [1, 2].map(n => ({ key: `PAPER00${n}`, data: { itemType: "journalArticle", citationKey: `paper${n}`, title: `Paper ${n}`, abstractNote: `Abstract ${n}`, collections: ["TOPIC001"] } }));
	const data = { collections: [{ key: "TOPIC001", data: { name: "topic", parentCollection: false } }], items };
	const attachments = items.map((i, n) => ({ key: `PDF0000${n}`, data: { itemType: "attachment", parentItem: i.key, contentType: "application/pdf", path: join(dir, `${i.key}.pdf`) } }));
	const calls = { digests: 0, fetch: 0, library: 0, attachments: 0 };
	const client = { library: async () => { calls.library++; return data; }, attachments: async () => { calls.attachments++; return attachments; } };
	const digests = { read: item => readOptional(cachePaths(dir, item.key).cardPath), ensure: async (item, source, options) => { calls.digests++; assert.ok(source); return `Digest ${item.key} force=${options.force}`; } };
	const workflow = new ReferenceWorkflow({ client, digests, cacheDir: dir, fetchImpl: async () => { calls.fetch++; return new Response("<h1>Repository README</h1><p>Useful initial information.</p>", { headers: { "content-type": "text/html" } }); } });
	return { dir, items, data, attachments, calls, workflow };
}
test("collection scans load every abstract and only already-existing digests", async t => {
	const f = await setup(t);
	const cached = cachePaths(f.dir, "PAPER001"); await mkdir(cached.dir, { recursive: true });
	await writeFile(cached.cardPath, "Existing digest");
	f.workflow.client.attachments = async () => { throw new Error("scans must not look up PDFs"); };
	const result = await f.workflow.loadPrompt("Find A but not B in §topic/");
	assert.equal(result.loaded.length, 2);
	assert.equal(result.text, "Find A but not B in §topic/", "the visible prompt must remain unchanged");
	assert.ok(result.context.includes("Abstract 1")); assert.ok(result.context.includes("Abstract 2"));
	assert.ok(result.context.includes("Existing digest"));
	assert.equal(f.calls.digests, 0); assert.equal(f.calls.fetch, 0); assert.equal(f.calls.attachments, 0);
});
test("cached direct reads require no attachment lookup", async t => {
	const f = await setup(t); const cached = cachePaths(f.dir, "PAPER001");
	await mkdir(cached.dir, { recursive: true }); await writeFile(cached.cardPath, "Existing cached explanation");
	f.workflow.client.attachments = async () => { throw new Error("no PDF available"); };
	const result = await f.workflow.loadPrompt("Explain §paper1");
	assert.ok(result.context.includes("Existing cached explanation")); assert.equal(f.calls.digests, 0);
});
test("direct references ensure digests, retain the original question and deduplicate", async t => {
	const f = await setup(t);
	const result = await f.workflow.loadPrompt("Explain this statement in §paper1 and §topic/paper1.");
	assert.equal(result.loaded.length, 1); assert.equal(f.calls.digests, 1);
	assert.equal(result.text, "Explain this statement in §paper1 and §topic/paper1.");
	assert.ok(result.context.includes("Digest PAPER001"));
	assert.ok(!result.text.includes("ZOTERO-PI REFERENCE CONTEXT"));
});
test("explicit items override scan-only membership in either token order", async t => {
	const f = await setup(t);
	for (const prompt of ["§topic/ then §paper1", "§paper1 then §topic/"]) {
		f.calls.digests = 0;
		const result = await f.workflow.loadPrompt(prompt);
		assert.equal(result.loaded.length, 2); assert.equal(f.calls.digests, 1);
	}
});
test("absent paper abstract fails direct reads and is reported in collection scans", async t => {
	const f = await setup(t); f.items[0].data.abstractNote = "";
	await assert.rejects(f.workflow.loadPrompt("Explain §paper1"), /no abstract/);
	assert.equal(f.calls.digests, 0);
	const result = await f.workflow.loadPrompt("Search §topic/");
	assert.ok(result.context.includes("has no abstract")); assert.equal(f.calls.digests, 0);
});
test("non-paper entries fetch initial information once without requiring an abstract", async t => {
	const f = await setup(t); f.items[0].data.itemType = "computerProgram"; delete f.items[0].data.abstractNote; f.items[0].data.url = "https://example.org/repo";
	let result = await f.workflow.loadPrompt("Explain §paper1");
	assert.ok(result.context.includes("Repository README"));
	assert.equal(result.text, "Explain §paper1");
	result = await f.workflow.loadPrompt("Explain §paper1 again");
	assert.ok(result.context.includes("Repository README"));
	assert.equal(result.text, "Explain §paper1 again");
	assert.equal(f.calls.fetch, 1); assert.equal(f.calls.digests, 0);
	await f.workflow.loadPrompt("Scan §topic/"); assert.equal(f.calls.fetch, 1);
});
test("non-paper metadata is sufficient without unnecessary network fetching", async t => {
	const f = await setup(t); f.items[0].data.itemType = "computerProgram"; delete f.items[0].data.abstractNote; f.items[0].data.extra = "A scientific toolkit for robust array processing and reproducible experiments.";
	await f.workflow.loadPrompt("Explain §paper1"); assert.equal(f.calls.fetch, 0);
});
test("collection redigest is refused, including root", async t => {
	const f = await setup(t);
	await assert.rejects(f.workflow.loadPrompt("§topic/", { force: true }), /never a collection/);
	await assert.rejects(f.workflow.loadPrompt("§/", { force: true }), /never a collection/);
	assert.equal(f.calls.digests, 0);
});
test("oversized collection contexts fail explicitly instead of silently dropping entries", async t => {
	const f = await setup(t); f.workflow.maxContextChars = 100;
	await assert.rejects(f.workflow.loadPrompt("§topic/"), /Nothing was silently truncated/);
	assert.equal(f.calls.digests, 0);
});
test("digestLevel none rewrites item references to ordinary PDF file references and creates no digest", async t => {
	const f = await setup(t); f.workflow.digestLevel = "none";
	const result = await f.workflow.loadPrompt("Explain §topic/paper1 please");
	assert.equal(result.text, `Explain @${f.attachments[0].data.path} please`);
	assert.ok(result.context.includes('"fileReference"'));
	assert.equal(f.calls.digests, 0); assert.equal(f.calls.attachments, 1);
});
test("ordinary prompts perform no Zotero access", async t => {
	const f = await setup(t);
	const result = await f.workflow.loadPrompt("Hello");
	assert.equal(result.text, "Hello");
	assert.equal(result.context, undefined);
	assert.equal(f.calls.library, 0); assert.equal(f.calls.attachments, 0);
});
