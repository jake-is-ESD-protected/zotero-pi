# Architecture and behavior

## Data flow

```text
Zotero local API (GET only) → live collection/item index → § autocomplete

Submitted §collection/ → metadata + abstracts + existing caches → hidden model context
Submitted §paper       → metadata + abstract + cached digest    → hidden model context
                                               ↓ cache miss only
                                      local PDF → pdftotext
                                               → bounded model summaries
                                               → compact digest + provenance in cache
```

Zotero remains the metadata source of truth. No embedding database, persistent library index, PDF download, Zotero database modification, or companion plugin is needed.

## Library picker

The tree is fetched on demand; nothing is preloaded at session start. In-flight lookups may be shared, but resolved snapshots are not held as a persistent index. Collection hierarchy and API order are preserved. The API does not expose the desktop application's configurable item-table sort order.

Paths are relative to My Library. Collections have a trailing slash; `§/` is the root. Reserved characters/spaces are percent-encoded on insertion and decoded in labels. Multiple memberships appear at each location, with per-prompt deduplication. Unfiled entries appear at the root. Missing citekeys and ambiguous exact paths are reported rather than guessed.

The provider stacks on pi's existing editor/completion system. Other providers, `@` files, and slash commands remain intact. References in inline/fenced code are not activated.

## Submitted references

Collection scans recurse through descendants and read abstracts/existing digests only: no attachment lookup, PDF read/extraction, model-based digest generation, external link fetching, or cache write. Missing/unreadable digests fall back to abstracts with warnings. A missing abstract on a paper-like item is explicit missing data, not evidence that the paper is irrelevant.

A direct paper reference reads the existing digest first. Cache hits require no attachment lookup/PDF access. Missing digests resolve the item's preferred PDF attachment, or the first available PDF. Progress states total pages, configured caps, analyzed page range, source characters, chunk count, digest level, and model. `maxPdfPages`/`maxSourceChars` bound the source; capped runs are explicitly marked partial in chat and provenance rather than silently treated as complete. `digestLevel=none` skips this path and rewrites the item reference to an ordinary `@PDF` file reference. Scanned PDFs require an existing OCR text layer. Large intermediate notes are reduced hierarchically to bound individual requests; output-limit failures report the analyzed coverage and save nothing.

Generation uses the current pi model and its provider authentication. Nested calls consume tokens; model identity and usage are recorded in the session. They have no tools and are instructed to treat paper text as untrusted data. Raw PDF text stays outside the main conversation.

An explicitly referenced item also included in a collection is digested only because of the direct reference. Multiple refs in one prompt are supported. Loading failures stop an item request rather than producing an ungrounded answer. Preparation runs in the input hook, so progress/warnings may appear before pi displays the original prompt.

Reference context is a hidden custom message. UI hiding does not remove it from provider context, token usage, or session storage. `/zotero inspect` is an explicit cache preview. No guarantee is made that summaries faithfully capture every scientific detail; ask for the source passage when necessary.

## Paper versus non-paper items

Paper types requiring an abstract for digestion: `journalArticle`, `conferencePaper`, `preprint`, `thesis`, `report`, `manuscript`.

Other types—software/repositories, webpages, books, datasets, etc.—use a cached digest or descriptive metadata. If insufficient, a direct reference may fetch initial HTTP(S) page information and cache it under `links/<item-key>.json`. pi-sandbox remains the runtime authority for network/filesystem policy; zotero-pi does not issue its own sandbox-approval warnings. Fetches are bounded and partial extracts are labeled; no authenticated browser, JavaScript renderer, SSO/2FA, or paywall bypass is provided. Collection scans never fetch links.

## Cache and compact format

```text
<cacheDir>/papers/<item-key>/paper-card.md
<cacheDir>/papers/<item-key>/provenance.json
<cacheDir>/links/<item-key>.json
```

Digests target LLM reference memory: dense labeled bullets, no narrative filler, defined technical terms/symbols, display-math equations, units, assumptions, conditions, page/section hints, evidence, uncertainty, and limitations. The approximate 1000–2000-token target is advisory; essential detail takes precedence. Current format: `zotero-pi-digest-v3-compact`.

Required sections: Abstract; Research question; Method; Symbols and equations; Key findings and evidence; Limitations; Personal notes. Older compatible prose digests are not rewritten automatically.

Provenance records item/citekey, source PDF path/attachment/hash, model, creation time, format, and digest hash. Source hashes are checked across generation to reject a changing PDF. Completed caches are reused until explicit re-digestion, even if the model changes. Users must re-digest intentionally after source revisions.

Writes use atomic replacement and per-card lock files. Concurrent work on a locked card fails explicitly. A process crash can leave a stale `.lock`; remove it only after verifying that no session is working on that digest. Card/provenance files are individually atomic, not a multi-file database transaction.

Personal notes are timestamped local cache notes. Re-digestion preserves them, including edits made while generation is in flight. No note-deletion command exists; edit the cached section manually.

## Migration and compatibility

v0.1 citekey caches at `papers/<citekey>/paper-card.md` remain readable without writes or model calls. Re-digestion writes the stable item-key location and preserves notes, leaving the original file intact. Old bibliography/collection-export configuration is ignored; live API access is mandatory.

Experimental PDF-adjacent sidecars are not probed automatically. To reuse one, copy its Markdown to the item-key cache path shown by `/zotero inspect`; retain the Abstract and Personal notes headings. No cache, sidecar, Zotero note, or token file is deleted automatically. If installed, the obsolete companion plugin can be uninstalled in Zotero; its old token may be removed manually if unused.

Runtime helpers use `.ts` so pi reloads the whole dependency graph. Older native `.mjs` helpers could survive `/reload` and mix incompatible path shapes. Restart pi once when migrating from those versions; do not delete digest caches to resolve that loader issue.

## Module boundaries

- `index.ts`: pi lifecycle, commands, model adapter, hidden context delivery.
- `api.ts`: mandatory local API availability and GET-only requests/pagination.
- `library.ts`, `autocomplete.ts`: pure hierarchy/path handling and editor integration.
- `workflow.ts`: direct-item versus collection orchestration and bounded non-paper link fetches.
- `digest.ts`: cache compatibility, generation, provenance, local notes, and re-digestion.
- `config.ts`: global + trusted-project settings, validation, and defaults.
- `storage.ts`: stable cache paths, attachment resolution, atomic files, locks, hashing.

See [troubleshooting](troubleshooting.md) for operational constraints and [contributing](../CONTRIBUTING.md) for tests.
