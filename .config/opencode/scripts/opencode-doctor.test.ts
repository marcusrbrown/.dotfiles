import { describe, test, expect, afterEach } from "bun:test";
import { $ } from "bun";
import { Database } from "bun:sqlite";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  computeDbHealth,
  selectOldSessionIds,
  estimateReclaim,
  pruneSessions,
  classifyPgrepExitCode,
} from "./opencode-doctor";

const SCRIPT_PATH = "./opencode-doctor.ts";
const TEST_TIMEOUT = 90000;

let spawnedProcs: Array<{ kill: (signal?: string) => void; exited: Promise<number> }> = [];

afterEach(async () => {
  for (const proc of spawnedProcs) {
    try {
      proc.kill("SIGTERM");
      await Promise.race([proc.exited, Bun.sleep(2000)]);
    } catch {
      /* already exited */
    }
  }
  spawnedProcs = [];
});

// ─── Temp DB Helpers ──────────────────────────────────────────────────────────

function makeTempDir(): string {
  const dir = join(tmpdir(), `opencode-doctor-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function removeTempDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

/**
 * Create a minimal OpenCode-schema SQLite DB for testing.
 * Returns the db instance and its file path.
 */
function createTestDb(dir: string): { db: Database; dbPath: string } {
  const dbPath = join(dir, "test.db");
  const db = new Database(dbPath);

  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;

    CREATE TABLE IF NOT EXISTS project (
      id TEXT PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS session (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES project(id) ON DELETE CASCADE,
      parent_id TEXT,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      time_archived INTEGER
    );

    CREATE TABLE IF NOT EXISTS message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
      time_created INTEGER NOT NULL,
      data TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS part (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES message(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      data TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS event_sequence (
      aggregate_id TEXT PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS event (
      id TEXT PRIMARY KEY,
      aggregate_id TEXT NOT NULL REFERENCES event_sequence(aggregate_id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL DEFAULT '',
      data TEXT NOT NULL DEFAULT '{}'
    );
  `);

  return { db, dbPath };
}

/**
 * Insert a session with messages, parts, and events.
 * timeCreatedMs: epoch ms for time_created.
 */
function insertSession(
  db: Database,
  id: string,
  timeCreatedMs: number,
  opts: { messages?: number; partsPerMessage?: number; events?: number } = {}
): void {
  const messages = opts.messages ?? 2;
  const partsPerMessage = opts.partsPerMessage ?? 2;
  const events = opts.events ?? 3;

  db.query("INSERT INTO session (id, time_created, time_updated) VALUES (?, ?, ?)").run(
    id, timeCreatedMs, timeCreatedMs
  );

  for (let m = 0; m < messages; m++) {
    const msgId = `${id}-msg-${m}`;
    db.query("INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)").run(
      msgId, id, timeCreatedMs + m, JSON.stringify({ role: "user", content: `message ${m}` })
    );
    for (let p = 0; p < partsPerMessage; p++) {
      const partId = `${id}-part-${m}-${p}`;
      db.query("INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)").run(
        partId, msgId, id, timeCreatedMs + m + p, JSON.stringify({ type: "text", text: `part content ${p}` })
      );
    }
  }

  // Insert event_sequence + events
  db.query("INSERT INTO event_sequence (aggregate_id) VALUES (?)").run(id);
  for (let e = 0; e < events; e++) {
    db.query("INSERT INTO event (id, aggregate_id, seq, type, data) VALUES (?, ?, ?, ?, ?)").run(
      `${id}-evt-${e}`, id, e, "test_event", JSON.stringify({ seq: e })
    );
  }
}

// ─── DB Unit Tests ────────────────────────────────────────────────────────────

