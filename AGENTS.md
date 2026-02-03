# DOTFILES KNOWLEDGE BASE

**Generated:** 2026-02-02
**Commit:** 9631f9a
**Branch:** main

## OVERVIEW

Bare git dotfiles repo. `GIT_DIR=~/.dotfiles`, `GIT_WORK_TREE=~/`. Shell/dev configs synced across machines.

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
├── .bashrc               # Sources .config/bash/main
├── .zshenv               # Sources .config/zsh/.zshenv
├── .profile              # Login shell entry
├── .config/
│   ├── bash/             # Bash config (main entry: main)
│   │   ├── main          # Core bash setup, path mgmt
│   │   ├── aliases       # Shell aliases (.dotfiles defined here)
│   │   ├── functions     # Shell functions
│   │   ├── exports       # Environment variables
│   │   ├── init.d/       # Per-tool init scripts (nvm, rust, go, etc)
│   │   ├── completion.d/ # Tab completion scripts
│   │   └── local.d/      # Machine-local overrides (gitignored)
│   ├── zsh/              # Zsh config (uses sheldon for plugins)
│   ├── git/              # Git config (config, attributes, ignore)
│   ├── opencode/         # OpenCode AI config (has own AGENTS.md)
│   ├── mise/             # Tool version management + tasks
│   └── sheldon/          # Zsh plugin manager
├── .claude/              # Claude Code config
│   ├── agents/           # Custom agents (dotfiles-reviewer)
│   └── rules/            # Context rules
├── .devcontainer/        # Devcontainer for dotfiles dev
│   └── features/         # Custom features (dotfiles-dev, mise, sheldon)
├── .dotfiles/            # Bare repo metadata + docs
│   ├── .gitconfig        # Extended git config for dotfiles repo
│   └── .gitignore        # Allowlist pattern (ignore all, then !exceptions)
├── .github/              # CI workflows
├── Brewfile              # macOS Homebrew deps
└── Library/LaunchAgents/ # macOS launch agents
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add tracked file | `.dotfiles/.gitignore` | Add `!/path` exception first |
| Shell aliases | `.config/bash/aliases` | `.dotfiles` alias defined here |
| Environment vars | `.config/bash/exports` | Shared by bash and zsh |
| Tool-specific init | `.config/bash/init.d/` | One file per tool |
| Zsh plugins | `.config/sheldon/plugins.toml` | Sheldon manages plugins |
| Git settings | `.config/git/config` | Global git config |
| AI agent rules | `.claude/rules/` or `.config/opencode/` | Per-tool AI configs |
| Mise tool versions | `.config/mise/config.toml` | Node, Python, Rust, etc |
| Mise tasks | `.config/mise/tasks/` | dotfiles.toml has install/format |
| macOS launch agents | `Library/LaunchAgents/` | Only tracked: dev.mrbro.environment.plist |

## CONVENTIONS

### Allowlist .gitignore Pattern

The repo ignores EVERYTHING by default, then allowlists tracked files:

```gitignore
# Ignore everything
/*

# Include specific paths
!/.config/
!/.bashrc
!/README.md
```

**To add a new file**: Add `!/path/to/file` to `.dotfiles/.gitignore` BEFORE `git add`.

### Shell Config Organization

- `init.d/` pattern: Numbered prefixes for ordering (e.g., `002-prompt.bash`)
- `local.d/` for machine-specific overrides (not committed)
- Shared exports in `.config/bash/exports` (sourced by both bash and zsh)

### Git Config

- GPG signing enabled (`commit.gpgSign = true`)
- Rebase by default on branch setup
- Fast-forward only merges
- Auto-prune on fetch

### XDG Compliance

Configs respect XDG base directories:
- `XDG_CONFIG_HOME`: `~/.config`
- `XDG_DATA_HOME`: `~/.local/share`
- `XDG_CACHE_HOME`: `~/.cache`

## ANTI-PATTERNS (THIS PROJECT)

- **DO NOT** add files without updating `.dotfiles/.gitignore` allowlist
- **DO NOT** use `git` commands without `.dotfiles` env vars set
- **NEVER** commit machine-specific config to main (use `*.local` files or `local.d/`)
- **NEVER** commit secrets (SSH keys, API tokens, credentials)

## DEVCONTAINER SETUP

Custom features in `.devcontainer/features/`:

| Feature | Purpose |
|---------|---------|
| `dotfiles-dev` | Clones bare repo, checks out main, sets up git config |
| `mise` | Installs mise tool version manager |
| `sheldon` | Installs sheldon zsh plugin manager |
| `keychain` | SSH/GPG key agent management |

Bootstrap process: `dotfiles-dev/install.sh` generates `post-create.sh` that runs on container start.

## COMMANDS

```bash
# Format dotfiles (prettier)
mise run format

# Install tools
mise run install

# Check git status (dotfiles)
.dotfiles git status

# Add new file (after updating .gitignore)
.dotfiles git add path/to/file
```

## CI/CD

- **main.yaml**: Builds devcontainer, runs `devcontainer-info`, tests mise install
- **renovate.yaml**: Automated dependency updates
- **update-repo-settings.yaml**: Syncs repo settings

## NOTES

- Zsh uses sheldon for plugin management with cached compilation
- Starship prompt installed via devcontainer feature
- `command_exists` function used for conditional tool setup in aliases/init scripts
- Mise uses bun for npm packages (`settings.npm.bun = true`)
