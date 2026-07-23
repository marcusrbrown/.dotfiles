#!/usr/bin/env bun
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { statfsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import { createOpencodeClient } from "@opencode-ai/sdk";
import {
  bytesToHuman,
  estimateReclaim,
  selectOldSessionIds,
  withSessionIdCandidateTable,
  type ReclaimEstimate,
} from "./lib/opencode-session-tree-retention";

export { estimateReclaim, selectOldSessionIds, type ReclaimEstimate };

type OutputFormat = "text" | "json";

type CliOptions = {
  host: string;
  port: number;
  portProvided: boolean;
  directory: string;
  format: OutputFormat;
  only: Set<SectionKey> | null;
  tui: boolean;
  full: boolean;
  limit: number;
  toolsProvider?: string;
  toolsModel?: string;
  // DB flags
  dbHealth: boolean;
  pruneOlderDays: number | null;
  pruneEventsOlderDays: number | null;
  execute: boolean;
  dbPath: string;
  setIncrementalVacuum: boolean;
};

type SectionResult = {
  label: string;
  data: unknown;
  error?: string;
};

// Plain-object shape returned by safety-gate helpers (subset of SectionResult.data).
type SectionResultData = Record<string, unknown>;

const DEFAULT_PORT = 4096;
const AUTO_PORT_ATTEMPTS = 10;
const DEFAULT_LIMIT = 10;
const DEFAULT_DB_PATH = `${homedir()}/.local/share/opencode/opencode.db`;
const DEFAULT_PRUNE_DAYS = 30;
const BUSY_RETRY_ATTEMPTS = 3;
const BUSY_RETRY_DELAY_MS = 100;

const SECTION_KEYS = [
  "server",
  "health",
  "config",
  "providers",
  "project",
  "projects",
  "path",
  "vcs",
  "agents",
  "commands",
  "tools",
  "tool-ids",
  "mcp",
  "lsp",
  "formatter",
  "sessions",
  "session-status",
  "db-health",
] as const;

const SENSITIVE_KEYS = [
  "token",
  "secret",
  "apikey",
  "api_key",
  "api-key",
  "access_key",
  "access-key",
  "private_key",
  "private-key",
  "password",
  "bearer",
  "credential",
] as const;

// Exact matches for keys that would false-positive with substring matching (e.g., "auth" matches "author")
const SENSITIVE_EXACT_KEYS = new Set(["auth", "authorization"]);

type SectionKey = (typeof SECTION_KEYS)[number];

const KNOWN_FLAGS = new Set([
  "--port",
  "--host",
  "--directory",
  "--format",
  "--json",
  "--no-tui",
  "--only",
  "--full",
  "--limit",
  "--tools-provider",
  "--tools-model",
  "--help",
  "-h",
  // DB flags
  "--db-health",
  "--prune-older",
  "--prune-events-older",
  "--execute",
  "--db-path",
  "--set-incremental-vacuum",
]);

function warnUnknownFlag(flag: string): void {
  console.warn(`Warning: Unknown flag "${flag}" ignored`);
}

function warnInvalidValue(flag: string, value: string, expected: string): void {
  console.warn(`Warning: Invalid value "${value}" for ${flag}, expected ${expected}. Using default.`);
}

function isBooleanTrue(value: string | boolean): boolean {
  if (value === true) return true;
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    return lower === "true" || lower === "1" || lower === "yes";
  }
  return false;
}

function isBooleanFalse(value: string | boolean): boolean {
  if (value === false) return true;
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    return lower === "false" || lower === "0" || lower === "no";
  }
  return false;
}

function parseArgs(argv: string[]): CliOptions {
  const args = new Map<string, string | boolean>();
  let endOfOptions = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--") {
      endOfOptions = true;
      continue;
    }

    if (endOfOptions || !arg.startsWith("--")) {
      if (arg === "-h") {
        args.set("help", true);
      }
      continue;
    }

    if (arg === "--help") {
      args.set("help", true);
      continue;
    }

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

    const nextValue = argv[i + 1];
    if (nextValue != null && !nextValue.startsWith("--") && nextValue !== "--") {
      args.set(arg, nextValue);
      i += 1;
      continue;
    }

    args.set(arg, true);
  }

  if (args.get("help") === true) {
    printHelp();
    process.exit(0);
  }

  const portValue = args.get("--port");
  let port = DEFAULT_PORT;
  let portProvided = false;
  if (portValue != null && portValue !== true) {
    const parsed = Number(portValue);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
      warnInvalidValue("--port", String(portValue), "integer 1-65535");
    } else {
      port = parsed;
      portProvided = true;
    }
  }

  const hostValue = args.get("--host");
  const directoryValue = args.get("--directory");
  const formatValue = args.get("--format");
  const onlyValue = args.get("--only");
  const limitValue = args.get("--limit");
  const toolsProviderValue = args.get("--tools-provider");
  const toolsModelValue = args.get("--tools-model");

  const noTuiValue = args.get("--no-tui");
  const tuiDisabled = noTuiValue != null && !isBooleanFalse(noTuiValue);

  const fullValue = args.get("--full");
  const full = fullValue != null && !isBooleanFalse(fullValue);

  const jsonValue = args.get("--json");
  const jsonFlag = jsonValue != null && !isBooleanFalse(jsonValue);

  const host = hostValue != null && hostValue !== true ? String(hostValue) : "localhost";

  const directory =
    directoryValue != null && directoryValue !== true
      ? String(directoryValue)
      : process.cwd();

  const format =
    jsonFlag
      ? "json"
      : formatValue != null && formatValue !== true
        ? coerceFormat(String(formatValue))
        : "text";

  let only: Set<SectionKey> | null = null;
  if (onlyValue != null && onlyValue !== true) {
    const keys = String(onlyValue).split(",").map((v) => v.trim()).filter(Boolean);
    const validKeys: SectionKey[] = [];
    for (const k of keys) {
      if ((SECTION_KEYS as readonly string[]).includes(k)) {
        validKeys.push(k as SectionKey);
      } else {
        warnInvalidValue("--only", k, `one of: ${SECTION_KEYS.join(", ")}`);
      }
    }
    if (validKeys.length > 0) {
      only = new Set(validKeys);
    }
  }

  let limit = DEFAULT_LIMIT;
  if (limitValue != null && limitValue !== true) {
    const parsed = Number(limitValue);
    if (!Number.isFinite(parsed) || parsed < 1) {
      warnInvalidValue("--limit", String(limitValue), "positive integer");
    } else {
      limit = parsed;
    }
  }

  // DB flags
  const dbHealthValue = args.get("--db-health");
  const dbHealth = dbHealthValue != null && !isBooleanFalse(dbHealthValue);

  const pruneOlderValue = args.get("--prune-older");
  let pruneOlderDays: number | null = null;
  if (pruneOlderValue != null) {
    if (pruneOlderValue === true) {
      // Flag present without value — use default
      pruneOlderDays = DEFAULT_PRUNE_DAYS;
    } else {
      const parsed = Number(pruneOlderValue);
      if (!Number.isFinite(parsed) || parsed < 1) {
        warnInvalidValue("--prune-older", String(pruneOlderValue), "positive integer >= 1 (days)");
        pruneOlderDays = DEFAULT_PRUNE_DAYS;
      } else {
        pruneOlderDays = parsed;
      }
    }
  }

  const pruneEventsValue = args.get("--prune-events-older");
  let pruneEventsOlderDays: number | null = null;
  if (pruneEventsValue != null) {
    if (pruneEventsValue === true) {
      warnInvalidValue("--prune-events-older", "(missing)", "integer >= 1 (days)");
      pruneEventsOlderDays = Number.NaN;
    } else {
      const parsed = Number(pruneEventsValue);
      if (!Number.isFinite(parsed) || parsed < 1) {
        warnInvalidValue("--prune-events-older", String(pruneEventsValue), "integer >= 1 (days)");
        pruneEventsOlderDays = parsed;
      } else {
        pruneEventsOlderDays = parsed;
      }
    }
  }

  const executeValue = args.get("--execute");
  const execute = executeValue != null && !isBooleanFalse(executeValue);

  const dbPathValue = args.get("--db-path");
  const dbPath =
    dbPathValue != null && dbPathValue !== true
      ? String(dbPathValue)
      : DEFAULT_DB_PATH;

  const setIncrementalVacuumValue = args.get("--set-incremental-vacuum");
  const setIncrementalVacuum = setIncrementalVacuumValue != null && !isBooleanFalse(setIncrementalVacuumValue);

  return {
    host,
    port,
    portProvided,
    directory,
    format,
    only,
    tui: !tuiDisabled,
    full,
    limit,
    toolsProvider: toolsProviderValue != null && toolsProviderValue !== true ? String(toolsProviderValue) : undefined,
    toolsModel: toolsModelValue != null && toolsModelValue !== true ? String(toolsModelValue) : undefined,
    dbHealth,
    pruneOlderDays,
    pruneEventsOlderDays,
    execute,
    dbPath,
    setIncrementalVacuum,
  };
}

