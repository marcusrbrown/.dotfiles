---
title: Devcontainer CI broke because remoteEnv exported GIT_DIR into every container process
date: 2026-09-03
category: integration-issues
module: devcontainer
problem_type: integration_issue
component: development_workflow
symptoms:
  - "Devcontainer CI failed 8 consecutive runs, blocking every open PR on a required, admin-enforced check"
  - "mise install: Failed to resolve tool version list for python"
  - "python-build --definitions: No such file or directory (os error 2)"
  - "pipx:poetry@2.4.2: Skipped due to failed dependency"
root_cause: config_error
resolution_type: config_change
severity: high
related_components:
  - tooling
  - documentation
tags:
  - devcontainer
  - mise
  - pyenv
  - git-dir
  - ci
  - version-pinning
  - renovate
---

# Devcontainer CI broke because remoteEnv exported GIT_DIR into every container process

## Problem

`Devcontainer CI` failed on 8 consecutive runs between 2026-09-01 and 2026-09-03, blocking every open PR — it is a required check with `enforce_admins: true`. The container never finished starting: `mise install`, declared as the mise feature's `postCreateCommand`, failed while resolving python's version list.

No repository change caused it. A dependency release exposed a defect that had been latent in `.devcontainer/devcontainer.json` for as long as that file exported git's environment overrides.

## Symptoms

```text
mise WARN  Failed to resolve tool version list for python: [~/.config/mise/config.toml] python@3.14.7:
  failed to execute command: /home/vscode/.cache/mise/python/pyenv/plugins/python-build/bin/python-build
  --definitions: No such file or directory (os error 2)
mise ERROR Failed to install tools: core:python@3.14.7, pipx:poetry@2.4.2
pipx:poetry@2.4.2: Skipped due to failed dependency
mise ERROR Version: 2026.9.1 linux-x64 (2026-09-02)
postCreateCommand from Feature './features/mise' failed with exit code 1.
##[error]Dev container up failed: Command failed: /bin/sh -c mise install
```

The diagnostic detail is what is **absent**. Python produced no progress lines at all while 26 other tools installed successfully. It failed during *version-list resolution*, so it never entered the install pipeline and never attempted the precompiled download that normally satisfies it.

Onset was sharp: last passing run 2026-09-01T12:35, first failure 12:37.

## What Didn't Work

Every hypothesis below was tested against the published image
(`ghcr.io/marcusrbrown/dotfiles-devcontainer:latest`, `--platform linux/amd64`) and disproven. They are listed because each one looked plausible from the log alone.

1. **"mise 2026.9.x is simply broken."** The same version installed python from a precompiled build in a clean container. Separately, mise 2026.9.0 on a GitHub-hosted runner with a cache miss installed precompiled cpython with zero pyenv involvement — so the version is not sufficient to cause the failure.
2. **"GitHub API rate limiting broke the precompiled index lookup."** Attractive because it explains why CI fails while a laptop succeeds, and why the token-provisioned `Install mise` job still passed. Disproven: running with a deliberately invalid `GITHUB_TOKEN` still installed python precompiled, and the CI log contains no 403, 429, or rate-limit error anywhere.
3. **"It only fails as the `vscode` user."** Reproduced the success as `vscode` in the real image.
4. **"`~/.cache` is root-owned so the pyenv clone can't be written."** `vscode` owns its home, the write succeeds, and `git` is present at `/usr/local/bin/git`.
5. **"The `pipx`/`poetry` chain drags python down."** A minimal config with `pipx` and `pipx:poetry` installed cleanly.
6. **"Something in the full tool config triggers it."** The complete 48-line `~/.config/mise/config.toml` installed cleanly in the real image.
7. **"`cacheFrom` baked a partial pyenv checkout into the image."** The published image contains no `~/.cache/mise/python/pyenv` and no pre-installed tools — `mise install` runs at container start, not build.
8. **"A repository change introduced it."** Nothing under `.devcontainer/` or the mise config changed after 2026-08-28, and the base image is pinned at `mcr.microsoft.com/devcontainers/base:2.1.9`.

One misread is worth recording because it nearly anchored the investigation on a false timeline: an early grep appeared to show the last passing run using mise `2026.8.25`. That string was `pbs-installer==2026.8.25`, a pipx dependency. The container's mise version on the passing run was never recoverable from the log, and treating the grep hit as fact would have produced a confident, wrong answer.

## Solution

Remove the global git overrides from `.devcontainer/devcontainer.json`:

```diff
+    // GIT_DIR/GIT_WORK_TREE are deliberately not set here: exporting them globally
+    // hijacks every git invocation in the container, including ones tools make
+    // internally. Use the `.dotfiles` alias, which scopes them per command.
     "remoteEnv": {
-        "GH_TOKEN": "${localEnv:GH_TOKEN}",
-        "GIT_DIR": "${containerWorkspaceFolder}/.dotfiles",
-        "GIT_WORK_TREE": "${containerWorkspaceFolder}"
+        "GH_TOKEN": "${localEnv:GH_TOKEN}"
     },
```

