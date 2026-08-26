---
title: 'feat: Publish devcontainer image to GHCR with CI caching'
type: feat
status: active
date: 2026-04-01
origin: .dotfiles/docs/2026-04-01-devcontainer-improvements-requirements.md
deepened: 2026-04-01
---

# feat: Publish devcontainer image to GHCR with CI caching

## Overview

Extend the existing CI workflow to publish a pre-built devcontainer image to GitHub Container Registry on every push to main and on releases. Use the published image as a build cache (`cacheFrom`) for PR builds, eliminating flaky network-dependent installs and the `wretry.action` retry wrapper. Expand the README with usage documentation and architecture overview.

## Problem Frame

The dotfiles devcontainer builds from scratch on every CI run, installing tools (mise, sheldon, keychain, starship) via network requests to external sources. This makes builds slow and flaky — currently requiring a `wretry.action` wrapper with 3 retries. No published image exists for public consumption, and the README's devcontainer section is minimal. (see origin: .dotfiles/docs/2026-04-01-devcontainer-improvements-requirements.md)

## Requirements Trace

- R1. Publish devcontainer image to GHCR on push to main with `latest` tag
- R2. Publish version-tagged images on releases (e.g., `:v1.2.0`)
- R3. Use published image as build cache in CI (`cacheFrom`) for fast PR builds
- R4. Add `packages: write` permission to the workflow
- R5. Expand README devcontainer section with usage, architecture, and image reference docs
- R6. Keep `devcontainer.json` building from features (no changes to source of truth)

## Scope Boundaries

- No Dockerfile — devcontainer.json + features remains the build source
- No multi-platform builds (amd64 only)
- No changes to custom features themselves
- No dual devcontainer.json configs
- No Codespaces prebuilds configuration (see origin)

## Context & Research

### Relevant Code and Patterns

- `.github/workflows/main.yaml` — Current CI workflow. Uses `devcontainers/ci@SHA` wrapped in `Wandalen/wretry.action`. Only runs `devcontainer-info` for validation.
- `.devcontainer/devcontainer.json` — Base image `mcr.microsoft.com/devcontainers/base:2.1.3` with 4 remote + 4 local features. Uses `remoteEnv` for `GH_TOKEN`, `GIT_DIR`, `GIT_WORK_TREE`.
- `.devcontainer/features/` — Custom features: `dotfiles-dev` (bootstrap, depends on common-utils, gh-cli, sheldon, keychain), `mise` (depends on dotfiles-dev), `sheldon`, `keychain`.
- `.github/README.md` — Existing README with minimal "Devcontainer Development" section at lines 215-234.
- `.github/renovate.json5` — Renovate config with `github-actions` manager (via extended config). Already has package rules for `devcontainer` manager. Will automatically manage SHA pin bumps for newly added actions.
- Action SHA pinning convention: `uses: owner/repo@SHA # vX.Y.Z` — Renovate handles version bumps.

### External References

