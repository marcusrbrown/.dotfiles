---
title: OpenCode SQLite event bloat and bounded retention
date: 2026-06-25
last_updated: 2026-07-30
category: database-issues
module: opencode-doctor
problem_type: database_issue
component: tooling
symptoms:
  - OpenCode SQLite storage grew into tens of GiB, with the event table dominating overflow pages
  - VACUUM reclaimed nothing while the database contained no free pages
  - session-tree pruning alone did not materially reduce recent event storage
  - the first event-only production run exhausted memory before issuing DELETE
  - a later run deleted event rows but returned failure before physical file-size reclaim
root_cause: missing_tooling
resolution_type: tooling_addition
severity: high
related_components:
  - database
  - development_workflow
tags:
  - opencode
  - sqlite
  - event-retention
  - db-bloat
  - incremental-vacuum
  - bun-sqlite
  - bounded-memory
---

# OpenCode SQLite event bloat and bounded retention

## Problem

OpenCode stores sessions, messages, parts, and an event-sourcing log in a local
SQLite database. It has no built-in retention policy, so the database grows
without bound. Inspection with `dbstat` showed that `event` overflow pages—not
stale session metadata—were the dominant storage consumer.

The maintenance path therefore needed two distinct modes:

- delete entire stale session trees when transcript removal is acceptable;
- delete only stale event streams while preserving sessions, messages, and
  parts.

Logical deletion and physical disk reclamation are separate outcomes. The
event-only deletion path is implemented and safety-gated, but the observed
production run did not return database file space to the filesystem.

## Symptoms

- The database grew into tens of GiB, with `event` dominating `part`, `message`,
  and `session` storage.
- `PRAGMA freelist_count = 0` meant a VACUUM-first attempt had no free pages to
  reclaim; the stored rows were live data, not fragmentation.
- Tree-aware session pruning reclaimed far less than expected because recent
  session trees still retained large event histories.
- The first event-only execution exhausted Bun's heap before deletion.
- After the memory fix, an execution deleted selected event rows but returned a
  failed result before file-size reclaim; the reported reclaimed delta remained
  zero.

## What Didn't Work

- **VACUUM before retention.** VACUUM compacts free pages; it does not create
  free pages from live data.
- **Session pruning as the only retention mechanism.** It removes transcripts
  along with events and does not address event growth for retained sessions.
- **A clone-only compatibility probe.** It added implementation overhead without
  advancing the operator's storage-reclamation task, so it was removed.
- **Materializing preservation evidence.** `SELECT * ... .all()` loaded every
  selected session, message, and part payload into JavaScript. Canonical arrays,
  sorting, and `JSON.stringify` then duplicated that data several times and
  exhausted memory before the first `DELETE`.
- **Client-side session graph construction.** Loading all session relationships
  into a `Map` increased memory pressure unnecessarily.
- **Giant variable-bound `IN` clauses.** Large candidate sets can exceed
  SQLite's variable limit; temporary tables are safer and easier to reuse.
- **Assuming incremental vacuum guarantees shrinkage.** Successful row deletion
  does not prove checkpointing, file truncation, APFS allocation release, or
  increased host free space.

## Solution

The supported implementation lives in:

- `.config/opencode/scripts/lib/opencode-session-tree-retention.ts`
- `.config/opencode/scripts/opencode-doctor.ts`
- `.config/opencode/scripts/opencode-doctor.test.ts`

### Select complete trees by last use

Session retention groups roots and descendants through `parent_id`, then uses
the maximum `time_updated` across each tree. One recently touched descendant
protects the entire tree.

```sql
WITH RECURSIVE tree(id, root_id) AS (
  SELECT id, id
  FROM session
  WHERE parent_id IS NULL
     OR parent_id NOT IN (SELECT id FROM session)

  UNION ALL

  SELECT child.id, tree.root_id
  FROM session AS child
  JOIN tree ON child.parent_id = tree.id
),
root_activity AS (
  SELECT tree.root_id, MAX(session.time_updated) AS last_used
  FROM tree
  JOIN session ON session.id = tree.id
  GROUP BY tree.root_id
)
SELECT tree.id
FROM tree
JOIN root_activity USING (root_id)
WHERE CAST(last_used / 1000 AS INTEGER) < ?;
```

Timestamps are epoch milliseconds. Cast the divided value to an integer before
comparing it with an epoch-second cutoff.

