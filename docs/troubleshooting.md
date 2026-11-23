# Troubleshooting and sandbox permissions

## Zotero API unavailable

Zotero desktop must be running with its local API enabled on `127.0.0.1:23119`, including cached reads. There is no offline BibTeX fallback. The two-second availability check uses this fixed warning:

> zotero-pi: Cannot reach the Zotero desktop API. Open Zotero, enable its local API, and retry. If Zotero is already running, check pi-sandbox permissions for localhost:23119. No Zotero action was performed.

This does not distinguish a closed application, disabled API, firewall, or sandbox restriction. Inspect those conditions rather than assuming which one occurred. `/zotero status` shows connectivity and cache configuration; `/zotero help` stays available offline.

## Directory permission, including nested contents

Use **literal paths without `*`**. Linux's bash sandbox cannot enforce glob write rules. For example:

```text
/sandbox-allow domain 127.0.0.1
/sandbox-allow read /absolute/path/to/PDF-directory
/sandbox-allow write /home/you/.pi/agent/zotero-pi-cache
```

Choose **project** or **all projects** to persist the grant. Write access also grants reads. A directory rule covers nested contents. Remove obsolete `directory/*` rules from the relevant global/project sandbox config; adding a literal path does not remove the old glob warning.

Cache writes need permission for the entire configured cache directory: cards, provenance, temporary files, locks, and optional link snapshots. PDF directories need read permission only. No bridge-token access or Zotero write permission is used.

Global sandbox configuration normally lives at `~/.pi/agent/sandbox.json` (pi-sandbox respects `PI_CODING_AGENT_DIR`); project rules live at `.pi/sandbox.json` and apply only to trusted projects. Explicit write/domain deny rules take precedence. Restart affected sessions after manual policy edits. Existing grants are not automatically revoked; remove old broad PDF/token write grants if no other tools need them.

## Sandbox precedence

zotero-pi does not duplicate pi-sandbox's policy engine and does not emit its own sandbox-approval warnings when the sandbox is disabled. When pi-sandbox is enabled, it remains the runtime authority; when disabled (`--no-sandbox`, saved `enabled: false`, Alt+S, or `/sandbox-disable`), zotero-pi does not depend on it. pi-sandbox exposes no extension API for its runtime toggle or session-only grants, so zotero-pi never tries to inspect or override them.

## Digest unavailable during a collection scan

The scan continues with metadata/abstracts and reports the missing/blocked digest. It does not create a digest, read a PDF, or fetch a link to compensate. Grant read access to the configured cache directory if needed. A permission warning does not establish that the digest file is absent.

## PDF extraction fails

Install Poppler and check that the attachment is downloaded locally, readable, and has a text layer. OCR scanned documents in another tool first. Text extraction cannot reliably recover every equation or layout; generated summaries can therefore omit/misread details. Do not assume successful extraction proves scientific accuracy.

## Undefined-path errors after upgrading

Older versions used native `.mjs` helpers that Node could retain across pi `/reload`. Restart pi once after upgrading to the reload-safe `.ts` helpers. The installed-SDK regression tests this case. Cache deletion is not necessary. Error stack information is retained in local custom-message details for diagnosis; avoid publicly sharing entire session logs, which may contain research data.

## Duplicate command registration or unexpected repeated loading

Run `pi list` and remove an old local installation before installing the Git source. Local paths and Git sources are different package identities; both can otherwise load. Do not remove unrelated pi packages or edit all settings blindly.

## Context, page, or output limits exceeded

`maxContextChars` bounds the submitted reference payload; use a smaller subcollection or adjust it for the model. `maxPdfPages` and `maxSourceChars` bound PDF analysis (`0` = unlimited); capped digests are marked partial. If a digest model returns `length`, the error now reports analyzed pages, source chars, chunks, and level, and saves nothing. Increase the model output budget, choose `digestLevel: "heavy"` only if that model benefits, or lower the source caps.

## Old plugin or cache migrations

There is no current Zotero companion plugin. If an old installation reports a bridge endpoint/404, update the pi package and restart pi. Remove the obsolete companion plugin through Zotero's Plugins UI if installed. Existing sidecars, notes, tokens, and caches are not automatically deleted. See [migration details](architecture.md#migration-and-compatibility).

## Reporting a bug

Include Node/pi/Zotero versions, package version/tag, exact command/reference shape, sanitized error, whether sandboxing is enabled, and whether the digest was cached. Do not attach your entire bibliography, papers, session transcripts, credentials, or permission files without reviewing/redacting them.
