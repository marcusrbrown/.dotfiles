#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ─── Types ──────────────────────────────────────────────────────────────────

export type AssistantTurn = {
  messageId: string;
  timeCreatedMs: number;
  modelID: string;
  providerID: string;
  input: number; // N — uncached input tokens (tokens.input)
  cacheRead: number; // R — tokens.cache.read
  cacheWrite: number; // W — tokens.cache.write ?? 0
  total: number; // N + R + W — full prompt size
  reuse: number; // R / total
};

export type TransformDecision = {
  tsMs: number;
  materialized: boolean;
  materializeReason: string | null;
};

export type DetectionOptions = {
  minRun: number;
  maxReuse: number;
  flatAbsTolerance: number;
  flatPctTolerance: number;
};

export type RawPlateauRun = {
  startIdx: number; // 0-based, inclusive, index into the scored turn array
  endIdx: number; // 0-based, inclusive
  reducedConfidence: boolean; // true when context.db was unavailable and rule 4 was skipped
  triggerReason: string | null;
  triggerTsMs: number | null;
};

export type PlateauRun = {
  sessionId: string;
  title: string;
  model: string;
  providerID: string;
  runLength: number;
  totalTurnsScored: number;
  startIndex: number; // 1-based ordinal within the scored turn sequence
  endIndex: number; // 1-based ordinal within the scored turn sequence
  startTimeMs: number;
  endTimeMs: number;
  reuseMin: number;
  reuseMax: number;
  cacheReadPinned: number; // median R across the run
  cacheReadMin: number;
  cacheReadMax: number;
  totalFirst: number;
  totalLast: number;
  wastedTokens: number; // sum(N + W) across the run
  triggerReason: string | null;
  triggerTsMs: number | null;
  wallClockGapsMs: number[];
  reducedConfidence: boolean;
};

export type SessionScanResult = {
  sessionId: string;
  title: string;
  scoredTurnCount: number;
  plateaus: PlateauRun[];
};

// ─── Constants ────────────────────────────────────────────────────────────────

export const DEFAULT_MIN_RUN = 3;
export const DEFAULT_MAX_REUSE = 0.25;
export const DEFAULT_FLAT_ABS_TOLERANCE = 2048;
export const DEFAULT_FLAT_PCT_TOLERANCE = 0.05;
export const MIN_TOTAL_TOKENS = 1024; // below this a turn is below the cache-eligibility threshold — noise, skip
export const DEFAULT_SINCE = "7d";
export const DEFAULT_LIMIT = 20;

// transform_decisions.ts_ms is recorded a few seconds into request processing,
// while message.time_created is stamped at request dispatch — observed skew on
// real data is ~3-4s. A materialization within this grace window of a run's
// first turn is still its legitimate trigger, not a mid-run reset.
export const TRIGGER_GRACE_MS = 15_000;

// A pinned-R run can contain a rare single-turn provider-side partial cache
// miss (a genuine but transient reuse dip) without that turn being a real
// context reset. Flatness tolerates up to this fraction of the run's turns
// falling outside the per-turn tolerance band around the median.
export const FLAT_OUTLIER_BUDGET_FRACTION = 0.1;

const DEFAULT_OPENCODE_DB_PATH = join(homedir(), ".local/share/opencode/opencode.db");
const DEFAULT_CONTEXT_DB_PATH = join(homedir(), ".local/share/cortexkit/magic-context/context.db");

// ─── DB Access ────────────────────────────────────────────────────────────────

/**
 * Open a read-only SQLite connection.
 *
 * A `file:...?mode=ro` URI is deliberately not used: URI filenames require
 * SQLite's URI handling to be enabled, and where it is not the whole string
 * is treated as a literal path, so the open fails with "unable to open
 * database file" on Linux. Plain path + `{ readonly: true }` maps to
 * SQLITE_OPEN_READONLY and works on both macOS and Linux.
 */
export function openReadOnlyDb(dbPath: string): Database {
  const db = new Database(dbPath, { readonly: true });
  db.exec("PRAGMA busy_timeout=5000");
  return db;
}

/**
 * Open the context.db connection if the file exists and is readable.
 * Returns null (not a throw) on any failure — callers degrade gracefully:
 * detection still runs, rule 4 (materialization check) is skipped, and the
 * output flags reduced confidence.
 */
