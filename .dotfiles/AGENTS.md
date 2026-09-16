# AGENTS.md

Agent guidance for this dotfiles repository. See `README.md` for the human-facing
setup guide; this file covers only what an agent is likely to get wrong.

## Repository model

This is a **bare** repository: `GIT_DIR=~/.dotfiles`, `GIT_WORK_TREE=~`. Tracked
files live throughout `$HOME`, not under `.dotfiles/`.

Two consequences that cause most agent mistakes:

- **The project root and the work tree differ.** Sessions usually start in
  `.dotfiles/`, but tracked paths are `$HOME`-relative. `.config/mise/config.toml`
  means `~/.config/mise/config.toml`, not `~/.dotfiles/.config/...`. Resolve the
  work tree before reading or searching, and prefer absolute paths for a first
  inspection.
- **`.dotfiles/` itself holds git metadata** plus a handful of tracked files
  (`ignore`, `README.md`, `AGENTS.md`, `.gitconfig`, prettier config, `docs/`,
  and the type-checking manifest). Everything else there is git internals.

## Git operations

Always pass the location explicitly:

```sh
git --git-dir=$HOME/.dotfiles --work-tree=$HOME <subcommand>
```

**Never `export GIT_DIR`/`GIT_WORK_TREE`.** Agent shells commonly persist between
calls, so an export leaks into every later command and hijacks git for unrelated
repositories. When experimenting in a scratch repo, prefix with
`env -u GIT_DIR -u GIT_WORK_TREE` — a leaked export can let `git init`/`git config`
in a temp directory silently mutate this repo's real config.

The `.dotfiles` shell alias in `README.md` is for interactive use; it does not
exist in a non-interactive agent shell.

`status.showUntrackedFiles=no` is set, so `git status` hides untracked files. Use
`--untracked-files=all` when that matters.

## The allowlist (`.dotfiles/ignore`)

`core.excludesFile` points here. The file ignores everything (`/*`) and re-includes
tracked paths with `!` negations. Adding a tracked file usually means adding a
negation. Four non-obvious failure modes:

1. **A leading space makes a negation literal, and therefore dead.**
   ` !/.editorconfig` matches nothing. Such lines can sit unnoticed for a long time
   because gitignore does not apply to already-tracked paths — the index protects
   the file, not the allowlist. The damage appears only if the file is ever
   untracked, at which point it cannot be re-added.
2. **`git check-ignore` consults the index by default** and reports "not ignored"
   for any tracked path regardless of the rules, hiding the bug above. Always pass
   `--no-index`, and probe with a path that does not yet exist:
   ```sh
   git --git-dir=$HOME/.dotfiles --work-tree=$HOME \
     check-ignore --no-index -v .config/some/new-file
   ```
3. **Un-ignoring a directory opens its entire subtree.** The correct idiom is three
   lines — un-ignore, re-ignore contents, then allowlist the intended extensions:
   ```gitignore
   !/dir/
   /dir/*
   !/dir/*.ext
   ```
4. **A per-directory `.gitignore` beats the excludesfile.** For example
   `.config/opencode/.gitignore` ignores `package.json`, `bun.lock`, and
   `node_modules` throughout that subtree, so files there can never be tracked no
   matter what negations are added here.

The file is deliberately **not** named `.gitignore`: that name inside `.dotfiles/`
would also be read as an ordinary per-directory ignore file, re-anchoring `/*` and
breaking every negation.

`mise run ignore:audit` guards all of this — it asserts every tracked path is
re-addable and flags leading-whitespace negations by line. It runs in CI.

## Untracking deletes files from `$HOME`

`git rm --cached <file>` leaves the working file intact **only while you stay on
that branch**. Switching back to `main` and fast-forwarding through the untracking
commit deletes it from `$HOME`: checkout restores the still-tracked copy, then the
merge applies the deletion.

Because the work tree is `$HOME`, this applies to real, live configuration. Copy
the file somewhere safe before checking out or merging a branch that untracks it,
and verify it still exists afterward.

## Branches, CI, and PRs

Branch protection uses **strict status checks plus required linear history**, so a
branch built on a stale `main` can never merge. `main` moves frequently. Always:

```sh
git --git-dir=$HOME/.dotfiles --work-tree=$HOME fetch origin main
# create or rebase the branch on origin/main, then commit and push
```

This applies to follow-up commits on an existing PR branch too, not just branch
creation. `gh pr update-branch <N>` is recovery for an already-pushed stale branch,
not the normal flow.

Required checks: `Devcontainer CI`, `Fro Bot`, `Install mise`, `Renovate / Renovate`,
`Script Tests`. `Script Tests` is an **aggregator** over an OS matrix — the matrix
legs report per-leg names, so the aggregator job is what satisfies branch
protection. Do not rename it or split it into a separate job.