function coerceFormat(format: string): OutputFormat {
  return format === "json" ? "json" : "text";
}

function printHelp(): void {
  const helpText = `OpenCode doctor (Bun)

Usage:
  opencode-doctor.ts [options]

Options:
  --port <number>           OpenCode server port (default: 4096)
  --host <string>           Hostname for base URL (default: localhost)
  --directory <path>        Directory to target (default: cwd)
  --format <text|json>      Output format (default: text)
  --json                    Shortcut for --format json
  --no-tui                  Disable ANSI styling
  --only <keys>             Comma-separated sections (e.g. tools,agents,config)
  --full                    Include expanded data where available
  --limit <number>          Limit list size (default: 10)
  --tools-provider <string> Provider ID for tool schemas
  --tools-model <string>    Model ID for tool schemas
  --help                    Show this help

DB Maintenance (no server required):
  --db-health               Read-only DB metrics (size, pragmas, row counts, age histogram)
  --prune-older[=<days>]    Select sessions not used in the last N days (default: 30, minimum: 1).
                            Tree-aware: a session tree (root + descendants via parent_id) is
                            only selected if no session in it was updated within the window.
                            Dry-run unless --execute. Deletion is IRREVERSIBLE.
  --prune-events-older <days>
                            Event-only retention: delete selected event streams while preserving
                            sessions, messages, and parts. Tree-aware and dry-run by default.
                            Requires auto_vacuum=INCREMENTAL for --execute; never runs full VACUUM.
                            Mutually exclusive with --prune-older.
  --execute                 PERMANENTLY and IRREVERSIBLY deletes sessions and all their
                            messages, parts, and events for --prune-older, or only events for
                            --prune-events-older. Without either prune flag, --execute is an error.
  --set-incremental-vacuum  One-time conversion: sets auto_vacuum=INCREMENTAL on the DB,
                            then runs a full VACUUM to rewrite the file with the new mode.
                            After this, future prunes can reclaim free pages incrementally
                            via PRAGMA incremental_vacuum without a full exclusive VACUUM.
                            Requires all other OpenCode instances to be closed and ~1.1x
                            the DB file size in free disk space (same constraints as prune
                            --execute). Safe to re-run: no-op if already INCREMENTAL.
  --db-path <path>          Override DB path (default: ~/.local/share/opencode/opencode.db)

Sections:
  ${SECTION_KEYS.join(", ")}
`;

  console.log(helpText);
}

function shouldInclude(options: CliOptions, key: string): boolean {
  if (options.only == null) {
    return true;
  }

  return options.only.has(key as SectionKey);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto === null) {
    return true;
  }
  return proto === Object.prototype;
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  if (SENSITIVE_EXACT_KEYS.has(normalized)) {
    return true;
  }
  return SENSITIVE_KEYS.some((sensitive) => normalized.includes(sensitive));
}

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactSecrets(entry));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isSensitiveKey(key)) {
      output[key] = "[redacted]";
    } else {
      output[key] = redactSecrets(entry);
    }
  }

  return output;
}

function formatHeader(label: string, options: CliOptions): string {
  if (!options.tui || !process.stdout.isTTY) {
    return `\n${label}\n${"-".repeat(label.length)}`;
  }

  return `\n\u001b[1m${label}\u001b[0m\n${"-".repeat(label.length)}`;
}

function formatError(message: string, options: CliOptions): string {
  if (!options.tui || !process.stdout.isTTY) {
    return `Error: ${message}`;
  }

  return `\u001b[31mError:\u001b[0m ${message}`;
}

function formatValue(data: unknown, options: CliOptions): string {
  const redacted = redactSecrets(data);
  if (options.format === "json") {
    return JSON.stringify(redacted, null, 2);
  }

  if (typeof redacted === "string") {
    return redacted;
  }

  return JSON.stringify(redacted, null, 2);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function extractData(result: unknown): { data?: unknown; error?: string } {
  if (!isPlainObject(result)) {
    return { data: result };
  }

  if ("error" in result && result.error != null) {
    return { error: safeStringify(result.error) };
  }

  if ("data" in result) {
    return { data: (result as { data?: unknown }).data };
  }

  return { data: result };
}

function parseModelString(modelValue: unknown): { provider?: string; model?: string } {
  if (typeof modelValue !== "string") {
    return {};
  }

  const [provider, ...rest] = modelValue.split("/");
  const model = rest.join("/");
  if (provider.trim().length === 0 || model.trim().length === 0) {
    return {};
  }

  return { provider, model };
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

// ─── DB Helpers ───────────────────────────────────────────────────────────────

function safeStatSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

async function withSqliteBusyRetry<T>(
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
      throw err;
    }
  }
  throw lastError;
}

export type DbHealthData = {
  db_path: string;
  file_size_bytes: number;
  file_size_human: string;
  wal_size_bytes: number;
  wal_size_human: string;
  shm_size_bytes: number;
  shm_size_human: string;
  page_count: number;
  page_size: number;
  freelist_count: number;
  free_bytes: number;
  free_pct: string;
  journal_mode: string;
  auto_vacuum: number;
  row_counts: {
    session: number;
    message: number;
    part: number;
    event: number;
    event_sequence: number;
  };
  session_age_histogram: {
    last7d: number;
    days7to30: number;
    days30to90: number;
    older90d: number;
  };
};

