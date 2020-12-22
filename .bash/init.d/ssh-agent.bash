#!bash
#
# ssh-agent

# Code for ~/.ssh/environment is originally from http://www.cygwin.com/ml/cygwin/2001-06/msg00537.html.

SSH_ENV="$HOME/.ssh/environment"

__start_ssh_agent()
{
  ssh-agent | sed 's/^echo/#echo/' > "${SSH_ENV}"
  chmod 600 "${SSH_ENV}"
  . "${SSH_ENV}" > /dev/null
  if [ -n "$INTERACTIVE" ]; then
    # TODO: Not sure how useful this is when ssh-agent isn't already running, and we're not interactive...
    ssh-add
  fi
}
__garbage __start_ssh_agent

__detect_ssh_agent()
{
  if [ -f "${SSH_ENV}" ]; then
    . "${SSH_ENV}" > /dev/null
    # TODO: Move ps detection elsewhere.
    local __ps_full
    __ps_full=-x
    [ -n "$WINDIR" ] && __ps_full=
    [ -n "${SSH_AGENT_PID}" ] && ps $__ps_full | grep ${SSH_AGENT_PID} | grep ssh-agent$ > /dev/null || {
      __start_ssh_agent
    }
  else
    [ -d "$HOME/.ssh" ] || mkdir "$HOME/.ssh"
    __start_ssh_agent
  fi
}
__garbage __detect_ssh_agent

__detect_ssh_agent