Waiting on CI: use a blocking watcher, never a sleep loop.

```sh
gh pr checks <N> --watch --fail-fast
```

The workflow sets `cancel-in-progress: true` per PR, so pushing a new commit
cancels the previous run. A cancelled run shows as a failure — check whether it was
simply superseded before investigating.

Never enable auto-merge.

## Commands

```sh
mise run format          # prettier over .devcontainer, .dotfiles, .github
mise run format-check    # prettier --check over the same paths
mise run install         # install mise-managed tools
mise run typecheck       # type-check both Bun script projects
mise run ignore:audit    # assert the allowlist has no dead negations
mise run claude:settings # merge the tracked Claude settings template into the local file
mise run opencode:doctor # inspect OpenCode config and metadata
```

`mise run typecheck` and `mise run format`/`format-check` need a one-time
`bun install --cwd ~/.dotfiles`.

Mise tasks are **file-based shebang scripts** under `.config/mise/tasks/`,
auto-discovered. Subdirectories map to `:` (`mise/tools/install` →
`mise:tools:install`). Do not use `task_config.includes` — it does not expand `~`,
`$HOME`, or template variables, and silently ignores relative paths in global
config.

## Scripts and tests

Bun + TypeScript utilities live under the **owning tool's** config directory:
`.config/opencode/scripts/` for OpenCode tooling, `.claude/scripts/` for Claude
tooling. Do not mix them.

Each script has a `<name>.test.ts` beside it. Run one suite from its own directory:

```sh
cd ~/.config/opencode/scripts && bun test ignore-audit.test.ts
```

Do not pipe test or build output through `tail`/`grep`/`head` — truncation hides
failures and defeats runner summaries.

Type-checking notes:

- The pinned toolchain (`typescript`, `@types/bun`, `@opencode-ai/sdk`) lives in
  `.dotfiles/package.json`, not beside the scripts, because of the nested
  `.gitignore` described above. Both `tsconfig.json` files reach it via a
  config-relative `typeRoots`.
- **Verifying from a different working directory does not prove CI-cleanliness.**
  Module resolution walks up from the _file's_ directory, so an unrelated
  `node_modules` higher in `$HOME` can satisfy an import that will be missing on a
  fresh checkout. Only an environment without that ambient copy exposes it.
- CI runs the type-check on a single matrix leg; it is platform-independent.

Scripts that expose a CLI should guard `main()` with `if (import.meta.main)`,
otherwise importing the module from its test file executes the whole CLI.

For read-only SQLite access with `bun:sqlite`, open the plain path with
`{ readonly: true }`. A `file:...?mode=ro` URI works on macOS but fails on Linux,
which shows up as CI-only breakage.

## Machine-local vs. tracked

Some tools rewrite their own config, so the real file cannot be tracked. The
pattern is a tracked template plus a merge task — see `.claude/settings.template.json`
and `mise run claude:settings`, whose merge preserves target-only keys precisely so
machine-local state survives a sync.

Machine-specific values belong in `*.local` files (for example `~/.zshrc.local`),
which are ignored. Never commit credentials, tokens, private keys, or paths
containing a username.

`gitleaks` runs as a pre-commit hook via `core.hooksPath`; the global
`~/.config/git/ignore` catches credential-shaped filenames across every repo on the
machine, but **not** this one, since the bare repo overrides `core.excludesFile`.
This repo relies on its allowlist plus gitleaks instead.

## Devcontainer

Features live in `.devcontainer/features/`. Two verified traps:

- Do **not** export `GIT_DIR`/`GIT_WORK_TREE` via `remoteEnv`. It also applies to
  `postCreateCommand`, and the exported `GIT_DIR` hijacks mise's internal git calls
  during tool installation.
- Feature `install.sh` scripts must `set -eo pipefail`, not just `set -e`. With a
  versioned-URL installer, a 404 makes `curl -f` emit nothing, `sh` runs an empty
  script and exits 0, and the build reports success with the tool missing.

## Where knowledge lives

- `.dotfiles/docs/solutions/` — post-mortems with YAML frontmatter (`module`,
  `tags`, `problem_type`). **Search these before debugging anything in a documented
  area**; they record root causes that are expensive to rediscover.
- `.dotfiles/docs/runbooks/` — operational procedures.
- `.dotfiles/docs/plans/`, `.dotfiles/docs/brainstorms/` — implementation plans and
  requirements.
- `.config/opencode/AGENTS.md` is **not** structural documentation; it is a
  collaboration prompt. Do not repurpose it for repository facts.

Renovate keeps dependencies current. Its `_VERSION` custom manager needs a
`# renovate: datasource=... packageName=...` marker on the line **above** the
assignment _and_ the file listed in `managerFilePatterns` — a marker alone is
decorative.
