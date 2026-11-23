# Changelog

Versions follow [Semantic Versioning](https://semver.org/). Published tags use `vMAJOR.MINOR.PATCH`; prereleases may use suffixes such as `-rc.1`. Until a tag is pushed, a version heading describes prepared changes, not a published release.

## [Unreleased]

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
