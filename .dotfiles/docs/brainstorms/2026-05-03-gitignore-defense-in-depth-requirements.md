# `.gitignore` Defense-in-Depth — Requirements

**Date:** 2026-05-03
**Status:** Requirements captured, ready for planning
**Origin:** `@council` recommendation on `.gitignore` allowlist friction (3-councillor consensus, 2/3 quorum)

## Problem

The dotfiles repo (single-user, bare git, `GIT_WORK_TREE=$HOME`) uses a strict allowlist `.gitignore` — `/*` ignores everything, then explicit `!/path/to/file` un-ignores tracked files. Every new AI tool creates allowlist friction, and as more tools accumulate (`.claude/`, `.config/opencode/`, `.agents/`, future `.codex/`), the risk of accidentally tracking credentials, session state, or telemetry grows. The allowlist alone is the only defense — there is no name-based safety net for credential-shaped filenames and no by-content credential scanning.

## Goals

1. **Add a name-based safety net** — re-ignore patterns at the bottom of `.dotfiles/.gitignore` that catch credential-shaped names regardless of where they appear in the tree (last-match-wins semantics).
2. **Add by-content credential scanning** — `gitleaks` installed via mise, wired as a local pre-commit hook that blocks any commit containing detected secrets.
3. **Document the convention** — short addition to `~/AGENTS.md` explaining the layered defense (allowlist + safety net + scanner) so future tools and agents understand the model.
4. **All four layers ship in a single PR** — safety net + mise install + pre-commit hook + AGENTS.md update.

## Non-Goals

1. **No restructure of the existing allowlist.** The repo is already mostly conformant to the council's "scoped bulk-allowlist for content subdirs, file-level for tool roots" principle. Adding the safety net is purely additive defense-in-depth, not a refactor.
2. **No CI gitleaks integration.** Local pre-commit hook only. CI integration is explicitly deferred to a future PR if needed.

## Success Criteria

- Re-ignore safety net committed at the bottom of `.dotfiles/.gitignore`; verified with `git check-ignore -v` against test paths
- `gitleaks` installed via mise (`~/.config/mise/config.toml`); `gitleaks version` resolves on shell reload
- Pre-commit hook (`~/.dotfiles/hooks/pre-commit`) blocks commits containing a known-fake secret pattern; `git commit --no-verify` bypasses it as expected
- `~/AGENTS.md` updated with a compact rule + safety net rationale under the existing CONVENTIONS section
- Manually tested end-to-end: stage a file with a fake secret → commit blocked → bypass works → commit clean diff

## Layer Specifications

### Layer 1 — Re-ignore Safety Net

Append to the bottom of `.dotfiles/.gitignore` (after all `!/path` allowlist rules so last-match-wins applies the re-ignore):

```gitignore
# Defense-in-depth: re-ignore credential-shaped filenames anywhere in the tree.
# These patterns run AFTER the allowlist negations above, so they catch files
# inside re-included directories regardless of bulk-allowlist scope.

# Env files
**/.env
**/.env.*

# Auth/credential by name
**/*secret*
**/*token*
**/*credential*
**/*password*
**/auth.json

# Common key file extensions
**/*.pem
**/*.key
**/*.p12
**/*.pfx
**/id_rsa
**/id_rsa.*
**/id_ed25519
**/id_ed25519.*

# AI tool session/log/transcript dirs
**/sessions/
**/transcripts/
**/history.jsonl
```

**Verification:**
- `git check-ignore -v` against `.config/opencode/.env` returns the safety-net pattern as the matching rule
- Existing tracked files (none currently match these patterns; `git ls-files | grep` confirmed empty before merge) remain unaffected

### Layer 2 — gitleaks via mise

Add to `~/.config/mise/config.toml` under `[tools]`:

```toml
"ubi:gitleaks/gitleaks" = "latest"
```

(or pinned version if other mise tools follow that convention — verify during planning)

**Verification:**
- `mise install` succeeds
- `gitleaks version` resolves after shell reload
- `gitleaks detect --source $HOME --no-git` runs against the working tree (smoke test, not a hard gate)

### Layer 3 — Pre-commit Hook

Create `~/.dotfiles/hooks/pre-commit`:

```bash
#!/usr/bin/env bash
# Block commits containing detected secrets.
# Bypass with `git commit --no-verify` when needed.
set -euo pipefail
exec gitleaks protect --staged --redact --verbose
```

