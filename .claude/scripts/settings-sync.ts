#!/usr/bin/env bun
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

// ─── Types ──────────────────────────────────────────────────────────────────

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type ChangeKind = "added" | "changed" | "array-added";

export type Change = {
  path: string;
  kind: ChangeKind;
  count?: number; // present for kind === "array-added": number of new elements
};

export type MergeResult = {
  merged: JsonObject;
  changes: Change[];
};

export type CliOptions = {
  templatePath: string;
  targetPath: string;
  check: boolean;
  dryRun: boolean;
  json: boolean;
  help: boolean;
};

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_TEMPLATE_PATH = join(homedir(), ".claude", "settings.template.json");
const DEFAULT_TARGET_PATH = join(homedir(), ".claude", "settings.json");

// ─── Merge ────────────────────────────────────────────────────────────────────

export function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Union two arrays, target entries first (order preserved), then template
 * entries not already present. Primitives dedup by strict equality; objects
 * and nested arrays dedup by JSON serialization.
 */
export function unionArrays(targetArr: JsonValue[], templateArr: JsonValue[]): JsonValue[] {
  const seenPrimitives = new Set<JsonValue>();
  const seenSerialized = new Set<string>();
  const result: JsonValue[] = [];

  const add = (item: JsonValue): void => {
    if (isPlainObject(item) || Array.isArray(item)) {
      const key = JSON.stringify(item);
      if (seenSerialized.has(key)) return;
      seenSerialized.add(key);
      result.push(item);
    } else {
      if (seenPrimitives.has(item)) return;
      seenPrimitives.add(item);
      result.push(item);
    }
  };

  for (const item of targetArr) add(item);
  for (const item of templateArr) add(item);
  return result;
}

/**
 * Deep-merge template into target with these semantics:
 * - plain objects merge recursively
 * - arrays union (target order first, then new template entries), deduped
 * - scalars and type mismatches: template wins
 * - keys present only in target are preserved
 */
export function mergeValue(templateVal: JsonValue, targetVal: JsonValue): JsonValue {
  if (Array.isArray(templateVal) && Array.isArray(targetVal)) {
    return unionArrays(targetVal, templateVal);
  }
  if (isPlainObject(templateVal) && isPlainObject(targetVal)) {
    return mergeObjects(templateVal, targetVal);
  }
  // scalars, type mismatches, or one side isn't an object/array — template wins
  return templateVal;
}

export function mergeObjects(template: JsonObject, target: JsonObject): JsonObject {
  const result: JsonObject = {};

  for (const key of Object.keys(target)) {
    result[key] = key in template ? mergeValue(template[key], target[key]) : target[key];
  }
  for (const key of Object.keys(template)) {
    if (!(key in result)) result[key] = template[key];
  }

  return result;
}

/** Diff `after` (merged result) against `before` (original target, {} if missing). */
export function diffObjects(before: JsonObject, after: JsonObject, pathPrefix = ""): Change[] {
  const changes: Change[] = [];

  for (const key of Object.keys(after)) {
    const path = pathPrefix ? `${pathPrefix}.${key}` : key;

    if (!(key in before)) {
      changes.push({ path, kind: "added" });
      continue;
    }

    const b = before[key];
    const a = after[key];

    if (Array.isArray(a) && Array.isArray(b)) {
      const addedCount = a.length - b.length;
      if (addedCount > 0) changes.push({ path, kind: "array-added", count: addedCount });
      continue;
    }

    if (isPlainObject(a) && isPlainObject(b)) {
      changes.push(...diffObjects(b, a, path));
      continue;
    }

    if (JSON.stringify(a) !== JSON.stringify(b)) {
      changes.push({ path, kind: "changed" });
    }
  }

  return changes;
}

export function mergeTemplateIntoTarget(template: JsonObject, target: JsonObject | null): MergeResult {
  const before = target ?? {};
  const merged = mergeObjects(template, before);
  const changes = diffObjects(before, merged);
  return { merged, changes };
}

// ─── File I/O ─────────────────────────────────────────────────────────────────

export class SettingsParseError extends Error {}