export function computeDbHealth(db: Database, dbPath: string): DbHealthData {
  type PragmaRow = { [key: string]: unknown };

  const pageCountRow = db.query<PragmaRow, []>("PRAGMA page_count").get();
  const pageSizeRow = db.query<PragmaRow, []>("PRAGMA page_size").get();
  const freelistRow = db.query<PragmaRow, []>("PRAGMA freelist_count").get();
  const journalRow = db.query<PragmaRow, []>("PRAGMA journal_mode").get();
  const autoVacuumRow = db.query<PragmaRow, []>("PRAGMA auto_vacuum").get();

  const pageCount = Number(pageCountRow?.page_count ?? 0);
  const pageSize = Number(pageSizeRow?.page_size ?? 0);
  const freelistCount = Number(freelistRow?.freelist_count ?? 0);
  const journalMode = String(journalRow?.journal_mode ?? "unknown");
  const autoVacuum = Number(autoVacuumRow?.auto_vacuum ?? 0);

  const freeBytes = freelistCount * pageSize;
  const totalBytes = pageCount * pageSize;
  const freePct = totalBytes > 0 ? ((freeBytes / totalBytes) * 100).toFixed(2) + "%" : "0.00%";

  type CountRow = { cnt: number };
  const sessionCount = db.query<CountRow, []>("SELECT COUNT(*) AS cnt FROM session").get()?.cnt ?? 0;
  const messageCount = db.query<CountRow, []>("SELECT COUNT(*) AS cnt FROM message").get()?.cnt ?? 0;
  const partCount = db.query<CountRow, []>("SELECT COUNT(*) AS cnt FROM part").get()?.cnt ?? 0;
  const eventCount = db.query<CountRow, []>("SELECT COUNT(*) AS cnt FROM event").get()?.cnt ?? 0;
  const eventSeqCount = db.query<CountRow, []>("SELECT COUNT(*) AS cnt FROM event_sequence").get()?.cnt ?? 0;

  // Age histogram — CAST to INTEGER to avoid numeric-vs-text comparison bug
  const now7d = Math.floor(Date.now() / 1000) - 7 * 86400;
  const now30d = Math.floor(Date.now() / 1000) - 30 * 86400;
  const now90d = Math.floor(Date.now() / 1000) - 90 * 86400;

  type HistRow = { cnt: number };
  const last7d = db.query<HistRow, [number]>(
    "SELECT COUNT(*) AS cnt FROM session WHERE CAST(time_created / 1000 AS INTEGER) >= ?"
  ).get(now7d)?.cnt ?? 0;

  const days7to30 = db.query<HistRow, [number, number]>(
    "SELECT COUNT(*) AS cnt FROM session WHERE CAST(time_created / 1000 AS INTEGER) >= ? AND CAST(time_created / 1000 AS INTEGER) < ?"
  ).get(now30d, now7d)?.cnt ?? 0;

  const days30to90 = db.query<HistRow, [number, number]>(
    "SELECT COUNT(*) AS cnt FROM session WHERE CAST(time_created / 1000 AS INTEGER) >= ? AND CAST(time_created / 1000 AS INTEGER) < ?"
  ).get(now90d, now30d)?.cnt ?? 0;

  const older90d = db.query<HistRow, [number]>(
    "SELECT COUNT(*) AS cnt FROM session WHERE CAST(time_created / 1000 AS INTEGER) < ?"
  ).get(now90d)?.cnt ?? 0;

  const fileSizeBytes = safeStatSize(dbPath);
  const walSizeBytes = safeStatSize(dbPath + "-wal");
  const shmSizeBytes = safeStatSize(dbPath + "-shm");

  return {
    db_path: dbPath,
    file_size_bytes: fileSizeBytes,
    file_size_human: bytesToHuman(fileSizeBytes),
    wal_size_bytes: walSizeBytes,
    wal_size_human: bytesToHuman(walSizeBytes),
    shm_size_bytes: shmSizeBytes,
    shm_size_human: bytesToHuman(shmSizeBytes),
    page_count: pageCount,
    page_size: pageSize,
    freelist_count: freelistCount,
    free_bytes: freeBytes,
    free_pct: freePct,
    journal_mode: journalMode,
    auto_vacuum: autoVacuum,
    row_counts: {
      session: sessionCount,
      message: messageCount,
      part: partCount,
      event: eventCount,
      event_sequence: eventSeqCount,
    },
    session_age_histogram: {
      last7d,
      days7to30,
      days30to90,
      older90d,
    },
  };
}

export type PruneResult = {
  sessions_deleted: number;
  before: {
    file_size_bytes: number;
    file_size_human: string;
    freelist_count: number;
    row_counts: { session: number; message: number; part: number; event: number; event_sequence: number };
  };
  after: {
    file_size_bytes: number;
    file_size_human: string;
    freelist_count: number;
    row_counts: { session: number; message: number; part: number; event: number; event_sequence: number };
  };
  bytes_reclaimed: number;
  bytes_reclaimed_human: string;
  vacuum_error?: string;
};

function captureDbSnapshot(db: Database, dbPath: string): PruneResult["before"] {
  type PragmaRow = { [key: string]: unknown };
  type CountRow = { cnt: number };

  const freelistCount = Number(db.query<PragmaRow, []>("PRAGMA freelist_count").get()?.freelist_count ?? 0);
  const sessionCount = db.query<CountRow, []>("SELECT COUNT(*) AS cnt FROM session").get()?.cnt ?? 0;
  const messageCount = db.query<CountRow, []>("SELECT COUNT(*) AS cnt FROM message").get()?.cnt ?? 0;
  const partCount = db.query<CountRow, []>("SELECT COUNT(*) AS cnt FROM part").get()?.cnt ?? 0;
  const eventCount = db.query<CountRow, []>("SELECT COUNT(*) AS cnt FROM event").get()?.cnt ?? 0;
  const eventSeqCount = db.query<CountRow, []>("SELECT COUNT(*) AS cnt FROM event_sequence").get()?.cnt ?? 0;
  const fileSizeBytes = safeStatSize(dbPath);

  return {
    file_size_bytes: fileSizeBytes,
    file_size_human: bytesToHuman(fileSizeBytes),
    freelist_count: freelistCount,
    row_counts: {
      session: sessionCount,
      message: messageCount,
      part: partCount,
      event: eventCount,
      event_sequence: eventSeqCount,
    },
  };
}

export function pruneSessions(db: Database, sessionIds: string[], dbPath: string): PruneResult {
  const before = captureDbSnapshot(db, dbPath);

  let sessionsDeleted = 0;

  if (sessionIds.length > 0) {
    withSessionIdCandidateTable(db, sessionIds, (tableName) => {
      db.transaction(() => {
        // Count sessions that actually exist in the DB (not just input list length).
        type CountRow = { cnt: number };
        const existingCount = db.query<CountRow, []>(
          `SELECT COUNT(*) AS cnt FROM session WHERE id IN (SELECT id FROM ${tableName})`
        ).get()?.cnt ?? 0;
        sessionsDeleted = existingCount;

        // Delete event_sequence (cascades to event) for these session ids.
        db.exec(`DELETE FROM event_sequence WHERE aggregate_id IN (SELECT id FROM ${tableName})`);
        // Delete sessions (cascades to message, part via FK).
        db.exec(`DELETE FROM session WHERE id IN (SELECT id FROM ${tableName})`);
      })();
    });
  }

  // Checkpoint WAL then VACUUM to reclaim space (VACUUM must run outside a transaction).
  // Wrap in its own try/catch: if VACUUM fails, we still report what was deleted.
  let vacuumError: string | undefined;
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    db.exec("VACUUM");
  } catch (err) {
    vacuumError = formatErrorMessage(err);
  }

  const after = captureDbSnapshot(db, dbPath);

  const bytesReclaimed = Math.max(0, before.file_size_bytes - after.file_size_bytes);

  const result: PruneResult = {
    sessions_deleted: sessionsDeleted,
    before,
    after,
    bytes_reclaimed: bytesReclaimed,
    bytes_reclaimed_human: bytesToHuman(bytesReclaimed),
  };

  if (vacuumError != null) {
    result.vacuum_error = `Rows deleted but space reclamation failed: ${vacuumError}`;
  }

  return result;
}

const EVENT_RETENTION_DISK_RESERVE_BYTES = 8 * 1024 ** 3;

export type EventPruneDependencies = {
  availableBytes?: (path: string) => number;
  walCheckpoint?: (db: Database) => { busy: number };
};

export type EventPruneResult = {
  mode: "event-only";
  selected_tree_count: number;
  selected_session_count: number;
  event_sequence_rows_deleted: number;
  event_rows_deleted: number;
  estimated_reclaim: ReclaimEstimate;
  before: PruneResult["before"];
  after: PruneResult["after"];
  file_size_delta_bytes: number;
  file_size_delta_human: string;
  vacuum_error?: string;
};

function availableBytesForPath(path: string): number {
  const stats = statfsSync(path, { bigint: true });
  return Number(stats.bsize * stats.bavail);
}

function countSessionTrees(db: Database, sessionIds: string[]): number {
  if (sessionIds.length === 0) return 0;

  return withSessionIdCandidateTable(db, sessionIds, (tableName) => {
    type CountRow = { cnt: number };
    return db.query<CountRow, []>(`
      WITH RECURSIVE tree(id, root_id) AS (
        SELECT s.id, s.id
        FROM session AS s
        WHERE s.parent_id IS NULL OR s.parent_id NOT IN (SELECT id FROM session)
        UNION ALL
        SELECT child.id, tree.root_id
        FROM session AS child
        JOIN tree ON child.parent_id = tree.id
      )
      SELECT COUNT(DISTINCT tree.root_id) AS cnt
      FROM tree
      JOIN ${tableName} AS candidate ON candidate.id = tree.id
    `).get()?.cnt ?? 0;
  });
}

