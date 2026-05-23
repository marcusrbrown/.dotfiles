---
date: 2026-05-22
category: pattern
tags: [bun, sqlite, wal, read-only, opencode]
problem-area: reading a live WAL SQLite database from a Bun CLI without disturbing the writer
---

# Bun bun:sqlite read-only pattern for live WAL databases

## Problem

A Bun/TypeScript CLI needs to read OpenCode's live SQLite session store (`~/.local/share/opencode/opencode.db`, ~3.7GB, actively written by the OpenCode process via WAL mode). The CLI must:

1. Never write to the database (zero risk of corrupting OpenCode's state)
2. Not block OpenCode's writer with long-held locks
3. Handle the case where OpenCode commits a schema migration while the CLI holds a connection
4. Survive transient SQLITE_BUSY / SQLITE_LOCKED returns during WAL checkpoints or short writer transactions

Standard SQLite "open read-only" guidance is the URI mode (`file:path?mode=ro`) OR `PRAGMA query_only=ON`. Neither alone is sufficient for a connection that lives across multiple queries against a heavily-active writer.

## Solution

Defense-in-depth read-only enforcement, verified empirically at startup:

```ts
import { Database } from 'bun:sqlite';

function openReadOnly(dbPath: string): Database {
  // 1. URI mode + readonly option (the real guard — bun:sqlite honors both)
  const db = new Database(`file:${dbPath}?mode=ro`, { readonly: true });

  // 2. PRAGMA query_only as belt-and-suspenders (per-connection;
  //    enforced by the SQLite library, not the OS file mode)
  db.exec('PRAGMA query_only=ON');

  // 3. Tunable busy_timeout (5s) so transient WAL checkpoints
  //    don't surface as immediate SQLITE_BUSY errors
  db.exec('PRAGMA busy_timeout=5000');

  // 4. Runtime probe — verify read-only is *actually* active.
  //    Without this, a misconfigured connection silently allows writes.
  try {
    db.exec('CREATE TEMP TABLE _verify_readonly (x INTEGER)');
    db.exec('DROP TABLE _verify_readonly');
    db.close();
    throw new Error('Read-only enforcement failed: connection accepts writes.');
  } catch (err) {
    if (err instanceof Error && err.message.includes('Read-only enforcement failed')) {
      throw err;
    }
    // Expected: CREATE TEMP TABLE rejected because the connection is read-only.
  }

  return db;
}
```

Pair the read-only enforcement with a schema-invariant check for fail-closed behavior when OpenCode upgrades:

```ts
function assertSchemaInvariants(db: Database): void {
  const expected = {
    session: ['id', 'project_id', 'parent_id', 'time_created', 'time_updated'],
    message: ['id', 'session_id', 'time_created', 'data'],
    part: ['id', 'message_id', 'session_id', 'time_created', 'data']
  };
  for (const [table, columns] of Object.entries(expected)) {
    const cols = db.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
    const names = new Set(cols.map((c) => c.name));
    const missing = columns.filter((c) => !names.has(c));
    if (missing.length > 0) {
      throw new SchemaError(
        `${table} missing columns: ${missing.join(', ')}. ` + `OpenCode may have upgraded; re-validate the schema.`
      );
    }
  }
}
```

Per-query retry on SQLITE_BUSY / SQLITE_LOCKED:

```ts
function withBusyRetry<T>(fn: () => T, attempts = 3, backoffMs = 100): T {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('SQLITE_BUSY') && !msg.includes('SQLITE_LOCKED')) {
        throw err;
      }
      if (i < attempts - 1) Bun.sleepSync(backoffMs);
    }
  }
  throw lastErr;
}
```

## What this does not protect against

- **SQLITE_SCHEMA mid-run.** If OpenCode commits a schema migration between two queries, you'll see SQLITE_SCHEMA on the next prepare. Treat as fatal: a parser tuned for the old schema may produce garbage from new-shape rows. Exit and require re-validation. Do not retry.
- **Schema additions** (new tables, new columns). The invariant check above asserts _minimum_ columns. New optional columns won't break the check or the parser. This is the desired posture — forward-compat for additions.
- **Whole-DB corruption.** Out of scope.

## Why this matters

OpenCode is a long-running process that holds the SQLite handle and writes continuously. A naive reader CLI that opens writable and runs a query is technically safe (writes nothing) but doesn't _prove_ it. The runtime probe converts a per-connection invariant into a per-startup assertion, so we fail closed on the day someone copies this pattern and forgets `{ readonly: true }`.

The `busy_timeout` + per-query retry combination handles the realistic failure mode where OpenCode is mid-transaction or the WAL is being checkpointed.

## References

- Origin plan: `docs/plans/2026-05-22-001-feat-local-ollama-distillation-plan.md`
- Brainstorm: `docs/brainstorms/2026-05-21-local-ollama-distillation-requirements.md`
- Implementation: `.config/opencode/scripts/ollama-distill.ts`
- Tests: `.config/opencode/scripts/ollama-distill.test.ts` (read-only verification, schema-missing-column, SQLITE_BUSY retry scenarios)
- Bun SQLite docs: <https://bun.sh/docs/api/sqlite>
- Magic Context memories: 3667 (OpenCode SQLite schema), 3668 (part types + canonical SQL)
