import { readFile, writeFile, rename, unlink, open } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";

export function cachePaths(cacheDir, itemKey) {
	if (!/^[A-Z0-9]{8}$/.test(itemKey)) throw new Error("zotero-pi: Invalid Zotero item key.");
	const dir = join(cacheDir, "papers", itemKey);
	return { dir, cardPath: join(dir, "paper-card.md"), provenancePath: join(dir, "provenance.json") };
}
export async function readOptional(path, access) {
	await access?.read(path);
	try { return await readFile(path, "utf8"); } catch (e) { if (e.code === "ENOENT") return undefined; throw e; }
}
export async function atomicWrite(path, content, access) {
	const tmp = `${path}.${randomUUID()}.tmp`;
	await access?.write(path);
	await access?.write(tmp);
	try { await writeFile(tmp, content, { encoding: "utf8", mode: 0o600, flag: "wx" }); await rename(tmp, path); }
	finally { await unlink(tmp).catch(() => {}); }
}
export function personalNotes(markdown) {
	return markdown?.match(/^## Personal notes\s*\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1]?.trim() ?? "";
}
export function preserveNotes(markdown, previous) {
	const notes = personalNotes(previous);
	if (!notes) return markdown;
	if (/^## Personal notes\s*$/m.test(markdown)) return markdown.replace(/(^## Personal notes\s*\r?\n)[\s\S]*?(?=^## |$(?![\s\S]))/m, (_m, h) => `${h}${notes}\n\n`);
	return `${markdown.trim()}\n\n## Personal notes\n${notes}\n`;
}
export async function withFileLock(path, fn, access) {
	await access?.write(`${path}.lock`);
	let handle;
	try { handle = await open(`${path}.lock`, "wx", 0o600); }
	catch (error) {
		if (error.code === "EEXIST") throw new Error(`zotero-pi: Digest is locked: ${path}.lock. Another session may be digesting it. If no session is running, remove that stale lock manually.`);
		throw error;
	}
	try { return await fn(); }
	finally { await handle.close(); await unlink(`${path}.lock`); }
}
export async function attachmentPath(client, attachment, signal) {
	const p = attachment.data.path;
	if (p && isAbsolute(p)) return p;
	const url = await client.fileURL(attachment.key, signal);
	if (!url.startsWith("file:")) throw new Error(`zotero-pi: Attachment ${attachment.key} has no local file. Download it in Zotero first.`);
	return fileURLToPath(url);
}
export async function sourceFor(client, item, attachments, signal) {
	const pdfs = attachments.filter(a => a.data.parentItem === item.key && (a.data.contentType === "application/pdf" || /\.pdf$/i.test(a.data.path ?? "")));
	const preferred = item.links?.attachment?.href?.match(/\/items\/([A-Z0-9]{8})(?:\/|$)/)?.[1];
	const pdf = pdfs.find(a => a.key === preferred) ?? pdfs[0];
	if (!pdf) return undefined;
	const pdfPath = await attachmentPath(client, pdf, signal);
	return { pdfPath, attachmentKey: pdf.key };
}
export function sha256Text(text) { return createHash("sha256").update(text).digest("hex"); }
export async function sha256File(path, signal) {
	const hash = createHash("sha256");
	for await (const bytes of createReadStream(path, { signal })) hash.update(bytes);
	return hash.digest("hex");
}
