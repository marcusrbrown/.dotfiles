#!/bin/sh
# OpenCode v2 launcher. Everything v2 touches lives under the runtime directory
# (default ~/.local/opt/opencode2-pilot). The host environment is dropped entirely
# (env -i); the only host values forwarded are TERM/LANG/COLORTERM. CONTEXT7_API_KEY is
# read from ~/.env by the *inner* clean-env shell, so the secret never appears in argv
# (ps) and is never echoed.
#
# Layout:
#   $CONF_SRC  this tracked tree (.config/opencode2): v2 config, the @opencode/cli version pin
#              (package.json) and these scripts. Resolved from this file's location, so a
#              worktree checkout launches with its own config.
#   $RUNTIME   node_modules (@opencode/cli) and profile/ (state, data, auth). Not tracked.
#
# Optional caller inputs (read here, outside env -i; nothing else leaks through):
#   OPENCODE2_RUNTIME_DIR  override $RUNTIME (default: $HOME/.local/opt/opencode2-pilot).
#   OPENCODE2_WORKDIR    directory to run in (default: $PROFILE/work). bin/opencode2 sets this to
#                        the caller's cwd or its --dir argument.
#   OPENCODE2_BUN_DIR    directory holding bun, appended to PATH (plugins shell out to bun).
#   OPENCODE2_NODE_DIR   directory holding a real node, appended to PATH. /opt/homebrew/bin/node
#                        is a symlink to a directory, so `env node` fails with "Permission
#                        denied" and node-shebang tools (the project's biome, which AFT spawns
#                        as its Biome LSP) cannot start.
#   OPENCODE2_ENV_FILE   file to read CONTEXT7_API_KEY from (default: $HOME/.env).
#   OPENCODE2_PASSWORD   passed to v2 as OPENCODE_PASSWORD, if set.
#
# Config -> profile. Files are COPIED into $PROFILE/config/opencode/ and cortexkit/ when their
# content differs, so a plugin that rewrites its config in place edits the profile copy, never a
# tracked file; the next launch restores the tracked content. Two sources:
#   1. $CONF_SRC/opencode and $CONF_SRC/cortexkit: config specific to v2.
#   2. v1's tracked tree, $HOME/.config/opencode: AGENTS.md, commands/, skills/ and the
#      oh-my-opencode-slim/*.md prompt appends only. Files removed from v1's commands/ or
#      skills/ are removed from the profile copy of those two directories (nothing else is
#      ever deleted). v1's own config, auth, state and node_modules are never read.
# Profile files with no source counterpart (auth, plugin state, *.local.jsonc) are never touched.
#
# Short HOME: macOS caps a unix-socket path at 103 bytes (SUN_LEN). Biome's daemon socket lives
# under $HOME/Library/Caches/..., which overflows with HOME=$PROFILE/home. HOME is therefore the
# short symlink $REAL_HOME/.o2h -> $PROFILE/home. Files are still written through the real path.
#
# Developer identity (paths/sockets only; no secret value is read, copied or printed):
#   GH_CONFIG_DIR     real ~/.config/gh (gh's token lives in the macOS keychain)
#   GIT_CONFIG_GLOBAL generated $PROFILE/home/.gitconfig: includes the real XDG git config and
#                     restates its ~-based paths (excludes, attributes, includeIf) as absolute
#   SSH_AUTH_SOCK     caller's agent socket (gpg-agent ssh), only if set
#   GNUPGHOME         real gpg home (caller's value, else ~/.gnupg) so signing reaches gpg-agent
#   home/Library/Keychains  symlink to the real one: macOS `security` locates the login keychain
#                     via $HOME, so without it gh cannot read its keyring token
set -eu

REAL_HOME="${HOME:?}"
CONF_SRC="$(cd "$(dirname "$0")/.." && pwd -P)"
RUNTIME="${OPENCODE2_RUNTIME_DIR:-$REAL_HOME/.local/opt/opencode2-pilot}"
PROFILE="$RUNTIME/profile"
V1_CONF="$REAL_HOME/.config/opencode"
ENV_FILE="${OPENCODE2_ENV_FILE:-$REAL_HOME/.env}"
WORKDIR="${OPENCODE2_WORKDIR:-$PROFILE/work}"

fail() {
  printf 'opencode2: %s\n' "$1" >&2
  exit 1
}

