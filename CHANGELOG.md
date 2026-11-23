# Changelog

Versions follow [Semantic Versioning](https://semver.org/). Published tags use `vMAJOR.MINOR.PATCH`; prereleases may use suffixes such as `-rc.1`. Until a tag is pushed, a version heading describes prepared changes, not a published release.

## [Unreleased]

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