function assertEventCascadeSchema(db: Database): void {
  type ForeignKeyRow = {
    table?: unknown;
    from?: unknown;
    to?: unknown;
    on_delete?: unknown;
  };
  const foreignKeys = db.query<ForeignKeyRow, []>("PRAGMA foreign_key_list(event)").all();
  const valid = foreignKeys.some((foreignKey) =>
    foreignKey.table === "event_sequence" &&
    foreignKey.from === "aggregate_id" &&
    foreignKey.to === "aggregate_id" &&
    String(foreignKey.on_delete).toUpperCase() === "CASCADE"
  );
  if (!valid) {
    throw new Error("event schema must expose event.aggregate_id -> event_sequence.aggregate_id ON DELETE CASCADE");
  }
}

function countSelectedEventRows(db: Database, tableName: string): { event: number; event_sequence: number } {
  type CountRow = { cnt: number };
  const eventSequence = db.query<CountRow, []>(
    `SELECT COUNT(*) AS cnt FROM event_sequence WHERE aggregate_id IN (SELECT id FROM ${tableName})`,
  ).get()?.cnt ?? 0;
  const event = db.query<CountRow, []>(
    `SELECT COUNT(*) AS cnt FROM event WHERE aggregate_id IN (SELECT id FROM ${tableName})`,
  ).get()?.cnt ?? 0;
  return { event, event_sequence: eventSequence };
}

type PreservationCounts = { session: number; message: number; part: number };
type PreservationHashes = {
  session: { identity: string; content: string };
  message: { identity: string; content: string };
  part: { identity: string; content: string };
};

type PreservationEvidence = {
  global: PreservationCounts;
  selected: PreservationCounts;
  selected_hashes: PreservationHashes;
};

type PreservationTable = "session" | "message" | "part";
type PreservationTableProof = {
  count: number;
  identity: string;
  content: string;
};

function appendLengthPrefixedBytes(digest: ReturnType<typeof createHash>, bytes: Uint8Array): void {
  const length = Buffer.allocUnsafe(8);
  length.writeBigUInt64BE(BigInt(bytes.byteLength));
  digest.update(length);
  digest.update(bytes);
}

function appendFramedText(digest: ReturnType<typeof createHash>, value: string): void {
  appendLengthPrefixedBytes(digest, Buffer.from(value, "utf8"));
}

function appendFramedValue(digest: ReturnType<typeof createHash>, value: unknown): void {
  if (value == null) {
    digest.update(Uint8Array.of(0));
    return;
  }

  if (typeof value === "string") {
    digest.update(Uint8Array.of(1));
    appendLengthPrefixedBytes(digest, Buffer.from(value, "utf8"));
    return;
  }

  if (value instanceof Uint8Array) {
    digest.update(Uint8Array.of(2));
    appendLengthPrefixedBytes(digest, value);
    return;
  }

  if (typeof value === "bigint") {
    digest.update(Uint8Array.of(3));
    appendFramedText(digest, value.toString(10));
    return;
  }

  if (typeof value === "number") {
    digest.update(Uint8Array.of(4));
    appendFramedText(digest, String(value));
    return;
  }

  throw new Error(`unsupported SQLite value type in preservation proof: ${typeof value}`);
}

function sqlIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function streamSelectedTableProof(
  db: Database,
  table: PreservationTable,
  tableName: string,
): PreservationTableProof {
  type ColumnRow = { cid: number; name: string };
  const columns: string[] = [];
  for (const row of db.query<ColumnRow, []>(`PRAGMA table_info(${sqlIdentifier(table)})`).iterate()) {
    columns.push(row.name);
  }
  if (columns.length === 0) {
    throw new Error(`event-only preservation invariant failed: ${table} table has no columns`);
  }

  const identityDigest = createHash("sha256");
  const contentDigest = createHash("sha256");
  appendFramedText(identityDigest, "opencode-doctor-preservation-v1");
  appendFramedText(identityDigest, table);
  appendFramedText(identityDigest, "identity");
  appendFramedText(contentDigest, "opencode-doctor-preservation-v1");
  appendFramedText(contentDigest, table);
  appendFramedText(contentDigest, "content");

  const sessionColumn = table === "session" ? "id" : "session_id";
  const columnList = columns.map(sqlIdentifier).join(", ");
  const query = db.query<Record<string, unknown>, []>(`
    SELECT ${columnList}
    FROM ${sqlIdentifier(table)}
    WHERE ${sqlIdentifier(sessionColumn)} IN (SELECT id FROM ${sqlIdentifier(tableName)})
    ORDER BY ${sqlIdentifier("id")} COLLATE BINARY
  `);

  let count = 0;
  for (const row of query.iterate()) {
    count += 1;
    appendFramedText(identityDigest, "row");
    appendFramedText(contentDigest, "row");

    for (const column of columns) {
      const value = row[column];
      if (column === "id") {
        appendFramedText(identityDigest, column);
        appendFramedValue(identityDigest, value);
      }
      appendFramedText(contentDigest, column);
      appendFramedValue(contentDigest, value);
    }
  }

  appendFramedText(identityDigest, "row-count");
  appendFramedValue(identityDigest, count);
  appendFramedText(contentDigest, "row-count");
  appendFramedValue(contentDigest, count);

  return {
    count,
    identity: identityDigest.digest("hex"),
    content: contentDigest.digest("hex"),
  };
}

function capturePreservationEvidence(db: Database, tableName: string): PreservationEvidence {
  type CountRow = { cnt: number };
  const count = (sql: string): number => db.query<CountRow, []>(sql).get()?.cnt ?? 0;
  const selected = { session: 0, message: 0, part: 0 };
  const selectedHashes = {
    session: { identity: "", content: "" },
    message: { identity: "", content: "" },
    part: { identity: "", content: "" },
  };

  for (const table of ["session", "message", "part"] as const) {
    const proof = streamSelectedTableProof(db, table, tableName);
    selected[table] = proof.count;
    selectedHashes[table] = { identity: proof.identity, content: proof.content };
  }

  return {
    global: {
      session: count("SELECT COUNT(*) AS cnt FROM session"),
      message: count("SELECT COUNT(*) AS cnt FROM message"),
      part: count("SELECT COUNT(*) AS cnt FROM part"),
    },
    selected,
    selected_hashes: selectedHashes,
  };
}

function assertPreservationCounts(
  before: PreservationEvidence,
  after: PreservationEvidence,
): void {
  for (const scope of ["global", "selected"] as const) {
    for (const table of ["session", "message", "part"] as const) {
      if (before[scope][table] !== after[scope][table]) {
        throw new Error(`event-only preservation invariant failed for ${scope} ${table} rows`);
      }
    }
  }
  for (const table of ["session", "message", "part"] as const) {
    if (
      before.selected_hashes[table].identity !== after.selected_hashes[table].identity ||
      before.selected_hashes[table].content !== after.selected_hashes[table].content
    ) {
      throw new Error(`event-only preservation invariant failed for selected ${table} identity/content`);
    }
  }
}

function walCheckpointTruncate(db: Database): { busy: number } {
  const row = db.query<{ busy?: unknown }, []>("PRAGMA wal_checkpoint(TRUNCATE)").get();
  return { busy: Number(row?.busy ?? 0) };
}