The dotfiles clone is unaffected. `.devcontainer/features/dotfiles-dev/install.sh` generates a `post-create.sh` that sets both variables itself with `${GIT_DIR:-$HOME/.dotfiles}` / `${GIT_WORK_TREE:-$HOME}` defaults and exports them **process-locally**. Each `postCreateCommand` runs as its own `/bin/sh -c`, so that export never reaches `mise install`.

Pin the mise install so a release cannot change container behavior unannounced:

```diff
 MISE_INSTALL_PATH=/usr/local/bin/mise
-curl https://mise.run | MISE_INSTALL_PATH="$MISE_INSTALL_PATH" sh
+# renovate: datasource=github-releases packageName=jdx/mise
+MISE_VERSION=2026.9.0
+curl https://mise.run | MISE_INSTALL_PATH="$MISE_INSTALL_PATH" MISE_VERSION="$MISE_VERSION" sh
```

The pin is 2026.9.0 — the release that exposed the bug — not an older one: 2026.9.x behaves correctly once `GIT_DIR` is gone, so pinning backward would mask the cause behind a stale toolchain.

A `# renovate:` comment alone does not make a version managed. The `_VERSION` custom manager in `.github/renovate.json5` scanned only `mise.toml` and `.mise/config.toml`, so nothing watched the new pin and it would have drifted from the copy in `.github/workflows/main.yaml`. Its `managerFilePatterns` was extended to cover the feature install script, and the marker moved above the assignment to match the manager's match string.

## Why This Works

`remoteEnv` applies to every remote process, including `postCreateCommand`. mise 2026.9.x resolves python's version list by cloning pyenv and running `python-build --definitions`. With `GIT_DIR` exported, mise's internal `git` invocations were redirected at the dotfiles bare repo instead of creating a normal checkout, so the pyenv tree never landed at the expected path and mise executed a binary that did not exist.

The bug was latent because nothing in the container had previously made mise shell out to `git`. mise only began requiring pyenv for python version resolution in 2026.9.0, released 2026-09-01. The devcontainer installed mise unpinned via `curl https://mise.run | sh`, so the container adopted the new behavior the day it shipped, with no commit to correlate it against.

`MISE_VERSION` in `.github/workflows/main.yaml` pins only the separate `Install mise` job, which uses `jdx/mise-action`. It never applied to the devcontainer, which is why that job kept passing while the container broke.

Proof was a single-variable flip in the published image, holding mise version, image, user, and config constant:

| `GIT_DIR` | result |
|---|---|
| exported as `remoteEnv` did | `fatal: not a git repository` ×3, then `python-build --definitions failed` |
| unset | `Python 3.14.7 ✓ installed` from `cpython-3.14.7+20260901-x86_64-unknown-linux-gnu` |

## Prevention

**Never export `GIT_DIR`/`GIT_WORK_TREE` process-wide.** Anything that shells out to `git` internally — a package manager, build tool, or language version manager — inherits them silently. Bare-repo dotfiles setups are unusually exposed because the pattern *requires* those variables, which makes exporting them look like the natural implementation.

```bash
# Scope per command
git --git-dir="$HOME/.dotfiles" --work-tree="$HOME" status

# Or per-invocation via the alias, which does not export
alias .dotfiles='GIT_DIR=$HOME/.dotfiles GIT_WORK_TREE=$HOME'

# Neutralize inheritance in scratch experiments
env -u GIT_DIR -u GIT_WORK_TREE git init /tmp/scratch
```

**Diagnose this class with a single-variable flip.** Run the same command twice in the same container, changing only the environment:

```bash
env -u GIT_DIR -u GIT_WORK_TREE mise install
GIT_DIR=/home/vscode/.dotfiles GIT_WORK_TREE=/home/vscode mise install
```

If only the second fails, it is a process-wide git-env leak, not a defect in the tool being blamed.

**Pin anything installed by `curl | sh`.** An unpinned installer means the environment changes on the upstream project's release schedule rather than on a reviewed commit. The failure surfaces as a repository regression with no corresponding repository change, which is expensive to diagnose.

**Verify that a version marker is actually managed.** After adding a `# renovate:` comment, confirm a manager's file pattern covers the file — Renovate's log reports which files each manager matched:

```text
DEBUG: Matched 2 file(s) for manager regex: .config/mise/config.toml, .devcontainer/features/mise/install.sh
```

An unmatched marker is worse than no marker: it looks managed during review while drifting in practice.

## Related Issues

- [PR #2488](https://github.com/marcusrbrown/.dotfiles/pull/2488) — the fix
- `docs/solutions/2026-08-25-bun-sqlite-readonly-opencode-ci-failures.md` — also a defect that reproduced only on CI and not locally, found by isolating the environment difference rather than by reading the error