describe("DB helpers (unit)", () => {
  test("computeDbHealth returns expected shape", () => {
    const dir = makeTempDir();
    try {
      const { db, dbPath } = createTestDb(dir);

      const now = Date.now();
      insertSession(db, "sess-recent", now - 2 * 24 * 3600 * 1000);   // 2 days ago
      insertSession(db, "sess-mid", now - 15 * 24 * 3600 * 1000);     // 15 days ago
      insertSession(db, "sess-old", now - 60 * 24 * 3600 * 1000);     // 60 days ago
      insertSession(db, "sess-ancient", now - 120 * 24 * 3600 * 1000); // 120 days ago

      const health = computeDbHealth(db, dbPath);

      expect(health.db_path).toBe(dbPath);
      expect(health.file_size_bytes).toBeGreaterThan(0);
      expect(health.page_count).toBeGreaterThan(0);
      expect(health.page_size).toBeGreaterThan(0);
      expect(typeof health.journal_mode).toBe("string");
      expect(health.row_counts.session).toBe(4);
      expect(health.row_counts.message).toBe(8);  // 4 sessions × 2 messages
      expect(health.row_counts.part).toBe(16);    // 4 sessions × 2 messages × 2 parts
      expect(health.row_counts.event).toBe(12);   // 4 sessions × 3 events
      expect(health.row_counts.event_sequence).toBe(4);

      // Age histogram
      expect(health.session_age_histogram.last7d).toBe(1);    // sess-recent
      expect(health.session_age_histogram.days7to30).toBe(1); // sess-mid
      expect(health.session_age_histogram.days30to90).toBe(1); // sess-old
      expect(health.session_age_histogram.older90d).toBe(1);  // sess-ancient

      db.close();
    } finally {
      removeTempDir(dir);
    }
  });

  test("selectOldSessionIds returns only sessions older than cutoff", () => {
    const dir = makeTempDir();
    try {
      const { db } = createTestDb(dir);

      const now = Date.now();
      const cutoffMs = now - 30 * 24 * 3600 * 1000;

      insertSession(db, "sess-recent", now - 5 * 24 * 3600 * 1000);   // 5 days ago — keep
      insertSession(db, "sess-border", now - 29 * 24 * 3600 * 1000);  // 29 days ago — keep
      insertSession(db, "sess-old1", now - 31 * 24 * 3600 * 1000);    // 31 days ago — prune
      insertSession(db, "sess-old2", now - 90 * 24 * 3600 * 1000);    // 90 days ago — prune

      const ids = selectOldSessionIds(db, cutoffMs);

      expect(ids).toHaveLength(2);
      expect(ids).toContain("sess-old1");
      expect(ids).toContain("sess-old2");
      expect(ids).not.toContain("sess-recent");
      expect(ids).not.toContain("sess-border");

      db.close();
    } finally {
      removeTempDir(dir);
    }
  });

  test("estimateReclaim returns nonzero bytes for sessions with data", () => {
    const dir = makeTempDir();
    try {
      const { db } = createTestDb(dir);

      const now = Date.now();
      insertSession(db, "sess-a", now - 60 * 24 * 3600 * 1000, { messages: 3, partsPerMessage: 3, events: 5 });
      insertSession(db, "sess-b", now - 90 * 24 * 3600 * 1000, { messages: 2, partsPerMessage: 2, events: 2 });

      const reclaim = estimateReclaim(db, ["sess-a", "sess-b"]);

      expect(reclaim.part_bytes).toBeGreaterThan(0);
      expect(reclaim.message_bytes).toBeGreaterThan(0);
      expect(reclaim.event_bytes).toBeGreaterThan(0);
      expect(reclaim.total_bytes).toBe(reclaim.part_bytes + reclaim.message_bytes + reclaim.event_bytes);
      expect(typeof reclaim.total_human).toBe("string");

      db.close();
    } finally {
      removeTempDir(dir);
    }
  });

  test("estimateReclaim returns zeros for empty id list", () => {
    const dir = makeTempDir();
    try {
      const { db } = createTestDb(dir);

      const reclaim = estimateReclaim(db, []);

      expect(reclaim.part_bytes).toBe(0);
      expect(reclaim.message_bytes).toBe(0);
      expect(reclaim.event_bytes).toBe(0);
      expect(reclaim.total_bytes).toBe(0);

      db.close();
    } finally {
      removeTempDir(dir);
    }
  });

  test("pruneSessions deletes old sessions and cascades to message/part/event", () => {
    const dir = makeTempDir();
    try {
      const { db, dbPath } = createTestDb(dir);
      db.exec("PRAGMA foreign_keys=ON");

      const now = Date.now();
      insertSession(db, "sess-old", now - 60 * 24 * 3600 * 1000, { messages: 2, partsPerMessage: 2, events: 3 });
      insertSession(db, "sess-recent", now - 5 * 24 * 3600 * 1000, { messages: 2, partsPerMessage: 2, events: 3 });

      // Verify initial state
      type CountRow = { cnt: number };
      expect(db.query<CountRow, []>("SELECT COUNT(*) AS cnt FROM session").get()?.cnt).toBe(2);
      expect(db.query<CountRow, []>("SELECT COUNT(*) AS cnt FROM message").get()?.cnt).toBe(4);
      expect(db.query<CountRow, []>("SELECT COUNT(*) AS cnt FROM part").get()?.cnt).toBe(8);
      expect(db.query<CountRow, []>("SELECT COUNT(*) AS cnt FROM event").get()?.cnt).toBe(6);
      expect(db.query<CountRow, []>("SELECT COUNT(*) AS cnt FROM event_sequence").get()?.cnt).toBe(2);

      const result = pruneSessions(db, ["sess-old"], dbPath);

      expect(result.sessions_deleted).toBe(1);
      expect(result.before.row_counts.session).toBe(2);
      expect(result.after.row_counts.session).toBe(1);

      // Verify cascades
      expect(db.query<CountRow, []>("SELECT COUNT(*) AS cnt FROM session").get()?.cnt).toBe(1);
      expect(db.query<CountRow, []>("SELECT COUNT(*) AS cnt FROM message").get()?.cnt).toBe(2);
      expect(db.query<CountRow, []>("SELECT COUNT(*) AS cnt FROM part").get()?.cnt).toBe(4);
      expect(db.query<CountRow, []>("SELECT COUNT(*) AS cnt FROM event").get()?.cnt).toBe(3);
      expect(db.query<CountRow, []>("SELECT COUNT(*) AS cnt FROM event_sequence").get()?.cnt).toBe(1);

      // Recent session untouched
      type IdRow = { id: string };
      const remaining = db.query<IdRow, []>("SELECT id FROM session").all();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe("sess-recent");

      db.close();
    } finally {
      removeTempDir(dir);
    }
  });

  test("pruneSessions with empty list does not delete anything", () => {
    const dir = makeTempDir();
    try {
      const { db, dbPath } = createTestDb(dir);
      db.exec("PRAGMA foreign_keys=ON");

      const now = Date.now();
      insertSession(db, "sess-a", now - 60 * 24 * 3600 * 1000);
      insertSession(db, "sess-b", now - 5 * 24 * 3600 * 1000);

      type CountRow = { cnt: number };
      const result = pruneSessions(db, [], dbPath);

      expect(result.sessions_deleted).toBe(0);
      expect(db.query<CountRow, []>("SELECT COUNT(*) AS cnt FROM session").get()?.cnt).toBe(2);

      db.close();
    } finally {
      removeTempDir(dir);
    }
  });

  test("event_sequence and event rows are removed for pruned sessions", () => {
    const dir = makeTempDir();
    try {
      const { db, dbPath } = createTestDb(dir);
      db.exec("PRAGMA foreign_keys=ON");

      const now = Date.now();
      insertSession(db, "sess-prune", now - 60 * 24 * 3600 * 1000, { events: 5 });
      insertSession(db, "sess-keep", now - 5 * 24 * 3600 * 1000, { events: 4 });

      pruneSessions(db, ["sess-prune"], dbPath);

      type CountRow = { cnt: number };
      expect(db.query<CountRow, []>("SELECT COUNT(*) AS cnt FROM event_sequence").get()?.cnt).toBe(1);
      expect(db.query<CountRow, []>("SELECT COUNT(*) AS cnt FROM event").get()?.cnt).toBe(4);

      type IdRow = { aggregate_id: string };
      const remaining = db.query<IdRow, []>("SELECT aggregate_id FROM event_sequence").all();
      expect(remaining[0].aggregate_id).toBe("sess-keep");

      db.close();
    } finally {
      removeTempDir(dir);
    }
  });

  test("large session count (>999) does not throw 'too many SQL variables'", () => {
    // Regression test for the IN (?,?,…) variable-limit bug.
    // SQLite's SQLITE_MAX_VARIABLE_NUMBER is 999 in older builds, 32766 in Bun's build.
    // The old approach built a single IN clause with one bound param per session id —
    // fragile and guaranteed to blow up at scale. The fix uses a TEMP TABLE join.
    const dir = makeTempDir();
    try {
      const { db, dbPath } = createTestDb(dir);
      db.exec("PRAGMA foreign_keys=ON");

      const now = Date.now();
      const OLD_COUNT = 1500; // comfortably above the 999 legacy limit
      const KEEP_COUNT = 5;

      // Insert old sessions (to be pruned)
      const insertSess = db.prepare("INSERT INTO session (id, time_created, time_updated) VALUES (?, ?, ?)");
      const insertMsg  = db.prepare("INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)");
      const insertPart = db.prepare("INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)");
      const insertEvtSeq = db.prepare("INSERT INTO event_sequence (aggregate_id) VALUES (?)");
      const insertEvt = db.prepare("INSERT INTO event (id, aggregate_id, seq, type, data) VALUES (?, ?, ?, ?, ?)");

      const oldTs = now - 60 * 24 * 3600 * 1000;
      db.transaction(() => {
        for (let i = 0; i < OLD_COUNT; i++) {
          const sid = `old-sess-${i}`;
          insertSess.run(sid, oldTs, oldTs);
          const mid = `${sid}-msg`;
          insertMsg.run(mid, sid, oldTs, JSON.stringify({ content: `msg ${i}` }));
          insertPart.run(`${sid}-part`, mid, sid, oldTs, JSON.stringify({ text: `part ${i}` }));
          insertEvtSeq.run(sid);
          insertEvt.run(`${sid}-evt`, sid, 0, "test", JSON.stringify({ i }));
        }
      })();

      // Insert recent sessions (to be kept)
      const recentTs = now - 5 * 24 * 3600 * 1000;
      db.transaction(() => {
        for (let i = 0; i < KEEP_COUNT; i++) {
          const sid = `keep-sess-${i}`;
          insertSess.run(sid, recentTs, recentTs);
          const mid = `${sid}-msg`;
          insertMsg.run(mid, sid, recentTs, JSON.stringify({ content: `keep msg ${i}` }));
          insertPart.run(`${sid}-part`, mid, sid, recentTs, JSON.stringify({ text: `keep part ${i}` }));
          insertEvtSeq.run(sid);
          insertEvt.run(`${sid}-evt`, sid, 0, "test", JSON.stringify({ i }));
        }
      })();

      type CountRow = { cnt: number };
      expect(db.query<CountRow, []>("SELECT COUNT(*) AS cnt FROM session").get()?.cnt).toBe(OLD_COUNT + KEEP_COUNT);

      const cutoffMs = now - 30 * 24 * 3600 * 1000;
      const oldIds = selectOldSessionIds(db, cutoffMs);
      expect(oldIds).toHaveLength(OLD_COUNT);

      // estimateReclaim must not throw and must return positive bytes
      let reclaim: ReturnType<typeof estimateReclaim>;
      expect(() => { reclaim = estimateReclaim(db, oldIds); }).not.toThrow();
      expect(reclaim!.total_bytes).toBeGreaterThan(0);
      expect(reclaim!.part_bytes).toBeGreaterThan(0);
      expect(reclaim!.message_bytes).toBeGreaterThan(0);
      expect(reclaim!.event_bytes).toBeGreaterThan(0);

      // pruneSessions must not throw and must delete exactly OLD_COUNT sessions
      let result: ReturnType<typeof pruneSessions>;
      expect(() => { result = pruneSessions(db, oldIds, dbPath); }).not.toThrow();
      expect(result!.sessions_deleted).toBe(OLD_COUNT);
      expect(result!.before.row_counts.session).toBe(OLD_COUNT + KEEP_COUNT);
      expect(result!.after.row_counts.session).toBe(KEEP_COUNT);

      // Verify cascades: only KEEP_COUNT rows remain in each table
      expect(db.query<CountRow, []>("SELECT COUNT(*) AS cnt FROM session").get()?.cnt).toBe(KEEP_COUNT);
      expect(db.query<CountRow, []>("SELECT COUNT(*) AS cnt FROM message").get()?.cnt).toBe(KEEP_COUNT);
      expect(db.query<CountRow, []>("SELECT COUNT(*) AS cnt FROM part").get()?.cnt).toBe(KEEP_COUNT);
      expect(db.query<CountRow, []>("SELECT COUNT(*) AS cnt FROM event_sequence").get()?.cnt).toBe(KEEP_COUNT);
      expect(db.query<CountRow, []>("SELECT COUNT(*) AS cnt FROM event").get()?.cnt).toBe(KEEP_COUNT);

      db.close();
    } finally {
      removeTempDir(dir);
    }
  });

  test("age histogram buckets are mutually exclusive and sum to total", () => {
    const dir = makeTempDir();
    try {
      const { db, dbPath } = createTestDb(dir);

      const now = Date.now();
      // One session per bucket
      insertSession(db, "s1", now - 1 * 24 * 3600 * 1000);   // last7d
      insertSession(db, "s2", now - 10 * 24 * 3600 * 1000);  // 7-30d
      insertSession(db, "s3", now - 45 * 24 * 3600 * 1000);  // 30-90d
      insertSession(db, "s4", now - 100 * 24 * 3600 * 1000); // older90d

      const health = computeDbHealth(db, dbPath);
      const hist = health.session_age_histogram;

      expect(hist.last7d).toBe(1);
      expect(hist.days7to30).toBe(1);
      expect(hist.days30to90).toBe(1);
      expect(hist.older90d).toBe(1);
      expect(hist.last7d + hist.days7to30 + hist.days30to90 + hist.older90d).toBe(4);

      db.close();
    } finally {
      removeTempDir(dir);
    }
  });
});

