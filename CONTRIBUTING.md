# Contributing

Changes are distributed under the repository's existing [GNU GPL version 3](LICENSE). Do not replace or relicense the license file as part of routine packaging changes.

## Development environment

Linux, Node >= 22.20, Git, npm, and Poppler (`pdftotext`) are required for the complete suite. CI currently tests Node 22.20/24 with pi **1.0.4**. No runtime dependencies are bundled; pi supplies the SDK peer dependency.

```bash
git clone git@github.com:jake-is-ESD-protected/zotero-pi.git
cd zotero-pi
npm ci --ignore-scripts --legacy-peer-deps
npm test
npm run release:check
npm run check:package
```

`--legacy-peer-deps` deliberately avoids installing a second copy of the host SDK into this project. Use the lockfile consistently. Unit tests need no model credentials or running Zotero. Poppler-backed tests are skipped if Poppler is unavailable; CI installs it and runs the full suite.

If pi is already installed on PATH:

```bash
npm run test:pi
npm run test:package
```

Alternatively install an isolated test host, without replacing your normal pi:

```bash
npm install --prefix /tmp/zotero-pi-host --no-save --no-package-lock @earendil-works/pi-coding-agent@1.0.4
export PI_PACKAGE_ROOT=/tmp/zotero-pi-host/node_modules/@earendil-works/pi-coding-agent
npm run test:pi
npm run test:package
```

The adapter uses temporary HOME/PDF/cache directories, mock Zotero/model I/O, the actual installed pi loader/model converter/terminal renderer, and real PDF extraction. The package test builds a tarball, verifies its allowlisted contents, extracts it, and loads the extension from that isolated distribution. Neither test modifies your actual Zotero library or pays for model calls. Release-script tests use temporary local Git repositories, not this project's remote.

## Change workflow

1. Branch from current `main`.
2. Add a failing regression test for behavior changes/bugs where practical.
3. Make the smallest focused change; update affected docs.
4. Run the checks above. Keep source helpers as `.ts` so SDK reloads invalidate the complete graph.
5. Inspect `git diff` and `npm run check:package` for private data.
6. Push the branch, open a pull request, and wait for CI before merging.

Use descriptive commits and PRs. Do not force-push shared `main` or move release tags. Branch protection is a GitHub repository setting; maintainers should require the CI matrix before merging.

## Privacy and scope

- `.pi/` settings/permissions, credentials, PDFs, `.bib` exports, caches, digests, and personal paths do not belong in commits.
- Generate fixtures in temporary directories. Use synthetic abstracts and PDFs, never private papers or credentials.
- Zotero/PDF access must remain read-only. Do not restore the experimental companion plugin or silently widen sandbox access.
- Collection scans never create digests, look up/read PDFs, fetch links, or write cache files.
- Preserve the user's prompt; do not expose raw reference metadata in terminal rendering.
- Tests must not trigger actual model calls or require a real Zotero installation.
- A green Linux matrix is not proof of macOS/Windows compatibility. Add coverage before claiming another platform or pi version.

## Releases

Follow [the release guide](docs/releases.md). Prepare version/changelog/lockfile changes in a PR, merge it, then create an annotated tag from clean, synchronized `main`. Tag publication triggers validation and the full CI matrix before a GitHub release is created. npm publication remains intentionally disabled.
