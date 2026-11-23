#!/usr/bin/env bash
# disk-monitor: append one CSV row describing disk pressure, to timestamp the
# next disk-full spike. Run every 10 minutes by launchd
# (Library/LaunchAgents/dev.mrbro.disk-monitor.plist). Local only; no network.
#
# Columns:
#   timestamp_utc          ISO-8601 UTC
#   free_bytes             free space on /System/Volumes/Data
#   used_pct               capacity % reported by df for that volume
#   rancher_diffdisk_kib   allocated KiB of the Rancher Desktop VM disk (empty if missing)
#   swap_used_mib          swap in use, MiB
#   systematic_scratch_kib KiB under ~/.cache/systematic-scratch (empty if missing)
#
# Env overrides (mainly for tests):
#   DISK_MONITOR_STATE_DIR  default: ~/.local/state/disk-monitor
#   DISK_MONITOR_MAX_ROWS   default: 4320 (30 days at 10 min)
#   DISK_MONITOR_DU_TIMEOUT default: 20 (seconds allowed per `du`)
#
# Failure mode worth knowing: if the disk is 100% full the append itself can
# fail. A gap in the CSV right before a spike is therefore evidence too.

set -eo pipefail

VOLUME="/System/Volumes/Data"
DIFFDISK="$HOME/Library/Application Support/rancher-desktop/lima/0/diffdisk"
SCRATCH="$HOME/.cache/systematic-scratch"

STATE_DIR="${DISK_MONITOR_STATE_DIR:-$HOME/.local/state/disk-monitor}"
MAX_ROWS="${DISK_MONITOR_MAX_ROWS:-4320}"
DU_TIMEOUT="${DISK_MONITOR_DU_TIMEOUT:-20}"
CSV="$STATE_DIR/disk.csv"
HEADER="timestamp_utc,free_bytes,used_pct,rancher_diffdisk_kib,swap_used_mib,systematic_scratch_kib"

# `du -sk` on a large tree can stall; bound it with a perl alarm (perl ships
# with macOS; exec keeps the alarm, so SIGALRM kills du itself) so runs can
# never pile up. Prints nothing if the path is missing, du times out, or perl
# is unavailable.
du_kib() {
  [ -e "$1" ] || return 0
  command -v perl >/dev/null 2>&1 || return 0
  perl -e 'alarm shift; exec @ARGV or exit 127' "$DU_TIMEOUT" du -sk "$1" 2>/dev/null | awk 'NR == 1 { print $1 }' || true
}

mkdir -p "$STATE_DIR"

timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# POSIX df: Filesystem 1024-blocks Used Available Capacity Mounted-on
read -r free_kib used_pct < <(df -Pk "$VOLUME" | awk 'NR == 2 { sub(/%$/, "", $5); print $4, $5 }')
free_bytes=$((free_kib * 1024))

diffdisk_kib="$(du_kib "$DIFFDISK")"
scratch_kib="$(du_kib "$SCRATCH")"

# "total = 2048.00M  used = 1024.50M  free = 1023.50M  (encrypted)"
swap_used_mib="$(sysctl -n vm.swapusage | awk '{
  for (i = 1; i <= NF; i++) if ($i == "used") {
    v = $(i + 2); unit = substr(v, length(v)); sub(/[KMG]$/, "", v)
    if (unit == "G") v *= 1024; else if (unit == "K") v /= 1024
    printf "%.2f", v
  }
}')"

if [ ! -s "$CSV" ]; then
  echo "$HEADER" >"$CSV"
fi
echo "$timestamp,$free_bytes,$used_pct,$diffdisk_kib,$swap_used_mib,$scratch_kib" >>"$CSV"

# Retention: header + newest MAX_ROWS rows.
rows=$(($(wc -l <"$CSV") - 1))
if [ "$rows" -gt "$MAX_ROWS" ]; then
  tmp="$CSV.tmp.$$"
  trap 'rm -f "$tmp"' EXIT
  { head -n 1 "$CSV"; tail -n "$MAX_ROWS" "$CSV"; } >"$tmp"
  mv "$tmp" "$CSV"
fi
