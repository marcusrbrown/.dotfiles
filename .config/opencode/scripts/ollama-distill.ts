#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { mkdirSync, renameSync, existsSync, appendFileSync, openSync, closeSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

// ─── Types ────────────────────────────────────────────────────────────────────

export type MessageSegment = {
  role: "USER" | "ASSISTANT";  // matches the existing prefix format
  text: string;                 // the body of this segment (no leading "USER:" line)
  char_count: number;
};

export type ExtractStats = {
  messages: number;
  text_parts: number;
  reasoning_parts: number;
  skipped_parts: number;
  skipped_types: string[];
  transcript_chars: number;
  truncated: boolean;           // now means "a single message exceeded the hard cap and got truncated mid-message"
  segments_total: number;       // NEW
  segments_truncated: number;   // NEW — usually 0
};

export type ExtractResult = {
  transcript: string;           // existing — concatenated USER:/ASSISTANT: lines, unchanged shape
  segments: MessageSegment[];   // NEW — for the chunker
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

const TRUNCATION_MARKER = "\n\n[... transcript truncated for context limit]";
// Per-segment hard cap: if a single message body exceeds this, it gets prefix-truncated.
// The chunker enforces 70K per CHUNK; segments are smaller than chunks.
const SEGMENT_HARD_CAP = 70_000;
// Overhead per segment when reconstructing transcript (role prefix + newline)
const ROLE_PREFIX_OVERHEAD = 12; // "ASSISTANT: \n" is 12 chars; "USER: \n" is 7; use 12 as safe upper bound
const BUSY_RETRY_ATTEMPTS = 3;
const BUSY_RETRY_DELAY_MS = 100;

// Expected columns per table (schema invariant)
const EXPECTED_COLUMNS: Record<string, string[]> = {
  session: ["id", "project_id", "parent_id", "time_created", "time_updated"],
  message: ["id", "session_id", "time_created", "data"],
  part: ["id", "message_id", "session_id", "time_created", "data"],
};

// ─── SQLite Busy Retry Helper ─────────────────────────────────────────────────

/**
 * Wrap a synchronous SQLite call with SQLITE_BUSY/SQLITE_LOCKED retry logic.
 * Retries up to `attempts` times with `backoffMs` delay between attempts.
 */
export async function withSqliteBusyRetry<T>(
  fn: () => T,
  attempts = BUSY_RETRY_ATTEMPTS,
  backoffMs = BUSY_RETRY_DELAY_MS
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("SQLITE_BUSY") || msg.includes("SQLITE_LOCKED")) {
        lastError = err;
        if (attempt < attempts - 1) {
          await new Promise((r) => setTimeout(r, backoffMs));
        }
        continue;
      }
      if (msg.includes("SQLITE_SCHEMA")) {
        throw new SchemaError(`Schema changed during query: ${msg}`);
      }
      throw err;
    }
  }
  throw lastError;
}

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
  //
  // This probe is bun:sqlite-specific. Standard SQLite routes TEMP tables to a
  // separate temp file that bypasses the main-db read-only enforcement, but
  // bun:sqlite with `{ readonly: true }` + `mode=ro` rejects TEMP writes too
  // (verified empirically). If a future Bun release changes that, the probe
  // will silently stop rejecting and leave the connection unverified — re-test
  // this after Bun upgrades and consider switching to a probe that writes to
  // a main-db table (which always honors read-only).
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
 * are counted as skipped. Truncates at 60K chars (keeping prefix + marker).
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

  const rows = await withSqliteBusyRetry(() =>
    db.query<TranscriptRow, [string]>(sql).all(sessionId)
  );

  // rows is guaranteed assigned here (either set or exception thrown)
  return buildTranscript(rows);
}

// Fix #10: Type-narrowing parse helpers for stored JSON rows

/**
 * Parse a part.data JSON string with type narrowing.
 * Returns null on malformed JSON or unexpected shape.
 */