export function tryOpenContextDb(dbPath: string): Database | null {
  if (!existsSync(dbPath)) return null;
  try {
    return openReadOnlyDb(dbPath);
  } catch {
    return null;
  }
}

type MessageRow = { id: string; time_created: number; data: string };

/**
 * Parse a message.data JSON blob into a scored AssistantTurn.
 * Returns null (skip) on: malformed JSON, non-assistant role, a non-null
 * `error`, missing/malformed tokens shape, or total < MIN_TOTAL_TOKENS.
 *
 * Token accounting: tokens.input is the UNCACHED portion. total = N + R + W.
 * reuse = R / total — never R / N.
 */
export function parseAssistantTurn(row: MessageRow): AssistantTurn | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.data);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;

  if (obj.role !== "assistant") return null;
  if (obj.error != null) return null;

  const tokens = obj.tokens;
  if (typeof tokens !== "object" || tokens === null) return null;
  const t = tokens as Record<string, unknown>;

  const input = typeof t.input === "number" ? t.input : null;
  if (input === null) return null;

  const cache = t.cache;
  if (typeof cache !== "object" || cache === null) return null;
  const c = cache as Record<string, unknown>;

  const read = typeof c.read === "number" ? c.read : null;
  if (read === null) return null;
  const write = typeof c.write === "number" ? c.write : 0;

  const total = input + read + write;
  if (total < MIN_TOTAL_TOKENS) return null;

  const modelID = typeof obj.modelID === "string" ? obj.modelID : "unknown";
  const providerID = typeof obj.providerID === "string" ? obj.providerID : "unknown";

  return {
    messageId: row.id,
    timeCreatedMs: row.time_created,
    modelID,
    providerID,
    input,
    cacheRead: read,
    cacheWrite: write,
    total,
    reuse: read / total,
  };
}

/**
 * Fetch and parse all scored assistant turns for a session, time-ordered.
 * `json_extract` filters at the SQL layer so unrelated rows (user messages,
 * other models when --model is set) are never pulled into JS for a 66GB DB.
 */
export function fetchScoredTurns(db: Database, sessionId: string, model?: string): AssistantTurn[] {
  const rows = model
    ? db
        .query<MessageRow, [string, string]>(
          `SELECT id, time_created, data FROM message
           WHERE session_id = ? AND json_extract(data, '$.role') = 'assistant'
             AND json_extract(data, '$.modelID') = ?
           ORDER BY time_created ASC`,
        )
        .all(sessionId, model)
    : db
        .query<MessageRow, [string]>(
          `SELECT id, time_created, data FROM message
           WHERE session_id = ? AND json_extract(data, '$.role') = 'assistant'
           ORDER BY time_created ASC`,
        )
        .all(sessionId);

  const turns: AssistantTurn[] = [];
  for (const row of rows) {
    const turn = parseAssistantTurn(row);
    if (turn) turns.push(turn);
  }
  return turns;
}

type TransformDecisionRow = { ts_ms: number; materialized: number; materialize_reason: string | null };

export function fetchTransformDecisions(db: Database, sessionId: string): TransformDecision[] {
  const rows = db
    .query<TransformDecisionRow, [string]>(
      `SELECT ts_ms, materialized, materialize_reason FROM transform_decisions
       WHERE session_id = ? ORDER BY ts_ms ASC`,
    )
    .all(sessionId);

  return rows.map((r) => ({
    tsMs: r.ts_ms,
    materialized: r.materialized === 1,
    materializeReason: r.materialize_reason,
  }));
}

type SessionRow = { id: string; title: string | null };

export function selectCandidateSessions(
  db: Database,
  sinceMs: number,
): Array<{ id: string; title: string }> {
  const rows = db
    .query<SessionRow, [number]>(
      `SELECT id, title FROM session WHERE time_updated >= ? ORDER BY time_created ASC`,
    )
    .all(sinceMs);
  return rows.map((r) => ({ id: r.id, title: r.title ?? "(untitled)" }));
}

export function fetchSessionTitle(db: Database, sessionId: string): string | null {
  const row = db.query<{ title: string | null }, [string]>(`SELECT title FROM session WHERE id = ?`).get(sessionId);
  return row ? (row.title ?? "(untitled)") : null;
}