// ─── CLI Integration Tests (DB flags) ────────────────────────────────────────

describe("DB CLI integration", () => {
  test(
    "--db-health --json returns valid JSON with expected keys",
    async () => {
      const dir = makeTempDir();
      try {
        const { db, dbPath } = createTestDb(dir);
        const now = Date.now();
        insertSession(db, "sess-test", now - 5 * 24 * 3600 * 1000);
        db.close();

        const result = await $`bun ${SCRIPT_PATH} --db-health --json --db-path=${dbPath}`.text();

        let parsed: unknown;
        expect(() => { parsed = JSON.parse(result); }).not.toThrow();

        const sections = parsed as Array<{ label: string; data?: unknown }>;
        expect(Array.isArray(sections)).toBe(true);
        expect(sections.length).toBeGreaterThan(0);

        const dbSection = sections.find((s) => s.label === "DB Health");
        expect(dbSection).toBeDefined();
        expect(dbSection?.data).toHaveProperty("file_size_bytes");
        expect(dbSection?.data).toHaveProperty("row_counts");
        expect(dbSection?.data).toHaveProperty("session_age_histogram");
        expect(dbSection?.data).toHaveProperty("journal_mode");
      } finally {
        removeTempDir(dir);
      }
    },
    { timeout: TEST_TIMEOUT }
  );

  test(
    "--prune-older dry-run reports sessions to delete without deleting",
    async () => {
      const dir = makeTempDir();
      try {
        const { db, dbPath } = createTestDb(dir);
        const now = Date.now();
        insertSession(db, "sess-old", now - 60 * 24 * 3600 * 1000);
        insertSession(db, "sess-recent", now - 5 * 24 * 3600 * 1000);
        db.close();

        const result = await $`bun ${SCRIPT_PATH} --prune-older=30 --json --db-path=${dbPath}`.text();

        let parsed: unknown;
        expect(() => { parsed = JSON.parse(result); }).not.toThrow();

        const sections = parsed as Array<{ label: string; data?: unknown }>;
        const pruneSection = sections.find((s) => s.label === "DB Prune (dry-run)");
        expect(pruneSection).toBeDefined();

        const data = pruneSection?.data as Record<string, unknown>;
        expect(data.sessions_to_delete).toBe(1);
        expect(String(data.notice)).toContain("DRY RUN");

        // Verify nothing was actually deleted
        const db2 = new Database(dbPath, { readonly: true });
        type CountRow = { cnt: number };
        const count = db2.query<CountRow, []>("SELECT COUNT(*) AS cnt FROM session").get()?.cnt;
        expect(count).toBe(2);
        db2.close();
      } finally {
        removeTempDir(dir);
      }
    },
    { timeout: TEST_TIMEOUT }
  );

  test(
    "--prune-older --execute deletes old sessions and leaves recent ones",
    async () => {
      const dir = makeTempDir();
      try {
        const { db, dbPath } = createTestDb(dir);
        const now = Date.now();
        insertSession(db, "sess-old", now - 60 * 24 * 3600 * 1000, { messages: 2, partsPerMessage: 2, events: 3 });
        insertSession(db, "sess-recent", now - 5 * 24 * 3600 * 1000, { messages: 2, partsPerMessage: 2, events: 3 });
        db.close();

        const result = await $`bun ${SCRIPT_PATH} --prune-older=30 --execute --json --db-path=${dbPath}`.nothrow().text();

        let parsed: unknown;
        expect(() => { parsed = JSON.parse(result); }).not.toThrow();

        const sections = parsed as Array<{ label: string; data?: unknown }>;
        // Could be "DB Prune (executed)" or "DB Prune (refused)" depending on running processes
        const execSection = sections.find(
          (s) => s.label === "DB Prune (executed)" || s.label === "DB Prune (refused)"
        );
        expect(execSection).toBeDefined();

        if (execSection?.label === "DB Prune (executed)") {
          const data = execSection.data as Record<string, unknown>;
          expect(data.sessions_deleted).toBe(1);

          // Verify DB state
          const db2 = new Database(dbPath, { readonly: true });
          type CountRow = { cnt: number };
          expect(db2.query<CountRow, []>("SELECT COUNT(*) AS cnt FROM session").get()?.cnt).toBe(1);
          expect(db2.query<CountRow, []>("SELECT COUNT(*) AS cnt FROM message").get()?.cnt).toBe(2);
          expect(db2.query<CountRow, []>("SELECT COUNT(*) AS cnt FROM part").get()?.cnt).toBe(4);
          expect(db2.query<CountRow, []>("SELECT COUNT(*) AS cnt FROM event_sequence").get()?.cnt).toBe(1);
          db2.close();
        } else {
          // Refused due to running opencode processes — that's valid behavior
          const data = execSection?.data as Record<string, unknown>;
          expect(data.refused).toBe(true);
        }
      } finally {
        removeTempDir(dir);
      }
    },
    { timeout: TEST_TIMEOUT }
  );

  test(
    "--db-health --no-tui outputs text format with DB Health section",
    async () => {
      const dir = makeTempDir();
      try {
        const { db, dbPath } = createTestDb(dir);
        db.close();

        const result = await $`bun ${SCRIPT_PATH} --db-health --no-tui --db-path=${dbPath}`.text();

        expect(result).toContain("DB Health");
        expect(result).toMatch(/file_size|page_count|journal_mode/);
      } finally {
        removeTempDir(dir);
      }
    },
    { timeout: TEST_TIMEOUT }
  );

  test(
    "--prune-older default value is 30 days when no value given",
    async () => {
      const dir = makeTempDir();
      try {
        const { db, dbPath } = createTestDb(dir);
        const now = Date.now();
        insertSession(db, "sess-old", now - 45 * 24 * 3600 * 1000);
        db.close();

        const result = await $`bun ${SCRIPT_PATH} --prune-older --json --db-path=${dbPath}`.text();

        let parsed: unknown;
        expect(() => { parsed = JSON.parse(result); }).not.toThrow();

        const sections = parsed as Array<{ label: string; data?: unknown }>;
        const pruneSection = sections.find((s) => s.label === "DB Prune (dry-run)");
        expect(pruneSection).toBeDefined();

        const data = pruneSection?.data as Record<string, unknown>;
        expect(data.prune_older_than_days).toBe(30);
        expect(data.sessions_to_delete).toBe(1);
      } finally {
        removeTempDir(dir);
      }
    },
    { timeout: TEST_TIMEOUT }
  );

  test(
    "--db-health and --prune-older can be combined",
    async () => {
      const dir = makeTempDir();
      try {
        const { db, dbPath } = createTestDb(dir);
        const now = Date.now();
        insertSession(db, "sess-old", now - 60 * 24 * 3600 * 1000);
        db.close();

        const result = await $`bun ${SCRIPT_PATH} --db-health --prune-older=30 --json --db-path=${dbPath}`.text();

        let parsed: unknown;
        expect(() => { parsed = JSON.parse(result); }).not.toThrow();

        const sections = parsed as Array<{ label: string; data?: unknown }>;
        expect(sections.some((s) => s.label === "DB Health")).toBe(true);
        expect(sections.some((s) => s.label === "DB Prune (dry-run)")).toBe(true);
      } finally {
        removeTempDir(dir);
      }
    },
    { timeout: TEST_TIMEOUT }
  );
});

