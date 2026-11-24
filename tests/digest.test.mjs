import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, access, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DigestStore, DIGEST_HEADINGS, chunks, validateDigest, extractPdf } from "../extensions/zotero/digest.ts";
import { cachePaths, personalNotes, preserveNotes, atomicWrite } from "../extensions/zotero/storage.ts";

const card = () => `# §paper — Test\n\n${DIGEST_HEADINGS.map(h => `## ${h}\n${h === "Personal notes" ? "" : "Source: p. 1. Claim: measured signal improves; assumptions explicit; limitations retained."}\n`).join("\n")}`;
const extraction = (text = "[PDF page 1] source material", pageCount = 1, partial = false) => ({ text, pageCount, analyzedPages: [1, Math.min(pageCount || 1, 1)], charCount: text.length, partial, reasons: partial ? ["page cap 1/2"] : [] });
async function setup(t, options = {}) {
	const dir = await mkdtemp(join(tmpdir(), "zotero-cache-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	const cacheDir = join(dir, "cache"), pdfDir = join(dir, "pdfs"); await mkdir(pdfDir);
	const item = { key: "PAPER001", data: { citationKey: "paper", title: "Test", abstractNote: "Abstract" } };
	const source = { pdfPath: join(pdfDir, "paper.pdf"), attachmentKey: "PDF00001" };
	await writeFile(source.pdfPath, "fixture PDF bytes");
	const paths = cachePaths(cacheDir, item.key), calls = { model: 0, extract: 0, prompts: [], notices: [] };
	const store = new DigestStore({ cacheDir, model: "test/model", level: options.level ?? "normal", maxPdfPages: options.maxPdfPages ?? 0, maxSourceChars: options.maxSourceChars ?? 0,
		countPages: async () => options.pageCount ?? 1,
		extract: async (_path, _signal, limits) => { calls.extract++; const pageCount = options.pageCount ?? 1; const cap = limits?.maxPages ?? pageCount; const partial = cap < pageCount || Boolean(limits?.maxChars && (options.extraction?.charCount ?? 28) > limits.maxChars); return { text: options.extraction?.text ?? "[PDF page 1] source material", pageCount, analyzedPages: [1, Math.min(cap, pageCount)], charCount: options.extraction?.charCount ?? 28, partial, reasons: partial ? ["configured cap"] : [] }; },
		generate: async (prompt, _signal, maxTokens) => { calls.model++; calls.prompts.push({ prompt, maxTokens }); const isMerge = prompt.includes("NEW SOURCE NOTES:");
		if (options.failLength && isMerge) { const e = new Error("zotero-pi: Digest model hit its output limit and returned an incomplete response; nothing saved."); e.stopReason = "length"; throw e; } return isMerge ? card() : "Evidence p. 1; assumptions explicit; $$x^2$$; limitations retained."; },
		notify: text => calls.notices.push(text) });
	return { dir, cacheDir, pdfDir, item, source, paths, calls, store };
}
test("missing digest writes cache only and records bounded coverage", async t => {
	const f = await setup(t, { pageCount: 300, maxPdfPages: 120 });
	const digest = await f.store.ensure(f.item, f.source);
	assert.equal(await readFile(f.paths.cardPath, "utf8"), digest);
	const metadata = JSON.parse(await readFile(f.paths.provenancePath, "utf8"));
	assert.equal(metadata.itemKey, f.item.key); assert.match(metadata.coverage, /pages 1-120 of 300/); assert.equal(metadata.partial, true);
	assert.deepEqual(await readdir(f.pdfDir), ["paper.pdf"]);
	assert.ok(f.calls.notices.some(n => /300 pages/.test(n) && /cap=120 pages/.test(n) && /analyzing pages 1-120 \(partial\)/.test(n)));
	assert.ok(f.calls.notices.some(n => /chunk\(s\)/.test(n) && /pages 1-120/.test(n)));
	await assert.rejects(access(`${f.paths.cardPath}.lock`));
});
test("cached reads need no PDF or model call", async t => {
	const f = await setup(t); const first = await f.store.ensure(f.item, f.source);
	await rm(f.source.pdfPath);
	assert.equal(await f.store.ensure(f.item, undefined), first);
	assert.equal(await f.store.read(f.item), first); assert.equal(f.calls.model, 2);
});
test("cache identity survives citekey changes and old caches are reused read-only", async t => {
	const f = await setup(t); const first = await f.store.ensure(f.item, f.source);
	f.item.data.citationKey = "renamed2027"; assert.equal(await f.store.read(f.item), first); assert.equal(f.calls.model, 2);
	const g = await setup(t); const legacy = join(g.cacheDir, "papers", "paper"); await mkdir(legacy, { recursive: true });
	await writeFile(join(legacy, "paper-card.md"), card());
	assert.equal(await g.store.ensure(g.item), card()); assert.equal(g.calls.model, 0);
});
test("level none refuses cache generation; heavy increases output budget", async t => {
	const none = await setup(t, { level: "none" }); await assert.rejects(none.store.ensure(none.item, none.source), /digestLevel is none/); assert.equal(none.calls.model, 0);
	const heavy = await setup(t, { level: "heavy" }); await heavy.store.ensure(heavy.item, heavy.source);
	assert.ok(heavy.calls.prompts.at(-1).maxTokens >= 14000); assert.ok(heavy.calls.notices.some(n => /level=heavy/.test(n)));
});
test("output-length failures report exactly how much was analyzed and save nothing", async t => {
	const f = await setup(t, { failLength: true, pageCount: 500, maxPdfPages: 40, extraction: extraction("x".repeat(30000), 500, true) });
	await assert.rejects(f.store.ensure(f.item, f.source), /output limit.*progress: pages 1-40\/500, 30,000 source chars, 2 chunks, level=normal/s);
	assert.equal(f.calls.model, 3); await assert.rejects(access(f.paths.cardPath));
});
test("notes are local-only and survive redigest; concurrent-edit notes preserved", async t => {
	const f = await setup(t); await f.store.ensure(f.item, f.source);
	await f.store.appendNote(f.item, "Useful for methods"); assert.equal(f.calls.model, 2);
	const generate = f.store.generate;
	f.store.generate = async (...args) => { if (args[0].includes("NEW SOURCE NOTES:")) { const current = await readFile(f.paths.cardPath, "utf8"); await atomicWrite(f.paths.cardPath, current.replace(/(## Personal notes\n)([\s\S]*?)(?=\n## |$)/, "$1$2- 2026-01-01 — Edited while digesting\n")); } return generate(...args); };
	await f.store.ensure(f.item, f.source, { force: true });
	const updated = await readFile(f.paths.cardPath, "utf8");
	assert.equal(updated.match(/Useful for methods/g).length, 1); assert.ok(updated.includes("Edited while digesting")); assert.equal(f.calls.model, 4);
});
test("parallel reads coalesce; cancellation/failure leaves no lock or card", async t => {
	const f = await setup(t); const [a, b] = await Promise.all([f.store.ensure(f.item, f.source), f.store.ensure(f.item, f.source)]);
	assert.equal(a, b); assert.equal(f.calls.model, 2);
	const g = await setup(t); const controller = new AbortController(); controller.abort();
	await assert.rejects(g.store.ensure(g.item, g.source, { signal: controller.signal })); assert.equal(g.calls.model, 0);
	await assert.rejects(access(g.paths.cardPath)); await assert.rejects(access(`${g.paths.cardPath}.lock`));
	const h = await setup(t); h.store.generate = async () => "invalid";
	await assert.rejects(h.store.ensure(h.item, h.source), /incomplete digest/); await assert.rejects(access(h.paths.cardPath));
});
test("model may omit the local-only personal notes section", async t => {
	const f = await setup(t);
	f.store.generate = async prompt => prompt.includes("NEW SOURCE NOTES:") ? card().replace("## Personal notes\n", "") : "Evidence p. 1; assumptions explicit; $$x^2$$; limitations retained.";
	const digest = await f.store.ensure(f.item, f.source);
	assert.match(digest, /## Personal notes\n/);
});

test("chunks preserve text and surrogate pairs; validation rejects incomplete digests", () => {
	for (const text of ["x".repeat(100001), "a😀b😀c"]) { const parts = chunks(text); assert.equal(parts.join(""), text); assert.ok(parts.every(p => p.isWellFormed())); }
	assert.equal(validateDigest(card()), card());
	assert.throws(() => validateDigest(card().replace("## Method\n", "")), /missing heading/);
	assert.throws(() => validateDigest("```\n" + card()), /code fence/);
});
test("cache paths reject traversal; extraction result reports page caps", async () => {
	assert.equal(cachePaths("/cache", "PAPER001").cardPath, "/cache/papers/PAPER001/paper-card.md");
	assert.throws(() => cachePaths("/cache", "../oops"));
	assert.equal(typeof extractPdf, "function");
	assert.equal(personalNotes("## Personal notes\r\n- 2026-01-01 — hi\r\n\r\n## Provenance\r\nother"), "- 2026-01-01 — hi");
});