export function pruneEvents(
  db: Database,
  sessionIds: string[],
  dbPath: string,
  dependencies: EventPruneDependencies = {},
): EventPruneResult {
  db.exec("PRAGMA foreign_keys=ON");
  const autoVacuum = Number(db.query<{ auto_vacuum?: unknown }, []>("PRAGMA auto_vacuum").get()?.auto_vacuum ?? 0);
  if (autoVacuum !== 2) {
    throw new Error("event-only retention requires auto_vacuum=INCREMENTAL");
  }

  assertEventCascadeSchema(db);
  const selectedTreeCount = countSessionTrees(db, sessionIds);
  const estimatedReclaim = estimateReclaim(db, sessionIds);
  const availableBytes = (dependencies.availableBytes ?? availableBytesForPath)(dirname(dbPath));
  const requiredBytes = estimatedReclaim.event_bytes + EVENT_RETENTION_DISK_RESERVE_BYTES;
  if (availableBytes < requiredBytes) {
    throw new Error(
      `event-only retention requires ${bytesToHuman(requiredBytes)} usable disk space; only ${bytesToHuman(availableBytes)} available`,
    );
  }

  const before = captureDbSnapshot(db, dbPath);
  let eventSequenceRowsDeleted = 0;
  let eventRowsDeleted = 0;

  if (sessionIds.length > 0) {
    withSessionIdCandidateTable(db, sessionIds, (tableName) => {
      db.transaction(() => {
        const preservedBefore = capturePreservationEvidence(db, tableName);
        const selectedBefore = countSelectedEventRows(db, tableName);
        db.exec(`DELETE FROM event_sequence WHERE aggregate_id IN (SELECT id FROM ${tableName})`);
        const selectedAfter = countSelectedEventRows(db, tableName);
        if (selectedAfter.event_sequence !== 0 || selectedAfter.event !== 0) {
          throw new Error("event-only retention failed to remove all selected event rows");
        }
        assertPreservationCounts(preservedBefore, capturePreservationEvidence(db, tableName));
        eventSequenceRowsDeleted = selectedBefore.event_sequence;
        eventRowsDeleted = selectedBefore.event;
      })();
    });
  }

  const vacuumErrors: string[] = [];
  const checkpoint = dependencies.walCheckpoint ?? walCheckpointTruncate;
  const runCheckpoint = (label: string): void => {
    try {
      const result = checkpoint(db);
      if (result.busy !== 0) {
        throw new Error(`busy=${result.busy}`);
      }
    } catch (error) {
      vacuumErrors.push(`${label} checkpoint: ${formatErrorMessage(error)}`);
    }
  };
  runCheckpoint("initial");
  try {
    db.exec("PRAGMA incremental_vacuum");
  } catch (error) {
    vacuumErrors.push(`incremental_vacuum: ${formatErrorMessage(error)}`);
  }
  runCheckpoint("final");

  const after = captureDbSnapshot(db, dbPath);

  const fileSizeDelta = Math.max(0, before.file_size_bytes - after.file_size_bytes);
  const result: EventPruneResult = {
    mode: "event-only",
    selected_tree_count: selectedTreeCount,
    selected_session_count: sessionIds.length,
    event_sequence_rows_deleted: eventSequenceRowsDeleted,
    event_rows_deleted: eventRowsDeleted,
    estimated_reclaim: estimatedReclaim,
    before,
    after,
    file_size_delta_bytes: fileSizeDelta,
    file_size_delta_human: bytesToHuman(fileSizeDelta),
  };
  if (vacuumErrors.length > 0) result.vacuum_error = vacuumErrors.join("; ");
  return result;
}

/**
 * Classify a pgrep exit code into a process-check result.
 * Exported for unit testing.
 *   0  → pgrep found matches (processes exist)
 *   1  → pgrep found no matches (safe)
 *   other → pgrep itself failed / unavailable (treat as UNSAFE)
 */
export function classifyPgrepExitCode(exitCode: number | null): "has_procs" | "no_procs" | "error" {
  if (exitCode === 0) return "has_procs";
  if (exitCode === 1) return "no_procs";
  return "error";
}

export type ProcessCheckDependencies = {
  ownPid?: number;
  spawnSync?: (args: string[]) => { exitCode: number | null; stdout?: unknown };
};

export function checkForOtherOpencodeProcesses(
  dependencies: ProcessCheckDependencies = {},
): { safe: boolean; count: number; pids: number[] } {
  const spawnSync = dependencies.spawnSync ?? ((args: string[]) => Bun.spawnSync(args));
  const result = spawnSync(["pgrep", "-f", "opencode"]);
  const classification = classifyPgrepExitCode(result.exitCode);

  if (classification === "error") {
    // pgrep unavailable or crashed — cannot verify safety, refuse to proceed
    return { safe: false, count: -1, pids: [] };
  }

  if (classification === "no_procs") {
    return { safe: true, count: 0, pids: [] };
  }

  const output = result.stdout instanceof Buffer
    ? result.stdout.toString("utf8")
    : String(result.stdout ?? "");

  const ownPid = dependencies.ownPid ?? process.pid;
  const pids = output
    .split("\n")
    .map((line) => parseInt(line.trim(), 10))
    .filter((pid) => !isNaN(pid) && pid !== ownPid);

  return { safe: pids.length === 0, count: pids.length, pids };
}

// ─── Safety Gate Helpers ──────────────────────────────────────────────────────

/**
 * Returns a refused SectionResultData if other OpenCode processes are running,
 * or null if it is safe to proceed with a destructive DB operation.
 */
function refuseIfOtherOpencodeProcesses(): SectionResultData | null {
  const procCheck = checkForOtherOpencodeProcesses();
  if (!procCheck.safe) {
    const reason = procCheck.count === -1
      ? "Could not verify other OpenCode processes are stopped (pgrep unavailable); refusing to run this destructive operation. Re-run where process detection works."
      : `Found ${procCheck.count} other opencode process(es) running (PIDs: ${procCheck.pids.join(", ")}). Close all OpenCode instances and re-run.`;
    return {
      refused: true,
      reason,
      instruction: "Close all OpenCode instances and re-run.",
    };
  }
  return null;
}

/**
 * Returns a refused SectionResultData if there is insufficient disk space for
 * a VACUUM operation (~1.1x the DB file size), or null if it is safe to proceed.
 * Best-effort: if df fails, returns null (let VACUUM itself be the real guard).
 */
function refuseIfInsufficientDiskForVacuum(dbPath: string): SectionResultData | null {
  const dbSize = safeStatSize(dbPath);
  if (dbSize > 0) {
    try {
      // -P forces POSIX output: one data line per filesystem, never wrapped
      // (plain `df -k` can split a long device name across two lines).
      const dfResult = Bun.spawnSync(["df", "-kP", dirname(dbPath)]);
      if (dfResult.exitCode === 0) {
        const dfOut = dfResult.stdout instanceof Buffer
          ? dfResult.stdout.toString("utf8")
          : String(dfResult.stdout ?? "");
        // POSIX `df -kP` data line, both macOS and Linux:
        //   Filesystem  1024-blocks  Used  Available  Capacity  Mounted-on
        // Columns are fixed: Available is index 3, Mounted-on is the last field.
        const lines = dfOut.trim().split("\n");
        const dataLine = lines[lines.length - 1];
        const cols = dataLine.trim().split(/\s+/);
        // Anchor from the end (Mounted-on is last) so a space in the mount path
        // can't shift the Available column: Available is 4th from the path,
        // i.e. cols[length-3] in POSIX layout. Fall back to index 3.
        const availableRaw = cols.length >= 6 ? cols[cols.length - 3] : cols[3];
        const availableKb = parseInt(availableRaw ?? "", 10);
        if (!isNaN(availableKb)) {
          const availableBytes = availableKb * 1024;
          const requiredBytes = dbSize * 1.1;
          if (availableBytes < requiredBytes) {
            return {
              refused: true,
              reason: `VACUUM needs ~${bytesToHuman(Math.ceil(requiredBytes))} free; only ${bytesToHuman(availableBytes)} available. Free disk space and re-run.`,
            };
          }
        }
      }
    } catch {
      // If df fails, proceed — disk check is best-effort; the real guard is VACUUM itself.
    }
  }
  return null;
}

// ─── Incremental Vacuum Helpers ───────────────────────────────────────────────

/**
 * Maps a SQLite auto_vacuum PRAGMA integer to its mode name.
 * Exported for unit testing.
 */
export function autoVacuumModeName(n: number): "NONE" | "FULL" | "INCREMENTAL" | "UNKNOWN" {
  if (n === 0) return "NONE";
  if (n === 1) return "FULL";
  if (n === 2) return "INCREMENTAL";
  return "UNKNOWN";
}

