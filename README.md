# zotero-pi

[![CI](https://github.com/jake-is-ESD-protected/zotero-pi/actions/workflows/ci.yml/badge.svg)](https://github.com/jake-is-ESD-protected/zotero-pi/actions/workflows/ci.yml)

Browse Zotero from [pi](https://pi.dev), scan collections cheaply, and reuse compact PDF digests as model context.

- **`§` autocomplete:** live collection paths and citekeys, relative to My Library.
- **Collection references:** abstracts + existing cached digests; never generate digests during a scan.
- **Paper references:** create a missing digest once with the current pi model, then reuse it.
- **Read-only Zotero:** no companion plugin, write API, token, or files written beside PDFs.
- **Quiet context:** metadata reaches the model without dumping JSON into the terminal.

## Requirements

- Node.js **22.20+**. CI tests Node 22.20 and 24 on Linux against **pi 1.0.4**.
- Zotero desktop running, with its **local API enabled** on `127.0.0.1:23119`.
- Citation keys exposed as `citationKey` or `Citation Key:` in Extra. Better BibTeX recommended; `.bib` exports not required.
- Poppler's `pdftotext`: `sudo apt install poppler-utils`. Scanned PDFs need OCR first.

Linux is the currently tested platform. macOS/Windows compatibility is not yet verified.

## Install

Install the current `main` branch:

```text
pi install git:github.com/jake-is-ESD-protected/zotero-pi
```

Then `/reload` in pi. Nothing needs installing in Zotero for this extension.

To pin a release, select an **existing** tag from [Releases](https://github.com/jake-is-ESD-protected/zotero-pi/releases), for example:

```text
pi install git:github.com/jake-is-ESD-protected/zotero-pi@v0.3.1
```

Version headings in the changelog are not proof a tag has been published. Untagged `main` installations follow development updates; tagged installations stay pinned.

Update installed packages with `pi update --extensions`, then `/reload`. Updating does not advance a pinned tag: select the newer tagged source explicitly. When moving from a local checkout, remove that local installation first with `pi remove /path/to/zotero-pi` to avoid loading two copies.

## Quick start

1. Open Zotero and enable its local API.
2. In pi, run `/zotero status` to check connectivity and cache location.
3. Type **`§`** to open the scrollable library tree. Type to filter; use pi's completion keys, Tab to complete, Esc to dismiss.

```text
Find papers concerning A, excluding B, in §PhD/topic1/.
Explain the assumptions behind the estimator in §PhD/topic1/entry2020.
```

Collections end in `/`; root is `§/`. Bare citekeys also work, such as `§entry2020`. Autocomplete inserts percent-encoded paths for spaces; labels remain readable. Use the paths actually present in your library—not the example names above.

A collection scan recursively loads abstracts and existing digests only. An explicit paper reference may read its PDF and create a missing digest; generation consumes model tokens and is announced. Cached reads need no PDF lookup/read. Multiple references are supported and overlapping membership is deduplicated.

Your prompt and `@` file paths remain intact. Background metadata is hidden from chat rendering, not from model usage or local session storage. Progress/warnings can precede the displayed prompt because preparation runs in the input hook.

## Cache and digest behavior

Default cache: **`~/.pi/agent/zotero-pi-cache`**. Optional config at **`~/.pi/agent/zotero-pi.json`**:

```json
{
  "cacheDir": "~/.pi/agent/zotero-pi-cache",
  "maxContextChars": 180000
}
```

Each paper is stored under `papers/<Zotero-item-key>/paper-card.md` with `provenance.json`. The stable item key survives citekey renames. PDF directories are read-only; writes stay inside the cache.

Digests use dense technical bullets while retaining equations (`$$`), units, assumptions, qualifiers, evidence, caveats, and page/section hints. They are **lossy model-generated summaries**, not substitutes for checking the paper. Missing details must not be invented.

Existing digests are reused across model changes. Use explicit re-digestion to replace one; personal notes are preserved. Old citekey-based caches remain readable without automatic regeneration. [Architecture and migration details](docs/architecture.md).

## Commands

```text
/zotero status
/zotero read <citekey-or-path>
/zotero scan <collection-path/>
/zotero redigest <citekey-or-path>
/zotero reread <citekey-or-path>        # alias for redigest
/zotero inspect <citekey-or-path>
/zotero note <citekey-or-path> <text>   # local timestamped note
/zotero like <query>                  # Crossref suggestions only
/zotero help
```

`redigest` refuses collections. Missing paper abstracts are reported, not fabricated. Non-paper items use available metadata or explicitly requested link information rather than requiring an abstract. [Full behavior and limitations](docs/architecture.md).

## With pi-sandbox

Grant **literal directory paths, without `*`**, covering all nested contents. Typical persistent grants:

```text
/sandbox-allow domain 127.0.0.1
/sandbox-allow read /absolute/path/to/PDF-directory
/sandbox-allow write /home/you/.pi/agent/zotero-pi-cache
```

Choose **project** or **all projects**. Cache write access also grants reads. PDF directories need **no write access**. This extension cannot inspect pi-sandbox's private session-only grants; saved rules are required. Explicit denies still win. [Sandbox and troubleshooting](docs/troubleshooting.md).

## Development and releases

- [Contributing and local checks](CONTRIBUTING.md)
- [Versioning, annotated tags, and release workflow](docs/releases.md)
- [Changelog](CHANGELOG.md)

Git distribution only for now; npm publication is disabled. CI tests the source tree and the extracted distribution without contacting your Zotero library or paying for model calls.

## License

[GNU General Public License, version 3](LICENSE) (`GPL-3.0-only`). The license already present on the remote is retained verbatim. Distributed without warranty; see LICENSE.
