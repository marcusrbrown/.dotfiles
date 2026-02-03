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

| Tool | Purpose |
|------|---------|
| node | Node.js runtime |
| python | Python runtime |
| rust | Rust toolchain |
| go | Go runtime |
| bun | Fast JavaScript runtime |
| deno | Secure JavaScript runtime |

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

The `.devcontainer/` directory provides a complete development environment:

```bash
# VS Code will prompt to reopen in container
code ~/

# Or use GitHub Codespaces
# Just open the repo in Codespaces
```

### Custom Features

| Feature | Purpose |
|---------|---------|
| `dotfiles-dev` | Clones bare repo, sets up git config |
| `mise` | Installs mise tool manager |
| `sheldon` | Installs Sheldon plugin manager |
| `keychain` | SSH/GPG agent management |

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
