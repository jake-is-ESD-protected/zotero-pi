import { completionToken, suggestions } from "./library.ts";

// Share only an in-flight lookup, never preload or retain a stale library snapshot.
export function libraryAutocomplete(current, loadTree, warn) {
	let pending, warningShown = false;
	return {
		triggerCharacters: [...new Set([...(current.triggerCharacters ?? []), "§"])],
		async getSuggestions(lines, line, column, options) {
			const query = completionToken((lines[line] ?? "").slice(0, column));
			if (query === undefined) {
				warningShown = false;
				return current.getSuggestions(lines, line, column, options);
			}
			try {
				if (!pending) {
					pending = loadTree();
					const work = pending;
					work.finally(() => { if (pending === work) pending = undefined; }).catch(() => {});
				}
				const tree = await pending;
				if (options.signal.aborted) return null;
				warningShown = false;
				if (tree.missingKeys.length && !query) warn(`zotero-pi: ${tree.missingKeys.length} item(s) have no citekey; assign Citation Keys in Zotero/Better BibTeX to include them.`);
				return { items: suggestions(tree, query), prefix: `§${query}` };
			} catch (error) {
				if (!options.signal.aborted && !warningShown) { warn(error.message); warningShown = true; }
				return null;
			}
		},
		applyCompletion(lines, line, column, item, prefix) {
			if (!prefix.startsWith("§")) return current.applyCompletion(lines, line, column, item, prefix);
			const original = lines[line] ?? "";
			const before = original.slice(0, column - prefix.length), after = original.slice(column);
			const suffix = item.value.endsWith("/") || /^\s/.test(after) ? "" : " ";
			const updated = [...lines]; updated[line] = before + item.value + suffix + after;
			return { lines: updated, cursorLine: line, cursorCol: before.length + item.value.length + suffix.length };
		},
		shouldTriggerFileCompletion(lines, line, column) {
			if (completionToken((lines[line] ?? "").slice(0, column)) !== undefined) return true;
			return current.shouldTriggerFileCompletion?.(lines, line, column) ?? true;
		},
	};
}