# The runtime install is not tracked. Fail fast, with the fix, when it is missing or stale.
PIN=$(sed -n -E 's/.*"@opencode\/cli"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "$CONF_SRC/package.json")
[ -n "$PIN" ] || fail "no @opencode/cli pin in $CONF_SRC/package.json"
INSTALL_HINT="cp '$CONF_SRC/package.json' '$CONF_SRC/package-lock.json' '$RUNTIME/' && npm ci --prefix '$RUNTIME'"
[ -x "$RUNTIME/node_modules/.bin/opencode2" ] ||
  fail "@opencode/cli is not installed in $RUNTIME. Install the pinned version: $INSTALL_HINT"
INSTALLED=$(sed -n -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' \
  "$RUNTIME/node_modules/@opencode/cli/package.json" | head -n 1)
[ "$INSTALLED" = "$PIN" ] ||
  fail "installed @opencode/cli is ${INSTALLED:-unknown}, tracked pin is $PIN. Reinstall: $INSTALL_HINT"

mkdir -p "$PROFILE/home" "$PROFILE/config"
PROFILE_HOME="$(cd "$PROFILE/home" && pwd -P)"

# Short HOME symlink. Create it only if missing or pointing elsewhere; never replace a real dir.
SHORT_HOME="$REAL_HOME/.o2h"
if [ -L "$SHORT_HOME" ]; then
  [ "$(readlink "$SHORT_HOME")" = "$PROFILE_HOME" ] || ln -sfn "$PROFILE_HOME" "$SHORT_HOME"
elif [ -e "$SHORT_HOME" ]; then
  fail "$SHORT_HOME exists and is not a symlink; refusing to replace it"
else
  ln -s "$PROFILE_HOME" "$SHORT_HOME"
fi

# Copy $1 to $2 when content differs. rm first: a symlink at $2 must never be written through.
sync_one() {
  if cmp -s "$1" "$2" 2>/dev/null && [ ! -L "$2" ]; then return 0; fi
  mkdir -p "$(dirname "$2")" && rm -f "$2" && cp "$1" "$2"
}

# Copy every file under directory $1 to the same relative path under $2.
sync_tree() {
  (cd "$1" && find . -type f ! -name .DS_Store ! -path '*/node_modules/*') | while IFS= read -r rel; do
    rel=${rel#./}
    sync_one "$1/$rel" "$2/$rel" || exit 1
  done
}

# Delete files under $2 that no longer exist under $1, then any directories left empty.
prune_tree() {
  [ -d "$2" ] || return 0
  (cd "$2" && find . \( -type f -o -type l \) ! -name .DS_Store ! -path '*/node_modules/*') | while IFS= read -r rel; do
    rel=${rel#./}
    [ -f "$1/$rel" ] || rm -f "$2/$rel" || exit 1
  done
  find "$2" -mindepth 1 -type d -empty -delete
}

mkdir -p "$PROFILE/config/opencode" "$PROFILE/config/cortexkit"
for sub in opencode cortexkit; do
  if [ -d "$CONF_SRC/$sub" ]; then sync_tree "$CONF_SRC/$sub" "$PROFILE/config/$sub"; fi
done

if [ -d "$V1_CONF" ]; then
  if [ -f "$V1_CONF/AGENTS.md" ]; then
    sync_one "$V1_CONF/AGENTS.md" "$PROFILE/config/opencode/AGENTS.md"
  fi
  for sub in commands skills; do
    if [ -d "$V1_CONF/$sub" ]; then
      sync_tree "$V1_CONF/$sub" "$PROFILE/config/opencode/$sub"
      prune_tree "$V1_CONF/$sub" "$PROFILE/config/opencode/$sub"
    fi
  done
  for f in "$V1_CONF"/oh-my-opencode-slim/*.md; do
    if [ -f "$f" ]; then sync_one "$f" "$PROFILE/config/opencode/oh-my-opencode-slim/$(basename "$f")"; fi
  done
else
  printf 'opencode2: warning: %s not found; AGENTS.md, commands and skills are not synced\n' "$V1_CONF" >&2
fi

# git expands ~ from $HOME (the sandbox), so ~-based settings in the real config would
# silently stop applying (per-org includeIf identities, global ignore/attributes).
# Generate a sandbox gitconfig that includes the real one and restates those with
# absolute paths. It contains paths only; every value still comes from the real config.
GITCFG="$PROFILE_HOME/.gitconfig"
{
  printf '[include]\n\tpath = %s\n[core]\n\texcludesFile = %s\n\tattributesFile = %s\n' \
    "$REAL_HOME/.config/git/config" "$REAL_HOME/.config/git/ignore" "$REAL_HOME/.config/git/attributes"
  /usr/bin/env -u GIT_DIR -u GIT_WORK_TREE -u GIT_CONFIG_GLOBAL /opt/homebrew/bin/git config --global \
    --includes --get-regexp '^includeif\..*\.path$' 2>/dev/null | while read -r key path; do
    cond=${key#includeif.}
    cond=${cond%.path}
    cond=$(printf '%s' "$cond" | sed -E "s#^(gitdir(/i)?):~/#\\1:$REAL_HOME/#")
    path=$(printf '%s' "$path" | sed "s#^~/#$REAL_HOME/#")
    printf '[includeIf "%s"]\n\tpath = %s\n' "$cond" "$path"
  done
} >"$GITCFG.tmp"
mv "$GITCFG.tmp" "$GITCFG"

mkdir -p "$PROFILE_HOME/Library"
ln -sfn "$REAL_HOME/Library/Keychains" "$PROFILE_HOME/Library/Keychains"

# shellcheck disable=SC2016 # the inner script is deliberately single-quoted: it expands in the inner shell
exec /usr/bin/env -i \
  HOME="$SHORT_HOME" \
  XDG_CONFIG_HOME="$PROFILE/config" \
  XDG_DATA_HOME="$PROFILE/data" \
  XDG_CACHE_HOME="$PROFILE/cache" \
  XDG_STATE_HOME="$PROFILE/state" \
  TMPDIR="$PROFILE/tmp" \
  PATH="$RUNTIME/node_modules/.bin:/opt/homebrew/bin:/usr/bin:/bin${OPENCODE2_BUN_DIR:+:$OPENCODE2_BUN_DIR}${OPENCODE2_NODE_DIR:+:$OPENCODE2_NODE_DIR}" \
  TERM="${TERM:-xterm-256color}" \
  LANG="${LANG:-en_US.UTF-8}" \
  ${COLORTERM:+"COLORTERM=$COLORTERM"} \
  ${OPENCODE2_PASSWORD:+"OPENCODE_PASSWORD=$OPENCODE2_PASSWORD"} \
  OPENCODE_DISABLE_MODELS_FETCH=1 \
  OPENCODE_DISABLE_AUTOUPDATE=1 \
  OPENCODE_DISABLE_PROJECT_CONFIG=1 \
  OPENCODE_DISABLE_CLAUDE_CODE=1 \
  MAGIC_CONTEXT_STORAGE_DIR="$PROFILE/data/cortexkit-mc" \
  AFT_STORAGE_DIR="$PROFILE/data/aft" \
  AFT_CACHE_DIR="$PROFILE/cache/aft" \
  GH_CONFIG_DIR="$REAL_HOME/.config/gh" \
  GIT_CONFIG_GLOBAL="$GITCFG" \
  GNUPGHOME="${GNUPGHOME:-$REAL_HOME/.gnupg}" \
  ${SSH_AUTH_SOCK:+"SSH_AUTH_SOCK=$SSH_AUTH_SOCK"} \
  /bin/sh -c '
    envfile=$1; workdir=$2; shift 2
    if [ -r "$envfile" ]; then
      v=$(sed -n -E "s/^(export[[:space:]]+)?CONTEXT7_API_KEY=//p" "$envfile" | tail -n 1 | tr -d "\"\047\r")
      [ -n "$v" ] && export CONTEXT7_API_KEY="$v"
    fi
    cd "$workdir" || exit 1
    # --standalone (private in-process server, no shared background service) is
    # accepted on the root command and on run/mini/api, but v2.3.2 rejects it on
    # other subcommands (debug, plugin, mcp, ...). Those get no flag.
    case "${1:-}" in
      ""|-*) exec opencode2 --standalone "$@" ;;
      run|mini|api) sub=$1; shift; exec opencode2 "$sub" --standalone "$@" ;;
      auth|mcp|plugin|session)
        if [ -n "${2:-}" ]; then top=$1; sub=$2; shift 2; exec opencode2 "$top" "$sub" --standalone "$@"; fi
        exec opencode2 "$@" ;;
      *) exec opencode2 "$@" ;;
    esac
  ' sh "$ENV_FILE" "$WORKDIR" "$@"
