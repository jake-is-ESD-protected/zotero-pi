// Optional adapter test against an installed pi SDK. All Zotero/model I/O is mocked;
// HOME and PDFs live in a temporary directory, never in the user's real library.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.env.PI_EXTENSION_ROOT || dirname(dirname(fileURLToPath(import.meta.url)));
async function installedPiRoot() {
	let directory = dirname(await realpath(execFileSync("which", ["pi"], { encoding: "utf8" }).trim()));
	while (true) {
		try { if (JSON.parse(await readFile(join(directory, "package.json"), "utf8")).name === "@earendil-works/pi-coding-agent") return directory; }
		catch (error) { if (error.code !== "ENOENT") throw error; }
		const parent = dirname(directory);
		if (parent === directory) throw new Error("Cannot locate pi package; pass its package directory as the first argument.");
		directory = parent;
	}
}
const piRoot = process.argv[2] || process.env.PI_PACKAGE_ROOT || await installedPiRoot();
const require = createRequire(join(piRoot, "package.json"));
const { createJiti } = require("jiti");
const temporary = await mkdtemp(join(tmpdir(), "zotero-pi-adapter-"));
const originalHome = process.env.HOME, originalFetch = globalThis.fetch;
process.env.HOME = temporary;
try {
	const text = "Scientific evidence from controlled measurements supports the proposed signal processing method and its clearly stated limitations.";
	const stream = `BT /F1 10 Tf 20 700 Td (${text}) Tj ET`;
	const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1200 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
	let pdf = "%PDF-1.4\n"; const offsets = [];
	for (const [i, o] of objects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; }
	const xref = Buffer.byteLength(pdf);
	pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map(n => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	const pdfPath = join(temporary, "paper.pdf"); await writeFile(pdfPath, pdf);
	let offline = false, modelCalls = 0, attachmentLookups = 0;
	globalThis.fetch = async (url, options) => {
		assert.equal(options?.method ?? "GET", "GET", "Zotero must remain read-only");
		assert.ok(!new URL(url).pathname.startsWith("/zotero-pi/"), "no custom plugin endpoint may be requested");
		if (offline) throw new Error("ECONNREFUSED");
		const path = new URL(url).pathname; let data = [];
		if (path.endsWith("/collections")) data = [
			{ key: "TOPIC001", data: { name: "topic", parentCollection: false } },
			{ key: "PHD00001", data: { name: "PhD", parentCollection: false } },
			{ key: "AOA00001", data: { name: "AoA", parentCollection: "PHD00001" } },
			{ key: "DIR00001", data: { name: "Directive Arrays", parentCollection: "PHD00001" } },
			{ key: "COM00001", data: { name: "Compact Arrays", parentCollection: "PHD00001" } },
		];
		if (path.endsWith("/items/top")) data = [{ key: "PAPER001", data: { citationKey: "paper", itemType: "journalArticle", title: "Fixture paper", abstractNote: "Abstract about signal processing.", collections: ["TOPIC001", "AOA00001", "DIR00001", "COM00001"] } }];
		if (path.endsWith("/items")) { attachmentLookups++; data = [{ key: "PDF00001", data: { parentItem: "PAPER001", contentType: "application/pdf", path: pdfPath } }]; }
		return new Response(JSON.stringify(data), { headers: { "Total-Results": String(Array.isArray(data) ? data.length : 0) } });
	};
	const reloadDir = join(temporary, "reload-fixture");
	await mkdir(reloadDir);
	await cp(join(root, "extensions", "zotero"), reloadDir, { recursive: true });
	let suffix;
	try { await readFile(join(reloadDir, "storage.ts")); suffix = "ts"; } catch (error) { if (error.code !== "ENOENT") throw error; suffix = "mjs"; }
	const storageFile = join(reloadDir, `storage.${suffix}`);
	const sourceStorage = await readFile(storageFile, "utf8");
	assert.ok(sourceStorage.includes("return { dir, cardPath:"));
	// Simulate an old helper shape surviving an extension update: new caller
	// requires dir, but the cached dependency still returns no dir.
	await writeFile(storageFile, sourceStorage.replace("return { dir, cardPath:", "return { cardPath:"));
	const reloadEntry = join(reloadDir, "reload-entry.ts");
	await writeFile(reloadEntry, `import { DigestStore } from "./digest.${suffix}"; import { resolve } from "node:path"; export default () => resolve(new DigestStore({ cacheDir: "/cache" }).paths({ key: "PAPER001" }).dir);`);
	const stale = await createJiti(import.meta.url, { moduleCache: false }).import(reloadEntry, { default: true });
	assert.throws(stale, /paths\[0\]/);
	await writeFile(storageFile, sourceStorage);
	const refreshed = await createJiti(import.meta.url, { moduleCache: false }).import(reloadEntry, { default: true });
	assert.equal(refreshed(), "/cache/papers/PAPER001", "pi reload must refresh the complete helper graph, not retain undefined paths");
	const jiti = createJiti(import.meta.url, { moduleCache: false, alias: { "@earendil-works/pi-coding-agent": join(piRoot, "dist", "index.js") } });
	const extension = await jiti.import(join(root, "extensions", "zotero", "index.ts"), { default: true });
	const { convertToLlm } = await jiti.import(join(piRoot, "dist", "core", "messages.js"));
	const { InteractiveMode } = await jiti.import(join(piRoot, "dist", "modes", "interactive", "interactive-mode.js"));
	const handlers = {}, commands = {}, notices = [], sent = [];
	function assertBackgroundOnly(payload) {
		assert.equal(payload.display, false);
		const custom = { ...payload, role: "custom", timestamp: Date.now() };
		assert.ok(JSON.stringify(convertToLlm([custom])).includes("Abstract about signal processing."), "hiding from the UI must not hide data from the model");
		let rendered = 0;
		InteractiveMode.prototype.addMessageToChat.call({ chatContainer: { addChild() { rendered++; } } }, custom);
		assert.equal(rendered, 0, "the installed terminal renderer must create no metadata component (also on transcript replay)");
	}
	extension({ on: (n, h) => { handlers[n] = h; }, registerCommand: (n, c) => { commands[n] = c; }, appendEntry() {}, sendMessage: m => sent.push(m), sendUserMessage: m => sent.push(m), getCommands: () => [], getFlag: () => undefined });
	const model = { provider: "fixture", id: "model", reasoning: true, thinkingLevelMap: { off: null, low: "low", medium: "medium", high: "high" } };
	const ctx = {
		cwd: temporary, mode: "print", hasUI: false, model, isProjectTrusted: () => true,
		ui: { setStatus() {}, notify: (...args) => notices.push(args) },
		modelRegistry: { streamSimple: (selected, context, options) => {
			assert.equal(selected, model); assert.ok(options.signal instanceof AbortSignal); assert.equal(options.reasoning, "low", "models that reject off must get a supported non-off reasoning level"); modelCalls++;
			const final = context.messages[0].content.includes("NEW SOURCE NOTES:");
			const content = final ? `# §paper — Fixture\n\n${["Abstract", "Research question", "Method", "Symbols and equations", "Key findings and evidence", "Limitations", "Personal notes"].map(h => `## ${h}\n${h === "Personal notes" ? "" : "Scientific source evidence with physical page references and careful limitations."}\n`).join("\n")}` : "Detailed source-derived scientific notes with page references.";
			return { result: async () => ({ stopReason: "stop", content: [{ type: "text", text: content }], usage: {} }) };
		} },
	};
	await handlers.session_start({}, ctx);
	const question = "Explain the result in §topic/paper";
	let result = await handlers.input({ text: question, source: "rpc" }, ctx);
	assert.equal(result.action === "transform" ? result.text : question, question, "visible prompt must not contain background Zotero metadata");
	assert.notEqual(result.action, "handled");
	let background = sent.filter(m => m.customType === "zotero-pi-context").at(-1);
	assert.ok(background, "loaded metadata must still reach model context");
	assert.equal(background.display, false, "reference payload must be hidden from the transcript UI");
	assert.ok(background.content.includes("Abstract about signal processing."));
	assertBackgroundOnly(background);
	assert.equal(modelCalls, 2); assert.equal(attachmentLookups, 1);
	assert.match(await readFile(join(temporary, ".pi", "agent", "zotero-pi-cache", "papers", "PAPER001", "paper-card.md"), "utf8"), /Model: fixture\/model/);
	await handlers.input({ text: question, source: "rpc" }, ctx);
	assert.equal(modelCalls, 2, "cached reference must not re-digest");
	const scanPrompt = "Scan §PhD/AoA/, §PhD/Directive%20Arrays/ and §PhD/Compact%20Arrays/ for new refs. Update @paper-project/refs/introduction_citation_picks.md accordingly.";
	result = await handlers.input({ text: scanPrompt, source: "rpc" }, ctx);
	assert.notEqual(result.action, "handled");
	assert.equal(result.action === "transform" ? result.text : scanPrompt, scanPrompt, "preserve the user's scan request and attachment path verbatim");
	background = sent.filter(m => m.customType === "zotero-pi-context").at(-1);
	assert.equal(background.display, false);
	assert.ok(background.content.includes("Abstract about signal processing."));
	assertBackgroundOnly(background);
	assert.equal(modelCalls, 2, "collection scanning must not create digests");
	assert.equal(attachmentLookups, 1, "cached reads and scans must not look up PDFs");
	assert.ok(!notices.some(n => /ZOTERO-PI REFERENCE CONTEXT|<zotero-reference-data>|Abstract about signal processing\./.test(n[0])), "notifications must not dump reference bodies");
	await commands.zotero.handler("redigest §paper", ctx);
	assert.equal(modelCalls, 4); assert.equal(attachmentLookups, 2);
	assert.ok(sent.filter(m => m.customType === "zotero-pi-context").every(m => m.display === false), "redigest must not reveal metadata either");
	await commands.zotero.handler("redigest §topic/", ctx);
	assert.equal(modelCalls, 4); assert.ok(notices.some(n => n[0].includes("never a collection")));
	offline = true;
	result = await handlers.input({ text: question, source: "rpc" }, ctx);
	assert.equal(result.action, "handled"); assert.ok(notices.some(n => n[1] === "warning" && n[0].includes("Cannot reach")));
	console.log("PASS installed pi adapter: original prompt preserved; metadata model-visible/TUI-hidden; multi-collection scan + @path; PDF read-only; cache-only writes; reload refreshes helper graph; reuse; redigest; offline warning");
} finally {
	globalThis.fetch = originalFetch;
	if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
	await rm(temporary, { recursive: true, force: true });
}
