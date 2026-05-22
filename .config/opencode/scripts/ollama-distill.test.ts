import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlinkSync, existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import {
  openDatabase,
  extractTranscript,
  SchemaError,
  ReadOnlyVerificationError,
  loadCursor,
  saveCursor,
  selectSessions,
  callOllama,
  writeReport,
  appendRunLog,
  type ExtractStats,
  type RunRecord,
} from "./ollama-distill.ts";

// Save original fetch so we can restore it after each Ollama test
const originalFetch = globalThis.fetch;

// ─── Fixture helpers ──────────────────────────────────────────────────────────

/** Create a minimal in-memory DB with the required schema. */
function createFixtureDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      parent_id TEXT,
      time_created INTEGER,
      time_updated INTEGER
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      time_created INTEGER,
      data TEXT
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY,
      message_id TEXT,
      session_id TEXT,
      time_created INTEGER,
      data TEXT
    );
  `);
  return db;
}

/** Insert a message row and return its id. */
function insertMessage(
  db: Database,
  sessionId: string,
  role: string,
  timeCreated: number,
  id: string
): string {
  db.run("INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)", [
    id,
    sessionId,
    timeCreated,
    JSON.stringify({ role }),
  ]);
  return id;
}

/** Insert a part row. */
function insertPart(
  db: Database,
  messageId: string,
  sessionId: string,
  type: string,
  text: string | null,
  timeCreated: number,
  id: string,
  rawData?: string
): void {
  const data =
    rawData !== undefined
      ? rawData
      : text !== null
        ? JSON.stringify({ type, text })
        : JSON.stringify({ type });
  db.run(
    "INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)",
    [id, messageId, sessionId, timeCreated, data]
  );
}

// ─── Test 1: Happy path ───────────────────────────────────────────────────────

describe("extractTranscript", () => {
  test("happy path: 3 messages with one text part each → 3 labeled lines in order", async () => {
    const db = createFixtureDb();
    const sid = "sess-1";

    const m1 = insertMessage(db, sid, "user", 1000, "msg-1");
    const m2 = insertMessage(db, sid, "assistant", 2000, "msg-2");
    const m3 = insertMessage(db, sid, "user", 3000, "msg-3");

    insertPart(db, m1, sid, "text", "Hello there", 1001, "p-1");
    insertPart(db, m2, sid, "text", "Hi! How can I help?", 2001, "p-2");
    insertPart(db, m3, sid, "text", "Tell me about SQLite", 3001, "p-3");

    const { transcript, stats } = await extractTranscript(db, sid);

    const lines = transcript.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("USER: Hello there");
    expect(lines[1]).toBe("ASSISTANT: Hi! How can I help?");
    expect(lines[2]).toBe("USER: Tell me about SQLite");

    expect(stats.messages).toBe(3);
    expect(stats.text_parts).toBe(3);
    expect(stats.reasoning_parts).toBe(0);
    expect(stats.skipped_parts).toBe(0);
    expect(stats.truncated).toBe(false);

    db.close();
  });

  // ─── Test 2: Mixed part types ───────────────────────────────────────────────

  test("mixed part types: text + reasoning emit lines; tool/step-start are skipped", async () => {
    const db = createFixtureDb();
    const sid = "sess-2";

    const m1 = insertMessage(db, sid, "assistant", 1000, "msg-1");
    insertPart(db, m1, sid, "text", "Here is my answer", 1001, "p-1");
    insertPart(db, m1, sid, "reasoning", "Let me think...", 1002, "p-2");
    insertPart(db, m1, sid, "tool", null, 1003, "p-3");
    insertPart(db, m1, sid, "step-start", null, 1004, "p-4");

    const { transcript, stats } = await extractTranscript(db, sid);

    const lines = transcript.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("ASSISTANT: Here is my answer");
    expect(lines[1]).toBe("ASSISTANT [reasoning]: Let me think...");

    expect(stats.text_parts).toBe(1);
    expect(stats.reasoning_parts).toBe(1);
    expect(stats.skipped_parts).toBe(2);
    expect(stats.skipped_types).toContain("tool");
    expect(stats.skipped_types).toContain("step-start");

    db.close();
  });

  // ─── Test 3: Truncation ─────────────────────────────────────────────────────

  test("truncation: content exceeding 60K chars is truncated with marker", async () => {
    const db = createFixtureDb();
    const sid = "sess-3";

    // Create a message with text that exceeds 60K chars
    const bigText = "x".repeat(61_000);
    const m1 = insertMessage(db, sid, "user", 1000, "msg-1");
    insertPart(db, m1, sid, "text", bigText, 1001, "p-1");

    const { transcript, stats } = await extractTranscript(db, sid);

    expect(stats.truncated).toBe(true);
    expect(transcript).toContain("[... transcript truncated for context limit]");
    // The transcript should be shorter than the original content
    expect(transcript.length).toBeLessThan(bigText.length);

    db.close();
  });

  // ─── Test 4: Read-only verification ────────────────────────────────────────

  test("read-only verification: openDatabase with mode=ro throws on CREATE TEMP TABLE", async () => {
    // Create a real file-based DB so we can open it with mode=ro URI
    const dbPath = join(tmpdir(), `ollama-distill-test-ro-${Date.now()}.db`);

    // Bootstrap the DB with required schema
    const setup = new Database(dbPath);
    setup.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, time_created INTEGER, time_updated INTEGER);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT);
    `);
    setup.close();

    // openDatabase should succeed (schema is valid) and the probe should throw internally
    // but be caught — meaning the DB opens fine in read-only mode.
    // The key assertion: if we manually try CREATE TEMP TABLE on the opened DB, it throws.
    const db = openDatabase(dbPath);

    // Verify the connection is truly read-only by attempting a write
    expect(() => {
      db.exec("INSERT INTO session (id) VALUES ('test')");
    }).toThrow();

    db.close();
    if (existsSync(dbPath)) unlinkSync(dbPath);
  });

  // ─── Test 5: Schema missing column ─────────────────────────────────────────

  test("schema missing column: SchemaError thrown with missing column name", async () => {
    const dbPath = join(tmpdir(), `ollama-distill-test-schema-${Date.now()}.db`);

    // Create DB missing session.parent_id
    const setup = new Database(dbPath);
    setup.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, time_created INTEGER, time_updated INTEGER);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT);
    `);
    setup.close();

    expect(() => openDatabase(dbPath)).toThrow(SchemaError);

    try {
      openDatabase(dbPath);
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaError);
      expect((err as SchemaError).message).toContain("parent_id");
    }

    if (existsSync(dbPath)) unlinkSync(dbPath);
  });

  // ─── Test 6: SQLITE_BUSY retry ─────────────────────────────────────────────

  test("SQLITE_BUSY retry: succeeds after 2 busy errors", async () => {
    const db = createFixtureDb();
    const sid = "sess-6";

    const m1 = insertMessage(db, sid, "user", 1000, "msg-1");
    insertPart(db, m1, sid, "text", "Hello", 1001, "p-1");

    // Monkey-patch db.query to simulate SQLITE_BUSY twice then succeed
    let callCount = 0;
    const originalQuery = db.query.bind(db);

    // We'll wrap extractTranscript by intercepting at the db.query level
    // Since we can't easily mock bun:sqlite internals, we test the retry logic
    // by creating a wrapper that tracks attempts via a counter in the closure.
    let retryCount = 0;

    // Create a proxy-like wrapper around the db that throws SQLITE_BUSY twice
    const mockDb = new Proxy(db, {
      get(target, prop) {
        if (prop === "query") {
          return (sql: string) => {
            const stmt = originalQuery(sql);
            const originalAll = stmt.all.bind(stmt);
            return new Proxy(stmt, {
              get(stmtTarget, stmtProp) {
                if (stmtProp === "all") {
                  return (...args: unknown[]) => {
                    callCount++;
                    if (callCount <= 2) {
                      retryCount++;
                      const err = new Error("SQLITE_BUSY: database is locked");
                      throw err;
                    }
                    return originalAll(...(args as Parameters<typeof originalAll>));
                  };
                }
                return (stmtTarget as Record<string | symbol, unknown>)[stmtProp];
              },
            });
          };
        }
        return (target as Record<string | symbol, unknown>)[prop];
      },
    });

    const { transcript, stats } = await extractTranscript(mockDb as unknown as Database, sid);

    expect(retryCount).toBe(2);
    expect(transcript).toContain("USER: Hello");
    expect(stats.text_parts).toBe(1);

    db.close();
  });

  // ─── Test 7: JSON decode failure ───────────────────────────────────────────

  test("JSON decode failure: malformed part data is skipped, extraction continues", async () => {
    const db = createFixtureDb();
    const sid = "sess-7";

    const m1 = insertMessage(db, sid, "user", 1000, "msg-1");
    // Good part
    insertPart(db, m1, sid, "text", "Good part", 1001, "p-1");
    // Malformed JSON part
    insertPart(db, m1, sid, "text", null, 1002, "p-2", "{ this is not valid json !!!");
    // Another good part
    insertPart(db, m1, sid, "text", "Another good part", 1003, "p-3");

    const { transcript, stats } = await extractTranscript(db, sid);

    const lines = transcript.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("USER: Good part");
    expect(lines[1]).toBe("USER: Another good part");

    expect(stats.text_parts).toBe(2);
    expect(stats.skipped_parts).toBe(1);
    expect(stats.skipped_types).toContain("malformed_json");

    db.close();
  });
});

// ─── openDatabase tests ───────────────────────────────────────────────────────

describe("openDatabase", () => {
  let dbPath: string;

  beforeAll(() => {
    dbPath = join(tmpdir(), `ollama-distill-test-open-${Date.now()}.db`);
    const setup = new Database(dbPath);
    setup.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, time_created INTEGER, time_updated INTEGER);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT);
    `);
    setup.close();
  });

  afterAll(() => {
    if (existsSync(dbPath)) unlinkSync(dbPath);
  });

  test("opens valid DB successfully", () => {
    const db = openDatabase(dbPath);
    expect(db).toBeDefined();
    db.close();
  });

  test("opened DB rejects write operations", () => {
    const db = openDatabase(dbPath);
    expect(() => {
      db.exec("INSERT INTO session (id) VALUES ('x')");
    }).toThrow();
    db.close();
  });
});