Hook installation is **manual** — matches the existing dotfiles convention of declarative tools without auto-bootstrap. Document the install step in `AGENTS.md`:

```bash
chmod +x ~/.dotfiles/hooks/pre-commit
git --git-dir=$HOME/.dotfiles config core.hooksPath $HOME/.dotfiles/hooks
```

**Policy:**
- Block on any finding
- `git commit --no-verify` bypasses (standard escape hatch)
- No `.gitleaks.toml` allowlist file (defer until first false positive)

**Verification:**
- Stage a file containing `AKIA[A-Z0-9]{16}`-shaped fake AWS key → commit aborts with gitleaks output
- `git commit --no-verify` succeeds against the same staged file
- Stage a clean diff → commit succeeds normally

### Layer 4 — AGENTS.md Convention

Add a compact subsection under the existing `Allowlist .gitignore Pattern` block in `~/AGENTS.md`:

```markdown
### Defense-in-Depth Layers

The allowlist is the primary defense, but two backstops catch what slips through:

1. **Name-based safety net** — Re-ignore block at the bottom of `.dotfiles/.gitignore`
   catches credential-shaped names (`*.env`, `*secret*`, `*.pem`, session dirs, etc.)
   regardless of where they appear. Last-match-wins gitignore semantics.
2. **By-content scanning** — `gitleaks` runs as a local pre-commit hook
   (`~/.dotfiles/hooks/pre-commit`). Blocks commits with detected secrets.
   Bypass with `git commit --no-verify` for known false positives.

When adding a new AI tool: extend the allowlist for the tool's content dirs,
trust the safety net to catch credential-shaped files, run `gitleaks detect`
once on first commit to verify nothing leaked.
```

## Open Questions for Planning

1. **mise version pinning** — does `~/.config/mise/config.toml` use `latest` or pinned semver for the existing AI/CLI tools? Match that convention.
2. **Hook installation idempotency** — is there a one-shot install command worth scripting, or is the manual `chmod` + `core.hooksPath` setup acceptable as a one-time-per-machine task?
3. **Does any currently tracked file match the safety net patterns?** Pre-merge audit: `git ls-files | grep -iE '\.env|secret|token|credential|password|\.pem|\.key|id_rsa|id_ed25519|sessions/|transcripts/|history\.jsonl'`. Expected: zero matches. If any match, decide per-file whether to delete-from-tracking, rename, or carve out an exception in the safety net.

## Risks and Mitigations

| Risk                                                 | Mitigation                                                                                                                          |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Safety net blocks a legitimate config file           | Audit `git ls-files` against the patterns before merge (open question 3). Carve out exceptions only with documented justification.  |
| `gitleaks protect --staged` is slow on large diffs    | Acceptable — local-only, runs on commit not push. If it becomes a problem, switch to `--max-target-megabytes` or scope to changed files. |
| Pre-commit hook bypassed and forgotten               | `gitleaks detect` available manually for periodic audits. CI integration deferred but available as a future safety upgrade.         |
| Hook installation missed on a new machine            | Document the install command in `AGENTS.md`. Optionally add a `mise run security:setup` task in a future iteration.                  |
| AGENTS.md drift relative to actual `.gitignore` state  | Fro Bot's daily AGENTS.md drift check catches this. Same mechanism that caught the lockfile-path drift on PR #1553.                  |

## Out of Scope (Explicit)

- Restructuring the existing root `.gitignore` allowlist (already mostly conformant to council's principle)
- CI gitleaks integration (local hook only)
- Per-tool-dir `.gitignore` standardization (only `.config/opencode/.gitignore` exists today; adding more is a separate decision)
- gitleaks configuration tuning (`.gitleaks.toml`, custom rules) — defer until first false positive
- Automated hook installation via dotfiles bootstrap

## References

- Council session: 2/3 quorum (alpha + beta), 4th-option proposal that beat both A (status quo) and B (bulk-allowlist tool roots)
- PR #1440 — removed dead `.claude/skills/` allowlist entry (precedent for allowlist hygiene)
- PR #1553 — pinned `oh-my-opencode-slim`, raised the `@latest` drift NBC pattern
- Existing per-dir `.gitignore`: `~/.config/opencode/.gitignore` (precedent for the delegation model)

---

**Next step:** `ce:plan` against this document to produce the implementation plan.
