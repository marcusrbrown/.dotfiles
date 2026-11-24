---
title: "OpenCode v2 — Runbook"
audience: Dotfiles owner
---

# OpenCode v2 — Runbook

## Commands

| Command              | Runs                                                   | Config / data                                                            |
| -------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------ |
| `opencode`           | OpenCode **v2** via `~/.config/opencode2/bin/opencode` | tracked `~/.config/opencode2/` → `~/.local/opt/opencode2-pilot/profile/` |
| `opencode2`          | same wrapper, explicit name                            | same                                                                     |
| `harness`            | OpenCode **v1** (`@fro.bot/harness`, mise-pinned)      | `~/.config/opencode/`, `~/.local/share/opencode/`                        |
| mise `opencode` shim | v1, shadowed by the `PATH` entry below                 | —                                                                        |

`~/.config/opencode2/bin` is first on `PATH` (macOS only), ahead of the mise shims and tool paths. It holds only
`opencode` and `opencode2`. Three places keep it first: `_.path` in `.config/mise/config.toml` (without it,
`mise activate` puts the v1 harness install dir, which also ships an `opencode` bin, ahead of it),
`.config/zsh/.zshenv`, and `.config/bash/exports`. `harness` resolves its native binary itself and ignores bare
`opencode` on `PATH`.

Tooling that reads the v1 database needs `harness`: `mise run opencode:doctor` (spawns `harness`, never bare
`opencode`), `opencode:cache-plateau`, `distill`. The `dotfiles-opencode` alias runs `harness`.

## What is tracked

- `.config/opencode2/opencode/`, `.config/opencode2/cortexkit/` — v2 config (`opencode.json`,
  `oh-my-opencode-slim.jsonc`, `systematic.jsonc`, `cli.json`, `aft.jsonc`, `magic-context.jsonc`), shaped like
  `profile/config/`.
- `AGENTS.md`, `commands/`, `skills/` and `oh-my-opencode-slim/*.md` are shared with v1: the launcher copies them from
  `~/.config/opencode/` and deletes profile files that no longer exist there. Nothing else of v1's is read.
- `.config/opencode2/package.json` + `package-lock.json` — the exact `@opencode/cli` pin. Renovate watches it
  (`<2.4.0`, no automerge).
- `.config/opencode2/lib/run.sh` — the `env -i` sandbox launcher. `bin/opencode2` picks the workdir.

Config is **copied** into the profile at launch when content differs, so plugins that rewrite their config edit the
profile copy, never a tracked file. The next launch restores the tracked content: change config in the tracked file.
Auth, plugin state and `*.local.jsonc` in the profile are never touched.

The npm install and `profile/` under `~/.local/opt/opencode2-pilot/` are not tracked. The launcher refuses to start
when the installed `@opencode/cli` differs from the pin.

## `~/.o2h`

`~/.o2h` is a symlink to `~/.local/opt/opencode2-pilot/profile/home`, created by the launcher. v2 runs with
`HOME=~/.o2h` because the Biome daemon socket (`$HOME/Library/Caches/dev.biomejs.biome/biome-daemon/…`) overflows
macOS's 103-byte socket path limit under the long profile path, which stops AFT's Biome LSP. The launcher only creates
or retargets a symlink; if `~/.o2h` is a real file or directory it aborts. Rollback removes it.

## Activate

```sh
git --git-dir=$HOME/.dotfiles --work-tree=$HOME fetch origin main
git --git-dir=$HOME/.dotfiles --work-tree=$HOME merge --ff-only origin/main

~/.config/opencode2/bin/opencode2 --version     # expect 2.3.2

exec zsh -l                                      # new PATH; or open a new terminal
command -v opencode                              # expect ~/.config/opencode2/bin/opencode
opencode --version                               # expect 2.3.2
harness --version                                # expect @fro.bot/harness base:1.19.5 ...
```

Stop any running v2 server first (`opencode2 service stop`). The previous `~/.local/bin/opencode2` and
`~/.local/opt/opencode2-pilot/run.sh` are shadowed and unused; remove them when convenient.

## Update the pin

Renovate opens the PR (no automerge). After merging it, reinstall:

```sh
cp ~/.config/opencode2/package.json ~/.config/opencode2/package-lock.json ~/.local/opt/opencode2-pilot/
npm ci --prefix ~/.local/opt/opencode2-pilot
```

## Roll back

Per command: run `harness` instead of `opencode`. v1 config, auth and data are untouched.

Current shell only:

```sh
path=(${path:#$HOME/.config/opencode2/bin}); hash -r   # opencode is the mise shim (v1) again
```

Permanent: revert the PR on a branch cut from a fresh `origin/main`, merge it, then:

```sh
[ -L ~/.o2h ] && rm ~/.o2h      # symlink only; the profile it points to is untouched
exec zsh -l
```

## Rules

- One v2 server at a time.
- Never open the same checkout in v1 and v2 at the same time.
- Snapshots stay off (`snapshots: false`).
- v1 and v2 share no state: sessions, auth and `opencode.db` are separate.
- `OPENCODE_DISABLE_PROJECT_CONFIG=1` is set, so project-level OpenCode config (`opencode.json`, `.opencode/`, repo
  agents and plugins) is ignored on v2. Only the tracked v2 config applies.