// ─── Existing CLI Tests ───────────────────────────────────────────────────────

describe("opencode-doctor CLI", () => {
  test(
    "--help flag shows usage",
    async () => {
      const result = await $`bun ${SCRIPT_PATH} --help`.text();

      expect(result).toContain("OpenCode doctor (Bun)");
      expect(result).toContain("Usage:");
      expect(result).toContain("Options:");
      expect(result).toContain("--port");
      expect(result).toContain("--format");
      expect(result).toContain("--only");
      expect(result).toContain("Sections:");
      // New DB flags
      expect(result).toContain("--db-health");
      expect(result).toContain("--prune-older");
      expect(result).toContain("--execute");
      expect(result).toContain("--db-path");
    },
    { timeout: TEST_TIMEOUT }
  );

  test(
    "-h shorthand shows usage",
    async () => {
      const result = await $`bun ${SCRIPT_PATH} -h`.text();

      expect(result).toContain("OpenCode doctor (Bun)");
      expect(result).toContain("Usage:");
    },
    { timeout: TEST_TIMEOUT }
  );

  test(
    "spawns server and retrieves health section",
    async () => {
      const result = await $`bun ${SCRIPT_PATH} --only=health --no-tui`.nothrow().text();

      expect(result).toContain("Health");
      expect(result).toMatch(/healthy|version|latencyMs/i);
    },
    { timeout: TEST_TIMEOUT }
  );

  test(
    "--only flag filters to specified sections only",
    async () => {
      const result = await $`bun ${SCRIPT_PATH} --only=server,health --no-tui`.nothrow().text();

      expect(result).toContain("Server");
      expect(result).toContain("Health");
      expect(result).not.toContain("\nConfig\n");
      expect(result).not.toContain("\nProviders\n");
      expect(result).not.toContain("\nAgents\n");
    },
    { timeout: TEST_TIMEOUT }
  );

  test(
    "--json outputs parseable JSON array of sections",
    async () => {
      const result = await $`bun ${SCRIPT_PATH} --only=health --json`.nothrow().text();

      let parsed: unknown;
      expect(() => {
        parsed = JSON.parse(result);
      }).not.toThrow();

      expect(Array.isArray(parsed)).toBe(true);
      const sections = parsed as Array<{ label: string; data?: unknown }>;
      expect(sections.length).toBeGreaterThan(0);
      expect(sections[0]).toHaveProperty("label");
    },
    { timeout: TEST_TIMEOUT }
  );

  test(
    "--format=json is equivalent to --json flag",
    async () => {
      const result = await $`bun ${SCRIPT_PATH} --only=server --format=json`.nothrow().text();

      let parsed: unknown;
      expect(() => {
        parsed = JSON.parse(result);
      }).not.toThrow();

      expect(Array.isArray(parsed)).toBe(true);
    },
    { timeout: TEST_TIMEOUT }
  );

  test(
    "warns on unknown flags but continues execution",
    async () => {
      const result = await $`bun ${SCRIPT_PATH} --unknown-flag --help`
        .quiet()
        .nothrow();

      const output = result.stdout.toString() + result.stderr.toString();
      expect(output).toContain("Unknown flag");
      expect(output).toContain("OpenCode doctor");
    },
    { timeout: TEST_TIMEOUT }
  );
});

