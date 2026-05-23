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
  parseArgs,
  checkOllamaReachable,
  main,
  withSqliteBusyRetry,
  acquireLock,
  releaseLock,
  chunkSegments,
  renderChunkTranscript,
  type ExtractStats,
  type RunRecord,
  type MessageSegment,
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

  test("truncation: content exceeding SEGMENT_HARD_CAP (70K) is truncated with marker", async () => {
    const db = createFixtureDb();
    const sid = "sess-3";

    // Create a message with text that exceeds SEGMENT_HARD_CAP (70K chars)
    const bigText = "x".repeat(121_000);
    const m1 = insertMessage(db, sid, "user", 1000, "msg-1");
    insertPart(db, m1, sid, "text", bigText, 1001, "p-1");

    const { transcript, stats } = await extractTranscript(db, sid);

    expect(stats.truncated).toBe(true);
    expect(transcript).toContain("[... transcript truncated for context limit]");
    // The transcript should be shorter than the original content
    expect(transcript.length).toBeLessThan(bigText.length);

    db.close();
  });

  // ─── Test 3b: Fix #3 — Truncation keeps prefix ─────────────────────────────

  test("Fix #3: single 200K-char part yields prefix + marker (not just marker)", async () => {
    const db = createFixtureDb();
    const sid = "sess-3b";

    const bigText = "A".repeat(200_000);
    const m1 = insertMessage(db, sid, "user", 1000, "msg-1");
    insertPart(db, m1, sid, "text", bigText, 1001, "p-1");

    const { transcript, stats } = await extractTranscript(db, sid);

    expect(stats.truncated).toBe(true);
    expect(transcript).toContain("[... transcript truncated for context limit]");
    // Should have substantial prefix content (not just the marker)
    const markerIdx = transcript.indexOf("[... transcript truncated for context limit]");
    expect(markerIdx).toBeGreaterThan(1000); // at least 1000 chars of original content
    // Total length should be close to SEGMENT_HARD_CAP (70K), not 200K
    expect(transcript.length).toBeLessThanOrEqual(70_100); // SEGMENT_HARD_CAP + marker length

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

  // ─── Test 10: Fix #10 — malformed part.data skipped, run succeeds ──────────

  test("Fix #10: malformed part.data row is skipped; other rows still appear in transcript", async () => {
    const db = createFixtureDb();
    const sid = "sess-10";

    const m1 = insertMessage(db, sid, "user", 1000, "msg-1");
    insertPart(db, m1, sid, "text", "Valid content", 1001, "p-1");
    // Insert a part with completely invalid JSON
    insertPart(db, m1, sid, "text", null, 1002, "p-2", "not-json-at-all");
    insertPart(db, m1, sid, "text", "Also valid", 1003, "p-3");

    const { transcript, stats } = await extractTranscript(db, sid);

    expect(transcript).toContain("Valid content");
    expect(transcript).toContain("Also valid");
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

// ─── withSqliteBusyRetry tests ────────────────────────────────────────────────

describe("withSqliteBusyRetry", () => {
  // Fix #4: Test the extracted retry helper directly
  test("Fix #4: retries on SQLITE_BUSY and succeeds on 3rd attempt", async () => {
    let callCount = 0;
    const result = await withSqliteBusyRetry(() => {
      callCount++;
      if (callCount < 3) {
        throw new Error("SQLITE_BUSY: database is locked");
      }
      return "success";
    }, 3, 0);

    expect(result).toBe("success");
    expect(callCount).toBe(3);
  });

  test("Fix #4: throws after exhausting all attempts", async () => {
    let callCount = 0;
    await expect(
      withSqliteBusyRetry(() => {
        callCount++;
        throw new Error("SQLITE_BUSY: database is locked");
      }, 3, 0)
    ).rejects.toThrow("SQLITE_BUSY");
    expect(callCount).toBe(3);
  });

  test("Fix #4: non-SQLITE_BUSY errors are not retried", async () => {
    let callCount = 0;
    await expect(
      withSqliteBusyRetry(() => {
        callCount++;
        throw new Error("some other error");
      }, 3, 0)
    ).rejects.toThrow("some other error");
    expect(callCount).toBe(1);
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

  test("maxSessions cap: 5 sessions in DB + maxSessions=3 returns exactly 3", async () => {
    const db = createSelectionDb();
    const chunkText = "x".repeat(200_000); // 200K chars each — would have blown old 1.5MB cap
    for (let i = 0; i < 5; i++) {
      insertSessionWithText(db, `sess-${i}`, 1000 + i, chunkText);
    }
    const result = await selectSessions(db, 0, 3);
    expect(result.sessions.length).toBe(3);
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

  test("project_id filter: sessions with project_id='global' are excluded", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE session (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        parent_id TEXT,
        time_created INTEGER,
        time_updated INTEGER
      );
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT);
    `);

    // Insert 3 sessions: one global (should be excluded), two real project sessions
    for (const [id, projectId, timeUpdated] of [
      ["sess-global", "global", 1001],
      ["sess-abc123", "abc123", 1002],
      ["sess-def456", "def456", 1003],
    ] as [string, string, number][]) {
      db.run(
        "INSERT INTO session (id, project_id, parent_id, time_created, time_updated) VALUES (?, ?, NULL, ?, ?)",
        [id, projectId, timeUpdated, timeUpdated]
      );
      const msgId = id + "-msg";
      db.run("INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)", [
        msgId, id, timeUpdated, JSON.stringify({ role: "user" }),
      ]);
      db.run("INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)", [
        id + "-part", msgId, id, timeUpdated, JSON.stringify({ type: "text", text: "hello" }),
      ]);
    }

    const result = await selectSessions(db, 0, 50);
    expect(result.sessions.length).toBe(2);
    const ids = result.sessions.map((s) => s.id);
    expect(ids).toContain("sess-abc123");
    expect(ids).toContain("sess-def456");
    expect(ids).not.toContain("sess-global");
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
    // We can't easily test the 600s timeout, but we can verify the error path
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
      expect(result.error).toContain("600s");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // Fix #9: malformed response shape
  test("Fix #9: response missing message field → returns malformed-response error, not crash", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ choices: [{ text: "something" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    try {
      const result = await callOllama("test transcript");
      expect(result.output).toBe("");
      expect(result.error).toContain("malformed-response");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("Fix #9: response with message but no content field → returns malformed-response error", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ message: { role: "assistant" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    try {
      const result = await callOllama("test transcript");
      expect(result.output).toBe("");
      expect(result.error).toContain("malformed-response");
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

  // Fix #8: atomic write preserves pre-existing content
  test("Fix #8: pre-existing report content is preserved after atomic append", async () => {
    const reportPath = join(tmpdir(), "ollama-distill-report-atomic-" + Math.random().toString(36).slice(2) + ".md");
    // Pre-populate with known content
    writeFileSync(reportPath, "# Pre-existing content\n\nOld data here.\n");

    await writeReport(reportPath, [
      { sessionId: "sess-new", title: "New Session", ollamaOutput: "## New insight." },
    ]);

    const content = readFileSync(reportPath, "utf8");
    expect(content).toContain("Pre-existing content");
    expect(content).toContain("Old data here");
    expect(content).toContain("New Session");
    expect(content).toContain("New insight");
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

// ─── Unit 3 Tests ─────────────────────────────────────────────────────────────

// ── Fixture helpers for main() integration tests ──────────────────────────────

/** Create a file-based DB with valid schema + some sessions for main() tests. */
function createFileDb(dbPath: string, sessions: Array<{ id: string; timeUpdated: number; text: string }>): void {
  const db = new Database(dbPath);
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
  for (const s of sessions) {
    db.run(
      "INSERT INTO session (id, project_id, parent_id, time_created, time_updated) VALUES (?, NULL, NULL, ?, ?)",
      [s.id, s.timeUpdated, s.timeUpdated]
    );
    const msgId = s.id + "-msg";
    db.run("INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)", [
      msgId, s.id, s.timeUpdated, JSON.stringify({ role: "user" }),
    ]);
    db.run("INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)", [
      s.id + "-part", msgId, s.id, s.timeUpdated, JSON.stringify({ type: "text", text: s.text }),
    ]);
  }
  db.close();
}

/** Mock fetch for Ollama: health OK + chat response. */
function mockOllamaOk(content = "## Insight\n\nSome durable insight."): typeof globalThis.fetch {
  return async (url: string | URL | Request, _init?: RequestInit) => {
    const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    if (urlStr.includes("/api/tags")) {
      return new Response(JSON.stringify({ models: [] }), { status: 200 });
    }
    if (urlStr.includes("/api/chat")) {
      return new Response(JSON.stringify({ message: { content } }), { status: 200 });
    }
    throw new Error(`Unexpected URL: ${urlStr}`);
  };
}

/** Mock fetch for Ollama: health fails. */
function mockOllamaDown(): typeof globalThis.fetch {
  return async () => {
    throw new Error("ECONNREFUSED");
  };
}

// ── parseArgs tests ───────────────────────────────────────────────────────────

describe("parseArgs", () => {
  test("happy path: --since=ISO + --out parses correctly", () => {
    const args = parseArgs(["--since=2026-05-15", "--out=/tmp/r.md"]);
    expect(args.out).toBe("/tmp/r.md");
    expect(args.since).toBeDefined();
    // 2026-05-15T00:00:00Z in epoch ms
    expect(args.since).toBe(new Date("2026-05-15T00:00:00.000Z").getTime());
    expect(args.extractOnly).toBe(false);
    expect(args.help).toBe(false);
    expect(args.unknownFlag).toBeUndefined();
  });

  test("--since formats: 7d, ISO date, epoch ms all parse", () => {
    const before = Date.now();
    const rel = parseArgs(["--since=7d"]);
    const after = Date.now();
    expect(rel.since).toBeGreaterThanOrEqual(before - 7 * 24 * 3600 * 1000 - 100);
    expect(rel.since).toBeLessThanOrEqual(after - 7 * 24 * 3600 * 1000 + 100);

    const iso = parseArgs(["--since=2026-05-15"]);
    expect(iso.since).toBe(new Date("2026-05-15T00:00:00.000Z").getTime());

    const epochMs = parseArgs(["--since=1747267200000"]);
    expect(epochMs.since).toBe(1747267200000);
  });

  test("--help flag sets help: true", () => {
    const args = parseArgs(["--help"]);
    expect(args.help).toBe(true);
  });

  test("unknown flag captured in unknownFlag", () => {
    const args = parseArgs(["--foo=bar"]);
    expect(args.unknownFlag).toBe("--foo=bar");
  });

  test("--session and --extract-only parse correctly", () => {
    const args = parseArgs(["--session=ses_abc123", "--extract-only"]);
    expect(args.session).toBe("ses_abc123");
    expect(args.extractOnly).toBe(true);
  });

  // Fix #6: invalid --since
  test("Fix #6: --since=7days (invalid format) → flagError set", () => {
    const args = parseArgs(["--since=7days"]);
    expect(args.flagError).toBeDefined();
    expect(args.flagError).toContain("Invalid --since value");
    expect(args.since).toBeUndefined();
  });

  test("Fix #6: --since= (empty) → flagError set", () => {
    const args = parseArgs(["--since="]);
    expect(args.flagError).toBeDefined();
    expect(args.flagError).toContain("Empty value");
  });

  test("Fix #6: --since=notadate → flagError set", () => {
    const args = parseArgs(["--since=notadate"]);
    expect(args.flagError).toBeDefined();
    expect(args.flagError).toContain("Invalid --since value");
  });

  // Fix #7: positional arguments rejected
  test("Fix #7: positional argument → flagError set", () => {
    const args = parseArgs(["somevalue"]);
    expect(args.flagError).toBeDefined();
    expect(args.flagError).toContain("positional argument");
  });

  // Fix #7: empty values rejected
  test("Fix #7: --session= (empty value) → flagError set", () => {
    const args = parseArgs(["--session="]);
    expect(args.flagError).toBeDefined();
    expect(args.flagError).toContain("Empty value");
  });

  test("Fix #7: --out= (empty value) → flagError set", () => {
    const args = parseArgs(["--out="]);
    expect(args.flagError).toBeDefined();
    expect(args.flagError).toContain("Empty value");
  });

  // Fix #7: duplicate flags rejected
  test("Fix #7: duplicate --session flag → flagError set", () => {
    const args = parseArgs(["--session=ses_a", "--session=ses_b"]);
    expect(args.flagError).toBeDefined();
    expect(args.flagError).toContain("Duplicate flag");
  });

  test("Fix #7: duplicate --since flag → flagError set", () => {
    const args = parseArgs(["--since=7d", "--since=30d"]);
    expect(args.flagError).toBeDefined();
    expect(args.flagError).toContain("Duplicate flag");
  });
});

// ── checkOllamaReachable tests ────────────────────────────────────────────────

describe("checkOllamaReachable", () => {
  test("returns ok: true when /api/tags responds 200", async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ models: [] }), { status: 200 });
    try {
      const result = await checkOllamaReachable();
      expect(result.ok).toBe(true);
      expect(result.error).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("returns ok: false when fetch throws (connection refused)", async () => {
    globalThis.fetch = async () => { throw new Error("ECONNREFUSED"); };
    try {
      const result = await checkOllamaReachable();
      expect(result.ok).toBe(false);
      expect(result.error).toContain("ECONNREFUSED");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ── main() integration tests ──────────────────────────────────────────────────

describe("main", () => {
  test("--help: returns 0 and prints usage to stdout", async () => {
    const written: string[] = [];
    const code = await main(["bun", "script.ts", "--help"], (s) => written.push(s), () => {});
    expect(code).toBe(0);
    expect(written.join("")).toContain("ollama-distill");
    expect(written.join("")).toContain("--since");
  });

  // Fix #11: --help output should contain -- separator in examples
  test("Fix #11: --help output contains -- separator in examples", async () => {
    const written: string[] = [];
    await main(["bun", "script.ts", "--help"], (s) => written.push(s), () => {});
    const output = written.join("");
    expect(output).toContain("-- --since=");
    expect(output).toContain("-- --session=");
    expect(output).toContain("-- --extract-only");
  });

  test("unknown flag: returns 1 and prints usage to stderr", async () => {
    const written: string[] = [];
    const code = await main(["bun", "script.ts", "--unknown-flag=xyz"], () => {}, (s) => written.push(s));
    expect(code).toBe(1);
    expect(written.join("")).toContain("Unknown flag");
  });

  // Fix #6: invalid --since exits 1 with usage error
  test("Fix #6: --since=7days → exit 1 with usage error", async () => {
    const stderrLines: string[] = [];
    const code = await main(["bun", "script.ts", "--since=7days"], () => {}, (s) => stderrLines.push(s));
    expect(code).toBe(1);
    expect(stderrLines.join("")).toContain("Invalid --since value");
  });

  test("no ollama: normal mode returns 1 with actionable stderr message", async () => {
    const stateDir = join(tmpdir(), "distill-test-noollama-" + Math.random().toString(36).slice(2));
    const dbPath = join(tmpdir(), "distill-test-noollama-" + Math.random().toString(36).slice(2) + ".db");
    createFileDb(dbPath, [{ id: "sess-1", timeUpdated: 1000, text: "hello" }]);

    const stderrLines: string[] = [];
    globalThis.fetch = mockOllamaDown();
    process.env.OLLAMA_DISTILL_STATE_DIR = stateDir;
    process.env.OPENCODE_DB_PATH = dbPath;

    try {
      const code = await main(["bun", "script.ts"], () => {}, (s) => stderrLines.push(s));
      expect(code).toBe(1);
      const stderr = stderrLines.join("");
      expect(stderr).toContain("ollama serve");
      expect(stderr).toContain("127.0.0.1:11434");
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.OLLAMA_DISTILL_STATE_DIR;
      delete process.env.OPENCODE_DB_PATH;
      if (existsSync(dbPath)) unlinkSync(dbPath);
    }
  });

  test("--session does not advance cursor: cursor file not created, JSONL written, output to stdout", async () => {
    const stateDir = join(tmpdir(), "distill-test-session-" + Math.random().toString(36).slice(2));
    const dbPath = join(tmpdir(), "distill-test-session-" + Math.random().toString(36).slice(2) + ".db");
    createFileDb(dbPath, [{ id: "ses_test123", timeUpdated: 2000, text: "session content here" }]);

    const stdoutLines: string[] = [];
    globalThis.fetch = mockOllamaOk();
    process.env.OLLAMA_DISTILL_STATE_DIR = stateDir;
    process.env.OPENCODE_DB_PATH = dbPath;

    try {
      const code = await main(["bun", "script.ts", "--session=ses_test123"], (s) => stdoutLines.push(s), () => {});
      expect(code).toBe(0);

      // Cursor must NOT be created (does not advance cursor)
      expect(existsSync(join(stateDir, "cursor.json"))).toBe(false);

      // JSONL IS written (all distillation activity is auditable)
      const logPath = join(stateDir, "runs.jsonl");
      expect(existsSync(logPath)).toBe(true);
      const record = JSON.parse(readFileSync(logPath, "utf8").trim());
      expect(record.mode).toBe("session");

      // Output should contain the session block
      const stdout = stdoutLines.join("");
      expect(stdout).toContain("ses_test123");

      // Default report path (YYYY-MM-DD.md) must NOT be touched
      const dateStr = new Date().toISOString().slice(0, 10);
      const defaultReport = join(stateDir, "reports", `${dateStr}.md`);
      expect(existsSync(defaultReport)).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.OLLAMA_DISTILL_STATE_DIR;
      delete process.env.OPENCODE_DB_PATH;
      if (existsSync(dbPath)) unlinkSync(dbPath);
    }
  });

  test("--session + --out: writes to file, JSONL records mode: session", async () => {
    const stateDir = join(tmpdir(), "distill-test-session-out-" + Math.random().toString(36).slice(2));
    const dbPath = join(tmpdir(), "distill-test-session-out-" + Math.random().toString(36).slice(2) + ".db");
    const outPath = join(tmpdir(), "distill-session-out-" + Math.random().toString(36).slice(2) + ".md");
    createFileDb(dbPath, [{ id: "ses_outtest", timeUpdated: 3000, text: "output test content" }]);

    globalThis.fetch = mockOllamaOk("## Session Insight\n\nSpecific detail here.");
    process.env.OLLAMA_DISTILL_STATE_DIR = stateDir;
    process.env.OPENCODE_DB_PATH = dbPath;

    try {
      const code = await main(
        ["bun", "script.ts", "--session=ses_outtest", `--out=${outPath}`],
        () => {}, () => {}
      );
      expect(code).toBe(0);

      // File written to --out path
      expect(existsSync(outPath)).toBe(true);
      const content = readFileSync(outPath, "utf8");
      expect(content).toContain("ses_outtest");

      // JSONL records mode: session
      const logPath = join(stateDir, "runs.jsonl");
      if (existsSync(logPath)) {
        const line = readFileSync(logPath, "utf8").trim().split("\n").pop()!;
        const record = JSON.parse(line);
        expect(record.mode).toBe("session");
      }
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.OLLAMA_DISTILL_STATE_DIR;
      delete process.env.OPENCODE_DB_PATH;
      if (existsSync(dbPath)) unlinkSync(dbPath);
      if (existsSync(outPath)) unlinkSync(outPath);
    }
  });

  test("bootstrap on first run: cursor file created after normal mode success", async () => {
    const stateDir = join(tmpdir(), "distill-test-bootstrap-" + Math.random().toString(36).slice(2));
    const dbPath = join(tmpdir(), "distill-test-bootstrap-" + Math.random().toString(36).slice(2) + ".db");
    // Sessions with time_updated far in the past so they're selected by the default 7d cursor
    const now = Date.now();
    createFileDb(dbPath, [
      { id: "ses_boot1", timeUpdated: now - 3 * 24 * 3600 * 1000, text: "bootstrap session" },
    ]);

    globalThis.fetch = mockOllamaOk();
    process.env.OLLAMA_DISTILL_STATE_DIR = stateDir;
    process.env.OPENCODE_DB_PATH = dbPath;

    try {
      const code = await main(["bun", "script.ts"], () => {}, () => {});
      expect(code).toBe(0);

      // Cursor file must be created
      const cursorPath = join(stateDir, "cursor.json");
      expect(existsSync(cursorPath)).toBe(true);
      const cursor = JSON.parse(readFileSync(cursorPath, "utf8"));
      expect(typeof cursor.last_run_timestamp).toBe("number");
      expect(cursor.last_run_timestamp).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.OLLAMA_DISTILL_STATE_DIR;
      delete process.env.OPENCODE_DB_PATH;
      if (existsSync(dbPath)) unlinkSync(dbPath);
    }
  });

  test("Fix #2 cursor floor: no cursor + all sessions fail → cursor.json written at bootstrap floor", async () => {
    const stateDir = join(tmpdir(), "distill-test-floor-" + Math.random().toString(36).slice(2));
    const dbPath = join(tmpdir(), "distill-test-floor-" + Math.random().toString(36).slice(2) + ".db");
    const runStart = Date.now();
    const now = runStart;
    createFileDb(dbPath, [
      { id: "ses_fl1", timeUpdated: now - 5 * 24 * 3600 * 1000, text: "session one" },
      { id: "ses_fl2", timeUpdated: now - 4 * 24 * 3600 * 1000, text: "session two" },
    ]);

    // No cursor file exists — bootstrap default is 7 days ago
    globalThis.fetch = async (url: string | URL | Request, _init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : (url as Request).url;
      if (urlStr.includes("/api/tags")) {
        return new Response(JSON.stringify({ models: [] }), { status: 200 });
      }
      if (urlStr.includes("/api/chat")) {
        return new Response("Internal Server Error", { status: 500, statusText: "Internal Server Error" });
      }
      throw new Error(`Unexpected URL: ${urlStr}`);
    };

    process.env.OLLAMA_DISTILL_STATE_DIR = stateDir;
    process.env.OPENCODE_DB_PATH = dbPath;

    try {
      const code = await main(["bun", "script.ts"], () => {}, () => {});
      expect(code).toBe(1); // all failed → non-zero exit

      // (a) cursor.json must be written even though zero sessions succeeded
      const cursorPath = join(stateDir, "cursor.json");
      expect(existsSync(cursorPath)).toBe(true);

      // (b) its last_run_timestamp equals the bootstrap floor (7 days ago ± 5s tolerance)
      const cursor = JSON.parse(readFileSync(cursorPath, "utf8"));
      const sevenDaysMs = 7 * 24 * 3600 * 1000;
      const expectedFloor = runStart - sevenDaysMs;
      expect(cursor.last_run_timestamp).toBeGreaterThanOrEqual(expectedFloor - 5000);
      expect(cursor.last_run_timestamp).toBeLessThanOrEqual(expectedFloor + 5000);

      // (c) a second run reads that cursor and uses it as the recency window start
      //     (i.e., sessions from before the floor are not re-selected)
      //     We verify by checking the cursor value is used: insert a session older than
      //     the floor and confirm it would not be selected on next run.
      //     Simplest proxy: the cursor timestamp is close to 7d ago, not 0 or "now".
      expect(cursor.last_run_timestamp).toBeGreaterThan(runStart - sevenDaysMs - 10_000);
      expect(cursor.last_run_timestamp).toBeLessThan(runStart - sevenDaysMs + 10_000);
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.OLLAMA_DISTILL_STATE_DIR;
      delete process.env.OPENCODE_DB_PATH;
      if (existsSync(dbPath)) unlinkSync(dbPath);
    }
  });

  test("partial success: 2nd Ollama call fails → returns 1, JSONL errors has 1 entry", async () => {
    const stateDir = join(tmpdir(), "distill-test-partial-" + Math.random().toString(36).slice(2));
    const dbPath = join(tmpdir(), "distill-test-partial-" + Math.random().toString(36).slice(2) + ".db");
    const now = Date.now();
    createFileDb(dbPath, [
      { id: "ses_p1", timeUpdated: now - 5 * 24 * 3600 * 1000, text: "session one" },
      { id: "ses_p2", timeUpdated: now - 4 * 24 * 3600 * 1000, text: "session two" },
      { id: "ses_p3", timeUpdated: now - 3 * 24 * 3600 * 1000, text: "session three" },
    ]);

    let chatCallCount = 0;
    globalThis.fetch = async (url: string | URL | Request, _init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : (url as Request).url;
      if (urlStr.includes("/api/tags")) {
        return new Response(JSON.stringify({ models: [] }), { status: 200 });
      }
      if (urlStr.includes("/api/chat")) {
        chatCallCount++;
        if (chatCallCount === 2) {
          // 2nd call fails
          return new Response("Internal Server Error", { status: 500, statusText: "Internal Server Error" });
        }
        return new Response(JSON.stringify({ message: { content: "## Insight\n\nGood content." } }), { status: 200 });
      }
      throw new Error(`Unexpected URL: ${urlStr}`);
    };

    process.env.OLLAMA_DISTILL_STATE_DIR = stateDir;
    process.env.OPENCODE_DB_PATH = dbPath;

    try {
      const code = await main(["bun", "script.ts"], () => {}, () => {});
      expect(code).toBe(1); // any error → non-zero

      // JSONL should record the error
      const logPath = join(stateDir, "runs.jsonl");
      expect(existsSync(logPath)).toBe(true);
      const line = readFileSync(logPath, "utf8").trim().split("\n").pop()!;
      const record = JSON.parse(line);
      expect(record.success).toBe(false);
      expect(record.errors.length).toBeGreaterThanOrEqual(1);
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.OLLAMA_DISTILL_STATE_DIR;
      delete process.env.OPENCODE_DB_PATH;
      if (existsSync(dbPath)) unlinkSync(dbPath);
    }
  });

  test("schema error: DB missing column → main returns 1", async () => {
    const stateDir = join(tmpdir(), "distill-test-schema-" + Math.random().toString(36).slice(2));
    const dbPath = join(tmpdir(), "distill-test-schema-" + Math.random().toString(36).slice(2) + ".db");

    // Create DB missing session.parent_id
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, time_created INTEGER, time_updated INTEGER);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT);
    `);
    db.close();

    globalThis.fetch = mockOllamaOk();
    process.env.OLLAMA_DISTILL_STATE_DIR = stateDir;
    process.env.OPENCODE_DB_PATH = dbPath;

    try {
      const code = await main(["bun", "script.ts"], () => {}, () => {});
      expect(code).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.OLLAMA_DISTILL_STATE_DIR;
      delete process.env.OPENCODE_DB_PATH;
      if (existsSync(dbPath)) unlinkSync(dbPath);
    }
  });

  // Fix #1: Cursor advances only through contiguous successful prefix
  test("Fix #1: middle session fails → cursor advances only to session-1's time_updated", async () => {
    const stateDir = join(tmpdir(), "distill-test-cursor-fix1-" + Math.random().toString(36).slice(2));
    const dbPath = join(tmpdir(), "distill-test-cursor-fix1-" + Math.random().toString(36).slice(2) + ".db");
    const now = Date.now();
    const s1Time = now - 5 * 24 * 3600 * 1000;
    const s2Time = now - 4 * 24 * 3600 * 1000;
    const s3Time = now - 3 * 24 * 3600 * 1000;

    createFileDb(dbPath, [
      { id: "ses_c1", timeUpdated: s1Time, text: "session one" },
      { id: "ses_c2", timeUpdated: s2Time, text: "session two" },
      { id: "ses_c3", timeUpdated: s3Time, text: "session three" },
    ]);

    let chatCallCount = 0;
    globalThis.fetch = async (url: string | URL | Request, _init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : (url as Request).url;
      if (urlStr.includes("/api/tags")) {
        return new Response(JSON.stringify({ models: [] }), { status: 200 });
      }
      if (urlStr.includes("/api/chat")) {
        chatCallCount++;
        if (chatCallCount === 2) {
          // Middle session (ses_c2) fails
          return new Response("Internal Server Error", { status: 500, statusText: "Internal Server Error" });
        }
        return new Response(JSON.stringify({ message: { content: "## Insight\n\nGood content." } }), { status: 200 });
      }
      throw new Error(`Unexpected URL: ${urlStr}`);
    };

    process.env.OLLAMA_DISTILL_STATE_DIR = stateDir;
    process.env.OPENCODE_DB_PATH = dbPath;

    try {
      const code = await main(["bun", "script.ts"], () => {}, () => {});
      expect(code).toBe(1); // partial failure

      // Cursor should be at ses_c1's time_updated, NOT ses_c3's
      const cursorPath = join(stateDir, "cursor.json");
      expect(existsSync(cursorPath)).toBe(true);
      const cursor = JSON.parse(readFileSync(cursorPath, "utf8"));
      // Should be at s1Time (first session succeeded, second failed → stop there)
      expect(cursor.last_run_timestamp).toBe(s1Time);
      // Must NOT be at s3Time
      expect(cursor.last_run_timestamp).not.toBe(s3Time);
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.OLLAMA_DISTILL_STATE_DIR;
      delete process.env.OPENCODE_DB_PATH;
      if (existsSync(dbPath)) unlinkSync(dbPath);
    }
  });

  test("Fix #1: first session fails → cursor written at window floor (not advanced)", async () => {
    const stateDir = join(tmpdir(), "distill-test-cursor-fix1b-" + Math.random().toString(36).slice(2));
    const dbPath = join(tmpdir(), "distill-test-cursor-fix1b-" + Math.random().toString(36).slice(2) + ".db");
    const now = Date.now();
    const s1Time = now - 5 * 24 * 3600 * 1000;
    const s2Time = now - 4 * 24 * 3600 * 1000;

    createFileDb(dbPath, [
      { id: "ses_f1", timeUpdated: s1Time, text: "session one" },
      { id: "ses_f2", timeUpdated: s2Time, text: "session two" },
    ]);

    // Pre-write a cursor so we can verify it stays at the floor
    mkdirSync(stateDir, { recursive: true });
    const initialCursorTs = s1Time - 1000;
    writeFileSync(join(stateDir, "cursor.json"), JSON.stringify({ last_run_timestamp: initialCursorTs }));

    let chatCallCount = 0;
    globalThis.fetch = async (url: string | URL | Request, _init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : (url as Request).url;
      if (urlStr.includes("/api/tags")) {
        return new Response(JSON.stringify({ models: [] }), { status: 200 });
      }
      if (urlStr.includes("/api/chat")) {
        chatCallCount++;
        // ALL calls fail
        return new Response("Internal Server Error", { status: 500, statusText: "Internal Server Error" });
      }
      throw new Error(`Unexpected URL: ${urlStr}`);
    };

    process.env.OLLAMA_DISTILL_STATE_DIR = stateDir;
    process.env.OPENCODE_DB_PATH = dbPath;

    try {
      const code = await main(["bun", "script.ts"], () => {}, () => {});
      expect(code).toBe(1);

      // Cursor must be written (Fix #2: always write cursor), but at the window floor
      // (initialCursorTs), not advanced to any session's time_updated
      const cursor = JSON.parse(readFileSync(join(stateDir, "cursor.json"), "utf8"));
      expect(cursor.last_run_timestamp).toBe(initialCursorTs);
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.OLLAMA_DISTILL_STATE_DIR;
      delete process.env.OPENCODE_DB_PATH;
      if (existsSync(dbPath)) unlinkSync(dbPath);
    }
  });

  // Fix #2: File lock prevents concurrent runs
  test("Fix #2: lock file present with live PID → main exits 1 with 'another distill run' message", async () => {
    const stateDir = join(tmpdir(), "distill-test-lock-" + Math.random().toString(36).slice(2));
    mkdirSync(stateDir, { recursive: true });

    // Write a lock file with the CURRENT process PID (live process — not stale)
    const lockPath = join(stateDir, ".lock");
    writeFileSync(lockPath, `${process.pid}\n2026-01-01T00:00:00.000Z\n`);

    const stderrLines: string[] = [];
    process.env.OLLAMA_DISTILL_STATE_DIR = stateDir;
    process.env.OPENCODE_DB_PATH = "/nonexistent/path.db"; // won't be reached

    try {
      const code = await main(["bun", "script.ts"], () => {}, (s) => stderrLines.push(s));
      expect(code).toBe(1);
      expect(stderrLines.join("")).toContain("another distill run");
    } finally {
      delete process.env.OLLAMA_DISTILL_STATE_DIR;
      delete process.env.OPENCODE_DB_PATH;
      if (existsSync(lockPath)) unlinkSync(lockPath);
    }
  });

  // Fix #5: Early failures write JSONL record
  test("Fix #5: DB-not-found → JSONL record written with phase: db-not-found", async () => {
    const stateDir = join(tmpdir(), "distill-test-early-fail-" + Math.random().toString(36).slice(2));

    globalThis.fetch = mockOllamaOk();
    process.env.OLLAMA_DISTILL_STATE_DIR = stateDir;
    process.env.OPENCODE_DB_PATH = "/nonexistent/path/opencode.db";

    try {
      const code = await main(["bun", "script.ts"], () => {}, () => {});
      expect(code).toBe(1);

      const logPath = join(stateDir, "runs.jsonl");
      expect(existsSync(logPath)).toBe(true);
      const line = readFileSync(logPath, "utf8").trim();
      const record = JSON.parse(line);
      expect(record.success).toBe(false);
      expect(record.errors.length).toBeGreaterThan(0);
      // db-not-found when env var not set; db-open-failure when path set but invalid
      expect(["db-not-found", "db-open-failure"]).toContain(record.errors[0].phase);
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.OLLAMA_DISTILL_STATE_DIR;
      delete process.env.OPENCODE_DB_PATH;
    }
  });

  test("Fix #5: schema-invariant-violation → JSONL record written with phase: schema-invariant-violation", async () => {
    const stateDir = join(tmpdir(), "distill-test-schema-fail-" + Math.random().toString(36).slice(2));
    const dbPath = join(tmpdir(), "distill-test-schema-fail-" + Math.random().toString(36).slice(2) + ".db");

    // DB missing parent_id → schema error
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, time_created INTEGER, time_updated INTEGER);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT);
    `);
    db.close();

    globalThis.fetch = mockOllamaOk();
    process.env.OLLAMA_DISTILL_STATE_DIR = stateDir;
    process.env.OPENCODE_DB_PATH = dbPath;

    try {
      const code = await main(["bun", "script.ts"], () => {}, () => {});
      expect(code).toBe(1);

      const logPath = join(stateDir, "runs.jsonl");
      expect(existsSync(logPath)).toBe(true);
      const line = readFileSync(logPath, "utf8").trim();
      const record = JSON.parse(line);
      expect(record.success).toBe(false);
      // Schema error is caught during openDatabase (db-open-failure) or selectSessions
      expect(["db-open-failure", "schema-invariant-violation"]).toContain(record.errors[0].phase);
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.OLLAMA_DISTILL_STATE_DIR;
      delete process.env.OPENCODE_DB_PATH;
      if (existsSync(dbPath)) unlinkSync(dbPath);
    }
  });

  // FIX-T1: truncated segment → exit 1, phase:"truncation" in JSONL, cursor not advanced
  test("truncated segment: exit 1, JSONL has phase:truncation, cursor not advanced past session", async () => {
    const stateDir = join(tmpdir(), "distill-test-trunc-" + Math.random().toString(36).slice(2));
    const dbPath = join(tmpdir(), "distill-test-trunc-" + Math.random().toString(36).slice(2) + ".db");
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    // One root session with a part whose text exceeds SEGMENT_HARD_CAP (70K)
    createFileDb(dbPath, [{
      id: "ses_trunc1",
      timeUpdated: now - 1000,
      text: "x".repeat(80_000),
    }]);

    globalThis.fetch = mockOllamaOk("## Test Block\n\n**Category:** Test\n**Insight:** mocked\n");
    process.env.OLLAMA_DISTILL_STATE_DIR = stateDir;
    process.env.OPENCODE_DB_PATH = dbPath;

    try {
      const code = await main(["bun", "script.ts"], () => {}, () => {});
      expect(code).toBe(1);

      // JSONL: errors array must contain a truncation entry for this session
      const logPath = join(stateDir, "runs.jsonl");
      expect(existsSync(logPath)).toBe(true);
      const record = JSON.parse(readFileSync(logPath, "utf8").trim());
      const truncErr = record.errors?.find(
        (e: { phase: string; session_id: string }) => e.phase === "truncation" && e.session_id === "ses_trunc1"
      );
      expect(truncErr).toBeDefined();

      // Cursor must NOT have advanced past the truncated session — stays at bootstrap floor
      const cursorPath = join(stateDir, "cursor.json");
      expect(existsSync(cursorPath)).toBe(true);
      const cursor = JSON.parse(readFileSync(cursorPath, "utf8"));
      expect(cursor.last_run_timestamp).toBeGreaterThan(now - SEVEN_DAYS_MS - 5000);
      expect(cursor.last_run_timestamp).toBeLessThan(now - SEVEN_DAYS_MS + 5000);
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.OLLAMA_DISTILL_STATE_DIR;
      delete process.env.OPENCODE_DB_PATH;
      if (existsSync(dbPath)) unlinkSync(dbPath);
    }
  });
});

// ── acquireLock / releaseLock tests ───────────────────────────────────────────

describe("acquireLock / releaseLock", () => {
  test("Fix #2: acquireLock creates lock file with PID content", () => {
    const stateDir = join(tmpdir(), "distill-lock-test-" + Math.random().toString(36).slice(2));
    const lockPath = acquireLock(stateDir);
    expect(existsSync(lockPath)).toBe(true);
    releaseLock(lockPath);
    expect(existsSync(lockPath)).toBe(false);
  });

  test("Fix #2: acquireLock throws when lock already held", () => {
    const stateDir = join(tmpdir(), "distill-lock-test2-" + Math.random().toString(36).slice(2));
    const lockPath = acquireLock(stateDir);
    try {
      expect(() => acquireLock(stateDir)).toThrow("another distill run");
    } finally {
      releaseLock(lockPath);
    }
  });
});

// ─── v1.2: chunkSegments tests ────────────────────────────────────────────────

describe("chunkSegments", () => {
  function seg(role: "USER" | "ASSISTANT", chars: number): MessageSegment {
    return { role, text: "x".repeat(chars), char_count: chars };
  }

  test("empty input returns empty array", () => {
    expect(chunkSegments([])).toEqual([]);
  });

  test("single small segment returns one chunk", () => {
    const segments = [seg("USER", 100)];
    const chunks = chunkSegments(segments);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(1);
  });

  test("exactly-target-sized segment returns one chunk", () => {
    // 55000 chars + 12 overhead = 55012, which is > target (55000), but since
    // current is empty we always push the first segment regardless
    const segments = [seg("USER", 55_000)];
    const chunks = chunkSegments(segments);
    expect(chunks).toHaveLength(1);
  });

  test("multiple small segments that fit in one chunk", () => {
    // 3 segments of 10K each = 30K + overhead, well under 55K target
    const segments = [seg("USER", 10_000), seg("ASSISTANT", 10_000), seg("USER", 10_000)];
    const chunks = chunkSegments(segments);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(3);
  });

  test("segments spanning two chunks when target exceeded", () => {
    // 3 segments of 30K each: first two would be 60K+overhead > 55K target
    // so: chunk1=[seg0, seg1 won't fit at target], chunk2=[seg1, seg2 won't fit], chunk3=[seg2]
    // Actually: seg0 (30K+12=30012) fits in chunk1. seg1 (30012) would make 60024 > 55000 target
    // → finalize chunk1=[seg0], start chunk2 with seg1. seg2 (30012) would make 60024 > 55000
    // → finalize chunk2=[seg1], start chunk3 with seg2.
    const segments = [seg("USER", 30_000), seg("ASSISTANT", 30_000), seg("USER", 30_000)];
    const chunks = chunkSegments(segments);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(1);
    expect(chunks[1]).toHaveLength(1);
    expect(chunks[2]).toHaveLength(1);
  });

  test("segments that pack perfectly under target stay in one chunk", () => {
    // Two segments of 20K each: 20012 + 20012 = 40024 < 55000 target → one chunk
    const segments = [seg("USER", 20_000), seg("ASSISTANT", 20_000)];
    const chunks = chunkSegments(segments);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(2);
  });

  test("segment exceeding hard cap forces its own chunk", () => {
    // A pre-truncated segment at exactly SEGMENT_HARD_CAP (70K) chars
    // It's the first segment so it always goes into its own chunk
    const bigSeg = seg("USER", 70_000);
    const smallSeg = seg("ASSISTANT", 100);
    const chunks = chunkSegments([bigSeg, smallSeg]);
    // bigSeg alone: 70000+12=70012 > hardCap(70000) but it's first so it goes in chunk1
    // smallSeg: currentChars=70012, adding 112 > hardCap → finalize chunk1, start chunk2
    expect(chunks).toHaveLength(2);
    expect(chunks[0][0]).toBe(bigSeg);
    expect(chunks[1][0]).toBe(smallSeg);
  });

  test("exceeds hard cap forces split mid-sequence", () => {
    // seg0=40K, seg1=35K: 40012+35012=75024 > hardCap(70000) → split
    const s0 = seg("USER", 40_000);
    const s1 = seg("ASSISTANT", 35_000);
    const chunks = chunkSegments([s0, s1]);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toContain(s0);
    expect(chunks[1]).toContain(s1);
  });
});

// ─── v1.2: renderChunkTranscript tests ───────────────────────────────────────

describe("renderChunkTranscript", () => {
  test("single USER segment renders correctly", () => {
    const segments: MessageSegment[] = [{ role: "USER", text: "hello world", char_count: 11 }];
    expect(renderChunkTranscript(segments)).toBe("USER: hello world");
  });

  test("single ASSISTANT segment renders correctly", () => {
    const segments: MessageSegment[] = [{ role: "ASSISTANT", text: "hi there", char_count: 8 }];
    expect(renderChunkTranscript(segments)).toBe("ASSISTANT: hi there");
  });

  test("multi-segment renders with role prefixes and newlines", () => {
    const segments: MessageSegment[] = [
      { role: "USER", text: "question", char_count: 8 },
      { role: "ASSISTANT", text: "answer", char_count: 6 },
    ];
    expect(renderChunkTranscript(segments)).toBe("USER: question\nASSISTANT: answer");
  });

  test("USER+ASSISTANT alternation renders in order", () => {
    const segments: MessageSegment[] = [
      { role: "USER", text: "a", char_count: 1 },
      { role: "ASSISTANT", text: "b", char_count: 1 },
      { role: "USER", text: "c", char_count: 1 },
    ];
    expect(renderChunkTranscript(segments)).toBe("USER: a\nASSISTANT: b\nUSER: c");
  });

  test("ASSISTANT-only segment renders correctly", () => {
    const segments: MessageSegment[] = [
      { role: "ASSISTANT", text: "standalone", char_count: 10 },
    ];
    expect(renderChunkTranscript(segments)).toBe("ASSISTANT: standalone");
  });

  test("empty segments returns empty string", () => {
    expect(renderChunkTranscript([])).toBe("");
  });
});

// ─── v1.2: end-to-end chunked inference tests ────────────────────────────────

// Helper: create a DB with sessions where each session has a long transcript
function createChunkedDb(
  dbPath: string,
  sessions: Array<{ id: string; timeUpdated: number; messages: Array<{ role: string; text: string }> }>
) {
  const db = new Database(dbPath);
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

  for (const session of sessions) {
    db.run(
      "INSERT INTO session (id, project_id, parent_id, time_created, time_updated) VALUES (?, NULL, NULL, ?, ?)",
      [session.id, session.timeUpdated - 1000, session.timeUpdated]
    );

    for (let i = 0; i < session.messages.length; i++) {
      const msg = session.messages[i];
      const msgId = `${session.id}-msg-${i}`;
      db.run(
        "INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)",
        [msgId, session.id, session.timeUpdated - 1000 + i, JSON.stringify({ role: msg.role })]
      );
      const partId = `${session.id}-part-${i}`;
      db.run(
        "INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)",
        [partId, msgId, session.id, session.timeUpdated - 1000 + i, JSON.stringify({ type: "text", text: msg.text })]
      );
    }
  }

  db.close();
}

describe("v1.2 end-to-end chunked inference", () => {
  test("session with 3 segments totaling ~100K chars produces 2 chunks, both succeed, report has (2 chunks) suffix", async () => {
    const stateDir = join(tmpdir(), "distill-e2e-chunked-" + Math.random().toString(36).slice(2));
    const dbPath = join(tmpdir(), "distill-e2e-chunked-" + Math.random().toString(36).slice(2) + ".db");
    const now = Date.now();

    // 3 messages of ~20K chars each = ~60K total → should produce 2 chunks
    // chunk1: msg0+msg1 = 40K+overhead < 55K target; msg2 would push to 60K > 55K → split
    // chunk2: msg2 alone
    const text20K = "A".repeat(20_000);
    createChunkedDb(dbPath, [
      {
        id: "ses_chunked1",
        timeUpdated: now - 1000,
        messages: [
          { role: "user", text: text20K },
          { role: "assistant", text: text20K },
          { role: "user", text: text20K },
        ],
      },
    ]);

    let ollamaCallCount = 0;
    globalThis.fetch = async (url: string | URL | Request, _init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : (url as Request).url;
      if (urlStr.includes("/api/tags")) {
        return new Response(JSON.stringify({ models: [] }), { status: 200 });
      }
      if (urlStr.includes("/api/chat")) {
        ollamaCallCount++;
        return new Response(
          JSON.stringify({ message: { content: `## Chunk ${ollamaCallCount} Summary\n\nContent here.` } }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected URL: ${urlStr}`);
    };

    const reportPath = join(stateDir, "test-report.md");
    process.env.OLLAMA_DISTILL_STATE_DIR = stateDir;
    process.env.OPENCODE_DB_PATH = dbPath;

    try {
      const code = await main(["bun", "script.ts", `--out=${reportPath}`], () => {}, () => {});
      expect(code).toBe(0);

      // Should have called Ollama twice (2 chunks)
      expect(ollamaCallCount).toBe(2);

      // Report should exist and contain "(2 chunks)" in the session header
      expect(existsSync(reportPath)).toBe(true);
      const reportContent = readFileSync(reportPath, "utf8");
      expect(reportContent).toContain("(2 chunks)");
      expect(reportContent).toContain("Chunk 1 Summary");
      expect(reportContent).toContain("Chunk 2 Summary");

      // Cursor should be advanced (session succeeded)
      const cursor = JSON.parse(readFileSync(join(stateDir, "cursor.json"), "utf8"));
      expect(cursor.last_run_timestamp).toBe(now - 1000);
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.OLLAMA_DISTILL_STATE_DIR;
      delete process.env.OPENCODE_DB_PATH;
      if (existsSync(dbPath)) unlinkSync(dbPath);
    }
  });

  test("2 chunks, second chunk fails Ollama → session marked FAILED, error has chunk index", async () => {
    const stateDir = join(tmpdir(), "distill-e2e-chunk-fail-" + Math.random().toString(36).slice(2));
    const dbPath = join(tmpdir(), "distill-e2e-chunk-fail-" + Math.random().toString(36).slice(2) + ".db");
    const now = Date.now();

    const text34K = "B".repeat(34_000);
    createChunkedDb(dbPath, [
      {
        id: "ses_failchunk",
        timeUpdated: now - 1000,
        messages: [
          { role: "user", text: text34K },
          { role: "assistant", text: text34K },
          { role: "user", text: text34K },
        ],
      },
    ]);

    let ollamaCallCount = 0;
    globalThis.fetch = async (url: string | URL | Request, _init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : (url as Request).url;
      if (urlStr.includes("/api/tags")) {
        return new Response(JSON.stringify({ models: [] }), { status: 200 });
      }
      if (urlStr.includes("/api/chat")) {
        ollamaCallCount++;
        if (ollamaCallCount === 2) {
          // Second chunk fails
          return new Response("Internal Server Error", { status: 500, statusText: "Internal Server Error" });
        }
        return new Response(
          JSON.stringify({ message: { content: "## Summary\n\nContent." } }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected URL: ${urlStr}`);
    };

    process.env.OLLAMA_DISTILL_STATE_DIR = stateDir;
    process.env.OPENCODE_DB_PATH = dbPath;

    try {
      const code = await main(["bun", "script.ts"], () => {}, () => {});
      expect(code).toBe(1); // failure

      // Cursor should NOT be advanced (session failed)
      const cursorPath = join(stateDir, "cursor.json");
      expect(existsSync(cursorPath)).toBe(true);
      const cursor = JSON.parse(readFileSync(cursorPath, "utf8"));
      // Cursor stays at window floor, not at session's time_updated
      expect(cursor.last_run_timestamp).not.toBe(now - 1000);

      // JSONL log should have error with chunk index in message
      const logPath = join(stateDir, "runs.jsonl");
      expect(existsSync(logPath)).toBe(true);
      const record = JSON.parse(readFileSync(logPath, "utf8").trim());
      expect(record.success).toBe(false);
      expect(record.errors.length).toBeGreaterThan(0);
      expect(record.errors[0].phase).toBe("ollama");
      expect(record.errors[0].message).toContain("chunk 2/");
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.OLLAMA_DISTILL_STATE_DIR;
      delete process.env.OPENCODE_DB_PATH;
      if (existsSync(dbPath)) unlinkSync(dbPath);
    }
  });

  test("regression: small single-chunk session produces header WITHOUT (N chunks) suffix", async () => {
    const stateDir = join(tmpdir(), "distill-e2e-single-chunk-" + Math.random().toString(36).slice(2));
    const dbPath = join(tmpdir(), "distill-e2e-single-chunk-" + Math.random().toString(36).slice(2) + ".db");
    const now = Date.now();

    // Small transcript — fits in one chunk
    createChunkedDb(dbPath, [
      {
        id: "ses_small",
        timeUpdated: now - 1000,
        messages: [
          { role: "user", text: "Hello, what is 2+2?" },
          { role: "assistant", text: "It is 4." },
        ],
      },
    ]);

    globalThis.fetch = async (url: string | URL | Request, _init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : (url as Request).url;
      if (urlStr.includes("/api/tags")) {
        return new Response(JSON.stringify({ models: [] }), { status: 200 });
      }
      if (urlStr.includes("/api/chat")) {
        return new Response(
          JSON.stringify({ message: { content: "## Summary\n\nSimple session." } }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected URL: ${urlStr}`);
    };

    const reportPath = join(stateDir, "test-report.md");
    process.env.OLLAMA_DISTILL_STATE_DIR = stateDir;
    process.env.OPENCODE_DB_PATH = dbPath;

    try {
      const code = await main(["bun", "script.ts", `--out=${reportPath}`], () => {}, () => {});
      expect(code).toBe(0);

      const reportContent = readFileSync(reportPath, "utf8");
      // Should NOT contain "(N chunks)" suffix for single-chunk sessions
      expect(reportContent).not.toContain("chunks)");
      // Should contain the session header without chunk count
      expect(reportContent).toContain("ses_small");
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.OLLAMA_DISTILL_STATE_DIR;
      delete process.env.OPENCODE_DB_PATH;
      if (existsSync(dbPath)) unlinkSync(dbPath);
    }
  });
});

// ─── v1.2 smoke-fix tests (Fix A/B/C/D) ──────────────────────────────────────

describe("v1.2 smoke fixes", () => {
  // Fix A: timeout string uses 600s
  test("Fix A: timeout error string contains '600s'", async () => {
    globalThis.fetch = async () => {
      const err = new Error("The operation was aborted due to timeout");
      err.name = "TimeoutError";
      throw err;
    };
    try {
      const result = await callOllama("test");
      expect(result.error).toContain("600s");
      expect(result.error).not.toContain("300s");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // Fix B: selectSessions no longer caps by bytes — large sessions all selected
  test("Fix B: 10 sessions × 200K chars each all selected when maxSessions=10", async () => {
    const db = createSelectionDb();
    const bigText = "x".repeat(200_000);
    for (let i = 0; i < 10; i++) {
      insertSessionWithText(db, `big-sess-${i}`, 2000 + i, bigText);
    }
    const result = await selectSessions(db, 0, 10);
    expect(result.sessions.length).toBe(10);
    db.close();
  });

  // Fix C: partial-success session writes blocks to report
  test("Fix C: partial-success (3/5 chunks) writes 3 blocks, title contains '3/5 chunks succeeded', sessionSucceeded=false", async () => {
    const stateDir = join(tmpdir(), "distill-partial-c-" + Math.random().toString(36).slice(2));
    const dbPath = join(tmpdir(), "distill-partial-c-" + Math.random().toString(36).slice(2) + ".db");
    const now = Date.now();

    // Create a session with a large transcript that will produce 5+ chunks
    // Each segment ~35K chars → 3 segments per chunk at 55K target → need ~15 segments for 5 chunks
    // Simpler: mock callOllama at the fetch level — succeed on calls 1-3, fail on call 4
    const text35K = "C".repeat(35_000);
    const messages: Array<{ role: string; text: string }> = [];
    for (let i = 0; i < 15; i++) {
      messages.push({ role: i % 2 === 0 ? "user" : "assistant", text: text35K });
    }

    createChunkedDb(dbPath, [
      { id: "ses_partial_c", timeUpdated: now - 1000, messages },
    ]);

    let ollamaCallCount = 0;
    globalThis.fetch = async (url: string | URL | Request, _init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : (url as Request).url;
      if (urlStr.includes("/api/tags")) {
        return new Response(JSON.stringify({ models: [] }), { status: 200 });
      }
      if (urlStr.includes("/api/chat")) {
        ollamaCallCount++;
        if (ollamaCallCount >= 4) {
          return new Response("Internal Server Error", { status: 500 });
        }
        return new Response(
          JSON.stringify({ message: { content: `## Block ${ollamaCallCount}\n\nContent.` } }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected URL: ${urlStr}`);
    };

    const reportPath = join(stateDir, "partial-report.md");
    process.env.OLLAMA_DISTILL_STATE_DIR = stateDir;
    process.env.OPENCODE_DB_PATH = dbPath;

    try {
      const code = await main(["bun", "script.ts", `--out=${reportPath}`], () => {}, () => {});
      expect(code).toBe(1); // partial failure → non-zero

      // Report should exist and contain the partial blocks
      expect(existsSync(reportPath)).toBe(true);
      const reportContent = readFileSync(reportPath, "utf8");
      expect(reportContent).toContain("Block 1");
      expect(reportContent).toContain("Block 2");
      expect(reportContent).toContain("Block 3");
      // Title should indicate partial success
      expect(reportContent).toContain("chunks succeeded");

      // JSONL: success=false, errors has chunk failure, report_path is resolved
      const logPath = join(stateDir, "runs.jsonl");
      const record = JSON.parse(readFileSync(logPath, "utf8").trim());
      expect(record.success).toBe(false);
      expect(record.errors.length).toBeGreaterThan(0);
      expect(record.errors[0].message).toContain("chunk 4/");
      expect(record.report_path).toBe(reportPath);
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.OLLAMA_DISTILL_STATE_DIR;
      delete process.env.OPENCODE_DB_PATH;
      if (existsSync(dbPath)) unlinkSync(dbPath);
    }
  });

  // Fix D: total-failure session — report_path is still resolved in JSONL
  test("Fix D: total-failure (chunk 1 fails) → sessionResults empty, report_path still resolved in JSONL", async () => {
    const stateDir = join(tmpdir(), "distill-total-fail-d-" + Math.random().toString(36).slice(2));
    const dbPath = join(tmpdir(), "distill-total-fail-d-" + Math.random().toString(36).slice(2) + ".db");
    const now = Date.now();

    createFileDb(dbPath, [
      { id: "ses_total_fail", timeUpdated: now - 1000, text: "some content" },
    ]);

    globalThis.fetch = async (url: string | URL | Request, _init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : (url as Request).url;
      if (urlStr.includes("/api/tags")) {
        return new Response(JSON.stringify({ models: [] }), { status: 200 });
      }
      if (urlStr.includes("/api/chat")) {
        return new Response("Internal Server Error", { status: 500 });
      }
      throw new Error(`Unexpected URL: ${urlStr}`);
    };

    const reportPath = join(stateDir, "fail-report.md");
    process.env.OLLAMA_DISTILL_STATE_DIR = stateDir;
    process.env.OPENCODE_DB_PATH = dbPath;

    try {
      const code = await main(["bun", "script.ts", `--out=${reportPath}`], () => {}, () => {});
      expect(code).toBe(1);

      // JSONL: report_path must be the resolved path, not ""
      const logPath = join(stateDir, "runs.jsonl");
      const record = JSON.parse(readFileSync(logPath, "utf8").trim());
      expect(record.success).toBe(false);
      expect(record.report_path).toBe(reportPath);
      expect(record.report_path).not.toBe("");
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.OLLAMA_DISTILL_STATE_DIR;
      delete process.env.OPENCODE_DB_PATH;
      if (existsSync(dbPath)) unlinkSync(dbPath);
    }
  });

  // Fix C+D: multi-session with partial failure — report contains both sessions' content
  test("Fix C+D: session1 partial (3 chunks succeed) + session2 full success (1 chunk) → report has both, report_blocks_generated=4", async () => {
    const stateDir = join(tmpdir(), "distill-multi-partial-" + Math.random().toString(36).slice(2));
    const dbPath = join(tmpdir(), "distill-multi-partial-" + Math.random().toString(36).slice(2) + ".db");
    const now = Date.now();

    // Session 1: large enough to produce 4+ chunks; fail on chunk 4
    const text35K = "D".repeat(35_000);
    const messages1: Array<{ role: string; text: string }> = [];
    for (let i = 0; i < 15; i++) {
      messages1.push({ role: i % 2 === 0 ? "user" : "assistant", text: text35K });
    }

    // Session 2: small, 1 chunk
    createChunkedDb(dbPath, [
      { id: "ses_mp1", timeUpdated: now - 2000, messages: messages1 },
      { id: "ses_mp2", timeUpdated: now - 1000, messages: [{ role: "user", text: "short" }] },
    ]);

    let ollamaCallCount = 0;
    globalThis.fetch = async (url: string | URL | Request, _init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : (url as Request).url;
      if (urlStr.includes("/api/tags")) {
        return new Response(JSON.stringify({ models: [] }), { status: 200 });
      }
      if (urlStr.includes("/api/chat")) {
        ollamaCallCount++;
        // Calls 1-3: session 1 chunks 1-3 succeed; call 4: session 1 chunk 4 fails
        // Call 5: session 2 chunk 1 succeeds
        if (ollamaCallCount === 4) {
          return new Response("Internal Server Error", { status: 500 });
        }
        return new Response(
          JSON.stringify({ message: { content: `## Block ${ollamaCallCount}\n\nContent.` } }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected URL: ${urlStr}`);
    };

    const reportPath = join(stateDir, "multi-report.md");
    process.env.OLLAMA_DISTILL_STATE_DIR = stateDir;
    process.env.OPENCODE_DB_PATH = dbPath;

    try {
      const code = await main(["bun", "script.ts", `--out=${reportPath}`], () => {}, () => {});
      expect(code).toBe(1); // partial failure

      // Report should contain both sessions' content
      expect(existsSync(reportPath)).toBe(true);
      const reportContent = readFileSync(reportPath, "utf8");
      expect(reportContent).toContain("ses_mp1");
      expect(reportContent).toContain("ses_mp2");
      expect(reportContent).toContain("Block 1");
      expect(reportContent).toContain("Block 5"); // session 2's block

      // JSONL: report_blocks_generated = 3 (partial) + 1 (full) = 4
      const logPath = join(stateDir, "runs.jsonl");
      const record = JSON.parse(readFileSync(logPath, "utf8").trim());
      expect(record.report_blocks_generated).toBe(4);
      expect(record.report_path).toBe(reportPath);
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.OLLAMA_DISTILL_STATE_DIR;
      delete process.env.OPENCODE_DB_PATH;
      if (existsSync(dbPath)) unlinkSync(dbPath);
    }
  });
});

// ─── FIX-T2: Stale-lock recovery tests ────────────────────────────────────────

describe("acquireLock stale-lock recovery", () => {
  test("empty lockfile → treated as stale, lock acquired", () => {
    const stateDir = join(tmpdir(), "distill-lock-empty-" + Math.random().toString(36).slice(2));
    mkdirSync(stateDir, { recursive: true });
    const lockPath = join(stateDir, ".lock");
    writeFileSync(lockPath, ""); // empty — malformed

    // Should not throw; stale lock is cleaned up and re-acquired
    let acquiredPath: string | undefined;
    expect(() => { acquiredPath = acquireLock(stateDir); }).not.toThrow();
    expect(existsSync(lockPath)).toBe(true);
    if (acquiredPath) releaseLock(acquiredPath);
  });

  test("lockfile with dead PID → treated as stale, lock acquired", () => {
    const stateDir = join(tmpdir(), "distill-lock-dead-" + Math.random().toString(36).slice(2));
    mkdirSync(stateDir, { recursive: true });
    const lockPath = join(stateDir, ".lock");
    // Use a very high PID that almost certainly doesn't exist
    writeFileSync(lockPath, "9999999\n2026-01-01T00:00:00.000Z\n");

    let acquiredPath: string | undefined;
    expect(() => { acquiredPath = acquireLock(stateDir); }).not.toThrow();
    expect(existsSync(lockPath)).toBe(true);
    if (acquiredPath) releaseLock(acquiredPath);
  });

  test("lockfile with malformed content (non-numeric PID) → treated as stale, lock acquired", () => {
    const stateDir = join(tmpdir(), "distill-lock-malformed-" + Math.random().toString(36).slice(2));
    mkdirSync(stateDir, { recursive: true });
    const lockPath = join(stateDir, ".lock");
    writeFileSync(lockPath, "not-a-pid\n2026-01-01T00:00:00.000Z\n");

    let acquiredPath: string | undefined;
    expect(() => { acquiredPath = acquireLock(stateDir); }).not.toThrow();
    expect(existsSync(lockPath)).toBe(true);
    if (acquiredPath) releaseLock(acquiredPath);
  });

  test("lockfile with live PID → throws 'another distill run' error", () => {
    const stateDir = join(tmpdir(), "distill-lock-live-" + Math.random().toString(36).slice(2));
    mkdirSync(stateDir, { recursive: true });
    const lockPath = join(stateDir, ".lock");
    // Use current process PID — definitely alive
    writeFileSync(lockPath, `${process.pid}\n2026-01-01T00:00:00.000Z\n`);

    expect(() => acquireLock(stateDir)).toThrow(/another distill run/);
    // Clean up manually since we didn't acquire
    unlinkSync(lockPath);
  });
});

// ─── FIX-T3: Process-listener stability ───────────────────────────────────────

describe("main() process listener stability", () => {
  test("calling main() 5 times does not accumulate SIGINT/SIGTERM/exit listeners", async () => {
    const stateDir = join(tmpdir(), "distill-listener-" + Math.random().toString(36).slice(2));
    mkdirSync(stateDir, { recursive: true });
    const dbPath = join(tmpdir(), "distill-listener-" + Math.random().toString(36).slice(2) + ".db");

    // Create a minimal DB so main() gets past DB open
    const db = new Database(dbPath);
    db.run(`CREATE TABLE IF NOT EXISTS session (id TEXT, "time_updated" INTEGER)`);
    db.run(`CREATE TABLE IF NOT EXISTS message (id TEXT, session_id TEXT, data TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS message_part (id TEXT, message_id TEXT, data TEXT)`);
    db.close();

    globalThis.fetch = mockOllamaOk();
    process.env.OLLAMA_DISTILL_STATE_DIR = stateDir;
    process.env.OPENCODE_DB_PATH = dbPath;

    const before = {
      sigint: process.listenerCount("SIGINT"),
      sigterm: process.listenerCount("SIGTERM"),
      exit: process.listenerCount("exit"),
    };

    try {
      for (let i = 0; i < 5; i++) {
        await main(["bun", "script.ts"], () => {}, () => {});
      }

      expect(process.listenerCount("SIGINT")).toBeLessThanOrEqual(before.sigint + 1);
      expect(process.listenerCount("SIGTERM")).toBeLessThanOrEqual(before.sigterm + 1);
      expect(process.listenerCount("exit")).toBeLessThanOrEqual(before.exit + 1);
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.OLLAMA_DISTILL_STATE_DIR;
      delete process.env.OPENCODE_DB_PATH;
      if (existsSync(dbPath)) unlinkSync(dbPath);
    }
  });
});

// ─── FIX-T5: Malformed-200 Ollama response ────────────────────────────────────

describe("callOllama malformed response handling", () => {
  test("HTML 200 response → error contains 'malformed' or 'parse'", async () => {
    globalThis.fetch = async () =>
      new Response("<html>Bad Gateway</html>", { status: 200 });

    try {
      const result = await callOllama("http://127.0.0.1:11434", "sys", "transcript", "ses_x");
      expect(result.output).toBe("");
      expect(result.error).toBeDefined();
      const errMsg = result.error!.toLowerCase();
      expect(errMsg.match(/malformed|parse|json/)).toBeTruthy();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("valid JSON but wrong shape (missing message.content) → error", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ response: "wrong shape" }), { status: 200 });

    try {
      const result = await callOllama("http://127.0.0.1:11434", "sys", "transcript", "ses_x");
      expect(result.output).toBe("");
      expect(result.error).toBeDefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ─── FIX-T6: Cursor non-advancement assertion (strengthen) ────────────────────

describe("cursor non-advancement on error", () => {
  test("cursor stays near bootstrap value when all sessions fail", async () => {
    const stateDir = join(tmpdir(), "distill-cursor-noadvance-" + Math.random().toString(36).slice(2));
    const dbPath = join(tmpdir(), "distill-cursor-noadvance-" + Math.random().toString(36).slice(2) + ".db");

    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    // Session with timeUpdated in the last 7 days so it's in window
    const db = new Database(dbPath);
    db.run(`CREATE TABLE IF NOT EXISTS session (id TEXT, "time_updated" INTEGER)`);
    db.run(`CREATE TABLE IF NOT EXISTS message (id TEXT, session_id TEXT, data TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS message_part (id TEXT, message_id TEXT, data TEXT)`);
    db.run(`INSERT INTO session VALUES ('ses_fail1', ${now - 1000})`);
    db.close();

    globalThis.fetch = async () => new Response("Internal Server Error", { status: 500 });
    process.env.OLLAMA_DISTILL_STATE_DIR = stateDir;
    process.env.OPENCODE_DB_PATH = dbPath;

    try {
      const code = await main(["bun", "script.ts"], () => {}, () => {});
      expect(code).toBe(1);

      // Cursor should NOT have been advanced — it stays at bootstrap
      const cursorPath = join(stateDir, "cursor.json");
      if (existsSync(cursorPath)) {
        const cursor = JSON.parse(readFileSync(cursorPath, "utf8"));
        // Bootstrap value is Date.now() - SEVEN_DAYS_MS at time of run
        expect(cursor.last_run_timestamp).toBeGreaterThan(now - SEVEN_DAYS_MS - 5000);
        expect(cursor.last_run_timestamp).toBeLessThan(now - SEVEN_DAYS_MS + 5000);
      }
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.OLLAMA_DISTILL_STATE_DIR;
      delete process.env.OPENCODE_DB_PATH;
      if (existsSync(dbPath)) unlinkSync(dbPath);
    }
  });
});

// ─── FIX-T7: chunkSegments exact-boundary cases ───────────────────────────────

describe("chunkSegments exact-boundary edge cases", () => {
  // ROLE_PREFIX_OVERHEAD = 12 (see ollama-distill.ts)
  const ROLE_PREFIX_OVERHEAD = 12;

  function makeSegment(chars: number, role: "user" | "assistant" = "user"): MessageSegment {
    return {
      kind: "text",
      role,
      text: "x".repeat(chars),
      char_count: chars,
      time_created: Date.now(),
      message_id: "msg_" + Math.random().toString(36).slice(2),
    };
  }

  test("single segment whose size exactly equals targetChars fits in one chunk", () => {
    const targetChars = 1000;
    // segSize = char_count + ROLE_PREFIX_OVERHEAD; to get segSize === targetChars:
    const charCount = targetChars - ROLE_PREFIX_OVERHEAD;
    const seg = makeSegment(charCount);
    const chunks = chunkSegments([seg], targetChars);
    expect(chunks.length).toBe(1);
    expect(chunks[0].length).toBe(1);
  });

  test("single segment one byte over targetChars still fits alone (oversized goes in own chunk)", () => {
    const targetChars = 1000;
    const charCount = targetChars - ROLE_PREFIX_OVERHEAD + 1; // segSize = targetChars + 1
    const seg = makeSegment(charCount);
    const chunks = chunkSegments([seg], targetChars);
    // Single oversized segment always goes in its own chunk (extractTranscript already capped it)
    expect(chunks.length).toBe(1);
  });

  test("two segments whose combined size exactly equals targetChars fit in one chunk", () => {
    const targetChars = 1000;
    // Each segment: charCount such that 2 * (charCount + ROLE_PREFIX_OVERHEAD) === targetChars
    const charCount = Math.floor((targetChars - 2 * ROLE_PREFIX_OVERHEAD) / 2);
    const segs = [makeSegment(charCount), makeSegment(charCount)];
    // Combined segSize = 2 * (charCount + ROLE_PREFIX_OVERHEAD) <= targetChars
    const chunks = chunkSegments(segs, targetChars);
    expect(chunks.length).toBe(1);
  });

  test("second segment pushes combined size one byte over targetChars → splits into two chunks", () => {
    const targetChars = 1000;
    // First segment fills exactly half
    const charCount = Math.floor((targetChars - 2 * ROLE_PREFIX_OVERHEAD) / 2);
    const seg1 = makeSegment(charCount);
    // Second segment is one byte larger, pushing total over targetChars
    const seg2 = makeSegment(charCount + 1);
    const chunks = chunkSegments([seg1, seg2], targetChars);
    expect(chunks.length).toBe(2);
  });
});