// ─── Unit 2 Tests ─────────────────────────────────────────────────────────────

// ── Fixture helpers for session selection ────────────────────────────────────

function createSelectionDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      parent_id TEXT,
      time_created INTEGER,
      time_updated INTEGER
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      time_created INTEGER,
      data TEXT
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY,
      message_id TEXT,
      session_id TEXT,
      time_created INTEGER,
      data TEXT
    );
  `);
  return db;
}

function insertSession(db: Database, id: string, timeUpdated: number, parentId: string | null = null): void {
  db.run(
    "INSERT INTO session (id, project_id, parent_id, time_created, time_updated) VALUES (?, NULL, ?, ?, ?)",
    [id, parentId, timeUpdated, timeUpdated]
  );
}

function insertSessionWithText(db: Database, id: string, timeUpdated: number, text: string): void {
  insertSession(db, id, timeUpdated);
  const msgId = id + "-msg";
  db.run("INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)", [
    msgId, id, timeUpdated, JSON.stringify({ role: "user" }),
  ]);
  db.run("INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)", [
    id + "-part", msgId, id, timeUpdated, JSON.stringify({ type: "text", text }),
  ]);
}

// ── Cursor tests ─────────────────────────────────────────────────────────────

describe("loadCursor / saveCursor", () => {
  test("bootstrap: missing cursor file returns ~7 days ago timestamp", async () => {
    const stateDir = join(tmpdir(), "ollama-distill-cursor-test-" + Math.random().toString(36).slice(2));
    const before = Date.now();
    const cursor = await loadCursor(stateDir);
    const after = Date.now();

    expect(cursor.last_run_timestamp).not.toBeNull();
    const ts = cursor.last_run_timestamp!;
    const sevenDaysMs = 7 * 24 * 3600 * 1000;
    // Should be approximately now - 7d (within 5s tolerance)
    expect(ts).toBeGreaterThanOrEqual(before - sevenDaysMs - 5000);
    expect(ts).toBeLessThanOrEqual(after - sevenDaysMs + 5000);
  });

  test("round-trip: saveCursor then loadCursor returns exact value", async () => {
    const stateDir = join(tmpdir(), "ollama-distill-cursor-rt-" + Math.random().toString(36).slice(2));
    const cursor = { last_run_timestamp: 1234567890123 };
    await saveCursor(stateDir, cursor);
    const loaded = await loadCursor(stateDir);
    expect(loaded.last_run_timestamp).toBe(1234567890123);
  });

  test("atomic write: .tmp file without rename → next load returns old cursor", async () => {
    const stateDir = join(tmpdir(), "ollama-distill-cursor-atomic-" + Math.random().toString(36).slice(2));
    mkdirSync(stateDir, { recursive: true });

    // Write a known cursor first
    await saveCursor(stateDir, { last_run_timestamp: 9999 });

    // Simulate interrupted write: write .tmp but don't rename
    writeFileSync(join(stateDir, "cursor.json.tmp"), JSON.stringify({ last_run_timestamp: 42 }) + "\n");

    // Load should return the old cursor (9999), not the .tmp value (42)
    const loaded = await loadCursor(stateDir);
    expect(loaded.last_run_timestamp).toBe(9999);
  });
});

// ── Session selection tests ───────────────────────────────────────────────────

describe("selectSessions", () => {
  test("count cap: 75 sessions → selectSessions returns 50", async () => {
    const db = createSelectionDb();
    for (let i = 0; i < 75; i++) {
      insertSessionWithText(db, `sess-${i}`, 1000 + i, "short text");
    }
    const result = await selectSessions(db, 0, 50);
    expect(result.sessions.length).toBe(50);
    expect(result.max_processed_time_updated).toBe(1049); // 50th session time_updated
    db.close();
  });

  test("byte cap: stops before accumulating byte cap of transcript chars", async () => {
    const db = createSelectionDb();
    // Each session ~40KB of text (under 60K truncation limit)
    // With a 100KB cap, should stop after ~2-3 sessions
    const chunkText = "x".repeat(40_000);
    for (let i = 0; i < 10; i++) {
      insertSessionWithText(db, `sess-${i}`, 1000 + i, chunkText);
    }
    const result = await selectSessions(db, 0, 50, 100_000);
    // Should stop well before 10 sessions (40K chars each, cap 100K → stops at 2-3)
    expect(result.sessions.length).toBeLessThan(10);
    expect(result.sessions.length).toBeGreaterThan(0);
    db.close();
  });

  test("cursor advance: second call with advanced cursor selects remaining sessions", async () => {
    const db = createSelectionDb();
    for (let i = 0; i < 75; i++) {
      insertSessionWithText(db, `sess-${i}`, 1000 + i, "short text");
    }

    // First call: selects 50
    const first = await selectSessions(db, 0, 50);
    expect(first.sessions.length).toBe(50);

    // Second call with advanced cursor: selects remaining 25
    const second = await selectSessions(db, first.max_processed_time_updated, 50);
    expect(second.sessions.length).toBe(25);

    // No overlap
    const firstIds = new Set(first.sessions.map((s) => s.id));
    for (const s of second.sessions) {
      expect(firstIds.has(s.id)).toBe(false);
    }
    db.close();
  });

  test("zero sessions: max_processed_time_updated returns lastRunTimestamp unchanged", async () => {
    const db = createSelectionDb();
    const result = await selectSessions(db, 5000, 50);
    expect(result.sessions.length).toBe(0);
    expect(result.max_processed_time_updated).toBe(5000);
    db.close();
  });
});

// ── Ollama client tests ───────────────────────────────────────────────────────

describe("callOllama", () => {
  test("happy path: mocked fetch returns content → callOllama returns output + duration", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ message: { content: "## Block\n\nSome insight." } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    try {
      const result = await callOllama("test transcript");
      expect(result.output).toBe("## Block\n\nSome insight.");
      expect(result.error).toBeUndefined();
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("network error: mocked fetch throws → returns error string", async () => {
    globalThis.fetch = async () => {
      throw new Error("ECONNREFUSED");
    };

    try {
      const result = await callOllama("test transcript");
      expect(result.output).toBe("");
      expect(result.error).toContain("ECONNREFUSED");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("empty response: Ollama returns 200 with empty content → error: 'empty response'", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ message: { content: "" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    try {
      const result = await callOllama("test transcript");
      expect(result.output).toBe("");
      expect(result.error).toBe("empty response");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("non-2xx response: returns HTTP error string", async () => {
    globalThis.fetch = async () =>
      new Response("Service Unavailable", { status: 503, statusText: "Service Unavailable" });

    try {
      const result = await callOllama("test transcript");
      expect(result.output).toBe("");
      expect(result.error).toContain("503");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("timeout: AbortSignal.timeout fires → returns timeout error", async () => {
    // We can't easily test the 300s timeout, but we can verify the error path
    // by mocking fetch to throw a TimeoutError
    globalThis.fetch = async () => {
      const err = new Error("The operation was aborted due to timeout");
      err.name = "TimeoutError";
      throw err;
    };

    try {
      const result = await callOllama("test transcript");
      expect(result.output).toBe("");
      expect(result.error).toContain("timeout");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ── Report writer tests ───────────────────────────────────────────────────────

describe("writeReport", () => {
  test("new file: creates header + blocks", async () => {
    const reportPath = join(tmpdir(), "ollama-distill-report-" + Math.random().toString(36).slice(2) + ".md");
    await writeReport(reportPath, [
      { sessionId: "sess-abc", title: "My Session", ollamaOutput: "## Insight\n\nSome text." },
    ]);
    const content = readFileSync(reportPath, "utf8");
    expect(content).toContain("# Distillation Report");
    expect(content).toContain("### My Session (sess-abc)");
    expect(content).toContain("## Insight");
    if (existsSync(reportPath)) unlinkSync(reportPath);
  });

  test("append: existing file gets separator + new blocks", async () => {
    const reportPath = join(tmpdir(), "ollama-distill-report-append-" + Math.random().toString(36).slice(2) + ".md");
    // First write
    await writeReport(reportPath, [
      { sessionId: "sess-1", title: "First", ollamaOutput: "## First insight." },
    ]);
    // Second write (append)
    await writeReport(reportPath, [
      { sessionId: "sess-2", title: "Second", ollamaOutput: "## Second insight." },
    ]);
    const content = readFileSync(reportPath, "utf8");
    expect(content).toContain("---");
    expect(content).toContain("## Run at");
    expect(content).toContain("### First (sess-1)");
    expect(content).toContain("### Second (sess-2)");
    if (existsSync(reportPath)) unlinkSync(reportPath);
  });
});

// ── JSONL run log tests ───────────────────────────────────────────────────────

describe("appendRunLog", () => {
  test("partial failure: RunRecord with errors[] writes valid JSON with success: false", async () => {
    const logPath = join(tmpdir(), "ollama-distill-log-" + Math.random().toString(36).slice(2) + ".jsonl");
    const record: RunRecord = {
      ts: new Date().toISOString(),
      ts_ms: Date.now(),
      duration_ms: 1234,
      mode: "normal",
      model: "qwen3:8b",
      sessions_read: 3,
      report_blocks_generated: 2,
      report_path: "/tmp/report.md",
      success: false,
      errors: [{ session_id: "sess-x", phase: "ollama", message: "ECONNREFUSED" }],
    };
    await appendRunLog(logPath, record);
    const line = readFileSync(logPath, "utf8").trim();
    const parsed = JSON.parse(line);
    expect(parsed.success).toBe(false);
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0].session_id).toBe("sess-x");
    expect(parsed.model).toBe("qwen3:8b");
    if (existsSync(logPath)) unlinkSync(logPath);
  });

  test("multiple appends: each call adds a new line", async () => {
    const logPath = join(tmpdir(), "ollama-distill-log-multi-" + Math.random().toString(36).slice(2) + ".jsonl");
    const base: RunRecord = {
      ts: new Date().toISOString(),
      ts_ms: Date.now(),
      duration_ms: 100,
      mode: "normal",
      model: "qwen3:8b",
      sessions_read: 1,
      report_blocks_generated: 1,
      report_path: "/tmp/r.md",
      success: true,
      errors: [],
    };
    await appendRunLog(logPath, base);
    await appendRunLog(logPath, { ...base, sessions_read: 2 });
    const lines = readFileSync(logPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]).sessions_read).toBe(2);
    if (existsSync(logPath)) unlinkSync(logPath);
  });
});
