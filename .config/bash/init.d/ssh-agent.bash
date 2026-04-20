#!bash
#
# ssh-agent
#
# Ensure an ssh-agent is reachable in environments that must use bash and where
# SSH must be available (e.g. plain Linux shells, devcontainers, CI).
#
# This script is a no-op when an external agent is already managing keys, such
# as macOS launchd/keychain (`SSH_AUTH_SOCK` already exported), gpg-agent with
# `enable-ssh-support`, 1Password's SSH agent, or `keychain`. It only starts a
# new agent if none is reachable, and it caches the agent's environment in
# `~/.ssh/environment` so subsequent shells reuse the same agent.

SSH_ENV="$HOME/.ssh/environment"

# Returns 0 if the current $SSH_AUTH_SOCK points at a responsive agent.
__ssh_agent_running()
{
  [ -n "$SSH_AUTH_SOCK" ] || return 1
  command -v ssh-add >/dev/null 2>&1 || return 1
  # `ssh-add -l` exits 0 (has keys), 1 (no keys), or 2 (agent unreachable);
  # accept 0 or 1 as evidence that the agent is alive.
  ssh-add -l >/dev/null 2>&1
  [ $? -ne 2 ]
}
__garbage __ssh_agent_running

__start_ssh_agent()
{
  command -v ssh-agent >/dev/null 2>&1 || return 1
  if [ ! -d "$HOME/.ssh" ]; then
    mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
  fi
  # Strip the agent's `echo` line so sourcing the file is silent.
  (umask 077 && ssh-agent | sed 's/^echo/#echo/' > "${SSH_ENV}")
  chmod 600 "${SSH_ENV}"
  # shellcheck source=/dev/null
  . "${SSH_ENV}" > /dev/null
}
__garbage __start_ssh_agent

__detect_ssh_agent()
{
  # Already covered by an external agent (launchd/keychain/gpg-agent/1Password/etc).
  __ssh_agent_running && return 0

  # Reuse a cached agent if its socket is still alive.
  if [ -r "${SSH_ENV}" ]; then
    # shellcheck source=/dev/null
    . "${SSH_ENV}" > /dev/null
    __ssh_agent_running && return 0
  fi

  __start_ssh_agent || return 1
}
__garbage __detect_ssh_agent

__detect_ssh_agent
