# .dotfiles

[![CI](https://github.com/marcusrbrown/.dotfiles/actions/workflows/main.yaml/badge.svg)](https://github.com/marcusrbrown/.dotfiles/actions/workflows/main.yaml)
[![License: Unlicense](https://img.shields.io/badge/license-Unlicense-blue.svg)](UNLICENSE)

A bare git repository for synchronizing shell configurations and development environment across machines.

## Overview

This repository uses a **bare git repository** pattern where:

- `GIT_DIR` is set to `~/.dotfiles`
- `GIT_WORK_TREE` is set to `$HOME`

This approach allows tracking configuration files directly in your home directory without symlinks or complex tooling.

### Key Features

- **Shell Agnostic**: Full support for both Bash and Zsh
- **XDG Compliant**: Respects XDG Base Directory specification
- **Plugin Management**: [Sheldon](https://github.com/rossmacarthur/sheldon) for Zsh plugins with lazy loading
- **Tool Versions**: [mise](https://mise.jdx.dev/) for managing runtime versions (Node, Python, Rust, Go, etc.)
- **Devcontainer Ready**: Complete devcontainer setup for portable development

## Quick Start

### New Machine Setup

```bash
# Clone as a bare repository
git clone --bare https://github.com/marcusrbrown/.dotfiles.git ~/.dotfiles

# Define the dotfiles alias
alias .dotfiles='GIT_DIR=$HOME/.dotfiles GIT_WORK_TREE=$HOME'

# Checkout the dotfiles (backup any existing files first)
.dotfiles git checkout

# Extend git config to include dotfiles-specific settings
.dotfiles git config include.path .gitconfig
```

### If Checkout Fails

If you have existing configuration files that conflict:

```bash
# Create backup directory
mkdir -p ~/.dotfiles-backup

# Move conflicting files
.dotfiles git checkout 2>&1 | grep -E "^\s+" | awk '{print $1}' | xargs -I{} mv {} ~/.dotfiles-backup/{}

# Retry checkout
.dotfiles git checkout
```

## Structure

```
~/
├── .bashrc                    # Sources .config/bash/main
├── .zshenv                    # Sources .config/zsh/.zshenv
├── .profile                   # Login shell entry
├── .config/
│   ├── bash/                  # Bash configuration
│   │   ├── main               # Core setup, sources all other files
│   │   ├── aliases            # Shell aliases (.dotfiles alias defined here)
│   │   ├── exports            # Environment variables (shared by bash/zsh)
│   │   ├── functions          # Shell functions
│   │   ├── init.d/            # Per-tool initialization scripts
│   │   ├── completion.d/      # Tab completion scripts
│   │   └── local.d/           # Machine-local overrides (gitignored)
│   ├── zsh/                   # Zsh configuration
│   │   ├── .zshenv            # Environment setup
│   │   ├── .zshrc             # Interactive shell config
│   │   └── plugins/           # Local plugin configs
│   ├── sheldon/               # Zsh plugin manager
│   │   ├── plugins.toml       # Zsh plugin definitions
│   │   └── plugins.bash.toml  # Bash plugin definitions
│   ├── mise/                  # Tool version management
│   │   ├── config.toml        # Tool versions and settings
│   │   └── tasks/             # Task definitions
│   ├── git/                   # Git configuration
│   │   ├── config             # Global git config
│   │   ├── ignore             # Global gitignore
│   │   └── attributes         # Global git attributes
│   ├── starship.toml          # Starship prompt config
│   └── ...
├── .devcontainer/             # Devcontainer configuration
│   ├── devcontainer.json      # Container settings
│   └── features/              # Custom devcontainer features
│       ├── dotfiles-dev/      # Dotfiles bootstrap feature
│       ├── mise/              # mise installer
│       ├── sheldon/           # Sheldon installer
│       └── keychain/          # SSH/GPG agent management
├── .dotfiles/                 # Bare repo metadata
│   ├── .gitconfig             # Dotfiles-specific git config
│   └── .gitignore             # Allowlist-based ignore file
├── .github/                   # GitHub configuration
│   └── workflows/             # CI workflows
├── Brewfile                   # macOS Homebrew dependencies
└── Library/LaunchAgents/      # macOS launch agents
```

## Usage

### Daily Operations

```bash
# Check status (shows only tracked files)
.dotfiles git status

# Add a file (must be allowlisted in .dotfiles/.gitignore first)
.dotfiles git add ~/.config/some-new-config

# Commit changes
.dotfiles git commit -m "Add new configuration"

# Push changes
.dotfiles git push
```

### Adding New Files

The repository uses an **allowlist pattern** - everything is ignored by default:

```bash
# 1. Add allowlist entry to .dotfiles/.gitignore
echo '!/path/to/new/file' >> ~/.dotfiles/.gitignore

# 2. Stage and commit
.dotfiles git add ~/.dotfiles/.gitignore ~/path/to/new/file
.dotfiles git commit -m "Track new file"
```

### Machine-Local Overrides

Files ending in `.local` or placed in `local.d/` directories are gitignored:

```bash
# Create local bash overrides
echo 'export MY_SECRET_TOKEN="..."' > ~/.config/bash/local.d/secrets

# Create local zshrc additions
echo 'alias work="cd ~/work"' > ~/.zshrc.local
```

## Configuration Details

### Shell Initialization

**Bash**:

1. `.bashrc` sources `.config/bash/main`
2. `main` sets up paths, shell options, and sources:
   - `exports` - Environment variables
   - `functions` - Shell functions
   - `aliases` - Command aliases
   - `init.d/*` - Tool-specific initialization
   - `local.d/*` - Machine-local overrides

**Zsh**:

1. `.zshenv` sources `.config/zsh/.zshenv`
2. `.zshrc` uses Sheldon for plugin management with:
   - Deferred loading for better startup performance
   - Compiled cache for faster subsequent loads
   - Prezto modules for core functionality

### Tool Version Management (mise)

Configured tools in `.config/mise/config.toml`:

| Tool   | Purpose                   |
| ------ | ------------------------- |
| node   | Node.js runtime           |
| python | Python runtime            |
| rust   | Rust toolchain            |
| go     | Go runtime                |
| bun    | Fast JavaScript runtime   |
| deno   | Secure JavaScript runtime |

```bash
# Install all configured tools
mise install

# Run a mise task
mise run format
mise run install
```

### Zsh Plugins (Sheldon)

Key plugins configured in `.config/sheldon/plugins.toml`:

- **zsh-defer**: Deferred command execution for faster startup
- **zsh-autosuggestions**: Fish-like autosuggestions
- **fast-syntax-highlighting**: Syntax highlighting
- **zsh-history-substring-search**: History search
- **starship**: Cross-shell prompt

### macOS Specific

**Homebrew** (`Brewfile`):

```bash
# Install all dependencies
brew bundle install
```

Key packages: `bat`, `fzf`, `ripgrep`, `lsd`, `fd`, `git-delta`, `starship`

**Homebrew Settings** (in exports):

- Analytics disabled
- No-quarantine for casks
- Automatic cleanup enabled

## Devcontainer Development

The `.devcontainer/` directory provides a complete development environment with all tools pre-configured.

### Container Quick Start

```bash
# VS Code: reopen in container
code ~/

# GitHub Codespaces: open the repo directly in Codespaces

# CLI (requires @devcontainers/cli)
devcontainer up --workspace-folder .
```

### Published Image

A pre-built devcontainer image is published to GitHub Container Registry on every push to `main` and on tagged releases.

```text
ghcr.io/marcusrbrown/dotfiles-devcontainer:latest
```

Reference it in another project's `devcontainer.json`:

```json
{
  "image": "ghcr.io/marcusrbrown/dotfiles-devcontainer:latest"
}
```

The image includes devcontainer metadata labels, so consumers inherit the full configuration (features, settings, environment variables) without replicating the `devcontainer.json`.

**Tags:**

- `latest` — updated on every push to `main`
- `vX.Y.Z` — pinned to specific releases

### What's Included

Built on [`mcr.microsoft.com/devcontainers/base`](https://github.com/devcontainers/images/tree/main/src/base-debian) with:

| Tool                                                | Source                                                     |
| --------------------------------------------------- | ---------------------------------------------------------- |
| [mise](https://mise.jdx.dev/)                       | Custom feature — manages Node, Python, Rust, Go, Bun, Deno |
| [Sheldon](https://github.com/rossmacarthur/sheldon) | Custom feature — Zsh plugin manager with deferred loading  |
| [keychain](https://github.com/funtoo/keychain)      | Custom feature — SSH/GPG agent management                  |
| [Starship](https://starship.rs/)                    | Installed by `dotfiles-dev` — cross-shell prompt           |
| [GitHub CLI](https://cli.github.com/)               | Remote feature                                             |
| [Node.js](https://nodejs.org/)                      | Remote feature                                             |
| [ShellCheck](https://www.shellcheck.net/)           | Remote feature                                             |

### Feature Architecture

Four custom features in `.devcontainer/features/` handle the environment setup:

```
common-utils ─┬─► sheldon
              ├─► keychain
              │       │
              └─► dotfiles-dev ──► mise
                    (depends on sheldon, keychain, gh-cli)
```

- **`dotfiles-dev`** — Bootstrap feature. Generates a `post-create.sh` script that clones the bare dotfiles repo and checks out `main`. Depends on `common-utils`, `github-cli`, `sheldon`, and `keychain`.
- **`mise`** — Depends on `dotfiles-dev`. Runs `mise install` post-create to install all configured tool versions.
- **`sheldon`** — Installs the Sheldon Zsh plugin manager.
- **`keychain`** — Installs keychain for SSH/GPG agent management from GitHub releases.

### CI and Image Publishing

The `main.yaml` workflow builds and publishes the devcontainer image using [`devcontainers/ci`](https://github.com/devcontainers/ci):

- **Push to `main`**: builds the image, pushes to GHCR with `latest` tag
- **Pull requests**: builds using `cacheFrom` for speed, does not push
- **Releases**: pushes with the release version tag and `latest`

The `cacheFrom` option pulls cached Docker layers from the published image, so subsequent builds skip network-dependent tool installs.

## Customization

### Adding Tool Initialization

Create a new file in `.config/bash/init.d/`:

```bash
# ~/.config/bash/init.d/099-mytool
if command_exists mytool; then
    eval "$(mytool init bash)"
fi
```

### Adding Zsh Plugins

Edit `.config/sheldon/plugins.toml`:

```toml
[plugins.my-new-plugin]
github = "author/plugin-name"
apply = ["defer"]  # Optional: defer loading
```

### Privacy-Focused Defaults

The configuration disables telemetry where possible:

- `HOMEBREW_NO_ANALYTICS=1`
- `PLATFORMIO_SETTING_ENABLE_TELEMETRY=No`
- `VIBE_TOOLS_NO_TELEMETRY=1`

## Troubleshooting

### "Untracked files" not showing

This is intentional. The bare repo is configured to hide untracked files:

```bash
.dotfiles git status --untracked-files=normal  # Show all untracked
```

### Sheldon cache issues

```bash
rm -rf ~/.cache/zsh/sheldon.*.zsh
exec zsh  # Rebuild cache on next load
```

### mise not loading

Ensure mise is in your PATH and run:

```bash
mise activate zsh  # or bash
mise install
```

## License

This repository is released into the public domain under [The Unlicense](UNLICENSE). See the `UNLICENSE` file for details.