// ─── Detection ────────────────────────────────────────────────────────────────

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Split a maximal low-reuse [s,e] segment at any materialized=1 event that
 * occurs strictly after turns[s].timeCreatedMs (the run's first turn is
 * allowed a legitimate triggering materialization; anything after that
 * *inside* the run means a fresh legitimate reset happened, so the run
 * splits there rather than being disqualified wholesale). Each resulting
 * sub-segment gets re-evaluated against minRun/flat/growth independently.
 */
function splitSegmentByMaterialization(
  turns: AssistantTurn[],
  s: number,
  e: number,
  materializedEvents: TransformDecision[],
): Array<[number, number]> {
  const boundarySet = new Set<number>();

  for (const ev of materializedEvents) {
    if (ev.tsMs <= turns[s].timeCreatedMs + TRIGGER_GRACE_MS) continue; // legitimate trigger for the segment start, not a split
    if (ev.tsMs > turns[e].timeCreatedMs) continue; // outside this segment's window

    for (let k = s + 1; k <= e; k++) {
      if (turns[k].timeCreatedMs >= ev.tsMs) {
        boundarySet.add(k);
        break;
      }
    }
  }

  const boundaries = [...boundarySet].sort((a, b) => a - b);
  const segments: Array<[number, number]> = [];
  let start = s;
  for (const b of boundaries) {
    segments.push([start, b - 1]);
    start = b;
  }
  segments.push([start, e]);
  return segments;
}

/**
 * Closest materialized=1 row at or before `atOrBeforeMs` (allowing
 * TRIGGER_GRACE_MS of slack for the ts_ms-vs-time_created skew described
 * above), or null if none / unavailable.
 */
function findTriggerReason(
  transformDecisions: TransformDecision[] | null,
  atOrBeforeMs: number,
): TransformDecision | null {
  if (!transformDecisions) return null;
  let best: TransformDecision | null = null;
  for (const d of transformDecisions) {
    if (!d.materialized) continue;
    if (d.tsMs <= atOrBeforeMs + TRIGGER_GRACE_MS && (!best || d.tsMs > best.tsMs)) best = d;
  }
  return best;
}

/**
 * Detect plateau runs within a time-ordered, already-scored turn sequence.
 *
 * A plateau is a run of >= minRun consecutive turns where reuse stays below
 * maxReuse, R (cache read) stays flat within tolerance, and total prompt
 * size still grows — i.e. the model keeps paying full or near-full prompt
 * cost turn after turn with no recovery. `transformDecisions === null` means
 * context.db was unavailable: rule 4 (materialization check) is skipped and
 * every detection in that mode is flagged reducedConfidence.
 */
export function detectPlateaus(
  turns: AssistantTurn[],
  transformDecisions: TransformDecision[] | null,
  options: DetectionOptions,
): RawPlateauRun[] {
  const results: RawPlateauRun[] = [];
  if (turns.length === 0) return results;

  const materializedEvents = transformDecisions ? transformDecisions.filter((d) => d.materialized) : [];

  let i = 0;
  while (i < turns.length) {
    if (turns[i].reuse >= options.maxReuse) {
      i++;
      continue;
    }

    let j = i;
    while (j + 1 < turns.length && turns[j + 1].reuse < options.maxReuse) j++;
    // [i, j] is the maximal contiguous low-reuse segment.

    const segments = transformDecisions
      ? splitSegmentByMaterialization(turns, i, j, materializedEvents)
      : [[i, j] as [number, number]];

    for (const [s, e] of segments) {
      const runLength = e - s + 1;
      if (runLength < options.minRun) continue;

      const reads = turns.slice(s, e + 1).map((t) => t.cacheRead);
      const med = median(reads);
      const tolerance = Math.max(options.flatAbsTolerance, options.flatPctTolerance * med);
      // Literal max-min flatness is too brittle against real data: a single
      // transient provider-side partial cache miss inside an otherwise-pinned
      // run shouldn't disqualify the whole plateau. Tolerate a small budget of
      // per-turn outliers instead of requiring every turn within tolerance.
      const outliers = reads.filter((r) => Math.abs(r - med) > tolerance).length;
      const outlierBudget = Math.floor(runLength * FLAT_OUTLIER_BUDGET_FRACTION);
      const flat = outliers <= outlierBudget;

      const growth = turns[e].total > turns[s].total;

      if (!flat || !growth) continue;

      const trigger = findTriggerReason(transformDecisions, turns[s].timeCreatedMs);
      results.push({
        startIdx: s,
        endIdx: e,
        reducedConfidence: transformDecisions === null,
        triggerReason: trigger?.materializeReason ?? null,
        triggerTsMs: trigger?.tsMs ?? null,
      });
    }

    i = j + 1;
  }

  return results;
}

