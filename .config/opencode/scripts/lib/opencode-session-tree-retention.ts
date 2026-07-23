import type { Database } from "bun:sqlite";

let sessionIdCandidateTableSequence = 0;

function nextSessionIdCandidateTableName(): string {
  sessionIdCandidateTableSequence += 1;
  return `_prune_ids_${sessionIdCandidateTableSequence.toString(36)}`;
}

export function bytesToHuman(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(2)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(2)} KB`;
  return `${bytes} B`;
}

/**
 * Run a query or mutation against a temporary, bound-variable-safe candidate
 * table populated with session or aggregate ids.
 */
export function withSessionIdCandidateTable<T>(
  db: Database,
  sessionIds: readonly string[],
  operation: (tableName: string) => T,
): T {
  const tableName = nextSessionIdCandidateTableName();
  db.exec(`CREATE TEMP TABLE ${tableName} (id TEXT PRIMARY KEY)`);

  try {
    const insertId = db.prepare(`INSERT OR IGNORE INTO ${tableName} (id) VALUES (?)`);
    db.transaction(() => {
      for (const id of sessionIds) insertId.run(id);
    })();

    return operation(tableName);
  } finally {
    db.exec(`DROP TABLE ${tableName}`);
  }
}

/**
 * Select ids of all sessions belonging to "prunable" trees.
 *
 * A session tree (root + all descendants via parent_id) is prunable iff the
 * MAX(time_updated) across every session in the tree is older than cutoffMs —
 * i.e. no session in the tree has been used since the cutoff. If any member
 * was touched within the window, the entire tree is kept, including that
 * member's own stale siblings/ancestors/descendants.
 *
 * A session whose parent_id points at a nonexistent session (dangling
 * reference, e.g. after a prior partial prune) is treated as its own tree
 * root rather than causing an error or being silently dropped.
 */
export function selectOldSessionIds(db: Database, cutoffMs: number): string[] {
  type IdRow = { id: string };
  const cutoffSec = Math.floor(cutoffMs / 1000);
  const rows = db.query<IdRow, [number]>(`
    WITH RECURSIVE tree(id, root_id) AS (
      SELECT id, id FROM session
      WHERE parent_id IS NULL OR parent_id NOT IN (SELECT id FROM session)
      UNION ALL
      SELECT s.id, t.root_id FROM session s JOIN tree t ON s.parent_id = t.id
    ),
    root_activity AS (
      SELECT t.root_id, MAX(s.time_updated) AS last_used
      FROM tree t JOIN session s ON s.id = t.id
      GROUP BY t.root_id
    )
    SELECT t.id FROM tree t
    JOIN root_activity ra ON ra.root_id = t.root_id
    WHERE CAST(ra.last_used / 1000 AS INTEGER) < ?
  `).all(cutoffSec);
  return rows.map((r) => r.id);
}

export type ReclaimEstimate = {
  part_bytes: number;
  message_bytes: number;
  event_bytes: number;
  total_bytes: number;
  part_human: string;
  message_human: string;
  event_human: string;
  total_human: string;
};

/**
 * Estimate the byte accounting for session-owned parts, messages, and events.
 * The candidate table avoids SQLite's bound-variable limit for large trees.
 */
export function estimateReclaim(db: Database, sessionIds: readonly string[]): ReclaimEstimate {
  if (sessionIds.length === 0) {
    return {
      part_bytes: 0, message_bytes: 0, event_bytes: 0, total_bytes: 0,
      part_human: "0 B", message_human: "0 B", event_human: "0 B", total_human: "0 B",
    };
  }

  return withSessionIdCandidateTable(db, sessionIds, (tableName) => {
    type SumRow = { total: number | null };

    // Use CAST(data AS BLOB) so length() returns byte count, not character count.
    // SQLite's length() on TEXT counts Unicode code points; BLOB length is always bytes.
    const partBytes = db.query<SumRow, []>(
      `SELECT SUM(length(CAST(data AS BLOB))) AS total FROM part WHERE session_id IN (SELECT id FROM ${tableName})`
    ).get()?.total ?? 0;

    const messageBytes = db.query<SumRow, []>(
      `SELECT SUM(length(CAST(data AS BLOB))) AS total FROM message WHERE session_id IN (SELECT id FROM ${tableName})`
    ).get()?.total ?? 0;

    const eventBytes = db.query<SumRow, []>(
      `SELECT SUM(length(CAST(data AS BLOB))) AS total FROM event WHERE aggregate_id IN (SELECT id FROM ${tableName})`
    ).get()?.total ?? 0;

    const totalBytes = partBytes + messageBytes + eventBytes;

    return {
      part_bytes: partBytes,
      message_bytes: messageBytes,
      event_bytes: eventBytes,
      total_bytes: totalBytes,
      part_human: bytesToHuman(partBytes),
      message_human: bytesToHuman(messageBytes),
      event_human: bytesToHuman(eventBytes),
      total_human: bytesToHuman(totalBytes),
    };
  });
}