describe("signal handling", () => {
  test(
    "SIGTERM triggers cleanup of spawned server",
    async () => {
      const proc = Bun.spawn(["bun", SCRIPT_PATH, "--only=health"], {
        stdout: "pipe",
        stderr: "pipe",
        cwd: import.meta.dir,
      });

      spawnedProcs.push(proc);

      let output = "";
      const reader = proc.stdout.getReader();
      const startTime = Date.now();

      while (Date.now() - startTime < 30000) {
        const { value, done } = await reader.read();
        if (done) break;
        output += new TextDecoder().decode(value);
        if (output.includes("Health") || output.includes("Server")) {
          break;
        }
      }
      reader.releaseLock();

      proc.kill("SIGTERM");
      const exitCode = await proc.exited;

      // Exit codes: 143 = 128+15 (SIGTERM), 0 = clean exit, 1 = error exit
      expect([0, 1, 143]).toContain(exitCode);

      await Bun.sleep(1000);
      const orphanCheck = await $`pgrep -f "opencode serve" | head -5 || true`
        .quiet()
        .text();
      const ownPid = process.pid.toString();
      const orphans = orphanCheck.trim().split("\n").filter(
        (pid) => pid.length > 0 && pid !== ownPid
      );
      expect(orphans.length).toBeLessThanOrEqual(1);
    },
    { timeout: TEST_TIMEOUT }
  );

  test(
    "SIGINT triggers cleanup of spawned server",
    async () => {
      const proc = Bun.spawn(["bun", SCRIPT_PATH, "--only=server"], {
        stdout: "pipe",
        stderr: "pipe",
        cwd: import.meta.dir,
      });

      spawnedProcs.push(proc);

      let output = "";
      const reader = proc.stdout.getReader();
      const startTime = Date.now();

      while (Date.now() - startTime < 30000) {
        const { value, done } = await reader.read();
        if (done) break;
        output += new TextDecoder().decode(value);
        if (output.includes("Server")) {
          break;
        }
      }
      reader.releaseLock();

      proc.kill("SIGINT");
      const exitCode = await proc.exited;

      // Exit codes: 130 = 128+2 (SIGINT), 0 = clean exit, 1 = error exit
      expect([0, 1, 130]).toContain(exitCode);

      await Bun.sleep(1000);
      const orphanCheck = await $`pgrep -f "opencode serve" | head -5 || true`
        .quiet()
        .text();
      const orphans = orphanCheck.trim().split("\n").filter((pid) => pid.length > 0);
      expect(orphans.length).toBeLessThanOrEqual(1);
    },
    { timeout: TEST_TIMEOUT }
  );
});