- [`devcontainers/ci` action docs](https://github.com/devcontainers/ci/blob/main/docs/github-action.md) — Supports `imageName`, `imageTag`, `cacheFrom`, `push` (filter/always/never), `eventFilterForPush`, `refFilterForPush`. Automatically places devcontainer metadata on image labels.
- Production examples: [LadybirdBrowser](https://github.com/LadybirdBrowser/ladybird/blob/master/.github/workflows/dev-container.yml), [SerenityOS](https://github.com/SerenityOS/serenity/blob/master/.github/workflows/dev-container.yml), [rails-lambda/crypteia](https://github.com/rails-lambda/crypteia/blob/main/.github/workflows/test.yml) — all use `devcontainers/ci` with GHCR publishing.
- `docker/login-action` — Current stable: v4.0.0 (`@b45d80f862d83dbcd57f89517bcf500b2ab88fb2`).

## Key Technical Decisions

- **Image name: `ghcr.io/marcusrbrown/dotfiles-devcontainer`** — Leading dots in Docker image names are uncommon and can cause tooling issues. This follows the `{owner}/{repo}-devcontainer` convention used by Ladybird and SerenityOS. Rationale: clean, readable, no ambiguity with the `.dotfiles` repo name.

- **Drop `wretry.action` wrapper** — `cacheFrom` uses Docker BuildKit layer caching: when the published image exists, BuildKit pulls cached layers and skips all network-dependent installs (the flaky part). On cache miss (feature changes, first build), `devcontainers/ci` builds from scratch — same as today, but cache misses are rare (~only when features change). The retry wrapper's value was handling network timeouts during installs; with caching, this affects a tiny fraction of builds. The wrapper itself adds complexity: it wraps `devcontainers/ci` via string-encoded `with` block in `Wandalen/wretry.action`, making the step harder to read and maintain. The tradeoff is acceptable — eliminate the indirection.

- **Integrated release publishing via conditional `imageTag`** — Use GitHub Actions expressions to set `imageTag` based on event type: `latest` on push, `{tag},latest` on release. Add `release` to the workflow triggers and `eventFilterForPush`. One workflow instead of two. Verified interactions: the existing `if` condition (`github.event_name != 'pull_request' || ...`) evaluates to `true` on release events (passes through). The existing concurrency group (`${{ github.workflow }}-${{ github.event.number || github.ref }}`) falls back to `github.ref` (the tag ref) on release events, giving releases their own concurrency group — no interference with other builds. `workflow_dispatch` correctly does NOT push (not in eventFilterForPush).

- **`push: filter` with expanded event filter** — Default `eventFilterForPush` is `push` only. Extend to `push,release` so images are pushed on both event types. PR builds (`pull_request` event) won't push — that's the default behavior. Note: a release from a non-main branch would still publish (the `release` trigger doesn't filter by source branch). This is acceptable — releases are intentional and rare.

- **GHCR package visibility requires one-time manual configuration** — GHCR packages default to private. After the first image is published, the repo owner must manually set the package to public in GitHub Settings > Packages. This is a one-time action, not automatable via workflow.

## Open Questions

### Resolved During Planning

- **Image name**: `ghcr.io/marcusrbrown/dotfiles-devcontainer` (see decision above)
- **wretry.action**: Drop it. Cached builds are deterministic; retries add complexity for no benefit.
- **Release publishing approach**: Conditional in `main.yaml`, not a separate workflow. Less carrying cost.
- **SHA pinning**: `docker/login-action@b45d80...` — Renovate will manage bumps automatically.
- **Devcontainer metadata**: `devcontainers/ci` bakes metadata labels into the image. Consumers referencing the image via `"image": "ghcr.io/..."` get the full configuration (features, settings, env vars) without needing to replicate the devcontainer.json.

### Deferred to Implementation

- **Exact `runCmd` after removing wretry.action**: Currently runs `devcontainer-info`. Decision criteria: keep it if it provides actionable debugging info in CI logs (tool versions, feature status); remove if it only confirms the build succeeded (which the push itself proves). Check actual output during implementation.
- **Whether `devcontainer-info` output capture step is still useful**: The current workflow captures and displays `runCmdOutput`. Keep if the output is meaningful for debugging failed builds; drop if it's noise.
- **Verify `eventFilterForPush` accepts `release`**: The devcontainers/ci docs example `eventFilterForPush` with `push` and `pull_request` — confirm `release` is accepted as a valid event name. If not, use `push: always` with a conditional `if` on event type instead.

## Implementation Units

- [ ] **Unit 1: Update CI workflow for GHCR image publishing and caching**

  **Goal:** Modify the existing `main.yaml` to publish devcontainer images to GHCR on push-to-main and releases, and use the published image as a build cache for all builds including PRs.

  **Requirements:** R1, R2, R3, R4

  **Dependencies:** None

  **Files:**
  - Modify: `.github/workflows/main.yaml`

  **Approach:**
  - Add `release: types: [published]` to the `on:` triggers
  - Add `packages: write` to `permissions` at the job level for the `devcontainer-ci` job (keep `contents: read` at workflow level for least privilege)
  - Add a `docker/login-action` step before the devcontainer build step, using the repo's SHA-pinning convention
  - Replace the `Wandalen/wretry.action` wrapper with direct `devcontainers/ci` usage
  - Set `imageName: ghcr.io/marcusrbrown/dotfiles-devcontainer`
  - Set `cacheFrom: ghcr.io/marcusrbrown/dotfiles-devcontainer`
  - Set `imageTag` using a conditional expression: `latest` on push events, `{release_tag},latest` on release events
  - Set `eventFilterForPush: push,release` so images push on both event types but not on PRs
  - Keep `GH_TOKEN` env var — the `dotfiles-dev` feature's `postCreateCommand` uses it for `gh repo clone`
  - Keep the `runCmd: devcontainer-info` for validation (or an equivalent smoke test)
  - Keep the output display step (`Display devcontainer output`)
  - Preserve the existing `concurrency` and `if` (draft PR skip) settings

  **Patterns to follow:**
  - SHA pinning: `uses: owner/repo@SHA # vX.Y.Z` (see `actions/checkout` reference in current workflow)
  - Permissions: job-level `permissions` block (minimal scope)
  - GHCR login pattern from SerenityOS/Ladybird: `docker/login-action` → `devcontainers/ci` with `imageName` + `cacheFrom`

  **Test scenarios:**
  - Push to main: image should be built, pushed to GHCR with `latest` tag, and `devcontainer-info` should run successfully
  - PR (non-draft): image should be built using `cacheFrom` but NOT pushed. `devcontainer-info` should still run.
  - Draft PR: job should be skipped entirely (existing `if` condition)
  - Release event: image should be pushed with version tag AND `latest` tag
  - Release from non-main branch: should still publish (acceptable — releases are intentional)
  - Cold cache (first run or after feature changes): build should complete successfully without cache, publishing the new image for future runs
  - `workflow_dispatch`: should build and run but NOT push (not in eventFilterForPush)
  - Concurrent release + push-to-main: separate concurrency groups — both run, both push `latest`. Last write wins for the tag, which is correct

  **Verification:**
  - Workflow YAML passes `actionlint` or at minimum is valid YAML with correct GitHub Actions syntax
  - After first push to main, `ghcr.io/marcusrbrown/dotfiles-devcontainer:latest` exists and is pullable
  - PR builds show `cacheFrom` being used in the build logs (cache hit)
  - No `wretry.action` reference remains in the workflow
  - `devcontainer.json` is not modified (R6 — remains the source of truth)

- [ ] **Unit 2: Expand README devcontainer section**

  **Goal:** Update the "Devcontainer Development" section of `.github/README.md` with usage documentation for the published image and an architecture overview of the custom features.

  **Requirements:** R5

  **Dependencies:** Unit 1 (references the published image name and CI behavior)

  **Files:**
  - Modify: `.github/README.md`

  **Approach:**
  - Expand the existing "Devcontainer Development" section (currently lines 215-234)
  - Add subsections:
    - **Using the Published Image**: How to reference `ghcr.io/marcusrbrown/dotfiles-devcontainer` in another project's `devcontainer.json` via the `"image"` property. Note that devcontainer metadata is baked into the image label.
    - **Quick Start options**: Codespaces (link to repo), VS Code (reopen in container), CLI (`devcontainer up`)
    - **What's Included**: Tools and runtimes in the image (mise, sheldon, keychain, starship, node, gh CLI, shellcheck). Note the base image and that tool versions are managed by mise.
    - **Feature Architecture**: Brief overview of the 4 custom features and their dependency chain: `common-utils` → `sheldon`, `keychain` → `dotfiles-dev` → `mise`. Explain that `dotfiles-dev` is the bootstrap feature (clones bare repo, sets up git config) and `mise` runs `mise install` post-create.
    - **CI and Image Publishing**: Note that the image is published on every push to main (`latest`) and on releases (version-tagged). PRs use `cacheFrom` for fast builds.
  - Keep the existing "Custom Features" table — expand it rather than replacing
  - Match the README's existing tone and formatting style (concise, practical, code examples)

  **Patterns to follow:**
  - Existing README structure: heading levels, table format, code block style
  - Keep prose concise — the README is already well-structured and not overly verbose

  **Test scenarios:**
  - The `devcontainer.json` example referencing the image should be syntactically valid
  - All links should point to real locations
  - Feature dependency chain description should match the actual `dependsOn` declarations in `devcontainer-feature.json` files

  **Verification:**
  - README renders correctly on GitHub (verify markdown formatting)
  - No broken links or incorrect image references
  - Feature architecture description matches the actual feature dependency declarations

## System-Wide Impact

- **Interaction graph:** The workflow change touches only CI — no runtime code changes. The `postCreateCommand` in features runs inside the devcontainer during CI; this behavior is unchanged.
- **Error propagation:** If GHCR login fails, the `devcontainers/ci` step will fail (can't push). PR builds with `cacheFrom` will fall back to full build if the cached image is unavailable (graceful degradation).
- **State lifecycle risks:** First run after this change will be a cold-cache build (no cached image exists yet). This is expected and will resolve after the first successful push to main.
- **API surface parity:** The published image is a new public artifact. No existing external contracts are affected.
- **Integration coverage:** The workflow should be validated by running it on a test branch or PR before merging to main to catch YAML syntax errors.

## Risks & Dependencies

- **Cold cache on first run**: The first build after this change won't have a cached image. This is a one-time cost.
- **GHCR rate limits**: Public image pulls from GHCR are rate-limited for unauthenticated users. For CI (authenticated via `GITHUB_TOKEN`), this is not a concern.
- **Feature install flakiness without retry**: Dropping `wretry.action` removes the retry safety net. If a feature install fails on a cache-miss build (e.g., mise.run is down), the build fails without retry. Mitigation: `cacheFrom` means the vast majority of builds hit cache and skip network installs entirely. Cache misses only occur when devcontainer features change (~1-2x/month). If flakiness proves worse than expected post-migration, re-adding retry logic is straightforward — but wrap `devcontainers/ci` directly rather than re-introducing the `wretry.action` indirection.
- **Renovate must support new actions**: `docker/login-action` is a standard GitHub Action — Renovate's `github-actions` manager handles it automatically. No config changes needed.

## Post-Implementation Checklist

- [ ] **Set GHCR package visibility to public** — After the first successful image push to GHCR, navigate to the repo's GitHub Settings > Packages > `dotfiles-devcontainer` and change visibility from Private to Public. This is a one-time manual action. Verify with: `docker pull ghcr.io/marcusrbrown/dotfiles-devcontainer:latest` succeeds without authentication.

## Sources & References

- **Origin document:** [.dotfiles/docs/2026-04-01-devcontainer-improvements-requirements.md](.dotfiles/docs/2026-04-01-devcontainer-improvements-requirements.md)
- Related code: `.github/workflows/main.yaml`, `.devcontainer/devcontainer.json`, `.devcontainer/features/*/`
- External docs: [devcontainers/ci GitHub Action](https://github.com/devcontainers/ci/blob/main/docs/github-action.md), [docker/login-action](https://github.com/docker/login-action)
- Reference implementations: [LadybirdBrowser/ladybird](https://github.com/LadybirdBrowser/ladybird/blob/master/.github/workflows/dev-container.yml), [SerenityOS/serenity](https://github.com/SerenityOS/serenity/blob/master/.github/workflows/dev-container.yml)
