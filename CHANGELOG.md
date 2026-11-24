# Changelog

Versions follow [Semantic Versioning](https://semver.org/). Published tags use `vMAJOR.MINOR.PATCH`; prereleases may use suffixes such as `-rc.1`. Until a tag is pushed, a version heading describes prepared changes, not a published release.

## [Unreleased]

## [0.4.1]

### Fixed

- Added `digestTimeoutMs` (default 600000) and pass it as both provider `timeoutMs` and an abort deadline; timeout errors now name the configured limit.
- Digest chunk/output budgets increased (normal: 16k-char chunks with 12k output budget; heavy: 24k chunks with 20k), and per-call output is clamped to the selected model's `maxTokens`. A 5-page paper no longer hits `length` merely because a 24k-char chunk was capped at 6k output tokens.
- Nested digest calls no longer send `reasoning_effort=none` to reasoning models that reject it (e.g. some Mistral models). If the session level is `off` and the model marks `off` unsupported, the digest call uses the lowest supported level.
- Personal notes are now inserted deterministically as a local-only section, so models cannot make an otherwise valid digest fail by omitting the intentionally empty heading.

### Changed

- Digestion now uses rolling batch-merge: source chunks are grouped into batches, each batch is appended/merged into the running digest, and no single model call receives the whole extracted document. Progress reports merged batches and chunk ranges.


## [0.4.0]

### Added

- Global and trusted-project configuration at `~/.pi/agent/zotero-pi.json` and `.pi/zotero-pi.json`; project scalars override global values.
- Digest controls: `digestLevel` (`none`, `normal`, `heavy`), `maxPdfPages`, and `maxSourceChars`; `0` means unlimited.
- Explicit progress showing source pages, analyzed page range, character count, chunk count, level, and model before/while digesting.
- Partial digests are visibly labeled and recorded as partial coverage in provenance when configured caps truncate a source.
- `digestLevel: "none"` disables digest creation and rewrites a `§paper` reference to an ordinary `@PDF` file reference.

### Fixed

- `stopped with length` digest failures now include analyzed pages/chars/chunks and remediation instead of only “incomplete response”.
- zotero-pi no longer duplicates pi-sandbox policy checks or emits sandbox-approval warnings when the sandbox is disabled; pi-sandbox remains the runtime authority when enabled.

### Changed

- Default bounded digestion profile: normal level, max 160 PDF pages and 480,000 source characters unless configured otherwise.


## [0.3.1]

### Added

- Live `§` completion for Zotero collection paths and citekeys.
- Read-only collection scans using abstracts and existing digests.
- Automatic, compact LLM digests for explicitly referenced papers, stored in an independent cache.
- Explicit re-digestion, local personal notes, provenance, and v0.1 cache compatibility.
- Hidden reference context, keeping metadata dumps out of the terminal.
- Regression tests for sandbox policy, cache safety, extraction, and pi integration.
- Git-based distribution, package-content checks, CI, and validated annotated release tags.

### Fixed

- Reloads retaining stale native ESM helpers and producing undefined-path errors. Internal runtime helpers use reloadable TypeScript modules.

### Changed

- Zotero and PDF access are read-only; generated files live only in `cacheDir`.
- Removed the experimental companion plugin, attachment registration, and token dependency.

### License

- Retained the remote repository's existing GNU GPL version 3 license verbatim; package metadata identifies GPL-3.0-only.
