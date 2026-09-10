import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseAssistantTurn,
  fetchScoredTurns,
  fetchTransformDecisions,
  selectCandidateSessions,
  detectPlateaus,
  buildPlateauRun,
  scanSession,
  parseSinceDuration,
  parseArgs,
  DEFAULT_MIN_RUN,
  DEFAULT_MAX_REUSE,
  DEFAULT_FLAT_ABS_TOLERANCE,
  DEFAULT_FLAT_PCT_TOLERANCE,
  MIN_TOTAL_TOKENS,
  type AssistantTurn,
  type TransformDecision,
} from "./cache-plateau";

// ─── Temp DB Helpers ──────────────────────────────────────────────────────────

function makeTempDir(): string {
  const dir = join(tmpdir(), `cache-plateau-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

function createOpencodeTestDb(dir: string): { db: Database; dbPath: string } {
  const dbPath = join(dir, "opencode.db");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      title TEXT,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      data TEXT NOT NULL DEFAULT '{}'
    );
  `);
  return { db, dbPath };
}

function createContextTestDb(dir: string): { db: Database; dbPath: string } {
  const dbPath = join(dir, "context.db");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE transform_decisions (
      session_id TEXT NOT NULL,
      harness TEXT NOT NULL DEFAULT 'opencode',
      message_id TEXT,
      ts_ms INTEGER NOT NULL,
      decision TEXT NOT NULL,
      materialized INTEGER NOT NULL DEFAULT 0,
      materialize_reason TEXT,
      emergency INTEGER NOT NULL DEFAULT 0,
      dropped_tokens INTEGER NOT NULL DEFAULT 0,
      dropped_count INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0
    );
  `);
  return { db, dbPath };
}

function insertSession(db: Database, id: string, title: string, timeCreated: number, timeUpdated: number): void {
  db.query("INSERT INTO session (id, title, time_created, time_updated) VALUES (?, ?, ?, ?)").run(
    id,
    title,
    timeCreated,
    timeUpdated,
  );
}

type TurnSpec = {
  id: string;
  timeCreated: number;
  input: number;
  read: number;
  write?: number;
  modelID?: string;
  providerID?: string;
  error?: unknown;
};

function assistantMessageData(spec: TurnSpec): string {
  return JSON.stringify({
    role: "assistant",
    modelID: spec.modelID ?? "gpt-6-astra",
    providerID: spec.providerID ?? "openai",
    tokens: {
      input: spec.input,
      output: 100,
      reasoning: 0,
      cache: { read: spec.read, write: spec.write ?? 0 },
    },
    error: spec.error ?? null,
  });
}

function insertTurns(db: Database, sessionId: string, specs: TurnSpec[]): void {
  for (const spec of specs) {
    db.query("INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)").run(
      spec.id,
      sessionId,
      spec.timeCreated,
      assistantMessageData(spec),
    );
  }
}

function insertUserMessage(db: Database, sessionId: string, id: string, timeCreated: number): void {
  db.query("INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)").run(
    id,
    sessionId,
    timeCreated,
    JSON.stringify({ role: "user" }),
  );
}

function insertMaterialization(
  db: Database,
  sessionId: string,
  tsMs: number,
  materialized: boolean,
  reason: string | null,
): void {
  db.query(
    "INSERT INTO transform_decisions (session_id, ts_ms, decision, materialized, materialize_reason) VALUES (?, ?, ?, ?, ?)",
  ).run(sessionId, tsMs, "materialize", materialized ? 1 : 0, reason);
}

const BASE_MS = 1_788_000_000_000;
const MIN_TURN = 5_000; // per-turn spacing in ms
const DETECTION_OPTIONS = {
  minRun: DEFAULT_MIN_RUN,
  maxReuse: DEFAULT_MAX_REUSE,
  flatAbsTolerance: DEFAULT_FLAT_ABS_TOLERANCE,
  flatPctTolerance: DEFAULT_FLAT_PCT_TOLERANCE,
};

// ─── parseAssistantTurn ───────────────────────────────────────────────────────

describe("parseAssistantTurn", () => {
  test("computes reuse as R / (N + R + W), not R / N — accounting must diverge visibly under the wrong formula", () => {
    // N=1000, R=9000, W=0 → total=10000, reuse=0.9 under correct formula.
    // Under the wrong R/N formula this would be 9.0 (nonsensical, >1).
    const row = { id: "m1", time_created: BASE_MS, data: assistantMessageData({ id: "m1", timeCreated: BASE_MS, input: 1000, read: 9000 }) };
    const turn = parseAssistantTurn(row);
    expect(turn).not.toBeNull();
    expect(turn!.total).toBe(10000);
    expect(turn!.reuse).toBeCloseTo(0.9, 10);
    expect(turn!.reuse).not.toBeCloseTo(9.0, 1);
  });

  test("includes cache.write in total", () => {
    const row = {
      id: "m1",
      time_created: BASE_MS,
      data: assistantMessageData({ id: "m1", timeCreated: BASE_MS, input: 200, read: 800, write: 5000 }),
    };
    const turn = parseAssistantTurn(row);
    expect(turn!.total).toBe(6000);
    expect(turn!.cacheWrite).toBe(5000);
  });

  test("excludes turns under MIN_TOTAL_TOKENS", () => {
    const row = {
      id: "m1",
      time_created: BASE_MS,
      data: assistantMessageData({ id: "m1", timeCreated: BASE_MS, input: 100, read: 100 }),
    };
    expect(row.data.length).toBeGreaterThan(0);
    const turn = parseAssistantTurn(row);
    expect(turn).toBeNull();
  });

  test("total exactly at MIN_TOTAL_TOKENS is included", () => {
    const row = {
      id: "m1",
      time_created: BASE_MS,
      data: assistantMessageData({ id: "m1", timeCreated: BASE_MS, input: MIN_TOTAL_TOKENS, read: 0 }),
    };
    const turn = parseAssistantTurn(row);
    expect(turn).not.toBeNull();
  });

  test("excludes turns with a non-null error", () => {
    const row = {
      id: "m1",
      time_created: BASE_MS,
      data: assistantMessageData({ id: "m1", timeCreated: BASE_MS, input: 5000, read: 5000, error: { name: "boom" } }),
    };
    const turn = parseAssistantTurn(row);
    expect(turn).toBeNull();
  });

  test("skips malformed JSON", () => {
    const row = { id: "m1", time_created: BASE_MS, data: "{not json" };
    expect(parseAssistantTurn(row)).toBeNull();
  });

  test("skips non-assistant role", () => {
    const row = { id: "m1", time_created: BASE_MS, data: JSON.stringify({ role: "user" }) };
    expect(parseAssistantTurn(row)).toBeNull();
  });

  test("skips missing tokens shape", () => {
    const row = { id: "m1", time_created: BASE_MS, data: JSON.stringify({ role: "assistant" }) };
    expect(parseAssistantTurn(row)).toBeNull();
  });
});

// ─── detectPlateaus ───────────────────────────────────────────────────────────

describe("detectPlateaus", () => {
  function turn(overrides: Partial<AssistantTurn> & { input: number; read: number; write?: number }): AssistantTurn {
    const total = overrides.input + overrides.read + (overrides.write ?? 0);
    return {
      messageId: overrides.messageId ?? "m",
      timeCreatedMs: overrides.timeCreatedMs ?? BASE_MS,
      modelID: overrides.modelID ?? "gpt-6-astra",
      providerID: overrides.providerID ?? "openai",
      input: overrides.input,
      cacheRead: overrides.read,
      cacheWrite: overrides.write ?? 0,
      total,
      reuse: overrides.read / total,
    };
  }

  test("a clean session with healthy growing reuse produces no detection", () => {
    // Reuse climbs steadily above maxReuse — never qualifies as low-reuse.
    const turns: AssistantTurn[] = [];
    let read = 5000;
    for (let i = 0; i < 10; i++) {
      const input = 500;
      read += 4000; // reuse grows each turn, well above 0.25 quickly
      turns.push(turn({ messageId: `m${i}`, timeCreatedMs: BASE_MS + i * MIN_TURN, input, read }));
    }
    const results = detectPlateaus(turns, [], DETECTION_OPTIONS);
    expect(results).toHaveLength(0);
  });

  test("a true plateau: flat R, growing total, no materialization inside the run — detected", () => {
    const turns: AssistantTurn[] = [];
    const pinnedR = 21248;
    for (let i = 0; i < 18; i++) {
      // N dominates total so reuse stays low (mirrors real collapse: R small vs huge uncached input).
      const input = 200_000 + i * 2_000; // total grows each turn
      turns.push(turn({ messageId: `m${i}`, timeCreatedMs: BASE_MS + i * MIN_TURN, input, read: pinnedR }));
    }
    const results = detectPlateaus(turns, [], DETECTION_OPTIONS);
    expect(results).toHaveLength(1);
    expect(results[0].startIdx).toBe(0);
    expect(results[0].endIdx).toBe(17);
  });

  test("a plateau immediately following materialized=1 INSIDE the run is suppressed by rule 4", () => {
    const turns: AssistantTurn[] = [];
    const pinnedR = 21248;
    for (let i = 0; i < 10; i++) {
      const input = 200_000 + i * 2_000;
      turns.push(turn({ messageId: `m${i}`, timeCreatedMs: BASE_MS + i * MIN_TURN, input, read: pinnedR }));
    }
    // A materialization lands squarely inside the run (after turn 0, before turn 9),
    // splitting it into two sub-runs of length 5 each — neither is disqualified,
    // but the split boundary itself must not be crossed by a single reported run.
    const midTs = turns[5].timeCreatedMs - 1;
    const decisions: TransformDecision[] = [{ tsMs: midTs, materialized: true, materializeReason: "system_hash" }];
    const results = detectPlateaus(turns, decisions, DETECTION_OPTIONS);
    // No single result should span across the materialization boundary (index 5).
    for (const r of results) {
      expect(r.startIdx < 5 && r.endIdx >= 5).toBe(false);
    }
  });

  test("a materialization exactly at or before the first turn is the legitimate trigger, not a suppressor", () => {
    const turns: AssistantTurn[] = [];
    const pinnedR = 21248;
    for (let i = 0; i < 5; i++) {
      const input = 200_000 + i * 2_000;
      turns.push(turn({ messageId: `m${i}`, timeCreatedMs: BASE_MS + i * MIN_TURN, input, read: pinnedR }));
    }
    const decisions: TransformDecision[] = [
      { tsMs: turns[0].timeCreatedMs - 100, materialized: true, materializeReason: "system_hash" },
    ];
    const results = detectPlateaus(turns, decisions, DETECTION_OPTIONS);
    expect(results).toHaveLength(1);
    expect(results[0].triggerReason).toBe("system_hash");
  });

  test("a single-turn dip below --min-run is not detected", () => {
    const turns: AssistantTurn[] = [
      turn({ messageId: "m0", timeCreatedMs: BASE_MS, input: 50000, read: 5000 }), // reuse healthy
      turn({ messageId: "m1", timeCreatedMs: BASE_MS + MIN_TURN, input: 10000, read: 2000 }), // one low-reuse dip
      turn({ messageId: "m2", timeCreatedMs: BASE_MS + 2 * MIN_TURN, input: 50000, read: 40000 }), // healthy again
    ];
    const results = detectPlateaus(turns, [], DETECTION_OPTIONS);
    expect(results).toHaveLength(0);
  });

  test("R that is not flat (drifts beyond tolerance) is not detected", () => {
    const turns: AssistantTurn[] = [];
    for (let i = 0; i < 6; i++) {
      const input = 1000;
      const read = 5000 + i * 10000; // drifts far beyond flat tolerance
      turns.push(turn({ messageId: `m${i}`, timeCreatedMs: BASE_MS + i * MIN_TURN, input, read }));
    }
    const results = detectPlateaus(turns, [], DETECTION_OPTIONS);
    expect(results).toHaveLength(0);
  });

  test("total that does not grow across the run is not detected", () => {
    const turns: AssistantTurn[] = [];
    const pinnedR = 21248;
    for (let i = 0; i < 6; i++) {
      turns.push(turn({ messageId: `m${i}`, timeCreatedMs: BASE_MS + i * MIN_TURN, input: 1000, read: pinnedR }));
    }
    const results = detectPlateaus(turns, [], DETECTION_OPTIONS);
    expect(results).toHaveLength(0);
  });

  test("missing context.db (transformDecisions=null) degrades: still detects, flags reducedConfidence", () => {
    const turns: AssistantTurn[] = [];
    const pinnedR = 21248;
    for (let i = 0; i < 6; i++) {
      const input = 200_000 + i * 2_000;
      turns.push(turn({ messageId: `m${i}`, timeCreatedMs: BASE_MS + i * MIN_TURN, input, read: pinnedR }));
    }
    const results = detectPlateaus(turns, null, DETECTION_OPTIONS);
    expect(results).toHaveLength(1);
    expect(results[0].reducedConfidence).toBe(true);
  });

  test("tolerates a single-turn provider-side partial-cache-miss blip inside an otherwise-pinned run (real-world shape)", () => {
    // Mirrors the observed live-data shape: 18 turns pinned at R=21248 with one
    // turn dropping to R=3712 mid-run (no materialization event caused it).
    const turns: AssistantTurn[] = [];
    const pinnedR = 21248;
    for (let i = 0; i < 18; i++) {
      const input = 240_000 + i * 1_300;
      const read = i === 14 ? 3712 : pinnedR;
      turns.push(turn({ messageId: `m${i}`, timeCreatedMs: BASE_MS + i * MIN_TURN, input, read }));
    }
    const results = detectPlateaus(turns, [], DETECTION_OPTIONS);
    expect(results).toHaveLength(1);
    expect(results[0].startIdx).toBe(0);
    expect(results[0].endIdx).toBe(17);
  });

  test("two or more outlier blips beyond the outlier budget are NOT tolerated as flat", () => {
    const turns: AssistantTurn[] = [];
    const pinnedR = 21248;
    for (let i = 0; i < 5; i++) {
      const input = 240_000 + i * 1_300;
      // 2 of 5 turns deviate sharply — well beyond floor(5*0.1)=0 outlier budget.
      const read = i === 1 || i === 3 ? 3712 : pinnedR;
      turns.push(turn({ messageId: `m${i}`, timeCreatedMs: BASE_MS + i * MIN_TURN, input, read }));
    }
    const results = detectPlateaus(turns, [], DETECTION_OPTIONS);
    expect(results).toHaveLength(0);
  });

  test("a materialization landing a few seconds AFTER the run's first turn (within TRIGGER_GRACE_MS) is still the legitimate trigger, not a split", () => {
    const turns: AssistantTurn[] = [];
    const pinnedR = 21248;
    for (let i = 0; i < 6; i++) {
      const input = 240_000 + i * 1_300;
      turns.push(turn({ messageId: `m${i}`, timeCreatedMs: BASE_MS + i * MIN_TURN, input, read: pinnedR }));
    }
    // ts_ms lands 3.2s after the first turn's time_created — mirrors the observed
    // live-data skew between transform_decisions.ts_ms and message.time_created.
    const decisions: TransformDecision[] = [
      { tsMs: turns[0].timeCreatedMs + 3200, materialized: true, materializeReason: "system_hash" },
    ];
    const results = detectPlateaus(turns, decisions, DETECTION_OPTIONS);
    expect(results).toHaveLength(1);
    expect(results[0].startIdx).toBe(0);
    expect(results[0].endIdx).toBe(5);
    expect(results[0].triggerReason).toBe("system_hash");
  });

  test("a materialization beyond TRIGGER_GRACE_MS after the first turn still splits the run", () => {
    const turns: AssistantTurn[] = [];
    const pinnedR = 21248;
    for (let i = 0; i < 6; i++) {
      const input = 240_000 + i * 1_300;
      turns.push(turn({ messageId: `m${i}`, timeCreatedMs: BASE_MS + i * MIN_TURN, input, read: pinnedR }));
    }
    // Well beyond the 15s grace window, and before turn 1 (BASE_MS + MIN_TURN) — must split.
    const decisions: TransformDecision[] = [
      { tsMs: turns[0].timeCreatedMs + 16_000, materialized: true, materializeReason: "system_hash" },
    ];
    const results = detectPlateaus(turns, decisions, DETECTION_OPTIONS);
    // The materialization splits the run before it reaches turn 5 — no result
    // should span the full [0,5] window uninterrupted.
    for (const r of results) {
      expect(r.endIdx).toBeLessThan(5);
    }
  });
});

// ─── DB-backed integration tests ───────────────────────────────────────────────

describe("fetchScoredTurns / fetchTransformDecisions / selectCandidateSessions", () => {
  test("excludes turns under 1024 total tokens and error turns via SQL + JS filtering", () => {
    const dir = makeTempDir();
    try {
      const { db } = createOpencodeTestDb(dir);
      insertSession(db, "ses_1", "Test session", BASE_MS, BASE_MS);
      insertTurns(db, "ses_1", [
        { id: "t0", timeCreated: BASE_MS, input: 100, read: 100 }, // under threshold
        { id: "t1", timeCreated: BASE_MS + MIN_TURN, input: 5000, read: 5000, error: { name: "x" } }, // error
        { id: "t2", timeCreated: BASE_MS + 2 * MIN_TURN, input: 5000, read: 5000 }, // valid
      ]);
      insertUserMessage(db, "ses_1", "u0", BASE_MS + 3 * MIN_TURN);

      const turns = fetchScoredTurns(db, "ses_1");
      expect(turns).toHaveLength(1);
      expect(turns[0].messageId).toBe("t2");
      db.close();
    } finally {
      removeTempDir(dir);
    }
  });

  test("--model filter narrows turns at the SQL layer", () => {
    const dir = makeTempDir();
    try {
      const { db } = createOpencodeTestDb(dir);
      insertSession(db, "ses_1", "Test session", BASE_MS, BASE_MS);
      insertTurns(db, "ses_1", [
        { id: "t0", timeCreated: BASE_MS, input: 5000, read: 5000, modelID: "gpt-6-astra" },
        { id: "t1", timeCreated: BASE_MS + MIN_TURN, input: 5000, read: 5000, modelID: "claude-sonnet-4.6" },
      ]);

      const turns = fetchScoredTurns(db, "ses_1", "gpt-6-astra");
      expect(turns).toHaveLength(1);
      expect(turns[0].modelID).toBe("gpt-6-astra");
      db.close();
    } finally {
      removeTempDir(dir);
    }
  });

  test("selectCandidateSessions respects the since window", () => {
    const dir = makeTempDir();
    try {
      const { db } = createOpencodeTestDb(dir);
      insertSession(db, "old", "Old session", BASE_MS - 100_000, BASE_MS - 100_000);
      insertSession(db, "recent", "Recent session", BASE_MS, BASE_MS);

      const rows = selectCandidateSessions(db, BASE_MS - 1000);
      expect(rows.map((r) => r.id)).toEqual(["recent"]);
      db.close();
    } finally {
      removeTempDir(dir);
    }
  });

  test("fetchTransformDecisions reads materialized rows in ts order", () => {
    const dir = makeTempDir();
    try {
      const { db } = createContextTestDb(dir);
      insertMaterialization(db, "ses_1", BASE_MS + 200, true, "ttl_idle");
      insertMaterialization(db, "ses_1", BASE_MS + 100, true, "system_hash");
      insertMaterialization(db, "ses_1", BASE_MS + 150, false, null);

      const decisions = fetchTransformDecisions(db, "ses_1");
      expect(decisions.map((d) => d.tsMs)).toEqual([BASE_MS + 100, BASE_MS + 150, BASE_MS + 200]);
      expect(decisions[0].materializeReason).toBe("system_hash");
      db.close();
    } finally {
      removeTempDir(dir);
    }
  });
});

describe("scanSession end-to-end (fixture DBs, opened readonly: true, never file: URI)", () => {
  test("detects the known-shape plateau across two DBs and reports reducedConfidence=false", () => {
    const dir = makeTempDir();
    try {
      const { db: opencodeDb } = createOpencodeTestDb(dir);
      const { db: contextDb } = createContextTestDb(dir);

      insertSession(opencodeDb, "ses_plateau", "Plateau session", BASE_MS, BASE_MS + 18 * MIN_TURN);
      const specs: TurnSpec[] = [];
      const pinnedR = 21248;
      for (let i = 0; i < 18; i++) {
        specs.push({ id: `t${i}`, timeCreated: BASE_MS + i * MIN_TURN, input: 200_000 + i * 2_000, read: pinnedR });
      }
      insertTurns(opencodeDb, "ses_plateau", specs);
      insertMaterialization(contextDb, "ses_plateau", BASE_MS - 1000, true, "system_hash");

      const result = scanSession(opencodeDb, contextDb, "ses_plateau", "Plateau session", undefined, DETECTION_OPTIONS);
      expect(result.plateaus).toHaveLength(1);
      expect(result.plateaus[0].reducedConfidence).toBe(false);
      expect(result.plateaus[0].triggerReason).toBe("system_hash");
      expect(result.plateaus[0].wastedTokens).toBeGreaterThan(0);

      opencodeDb.close();
      contextDb.close();
    } finally {
      removeTempDir(dir);
    }
  });

  test("scanSession with contextDb=null degrades gracefully (no throw, reducedConfidence=true)", () => {
    const dir = makeTempDir();
    try {
      const { db: opencodeDb } = createOpencodeTestDb(dir);
      insertSession(opencodeDb, "ses_plateau", "Plateau session", BASE_MS, BASE_MS + 6 * MIN_TURN);
      const specs: TurnSpec[] = [];
      const pinnedR = 21248;
      for (let i = 0; i < 6; i++) {
        specs.push({ id: `t${i}`, timeCreated: BASE_MS + i * MIN_TURN, input: 200_000 + i * 2_000, read: pinnedR });
      }
      insertTurns(opencodeDb, "ses_plateau", specs);

      const result = scanSession(opencodeDb, null, "ses_plateau", "Plateau session", undefined, DETECTION_OPTIONS);
      expect(result.plateaus).toHaveLength(1);
      expect(result.plateaus[0].reducedConfidence).toBe(true);

      opencodeDb.close();
    } finally {
      removeTempDir(dir);
    }
  });
});

// ─── CLI parsing ──────────────────────────────────────────────────────────────

describe("parseSinceDuration", () => {
  test("parses days, hours, minutes", () => {
    const now = Date.now();
    expect(parseSinceDuration("7d")).toBeLessThanOrEqual(now - 6 * 86_400_000);
    expect(parseSinceDuration("24h")).toBeLessThanOrEqual(now - 23 * 3_600_000);
    expect(parseSinceDuration("90m")).toBeLessThanOrEqual(now - 89 * 60_000);
  });

  test("returns null on unparseable input", () => {
    expect(parseSinceDuration("banana")).toBeNull();
    expect(parseSinceDuration("7")).toBeNull();
    expect(parseSinceDuration("")).toBeNull();
  });
});

describe("parseArgs", () => {
  test("applies defaults with no flags", () => {
    const opts = parseArgs([]);
    expect(opts.minRun).toBe(DEFAULT_MIN_RUN);
    expect(opts.maxReuse).toBe(DEFAULT_MAX_REUSE);
    expect(opts.json).toBe(false);
    expect(opts.session).toBeUndefined();
  });

  test("parses --session, --model, --json, --limit", () => {
    const opts = parseArgs(["--session", "ses_xxx", "--model", "gpt-6-astra", "--json", "--limit", "5"]);
    expect(opts.session).toBe("ses_xxx");
    expect(opts.model).toBe("gpt-6-astra");
    expect(opts.json).toBe(true);
    expect(opts.limit).toBe(5);
  });

  test("--help short-circuits other flag parsing", () => {
    const opts = parseArgs(["--help"]);
    expect(opts.help).toBe(true);
  });

  test("invalid --max-reuse falls back to default with a warning", () => {
    const opts = parseArgs(["--max-reuse", "2.5"]);
    expect(opts.maxReuse).toBe(DEFAULT_MAX_REUSE);
  });
});
