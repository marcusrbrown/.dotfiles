---
title: OpenCode SQLite DB bloat — prune old sessions then VACUUM
date: 2026-06-25
category: docs/solutions/performance-issues/
module: opencode
problem_type: performance_issue
component: tooling
symptoms:
  - OpenCode SQLite DB (~/.local/share/opencode/opencode.db) grew to ~13 GB
  - perceived slowness running multiple concurrent OpenCode instances
  - VACUUM alone reclaimed nothing (freelist_count=0, auto_vacuum=NONE)
root_cause: missing_tooling
resolution_type: tooling_addition
severity: high
related_components:
  - database
  - development_workflow
tags:
  - opencode
  - sqlite
  - vacuum
  - db-bloat
  - prune
  - bun-sqlite
  - maintenance
---

# OpenCode SQLite DB bloat — prune old sessions then VACUUM

## Problem

OpenCode's session DB at `~/.local/share/opencode/opencode.db` grew to ~13 GB
over ~6 months, raising performance concern with multiple concurrent OpenCode
instances. OpenCode has no built-in retention/prune path, so the DB grows
unbounded.

## Symptoms

- DB at ~13 GB; perf concern with multiple running OpenCode processes.
- `PRAGMA freelist_count` = 0 and `PRAGMA auto_vacuum` = NONE → `VACUUM` reclaims
  nothing because there are no free pages; all 13 GB is live data.
- `dbstat` breakdown: `event` ~6.7 GB, `part` ~4.9 GB, `message` ~0.7 GB.

## What Didn't Work

- **VACUUM-first premise (wrong).** The initial assumption was that VACUUM would
  shrink the file. With `freelist_count = 0` it reclaims ~0 bytes — the bloat is
  live data, not fragmentation. The WAL was also healthy (~2–4 MB), so
  `wal_checkpoint(TRUNCATE)` was marginal too.
- **Age-bucket queries without an integer cast.** `time_created` is epoch
  **milliseconds**; comparing `time_created/1000` against `strftime('%s', ...)`
  without `CAST(... AS INTEGER)` triggers SQLite's numeric-vs-text comparison and
  silently buckets every row into one group.
- **Giant `IN (?,?,...)` clauses.** With thousands of session ids this hits
  `SQLITE_MAX_VARIABLE_NUMBER` (~32766 in Bun's build, 999 in older builds).
- **`length(data)` for byte sizes.** Counts characters, not bytes, for non-ASCII.
- **Treating a `pgrep` failure as "safe".** A non-0/non-1 exit (e.g. pgrep
  unavailable) means "can't verify" and must be treated as unsafe, not safe.

## Solution

Pruning old sessions creates free pages; VACUUM then compacts the file.
Implemented as a DB-maintenance mode in
`~/.config/opencode/scripts/opencode-doctor.ts`, run via
`mise run opencode:doctor -- <flags>`:

- `--db-health` — read-only metrics (sizes, page/freelist counts, free %,
  journal mode, auto_vacuum, per-table row counts, session age histogram).
- `--prune-older=<days>` (default 30) — **dry-run by default**: reports sessions
  to delete and reclaimable bytes per table. Deletes nothing.
- `--prune-older=<days> --execute` — **IRREVERSIBLE**: prune + checkpoint + VACUUM.

Cascade order (verified against OpenCode's own delete in `core/event.ts`):

```sql
-- session -> message, part cascade via FK ON DELETE CASCADE.
-- event keys off aggregate_id = session.id with NO session FK, so delete it
-- explicitly via event_sequence (which cascades to event).
DELETE FROM event_sequence WHERE aggregate_id IN (SELECT id FROM _prune_ids);
DELETE FROM session        WHERE id           IN (SELECT id FROM _prune_ids);
-- then, OUTSIDE the transaction:
PRAGMA wal_checkpoint(TRUNCATE);
VACUUM;
```

Safety gates on `--execute`:

- Refuse if other `opencode` processes run (full VACUUM needs exclusive access;
  `classifyPgrepExitCode`: 0=has procs, 1=none, other=error→unsafe).
- Refuse if free disk < DB size × 1.1 (VACUUM needs a full-size temp copy; this
  machine has hit ENOSPC).
- Refuse `--prune-older < 1` (prevents `--prune-older=0` deleting everything).
- If VACUUM fails after the DELETE commits, still report `sessions_deleted` +
  a `vacuum_error` field — never hide that data was deleted.

Measured: pruning sessions older than 30 days = 7,048 sessions, ~5.9 GB
reclaimable (13 GB → ~7.5 GB).

## Why This Works

The real bloat is the event-sourcing log (`event`, 6.7 GB — payloads duplicate
message data) plus large `part` payloads (tool outputs / file contents), and
OpenCode never prunes (feature requests `anomalyco/opencode#22110`, `#31526`,
`#16101`). Deleting old sessions removes the underlying rows; VACUUM then has
free pages to reclaim.

Pruning events is safe **only for local-first usage** (verified against OpenCode
v1.17.11 source): session display reads `message` + `part`, not `event`
(`session.ts`, `message-v2.ts`); `event` is read for sync / cross-device replay /
`/sync/history` (`sync.ts`, `control-plane/workspace.ts`, `core/event.ts`).
Deleting events breaks those features for pruned sessions — fine if you never use
sync/share/replay.

## Prevention

- Default to dry-run; require explicit `--execute` for deletion.
- Gate destructive ops: refuse when safety can't be verified (pgrep error),
  when free disk is insufficient, or when the window is `< 1` day.
- Never hide deletion if VACUUM fails (surface `vacuum_error`).
- Reusable SQLite rules:
  - Epoch-ms comparisons: `CAST(time_created / 1000 AS INTEGER) < cutoffSec`.
  - Bulk id sets: a `TEMP TABLE` join, not a giant `IN (?,?,...)`.
  - Accurate byte sizes: `length(CAST(data AS BLOB))`, not `length(data)`.
  - `dbstat` is a full virtual-table scan — slow (minutes) on a multi-GB DB.

## Related Issues

- `docs/solutions/2026-05-22-bun-sqlite-readonly-wal-pattern.md` — sibling doc on
  read-only Bun access to the same `opencode.db` (moderate overlap: same file,
  different operation).
- Upstream: `anomalyco/opencode#22110`, `#31526`, `#16101` (DB
  maintenance / prune / storage growth feature requests).
