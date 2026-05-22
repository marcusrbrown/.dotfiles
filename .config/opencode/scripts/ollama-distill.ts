#!/usr/bin/env bun
import { Database } from "bun:sqlite";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ExtractStats = {
  messages: number;
  text_parts: number;
  reasoning_parts: number;
  skipped_parts: number;
  skipped_types: string[];
  transcript_chars: number;
  truncated: boolean;
};

export type ExtractResult = {
  transcript: string;
  stats: ExtractStats;
};

// Envelope JSON stored in message.data
type MessageEnvelope = {
  role: string;
  [key: string]: unknown;
};

// Part data JSON stored in part.data
type PartData =
  | { type: "text"; text: string; [key: string]: unknown }
  | { type: "reasoning"; text: string; [key: string]: unknown }
  | { type: string; [key: string]: unknown };

// Raw row from the JOIN query
type TranscriptRow = {
  message_id: string;
  message_data: string;
  part_data: string | null;
  part_id: string | null;
};

// ─── Custom Errors ────────────────────────────────────────────────────────────

export class SchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaError";
  }
}

export class ReadOnlyVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadOnlyVerificationError";
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TRUNCATION_LIMIT = 60_000;
const TRUNCATION_MARKER = "\n\n[... transcript truncated for context limit]";
const BUSY_RETRY_ATTEMPTS = 3;
const BUSY_RETRY_DELAY_MS = 100;

// Expected columns per table (schema invariant)
const EXPECTED_COLUMNS: Record<string, string[]> = {
  session: ["id", "project_id", "parent_id", "time_created", "time_updated"],
  message: ["id", "session_id", "time_created", "data"],
  part: ["id", "message_id", "session_id", "time_created", "data"],
};

// ─── SQLite Reader ────────────────────────────────────────────────────────────

/**
 * Open a read-only SQLite connection with R17 hardening:
 * - URI mode with `mode=ro`
 * - PRAGMA query_only=ON
 * - PRAGMA busy_timeout=5000
 * - Read-only verification probe (CREATE TEMP TABLE must throw)
 * - Schema invariant check (fail-closed on missing columns)
 */
export function openDatabase(dbPath: string): Database {
  const uri = "file:" + dbPath + "?mode=ro";
  const db = new Database(uri, { readonly: true });

  db.exec("PRAGMA query_only=ON");
  db.exec("PRAGMA busy_timeout=5000");

  // Read-only verification probe: CREATE TEMP TABLE must throw SQLITE_READONLY.
  // If it succeeds, the connection is not truly read-only — abort immediately.
  try {
    db.exec("CREATE TEMP TABLE _verify(x)");
    db.close();
    throw new ReadOnlyVerificationError(
      "Read-only verification failed: CREATE TEMP TABLE succeeded — connection is not read-only"
    );
  } catch (err) {
    if (err instanceof ReadOnlyVerificationError) {
      throw err;
    }
    // Expected: SQLite error (SQLITE_READONLY or similar). Continue.
  }

  checkSchema(db);

  return db;
}

/**
 * Verify that all expected columns exist in each required table.
 * Throws SchemaError (fail-closed) if any column is missing.
 */
function checkSchema(db: Database): void {
  for (const [table, expectedCols] of Object.entries(EXPECTED_COLUMNS)) {
    type TableInfoRow = { name: string };
    const rows = db.query<TableInfoRow, []>(`PRAGMA table_info(${table})`).all();
    const actualCols = new Set(rows.map((r) => r.name));

    for (const col of expectedCols) {
      if (!actualCols.has(col)) {
        throw new SchemaError(
          `Schema invariant violated: table '${table}' is missing column '${col}'`
        );
      }
    }
  }
}

// ─── Transcript Extraction ────────────────────────────────────────────────────

/**
 * Extract a role-labeled transcript from a session.
 *
 * SQL groups message rows with their parts via LEFT JOIN. Parts are ordered
 * chronologically. Each text/reasoning part emits a labeled line; other types
 * are counted as skipped. Truncates at 60K chars.
 *
 * Retries on SQLITE_BUSY/SQLITE_LOCKED up to 3 times with 100ms backoff.
 */