function parsePartData(raw: string): PartData | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && "type" in parsed) {
      return parsed as PartData;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Parse a message.data JSON string with type narrowing.
 * Returns null on malformed JSON or missing role field.
 */
function parseMessageEnvelope(raw: string): MessageEnvelope | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "role" in parsed &&
      typeof (parsed as { role: unknown }).role === "string"
    ) {
      return parsed as MessageEnvelope;
    }
    return null;
  } catch {
    return null;
  }
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
    segments_total: 0,
    segments_truncated: 0,
  };

  // Group rows by message_id preserving insertion order
  const messageOrder: string[] = [];
  const messageMap = new Map<string, { envelope: MessageEnvelope; partRows: TranscriptRow[] }>();

  for (const row of rows) {
    if (!messageMap.has(row.message_id)) {
      messageOrder.push(row.message_id);

      // Fix #10: Use type-narrowing parse helper; skip malformed rows with warning
      const envelope = parseMessageEnvelope(row.message_data);
      if (envelope === null) {
        process.stderr.write(
          `Warning: malformed message.data for message_id=${row.message_id}, skipping\n`
        );
        messageMap.set(row.message_id, { envelope: { role: "unknown" }, partRows: [] });
      } else {
        messageMap.set(row.message_id, { envelope, partRows: [] });
      }
    }

    if (row.part_id !== null) {
      messageMap.get(row.message_id)!.partRows.push(row);
    }
  }

  const skippedTypesSet = new Set<string>();
  const segments: MessageSegment[] = [];
  const lines: string[] = [];

  for (const msgId of messageOrder) {
    const { envelope, partRows } = messageMap.get(msgId)!;
    const rawRole = String(envelope.role ?? "unknown").toUpperCase();
    // Normalize role to USER or ASSISTANT for segments; fall back to USER for unknown
    const segRole: "USER" | "ASSISTANT" = rawRole === "ASSISTANT" ? "ASSISTANT" : "USER";
    stats.messages++;

    for (const row of partRows) {
      // Fix #10: Use type-narrowing parse helper; skip malformed parts with warning
      const partData = parsePartData(row.part_data!);
      if (partData === null) {
        process.stderr.write(
          `Warning: malformed part.data for part_id=${row.part_id}, skipping\n`
        );
        stats.skipped_parts++;
        skippedTypesSet.add("malformed_json");
        continue;
      }

      let segText: string;
      let linePrefix: string;
      if (partData.type === "text") {
        segText = (partData as { type: "text"; text: string }).text;
        linePrefix = `${rawRole}: `;
        stats.text_parts++;
      } else if (partData.type === "reasoning") {
        segText = (partData as { type: "reasoning"; text: string }).text;
        linePrefix = `${rawRole} [reasoning]: `;
        stats.reasoning_parts++;
      } else {
        stats.skipped_parts++;
        skippedTypesSet.add(partData.type ?? "unknown");
        continue;
      }

      // Fix #1: Per-segment hard cap — if a single message body exceeds SEGMENT_HARD_CAP,
      // prefix-truncate that ONE segment and flag it. Other segments stay intact.
      let finalSegText = segText;
      let segTruncated = false;
      if (segText.length > SEGMENT_HARD_CAP) {
        const available = SEGMENT_HARD_CAP - TRUNCATION_MARKER.length;
        finalSegText = segText.slice(0, available) + TRUNCATION_MARKER;
        segTruncated = true;
        stats.segments_truncated++;
        stats.truncated = true;
      }

      segments.push({
        role: segRole,
        text: finalSegText,
        char_count: finalSegText.length,
      });

      // Build the concatenated transcript line (backward-compat)
      const line = linePrefix + finalSegText;
      lines.push(line);

      if (segTruncated) {
        // Don't break — other messages still get processed into segments
      }
    }
  }

  const transcript = lines.join("\n");

  stats.skipped_types = Array.from(skippedTypesSet);
  stats.segments_total = segments.length;
  stats.transcript_chars = transcript.length;

  return { transcript, segments, stats };
}

// ─── Chunker ──────────────────────────────────────────────────────────────────

// Per-chunk independence is intentional. Sessions where context built up in
// chunk N only pays off in chunk N+1 will produce a thinner second block.
// 8B models hallucinate or lose coherence when given a "consolidate previous
// summaries" pass, so this pipeline accepts the lossy boundary as a tradeoff
// for predictable per-chunk quality. See PR #1707 for rationale.

/**
 * Split an ordered list of MessageSegments into chunks for independent
 * Ollama inference.
 *
 * Algorithm: greedy packing with a single size threshold.
 * 1. Start a new chunk: current = [], currentChars = 0.
 * 2. For each segment:
 *    a. Compute segment size: seg.char_count + ROLE_PREFIX_OVERHEAD.
 *    b. If current is empty: always push the segment (even if it alone exceeds
 *       targetChars — extractTranscript already truncated it to SEGMENT_HARD_CAP).
 *    c. If currentChars + segSize > targetChars: finalize current chunk, start
 *       a new chunk with this segment.
 *    d. Else: append to current.
 * 3. Finalize last chunk if non-empty.
 *
 * Default targetChars is 55K. Single segments larger than that go into their
 * own chunk; extractTranscript pre-truncates each segment to SEGMENT_HARD_CAP
 * (70K) so oversized lone segments are still bounded.
 */