### Store candidate IDs in unique temporary tables

Each operation creates an internally generated temporary table such as
`_prune_ids_7`. The helper passes the safe identifier to its callback and drops
the table in `finally`. Unique names allow nested or concurrent operations on
the same connection without sharing mutable candidate state.
Loading candidate IDs into that `TEXT PRIMARY KEY` table also avoids SQLite
variable-count limits.

### Keep preservation proof bounded

Event-only deletion must prove that selected sessions, messages, and parts are
unchanged. Hash rows in deterministic order with SQLite iteration instead of
loading payloads into arrays:

```ts
for (const row of query.iterate()) {
  appendFramedText(digest, "row");
  for (const column of columns) {
    appendFramedValue(digest, row[column]);
  }
}
```

Length-prefixed framing distinguishes `null`, text, blobs, and field
boundaries. The proof records row counts plus SHA-256 identity/content hashes
before and after deletion, inside the same transaction. Any mismatch rolls the
transaction back. Schema checks require indexes supporting the selected-row
predicates before the expensive proof begins.

Count session trees with SQL rather than building a full client-side graph.

### Separate whole-session and event-only maintenance

`opencode-doctor` exposes two dry-run-first modes:

- `--prune-older=<days>` selects stale trees and, with `--execute`, deletes
  sessions, messages, parts, and events before a full VACUUM.
- `--prune-events-older=<days>` selects the same stale trees but, with
  `--execute`, deletes only `event_sequence` rows; the foreign-key cascade
  removes matching `event` rows while preserving transcript tables.

The event-only path requires:

- explicit `--execute`;
- no active OpenCode process holding the database;
- `auto_vacuum=INCREMENTAL`;
- the expected `event.aggregate_id -> event_sequence.aggregate_id` foreign key
  with `ON DELETE CASCADE`;
- preservation-supporting indexes;
- a fixed operational free-space floor;
- transactional transcript preservation checks;
- successful, non-busy WAL checkpoints.

It runs `PRAGMA incremental_vacuum`, never a full VACUUM. Invalid CLI state is
represented explicitly rather than with a `NaN` sentinel.

### Report mutation and reclaim separately

If deletion commits but checkpointing or incremental vacuum fails, report the
deleted row counts and a failed operation. Do not label the run refused, imply
that no mutation occurred, or claim disk space was reclaimed.

The observed production run after the bounded-memory fix deleted event streams
but reported zero database file-size reduction. Physical reclamation therefore
remains an operational follow-up, not a verified outcome of the implementation.

## Why This Works

Tree-wide last-use selection protects active descendants. Deleting parent
`event_sequence` rows uses the declared cascade to remove child `event` rows
without touching transcripts. Ordered SQL iteration keeps memory proportional
to one row, while deterministic content hashes detect count-preserving trigger
mutations. Unique temporary tables avoid variable limits and nested-call
collisions.

Together, the process, schema, index, preservation, and checkpoint gates prove
selection, deletion, and transcript preservation. They do not prove that
SQLite or the filesystem returned physical storage; measure that independently.

## Prevention

- Keep destructive database maintenance dry-run by default.
- Treat these as separate assertions:
  1. the intended rows were selected;
  2. the intended rows were deleted;
  3. protected rows were unchanged;
  4. SQLite file size decreased;
  5. host free space increased.
- Never use `.all()` or `JSON.stringify` over unbounded database payloads in a
  safety proof; stream ordered rows into a digest.
- Use SQL aggregates for counts and byte estimates instead of materializing
  rows in JavaScript.
- Use temporary candidate tables rather than giant variable-bound lists.
- Test large payloads, candidate sets above common SQLite variable limits,
  missing indexes, trigger-based count-preserving mutation, checkpoint-busy
  results, active-process refusal, and incremental-vacuum requirements.
- Preserve honest post-mutation failure reporting. A failed reclaim phase does
  not undo a committed delete.
- For physical reclamation, record database size and filesystem free space
  before and after; do not infer success from row counts or freelist changes.

## Related Issues

- `docs/solutions/2026-05-22-bun-sqlite-readonly-wal-pattern.md` — read-only Bun
  access to the same WAL-mode database.
- `docs/opencode-doctor.md` — current CLI and safety contract.
- Issue #1924 — database growth and retention follow-up.
- PR #2057 — tree-aware last-use pruning.
- PR #2165 — event-only retention, bounded preservation proof, and review
  hardening.