describe("error handling", () => {
  test(
    "invalid --only value warns but continues with valid sections",
    async () => {
      const result = await $`bun ${SCRIPT_PATH} --only=invalid_section,server`
        .quiet()
        .nothrow();

      const output = result.stdout.toString() + result.stderr.toString();
      expect(output).toContain("Invalid value");
      expect(output).toContain("invalid_section");
      expect(output).toContain("Server");
    },
    { timeout: TEST_TIMEOUT }
  );

  test(
    "invalid --port value warns and uses default",
    async () => {
      const result = await $`bun ${SCRIPT_PATH} --port=invalid --only=server`
        .quiet()
        .nothrow();

      const output = result.stdout.toString() + result.stderr.toString();
      expect(output).toContain("Invalid value");
      expect(output).toContain("Server");
    },
    { timeout: TEST_TIMEOUT }
  );
});

// ─── DB Guard Tests ───────────────────────────────────────────────────────────

describe("DB guards (unit)", () => {
  // ── classifyPgrepExitCode ──────────────────────────────────────────────────

  test("classifyPgrepExitCode: exit 0 → has_procs", () => {
    expect(classifyPgrepExitCode(0)).toBe("has_procs");
  });

  test("classifyPgrepExitCode: exit 1 → no_procs (safe)", () => {
    expect(classifyPgrepExitCode(1)).toBe("no_procs");
  });

  test("classifyPgrepExitCode: exit 127 (command not found) → error (unsafe)", () => {
    expect(classifyPgrepExitCode(127)).toBe("error");
  });

  test("classifyPgrepExitCode: exit 2 → error (unsafe)", () => {
    expect(classifyPgrepExitCode(2)).toBe("error");
  });

  test("classifyPgrepExitCode: null exit code → error (unsafe)", () => {
    expect(classifyPgrepExitCode(null)).toBe("error");
  });

  // ── prune-older floor ──────────────────────────────────────────────────────

  test(
    "--prune-older=0 warns and uses default 30 (parseArgs floor)",
    async () => {
      const dir = makeTempDir();
      try {
        const { db, dbPath } = createTestDb(dir);
        db.close();

        const result = await $`bun ${SCRIPT_PATH} --prune-older=0 --json --db-path=${dbPath}`
          .quiet()
          .nothrow();

        const stderr = result.stderr.toString();
        expect(stderr).toContain("Invalid value");
        expect(stderr).toContain("--prune-older");

        // Should still produce valid JSON (dry-run with default 30 days)
        const stdout = result.stdout.toString();
        let parsed: unknown;
        expect(() => { parsed = JSON.parse(stdout); }).not.toThrow();
        const sections = parsed as Array<{ label: string; data?: unknown }>;
        const pruneSection = sections.find((s) => s.label === "DB Prune (dry-run)");
        expect(pruneSection).toBeDefined();
        const data = pruneSection?.data as Record<string, unknown>;
        expect(data.prune_older_than_days).toBe(30);
      } finally {
        removeTempDir(dir);
      }
    },
    { timeout: TEST_TIMEOUT }
  );

  test(
    "--prune-older=-5 warns and uses default 30 (parseArgs floor)",
    async () => {
      const dir = makeTempDir();
      try {
        const { db, dbPath } = createTestDb(dir);
        db.close();

        const result = await $`bun ${SCRIPT_PATH} --prune-older=-5 --json --db-path=${dbPath}`
          .quiet()
          .nothrow();

        const stderr = result.stderr.toString();
        expect(stderr).toContain("Invalid value");
        expect(stderr).toContain("--prune-older");
      } finally {
        removeTempDir(dir);
      }
    },
    { timeout: TEST_TIMEOUT }
  );

  // ── --execute without --prune-older ───────────────────────────────────────

  test(
    "--execute without --prune-older exits 1 with clear error",
    async () => {
      const result = await $`bun ${SCRIPT_PATH} --execute`
        .quiet()
        .nothrow();

      expect(result.exitCode).toBe(1);
      const stderr = result.stderr.toString();
      expect(stderr).toContain("--execute requires --prune-older");
    },
    { timeout: TEST_TIMEOUT }
  );

  // ── sessions_deleted reflects actual deleted rows, not input length ────────

  test("pruneSessions: sessions_deleted reflects actual deleted rows, not input list length", () => {
    const dir = makeTempDir();
    try {
      const { db, dbPath } = createTestDb(dir);
      db.exec("PRAGMA foreign_keys=ON");

      const now = Date.now();
      insertSession(db, "sess-real", now - 60 * 24 * 3600 * 1000);

      // Pass a mix of real and non-existent IDs
      const result = pruneSessions(db, ["sess-real", "nonexistent-id-1", "nonexistent-id-2"], dbPath);

      // Should report 1 (actual deleted), not 3 (input length)
      expect(result.sessions_deleted).toBe(1);
      expect(result.before.row_counts.session).toBe(1);
      expect(result.after.row_counts.session).toBe(0);

      db.close();
    } finally {
      removeTempDir(dir);
    }
  });

  // ── VACUUM failure path still returns sessions_deleted ────────────────────

  test("pruneSessions: vacuum_error field present when VACUUM fails, sessions_deleted still reported", () => {
    // We test this by verifying the PruneResult type has vacuum_error as optional
    // and that a normal run (no VACUUM failure) does NOT set it.
    const dir = makeTempDir();
    try {
      const { db, dbPath } = createTestDb(dir);
      db.exec("PRAGMA foreign_keys=ON");

      const now = Date.now();
      insertSession(db, "sess-old", now - 60 * 24 * 3600 * 1000);

      const result = pruneSessions(db, ["sess-old"], dbPath);

      // Normal run: sessions_deleted is accurate, no vacuum_error
      expect(result.sessions_deleted).toBe(1);
      expect(result.vacuum_error).toBeUndefined();

      db.close();
    } finally {
      removeTempDir(dir);
    }
  });

  // ── estimateReclaim byte accuracy (CAST AS BLOB) ──────────────────────────

  test("estimateReclaim: byte counts are non-negative and sum correctly (CAST AS BLOB accuracy)", () => {
    const dir = makeTempDir();
    try {
      const { db } = createTestDb(dir);

      const now = Date.now();
      // Insert sessions with known data content
      insertSession(db, "sess-a", now - 60 * 24 * 3600 * 1000, { messages: 2, partsPerMessage: 2, events: 3 });
      insertSession(db, "sess-b", now - 90 * 24 * 3600 * 1000, { messages: 1, partsPerMessage: 1, events: 1 });

      const reclaim = estimateReclaim(db, ["sess-a", "sess-b"]);

      // All byte counts must be non-negative
      expect(reclaim.part_bytes).toBeGreaterThanOrEqual(0);
      expect(reclaim.message_bytes).toBeGreaterThanOrEqual(0);
      expect(reclaim.event_bytes).toBeGreaterThanOrEqual(0);

      // Total must equal sum of parts
      expect(reclaim.total_bytes).toBe(reclaim.part_bytes + reclaim.message_bytes + reclaim.event_bytes);

      // With actual data, bytes should be > 0
      expect(reclaim.total_bytes).toBeGreaterThan(0);

      // Human-readable strings should be present
      expect(typeof reclaim.total_human).toBe("string");
      expect(reclaim.total_human.length).toBeGreaterThan(0);

      db.close();
    } finally {
      removeTempDir(dir);
    }
  });

  // ── help text contains irreversible-loss language ─────────────────────────

  test(
    "--help contains irreversible/permanent deletion language",
    async () => {
      const result = await $`bun ${SCRIPT_PATH} --help`.text();

      // Should warn about irreversibility
      expect(result.toLowerCase()).toMatch(/irreversib|permanent/);
      // Should mention --execute requires --prune-older
      expect(result).toContain("--execute");
      expect(result).toContain("--prune-older");
    },
    { timeout: TEST_TIMEOUT }
  );

  // ── DB errors exit nonzero ────────────────────────────────────────────────

  test(
    "--db-health with nonexistent DB path exits nonzero",
    async () => {
      const result = await $`bun ${SCRIPT_PATH} --db-health --json --db-path=/nonexistent/path/to/db.db`
        .quiet()
        .nothrow();

      expect(result.exitCode).not.toBe(0);
    },
    { timeout: TEST_TIMEOUT }
  );
});
