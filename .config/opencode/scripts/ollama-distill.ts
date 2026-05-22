#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { mkdirSync, renameSync, existsSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

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
  maxBytes = 1.5 * 1024 * 1024
): Promise<SelectionResult> {
  const since = lastRunTimestamp ?? 0;
  const fetchCap = Math.ceil(maxSessions * 1.5);

  const rows = db
    .query<SessionRow, [number, number]>(
      `SELECT id, time_updated FROM session
       WHERE time_updated > ? AND parent_id IS NULL
       ORDER BY time_updated ASC
       LIMIT ?`
    )
    .all(since, fetchCap);

  const sessions: SelectedSession[] = [];
  let cumulativeBytes = 0;

  for (const row of rows) {
    if (sessions.length >= maxSessions) break;

    const { transcript, stats } = await extractTranscript(db, row.id);
    const byteCount = stats.transcript_chars;

    if (cumulativeBytes + byteCount > maxBytes && sessions.length > 0) break;

    sessions.push({ id: row.id, time_updated: row.time_updated, transcript, stats });
    cumulativeBytes += byteCount;

    if (cumulativeBytes >= maxBytes) break;
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
const OLLAMA_TIMEOUT_MS = 300_000;

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
      error: isTimeout ? "timeout: Ollama did not respond within 300s" : `network error: ${msg}`,
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

  let body: { message?: { content?: string } };
  try {
    body = await response.json() as typeof body;
  } catch (err) {
    return {
      output: "",
      durationMs,
      error: `failed to parse Ollama response JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const content = body?.message?.content ?? "";
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

  if (existsSync(reportPath)) {
    const existing = await Bun.file(reportPath).text();
    const separator = `\n\n---\n\n## Run at ${timeStr}\n\n`;
    await Bun.write(reportPath, existing + separator + blocks);
  } else {
    const header = `# Distillation Report — ${dateStr}\n\n`;
    await Bun.write(reportPath, header + blocks);
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

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      result.help = true;
      continue;
    }
    if (arg === "--extract-only") {
      result.extractOnly = true;
      continue;
    }
    if (arg.startsWith("--since=")) {
      result.since = parseSince(arg.slice("--since=".length));
      continue;
    }
    if (arg.startsWith("--session=")) {
      result.session = arg.slice("--session=".length);
      continue;
    }
    if (arg.startsWith("--out=")) {
      result.out = arg.slice("--out=".length);
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
 */
function parseSince(value: string): number {
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

  // Fallback: try Date.parse
  const parsed = Date.parse(value);
  if (!isNaN(parsed)) return parsed;

  // Can't parse — return 0 (will select all sessions)
  return 0;
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
  mise run distill                          # normal run; reads cursor, writes today's report
  mise run distill --since=7d               # backfill the last 7 days
  mise run distill --session=ses_xxx        # debug one session, output to stdout
  mise run distill --session=ses_xxx --out=/tmp/x.md
  mise run distill --extract-only --session=ses_xxx  # see extracted transcript only

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

    // Unknown flag
    if (args.unknownFlag) {
      stderr(`Unknown flag: ${args.unknownFlag}\n\n${USAGE}`);
      return 1;
    }

    const stateDir =
      process.env.OLLAMA_DISTILL_STATE_DIR ??
      join(homedir(), ".local/state/ollama-distill");

    const logPath = join(stateDir, "run.jsonl");

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

      let extractResult: { transcript: string; stats: ExtractStats };
      try {
        extractResult = await extractTranscript(db, sessionId);
      } catch (err) {
        db.close();
        const msg = err instanceof Error ? err.message : String(err);
        stderr(`Failed to extract transcript for ${sessionId}: ${msg}\n`);
        return 1;
      }
      db.close();

      const { transcript } = extractResult;

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

      const ollamaResult = await callOllama(transcript, MODEL);
      const durationMs = Date.now() - startMs;

      const record: RunRecord = {
        ts: new Date().toISOString(),
        ts_ms: Date.now(),
        duration_ms: durationMs,
        mode: "session",
        model: MODEL,
        sessions_read: 1,
        report_blocks_generated: ollamaResult.error ? 0 : 1,
        report_path: args.out ?? "stdout",
        success: !ollamaResult.error,
        errors: ollamaResult.error
          ? [{ session_id: sessionId, phase: "ollama", message: ollamaResult.error }]
          : [],
      };

      await appendRunLog(logPath, record);

      if (ollamaResult.error) {
        stderr(`Ollama error for ${sessionId}: ${ollamaResult.error}\n`);
        return 1;
      }

      const output = `### Session ${sessionId}\n\n${ollamaResult.output}\n`;
      if (args.out) {
        await Bun.write(args.out, output);
      } else {
        stdout(output);
      }

      return 0;
    }

    // ── Normal mode ──────────────────────────────────────────────────────────

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

    let selectionResult: SelectionResult;
    try {
      selectionResult = await selectSessions(db, effectiveTimestamp);
    } catch (err) {
      db.close();
      const msg = err instanceof Error ? err.message : String(err);
      stderr(`Failed to select sessions: ${msg}\n`);
      return 1;
    }
    db.close();

    const { sessions, max_processed_time_updated } = selectionResult;

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

    // Process sessions through Ollama
    const sessionResults: SessionResult[] = [];
    const errors: RunError[] = [];

    for (const s of sessions) {
      const ollamaResult = await callOllama(s.transcript, MODEL);
      if (ollamaResult.error) {
        errors.push({ session_id: s.id, phase: "ollama", message: ollamaResult.error });
        stderr(`Warning: Ollama error for ${s.id}: ${ollamaResult.error}\n`);
        continue;
      }
      sessionResults.push({
        sessionId: s.id,
        title: `Session ${s.id.slice(0, 20)}`,
        ollamaOutput: ollamaResult.output,
      });
    }

    // Write report
    const dateStr = new Date().toISOString().slice(0, 10);
    const reportPath = args.out ?? join(stateDir, "reports", `${dateStr}.md`);

    if (sessionResults.length > 0) {
      await writeReport(reportPath, sessionResults);
    }

    const durationMs = Date.now() - startMs;
    const success = errors.length === 0;

    const record: RunRecord = {
      ts: new Date().toISOString(),
      ts_ms: Date.now(),
      duration_ms: durationMs,
      mode: "normal",
      model: MODEL,
      sessions_read: sessions.length,
      report_blocks_generated: sessionResults.length,
      report_path: sessionResults.length > 0 ? reportPath : "",
      success,
      errors,
    };

    await appendRunLog(logPath, record);

    // Advance cursor (only in normal mode, only on at least partial success)
    await saveCursor(stateDir, { last_run_timestamp: max_processed_time_updated });

    return success ? 0 : 1;
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
  const candidate = join(xdgData, "opencode", "db.sqlite");
  if (existsSync(candidate)) return candidate;
  return null;
}

// ─── Entry Point ──────────────────────────────────────────────────────────────

if (import.meta.main) {
  main().then((code) => process.exit(code));
}
