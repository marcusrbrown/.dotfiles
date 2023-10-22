# GnuPG and SSH Agent Setup on Apple Silicon-based MacBook Pro

## Introduction

This guide provides step-by-step instructions to configure GnuPG with SSH and GPG agents on a MacBook Pro running on Apple Silicon (M1 Pro chip). These instructions are tailored for systems where Homebrew is installed in `/opt/homebrew`. The guide ensures that cached keys and passphrases remain alive for an extended period or until the session ends or the computer reboots.

---

## Step 1: Install Required Packages

Firstly, install GnuPG and pinentry using Homebrew.

```bash
/opt/homebrew/bin/brew install gnupg pinentry-mac
```

---

## Step 2: Create GnuPG Configuration File (`gpg-agent.conf`)

Create a file named `gpg-agent.conf` within `~/.gnupg/`.

```bash
touch ~/.gnupg/gpg-agent.conf
```

Populate the file with the following content:

```bash
default-cache-ttl 34560000
max-cache-ttl 34560000
enable-ssh-support
pinentry-program /opt/homebrew/bin/pinentry-mac
```

---

## Step 3: Update Shell Configuration (`~/.zshrc`)

Open `~/.zshrc` for editing:

```bash
nano ~/.zshrc
```

Append the following lines at the end:

```bash
# Ensure the passphrase prompt is shown in the correct tty
function _gpg-agent_update-tty_preexec {
  gpg-connect-agent updatestartuptty /bye &>/dev/null
}
autoload -U add-zsh-hook
add-zsh-hook preexec _gpg-agent_update-tty_preexec

# Set up gpg-agent to work with ssh
export GPG_TTY=$(tty)
if [[ $(gpgconf --list-options gpg-agent 2>/dev/null | awk -F: '$1=="enable-ssh-support" {print $10}') = 1 ]]; then
  unset SSH_AGENT_PID
  if [[ "${gnupg_SSH_AUTH_SOCK_by:-0}" -ne $$ ]]; then
    export SSH_AUTH_SOCK="$(gpgconf --list-dirs agent-ssh-socket)"
  fi
fi
```

---

## Step 4: Reload Configuration and Restart Agents

To apply the changes, reload your shell configuration:

```bash
source ~/.zshrc
```

Then, restart the GPG agent:

```bash
gpgconf --kill gpg-agent
gpg-agent --daemon
```

---

## Verification

To verify that everything is set up correctly:

1. List GPG keys: `gpg --list-secret-keys`
2. Check added SSH keys: `ssh-add -l`

---

## References

- GnuPG Documentation: [GnuPG Manual](https://gnupg.org/documentation/manuals/gnupg/)
- Homebrew Documentation: [Homebrew Manual](https://docs.brew.sh/Manpage)
- Pinentry for macOS: [Pinentry GitHub Repository](https://github.com/GPGTools/pinentry)
