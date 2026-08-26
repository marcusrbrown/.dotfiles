---
title: "AFT Legacy Index Cleanup — Runbook"
audience: Explicitly approved maintenance operator
related-plan: docs/plans/2026-07-22-001-fix-aft-legacy-index-cleanup-plan.md
---

# AFT Legacy Index Cleanup — Runbook

This is a manual, one-off procedure for reclaiming approximately 23 GiB of
obsolete AFT index storage. It is not an automation job and must not be wired
to a scheduler.

> **Warning:** This document is not authorization. Obtain fresh, explicit
> operator approval immediately before Phase 1, and obtain a second fresh,
> explicit approval immediately before Phase 2. Any uncertainty is an abort.

## Scope and non-goals

In scope are only the two identity-validated legacy `index` directories, a
same-filesystem quarantine rename, restart validation, and final removal of
the quarantined entries.

Never modify or delete:

- the active shared CortexKit root or its current indexes;
- whole AFT roots or any `backups` or `checkpoints` directories;
- OpenCode session data, `opencode.db`, or other OpenCode state; or
- unrelated task state, logs, configuration, package caches, or source files.

Space recovery is an expectation, not authority to broaden the target set.

## Canonical roles and targets

| Role | Canonical location | Required proof |
| --- | --- | --- |
| Active shared CortexKit root | `$HOME/.local/share/cortexkit/aft` | Preserve the entire root, including current indexes, backups, and checkpoints. |
| OpenCode legacy root / target | Root: `$HOME/.local/share/opencode/storage/plugin/aft`; target: `index` | Root is the expected directory, target is its `index` directory, and the root carries `.migrated_to_cortexkit`. |
| Pre-v0.10.1 cache root / target | Root: `$HOME/.cache/aft`; target: `index` | Root is the documented legacy cache directory and target is its `index` directory. |

The only permitted target paths are the resolved canonical paths of the two
documented legacy `index` locations. The shared root is never a target.

## Read-only preflight

Complete and record this inventory without changing runtime data:

- expand `$HOME` and resolve each candidate to an absolute canonical path;
- record each target's canonical path, inode, filesystem device, entry type,
  parent/origin, size, and the relevant root metadata;
- confirm the OpenCode legacy root's `.migrated_to_cortexkit` sentinel;
- record installed AFT version, host free space, and the shared root's
  backup/checkpoint presence; and
- inventory OpenCode, Pi, AFT, and any parent/supervisor processes.

The canonical path must match exactly one of the two documented legacy targets;
the target must be a directory named `index`, and its parent/origin and
filesystem must match the documented root. A matching project hash is
corroboration only and is never authority. Any mismatch, symlink ambiguity,
missing sentinel, or changed layout aborts.

Do not use `opencode-doctor` for offline preflight: it may auto-spawn
OpenCode. An AFT diagnostic is permitted only when the installed diagnostic's
behavior is proven non-spawning. Otherwise use filesystem/process metadata
only, or abort. The preflight is read-only and is not an authorization step.

## Hard quiescence gate

Run this gate immediately before **each rename in Phase 1** and immediately
before **each deletion in Phase 2**:

- no OpenCode, Pi, or AFT process exists, including relevant child processes;
- no parent or supervisor can restart one during the mutation; and
- no open file descriptor refers to the target being mutated.

Revalidate the target identity at the same gate. In Phase 2, also require that
the quarantine entry still has its recorded inode, device, and parent, and that
the original canonical target path has not reappeared. Failure or inability to
prove any condition means abort and leave the data in its current safe state.

## Offline Terminal procedure

> **Read before running:** Quit all OpenCode, Pi, and AFT processes first. Run
> this procedure from a normal macOS Terminal outside OpenCode. Preserve the
> current shared root. These commands are not authorization; a fresh Terminal
> confirmation is the operator's authorization, not assistant approval. Run
> the blocks in the same Terminal session so the recorded identity and
> quarantine variables are retained. If any block fails, stop and abort.

Do not reopen OpenCode between preflight and Phase 1. Restart validation occurs
only after both legacy targets have been quarantined.