export function buildPlateauRun(
  sessionId: string,
  title: string,
  turns: AssistantTurn[],
  totalTurnsScored: number,
  raw: RawPlateauRun,
): PlateauRun {
  const runTurns = turns.slice(raw.startIdx, raw.endIdx + 1);
  const reuses = runTurns.map((t) => t.reuse);
  const reads = runTurns.map((t) => t.cacheRead);
  const wastedTokens = runTurns.reduce((sum, t) => sum + t.input + t.cacheWrite, 0);

  const gaps: number[] = [];
  for (let k = 1; k < runTurns.length; k++) {
    gaps.push(runTurns[k].timeCreatedMs - runTurns[k - 1].timeCreatedMs);
  }

  return {
    sessionId,
    title,
    model: runTurns[0].modelID,
    providerID: runTurns[0].providerID,
    runLength: runTurns.length,
    totalTurnsScored,
    startIndex: raw.startIdx + 1,
    endIndex: raw.endIdx + 1,
    startTimeMs: runTurns[0].timeCreatedMs,
    endTimeMs: runTurns[runTurns.length - 1].timeCreatedMs,
    reuseMin: Math.min(...reuses),
    reuseMax: Math.max(...reuses),
    cacheReadPinned: median(reads),
    cacheReadMin: Math.min(...reads),
    cacheReadMax: Math.max(...reads),
    totalFirst: runTurns[0].total,
    totalLast: runTurns[runTurns.length - 1].total,
    wastedTokens,
    triggerReason: raw.triggerReason,
    triggerTsMs: raw.triggerTsMs,
    wallClockGapsMs: gaps,
    reducedConfidence: raw.reducedConfidence,
  };
}

export function scanSession(
  opencodeDb: Database,
  contextDb: Database | null,
  sessionId: string,
  title: string,
  model: string | undefined,
  options: DetectionOptions,
): SessionScanResult {
  const turns = fetchScoredTurns(opencodeDb, sessionId, model);
  const transformDecisions = contextDb ? fetchTransformDecisions(contextDb, sessionId) : null;
  const raw = detectPlateaus(turns, transformDecisions, options);
  const plateaus = raw.map((r) => buildPlateauRun(sessionId, title, turns, turns.length, r));
  return { sessionId, title, scoredTurnCount: turns.length, plateaus };
}

// ─── CLI: Duration Parsing ──────────────────────────────────────────────────────

/** Parse `--since` values: `7d`, `24h`, `90m`. Returns epoch ms, or null if unparseable. */
export function parseSinceDuration(value: string): number | null {
  const match = /^(\d+)(d|h|m)$/.exec(value);
  if (!match) return null;
  const amount = parseInt(match[1], 10);
  const unitMs = match[2] === "d" ? 86_400_000 : match[2] === "h" ? 3_600_000 : 60_000;
  return Date.now() - amount * unitMs;
}

// ─── CLI: Flag Parsing ──────────────────────────────────────────────────────────

export type CliOptions = {
  session?: string;
  model?: string;
  sinceMs: number;
  minRun: number;
  maxReuse: number;
  flatPctTolerance: number;
  json: boolean;
  limit: number;
  help: boolean;
};

const KNOWN_FLAGS = new Set([
  "--session",
  "--model",
  "--since",
  "--min-run",
  "--max-reuse",
  "--flat-tolerance",
  "--json",
  "--limit",
  "--help",
  "-h",
]);

function warnUnknownFlag(flag: string): void {
  console.warn(`Warning: Unknown flag "${flag}" ignored`);
}

