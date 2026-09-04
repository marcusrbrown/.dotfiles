---
title: A shell subsystem documented as live had not run since 2024
date: 2026-09-04
category: documentation-gaps
module: shell
problem_type: documentation_gap
component: development_workflow
severity: high
applies_when: "A repo documents a layered shell load chain (init.d/, conf.d/, local.d/, a main entry script) and no one has confirmed against a live shell that the chain still executes — especially after a shell framework migration."
symptoms:
  - "An environment variable a config script exports is empty in a live shell"
  - "A credential file exists, is readable and correct, and the variable it sets stays unset"
  - "Documentation describes a load chain whose entry point no live shell references"
root_cause: config_error
resolution_type: documentation_update
related_components:
  - documentation
  - tooling
tags:
  - shell
  - dotfiles
  - dead-code
  - silent-failure
  - credentials
  - sheldon
---

# A shell subsystem documented as live had not run since 2024

## Context

`DISCORD_TOKEN` was empty in every shell, while `.config/bash/local.d/discord.bash` had been sitting there since May 2026 — present, readable, syntactically valid, calling `security find-generic-password` correctly. Nothing sourced `local.d/`.

Tracing that one dead credential exposed the rest. `.config/bash/` held 28 tracked files. Two were live: `exports` and `aliases`. The other 26 — `main`, `functions`, 19 `init.d/*.bash`, two `completion.d/*.bash`, `os_darwin`, `os_mingw`, `local.d/.gitkeep` — had no referrer at all, while `AGENTS.md` and both READMEs documented them as the live Bash chain:

```
.bashrc → main → functions → aliases → init.d/* → local.d/*
```

Git dates the break precisely. Commit `b1b887f` (2024-01-10, "overhaul shells") moved the subsystem under `.config/bash/` and replaced a `.bashrc` that sourced `~/.bash_profile` and `~/.shrc` with a sheldon-only one. At that commit neither entry point reached it: `.bashrc` contained no `.config/bash` reference at all, and `.profile:4` sourced `exports` and nothing else. The subsystem's internal wiring survived the move unchanged, still pointing at the pre-move paths — `functions:89` sourced `~/.bash/main`, `main:150` sourced `~/.bash/functions` — so its only remaining references were to each other, through a `~/.bash/` directory that no longer existed. Dormant for 967 days.

That also made restoration harder than it looks: `main` sources `~/.bash/*`, so it could not have worked as written.

## Guidance

**Verify configuration by executing it, not by reading it.** The scripts are well-formed, consistently numbered, and guarded with `command_exists` — reading them confirms the documented chain. Only a shell disproves it:

```console
$ zsh -ic 'echo "PAGER=$PAGER"'   # init.d/pager.bash exports PAGER
PAGER=

$ zsh -ic 'alias ls'               # resolves to aliases:37, not init.d/ls.bash:23
ls='LC_COLLATE=C lsd --color=auto --group-directories-first'

$ bash -ic 'type .dotfiles'        # undefined at the time
```

**Trace the entry point, not the contents.** A reference from another orphaned file is not a referrer — here `main` and `functions` cited each other and neither was loaded.

**When documentation and behavior disagree, the shell is authoritative.**

**Prefer salvage-then-delete over restoring a long-dormant subsystem.** Restoring activates years of untested behavior at once: a prompt competing with starship, and scripts targeting `gcloud`, `nix`, `p4`, `rvm` — none installed. Reviving `init.d/ssh-agent.bash` would have been worse than useless; `SSH_AUTH_SOCK` already resolves to gpg-agent's socket (`.config/gnupg/gpg-agent.conf` enables SSH support), and a second agent overwrites it.

**Split salvage and deletion into separate commits.** Salvage changes behavior, deletion does not. Separated, either reverts alone.

## Why This Matters

Dormant configuration is worse than absent configuration because it absorbs work that appears to succeed. Absent config produces an error; dormant config accepts the edit, reports nothing, and does nothing.

What accumulated in those 967 days:

- **Secrets guidance pointed into a void.** Both READMEs instructed readers to write credentials to `.config/bash/local.d/` — `echo 'export MY_SECRET_TOKEN="..."' > ~/.config/bash/local.d/secrets`. Anyone following that believed their token was loaded.
- **A telemetry opt-out was silently absent.** `DOTNET_CLI_TELEMETRY_OPTOUT` lived in `init.d/dotnet.bash`, so it never applied — a live privacy gap in a repo whose stated posture is privacy-first. `EDITOR`, `VISUAL`, and `PAGER` were unset for the same reason.
- **The dead convention propagated forward.** The repo's scheduled maintenance agent had `init.d/` numbering and `local.d/` overrides written into its prompt as live conventions, so it kept recommending a mechanism that could not work.

None of these produced an error. The failure surfaced only because someone noticed a variable that should have had a value.

## When to Apply

Check when any of these are present:

- a layered config directory (`init.d/`, `conf.d/`, `local.d/`, `plugins.d/`) whose loader you have not personally executed
- a documented load chain, especially one written before a framework migration — here, adopting sheldon rewrote the entry point without rewriting what it loaded
- a machine-local override mechanism nobody has tested end to end
- an environment variable or credential that should be set and is empty

That last one is the cheapest signal available. One empty variable exposed 26 files.

## Examples

**Salvaged into `.config/bash/exports`** — the four values the dead scripts were supposed to set:

```bash
: "${EDITOR:=vim}"
: "${VISUAL:=$EDITOR}"
: "${PAGER:=less}"
export EDITOR VISUAL PAGER

export DOTNET_CLI_TELEMETRY_OPTOUT=1
```

Assign-if-unset so a caller's environment still wins. Keep the telemetry opt-out **outside** any `HOST_OS == darwin` block — an early pass co-located it with `HOMEBREW_NO_ANALYTICS`, which would have left telemetry enabled in the Linux devcontainer.

**A real minimal bash init path in `.bashrc`**, replacing the framework:

```bash
declare -F command_exists >/dev/null 2>&1 || source "${XDG_CONFIG_HOME:-$HOME/.config}/bash/exports"
source "${XDG_CONFIG_HOME:-$HOME/.config}/bash/aliases"
```

The `declare -F` guard is load-bearing: `aliases` calls `command_exists`, defined in `exports`. A login bash gets `exports` via `.profile`; a non-login `bash -i` reads only `.bashrc`, and would otherwise source `aliases` with the helper undefined.

**Verification after the change** — same commands, both shells:

```console
$ zsh -ic  'echo "$EDITOR|$VISUAL|$PAGER|$DOTNET_CLI_TELEMETRY_OPTOUT"'
vim|vim|less|1
$ bash -ic 'echo "$EDITOR|$VISUAL|$PAGER|$DOTNET_CLI_TELEMETRY_OPTOUT"'
vim|vim|less|1
$ bash -ic 'type .dotfiles'
.dotfiles is aliased to `GIT_DIR=$HOME/.dotfiles GIT_WORK_TREE=$HOME'
```

## A Note on Cleaning Up References

Scrubbing the deleted names is correct for live reference docs — `AGENTS.md` and the READMEs should not point readers at directories that no longer exist. It is wrong for records of the failure: a first pass also rewrote learning docs, replacing `init.d/pager.bash` and `local.d/discord.bash` with prose like "a former entry point," deleting the evidence those docs existed to preserve. The test is whether a document *recommends* the path or *explains why it failed*.

## Related

- PR #2504 — salvaged the four environment values and gave bash a real init path
- PR #2506 — deleted the 26 dormant files and corrected the documentation
- PRs #2500-#2502 — the Discord credential thread that surfaced this
- `docs/solutions/2026-09-03-fro-bot-prompt-forbade-its-own-fix-path.md` — the maintenance agent whose prompt taught the dead conventions forward
- `docs/runbooks/discord-admin-agent.md` — corrected credential procedure, now using `~/.zshrc.local`
