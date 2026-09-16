---
title: macOS System Setup — Runbook
audience: Marcus + AI assistants in an OpenCode session
scope: Machine state that lives OUTSIDE the dotfiles work tree and is therefore untracked
related: docs/runbooks/mcp-remote-server-setup.md
---

# macOS System Setup — Runbook

The dotfiles bare repo tracks paths under `$HOME` via the `.dotfiles/ignore` allowlist.
The `Brewfile` tracks installed applications. Between those two lies a third category
that **nothing tracks**:

- files under `/etc` (PAM, sudoers)
- one-time `git config` activations on the bare repo itself
- Keychain items
- directory permissions that tooling silently depends on
- machine-local `*.local` files that are deliberately gitignored

A fresh machine, or a wipe-and-restore, loses all of it with nothing to prompt a
rebuild. This runbook is that prompt.

> This repo is **public**. Never record credential values here — only the Keychain
> item _names_ used to retrieve them, and never employer-identifying hostnames.

---

## Rebuild checklist

Work top to bottom on a new machine. Each step is independently verifiable.

| #   | Item                       | Verify                                                   |
| --- | -------------------------- | -------------------------------------------------------- |
| 1   | Touch ID for `sudo`        | `sudo -k && sudo true` prompts biometrically             |
| 2   | gitleaks pre-commit hook   | `git config --get core.hooksPath` returns a path         |
| 3   | GnuPG home permissions     | `stat -f '%Sp' ~/.config/gnupg` is `drwx------`          |
| 4   | Machine-local git identity | `git config --get user.signingKey` returns a fingerprint |
| 5   | Machine-local zsh secrets  | `~/.zshrc.local` exists and is sourced                   |
| 6   | Keychain items             | see "Keychain inventory"                                 |

---

## 1. Touch ID for `sudo`

macOS 14+ ships `/etc/pam.d/sudo` with `auth include sudo_local` as its **first**
auth line, ahead of smartcard and password. Apple provides
`/etc/pam.d/sudo_local.template` as the intended local override point.

**Never edit `/etc/pam.d/sudo` directly.** macOS regenerates it during system
updates and any change is silently lost. That is the whole reason `sudo_local`
exists, and most guides on the internet still get this wrong.

Derive the file from Apple's own template so formatting is exactly as intended:

```bash
sudo sh -c 'sed "s/^#auth/auth/" /etc/pam.d/sudo_local.template > /etc/pam.d/sudo_local'
sudo chown root:wheel /etc/pam.d/sudo_local
sudo chmod 444 /etc/pam.d/sudo_local
```

Resulting content:

```
# sudo_local: local config file which survives system update and is included for sudo
# uncomment following line to enable Touch ID for sudo
auth       sufficient     pam_tid.so
```

Verify in a **new** shell — `sudo -k` clears the cached credential so it actually
prompts:

```bash
sudo -k && sudo true && echo "Touch ID sudo works"
```

No reboot or daemon restart is needed; PAM reads its config per invocation.

### Safety

Open a second terminal running `sudo -s` and leave it open while making this change.
A malformed PAM auth file can lock you out of `sudo` entirely, and that root shell
is the escape hatch.

Rollback is `rm /etc/pam.d/sudo_local`. This is safe because PAM tolerates a missing
include target — verifiable by the fact that `sudo` works normally on a machine where
`sudo_local` has never been created.

### Behavior notes

`sufficient` means Touch ID success short-circuits authentication, while Touch ID
_failure_ falls through to smartcard and then password. The password path is never
removed.

| Situation                | Result                                          |
| ------------------------ | ----------------------------------------------- |
| Local terminal           | Touch ID prompt                                 |
| Over SSH                 | Password — no biometric hardware in the session |
| Apple Watch              | Not supported; `pam_tid` is Touch ID only       |
| Inside `tmux` / `screen` | **Fails** without `pam_reattach` — see below    |

### tmux caveat

`tmux` and `screen` detach the process from the session that owns the biometric
prompt, so Touch ID silently stops working inside a pane. If either is installed,
add `pam-reattach` **above** the `pam_tid` line:

```bash
brew install pam-reattach   # also add: brew "pam-reattach" to ~/Brewfile
```

```
auth       optional       /opt/homebrew/lib/pam/pam_reattach.so
auth       sufficient     pam_tid.so
```

