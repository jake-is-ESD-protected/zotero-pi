// Pure path/index functions: no I/O and no content loading.
export function encodeSegment(text) {
	return encodeURIComponent(text).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}
export function citekey(item) {
	return item.data.citationKey || item.data.extra?.match(/^Citation Key:\s*(.+)$/mi)?.[1]?.trim();
}
export function buildTree({ collections, items }) {
	const byKey = new Map(collections.map(c => [c.key, c]));
	const paths = new Map();
	function pathFor(key, seen = new Set()) {
		if (paths.has(key)) return paths.get(key);
		if (seen.has(key)) throw new Error("zotero-pi: Cyclic Zotero collection hierarchy.");
		const collection = byKey.get(key);
		if (!collection) throw new Error(`zotero-pi: Missing parent collection ${key}. Retry the live lookup.`);
		seen.add(key);
		const path = `${collection.data.parentCollection ? pathFor(collection.data.parentCollection, seen) : ""}${encodeSegment(collection.data.name)}/`;
		paths.set(key, path);
		return path;
	}
	for (const c of collections) pathFor(c.key);
	const rows = [{ kind: "collection", path: "/", key: null, label: "My Library/" }];
	const regular = items.filter(i => citekey(i));
	const missingKeys = items.filter(i => !citekey(i));
	const visiting = new Set();
	function visit(parent) {
		if (visiting.has(parent)) throw new Error("zotero-pi: Cyclic Zotero collection hierarchy.");
		visiting.add(parent);
		// Retain API order, grouping each collection with its descendants.
		for (const c of collections.filter(c => (c.data.parentCollection || null) === parent)) {
			const path = paths.get(c.key);
			rows.push({ kind: "collection", path, key: c.key, label: decodeURIComponent(path) });
			for (const item of regular.filter(i => (i.data.collections ?? []).includes(c.key))) {
				rows.push({ kind: "item", path: path + encodeSegment(citekey(item)), key: item.key, item });
			}
			visit(c.key);
		}
		visiting.delete(parent);
	}
	visit(null);
	for (const item of regular.filter(i => !(i.data.collections ?? []).length)) {
		rows.push({ kind: "item", path: encodeSegment(citekey(item)), key: item.key, item });
	}
	return { rows, paths, collections, items: regular, missingKeys };
}

export function resolveReference(tree, reference) {
	let value = reference.replace(/^§/, "");
	const find = v => tree.rows.filter(r => r.path === v);
	let found = find(value);
	// Allow punctuation after a reference in prose, but prefer an exact match.
	if (!found.length) { value = value.replace(/[.,;:!?\])}]+$/, ""); found = find(value); }
	if (!found.length && !value.endsWith("/")) {
		let decoded;
		try { decoded = decodeURIComponent(value); } catch { throw new Error(`zotero-pi: Invalid reference encoding: §${value}`); }
		const items = tree.items.filter(i => citekey(i) === decoded);
		found = items.map(item => ({ kind: "item", key: item.key, item, path: value }));
	}
	if (found.length > 1) throw new Error(`zotero-pi: Ambiguous reference §${value}. Use a unique Zotero collection path or rename duplicate collections/citekeys.`);
	if (!found.length) throw new Error(`zotero-pi: Unknown reference §${value}. Select a live entry with § autocomplete; collection paths end in /.`);
	return found[0];
}

export function collectionItems(tree, key) {
	if (key === null) return tree.items;
	const keys = new Set([key]);
	let changed = true;
	while (changed) {
		changed = false;
		for (const c of tree.collections) if (keys.has(c.data.parentCollection) && !keys.has(c.key)) { keys.add(c.key); changed = true; }
	}
	return tree.items.filter(i => (i.data.collections ?? []).some(k => keys.has(k)));
}

export function referencesIn(text) {
	// Documentation/code examples are not reference requests.
	const prose = text.replace(/```[\s\S]*?```|`[^`\n]*`/g, "");
	return [...new Set(Array.from(prose.matchAll(/(?:^|[\s(\[{])§([^\s§]+)/g), m => m[1]))];
}
export function completionToken(text) { return text.match(/(?:^|[\s(\[{])§([^\s§]*)$/)?.[1]; }
export function suggestions(tree, query) {
	const q = query.toLowerCase();
	return tree.rows.filter(r => {
		let readable; try { readable = decodeURIComponent(r.path); } catch { readable = r.path; }
		return !q || r.path.toLowerCase().includes(q) || readable.toLowerCase().includes(q);
	}).map(r => ({ value: `§${r.path}`, label: `§${r.label ?? decodeURIComponent(r.path)}`, description: r.kind === "collection" ? "collection · abstracts + existing digests only" : r.item.data.title }));
}
