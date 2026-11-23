import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTree, collectionItems, completionToken, referencesIn, resolveReference, suggestions } from "../extensions/zotero/library.ts";
import { libraryAutocomplete } from "../extensions/zotero/autocomplete.ts";

export function fixture() {
	return {
		collections: [
			{ key: "PHD00001", data: { name: "PhD", parentCollection: false } },
			{ key: "TOPIC001", data: { name: "topic1", parentCollection: "PHD00001" } },
			{ key: "CHILD001", data: { name: "Space / ü", parentCollection: "TOPIC001" } },
		],
		items: [
			{ key: "PAPER001", data: { itemType: "journalArticle", citationKey: "entry2020", title: "A, not B", abstractNote: "Studies A, not B.", collections: ["TOPIC001"], creators: [] } },
			{ key: "PAPER002", data: { itemType: "preprint", citationKey: "entry2021", title: "B", abstractNote: "Studies B.", collections: ["CHILD001", "TOPIC001"] } },
			{ key: "REPO0001", data: { itemType: "computerProgram", citationKey: "repo", title: "Code", url: "https://example.org/repo", collections: [] } },
		],
	};
}

test("tree is hierarchical, ordered, complete immediately and includes unfiled items", () => {
	const tree = buildTree(fixture());
	assert.deepEqual(tree.rows.map(r => r.path), ["/", "PhD/", "PhD/topic1/", "PhD/topic1/entry2020", "PhD/topic1/entry2021", "PhD/topic1/Space%20%2F%20%C3%BC/", "PhD/topic1/Space%20%2F%20%C3%BC/entry2021", "repo"]);
	assert.equal(suggestions(tree, "").length, tree.rows.length);
	assert.equal(suggestions(tree, "Space / ü").length, 2);
});
test("resolve paths, bare citekeys, prose punctuation and explicit collection slash", () => {
	const tree = buildTree(fixture());
	assert.equal(resolveReference(tree, "PhD/topic1/entry2020.").key, "PAPER001");
	assert.equal(resolveReference(tree, "§entry2020").key, "PAPER001");
	assert.equal(resolveReference(tree, "PhD/topic1/").kind, "collection");
	assert.throws(() => resolveReference(tree, "PhD/topic1"), /Unknown reference/);
	assert.throws(() => resolveReference(tree, "missing"), /Unknown reference/);
});
test("recursive collection items deduplicate membership", () => {
	const tree = buildTree(fixture());
	assert.equal(collectionItems(tree, "TOPIC001").length, 2);
	assert.equal(collectionItems(tree, null).length, 3);
});
test("spaces, slash and punctuation in names round-trip without ambiguity", () => {
	const data = fixture(); data.items[0].data.citationKey = "some/key(2020)";
	const tree = buildTree(data);
	assert.equal(resolveReference(tree, "PhD/topic1/some%2Fkey%282020%29").key, "PAPER001");
});
test("duplicate paths fail rather than choosing an arbitrary entry", () => {
	const data = fixture(); data.items[1].data.citationKey = "entry2020";
	assert.throws(() => resolveReference(buildTree(data), "PhD/topic1/entry2020"), /Ambiguous/);
});
test("missing citekeys are surfaced, not fabricated", () => {
	const data = fixture(); delete data.items[0].data.citationKey;
	assert.equal(buildTree(data).missingKeys.length, 1);
});
test("reference parsing ignores code examples and deduplicates multiple refs", () => {
	assert.deepEqual(referencesIn("Compare §entry2020 with §PhD/topic1/ and §entry2020. `§ignored`\n```\n§alsoIgnored\n```"), ["entry2020", "PhD/topic1/", "entry2020."]);
	assert.equal(completionToken("Explain §"), "");
	assert.equal(completionToken("Explain §PhD/topic1"), "PhD/topic1");
	assert.equal(completionToken("email@example.org"), undefined);
});
test("autocomplete registers §, loads only on demand and preserves other providers", async () => {
	let loads = 0, delegates = 0;
	const current = { triggerCharacters: ["@"], getSuggestions: async () => { delegates++; return null; }, applyCompletion: (...args) => args, shouldTriggerFileCompletion: () => false };
	const provider = libraryAutocomplete(current, async () => { loads++; return buildTree(fixture()); }, () => {});
	const options = { signal: new AbortController().signal };
	assert.equal(loads, 0);
	assert.deepEqual(provider.triggerCharacters, ["@", "§"]);
	await provider.getSuggestions(["@file"], 0, 5, options);
	assert.equal(delegates, 1); assert.equal(loads, 0);
	const results = await provider.getSuggestions(["§"], 0, 1, options);
	assert.equal(results.items.length, buildTree(fixture()).rows.length);
	assert.equal(results.prefix, "§"); assert.equal(loads, 1);
	await provider.getSuggestions(["§PhD"], 0, 4, options);
	assert.equal(loads, 2, "each new settled request is live, not a session cache");
});
test("§ completion replaces only the token and spaces items, not collections", () => {
	const provider = libraryAutocomplete({ applyCompletion: () => "delegated", shouldTriggerFileCompletion: () => false }, async () => buildTree(fixture()), () => {});
	const line = "Compare §pa with X";
	const item = provider.applyCompletion([line], 0, 11, { value: "§PhD/topic1/entry2020" }, "§pa");
	assert.equal(item.lines[0], "Compare §PhD/topic1/entry2020 with X");
	const collection = provider.applyCompletion(["§Ph"], 0, 3, { value: "§PhD/" }, "§Ph");
	assert.equal(collection.lines[0], "§PhD/");
	assert.equal(provider.shouldTriggerFileCompletion(["§"], 0, 1), true);
	assert.equal(provider.shouldTriggerFileCompletion(["@"], 0, 1), false);
	assert.equal(provider.applyCompletion(["@"], 0, 1, {}, "@"), "delegated");
});
test("autocomplete errors are bounded and aborted results are discarded", async () => {
	let warnings = 0;
	const provider = libraryAutocomplete({ getSuggestions: async () => null }, async () => { throw new Error("unavailable"); }, () => warnings++);
	const options = { signal: new AbortController().signal };
	await provider.getSuggestions(["§"], 0, 1, options);
	await provider.getSuggestions(["§x"], 0, 2, options);
	assert.equal(warnings, 1);
	const aborted = new AbortController(); aborted.abort();
	assert.equal(await provider.getSuggestions(["§"], 0, 1, { signal: aborted.signal }), null);
});
