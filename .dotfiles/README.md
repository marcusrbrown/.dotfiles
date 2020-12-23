# .dotfiles

The parent `.dotfiles` repository is cloned as a bare repository and checked out with the `$HOME` directory set as the Git worktree. After checkout, the contents of this directory will be written into the bare repository. Use the [`.dotfiles` Shell Alias](#dotfiles-shell-alias) to extend the local configuration to include `.gitconfig`:

```sh
$ .dotfiles git config include.path .gitconfig
$
```

## `.dotfiles` Shell Alias

Define the `.dotfiles` shell alias to execute commands in the context of the cloned `.dotfiles` bare repository:

```sh
$ alias .dotfiles='GIT_DIR=$HOME/.dotfiles GIT_WORK_TREE=$HOME'
$
```

Execute Git-aware commands using the alias:

```sh
$ .dotfiles git add .zshrc
$ .dotfiles code ~
$
```

## Files

### [`.gitconfig`](./.gitconfig)

Extends the local Git configuration with configuration for the `.dotfiles` repository.

### [`.gitignore`](./.gitignore)

The parent `dotfiles` repository uses the `$HOME` directory as its worktree. The [`.gitignore`](../.gitignore) in the parent directory will likely be the final `.gitignore` searched when Git commands check for file exclusions. That `.gitignore` should only ignore files that should be ignored globally, and not interfere with `.gitignore` files in child directories.

To avoid displaying untracked files within the `$HOME` directory the local Git configuration is extended to use `.gitignore` as the excludes file. The `.gitignore` ignores all files except for the contents of the `.dotfiles` repository. When a new file is added to the `.dotfiles` repository, it must be added as an exception to `.gitignore` before it can be added to the index.
