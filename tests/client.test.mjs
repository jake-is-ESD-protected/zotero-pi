import { test } from "node:test";
import assert from "node:assert/strict";
import { ZoteroClient, ZoteroUnavailableError } from "../extensions/zotero/api.ts";

test("pagination uses Total-Results and retrieves all pages", async () => {
	const rows = Array.from({ length: 205 }, (_, key) => ({ key })); let calls = 0;
	const client = new ZoteroClient(async url => {
		calls++; const start = Number(new URL(url).searchParams.get("start"));
		return new Response(JSON.stringify(rows.slice(start, start + 100)), { headers: { "Total-Results": "205" } });
	});
	assert.equal((await client.list("/api/users/0/items")).length, 205); assert.equal(calls, 3);
});
test("request failures produce the deterministic unavailable warning", async () => {
	const client = new ZoteroClient(async () => { throw new Error("ECONNREFUSED"); });
	await assert.rejects(client.list("/api/users/0/items"), ZoteroUnavailableError);
});
test("cancelled requests propagate cancellation rather than claiming Zotero is closed", async () => {
	const controller = new AbortController(); controller.abort(new Error("cancelled"));
	const client = new ZoteroClient(async () => { throw controller.signal.reason; });
	await assert.rejects(client.list("/api/users/0/items", controller.signal), /cancelled/);
});
test("Zotero client only performs GET requests and exposes no write bridge", async () => {
	let calls = 0;
	const client = new ZoteroClient(async (_url, options) => {
		calls++; assert.equal(options.method, "GET"); assert.equal(options.body, undefined);
		return new Response("[]");
	});
	await client.library(); await client.attachments(); await client.children("PAPER001");
	assert.ok(calls > 0); assert.equal(client.bridge, undefined);
});
test("sandbox domain denial stops before any HTTP request", async () => {
	let called = false;
	const client = new ZoteroClient(async () => { called = true; }, { domain() { throw new Error("sandbox denied"); } });
	await assert.rejects(client.library(), /sandbox denied/); assert.equal(called, false);
});
