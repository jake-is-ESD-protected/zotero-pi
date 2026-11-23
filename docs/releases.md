# Versions, tags, and releases

## Policy

- [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`; prereleases such as `0.4.0-rc.1` are supported. Build metadata (`+...`) is intentionally not used in release versions.
- Git tags are **annotated**, named exactly `v<package.json version>`.
- Tags are immutable. Never move, force-push, or reuse a published tag; fix mistakes with another version.
- Release commits must already be merged into `main`. The tag helper requires clean local `main` to equal fetched `origin/main`.
- Version must have a nonempty matching `## [VERSION]` section in `CHANGELOG.md`.
- Only actual remote tags/releases are published versions. Prepared changelog entries are not releases.
- No floating `v0`/`latest` tags and no npm publishing. `private: true` prevents accidental npm publication, not Git installation.

Before 1.0, use a **minor** bump for breaking behavior/config/cache changes and a patch bump for compatible fixes. Reserve 1.0 for a deliberately supported stable interface. Describe migration steps for breaking changes.

## Prepare a release PR

```bash
git switch main
git pull --ff-only
git switch -c release/0.3.2
npm version 0.3.2 --no-git-tag-version --ignore-scripts
```

Move relevant Unreleased notes into a `## [0.3.2]` changelog section, and commit `package.json`, `package-lock.json`, changelog, and any migration docs together. `npm version --no-git-tag-version` does not create a Git commit/tag.

Run:

```bash
npm ci --ignore-scripts --legacy-peer-deps
npm test
npm run test:pi
npm run release:check
npm run check:package
npm run test:package
```

Open a PR and merge only after CI passes. Keep the installed-pi version pin explicit in CI; adapter tests use SDK internals, so test before updating that pin. Dependabot maintains pinned GitHub Action revisions, not the SDK compatibility policy.

For the first release, the prepared version is **0.3.1**; no version bump is needed if that is still the intended first tag. Merge the packaging PR first. This guide does not imply that tag already exists.

## Tag synchronized main

```bash
git switch main
git pull --ff-only
npm run release:check
npm run release:tag -- --dry-run
npm run release:tag -- --push
```

The helper:

1. Validates package version and changelog.
2. Refuses dirty working trees and non-`main` branches.
3. Fetches `origin/main` and tags; refuses divergence or an existing tag.
4. Creates an annotated tag.
5. With `--push`, pushes **only that tag**, never unrelated branches/tags.

Without `--push`, the tag is local only and the script prints the explicit push command. A failed push leaves the local tag intact; retry the printed push command rather than deleting/recreating the tag. `--dry-run` fetches refs and validates conditions but creates/pushes nothing.

## GitHub automation

`.github/workflows/ci.yml` runs on PRs and pushes to `main`. It tests Node 22.20 and 24 on Linux with pi 1.0.4, unit/safety tests, adapter/reload tests, release metadata, distribution contents, and isolated packed installs.

`.github/workflows/release.yml` runs on pushed `v*` tags:

1. Check exact version/changelog match, annotated tag type, tagged checkout, and `main` ancestry.
2. Run the full reusable CI matrix on that exact tag.
3. Create the GitHub release with matching changelog notes and the allowlisted `zotero-pi-VERSION.tgz` source package.
4. Mark versions with a prerelease suffix as GitHub prereleases. Existing releases are preserved on workflow retries, not silently overwritten.

No npm token, model key, Zotero access, SSH deployment key, or extra release PAT is needed in CI. Publishing uses GitHub's built-in token with `contents: write` only in the publication job. Verification jobs have read-only repository permissions and checkout does not persist credentials.

Maintainers should enable a GitHub tag ruleset restricting creation/update/deletion of `v*` tags to release maintainers, plus main-branch PR/check requirements. Scripts/workflows validate releases but cannot prevent someone with repository administrator rights from bypassing GitHub settings. No repository protection settings are changed automatically.

## Install and update channels

Development/main:

```text
pi install git:github.com/jake-is-ESD-protected/zotero-pi
pi update --extensions
```

A specific published tag:

```text
pi install git:github.com/jake-is-ESD-protected/zotero-pi@v0.3.1
```

Pi does not move pinned tag installations when updates run. To adopt a different tag, remove the old pinned source with `pi remove <old-source>` and install the new one. `/reload` after changing the installation; restart once if migrating from old native-ESM helper versions.
