---
date: 2026-04-01
topic: devcontainer-improvements
---

# Devcontainer CI, Image Publishing, and Documentation

## Problem Frame

The dotfiles devcontainer builds from scratch on every CI run — installing mise, sheldon, keychain, and starship via network requests to external sources. This makes builds slow and flaky (currently wrapped in `wretry.action` with 3 retries). There's no published image for public consumption, and the README's devcontainer section is minimal despite the setup being sophisticated enough to serve as a reference architecture.

## Requirements

- R1. **Publish devcontainer image to GHCR on push to main.** Extend the existing `main.yaml` workflow to build and push the devcontainer image to `ghcr.io` with a `latest` tag on every push to the `main` branch. Use `devcontainers/ci` with `imageName`, `cacheFrom`, and appropriate `push` settings.

- R2. **Publish version-tagged images on releases.** When a GitHub release is created (tagged), publish the devcontainer image with the release version as the image tag (e.g., `:v1.2.0`).

- R3. **Use published image as build cache in CI.** PR builds should use `cacheFrom` pointing to the published image for fast, deterministic builds without pushing a new image. This should eliminate or reduce the need for the `wretry.action` retry wrapper.

- R4. **Add `packages: write` permission to the workflow.** GHCR publishing requires write access to GitHub Packages. Add this to the job-level permissions.

- R5. **Expand the README devcontainer section.** Update `.github/README.md` to cover:
  - How to use the published GHCR image (referencing it in another devcontainer.json, pulling it directly)
  - How to open the dotfiles in Codespaces or VS Code devcontainers
  - Brief architecture overview of the custom features and their dependency chain
  - What's included in the image (tools, shell setup, versions)

- R6. **Keep `devcontainer.json` building from features.** The devcontainer.json should remain the source of truth — building from the base image + features. The published GHCR image is a cache artifact and a reusable image for consumers, not a replacement for the feature-based build.

## Success Criteria

- CI builds on PRs complete significantly faster than today (cacheFrom hits)
- Pushes to main publish a working image to `ghcr.io/marcusrbrown/.dotfiles/devcontainer:latest` (or equivalent)
- Tagged releases publish a version-tagged image
- A user can reference the published image in their own devcontainer.json and get a working environment
- The README devcontainer section is sufficient for someone to both use the setup and understand the architecture

## Scope Boundaries

- No Dockerfile — continue using devcontainer.json + features as the build source
- No multi-platform builds (amd64 only, matching GitHub Actions runners)
- No changes to the custom features themselves
- No dual devcontainer.json configs — the existing config remains the single source of truth
- No Codespaces prebuilds configuration (separate concern)

## Key Decisions

- **Approach A (Integrated Pipeline)**: Extend `main.yaml` rather than creating separate publish workflows. Simpler, less carrying cost.
- **Image consumers**: Public — anyone can pull and use the image. Docs should serve both "try my dotfiles" and "learn from the architecture" audiences.
- **Docs location**: Expand the existing "Devcontainer Development" section in `.github/README.md`.
- **devcontainer.json stays unchanged**: No chicken-and-egg problems. The published image is a downstream artifact.

## Dependencies / Assumptions

- `docker/login-action` (or equivalent) is available and compatible with SHA-pinned action references (per repo conventions)
- GHCR image visibility can be set to public (may require one-time manual configuration in GitHub package settings)
- The existing `devcontainers/ci` action supports `imageName` + `cacheFrom` in the `wretry.action` wrapper's `with` block, or the wrapper is removed/replaced

## Outstanding Questions

### Deferred to Planning

- [Affects R1][Technical] Exact image name — `ghcr.io/marcusrbrown/.dotfiles/devcontainer` vs `ghcr.io/marcusrbrown/dotfiles-devcontainer` or another convention
- [Affects R1, R3][Technical] Whether to keep `wretry.action` as a safety net alongside `cacheFrom`, or drop it entirely now that cached builds should be deterministic
- [Affects R2][Technical] Whether release-triggered publishing should be a conditional in `main.yaml` or a separate lightweight workflow
- [Affects R1][Technical] SHA pinning for newly added actions (`docker/login-action`) — find the correct SHA for the latest stable version
- [Affects R5][Needs research] What the devcontainer metadata label contains after publishing — this determines what documentation to write about referencing the image

## Next Steps

→ `/ce:plan` for structured implementation planning
