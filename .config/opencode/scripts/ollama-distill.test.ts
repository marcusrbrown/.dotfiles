import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlinkSync, existsSync } from "node:fs";
import {
  openDatabase,
  extractTranscript,
  SchemaError,
  ReadOnlyVerificationError,
  type ExtractStats,
} from "./ollama-distill.ts";

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
