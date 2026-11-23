import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, access, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DigestStore, DIGEST_HEADINGS, chunks, validateDigest } from "../extensions/zotero/digest.ts";
import { cachePaths, personalNotes, preserveNotes, atomicWrite } from "../extensions/zotero/storage.ts";

const card = () => `# §paper — Test\n\n${DIGEST_HEADINGS.map(h => `## ${h}\n${h === "Personal notes" ? "" : "Source: p. 1. Claim: measured signal improves; assumptions explicit; limitations retained."}\n`).join("\n")}`;
async function setup(t) {
	const dir = await mkdtemp(join(tmpdir(), "zotero-cache-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	const cacheDir = join(dir, "cache"), pdfDir = join(dir, "pdfs"); await mkdir(pdfDir);
	const item = { key: "PAPER001", data: { citationKey: "paper", title: "Test", abstractNote: "Abstract" } };
	const source = { pdfPath: join(pdfDir, "paper.pdf"), attachmentKey: "PDF00001" };
	await writeFile(source.pdfPath, "fixture PDF bytes");
	const paths = cachePaths(cacheDir, item.key), calls = { model: 0, extract: 0, prompts: [] };
	const guard = {
		read: async () => {},
		write: async path => assert.ok(path === cacheDir || path.startsWith(cacheDir + "/"), `write outside cache: ${path}`),
	};
	const store = new DigestStore({ cacheDir, access: guard, model: "test/model", extract: async () => { calls.extract++; return "[PDF page 1] source material"; },
		generate: async prompt => { calls.model++; calls.prompts.push(prompt); return prompt.startsWith("Create a self-contained") ? card() : "Evidence p. 1; assumptions explicit; $$x^2$$; limitations retained."; } });
	return { dir, cacheDir, pdfDir, item, source, paths, calls, store };
}
test("missing digest writes only to cache, retaining source/model provenance", async t => {
	const f = await setup(t); const digest = await f.store.ensure(f.item, f.source);
	assert.equal(await readFile(f.paths.cardPath, "utf8"), digest);
	const metadata = JSON.parse(await readFile(f.paths.provenancePath, "utf8"));
	assert.equal(metadata.itemKey, f.item.key); assert.equal(metadata.model, "test/model");
	assert.equal(metadata.pdfPath, f.source.pdfPath); assert.match(metadata.pdfHash, /^[a-f0-9]{64}$/);
	assert.equal(metadata.registered, undefined); assert.equal(metadata.registration, undefined);
	assert.deepEqual(await readdir(f.pdfDir), ["paper.pdf"], "PDF directory stays untouched");
	assert.equal(f.calls.model, 2); assert.equal(f.calls.extract, 1);
	await assert.rejects(access(`${f.paths.cardPath}.lock`));
});
test("cached reads need no PDF, model call, cache write, or Zotero write API", async t => {
	const f = await setup(t); const first = await f.store.ensure(f.item, f.source);
	await rm(f.source.pdfPath);
	f.store.access = { read: async () => {}, write: async () => { throw new Error("read-only cache"); } };
	assert.equal(await f.store.ensure(f.item, undefined), first);
	assert.equal(await f.store.read(f.item), first);
	assert.equal(f.calls.model, 2); assert.equal(f.calls.extract, 1);
});
test("cache identity survives citekey changes", async t => {
	const f = await setup(t); const first = await f.store.ensure(f.item, f.source);
	f.item.data.citationKey = "renamed2027";
	assert.equal(await f.store.read(f.item), first); assert.equal(f.calls.model, 2);
});
test("old citekey-based cache is reused read-only, without regeneration", async t => {
	const f = await setup(t); const legacy = join(f.cacheDir, "papers", "paper"); await mkdir(legacy, { recursive: true });
	await writeFile(join(legacy, "paper-card.md"), card());
	await writeFile(join(legacy, "provenance.json"), JSON.stringify({ citekey: "paper", model: "old/model" }));
	f.store.access = { read: async () => {}, write: async () => { throw new Error("no writes"); } };
	assert.equal(await f.store.ensure(f.item), card()); assert.equal(f.calls.model, 0);
});
test("redigest migrates old cache while preserving personal notes and original files", async t => {
	const f = await setup(t); const legacy = join(f.cacheDir, "papers", "paper"); await mkdir(legacy, { recursive: true });
	const old = preserveNotes(card(), "## Personal notes\n- 2026-01-01 — Keep $& and $1 exactly\n");
	await writeFile(join(legacy, "paper-card.md"), old);
	const regenerated = await f.store.ensure(f.item, f.source, { force: true });
	assert.match(personalNotes(regenerated), /Keep \$& and \$1 exactly/);
	assert.equal(await readFile(join(legacy, "paper-card.md"), "utf8"), old);
	assert.equal(await readFile(f.paths.cardPath, "utf8"), regenerated);
});
test("notes are local-only and survive explicit redigest", async t => {
	const f = await setup(t); await f.store.ensure(f.item, f.source);
	await f.store.appendNote(f.item, "Useful for my methods");
	assert.equal(f.calls.model, 2);
	const updated = await f.store.ensure(f.item, f.source, { force: true });
	assert.equal(updated.match(/Useful for my methods/g).length, 1); assert.equal(f.calls.model, 4);
});
test("redigest preserves notes edited while model is working", async t => {
	const f = await setup(t); await f.store.ensure(f.item, f.source); const generate = f.store.generate;
	f.store.generate = async (...args) => {
		if (args[0].startsWith("Create a self-contained")) {
			const current = await readFile(f.paths.cardPath, "utf8");
			await atomicWrite(f.paths.cardPath, preserveNotes(current, "## Personal notes\n- 2026-01-01 — Edited while digesting\n"));
		}
		return generate(...args);
	};
	assert.ok((await f.store.ensure(f.item, f.source, { force: true })).includes("Edited while digesting"));
});
test("manual cache edits are reused without any synchronization", async t => {
	const f = await setup(t); const first = await f.store.ensure(f.item, f.source);
	await atomicWrite(f.paths.cardPath, first + "\nManual clarification.\n");
	assert.ok((await f.store.read(f.item)).includes("Manual clarification")); assert.equal(f.calls.model, 2);
});
test("cache writes denied before spending model/extraction work", async t => {
	const f = await setup(t); f.store.access.write = async () => { throw new Error("cache denied"); };
	await assert.rejects(f.store.ensure(f.item, f.source), /cache denied/);
	assert.equal(f.calls.extract, 0); assert.equal(f.calls.model, 0);
});
test("parallel reads coalesce generation", async t => {
	const f = await setup(t); const [a, b] = await Promise.all([f.store.ensure(f.item, f.source), f.store.ensure(f.item, f.source)]);
	assert.equal(a, b); assert.equal(f.calls.model, 2);
});
test("missing PDF is an error only when generation is needed", async t => {
	const f = await setup(t); await assert.rejects(f.store.ensure(f.item), /no attached local PDF/); assert.equal(f.calls.model, 0);
});
test("empty cache requires explicit redigest", async t => {
	const f = await setup(t); await mkdir(f.paths.dir, { recursive: true }); await writeFile(f.paths.cardPath, "");
	await assert.rejects(f.store.ensure(f.item, f.source), /Cached digest is empty or invalid/); assert.equal(f.calls.model, 0);
});
test("wrong-item provenance is rejected", async t => {
	const f = await setup(t); await f.store.ensure(f.item, f.source);
	await writeFile(f.paths.provenancePath, JSON.stringify({ itemKey: "OTHER001" }));
	await assert.rejects(f.store.read(f.item), /different Zotero item/);
});
test("failed model output is not persisted; lock released", async t => {
	const f = await setup(t); f.store.generate = async () => "invalid";
	await assert.rejects(f.store.ensure(f.item, f.source), /incomplete digest/);
	await assert.rejects(access(f.paths.cardPath)); await assert.rejects(access(`${f.paths.cardPath}.lock`));
});
test("extraction failure leaves no incomplete digest", async t => {
	const f = await setup(t); f.store.extract = async () => { throw new Error("sandbox denied"); };
	await assert.rejects(f.store.ensure(f.item, f.source), /sandbox denied/); assert.equal(f.calls.model, 0);
	await assert.rejects(access(f.paths.cardPath));
});
test("cancelled generation invokes no model and leaves no lock", async t => {
	const f = await setup(t); const controller = new AbortController(); controller.abort();
	await assert.rejects(f.store.ensure(f.item, f.source, { signal: controller.signal }));
	assert.equal(f.calls.model, 0); await assert.rejects(access(f.paths.cardPath)); await assert.rejects(access(`${f.paths.cardPath}.lock`));
});
test("PDF changing during digestion cannot overwrite a saved cache", async t => {
	const f = await setup(t); const previous = await f.store.ensure(f.item, f.source); const generate = f.store.generate;
	f.store.generate = async (...args) => { await writeFile(f.source.pdfPath, "changed bytes"); return generate(...args); };
	await assert.rejects(f.store.ensure(f.item, f.source, { force: true }), /PDF changed during digestion/);
	assert.equal(await readFile(f.paths.cardPath, "utf8"), previous);
});
test("LLM digest instructions favor dense but mathematically faithful content", async t => {
	const f = await setup(t); await f.store.ensure(f.item, f.source);
	const prompt = f.calls.prompts.at(-1);
	assert.match(prompt, /telegraphic/i); assert.match(prompt, /\$\$/); assert.match(prompt, /units/); assert.match(prompt, /assumptions/); assert.match(prompt, /page\/section/);
	assert.match(prompt, /not.*(?:drop|omit).*qualifiers/i);
});
test("chunks preserve every character, including surrogate pairs", () => {
	for (const text of ["x".repeat(100001), "a😀b😀c"]) { const parts = chunks(text, 24000); assert.equal(parts.join(""), text); assert.ok(parts.every(p => p.isWellFormed())); }
	assert.ok(chunks("a😀b😀c", 2).every(p => p.isWellFormed()));
});
test("digest validation rejects incomplete or fenced output", () => {
	assert.equal(validateDigest(card()), card());
	assert.throws(() => validateDigest(card().replace("## Method\n", "")), /missing heading/);
	assert.throws(() => validateDigest("```\n" + card()), /code fence/);
});
test("cache paths reject traversal; CRLF notes remain supported", () => {
	assert.equal(cachePaths("/cache", "PAPER001").cardPath, "/cache/papers/PAPER001/paper-card.md");
	assert.throws(() => cachePaths("/cache", "../oops"));
	assert.equal(personalNotes("## Personal notes\r\n- 2026-01-01 — hi\r\n\r\n## Provenance\r\nother"), "- 2026-01-01 — hi");
});
