# DOTFILES KNOWLEDGE BASE

**Generated:** 2026-05-23
**Commit:** ed15ddc
**Branch:** main

## OVERVIEW

Bare git dotfiles repo. `GIT_DIR=~/.dotfiles`, `GIT_WORK_TREE=~/`. 195 tracked files spanning shell init, dev tooling, AI agent configs, devcontainer setup, CI, and project documentation (plans, brainstorms, solutions, runbooks). Sync across machines via allowlist `.gitignore`.

## GIT OPERATIONS

**CRITICAL**: All git commands MUST use the dotfiles environment:

```bash
# Define alias (already in .config/bash/aliases)
alias .dotfiles='GIT_DIR=$HOME/.dotfiles GIT_WORK_TREE=$HOME'

# Usage
.dotfiles git status
.dotfiles git add .bashrc
.dotfiles git commit -m "message"
```

Or export env vars:
```bash
export GIT_DIR=$HOME/.dotfiles GIT_WORK_TREE=$HOME
git status  # now works on dotfiles
```

## STRUCTURE

```
~/
├── .bashrc              # → sources .config/bash/main
├── .zshenv              # → sets ZDOTDIR, sources .config/zsh/.zshenv
├── .profile             # Login entry; sources .config/bash/exports
├── AGENTS.md            # This file
├── Brewfile             # macOS Homebrew + mas + casks source of truth
├── .config/             # XDG_CONFIG_HOME — most config lives here
│   ├── bash/            # Bash entry, init.d/ load order, local.d/ overrides
│   ├── zsh/             # Zsh + sheldon plugin manager
│   ├── git/             # Global git config (GPG, rebase defaults)
│   ├── mise/            # Tool versions + tasks (.config/mise/tasks/)
│   ├── sheldon/         # Zsh plugin manifest
│   ├── opencode/        # OpenCode AI (own AGENTS.md = system prompt, not structural)
│   ├── starship.toml    # Prompt
│   └── ghostty/, bat/, gh/, ... # Other tool configs
├── .agents/             # Global AI-skill bus (cross-platform)
│   └── skills/          # Loadable by Claude Code, OpenCode, etc.
├── .claude/             # Claude Code: agents/, rules/, commands/, settings.json
├── .devcontainer/       # Devcontainer + custom features (dotfiles-dev, mise, sheldon, keychain)
├── .dotfiles/           # Bare repo metadata (.gitignore allowlist, .gitconfig)
│   └── docs/            # Project docs: brainstorms/, plans/, runbooks/, solutions/
├── .github/             # CI workflows + settings.yml (branch protection)
├── .ssh/                # SSH config only (no credentials)
├── .vim/, .vimrc        # vim config
├── .vscode/             # VS Code settings + spellright dictionary
└── Library/LaunchAgents/ # macOS launchd plists (only dev.mrbro.environment.plist tracked)
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add tracked file | Test with `git add -n` first | Only update `.dotfiles/.gitignore` allowlist if blocked |
| Shell aliases | `.config/bash/aliases` | `.dotfiles` alias defined here |
| Environment vars | `.config/bash/exports` | Sourced by both bash and zsh |
| Tool-specific init | `.config/bash/init.d/` | Numbered prefix = load order; `d`-prefix = disabled (e.g., `dnvm.bash`) |
| Machine-local overrides | `.config/bash/local.d/` | Gitignored; sourced last by main |
| Zsh plugins | `.config/sheldon/plugins.toml` | sheldon is the active plugin manager |
| Prompt | `.config/starship.toml` | Starship; installed via devcontainer feature |
| Git settings | `.config/git/config` | GPG signing on, rebase defaults, autoStash |
| Mise tool versions | `.config/mise/config.toml` | Node, Python, Rust, etc. — `nvm` is disabled |
| Mise tasks | `.config/mise/tasks/` | File-based shebang scripts; subdirs map to `:` (e.g. `mise/tools/install` -> `mise:tools:install`); auto-discovered, no `task_config.includes` needed |
| Project docs | `.dotfiles/docs/` | `brainstorms/` (requirements), `plans/` (implementation plans), `runbooks/` (operational procedures), `solutions/` (compound knowledge captures) |
| OpenCode scripts | `.config/opencode/scripts/` | Bun + TypeScript utilities. `opencode-doctor.ts` (config diagnostic), `ollama-distill.ts` (local session distillation pipeline) |
| Brewfile | `Brewfile` | macOS apps + casks + mas + 140+ vscode extensions |
| Claude Code agents/rules | `.claude/agents/`, `.claude/rules/` | Custom agent + rule definitions |
| OpenCode config | `.config/opencode/` | Has own AGENTS.md (collaboration system prompt) |
| Global agent skills | `.agents/skills/` | Cross-platform skill bus; active lockfile at `~/.local/state/skills/.skill-lock.json` (XDG state, not tracked) |
| Devcontainer features | `.devcontainer/features/` | dotfiles-dev, mise, sheldon, keychain |
| CI workflows | `.github/workflows/` | main, fro-bot, renovate, update-repo-settings |
| Repo settings (auto-applied) | `.github/settings.yml` | Branch protection, status checks; synced daily |
| LaunchAgents | `Library/LaunchAgents/` | Only `dev.mrbro.environment.plist` tracked |

## CONVENTIONS

### Allowlist `.gitignore` Pattern

Repo ignores EVERYTHING by default, allowlists tracked paths in `.dotfiles/.gitignore`:

```gitignore
/*                  # Ignore everything
!/.config/          # Then un-ignore specific paths
!/.bashrc
```

**To add a new file**:
1. Try `git add -n <file>` first
2. If ignored, add `!/path/to/file` to `.dotfiles/.gitignore` and retry

### Defense-in-Depth Layers

The dotfiles allowlist is the primary defense. Two cross-repo backstops catch what slips through anywhere on the machine:

1. **Name-based safety net** — `~/.config/git/ignore` (XDG global gitignore) catches credential-shape names by **shape and extension** (`**/.env.*`, `**/auth.json`, `**/*.pem`, `**/*.key`, `**/*.p12`, `**/*.pfx`, `**/id_rsa*`, `**/id_ed25519*`) in **every repo on the machine**. Carves out `**/.env.example`, `**/.env.template`, `**/.env.sample` so documented templates stay tracked. The broad name wildcards (`**/*secret*`, `**/*token*`, `**/*credential*`, `**/*password*`) were removed in PR #1694 because they false-positive on legitimately-named source files (`secret-manager.ts`, `token.rs`, etc.) across the machine — content-scanning via `gitleaks` (layer 2) catches the actual credential strings without the name-shape collisions. Note: the dotfiles bare repo overrides `core.excludesfile` to `.dotfiles/.gitignore`, so this file does NOT protect dotfiles itself — dotfiles relies on its allowlist + gitleaks for the same coverage. AI-tool noise dirs (`**/sessions/`, `**/transcripts/`, `**/history.jsonl`) stay in `.dotfiles/.gitignore` because they're too false-positive-prone globally.
2. **By-content scanning** — `gitleaks` (installed via `aqua:gitleaks/gitleaks` in `~/.config/mise/config.toml`) runs as a local pre-commit hook at `~/.config/git/hooks/pre-commit`. Blocks commits containing detected secrets in any repo where the hook is activated. Bypass with `git commit --no-verify` for known false positives.

**One-time hook activation** (per machine, dotfiles bare repo):
```bash
git --git-dir=$HOME/.dotfiles config core.hooksPath $HOME/.config/git/hooks
```

**When adding a new AI tool**: extend the allowlist for the tool's content dirs, trust the global ignore + gitleaks to catch credential-shaped files, run `gitleaks detect --source $HOME --no-git` once on first commit to verify nothing leaked.

**False-positive workaround**: The extension-based pattern `**/*.key` is intentionally broad — it catches private-key files but can also match legitimately-named files (registry/layout `.key` files, `gpg.key` exported public keys, etc.). When working on a non-dotfiles repo where a legitimate file matches, add a project-local negation in that repo's `.gitignore`: `!path/to/file.key`. Working-tree gitignore patterns take precedence over the global ignore, so the negation always wins. The broader name wildcards (`*secret*`, `*token*`, `*credential*`, `*password*`) were dropped from the global ignore in PR #1694 — gitleaks content scanning (layer 2) covers the actual credential surface without the name-collision noise, so per-repo negations are no longer needed for those four shapes.

### Shell Config Organization

- **Bash entry**: `.bashrc` → `.config/bash/main` → `functions` → `aliases` → `init.d/*` (alphabetical) → `local.d/*`
- **Zsh entry**: `.zshenv` → `ZDOTDIR/.zshenv` (sources `.config/bash/exports`) → `.zshrc` → sheldon
- **init.d/ numbering**: numeric prefix sets load order (e.g., `002-prompt.bash`, `003-history.bash`); `d`-prefix disables a script (e.g., `dnvm.bash` skips nvm init since mise owns Node)
- **local.d/**: gitignored except `.gitkeep`; sourced last for machine-specific overrides
- **Helper functions** (defined in `exports`): `command_exists`, `ensure_dir`, `prepend_to_path`, `append_to_path`, `remove_from_path`
- **Host detection**: `HOST_OS`, `HOST_MACHINE`, `HOST_VERSION`, `HOST_PLATFORM` derived from `uname`; `REMOTE=1` if `SSH_CONNECTION` is set

### Tool Ownership

- **Node**: mise (nvm explicitly disabled via `dnvm.bash`)
- **Global npm packages**: bun (via `[settings.npm] bun = true` in mise config)
- **Container runtime (macOS)**: Rancher Desktop (Docker Desktop is removed)
- **macOS app inventory**: Brewfile (with `mas` for App Store apps)

### Git Config

- GPG signing enabled (`commit.gpgSign = true`)
- Rebase by default on branch setup; fast-forward only merges
- Auto-prune on fetch; auto-stash on rebase/pull

### XDG Compliance

- `XDG_CONFIG_HOME` = `~/.config`
- `XDG_DATA_HOME` = `~/.local/share`
- `XDG_CACHE_HOME` = `~/.cache`
- `XDG_STATE_HOME` = `~/.local/state`

## CI/CD

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `main.yaml` | push, PR | Builds devcontainer + tests mise install |
| `renovate.yaml` | post-Main success, dispatch | Runs Renovate via `bfra-me/.github` reusable workflow |
| `fro-bot.yaml` | daily 15:30 UTC, PR/issue events | Daily maintenance + autoheal via `fro-bot/agent` action |
| `update-repo-settings.yaml` | push to main, daily 4:37 UTC | Syncs `.github/settings.yml` to repo settings |

### Branch Protection (defined in `.github/settings.yml`)

- main: strict status checks (`Devcontainer CI`, `Fro Bot`, `Install mise`, `Renovate / Renovate`)
- enforce admins, linear history required

### Bot Dynamics

- **Renovate** (via `app/mrbro-bot`): dependency bumps; automerge enabled for safe updates
- **Fro Bot** (`fro-bot` user): scheduled daily maintenance; uses `FRO_BOT_PAT` (classic PAT, collaborator on all repos)
- **Copilot SWE agent** (`app/copilot-swe-agent`): handles complex tracking issues by opening fix PRs

## ANTI-PATTERNS (THIS PROJECT)

- **DO NOT** add files to `.gitignore` without first running `git check-ignore -v <file>`
- **DO NOT** run `git` commands without `.dotfiles` env vars set
- **NEVER** commit machine-specific values (use `*.local` files or `local.d/`)
- **NEVER** commit secrets (SSH keys, API tokens, credentials)

## DEVCONTAINER SETUP

Custom features in `.devcontainer/features/`:

| Feature | Purpose |
|---------|---------|
| `dotfiles-dev` | Clones bare repo, checks out main, sets up git config |
| `mise` | Installs mise tool version manager |
| `sheldon` | Installs sheldon zsh plugin manager |
| `keychain` | SSH/GPG key agent management |

Bootstrap: `dotfiles-dev/install.sh` generates `post-create.sh` that runs on container start.

## COMMANDS

```bash
# Format dotfiles (prettier, scoped to .devcontainer/.dotfiles/.github)
mise run format

# Install all mise-managed tools
mise run install

# Inspect OpenCode configuration and health
mise run opencode:doctor                      # Full diagnostic
mise run opencode:doctor -- --only health     # Specific section
mise run opencode:doctor -- --json            # Scriptable output

# Distill recent OpenCode sessions into a Markdown report (runs locally via Ollama)
mise run distill                              # Process sessions since last cursor
mise run distill -- --since=7d                # Override window
mise run distill -- --session=ses_<id>        # Single session, no cursor mutation
mise run distill -- --help                    # Full flag reference (env, exit codes, output paths)

# Dotfiles git operations (use the alias)
.dotfiles git status
.dotfiles git add path/to/file
.dotfiles git push
```

## NOTES

- **Fro Bot security alerts (by design, not bug)**: `FRO_BOT_PAT` is a collaborator-level token. GitHub restricts `/vulnerability-alerts` and `/dependabot/alerts` endpoints to repo owners on personal (user-owned) repos, regardless of token scope or collaborator role. Personal repos have no granular collaborator roles (only "Collaborator", which is effectively write access — Admin/Maintain/Triage exist only for org-owned repos). Marcus receives Dependabot notifications directly as the owner; Fro Bot's daily report intentionally omits this section (PR #1442).
- **mise `task_config.includes` portability**: this field doesn't expand `~`/`$HOME`/`{{config_root}}`/`{{xdg_config_home}}` and silently ignores relative paths in global config (`project_root` is `None`). Avoid it entirely — use file-based shebang tasks under `.config/mise/tasks/` instead (auto-discovered, no expansion needed).
- **Broken cache-clean LaunchAgent**: `~/Library/LaunchAgents/dev.mrbro.cache-clean.plist` references a nonexistent path. Sunday 4AM cleanup does not run. Plist is not tracked in dotfiles. Manual cleanup: `brew cleanup --prune=all`, `uv cache clean`, `mise prune`.
- **Disk monitoring**: macOS root FS occasionally hits ENOSPC (seen with <300MB free on a 926GB disk). pnpm rename errors are the canary. Run cleanup when tight.
- **`command_exists` guard**: used throughout `.config/bash/init.d/` and `.config/bash/aliases` for conditional tool setup — required pattern.
- **OpenCode AGENTS.md** at `.config/opencode/AGENTS.md` is NOT a structural index — it's the primary collaboration system prompt for OpenCode sessions. Don't repurpose it for directory documentation.
- **`.agents/skills/` is the cross-platform skill bus**: skills here load into both Claude Code and OpenCode. The active `skills` CLI lockfile is `~/.local/state/skills/.skill-lock.json` (XDG state, untracked); `~/.agents/.skill-lock.json` was a legacy path and is no longer used.
