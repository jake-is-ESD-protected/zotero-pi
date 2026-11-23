import { test } from "node:test";
import assert from "node:assert/strict";
import { requireZotero, ZoteroUnavailableError, ZOTERO_UNAVAILABLE_WARNING, ZOTERO_API_URL, ZoteroClient } from "../extensions/zotero/api.ts";

test("accepts a live local Zotero collections response", async () => {
	await requireZotero(async (url, options) => {
		assert.equal(url, ZOTERO_API_URL);
		assert.equal(options.headers["Zotero-API-Version"], "3");
		assert.ok(options.signal instanceof AbortSignal);
		return { ok: true, json: async () => [] };
	});
});

for (const [name, fetchImpl] of [
	["connection refused", async () => { throw new Error("ECONNREFUSED"); }],
	["sandbox denied", async () => { throw new Error("EPERM"); }],
	["timeout", async () => { throw new DOMException("Timed out", "TimeoutError"); }],
	["API disabled", async () => ({ ok: false })],
	["invalid JSON", async () => ({ ok: true, json: async () => { throw new SyntaxError(); } })],
	["unexpected response", async () => ({ ok: true, json: async () => ({}) })],
]) {
	test(`fixed warning for ${name}`, async () => {
		await assert.rejects(requireZotero(fetchImpl), (error) => {
			assert.ok(error instanceof ZoteroUnavailableError);
			assert.equal(error.message, ZOTERO_UNAVAILABLE_WARNING);
			return true;
		});
	});
}