Order matters — `pam_reattach` must run first. Do not add this line before the
module exists on disk; referencing a missing module in an auth file invites trouble
for no benefit.

---

## 2. gitleaks pre-commit hook (dotfiles bare repo)

Layer 2 of the secret-handling defense described in `~/.dotfiles/AGENTS.md` is content-based
scanning via `gitleaks`. The hook script is tracked at `.config/git/hooks/pre-commit`,
but **activation is per-machine local config** and is therefore not carried by a clone:

```bash
git --git-dir=$HOME/.dotfiles config core.hooksPath $HOME/.config/git/hooks
```

Verify — and note that a piped test masks the exit code, so check it directly:

```bash
git --git-dir=$HOME/.dotfiles config --get core.hooksPath
```

Requires `gitleaks` on `PATH` (declared via `aqua:gitleaks/gitleaks` in
`.config/mise/config.toml`). Bypass for a known false positive is
`git commit --no-verify`.

**This is silent when missing.** Commits succeed normally with no warning that
scanning never ran, which makes it exactly the kind of control worth verifying
rather than assuming.

---

## 3. GnuPG home permissions

`GNUPGHOME` is `~/.config/gnupg` (XDG, not `~/.gnupg`). GnuPG requires `700`; a
freshly created directory may be `755`, which is harmless while empty but emits
`unsafe permissions` warnings once a keyring exists.

```bash
chmod 700 ~/.config/gnupg
```

`gpg-agent.conf` is tracked. The keyring, trustdb, and revocation certificates are
not — restore those from your offline key backup, not from this repo.

---

## 4–5. Machine-local untracked files

Both are gitignored by design and must be recreated by hand.

| File                             | Ignored by | Purpose                                                       |
| -------------------------------- | ---------- | ------------------------------------------------------------- |
| `~/.config/git/.gitconfig.local` | `*.local`  | `user.name`, `user.email`, `user.signingKey`, `gpg.program`   |
| `~/.zshrc.local`                 | `*.local`  | Machine-local env; sourced at the end of `.config/zsh/.zshrc` |

Set `.gitconfig.local` to mode `600` — it carries identity, and on a work machine
that identity is employer-attributable.

**`~/.zshrc.local` is the only machine-local shell hook that actually runs.**
`.config/bash/main` loops over `~/.bash/init.d` and `~/.bash/local.d`, but `~/.bash`
does not exist and the login shell is zsh — so `.config/bash/local.d/` is dead code
sourced by nothing. Do not put machine-local values there.

Secrets in `~/.zshrc.local` should be _read from Keychain_, never written inline:

```zsh
() {
  local v
  v="$(security find-generic-password -s <item-name> -w 2>/dev/null)"
  [[ -n "$v" ]] && export SOME_VAR="$v"
  return 0
}
```

The explicit `return 0` matters: without it the function's exit status is that of the
last test, which is nonzero when the item is absent, and a nonzero status leaking out
of shell init is a debugging trap.

---

## 6. Keychain inventory

Item **names** only. Retrieve with
`security find-generic-password -s <name> -w`; create or update with
`security add-generic-password -U -s <name> -a "$USER" -w '<value>'`.

| Item name               | Used by                                  |
| ----------------------- | ---------------------------------------- |
| `box-mcp-client-id`     | Box remote MCP OAuth confidential client |
| `box-mcp-client-secret` | Box remote MCP OAuth confidential client |

See `docs/runbooks/mcp-remote-server-setup.md` for how these reach the MCP config.

On the first Keychain read from a fresh shell macOS prompts for access — choose
**Always Allow** or the dialog reappears at every shell start.

---

## LaunchAgents

Only `Library/LaunchAgents/dev.mrbro.environment.plist` is tracked. Anything else
present is either vendor-installed or machine-local, and will not survive a rebuild.

Audit what is actually present versus tracked:

```bash
ls -1 ~/Library/LaunchAgents/
git --git-dir=$HOME/.dotfiles --work-tree=$HOME ls-files -- ~/Library/LaunchAgents/
```

This drifts quietly. Vendor installers drop plists here without announcement, and
notes about them go stale — verify against the filesystem rather than trusting any
document, including this one.

---

## Adding to this runbook

When a change is made that lives outside `$HOME` or outside the allowlist, add it
here with: the exact command, a verification command, a rollback, and the failure
mode if it is missing. Record the _shape_ of secrets, never their values.