export function chunkSegments(
  segments: MessageSegment[],
  targetChars = 55_000
): MessageSegment[][] {
  const chunks: MessageSegment[][] = [];
  let current: MessageSegment[] = [];
  let currentChars = 0;

  for (const seg of segments) {
    const segSize = seg.char_count + ROLE_PREFIX_OVERHEAD;

    if (current.length === 0) {
      // Always push at least one segment per chunk — even if it alone exceeds
      // targetChars. extractTranscript already truncated it to SEGMENT_HARD_CAP.
      current.push(seg);
      currentChars += segSize;
      continue;
    }

    if (currentChars + segSize > targetChars) {
      // Would exceed target: finalize current chunk, start new one with this segment.
      // Single segments larger than targetChars are already truncated by
      // extractTranscript to SEGMENT_HARD_CAP, so they fit when alone in a fresh chunk.
      chunks.push(current);
      current = [seg];
      currentChars = segSize;
    } else {
      current.push(seg);
      currentChars += segSize;
    }
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

/**
 * Reconstruct the USER: .../ASSISTANT: ... transcript string from a chunk's
 * segments. Matches the exact format extractTranscript produces.
 */
export function renderChunkTranscript(segments: MessageSegment[]): string {
  return segments
    .map((seg) => `${seg.role}: ${seg.text}`)
    .join("\n");
}

// ─── Cursor ───────────────────────────────────────────────────────────────────

export type Cursor = {
  last_run_timestamp: number | null;
};

const CURSOR_FILENAME = "cursor.json";
const CURSOR_TMP_FILENAME = "cursor.json.tmp";
const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;

export async function loadCursor(stateDir: string): Promise<Cursor> {
  const cursorPath = stateDir + "/" + CURSOR_FILENAME;
  if (existsSync(cursorPath)) {
    try {
      return await Bun.file(cursorPath).json() as Cursor;
    } catch {
      // Corrupted file — bootstrap
    }
  }
  return { last_run_timestamp: Date.now() - SEVEN_DAYS_MS };
}

export async function saveCursor(stateDir: string, cursor: Cursor): Promise<void> {
  mkdirSync(stateDir, { recursive: true });
  const tmpPath = stateDir + "/" + CURSOR_TMP_FILENAME;
  const finalPath = stateDir + "/" + CURSOR_FILENAME;
  await Bun.write(tmpPath, JSON.stringify(cursor) + "\n");
  renameSync(tmpPath, finalPath);
}

// ─── Session Selection ────────────────────────────────────────────────────────

export type SessionRow = {
  id: string;
  time_updated: number;
};

export type SelectedSession = {
  id: string;
  time_updated: number;
  transcript: string;
  segments: MessageSegment[];
  stats: ExtractStats;
};

export type SelectionResult = {
  sessions: SelectedSession[];
  max_processed_time_updated: number;
};

export async function selectSessions(
  db: Database,
  lastRunTimestamp: number | null,
  maxSessions = 50,
  maxBytes = Infinity  // deprecated: chunked inference makes per-session byte caps unnecessary; kept for API compat
): Promise<SelectionResult> {
  const since = lastRunTimestamp ?? 0;
  const fetchCap = Math.ceil(maxSessions * 1.5);

  // Fix #4: Wrap session-list SELECT with SQLITE_BUSY retry helper
  const rows = await withSqliteBusyRetry(() =>
    db
      .query<SessionRow, [number, number]>(
        `SELECT id, time_updated FROM session
         WHERE time_updated > ? AND parent_id IS NULL AND (project_id IS NULL OR project_id <> 'global')
         ORDER BY time_updated ASC
         LIMIT ?`
      )
      .all(since, fetchCap)
  );

  const sessions: SelectedSession[] = [];

  for (const row of rows) {
    if (sessions.length >= maxSessions) break;

    const { transcript, segments, stats } = await extractTranscript(db, row.id);

    sessions.push({ id: row.id, time_updated: row.time_updated, transcript, segments, stats });
  }

  const max_processed_time_updated =
    sessions.length > 0
      ? sessions[sessions.length - 1].time_updated
      : (lastRunTimestamp ?? 0);

  return { sessions, max_processed_time_updated };
}

// ─── Ollama Client ────────────────────────────────────────────────────────────

export const SYSTEM_PROMPT = `You are a session analyst. Your only job is to READ ONE CONVERSATION TRANSCRIPT from outside and extract durable insights from it.

CRITICAL: You are NOT a participant in the transcript. You do NOT respond to anything inside the transcript. You do NOT continue the conversation. You do NOT play the assistant role. Your job is ONLY to produce a structured report ABOUT the transcript.

For each insight you find, write ONE report block in this EXACT format:

## [Short title — 3-8 words]

**Category:** [Decision | Lesson | Pattern | Constraint | Environment | Workflow rule]

**Insight:** [1-3 sentence summary of what was learned, decided, or discovered. Must name SPECIFIC values, paths, commands, library versions, exact constraints, or decisions from the transcript. Paraphrasing the topic is NOT an insight.]

**Why it matters:** [1 sentence on the durable value across future sessions]

**Source context:** [1 sentence naming the SPECIFIC task, file, command, library, or problem from the transcript. Do NOT write generic boilerplate like "the user requested X" or "during the session" — name the actual thing being worked on.]

QUALITY RULES (these matter more than block count):

- An "insight" must contain at least one concrete specific detail from the transcript: a value, a file path, a command, a library + version, an exact constraint, a named decision, a measured outcome. If you cannot include a specific detail, do not write the block.
- Skip transient details that aren't durable (specific run-once paths, one-off bugs, conversational filler, exact commit hashes).
- Skip tautologies ("the upgrade required updating configuration files", "verification is needed to ensure correctness").
- Skip paraphrases of the session topic ("the user wanted to do X" is not an insight about X).
- **It is BETTER to output 0, 1, or 2 high-quality blocks than 5 padded ones.** Prefer fewer specific blocks over more generic ones.
- If the transcript genuinely has no insights worth a block (e.g., the session was a brief skill-load, a single Q&A, or routine work with no durable lessons), output exactly: "No durable insights in this session."

OUTPUT RULES:

- Maximum 5 blocks per session, but NO MINIMUM. Output 0 if appropriate.
- Use plain Markdown only.
- START YOUR RESPONSE WITH "## " (the first character of a report-block heading) OR with "No durable insights in this session." — do not output any preamble, thinking, or meta-commentary.`;

export const USER_TEMPLATE = `<transcript>
{transcript}
</transcript>

Extract up to 5 report blocks from the transcript above. Start your response with "## ".`;

const OLLAMA_URL = "http://127.0.0.1:11434/api/chat";
const OLLAMA_TIMEOUT_MS = 600_000;  // 10 min — empirically chunks take ~1m50s; 10x cap covers slow chunks without unbounded hang

export type OllamaResult = {
  output: string;
  durationMs: number;
  error?: string;
};

export async function callOllama(
  transcript: string,
  model = "qwen3:8b"
): Promise<OllamaResult> {
  const start = Date.now();

  const payload = {
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: USER_TEMPLATE.replace("{transcript}", transcript) },
    ],
    stream: false,
    think: false,
    options: { temperature: 0.3, num_ctx: 32768 },
  };

  let response: Response;
  try {
    response = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
    });
  } catch (err) {
    const durationMs = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = err instanceof Error && err.name === "TimeoutError";
    return {
      output: "",
      durationMs,
      error: isTimeout ? "timeout: Ollama did not respond within 600s" : `network error: ${msg}`,
    };
  }

  const durationMs = Date.now() - start;

  if (!response.ok) {
    return {
      output: "",
      durationMs,
      error: `HTTP ${response.status}: ${response.statusText}`,
    };
  }

  // Fix #9: Parse and narrow the Ollama response shape instead of asserting
  let rawBody: unknown;
  try {
    rawBody = await response.json();
  } catch (err) {
    return {
      output: "",
      durationMs,
      error: `failed to parse Ollama response JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Narrow: expect { message: { content: string } }
  if (
    typeof rawBody !== "object" ||
    rawBody === null ||
    !("message" in rawBody) ||
    typeof (rawBody as { message: unknown }).message !== "object" ||
    (rawBody as { message: unknown }).message === null ||
    !("content" in (rawBody as { message: object }).message) ||
    typeof ((rawBody as { message: { content: unknown } }).message.content) !== "string"
  ) {
    return {
      output: "",
      durationMs,
      error: "malformed-response: missing message.content string in Ollama response",
    };
  }

  const content = (rawBody as { message: { content: string } }).message.content;
  if (!content) {
    return { output: "", durationMs, error: "empty response" };
  }

  return { output: content, durationMs };
}

// ─── Report Writer ────────────────────────────────────────────────────────────

export type SessionResult = {
  sessionId: string;
  title: string;
  ollamaOutput: string;
};

// Fix #8: Atomic write helper
async function atomicWrite(path: string, content: string): Promise<void> {
  const tmpPath = path + ".tmp";
  await Bun.write(tmpPath, content);
  renameSync(tmpPath, path);
}

export async function writeReport(
  reportPath: string,
  runs: SessionResult[]
): Promise<void> {
  mkdirSync(dirname(reportPath), { recursive: true });

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const timeStr = now.toTimeString().slice(0, 5);  // HH:MM

  const blocks = runs
    .map((r) => `### ${r.title} (${r.sessionId})\n\n${r.ollamaOutput}\n\n`)
    .join("");

  // Fix #8: Use atomic write for report (read + concat + atomic write)
  if (existsSync(reportPath)) {
    const existing = await Bun.file(reportPath).text();
    const separator = `\n\n---\n\n## Run at ${timeStr}\n\n`;
    await atomicWrite(reportPath, existing + separator + blocks);
  } else {
    const header = `# Distillation Report — ${dateStr}\n\n`;
    await atomicWrite(reportPath, header + blocks);
  }
}

// ─── JSONL Run Log ────────────────────────────────────────────────────────────

export type RunError = {
  session_id: string;
  phase: string;
  message: string;
};

export type RunRecord = {
  ts: string;           // RFC 3339
  ts_ms: number;        // epoch ms
  duration_ms: number;
  mode: "normal" | "session";
  model: string;
  sessions_read: number;
  report_blocks_generated: number;
  report_path: string;
  success: boolean;
  errors: RunError[];
};

export async function appendRunLog(logPath: string, record: RunRecord): Promise<void> {
  mkdirSync(dirname(logPath), { recursive: true });
  const line = JSON.stringify(record) + "\n";
  appendFileSync(logPath, line, "utf8");
}

// ─── CLI: Flag Parser ─────────────────────────────────────────────────────────

export type ParsedArgs = {
  since?: number;       // epoch ms
  session?: string;
  out?: string;
  extractOnly: boolean;
  help: boolean;
  unknownFlag?: string;
  flagError?: string;   // Fix #6: validation error for invalid flag values
};

/**
 * Parse CLI argv (pass Bun.argv.slice(2) or the raw Bun.argv — we skip the
 * first two elements internally).
 */
export function parseArgs(argv: string[]): ParsedArgs {
  // Skip interpreter + script path if argv looks like Bun.argv (starts with bun path)
  const args = argv[0]?.includes("bun") || argv[0]?.endsWith(".ts") || argv[0]?.endsWith(".js")
    ? argv.slice(2)
    : argv;

  const result: ParsedArgs = { extractOnly: false, help: false };

  // Fix #7: Track seen flags to detect duplicates
  const seenFlags = new Set<string>();

  for (const arg of args) {
    // Fix #7: Reject positional arguments (anything not starting with --)
    if (!arg.startsWith("--") && arg !== "-h") {
      result.flagError = `Unexpected positional argument: '${arg}'. Use --flag=value syntax.`;
      return result;
    }

    if (arg === "--help" || arg === "-h") {
      result.help = true;
      continue;
    }
    if (arg === "--extract-only") {
      if (seenFlags.has("--extract-only")) {
        result.flagError = `Duplicate flag: --extract-only`;
        return result;
      }
      seenFlags.add("--extract-only");
      result.extractOnly = true;
      continue;
    }
    if (arg.startsWith("--since=")) {
      if (seenFlags.has("--since")) {
        result.flagError = `Duplicate flag: --since`;
        return result;
      }
      seenFlags.add("--since");
      const value = arg.slice("--since=".length);
      // Fix #7: Reject empty values
      if (value === "") {
        result.flagError = `Empty value for --since. Use --since=<value>.`;
        return result;
      }
      // Fix #6: parseSince returns null on unparseable input
      const parsed = parseSince(value);
      if (parsed === null) {
        result.flagError = `Invalid --since value: '${value}'. Accepted formats: epoch ms (e.g. 1779438773648), ISO date (e.g. 2026-05-21), relative days (e.g. 7d).`;
        return result;
      }
      result.since = parsed;
      continue;
    }
    if (arg.startsWith("--session=")) {
      if (seenFlags.has("--session")) {
        result.flagError = `Duplicate flag: --session`;
        return result;
      }
      seenFlags.add("--session");
      const value = arg.slice("--session=".length);
      // Fix #7: Reject empty values
      if (value === "") {
        result.flagError = `Empty value for --session. Use --session=<id>.`;
        return result;
      }
      result.session = value;
      continue;
    }
    if (arg.startsWith("--out=")) {
      if (seenFlags.has("--out")) {
        result.flagError = `Duplicate flag: --out`;
        return result;
      }
      seenFlags.add("--out");
      const value = arg.slice("--out=".length);
      // Fix #7: Reject empty values
      if (value === "") {
        result.flagError = `Empty value for --out. Use --out=<path>.`;
        return result;
      }
      result.out = value;
      continue;
    }
    if (arg.startsWith("--")) {
      result.unknownFlag = arg;
      break;
    }
  }

  return result;
}

/**
 * Parse --since value. Accepts:
 * - "7d", "30d" → relative days
 * - "2026-05-15" → ISO date (start of day UTC)
 * - "1747267200000" → epoch ms (>1_000_000_000_000)
 *
 * Fix #6: Returns null on unparseable input (instead of 0).
 */
function parseSince(value: string): number | null {
  // Relative: Nd
  const relMatch = /^(\d+)d$/.exec(value);
  if (relMatch) {
    const days = parseInt(relMatch[1], 10);
    return Date.now() - days * 24 * 3600 * 1000;
  }

  // Epoch ms: large integer
  const asNum = Number(value);
  if (!isNaN(asNum) && asNum > 1_000_000_000_000) {
    return asNum;
  }

  // ISO date: YYYY-MM-DD
  const isoMatch = /^\d{4}-\d{2}-\d{2}$/.exec(value);
  if (isoMatch) {
    return new Date(value + "T00:00:00.000Z").getTime();
  }

  // ISO datetime: try Date.parse for full ISO strings like 2026-05-21T00:00:00Z
  const parsed = Date.parse(value);
  if (!isNaN(parsed) && value.includes("T")) return parsed;

  // Fix #6: Can't parse — return null (caller will emit error)
  return null;
}

// ─── CLI: Usage Text ──────────────────────────────────────────────────────────

const USAGE = `ollama-distill — Distill recent OpenCode sessions into a Markdown report.

USAGE:
  ollama-distill [OPTIONS]
  mise run distill -- [OPTIONS]                # note: -- separator forwards flags through mise

OPTIONS:
  --since=<value>     Recency filter override. Accepts: '7d', '2026-05-15', or epoch ms.
                      Cursor still advances after success.
  --session=<id>      Process exactly one session (non-mutating: skips cursor read/write,
                      writes to stdout unless --out provided).
  --out=<path>        Override report destination (or stdout target in --session mode).
  --extract-only      Print extracted transcript(s) to stdout; skip Ollama call.
                      Useful for debugging the extractor.
  --help              Show this message.

EXAMPLES:
  mise run distill                                          # normal run; reads cursor, writes today's report
  mise run distill -- --since=7d                           # backfill the last 7 days
  mise run distill -- --session=ses_xxx                    # debug one session, output to stdout
  mise run distill -- --session=ses_xxx --out=/tmp/x.md
  mise run distill -- --extract-only --session=ses_xxx     # see extracted transcript only

OLLAMA REQUIREMENTS:
  - \`ollama serve\` must be running locally at 127.0.0.1:11434
  - \`qwen3:8b\` model must be pulled (ollama pull qwen3:8b)
`;

// ─── CLI: Ollama Health Check ─────────────────────────────────────────────────

const OLLAMA_TAGS_URL = "http://127.0.0.1:11434/api/tags";

export async function checkOllamaReachable(): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(OLLAMA_TAGS_URL, {
      signal: AbortSignal.timeout(2000),
    });
    if (response.ok) {
      return { ok: true };
    }
    return { ok: false, error: `HTTP ${response.status}: ${response.statusText}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

// ─── File Lock ────────────────────────────────────────────────────────────────

/**
 * Acquire a file-based lock using O_EXCL semantics.
 * Returns the lock path on success, throws if already held.
 *
 * Fix #2: Prevents concurrent normal-mode runs.
 */
export function acquireLock(stateDir: string): string {
  const lockPath = join(stateDir, ".lock");
  mkdirSync(stateDir, { recursive: true });
  try {
    const fd = openSync(lockPath, "wx");
    closeSync(fd);
    // Write PID + timestamp as lock content
    writeFileSync(lockPath, `${process.pid}\n${new Date().toISOString()}\n`);
    return lockPath;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("EEXIST")) {
      throw new Error(
        `another distill run is in progress (lock at ${lockPath}); remove it manually if stale`
      );
    }
    throw err;
  }
}

export function releaseLock(lockPath: string): void {
  try {
    if (existsSync(lockPath)) {
      unlinkSync(lockPath);
    }
  } catch {
    // Best-effort cleanup
  }
}

// ─── CLI: Main Entry ──────────────────────────────────────────────────────────

const MODEL = "qwen3:8b";

type WriteStream = (s: string) => void;

export async function main(
  argv: string[] = Bun.argv,
  stdout: WriteStream = (s) => process.stdout.write(s),
  stderr: WriteStream = (s) => process.stderr.write(s)
): Promise<number> {
  const startMs = Date.now();

  try {
    const args = parseArgs(argv);

    // --help
    if (args.help) {
      stdout(USAGE);
      return 0;
    }

    // Fix #6/#7: Flag validation errors
    if (args.flagError) {
      stderr(`Error: ${args.flagError}\n\n${USAGE}`);
      return 1;
    }

    // Unknown flag
    if (args.unknownFlag) {
      stderr(`Unknown flag: ${args.unknownFlag}\n\n${USAGE}`);
      return 1;
    }

    const stateDir =
      process.env.OLLAMA_DISTILL_STATE_DIR ??
      join(homedir(), ".local/state/ollama-distill");

    const logPath = join(stateDir, "runs.jsonl");

    // Fix #5: finalize helper — writes JSONL record then returns exit code
    async function finalize(record: RunRecord, exitCode: 0 | 1): Promise<number> {
      try {
        await appendRunLog(logPath, record);
      } catch {
        // Best-effort: don't mask the original error
      }
      return exitCode;
    }

    // ── --session mode (non-mutating) ────────────────────────────────────────
    if (args.session) {
      const sessionId = args.session;

      // Find the OpenCode DB
      const dbPath = findOpenCodeDb();
      if (!dbPath) {
        stderr("Could not locate OpenCode SQLite database.\n");
        return 1;
      }

      let db: Database;
      try {
        db = openDatabase(dbPath);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        stderr(`Failed to open database: ${msg}\n`);
        return 1;
      }

      let extractResult: { transcript: string; segments: MessageSegment[]; stats: ExtractStats };
      try {
        extractResult = await extractTranscript(db, sessionId);
      } catch (err) {
        db.close();
        const msg = err instanceof Error ? err.message : String(err);
        stderr(`Failed to extract transcript for ${sessionId}: ${msg}\n`);
        return 1;
      }
      db.close();

      const { transcript, segments: sessionSegments } = extractResult;

      // --extract-only: skip Ollama
      if (args.extractOnly) {
        if (args.out) {
          await Bun.write(args.out, transcript + "\n");
        } else {
          stdout(transcript + "\n");
        }
        return 0;
      }

      // Health check (unless --extract-only)
      const health = await checkOllamaReachable();
      if (!health.ok) {
        stderr(
          `ollama serve not reachable at 127.0.0.1:11434. Start it with: ollama serve &\n(${health.error})\n`
        );
        return 1;
      }

      const sessionChunks = chunkSegments(sessionSegments);
      const sessionChunkBlocks: string[] = [];
      let sessionChunkError: string | undefined;

      for (let c = 0; c < sessionChunks.length; c++) {
        const chunkTranscript = renderChunkTranscript(sessionChunks[c]);
        const ollamaResult = await callOllama(chunkTranscript, MODEL);
        if (ollamaResult.error) {
          sessionChunkError = `chunk ${c + 1}/${sessionChunks.length}: ${ollamaResult.error}`;
          break;
        }
        sessionChunkBlocks.push(ollamaResult.output);
      }

      // If no chunks (empty transcript), treat as success with empty output
      if (sessionChunks.length === 0) {
        sessionChunkBlocks.push("");
      }

      const durationMs = Date.now() - startMs;

      const record: RunRecord = {
        ts: new Date().toISOString(),
        ts_ms: Date.now(),
        duration_ms: durationMs,
        mode: "session",
        model: MODEL,
        sessions_read: 1,
        report_blocks_generated: sessionChunkError ? 0 : sessionChunkBlocks.length,
        report_path: args.out ?? "stdout",
        success: !sessionChunkError,
        errors: sessionChunkError
          ? [{ session_id: sessionId, phase: "ollama", message: sessionChunkError }]
          : [],
      };

      await appendRunLog(logPath, record);

      if (sessionChunkError) {
        stderr(`Ollama error for ${sessionId}: ${sessionChunkError}\n`);
        return 1;
      }

      const sessionHeader = sessionChunks.length > 1
        ? `### Session ${sessionId} (${sessionChunks.length} chunks)\n\n`
        : `### Session ${sessionId}\n\n`;
      const output = sessionHeader + sessionChunkBlocks.join("\n\n") + "\n";
      if (args.out) {
        await Bun.write(args.out, output);
      } else {
        stdout(output);
      }

      return 0;
    }

    // ── Normal mode ──────────────────────────────────────────────────────────

    // Fix #2: Acquire file lock for normal mode
    let lockPath: string | null = null;
    try {
      lockPath = acquireLock(stateDir);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      stderr(`${msg}\n`);
      return 1;
    }

    // Register cleanup handlers for lock release
    const cleanupLock = () => {
      if (lockPath) releaseLock(lockPath);
    };
    process.on("exit", cleanupLock);
    process.on("SIGINT", () => { cleanupLock(); process.exit(130); });
    process.on("SIGTERM", () => { cleanupLock(); process.exit(143); });

    try {
      // Health check (always in normal mode)
      const health = await checkOllamaReachable();
      if (!health.ok) {
        stderr(
          `ollama serve not reachable at 127.0.0.1:11434. Start it with: ollama serve &\n(${health.error})\n`
        );
        return 1;
      }

      // Load cursor
      const cursor = await loadCursor(stateDir);
      // --since overrides cursor for this run only (cursor still advances after success)
      const effectiveTimestamp = args.since !== undefined ? args.since : cursor.last_run_timestamp;

      // Open DB
      const dbPath = findOpenCodeDb();
      if (!dbPath) {
        stderr("Could not locate OpenCode SQLite database.\n");
        // Fix #5: Write JSONL record for early failures
        return await finalize({
          ts: new Date().toISOString(),
          ts_ms: Date.now(),
          duration_ms: Date.now() - startMs,
          mode: "normal",
          model: MODEL,
          sessions_read: 0,
          report_blocks_generated: 0,
          report_path: "",
          success: false,
          errors: [{ session_id: "", phase: "db-not-found", message: "Could not locate OpenCode SQLite database" }],
        }, 1);
      }

      let db: Database;
      try {
        db = openDatabase(dbPath);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        stderr(`Failed to open database: ${msg}\n`);
        // Fix #5: Write JSONL record for DB open failure
        return await finalize({
          ts: new Date().toISOString(),
          ts_ms: Date.now(),
          duration_ms: Date.now() - startMs,
          mode: "normal",
          model: MODEL,
          sessions_read: 0,
          report_blocks_generated: 0,
          report_path: "",
          success: false,
          errors: [{ session_id: "", phase: "db-open-failure", message: msg }],
        }, 1);
      }

      let selectionResult: SelectionResult;
      try {
        selectionResult = await selectSessions(db, effectiveTimestamp);
      } catch (err) {
        db.close();
        const msg = err instanceof Error ? err.message : String(err);
        stderr(`Failed to select sessions: ${msg}\n`);
        // Fix #5: Write JSONL record for session-select failure
        const phase = err instanceof SchemaError ? "schema-invariant-violation" : "session-select-failure";
        return await finalize({
          ts: new Date().toISOString(),
          ts_ms: Date.now(),
          duration_ms: Date.now() - startMs,
          mode: "normal",
          model: MODEL,
          sessions_read: 0,
          report_blocks_generated: 0,
          report_path: "",
          success: false,
          errors: [{ session_id: "", phase, message: msg }],
        }, 1);
      }
      db.close();

      const { sessions } = selectionResult;

      // 0 sessions: no-op success
      if (sessions.length === 0) {
        stderr("no new sessions to distill\n");
        const durationMs = Date.now() - startMs;
        const record: RunRecord = {
          ts: new Date().toISOString(),
          ts_ms: Date.now(),
          duration_ms: durationMs,
          mode: "normal",
          model: MODEL,
          sessions_read: 0,
          report_blocks_generated: 0,
          report_path: "",
          success: true,
          errors: [],
        };
        await appendRunLog(logPath, record);
        return 0;
      }

      // --extract-only: emit transcripts to stdout, skip Ollama
      if (args.extractOnly) {
        for (const s of sessions) {
          stdout(`=== Session ${s.id} ===\n${s.transcript}\n\n`);
        }
        return 0;
      }

      // Fix #4: Process sessions through Ollama with chunked inference.
      // Per-chunk independence is intentional — see chunkSegments() comment block.
      const sessionResults: SessionResult[] = [];
      const errors: RunError[] = [];
      // Track which sessions succeeded (by index, in time order)
      const sessionSucceeded: boolean[] = [];
      let reportBlocksGenerated = 0;

      for (const s of sessions) {
        // Fix #3: Sessions with per-segment truncation are treated as failures for cursor purposes
        if (s.stats.segments_truncated > 0) {
          errors.push({
            session_id: s.id,
            phase: "truncation",
            message: `${s.stats.segments_truncated} segment(s) truncated at ${SEGMENT_HARD_CAP} chars; session excluded from cursor advance`,
          });
          stderr(`Warning: segment(s) truncated for ${s.id}; treating as failure for cursor\n`);
          sessionSucceeded.push(false);
          continue;
        }

        const chunks = chunkSegments(s.segments);

        if (chunks.length === 0) {
          // No content — mark succeeded trivially (consistent with empty-transcript handling)
          sessionSucceeded.push(true);
          continue;
        }

        let allChunksSucceeded = true;
        const chunkBlocks: string[] = [];
        const chunkErrors: RunError[] = [];

        for (let c = 0; c < chunks.length; c++) {
          const chunkTranscript = renderChunkTranscript(chunks[c]);
          const ollamaResult = await callOllama(chunkTranscript, MODEL);
          if (ollamaResult.error) {
            chunkErrors.push({
              session_id: s.id,
              phase: "ollama",
              message: `chunk ${c + 1}/${chunks.length}: ${ollamaResult.error}`,
            });
            allChunksSucceeded = false;
            break;  // stop processing remaining chunks on first failure
          }
          chunkBlocks.push(ollamaResult.output);
        }

        // Header convention:
        // - 1 chunk total, success: title = "Session <id>"
        // - N chunks, all succeeded: title = "Session <id> (N chunks)"
        // - M of N chunks succeeded (partial): title = "Session <id> (M/N chunks succeeded)"
        // writeReport wraps title as: ### <title> (<sessionId>)
        let title: string;
        if (chunks.length === 1 && allChunksSucceeded) {
          title = `Session ${s.id}`;
        } else if (allChunksSucceeded) {
          title = `Session ${s.id} (${chunks.length} chunks)`;
        } else if (chunkBlocks.length > 0) {
          title = `Session ${s.id} (${chunkBlocks.length}/${chunks.length} chunks succeeded)`;
        } else {
          title = `Session ${s.id} (failed)`;
        }

        if (chunkBlocks.length > 0) {
          // Write whatever we got, even on partial failure
          sessionResults.push({
            sessionId: s.id,
            title,
            ollamaOutput: chunkBlocks.join("\n\n"),
          });
          reportBlocksGenerated += chunkBlocks.length;
        }

        if (allChunksSucceeded) {
          sessionSucceeded.push(true);
        } else {
          errors.push(...chunkErrors);
          stderr(`Warning: Ollama error for ${s.id}: ${chunkErrors[0]?.message}\n`);
          sessionSucceeded.push(false);
        }
      }

      // Fix #1: Advance cursor only through the longest contiguous successful prefix
      // Walk sessions in time order; stop at first failure
      let cursorAdvanceTo: number = cursor.last_run_timestamp ?? 0;
      for (let i = 0; i < sessions.length; i++) {
        if (sessionSucceeded[i]) {
          cursorAdvanceTo = sessions[i].time_updated;
        } else {
          // First failure breaks the contiguous prefix
          break;
        }
      }

      // Write report — always call when there's a resolved path; empty sessionResults = header-only file
      const dateStr = new Date().toISOString().slice(0, 10);
      const reportPath = args.out ?? join(stateDir, "reports", `${dateStr}.md`);

      await writeReport(reportPath, sessionResults);

      const durationMs = Date.now() - startMs;
      const success = errors.length === 0;

      const record: RunRecord = {
        ts: new Date().toISOString(),
        ts_ms: Date.now(),
        duration_ms: durationMs,
        mode: "normal",
        model: MODEL,
        sessions_read: sessions.length,
        report_blocks_generated: reportBlocksGenerated,
        report_path: reportPath,
        success,
        errors,
      };

      await appendRunLog(logPath, record);

      // Always write a cursor at the end of a normal-mode run to prevent bootstrap deadlock.
      // If ≥1 session succeeded contiguously from the start, advance to the last success.
      // If zero sessions succeeded, write the window floor so the next run retries the same
      // window rather than re-bootstrapping from scratch.
      const windowFloor = cursor.last_run_timestamp ?? (Date.now() - SEVEN_DAYS_MS);
      const nextCursor = cursorAdvanceTo > windowFloor ? cursorAdvanceTo : windowFloor;
      await saveCursor(stateDir, { last_run_timestamp: nextCursor });

      return success ? 0 : 1;
    } finally {
      // Fix #2: Always release lock
      if (lockPath) releaseLock(lockPath);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stderr(`Fatal error: ${msg}\n`);
    return 1;
  }
}

// ─── DB Path Discovery ────────────────────────────────────────────────────────

/**
 * Locate the OpenCode SQLite database.
 * Checks OPENCODE_DB_PATH env first (for testability), then the default XDG location.
 */
function findOpenCodeDb(): string | null {
  if (process.env.OPENCODE_DB_PATH) {
    return process.env.OPENCODE_DB_PATH;
  }
  const xdgData = process.env.XDG_DATA_HOME ?? join(homedir(), ".local/share");
  const candidate = join(xdgData, "opencode", "opencode.db");
  if (existsSync(candidate)) return candidate;
  return null;
}

// ─── Entry Point ──────────────────────────────────────────────────────────────

if (import.meta.main) {
  main().then((code) => process.exit(code));
}