function warnInvalidValue(flag: string, value: string, expected: string): void {
  console.warn(`Warning: Invalid value "${value}" for ${flag}, expected ${expected}. Using default.`);
}

export function parseArgs(argv: string[]): CliOptions {
  const args = new Map<string, string | boolean>();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "-h" || arg === "--help") {
      args.set("--help", true);
      continue;
    }

    if (!arg.startsWith("--")) continue;

    const eqIndex = arg.indexOf("=");
    if (eqIndex !== -1) {
      const key = arg.slice(0, eqIndex);
      const rawValue = arg.slice(eqIndex + 1);
      if (!KNOWN_FLAGS.has(key)) {
        warnUnknownFlag(key);
        continue;
      }
      args.set(key, rawValue);
      continue;
    }

    if (!KNOWN_FLAGS.has(arg)) {
      warnUnknownFlag(arg);
      continue;
    }

    if (arg === "--json") {
      args.set(arg, true);
      continue;
    }

    const nextValue = argv[i + 1];
    if (nextValue != null && !nextValue.startsWith("--")) {
      args.set(arg, nextValue);
      i += 1;
      continue;
    }

    args.set(arg, true);
  }

  if (args.get("--help") === true) {
    return {
      sinceMs: Date.now(),
      minRun: DEFAULT_MIN_RUN,
      maxReuse: DEFAULT_MAX_REUSE,
      flatPctTolerance: DEFAULT_FLAT_PCT_TOLERANCE,
      json: false,
      limit: DEFAULT_LIMIT,
      help: true,
    };
  }

  const sessionValue = args.get("--session");
  const modelValue = args.get("--model");

  const sinceValue = args.get("--since");
  let sinceMs = Date.now() - 7 * 86_400_000;
  if (sinceValue != null && sinceValue !== true) {
    const parsed = parseSinceDuration(String(sinceValue));
    if (parsed === null) {
      warnInvalidValue("--since", String(sinceValue), "duration like 7d, 24h, or 90m");
    } else {
      sinceMs = parsed;
    }
  }

  const minRunValue = args.get("--min-run");
  let minRun = DEFAULT_MIN_RUN;
  if (minRunValue != null && minRunValue !== true) {
    const parsed = Number(minRunValue);
    if (!Number.isInteger(parsed) || parsed < 2) {
      warnInvalidValue("--min-run", String(minRunValue), "integer >= 2");
    } else {
      minRun = parsed;
    }
  }

  const maxReuseValue = args.get("--max-reuse");
  let maxReuse = DEFAULT_MAX_REUSE;
  if (maxReuseValue != null && maxReuseValue !== true) {
    const parsed = Number(maxReuseValue);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 1) {
      warnInvalidValue("--max-reuse", String(maxReuseValue), "float between 0 and 1");
    } else {
      maxReuse = parsed;
    }
  }

  const flatToleranceValue = args.get("--flat-tolerance");
  let flatPctTolerance = DEFAULT_FLAT_PCT_TOLERANCE;
  if (flatToleranceValue != null && flatToleranceValue !== true) {
    const parsed = Number(flatToleranceValue);
    if (!Number.isFinite(parsed) || parsed < 0) {
      warnInvalidValue("--flat-tolerance", String(flatToleranceValue), "non-negative float (fraction, e.g. 0.05)");
    } else {
      flatPctTolerance = parsed;
    }
  }

  const jsonValue = args.get("--json");
  const json = jsonValue === true;

  const limitValue = args.get("--limit");
  let limit = DEFAULT_LIMIT;
  if (limitValue != null && limitValue !== true) {
    const parsed = Number(limitValue);
    if (!Number.isInteger(parsed) || parsed < 1) {
      warnInvalidValue("--limit", String(limitValue), "positive integer");
    } else {
      limit = parsed;
    }
  }

  return {
    session: sessionValue != null && sessionValue !== true ? String(sessionValue) : undefined,
    model: modelValue != null && modelValue !== true ? String(modelValue) : undefined,
    sinceMs,
    minRun,
    maxReuse,
    flatPctTolerance,
    json,
    limit,
    help: false,
  };
}

// ─── CLI: Output ──────────────────────────────────────────────────────────────

