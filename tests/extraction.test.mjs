import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractPdf } from "../extensions/zotero/digest.ts";

const available = !spawnSync("pdftotext", ["-v"]).error;
function textPdf(text) {
	const stream = `BT /F1 10 Tf 20 700 Td (${text}) Tj ET`;
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1200 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
	];
	let pdf = "%PDF-1.4\n"; const offsets = [0];
	for (const [i, object] of objects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; }
	const xref = Buffer.byteLength(pdf);
	pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return pdf;
}
test("real Poppler extraction produces LLM-readable text with physical page markers", { skip: !available }, async t => {
	const dir = await mkdtemp(join(tmpdir(), "zotero-extract-")); t.after(() => rm(dir, { recursive: true, force: true }));
	const path = join(dir, "fixture.pdf");
	await writeFile(path, textPdf("Scientific evidence from controlled measurements supports the proposed signal processing method and its clearly stated limitations."));
	const text = await extractPdf(path);
	assert.ok(text.includes("[PDF page 1]")); assert.ok(text.includes("Scientific evidence"));
	assert.ok(!text.includes("[PDF page 2]"), "the trailing form feed must not invent a page");
});
test("PDF errors explain extraction and sandbox requirements", { skip: !available }, async () => {
	await assert.rejects(extractPdf("/nonexistent-zotero-pi-fixture.pdf"), /Check poppler-utils.*pi-sandbox/);
});
