# .dotfiles

The parent `.dotfiles` repository is cloned as a bare repository and checked out with the `$HOME` directory set as the Git worktree. After checkout, the contents of this directory will be written into the bare repository.

## Initial Setup

After cloning, extend the local configuration to include `.gitconfig`:

```sh
.dotfiles git config include.path .gitconfig
```

## `.dotfiles` Shell Alias

The `.dotfiles` alias is defined in `~/.config/bash/aliases` and executes commands in the context of the bare repository:

```sh
alias .dotfiles='GIT_DIR=$HOME/.dotfiles GIT_WORK_TREE=$HOME'
```

### Usage Examples

```sh
# Git operations
.dotfiles git status
.dotfiles git add .config/new-tool/config
.dotfiles git commit -m "Add new tool configuration"
.dotfiles git push

# Open home directory in VS Code with git integration
.dotfiles code ~

# View diff of tracked files
.dotfiles git diff
```

## Files in This Directory

### `.gitconfig`

Extends the local Git configuration with settings specific to the dotfiles repository:
- Sets `core.excludesFile` to use this directory's `.gitignore`
- Configures `status.showUntrackedFiles = no` to hide untracked home directory files

### `.gitignore`

Uses an **allowlist pattern** to explicitly track only specific files while ignoring everything else in `$HOME`.

#### How the Allowlist Works

```gitignore
# Ignore everything in home directory
/*

# Then allowlist specific paths
!/.config/
!/.bashrc
!/Brewfile
```

#### Adding New Files

Before adding a new file to version control, you must add an allowlist entry:

```sh
# 1. Add the allowlist entry
echo '!/path/to/new/file' >> ~/.dotfiles/.gitignore

# 2. Add both files
.dotfiles git add ~/.dotfiles/.gitignore ~/path/to/new/file

# 3. Commit
.dotfiles git commit -m "Track new file"
```

### `docs/`

Additional documentation for specific configurations.

### `AGENTS.md`

Knowledge base for AI agents working with this repository.

## Directory Layout

The bare repository at `~/.dotfiles` contains git metadata. When commands like `.dotfiles git status` run, Git uses:
- `GIT_DIR=$HOME/.dotfiles` - Location of the repository metadata
- `GIT_WORK_TREE=$HOME` - Working directory (your home directory)

This allows seamless tracking of dotfiles without symlinks or special tooling.

## Machine-Local Configuration

Files and directories matching these patterns are gitignored:
- `*.local` - E.g., `~/.zshrc.local`
- `local.d/` directories - E.g., `~/.config/bash/local.d/`

Use these for machine-specific settings, secrets, or overrides:

```sh
# Machine-specific environment
echo 'export WORK_EMAIL="me@company.com"' > ~/.config/bash/local.d/work

# Local zsh customizations
echo 'alias proj="cd ~/work/project"' >> ~/.zshrc.local
```

## Troubleshooting

### Cannot add new file

Ensure the file is allowlisted in `.dotfiles/.gitignore`:

```sh
# Check if file would be ignored
.dotfiles git check-ignore -v ~/path/to/file

# Add to allowlist if needed
echo '!/path/to/file' >> ~/.dotfiles/.gitignore
```

### Status shows no changes

The bare repo hides untracked files by default. To see all:

```sh
.dotfiles git status --untracked-files=normal
```

### Checkout conflicts

If checkout fails due to existing files:

```sh
# See which files conflict
.dotfiles git checkout 2>&1 | grep -E "^\s+"

# Back them up
mkdir -p ~/.dotfiles-backup
.dotfiles git checkout 2>&1 | grep -E "^\s+" | awk '{print $1}' | \
  xargs -I{} sh -c 'mkdir -p ~/.dotfiles-backup/$(dirname {}) && mv {} ~/.dotfiles-backup/{}'

# Retry checkout
.dotfiles git checkout
```

## Security

**Never commit to this repository:**
- API keys, tokens, or credentials
- Private SSH keys
- Database connection strings
- Machine-specific paths containing usernames

Use `local.d/` directories or `*.local` files for sensitive configuration.