function readJsonObject(path: string, label: string): JsonObject {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    throw new SettingsParseError(`Failed to read ${label} at ${path}: ${formatErrorMessage(err)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new SettingsParseError(`Failed to parse ${label} JSON at ${path}: ${formatErrorMessage(err)}`);
  }
  if (!isPlainObject(parsed)) {
    throw new SettingsParseError(`${label} at ${path} is not a JSON object`);
  }
  return parsed;
}

function writeJsonObject(path: string, obj: JsonObject): void {
  writeFileSync(path, `${JSON.stringify(obj, null, 2)}\n`);
}

function backupTarget(targetPath: string): string {
  const backupDir = join(dirname(targetPath), "backups");
  mkdirSync(backupDir, { recursive: true });
  const backupPath = join(backupDir, `settings.json.${Date.now()}.bak`);
  copyFileSync(targetPath, backupPath);
  return backupPath;
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ─── CLI: Flag Parsing ──────────────────────────────────────────────────────────

const KNOWN_FLAGS = new Set(["--template", "--target", "--check", "--dry-run", "--json", "--help", "-h"]);

function warnUnknownFlag(flag: string): void {
  console.warn(`Warning: Unknown flag "${flag}" ignored`);
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

    if (arg === "--check" || arg === "--dry-run" || arg === "--json") {
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

  const templateValue = args.get("--template");
  const targetValue = args.get("--target");

  return {
    templatePath: templateValue != null && templateValue !== true ? String(templateValue) : DEFAULT_TEMPLATE_PATH,
    targetPath: targetValue != null && targetValue !== true ? String(targetValue) : DEFAULT_TARGET_PATH,
    check: args.get("--check") === true,
    dryRun: args.get("--dry-run") === true,
    json: args.get("--json") === true,
    help: args.get("--help") === true,
  };
}

// ─── CLI: Output ──────────────────────────────────────────────────────────────

const USAGE = `settings-sync — sync the tracked Claude settings template into the local settings file.

USAGE:
  settings-sync.ts [OPTIONS]
  mise run claude:settings -- [OPTIONS]   # note: -- separator forwards flags through mise

OPTIONS:
  -h, --help              Show this message.
  --template <path>       Template path. Default: ~/.claude/settings.template.json
  --target <path>         Target path. Default: ~/.claude/settings.json
  --check                 Report drift and exit 1 if out of sync. Never writes.
  --dry-run               Print the merge summary and exit 0. Never writes.
  --json                  Machine-readable output.

MERGE SEMANTICS:
  Plain objects merge recursively. Arrays union (target order first, then new
  template entries), deduped. Scalars and type mismatches: template wins.
  Keys present only in the target are preserved.

EXIT CODES:
  0   Applied / dry-run completed / check reports in-sync.
  1   Check reports drift, or a real error (missing/malformed file).

EXAMPLES:
  settings-sync.ts                 # apply the merge
  settings-sync.ts --check         # report drift only
  settings-sync.ts --dry-run
`;

function describeChange(c: Change): string {
  if (c.kind === "added") return `Added: ${c.path}`;
  if (c.kind === "changed") return `Changed: ${c.path}`;
  return `Array union: ${c.path} (+${c.count})`;
}

function renderChanges(changes: Change[]): void {
  if (changes.length === 0) {
    console.log("No changes.");
    return;
  }
  for (const c of changes) console.log(describeChange(c));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(USAGE);
    return 0;
  }

  let template: JsonObject;
  try {
    template = readJsonObject(options.templatePath, "template");
  } catch (err) {
    const message = formatErrorMessage(err);
    if (options.json) {
      console.log(JSON.stringify([{ label: "settings-sync", error: message }], null, 2));
    } else {
      console.error(`Error: ${message}`);
    }
    return 1;
  }

  const targetExists = existsSync(options.targetPath);
  let target: JsonObject | null = null;
  if (targetExists) {
    try {
      target = readJsonObject(options.targetPath, "target");
    } catch (err) {
      const message = formatErrorMessage(err);
      if (options.json) {
        console.log(JSON.stringify([{ label: "settings-sync", error: message }], null, 2));
      } else {
        console.error(`Error: ${message}`);
      }
      return 1;
    }
  }

  const { merged, changes } = mergeTemplateIntoTarget(template, target);
  const inSync = changes.length === 0 && targetExists;

  if (options.check) {
    const data = {
      mode: "check" as const,
      templatePath: options.templatePath,
      targetPath: options.targetPath,
      targetExisted: targetExists,
      inSync,
      changes,
    };
    if (options.json) {
      console.log(JSON.stringify([{ label: "settings-sync-check", data }], null, 2));
    } else {
      console.log(targetExists ? (inSync ? "In sync." : "Drift detected:") : "Target does not exist:");
      if (!inSync) renderChanges(changes);
    }
    return inSync ? 0 : 1;
  }

  if (options.dryRun) {
    const data = {
      mode: "dry-run" as const,
      templatePath: options.templatePath,
      targetPath: options.targetPath,
      targetExisted: targetExists,
      changes,
    };
    if (options.json) {
      console.log(JSON.stringify([{ label: "settings-sync-dry-run", data }], null, 2));
    } else {
      console.log(targetExists ? "Dry run — would apply:" : "Dry run — target missing, would write template verbatim:");
      renderChanges(changes);
    }
    return 0;
  }

  let backupPath: string | null = null;
  if (targetExists) {
    backupPath = backupTarget(options.targetPath);
  }
  writeJsonObject(options.targetPath, merged);

  const data = {
    mode: "apply" as const,
    templatePath: options.templatePath,
    targetPath: options.targetPath,
    targetExisted: targetExists,
    backupPath,
    changes,
  };

  if (options.json) {
    console.log(JSON.stringify([{ label: "settings-sync", data }], null, 2));
  } else {
    console.log(targetExists ? "Applied:" : "Target missing — wrote template verbatim:");
    renderChanges(changes);
    if (backupPath) console.log(`Backup: ${backupPath}`);
  }

  return 0;
}

if (import.meta.main) {
  main().then((code) => process.exit(code));
}