### 1. Read-only inventory and gates

This block defines the exact roots, rejects symlinks or unexpected types,
checks the migration sentinel and protected shared-root directories, and prints
BSD-macOS `stat`, `du -shx`, and `df -h` evidence. It does not call
`opencode-doctor` and does not modify data.

```zsh
offline_preflight() {
  HOME_CANON="$(cd -P -- "$HOME" && pwd -P)" || return 1
  SHARED_ROOT="$HOME_CANON/.local/share/cortexkit/aft"
  SHARED_INDEX="$SHARED_ROOT/index"
  OC_ROOT="$HOME_CANON/.local/share/opencode/storage/plugin/aft"
  OC_INDEX="$OC_ROOT/index"
  OC_SENTINEL="$OC_ROOT/.migrated_to_cortexkit"
  CACHE_ROOT="$HOME_CANON/.cache/aft"
  CACHE_INDEX="$CACHE_ROOT/index"
  AFT_BIN_ROOT="$CACHE_ROOT/bin"

  canonical_dir() { (cd -P -- "$1" >/dev/null 2>&1 && pwd -P); }
  id_of() { stat -f '%i:%d' "$1"; }
  stat_evidence() {
    stat -f 'path=%N type=%HT inode=%i device=%d mode=%Sp' "$1"
  }
  require_dir() {
    target_dir="$1"
    [[ -d "$target_dir" && ! -L "$target_dir" ]] || {
      printf 'ABORT: expected non-symlink directory is missing or mismatched: %s\n' "$target_dir" >&2
      return 1
    }
    canonical="$(canonical_dir "$target_dir")" || return 1
    [[ "$canonical" == "$target_dir" ]] || {
      printf 'ABORT: canonical path mismatch: %s -> %s\n' "$target_dir" "$canonical" >&2
      return 1
    }
  }
  require_file() {
    target_file="$1"
    [[ -f "$target_file" && ! -L "$target_file" ]] || {
      printf 'ABORT: expected non-symlink file is missing or mismatched: %s\n' "$target_file" >&2
      return 1
    }
  }

  for target_dir in \
    "$SHARED_ROOT" "$SHARED_INDEX" "$SHARED_ROOT/backups" \
    "$SHARED_ROOT/checkpoints" "$OC_ROOT" "$OC_INDEX" \
    "$CACHE_ROOT" "$CACHE_INDEX"; do
    require_dir "$target_dir" || return 1
  done
  require_file "$OC_SENTINEL" || return 1
  [[ "$(dirname "$OC_INDEX")" == "$OC_ROOT" &&
     "$(dirname "$CACHE_INDEX")" == "$CACHE_ROOT" ]] || {
    printf 'ABORT: target parent/origin mismatch\n' >&2
    return 1
  }
  [[ "$(stat -f '%d' "$OC_INDEX")" == "$(stat -f '%d' "$OC_ROOT")" &&
     "$(stat -f '%d' "$CACHE_INDEX")" == "$(stat -f '%d' "$CACHE_ROOT")" ]] || {
    printf 'ABORT: target and legacy parent are not on the same filesystem\n' >&2
    return 1
  }

  OC_ID="$(id_of "$OC_INDEX")" || return 1
  CACHE_ID="$(id_of "$CACHE_INDEX")" || return 1
  DF_BEFORE="$(df -h "$SHARED_ROOT")" || return 1

  printf '%s\n' 'Read-only identity evidence:'
  for target_dir in \
    "$SHARED_ROOT" "$SHARED_INDEX" "$SHARED_ROOT/backups" \
    "$SHARED_ROOT/checkpoints" "$OC_ROOT" "$OC_INDEX" "$OC_SENTINEL" \
    "$CACHE_ROOT" "$CACHE_INDEX"; do
    stat_evidence "$target_dir" || return 1
  done
  printf '%s\n' 'Read-only size evidence:'
  for target_dir in "$SHARED_ROOT" "$OC_ROOT" "$OC_INDEX" "$CACHE_ROOT" "$CACHE_INDEX"; do
    du -shx "$target_dir" || return 1
  done
  printf '%s\n' 'Host filesystem evidence before Phase 1:'
  printf '%s\n' "$DF_BEFORE"

  process_gate() {
    matches="$(ps -axo pid=,command= | awk -v aft_bin_root="$AFT_BIN_ROOT" '
      {
        for (i = 2; i <= NF; i++) {
          token = $i
          gsub(/^[[:space:]"`]+|[[:space:]"`]+$/, "", token)
          base = token
          sub(/^.*\//, "", base)
          if (base == "opencode" || base == "aft" || base == "pi" ||
              (index(token, aft_bin_root "/") == 1 && base == "aft")) {
            print
            next
          }
        }
      }')"
    if [[ -n "$matches" ]]; then
      printf '%s\n' 'ABORT: matching OpenCode/AFT/Pi launch command line(s):' >&2
      printf '%s\n' "$matches" >&2
      return 1
    fi
    printf '%s\n' 'Process gate: no known OpenCode/AFT/Pi launch token found in full command lines.'
  }

  lsof_empty_result() {
    check_name="$1"
    shift
    check_output="$("$@" 2>&1)"
    check_status=$?
    # On macOS, status 1 with no output is the only accepted no-FD result.
    if [[ "$check_status" -ne 1 || -n "$check_output" ]]; then
      printf 'ABORT: %s was open, errored, unsupported, or inconclusive\n' "$check_name" >&2
      [[ -n "$check_output" ]] && printf '%s\n' "$check_output" >&2
      return 1
    fi
  }

  no_open_fds() {
    for target_dir in "$@"; do
      lsof_empty_result "direct lsof $target_dir" lsof -nP "$target_dir" || return 1
      lsof_empty_result "recursive lsof +D $target_dir" lsof -nP +D "$target_dir" || return 1
      printf 'No open FDs proven by direct and recursive checks for %s\n' "$target_dir"
    done
  }

  process_gate || return 1
  no_open_fds "$OC_INDEX" "$CACHE_INDEX" || return 1
  printf '%s\n' 'MANUAL GATE: verify no parent/supervisor can restart OpenCode, Pi, or AFT; abort if this cannot be proven.'
  printf '%s\n' 'Preflight complete. Do not restart OpenCode before Phase 1.'
}
offline_preflight
```

Abort if the process gate lists anything. It inspects full command lines for
exact path/token boundaries, wrapper-launched scripts, and the known local AFT
binary directory; unrelated names containing `pi` do not match. Unknown
wrapper or daemon evidence is not proof of quiescence and is an abort. Both
direct `lsof` and recursive `lsof +D` output, errors, unsupported behavior, or
any status other than the documented empty-result status are inconclusive and
therefore an abort. The supervisor/restart check remains a manual hard gate;
this runbook never kills processes automatically.

### 2. Phase 1 command block: quarantine only

Run this block only after reviewing the preflight evidence. It requires a
fresh exact confirmation in the same Terminal, reruns identity/quiescence
checks immediately before each rename, creates timestamped quarantine names
inside the respective legacy parents, refuses collisions, and uses `mv` only.

```zsh
phase1_quarantine() {
  printf 'Type exactly: I APPROVE PHASE 1 AFT QUARANTINE\n> '
  IFS= read -r AFT_PHASE1_CONFIRM
  [[ "$AFT_PHASE1_CONFIRM" == "I APPROVE PHASE 1 AFT QUARANTINE" ]] || {
    printf '%s\n' 'ABORT: Phase 1 confirmation did not match.' >&2
    return 1
  }

  STAMP="$(date -u +%Y%m%dT%H%M%SZ)" || return 1
  OC_QUAR="$OC_ROOT/.index.quarantine.$STAMP"
  CACHE_QUAR="$CACHE_ROOT/.index.quarantine.$STAMP"
  OC_PHASE1_ID="$OC_ID"
  CACHE_PHASE1_ID="$CACHE_ID"
  OC_PHASE1_QUAR="$OC_QUAR"
  CACHE_PHASE1_QUAR="$CACHE_QUAR"
  OC_PHASE1_ORIGINAL="$OC_INDEX"
  CACHE_PHASE1_ORIGINAL="$CACHE_INDEX"
  OC_PHASE1_PARENT="$OC_ROOT"
  CACHE_PHASE1_PARENT="$CACHE_ROOT"
  [[ ! -e "$OC_QUAR" && ! -L "$OC_QUAR" &&
     ! -e "$CACHE_QUAR" && ! -L "$CACHE_QUAR" ]] || {
    printf '%s\n' 'ABORT: timestamped quarantine collision.' >&2
    return 1
  }

  rename_gate() {
    target_dir="$1"
    expected_id="$2"
    parent="$3"
    [[ -d "$target_dir" && ! -L "$target_dir" &&
       "$(canonical_dir "$target_dir")" == "$target_dir" &&
       "$(id_of "$target_dir")" == "$expected_id" &&
       "$(stat -f '%d' "$target_dir")" == "$(stat -f '%d' "$parent")" ]] || {
      printf 'ABORT: identity changed before rename: %s\n' "$target_dir" >&2
      return 1
    }
    process_gate || return 1
    no_open_fds "$target_dir" || return 1
    printf '%s\n' 'MANUAL GATE: confirm no parent/supervisor restart risk now; abort if uncertain.'
    printf 'Type exactly: I CONFIRM NO SUPERVISOR RESTART RISK\n> '
    IFS= read -r AFT_SUPERVISOR_CONFIRM
    [[ "$AFT_SUPERVISOR_CONFIRM" == "I CONFIRM NO SUPERVISOR RESTART RISK" ]] || {
      printf '%s\n' 'ABORT: supervisor restart risk was not confirmed.' >&2
      return 1
    }
  }

  printf '%s\n' 'Before OpenCode-legacy rename:'
  stat_evidence "$OC_INDEX"; du -shx "$OC_INDEX" || return 1
  rename_gate "$OC_INDEX" "$OC_PHASE1_ID" "$OC_PHASE1_PARENT" || return 1
  mv "$OC_INDEX" "$OC_QUAR" || return 1
  printf '%s\n' 'After OpenCode-legacy rename:'
  stat_evidence "$OC_QUAR"; du -shx "$OC_QUAR" || return 1

  printf '%s\n' 'Before cache-legacy rename:'
  stat_evidence "$CACHE_INDEX"; du -shx "$CACHE_INDEX" || return 1
  rename_gate "$CACHE_INDEX" "$CACHE_PHASE1_ID" "$CACHE_PHASE1_PARENT" || return 1
  mv "$CACHE_INDEX" "$CACHE_QUAR" || return 1
  printf '%s\n' 'After cache-legacy rename:'
  stat_evidence "$CACHE_QUAR"; du -shx "$CACHE_QUAR" || return 1
  df -h "$SHARED_ROOT"
  printf '%s\n' 'Phase 1 complete: quarantine is reversible and has intentionally reclaimed no space.'
}
phase1_quarantine
```

If either rename fails, stop and abort. Do not restart OpenCode, delete
anything, or improvise a different target. If restart validation fails after
both renames, use the rollback block only after manually stopping services
again and proving the hard quiescence gate. A partial quarantine may be
restored by the same block; it recognizes an already-restored target and only
renames an identity-validated quarantine entry.

### 3. Restart validation and rollback

After both renames succeed, manually restart OpenCode/AFT. Confirm that AFT
uses `$HOME/.local/share/cortexkit/aft`, current indexes remain available, no
migration/index/schema error occurs, shared backups/checkpoints remain present,
and no unexpected cold global re-index starts. Do not proceed to Phase 2 until
all checks pass.

If validation fails, quit/stop OpenCode, Pi, and AFT again. Then run this
rollback block; it performs no process stopping itself:

```zsh
rollback_quarantine() {
  process_gate || return 1
  rollback_one() {
    quarantine="$1"
    original="$2"
    expected_id="$3"
    parent="$4"
    if [[ ! -e "$quarantine" && ! -L "$quarantine" ]]; then
      [[ -d "$original" && ! -L "$original" && "$(id_of "$original")" == "$expected_id" ]] || {
        printf 'ABORT: rollback path is neither quarantined nor restored: %s\n' "$original" >&2
        return 1
      }
      return 0
    fi
    [[ -d "$quarantine" && ! -L "$quarantine" &&
       "$(canonical_dir "$quarantine")" == "$quarantine" &&
       "$(id_of "$quarantine")" == "$expected_id" &&
       "$(stat -f '%d' "$quarantine")" == "$(stat -f '%d' "$parent")" &&
       ! -e "$original" && ! -L "$original" ]] || {
      printf 'ABORT: rollback identity/path check failed: %s\n' "$quarantine" >&2
      return 1
    }
    no_open_fds "$quarantine" || return 1
    printf '%s\n' 'MANUAL GATE: confirm no parent/supervisor restart risk before rollback.'
    printf 'Type exactly: I CONFIRM NO SUPERVISOR RESTART RISK\n> '
    IFS= read -r AFT_SUPERVISOR_CONFIRM
    [[ "$AFT_SUPERVISOR_CONFIRM" == "I CONFIRM NO SUPERVISOR RESTART RISK" ]] || return 1
    mv "$quarantine" "$original" || return 1
  }
  rollback_one "$OC_PHASE1_QUAR" "$OC_PHASE1_ORIGINAL" "$OC_PHASE1_ID" "$OC_PHASE1_PARENT" || return 1
  process_gate || return 1
  rollback_one "$CACHE_PHASE1_QUAR" "$CACHE_PHASE1_ORIGINAL" "$CACHE_PHASE1_ID" "$CACHE_PHASE1_PARENT" || return 1
  printf '%s\n' 'Rollback complete: both legacy index paths restored; do not broaden diagnosis.'
}
rollback_quarantine
```

If rollback identity or quiescence cannot be proven, abort without broader
cleanup. A failed restart must be rolled back before further diagnosis.

### 4. Phase 2 command block: permanent deletion and postflight

Run this block only after successful restart validation, after manually
stopping OpenCode/Pi/AFT again, and after a **second** fresh exact confirmation.
It rechecks the recorded identities and original paths, then deletes only the
recorded quarantine paths with `rm -rf --`.

```zsh
phase2_delete() {
  phase1_records_ready() {
    [[ -n "${STAMP:-}" &&
       -n "${OC_PHASE1_ID:-}" && -n "${CACHE_PHASE1_ID:-}" &&
       -n "${OC_PHASE1_QUAR:-}" && -n "${CACHE_PHASE1_QUAR:-}" &&
       -n "${OC_PHASE1_ORIGINAL:-}" && -n "${CACHE_PHASE1_ORIGINAL:-}" &&
       -n "${OC_PHASE1_PARENT:-}" && -n "${CACHE_PHASE1_PARENT:-}" ]] || {
      printf '%s\n' 'ABORT: retained Phase 1 identity records are uninitialized.' >&2
      return 1
    }
    [[ "$OC_PHASE1_QUAR" == "$OC_PHASE1_PARENT/.index.quarantine.$STAMP" &&
       "$CACHE_PHASE1_QUAR" == "$CACHE_PHASE1_PARENT/.index.quarantine.$STAMP" &&
       "$OC_PHASE1_ORIGINAL" == "$OC_INDEX" &&
       "$CACHE_PHASE1_ORIGINAL" == "$CACHE_INDEX" &&
       "$OC_PHASE1_PARENT" == "$OC_ROOT" &&
       "$CACHE_PHASE1_PARENT" == "$CACHE_ROOT" ]] || {
      printf '%s\n' 'ABORT: retained Phase 1 paths do not match documented targets.' >&2
      return 1
    }
  }
  phase1_records_ready || return 1

  printf 'Type exactly: I APPROVE PHASE 2 AFT QUARANTINE DELETION\n> '
  IFS= read -r AFT_PHASE2_CONFIRM
  [[ "$AFT_PHASE2_CONFIRM" == "I APPROVE PHASE 2 AFT QUARANTINE DELETION" ]] || {
    printf '%s\n' 'ABORT: Phase 2 confirmation did not match.' >&2
    return 1
  }

  delete_gate() {
    quarantine="$1"
    original="$2"
    recorded_id="$3"
    recorded_quarantine="$4"
    recorded_original="$5"
    recorded_parent="$6"
    phase2_identity_check() {
      current_id="$(id_of "$recorded_quarantine")" || return 1
      current_device="$(stat -f '%d' "$recorded_quarantine")" || return 1
      recorded_parent_device="$(stat -f '%d' "$recorded_parent")" || return 1
      [[ "$quarantine" == "$recorded_quarantine" &&
         "$original" == "$recorded_original" &&
         -d "$recorded_parent" && ! -L "$recorded_parent" &&
         "$(canonical_dir "$recorded_parent")" == "$recorded_parent" &&
         -d "$recorded_quarantine" && ! -L "$recorded_quarantine" &&
         "$(canonical_dir "$recorded_quarantine")" == "$recorded_quarantine" &&
         "$current_id" == "$recorded_id" &&
         "$current_device" == "${recorded_id#*:}" &&
         "$recorded_parent_device" == "${recorded_id#*:}" &&
         "$(dirname "$recorded_quarantine")" == "$recorded_parent" &&
         ! -e "$recorded_original" && ! -L "$recorded_original" ]] || {
        printf 'ABORT: retained Phase 1 identity/path comparison failed: %s\n' "$recorded_quarantine" >&2
        return 1
      }
    }
    # This is a retained Phase 1 record, not a newly discovered deletion target.
    phase2_identity_check || return 1
    process_gate || return 1
    no_open_fds "$recorded_quarantine" || return 1
    printf '%s\n' 'MANUAL GATE: confirm no parent/supervisor restart risk now; abort if uncertain.'
    printf 'Type exactly: I CONFIRM NO SUPERVISOR RESTART RISK\n> '
    IFS= read -r AFT_SUPERVISOR_CONFIRM
    [[ "$AFT_SUPERVISOR_CONFIRM" == "I CONFIRM NO SUPERVISOR RESTART RISK" ]] || return 1
    # Recapture and compare again immediately before the following rm.
    phase2_identity_check || {
      printf 'ABORT: quarantine changed after the final quiescence check: %s\n' "$recorded_quarantine" >&2
      return 1
    }
  }

  printf '%s\n' 'Before OpenCode-legacy deletion:'
  stat_evidence "$OC_PHASE1_QUAR"; du -shx "$OC_PHASE1_QUAR" || return 1
  delete_gate "$OC_PHASE1_QUAR" "$OC_PHASE1_ORIGINAL" "$OC_PHASE1_ID" \
    "$OC_PHASE1_QUAR" "$OC_PHASE1_ORIGINAL" "$OC_PHASE1_PARENT" || return 1
  rm -rf -- "$OC_PHASE1_QUAR" || return 1

  printf '%s\n' 'Before cache-legacy deletion:'
  stat_evidence "$CACHE_PHASE1_QUAR"; du -shx "$CACHE_PHASE1_QUAR" || return 1
  delete_gate "$CACHE_PHASE1_QUAR" "$CACHE_PHASE1_ORIGINAL" "$CACHE_PHASE1_ID" \
    "$CACHE_PHASE1_QUAR" "$CACHE_PHASE1_ORIGINAL" "$CACHE_PHASE1_PARENT" || return 1
  rm -rf -- "$CACHE_PHASE1_QUAR" || return 1

  sleep 30
  no_open_fds "$OC_ROOT" "$CACHE_ROOT" || return 1
  [[ ! -e "$OC_INDEX" && ! -L "$OC_INDEX" &&
     ! -e "$CACHE_INDEX" && ! -L "$CACHE_INDEX" &&
     ! -e "$OC_PHASE1_QUAR" && ! -L "$OC_PHASE1_QUAR" &&
     ! -e "$CACHE_PHASE1_QUAR" && ! -L "$CACHE_PHASE1_QUAR" ]] || {
    printf '%s\n' 'ABORT: a deleted path or quarantine path still exists.' >&2
    return 1
  }
  inode_absent() {
    found="$(find "$1" -xdev -inum "$2" -print -quit 2>&1)"
    find_status=$?
    [[ "$find_status" -eq 0 && -z "$found" ]] || {
      printf 'ABORT: recorded target inode is reachable or inode search failed: %s\n' "$2" >&2
      [[ -n "$found" ]] && printf '%s\n' "$found" >&2
      return 1
    }
  }
  inode_absent "$OC_ROOT" "${OC_PHASE1_ID%%:*}" || return 1
  inode_absent "$CACHE_ROOT" "${CACHE_PHASE1_ID%%:*}" || return 1
  printf '%s\n' 'Host filesystem evidence after settling:'
  printf '%s\n' 'Before:'
  printf '%s\n' "$DF_BEFORE"
  printf '%s\n' 'After:'
  df -h "$SHARED_ROOT" || return 1
  printf '%s\n' 'Postflight complete only if no-FD, path, inode, and measured free-space checks are satisfactory.'
}
phase2_delete
```

If any Phase 2 gate fails, do not run `rm` and abort. After deletion, path
absence alone is not success: retain the before/after `df -h` evidence, account
for delayed reclaim, and never target a parent, whole root, shared root,
backup, or checkpoint.

## Phase 1 — Same-filesystem quarantine

1. Obtain fresh explicit operator approval for the quarantine phase.
2. Recheck the identity record and pass the hard quiescence gate for the first
   target immediately before mutation; repeat for the second target.
3. Rename each validated legacy `index` directory to a recorded quarantine
   entry inside its own legacy parent on the same filesystem. Do not overwrite
   an existing quarantine entry; abort on a collision or layout change.
4. Record the quarantine path, inode, device, and parent for each renamed
   target. Do not delete anything or touch the shared root.

This phase is reversible and intentionally does **not** free space. Proceed to
restart validation only after both validated targets are quarantined.

## Restart validation and rollback

Restart OpenCode/AFT normally while the quarantine entries remain intact.
Confirm that:

- AFT uses `$HOME/.local/share/cortexkit/aft` as the active storage root;
- current indexes remain available without migration, index, or schema errors;
- the shared root's backups and checkpoints remain present; and
- no unexpected cold global re-index is triggered.

If validation fails, stop the processes, re-establish the hard quiescence gate,
and rename each quarantined entry back to its recorded original path before
further diagnosis. Do not delete anything or improvise broader cleanup.

If validation succeeds, stop OpenCode/AFT again and proceed only with the
second approval and Phase 2 gates below.

## Phase 2 — Permanent deletion

1. Obtain a second fresh explicit operator approval for permanent deletion.
2. Revalidate both quarantine identities and confirm neither original
   canonical target path has reappeared.
3. Pass the hard quiescence gate immediately before each deletion.
4. Permanently remove only the two recorded quarantine entries.

Never delete a parent directory, whole AFT root, current shared index,
`backups`, `checkpoints`, or any OpenCode/session data. Do not create a full
duplicate backup of the legacy indexes; Phase 1 quarantine is the reversible
safety mechanism.

## Postflight evidence

After Phase 2:

1. Allow a settle interval for filesystem accounting.
2. Confirm no open file descriptor retains either deleted target.
3. Confirm both quarantine entries and their recorded inodes are gone, and both
   original canonical paths remain absent.
4. Compare host free space with the preflight and Phase 1 records. Do not infer
   success from path absence alone; account for delayed reclaim.
5. Record the identity evidence, approvals, quiescence checks, restart result,
   inode/path checks, and measured free-space change. If reclaim is delayed or
   not demonstrated, report that result and do not broaden deletion.

## Sources

- [Implementation plan](../plans/2026-07-22-001-fix-aft-legacy-index-cleanup-plan.md)
- [`opencode-doctor` reference](../opencode-doctor.md)
