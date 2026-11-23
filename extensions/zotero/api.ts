export const ZOTERO_ORIGIN = "http://127.0.0.1:23119";
export const ZOTERO_API_URL = `${ZOTERO_ORIGIN}/api/users/0/collections?limit=1`;
export const ZOTERO_UNAVAILABLE_WARNING = "zotero-pi: Cannot reach the Zotero desktop API. Open Zotero, enable its local API, and retry. If Zotero is already running, check pi-sandbox permissions for localhost:23119. No Zotero action was performed.";

export class ZoteroUnavailableError extends Error {
	constructor() { super(ZOTERO_UNAVAILABLE_WARNING); this.name = "ZoteroUnavailableError"; }
}

export async function requireZotero(fetchImpl = globalThis.fetch, access) {
	access?.domain("127.0.0.1");
	try {
		const response = await fetchImpl(ZOTERO_API_URL, {
			method: "GET",
			headers: { "Zotero-API-Version": "3" }, signal: AbortSignal.timeout(2000), redirect: "error",
		});
		if (!response.ok || !Array.isArray(await response.json())) throw new Error("Invalid Zotero response");
	} catch { throw new ZoteroUnavailableError(); }
}

export class ZoteroAPIError extends Error {
	constructor(status, method, path, detail) {
		super(`zotero-pi: Zotero API ${method} ${path} returned HTTP ${status}${detail ? `: ${detail}` : "."}`);
		this.status = status;
	}
}

export class ZoteroClient {
	constructor(fetchImpl = globalThis.fetch, access) { this.fetch = fetchImpl; this.access = access; }
	async request(path, { signal, timeout = 10000 } = {}) {
		this.access?.domain("127.0.0.1");
		let response;
		try {
			response = await this.fetch(`${ZOTERO_ORIGIN}${path}`, {
				method: "GET", redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout),
				headers: { "Zotero-API-Version": "3" },
			});
		} catch (error) {
			if (signal?.aborted) throw signal.reason;
			throw new ZoteroUnavailableError();
		}
		if (!response.ok) throw new ZoteroAPIError(response.status, "GET", path, (await response.text()).slice(0, 300));
		return response;
	}
	async json(path, options) { return (await this.request(path, options)).json(); }
	async list(path, signal) {
		const result = [];
		for (let start = 0; ; ) {
			const response = await this.request(`${path}${path.includes("?") ? "&" : "?"}limit=100&start=${start}`, { signal });
			const page = await response.json();
			if (!Array.isArray(page)) throw new Error("zotero-pi: Invalid Zotero list response.");
			result.push(...page);
			start += page.length;
			const total = Number(response.headers.get("Total-Results"));
			if (!page.length || (total > 0 ? start >= total : page.length < 100)) return result;
		}
	}
	async library(signal) {
		await requireZotero(this.fetch, this.access);
		const [collections, items] = await Promise.all([
			this.list("/api/users/0/collections", signal), this.list("/api/users/0/items/top", signal),
		]);
		return { collections, items: items.filter(i => !["attachment", "note", "annotation"].includes(i.data.itemType)) };
	}
	children(key, signal) { return this.list(`/api/users/0/items/${encodeURIComponent(key)}/children`, signal); }
	attachments(signal) { return this.list("/api/users/0/items?itemType=attachment", signal); }
	async fileURL(key, signal) {
		return (await (await this.request(`/api/users/0/items/${encodeURIComponent(key)}/file/view/url`, { signal })).text()).trim();
	}
}