export type IncrementalVacuumResult = {
  already_incremental: boolean;
  before: {
    auto_vacuum: number;
    auto_vacuum_mode: string;
    file_size_bytes: number;
    file_size_human: string;
    freelist_count: number;
  };
  after: {
    auto_vacuum: number;
    auto_vacuum_mode: string;
    file_size_bytes: number;
    file_size_human: string;
    freelist_count: number;
  };
  bytes_reclaimed: number;
  bytes_reclaimed_human: string;
  confirmed: boolean;
  vacuum_error?: string;
};

export function convertToIncrementalVacuum(db: Database, dbPath: string): IncrementalVacuumResult {
  type PragmaRow = { [key: string]: unknown };

  const beforeAutoVacuumRow = db.query<PragmaRow, []>("PRAGMA auto_vacuum").get();
  const beforeAutoVacuum = Number(beforeAutoVacuumRow?.auto_vacuum ?? 0);
  const beforeFreelistRow = db.query<PragmaRow, []>("PRAGMA freelist_count").get();
  const beforeFreelist = Number(beforeFreelistRow?.freelist_count ?? 0);
  const beforeFileSize = safeStatSize(dbPath);

  const before = {
    auto_vacuum: beforeAutoVacuum,
    auto_vacuum_mode: autoVacuumModeName(beforeAutoVacuum),
    file_size_bytes: beforeFileSize,
    file_size_human: bytesToHuman(beforeFileSize),
    freelist_count: beforeFreelist,
  };

  // Whether the DB was already INCREMENTAL before we touched it.
  // NOTE: even if already INCREMENTAL, we still run a full VACUUM to guarantee
  // the on-disk layout is correct — a previous run may have set the PRAGMA but
  // failed before VACUUM completed, leaving the file in a half-converted state.
  const alreadyIncremental = beforeAutoVacuum === 2;

  let vacuumError: string | undefined;

  // Always set PRAGMA auto_vacuum=INCREMENTAL (no-op if already set).
  // Then always run a full VACUUM — this is the operation that actually rewrites
  // the file with the new mode and reclaims free pages.
  // A WAL checkpoint is run first so WAL pages are folded in (reduces peak disk).
  // Checkpoint failure is non-fatal; VACUUM is the real operation.
  try {
    db.exec("PRAGMA auto_vacuum=INCREMENTAL");
  } catch (err) {
    vacuumError = formatErrorMessage(err);
  }

  if (vacuumError == null) {
    try {
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch {
      // Checkpoint failure is non-fatal — proceed to VACUUM.
    }
    try {
      db.exec("VACUUM");
    } catch (err) {
      vacuumError = formatErrorMessage(err);
    }
  }

  const afterAutoVacuumRow = db.query<PragmaRow, []>("PRAGMA auto_vacuum").get();
  const afterAutoVacuum = Number(afterAutoVacuumRow?.auto_vacuum ?? 0);
  const afterFreelistRow = db.query<PragmaRow, []>("PRAGMA freelist_count").get();
  const afterFreelist = Number(afterFreelistRow?.freelist_count ?? 0);
  const afterFileSize = safeStatSize(dbPath);

  const after = {
    auto_vacuum: afterAutoVacuum,
    auto_vacuum_mode: autoVacuumModeName(afterAutoVacuum),
    file_size_bytes: afterFileSize,
    file_size_human: bytesToHuman(afterFileSize),
    freelist_count: afterFreelist,
  };

  // confirmed is only true when the mode is INCREMENTAL AND the full VACUUM
  // completed without error (VACUUM is what actually rewrites the file).
  const confirmed = afterAutoVacuum === 2 && vacuumError == null;

  const result: IncrementalVacuumResult = {
    already_incremental: alreadyIncremental,
    before,
    after,
    bytes_reclaimed: Math.max(0, beforeFileSize - afterFileSize),
    bytes_reclaimed_human: bytesToHuman(Math.max(0, beforeFileSize - afterFileSize)),
    confirmed,
  };
  if (vacuumError != null) result.vacuum_error = vacuumError;
  return result;
}

// ─── DB Section Runners ───────────────────────────────────────────────────────

async function runDbHealth(options: CliOptions): Promise<SectionResult> {
  let db: Database | null = null;
  try {
    const uri = "file:" + options.dbPath + "?mode=ro";
    db = new Database(uri, { readonly: true });
    db.exec("PRAGMA busy_timeout=5000");

    const data = await withSqliteBusyRetry(() => computeDbHealth(db!, options.dbPath));
    return { label: "DB Health", data };
  } catch (error) {
    return { label: "DB Health", data: null, error: formatErrorMessage(error) };
  } finally {
    db?.close();
  }
}

async function runDbPruneDryRun(options: CliOptions): Promise<SectionResult> {
  const days = options.pruneOlderDays ?? DEFAULT_PRUNE_DAYS;
  const cutoffMs = Date.now() - days * 24 * 3600 * 1000;
  const cutoffDate = new Date(cutoffMs).toISOString().slice(0, 10);

  let db: Database | null = null;
  try {
    const uri = "file:" + options.dbPath + "?mode=ro";
    db = new Database(uri, { readonly: true });
    db.exec("PRAGMA busy_timeout=5000");

    const sessionIds = await withSqliteBusyRetry(() => selectOldSessionIds(db!, cutoffMs));
    const reclaim = await withSqliteBusyRetry(() => estimateReclaim(db!, sessionIds));

    const data = {
      cutoff_date: cutoffDate,
      prune_older_than_days: days,
      sessions_to_delete: sessionIds.length,
      reclaimable_estimate: reclaim,
      notice: "DRY RUN — no changes. Re-run with --execute to delete.",
    };

    return { label: "DB Prune (dry-run)", data };
  } catch (error) {
    return { label: "DB Prune (dry-run)", data: null, error: formatErrorMessage(error) };
  } finally {
    db?.close();
  }
}

async function runDbPruneExecute(options: CliOptions): Promise<SectionResult> {
  const days = options.pruneOlderDays ?? DEFAULT_PRUNE_DAYS;

  // Defense-in-depth: hard-refuse if pruneOlderDays < 1 even if parseArgs let it through.
  if (days < 1) {
    const data = {
      refused: true,
      reason: `--prune-older must be >= 1 day (got ${days}). Refusing to prevent mass deletion.`,
    };
    return { label: "DB Prune (refused)", data };
  }

  const cutoffMs = Date.now() - days * 24 * 3600 * 1000;
  const cutoffDate = new Date(cutoffMs).toISOString().slice(0, 10);

  // Safety gate: check for other opencode processes
  const procRefusal = refuseIfOtherOpencodeProcesses();
  if (procRefusal != null) {
    return { label: "DB Prune (refused)", data: procRefusal };
  }

  // Disk-space pre-check: VACUUM needs ~= DB size of free space for a temp copy.
  // Check BEFORE any destructive operation so we never delete-then-fail-vacuum.
  const diskRefusal = refuseIfInsufficientDiskForVacuum(options.dbPath);
  if (diskRefusal != null) {
    return { label: "DB Prune (refused)", data: diskRefusal };
  }

  let db: Database | null = null;
  try {
    db = new Database(options.dbPath);
    db.exec("PRAGMA busy_timeout=5000");
    db.exec("PRAGMA foreign_keys=ON");

    const sessionIds = selectOldSessionIds(db, cutoffMs);

    const result = pruneSessions(db, sessionIds, options.dbPath);

    const data = {
      cutoff_date: cutoffDate,
      prune_older_than_days: days,
      ...result,
    };

    return { label: "DB Prune (executed)", data };
  } catch (error) {
    return { label: "DB Prune (executed)", data: null, error: formatErrorMessage(error) };
  } finally {
    db?.close();
  }
}

function eventRetentionDaysOrRefusal(days: number | null): SectionResult | null {
  if (days == null || Number.isFinite(days) && days >= 1) return null;
  return {
    label: "DB Event Prune (refused)",
    data: {
      mode: "event-only",
      refused: true,
      reason: `--prune-events-older must be >= 1 day (got ${String(days)}).`,
    },
  };
}

async function runDbEventPruneDryRun(options: CliOptions): Promise<SectionResult> {
  const invalid = eventRetentionDaysOrRefusal(options.pruneEventsOlderDays);
  if (invalid != null) return invalid;

  const days = options.pruneEventsOlderDays as number;
  const cutoffMs = Date.now() - days * 24 * 3600 * 1000;
  const cutoffDate = new Date(cutoffMs).toISOString().slice(0, 10);
  let db: Database | null = null;
  try {
    const uri = "file:" + options.dbPath + "?mode=ro";
    db = new Database(uri, { readonly: true });
    db.exec("PRAGMA busy_timeout=5000");

    const sessionIds = await withSqliteBusyRetry(() => selectOldSessionIds(db!, cutoffMs));
    const reclaim = await withSqliteBusyRetry(() => estimateReclaim(db!, sessionIds));
    const selectedTreeCount = countSessionTrees(db, sessionIds);
    const autoVacuum = Number(db.query<{ auto_vacuum?: unknown }, []>("PRAGMA auto_vacuum").get()?.auto_vacuum ?? 0);

    return {
      label: "DB Event Prune (dry-run)",
      data: {
        mode: "event-only",
        cutoff_date: cutoffDate,
        prune_events_older_than_days: days,
        selected_tree_count: selectedTreeCount,
        selected_session_count: sessionIds.length,
        deleted_event_rows: 0,
        deleted_event_sequence_rows: 0,
        estimated_event_bytes: reclaim.event_bytes,
        estimated_file_size_delta_bytes: reclaim.event_bytes,
        reclaimed_file_size_delta_bytes: 0,
        reclaimable_estimate: reclaim,
        auto_vacuum: autoVacuum,
        notice: "DRY RUN — no changes. Re-run with --execute to delete event rows only.",
      },
    };
  } catch (error) {
    return { label: "DB Event Prune (dry-run)", data: null, error: formatErrorMessage(error) };
  } finally {
    db?.close();
  }
}

async function runDbEventPruneExecute(options: CliOptions): Promise<SectionResult> {
  const invalid = eventRetentionDaysOrRefusal(options.pruneEventsOlderDays);
  if (invalid != null) return invalid;

  const days = options.pruneEventsOlderDays as number;
  const cutoffMs = Date.now() - days * 24 * 3600 * 1000;
  const cutoffDate = new Date(cutoffMs).toISOString().slice(0, 10);
  const procRefusal = refuseIfOtherOpencodeProcesses();
  if (procRefusal != null) {
    return {
      label: "DB Event Prune (refused)",
      data: { mode: "event-only", ...procRefusal },
    };
  }

  let db: Database | null = null;
  try {
    db = new Database(options.dbPath);
    db.exec("PRAGMA busy_timeout=5000");
    db.exec("PRAGMA foreign_keys=ON");
    const sessionIds = await withSqliteBusyRetry(() => selectOldSessionIds(db!, cutoffMs));
    const result = pruneEvents(db, sessionIds, options.dbPath);
    const data = {
      cutoff_date: cutoffDate,
      prune_events_older_than_days: days,
      estimated_event_bytes: result.estimated_reclaim.event_bytes,
      estimated_file_size_delta_bytes: result.estimated_reclaim.event_bytes,
      reclaimed_file_size_delta_bytes: result.file_size_delta_bytes,
      ...result,
    };
    return {
      label: result.vacuum_error == null ? "DB Event Prune (executed)" : "DB Event Prune (failed)",
      data,
    };
  } catch (error) {
    return {
      label: "DB Event Prune (refused)",
      data: {
        mode: "event-only",
        refused: true,
        reason: formatErrorMessage(error),
      },
    };
  } finally {
    db?.close();
  }
}

async function runSetIncrementalVacuum(options: CliOptions): Promise<SectionResult> {
  const label = "DB Set Incremental Vacuum";

  // Safety gate: check for other opencode processes
  const procRefusal = refuseIfOtherOpencodeProcesses();
  if (procRefusal != null) {
    return { label: `${label} (refused)`, data: procRefusal };
  }

  // Disk-space pre-check: VACUUM needs ~= DB size of free space for a temp copy.
  const diskRefusal = refuseIfInsufficientDiskForVacuum(options.dbPath);
  if (diskRefusal != null) {
    return { label: `${label} (refused)`, data: diskRefusal };
  }

  let db: Database | null = null;
  try {
    db = new Database(options.dbPath);
    db.exec("PRAGMA busy_timeout=5000");

    const result = convertToIncrementalVacuum(db, options.dbPath);

    const resultLabel = result.vacuum_error != null
      ? `${label} (failed)`
      : result.already_incremental
        ? `${label} (already incremental)`
        : `${label} (executed)`;

    return { label: resultLabel, data: result };
  } catch (error) {
    return { label: `${label} (failed)`, data: null, error: formatErrorMessage(error) };
  } finally {
    db?.close();
  }
}

// ─── Server / Section Collection ─────────────────────────────────────────────

async function spawnOpencodeServer(
  hostname: string,
  port: number,
  timeoutMs = 10000
): Promise<{ proc: ChildProcess; url: string }> {
  const proc = spawn("opencode", ["serve", `--hostname=${hostname}`, `--port=${port}`], {
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  const url = await new Promise<string>((resolve, reject) => {
    const id = setTimeout(() => {
      killProcessGroup(proc);
      reject(new Error(`Timeout waiting for server to start after ${timeoutMs}ms`));
    }, timeoutMs);

    let output = "";

    proc.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      for (const line of output.split("\n")) {
        if (line.startsWith("opencode server listening")) {
          const match = line.match(/on\s+(https?:\/\/[^\s]+)/);
          if (match) {
            clearTimeout(id);
            resolve(match[1]);
            return;
          }
        }
      }
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    proc.on("exit", (code) => {
      clearTimeout(id);
      reject(new Error(`Server exited with code ${code}. Output: ${output}`));
    });

    proc.on("error", (error) => {
      clearTimeout(id);
      reject(error);
    });
  });

  return { proc, url };
}

function killProcessGroup(proc: ChildProcess): void {
  const pid = proc.pid;
  if (pid == null || proc.killed) {
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    proc.kill("SIGTERM");
  }
}

async function waitForExit(proc: ChildProcess, timeoutMs = 8000): Promise<void> {
  const pid = proc.pid;
  if (pid == null || proc.exitCode != null) {
    return;
  }

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    proc.kill("SIGKILL");
  }
}

async function startOpencode(options: CliOptions): Promise<{
  client: ReturnType<typeof createOpencodeClient>;
  proc?: ChildProcess;
  url: string;
  port: number;
  mode: "existing" | "spawned";
}> {
  const baseUrl = `http://${options.host}:${options.port}`;

  if (options.portProvided) {
    try {
      const response = await fetch(`${baseUrl}/global/health`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const client = createOpencodeClient({ baseUrl, directory: options.directory });
      return { client, url: baseUrl, port: options.port, mode: "existing" };
    } catch (error) {
      throw new Error(`Failed to connect to opencode at ${baseUrl}: ${formatErrorMessage(error)}`);
    }
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < AUTO_PORT_ATTEMPTS; attempt += 1) {
    const port = options.port + attempt;
    try {
      const { proc, url } = await spawnOpencodeServer(options.host, port);
      const client = createOpencodeClient({ baseUrl: url, directory: options.directory });
      return { client, proc, url, port, mode: "spawned" };
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`Failed to start opencode server: ${formatErrorMessage(lastError)}`);
}

async function collectSections(options: CliOptions): Promise<SectionResult[]> {
  process.chdir(options.directory);
  const { client, proc, url, port, mode } = await startOpencode(options);

  const results: SectionResult[] = [];
  let hasClosed = false;

  const cleanup = async (): Promise<void> => {
    if (hasClosed) {
      return;
    }
    hasClosed = true;
    if (mode === "spawned" && proc != null) {
      killProcessGroup(proc);
      await waitForExit(proc);
    }
  };

  process.on("SIGINT", () => {
    void cleanup().finally(() => process.exit(130));
  });

  process.on("SIGTERM", () => {
    void cleanup().finally(() => process.exit(143));
  });

  process.on("exit", () => {
    if (mode === "spawned" && proc != null && !hasClosed) {
      hasClosed = true;
      killProcessGroup(proc);
    }
  });

  process.on("uncaughtException", (error) => {
    void cleanup().finally(() => {
      console.error(`OpenCode doctor failed: ${formatErrorMessage(error)}`);
      process.exit(1);
    });
  });

  process.on("unhandledRejection", (error) => {
    void cleanup().finally(() => {
      console.error(`OpenCode doctor failed: ${formatErrorMessage(error)}`);
      process.exit(1);
    });
  });

  try {
    if (shouldInclude(options, "server")) {
      results.push({ label: "Server", data: { url, port, mode } });
    }

    if (shouldInclude(options, "health")) {
      const startTime = Date.now();
      try {
        const response = await fetch(`${url}/global/health`);
        const health = (await response.json()) as { healthy: boolean; version: string };
        results.push({
          label: "Health",
          data: { ...health, latencyMs: Date.now() - startTime },
        });
      } catch (error) {
        results.push({
          label: "Health",
          data: { healthy: false, error: formatErrorMessage(error) },
        });
      }
    }

    let configData: unknown;
    const needsConfig =
      shouldInclude(options, "config") ||
      shouldInclude(options, "providers") ||
      shouldInclude(options, "tools") ||
      shouldInclude(options, "tool-ids");

    if (needsConfig) {
      const configResponse = await client.config.get();
      const extracted = extractData(configResponse);
      configData = extracted.data;

      if (shouldInclude(options, "config")) {
        results.push({ label: "Config", data: configResponse });
      }
    }

    if (shouldInclude(options, "providers")) {
      results.push({
        label: "Providers",
        data: await client.config.providers(),
      });
    }

    if (shouldInclude(options, "project")) {
      results.push({
        label: "Project",
        data: await client.project.current(),
      });
    }

    if (shouldInclude(options, "projects")) {
      results.push({
        label: "Projects",
        data: await client.project.list(),
      });
    }

    if (shouldInclude(options, "path")) {
      results.push({ label: "Path", data: await client.path.get() });
    }

    if (shouldInclude(options, "vcs")) {
      results.push({ label: "VCS", data: await client.vcs.get() });
    }

    if (shouldInclude(options, "agents")) {
      results.push({ label: "Agents", data: await client.app.agents() });
    }

    if (shouldInclude(options, "commands")) {
      results.push({
        label: "Commands",
        data: await client.command.list(),
      });
    }

    if (shouldInclude(options, "tool-ids")) {
      results.push({ label: "Tool IDs", data: await client.tool.ids() });
    }

    if (shouldInclude(options, "tools")) {
      const configModel = isPlainObject(configData) ? (configData as { model?: unknown }).model : undefined;
      const { provider, model } = parseModelString(configModel);
      const toolsProvider = options.toolsProvider ?? provider;
      const toolsModel = options.toolsModel ?? model;

      if (toolsProvider == null || toolsModel == null) {
        results.push({
          label: "Tools",
          data: {
            warning: "No model/provider available. Use --tools-provider and --tools-model to fetch schemas.",
          },
        });
      } else {
        results.push({
          label: "Tools",
          data: await client.tool.list({
            query: {
              provider: toolsProvider,
              model: toolsModel,
            },
          }),
        });
      }
    }

    if (shouldInclude(options, "mcp")) {
      results.push({ label: "MCP", data: await client.mcp.status() });
    }

    if (shouldInclude(options, "lsp")) {
      results.push({ label: "LSP", data: await client.lsp.status() });
    }

    if (shouldInclude(options, "formatter")) {
      results.push({
        label: "Formatter",
        data: await client.formatter.status(),
      });
    }

    if (shouldInclude(options, "sessions")) {
      results.push({
        label: "Sessions",
        data: await client.session.list(),
      });
    }

    if (shouldInclude(options, "session-status")) {
      results.push({
        label: "Session Status",
        data: await client.session.status(),
      });
    }

    return results;
  } finally {
    await cleanup();
  }
}

function renderSection(section: SectionResult, options: CliOptions): string {
  const extracted = extractData(section.data);
  if (extracted.error != null) {
    return `${formatHeader(section.label, options)}\n${formatError(extracted.error, options)}`;
  }

  const output = options.full ? extracted.data : summarize(extracted.data, options.limit);
  return `${formatHeader(section.label, options)}\n${formatValue(output, options)}`;
}

function summarize(value: unknown, limit: number): unknown {
  if (Array.isArray(value)) {
    return value.slice(0, limit);
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length <= limit) {
      return value;
    }

    return Object.fromEntries(entries.slice(0, limit));
  }

  return value;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  // DB-only path: if any db flag is present, skip server entirely.
  // Also route here if --execute is set alone (to give a clear error).
  const isDbMode =
    options.dbHealth ||
    options.pruneOlderDays != null ||
    options.pruneEventsOlderDays != null ||
    options.execute ||
    options.setIncrementalVacuum;

  if (isDbMode) {
    // Guard: --execute without either prune mode is a user error.
    if (options.execute && options.pruneOlderDays == null && options.pruneEventsOlderDays == null) {
      console.error("Error: --execute requires --prune-older=<days> or --prune-events-older=<days>");
      process.exit(1);
    }

    const sections: SectionResult[] = [];
    let hasError = false;

    if (options.dbHealth) {
      const result = await runDbHealth(options);
      sections.push(result);
      if (result.error != null) hasError = true;
    }

    if (options.pruneOlderDays != null && options.pruneEventsOlderDays != null) {
      sections.push({
        label: "DB Event Prune (refused)",
        data: {
          mode: "event-only",
          refused: true,
          reason: "--prune-events-older and --prune-older are mutually exclusive",
        },
      });
      hasError = true;
    } else if (options.pruneOlderDays != null) {
      if (options.execute) {
        const result = await runDbPruneExecute(options);
        sections.push(result);
        // Exit nonzero if refused or errored
        if (isPlainObject(result.data) && (result.data as { refused?: boolean }).refused) {
          hasError = true;
        }
        if (result.error != null) hasError = true;
      } else {
        const result = await runDbPruneDryRun(options);
        sections.push(result);
        if (result.error != null) hasError = true;
      }
    }

    if (options.pruneEventsOlderDays != null && options.pruneOlderDays == null) {
      const result = options.execute
        ? await runDbEventPruneExecute(options)
        : await runDbEventPruneDryRun(options);
      sections.push(result);
      if (result.error != null) hasError = true;
      if (isPlainObject(result.data) && (result.data as { refused?: boolean }).refused) {
        hasError = true;
      }
      if (isPlainObject(result.data) && (result.data as { vacuum_error?: unknown }).vacuum_error != null) {
        hasError = true;
      }
    }

    if (options.setIncrementalVacuum) {
      const result = await runSetIncrementalVacuum(options);
      sections.push(result);
      // Exit nonzero if refused, errored, or VACUUM failed (vacuum_error set or confirmed===false on executed path)
      if (isPlainObject(result.data) && (result.data as { refused?: boolean }).refused) {
        hasError = true;
      }
      if (result.error != null) hasError = true;
      if (isPlainObject(result.data) && result.data.vacuum_error != null) {
        hasError = true;
      }
      if (isPlainObject(result.data) && result.data.confirmed === false) {
        hasError = true;
      }
    }

    const output = options.format === "json"
      ? JSON.stringify(redactSecrets(sections.map((section) => ({
          label: section.label,
          ...extractData(section.data),
        }))), null, 2)
      : sections.map((section) => renderSection(section, options)).join("\n");

    console.log(output);
    process.exit(hasError ? 1 : 0);
  }

  const sections = await collectSections(options);
  const output = options.format === "json"
    ? JSON.stringify(redactSecrets(sections.map((section) => ({
        label: section.label,
        ...extractData(section.data),
      }))), null, 2)
    : sections.map((section) => renderSection(section, options)).join("\n");

  console.log(output);
  process.exit(0);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`OpenCode doctor failed: ${message}`);
  process.exit(1);
});