const USAGE = `cache-plateau — detect sessions stuck in sustained prompt-cache collapse.

USAGE:
  cache-plateau.ts [OPTIONS]
  mise run opencode:cache-plateau -- [OPTIONS]   # note: -- separator forwards flags through mise

OPTIONS:
  -h, --help              Show this message.
  --session <id>          Analyse exactly one session (ignores --since).
  --model <id>             Filter to a model (e.g. gpt-6-astra).
  --since <dur>            Recency filter: 7d / 24h / 90m. Default: 7d.
  --min-run <n>            Minimum consecutive scored turns to call a plateau. Default: 3.
  --max-reuse <f>          Reuse ceiling (0-1) below which a turn counts as low-reuse. Default: 0.25.
  --flat-tolerance <f>     Fractional tolerance for "flat R" (used as max(2048, f * median(R))). Default: 0.05.
  --json                   Machine-readable output.
  --limit <n>              Max plateaus reported, sorted by wasted tokens desc. Default: 20.

ENVIRONMENT VARIABLES:
  OPENCODE_DB_PATH   Override OpenCode SQLite path (default: ~/.local/share/opencode/opencode.db)
  CONTEXT_DB_PATH    Override Magic Context SQLite path (default: ~/.local/share/cortexkit/magic-context/context.db)

EXIT CODES:
  0   Scan completed (finding plateaus is a normal result, not a failure).
  1   Real error — unreadable opencode.db, or --session id not found.

EXAMPLES:
  cache-plateau.ts                                   # scan last 7 days, all models
  cache-plateau.ts --model gpt-6-astra --since 7d
  cache-plateau.ts --session ses_xxx --json
`;

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function truncateTitle(title: string, max = 60): string {
  return title.length > max ? title.slice(0, max - 1) + "…" : title;
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatIso(ms: number): string {
  return new Date(ms).toISOString();
}

function renderPlateauText(p: PlateauRun): string {
  const lines: string[] = [];
  lines.push(`Session ${p.sessionId} — "${truncateTitle(p.title)}" (${p.model})`);
  lines.push(
    `  Run: turns ${p.startIndex}-${p.endIndex} of ${p.totalTurnsScored} (${p.runLength} turns, ${formatIso(p.startTimeMs)} → ${formatIso(p.endTimeMs)})`,
  );
  lines.push(`  Reuse: ${formatPct(p.reuseMin)} – ${formatPct(p.reuseMax)}`);
  lines.push(
    `  Cache read pinned: ~${Math.round(p.cacheReadPinned).toLocaleString()} tokens (range ${p.cacheReadMin.toLocaleString()}-${p.cacheReadMax.toLocaleString()})`,
  );
  lines.push(`  Prompt growth: ${p.totalFirst.toLocaleString()} → ${p.totalLast.toLocaleString()} tokens`);
  lines.push(`  Wasted tokens: ${p.wastedTokens.toLocaleString()}`);
  if (p.triggerReason != null && p.triggerTsMs != null) {
    lines.push(`  Triggered by: ${p.triggerReason} materialization at ${formatIso(p.triggerTsMs)}`);
  } else if (p.reducedConfidence) {
    lines.push(`  Triggered by: unknown (context.db unavailable — reduced confidence)`);
  } else {
    lines.push(`  Triggered by: no preceding materialization found`);
  }
  if (p.wallClockGapsMs.length > 0) {
    const gapsSec = p.wallClockGapsMs.map((ms) => Math.round(ms / 1000));
    lines.push(`  Wall-clock gaps: ${gapsSec.map((s) => `${s}s`).join(", ")}`);
  }
  return lines.join("\n");
}

type Summary = {
  sessions_scanned: number;
  plateaus_found: number;
  total_wasted_tokens: number;
  worst_session: { session_id: string; title: string; wasted_tokens: number } | null;
  context_db_available: boolean;
};

function renderText(plateaus: PlateauRun[], summary: Summary, options: CliOptions): void {
  if (!summary.context_db_available) {
    console.log(
      "Warning: context.db unavailable — rule 4 (materialization check) skipped; detections below are flagged reducedConfidence and may include sessions that were legitimately reset once.\n",
    );
  }

  if (plateaus.length === 0) {
    console.log("No cache plateaus detected.\n");
  } else {
    for (const p of plateaus) {
      console.log(renderPlateauText(p));
      console.log("");
    }
  }

  console.log("Summary");
  console.log("-------");
  console.log(`Sessions scanned: ${summary.sessions_scanned}`);
  console.log(`Plateaus found: ${summary.plateaus_found}`);
  console.log(`Total wasted tokens: ${summary.total_wasted_tokens.toLocaleString()}`);
  if (summary.worst_session) {
    console.log(
      `Worst session: ${summary.worst_session.session_id} — "${truncateTitle(summary.worst_session.title)}" (${summary.worst_session.wasted_tokens.toLocaleString()} wasted tokens)`,
    );
  } else {
    console.log("Worst session: none");
  }
  if (plateaus.length < summary.plateaus_found) {
    console.log(`(showing top ${plateaus.length} of ${summary.plateaus_found}, --limit=${options.limit})`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(USAGE);
    return 0;
  }

  const opencodeDbPath = process.env.OPENCODE_DB_PATH ?? DEFAULT_OPENCODE_DB_PATH;
  const contextDbPath = process.env.CONTEXT_DB_PATH ?? DEFAULT_CONTEXT_DB_PATH;

  let opencodeDb: Database;
  try {
    opencodeDb = openReadOnlyDb(opencodeDbPath);
  } catch (err) {
    const message = `Failed to open OpenCode DB at ${opencodeDbPath}: ${formatErrorMessage(err)}`;
    if (options.json) {
      console.log(JSON.stringify([{ label: "cache-plateau-scan", error: message }], null, 2));
    } else {
      console.error(`Error: ${message}`);
    }
    return 1;
  }

  const contextDb = tryOpenContextDb(contextDbPath);
  const contextDbAvailable = contextDb !== null;

  const detectionOptions: DetectionOptions = {
    minRun: options.minRun,
    maxReuse: options.maxReuse,
    flatAbsTolerance: DEFAULT_FLAT_ABS_TOLERANCE,
    flatPctTolerance: options.flatPctTolerance,
  };

  const results: SessionScanResult[] = [];

  try {
    if (options.session) {
      const title = fetchSessionTitle(opencodeDb, options.session);
      if (title === null) {
        const message = `Session not found: ${options.session}`;
        if (options.json) {
          console.log(JSON.stringify([{ label: "cache-plateau-scan", error: message }], null, 2));
        } else {
          console.error(`Error: ${message}`);
        }
        return 1;
      }
      results.push(scanSession(opencodeDb, contextDb, options.session, title, options.model, detectionOptions));
    } else {
      const candidates = selectCandidateSessions(opencodeDb, options.sinceMs);
      for (const row of candidates) {
        results.push(scanSession(opencodeDb, contextDb, row.id, row.title, options.model, detectionOptions));
      }
    }
  } catch (err) {
    const message = `Scan failed: ${formatErrorMessage(err)}`;
    if (options.json) {
      console.log(JSON.stringify([{ label: "cache-plateau-scan", error: message }], null, 2));
    } else {
      console.error(`Error: ${message}`);
    }
    return 1;
  } finally {
    opencodeDb.close();
    contextDb?.close();
  }

  const allPlateaus = results.flatMap((r) => r.plateaus);
  allPlateaus.sort((a, b) => b.wastedTokens - a.wastedTokens);
  const limited = allPlateaus.slice(0, options.limit);

  const totalWasted = allPlateaus.reduce((sum, p) => sum + p.wastedTokens, 0);
  const worst = allPlateaus[0] ?? null;

  const summary: Summary = {
    sessions_scanned: results.length,
    plateaus_found: allPlateaus.length,
    total_wasted_tokens: totalWasted,
    worst_session: worst
      ? { session_id: worst.sessionId, title: worst.title, wasted_tokens: worst.wastedTokens }
      : null,
    context_db_available: contextDbAvailable,
  };

  if (options.json) {
    const data = {
      since_ms: options.session ? null : options.sinceMs,
      model: options.model ?? null,
      plateaus: limited,
      summary,
    };
    console.log(JSON.stringify([{ label: "cache-plateau-scan", data }], null, 2));
  } else {
    renderText(limited, summary, options);
  }

  return 0;
}

if (import.meta.main) {
  main().then((code) => process.exit(code));
}