export async function extractTranscript(
  db: Database,
  sessionId: string
): Promise<ExtractResult> {
  const sql = `
    SELECT
      m.id        AS message_id,
      m.data      AS message_data,
      p.id        AS part_id,
      p.data      AS part_data
    FROM message m
    LEFT JOIN part p ON p.message_id = m.id
    WHERE m.session_id = ?
    ORDER BY m.time_created ASC, p.time_created ASC, p.id ASC
  `;

  let rows: TranscriptRow[];
  let lastError: unknown;

  for (let attempt = 0; attempt < BUSY_RETRY_ATTEMPTS; attempt++) {
    try {
      rows = db.query<TranscriptRow, [string]>(sql).all(sessionId);
      lastError = undefined;
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("SQLITE_BUSY") || msg.includes("SQLITE_LOCKED")) {
        lastError = err;
        if (attempt < BUSY_RETRY_ATTEMPTS - 1) {
          await new Promise((r) => setTimeout(r, BUSY_RETRY_DELAY_MS));
        }
        continue;
      }
      if (msg.includes("SQLITE_SCHEMA")) {
        throw new SchemaError(`Schema changed during query: ${msg}`);
      }
      throw err;
    }
  }

  if (lastError !== undefined) {
    throw lastError;
  }

  // rows is guaranteed assigned here (either set or lastError thrown)
  return buildTranscript(rows!);
}

function buildTranscript(rows: TranscriptRow[]): ExtractResult {
  const stats: ExtractStats = {
    messages: 0,
    text_parts: 0,
    reasoning_parts: 0,
    skipped_parts: 0,
    skipped_types: [],
    transcript_chars: 0,
    truncated: false,
  };

  // Group rows by message_id preserving insertion order
  const messageOrder: string[] = [];
  const messageMap = new Map<string, { envelope: MessageEnvelope; partRows: TranscriptRow[] }>();

  for (const row of rows) {
    if (!messageMap.has(row.message_id)) {
      messageOrder.push(row.message_id);

      let envelope: MessageEnvelope;
      try {
        envelope = JSON.parse(row.message_data) as MessageEnvelope;
      } catch {
        envelope = { role: "unknown" };
      }

      messageMap.set(row.message_id, { envelope, partRows: [] });
    }

    if (row.part_id !== null) {
      messageMap.get(row.message_id)!.partRows.push(row);
    }
  }

  const skippedTypesSet = new Set<string>();
  const lines: string[] = [];
  let totalChars = 0;
  let truncated = false;

  for (const msgId of messageOrder) {
    const { envelope, partRows } = messageMap.get(msgId)!;
    const role = String(envelope.role ?? "unknown").toUpperCase();
    stats.messages++;

    for (const row of partRows) {
      let partData: PartData;
      try {
        partData = JSON.parse(row.part_data!) as PartData;
      } catch {
        // Malformed JSON — skip this part
        stats.skipped_parts++;
        skippedTypesSet.add("malformed_json");
        continue;
      }

      let line: string;
      if (partData.type === "text") {
        line = `${role}: ${(partData as { type: "text"; text: string }).text}`;
        stats.text_parts++;
      } else if (partData.type === "reasoning") {
        line = `${role} [reasoning]: ${(partData as { type: "reasoning"; text: string }).text}`;
        stats.reasoning_parts++;
      } else {
        stats.skipped_parts++;
        skippedTypesSet.add(partData.type ?? "unknown");
        continue;
      }

      const lineWithNewline = lines.length === 0 ? line : "\n" + line;
      const newTotal = totalChars + lineWithNewline.length;

      if (newTotal > TRUNCATION_LIMIT) {
        truncated = true;
        break;
      }

      lines.push(line);
      totalChars = newTotal;
    }

    if (truncated) break;
  }

  let transcript = lines.join("\n");
  if (truncated) {
    transcript += TRUNCATION_MARKER;
  }

  stats.skipped_types = Array.from(skippedTypesSet);
  stats.transcript_chars = transcript.length;
  stats.truncated = truncated;

  return { transcript, stats };
}
