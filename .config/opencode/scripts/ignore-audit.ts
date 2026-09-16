#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ─── Types ──────────────────────────────────────────────────────────────────

export type DeadNegation = {
  line: number;
  text: string;
};

export type AuditResult = {
  deadRulePaths: string[]; // tracked paths still matched by the allowlist (re-add would fail)
  deadNegations: DeadNegation[]; // leading-whitespace `!` lines — literal, therefore inert
};

export type CliOptions = {
  gitDir: string;
  workTree: string;
  ignoreFile?: string;
  json: boolean;
  help: boolean;
};

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_GIT_DIR = join(homedir(), ".dotfiles");
const DEFAULT_WORK_TREE = homedir();

const KNOWN_FLAGS = new Set(["--git-dir", "--work-tree", "--ignore-file", "--json", "--help", "-h"]);

// ─── Git helpers ────────────────────────────────────────────────────────────

function runGit(gitDir: string, workTree: string, configOverrides: string[], args: string[], input?: string): { stdout: Buffer; status: number } {
  const configFlags = configOverrides.flatMap((c) => ["-c", c]);
  const result = spawnSync("git", [`--git-dir=${gitDir}`, `--work-tree=${workTree}`, ...configFlags, ...args], {
    input,
    maxBuffer: 1024 * 1024 * 64,
  });
  if (result.error) {
    throw new Error(`Failed to run git ${args.join(" ")}: ${result.error.message}`);
  }
  return { stdout: result.stdout ?? Buffer.alloc(0), status: result.status ?? 1 };
}

/**
 * Every tracked path must be re-addable through the allowlist: `git
 * check-ignore --no-index` must report "not ignored" (exit 1) for each one.
 * `--no-index` is required because gitignore rules never apply to
 * already-tracked paths through the normal index-aware path — the guard
 * would silently pass on a dead rule protecting a file that's already in the
 * index, which is exactly the case that matters.
 *
 * `-c core.excludesFile=<ignoreFilePath>` is passed explicitly rather than
 * relying on the repo's own git config: a plain CI checkout has no
 * `core.excludesFile` wired to `.dotfiles/ignore` (that's set locally by the
 * bare-repo bootstrap, not tracked), so without this override the check
 * silently finds nothing ignored and passes vacuously — a guard that can
 * never fail.
 */
export function findDeadRulePaths(gitDir: string, workTree: string, ignoreFilePath: string): string[] {
  const tracked = runGit(gitDir, workTree, [], ["ls-files", "-z"]);
  if (tracked.stdout.length === 0) return [];

  const excludesOverride = `core.excludesFile=${ignoreFilePath}`;
  const ignored = runGit(
    gitDir,
    workTree,
    [excludesOverride],
    ["check-ignore", "--no-index", "-z", "--stdin"],
    tracked.stdout.toString("utf8"),
  );
  // status 0 = at least one path ignored, 1 = none ignored, >1 = real error.
  if (ignored.status > 1) {
    throw new Error(`git check-ignore failed with status ${ignored.status}`);
  }

  return ignored.stdout
    .toString("utf8")
    .split("\0")
    .filter((p) => p.length > 0);
}

/**
 * A leading-whitespace `!` negation (` !/path`) is parsed by git as a
 * literal pattern, not a negation — it matches nothing and is dead by
 * construction. Flag it independently of whether it currently protects a
 * tracked path: it's a latent bug the moment the file it was meant to
 * protect becomes untracked.
 */
export function findDeadNegations(ignoreFileContent: string): DeadNegation[] {
  const findings: DeadNegation[] = [];
  const lines = ignoreFileContent.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (/^\s+!/.test(lines[i])) {
      findings.push({ line: i + 1, text: lines[i] });
    }
  }
  return findings;
}

export function runAudit(gitDir: string, workTree: string, ignoreFilePath: string): AuditResult {
  const deadRulePaths = findDeadRulePaths(gitDir, workTree, ignoreFilePath);
  const ignoreFileContent = readFileSync(ignoreFilePath, "utf8");
  const deadNegations = findDeadNegations(ignoreFileContent);
  return { deadRulePaths, deadNegations };
}

// ─── CLI: Flag Parsing ──────────────────────────────────────────────────────

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

  const help = args.get("--help") === true;

  const gitDirValue = args.get("--git-dir");
  const gitDir = gitDirValue != null && gitDirValue !== true ? String(gitDirValue) : DEFAULT_GIT_DIR;

  const workTreeValue = args.get("--work-tree");
  const workTree = workTreeValue != null && workTreeValue !== true ? String(workTreeValue) : DEFAULT_WORK_TREE;

  const ignoreFileValue = args.get("--ignore-file");
  const ignoreFile = ignoreFileValue != null && ignoreFileValue !== true ? String(ignoreFileValue) : undefined;

  const json = args.get("--json") === true;

  return { gitDir, workTree, ignoreFile, json, help };
}

// ─── CLI: Output ──────────────────────────────────────────────────────────

const USAGE = `ignore-audit — catch dead negations in a gitignore-style allowlist.

USAGE:
  ignore-audit.ts [OPTIONS]
  mise run ignore:audit -- [OPTIONS]   # note: -- separator forwards flags through mise

OPTIONS:
  -h, --help              Show this message.
  --git-dir <path>        Git dir of the repo to audit. Default: ~/.dotfiles
  --work-tree <path>      Work tree of the repo to audit. Default: ~
  --ignore-file <path>    Ignore file to scan for leading-whitespace negations. Default: <git-dir>/ignore
  --json                  Machine-readable output.

CHECKS:
  1. dead-rule-paths   Every tracked path must be re-addable: \`git check-ignore --no-index\`
                       must report "not ignored" for it. A path that IS ignored means a
                       negation failed to cover it — re-adding it after it's untracked
                       would silently fail.
  2. dead-negations    Lines matching /^\\s+!/ in the ignore file. Leading whitespace makes
                       git parse \`!\` as a literal character, not a negation — the rule is
                       inert. Flagged even if no tracked path is affected yet (latent bug).

EXIT CODES:
  0   No dead rules, no dead negations.
  1   At least one dead rule or dead negation found.

EXAMPLES:
  ignore-audit.ts
  ignore-audit.ts --git-dir ~/.dotfiles --work-tree ~
  ignore-audit.ts --json
`;

function renderText(result: AuditResult): void {
  if (result.deadRulePaths.length === 0 && result.deadNegations.length === 0) {
    console.log("OK: no dead rules, no dead negations.");
    return;
  }

  if (result.deadRulePaths.length > 0) {
    console.log(`DEAD-RULE (tracked path still matched by allowlist, re-add would fail):`);
    for (const p of result.deadRulePaths) {
      console.log(`  ${p}`);
    }
  }

  if (result.deadNegations.length > 0) {
    console.log(`DEAD-NEGATION (leading-whitespace "!" is literal, not a negation):`);
    for (const n of result.deadNegations) {
      console.log(`  line ${n.line}: ${n.text}`);
    }
  }
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ─── Main ─────────────────────────────────────────────────────────────────

export async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(USAGE);
    return 0;
  }

  const ignoreFilePath = options.ignoreFile ?? join(options.gitDir, "ignore");

  let result: AuditResult;
  try {
    result = runAudit(options.gitDir, options.workTree, ignoreFilePath);
  } catch (err) {
    const message = `Audit failed: ${formatErrorMessage(err)}`;
    if (options.json) {
      console.log(JSON.stringify([{ label: "ignore-audit", error: message }], null, 2));
    } else {
      console.error(`Error: ${message}`);
    }
    return 1;
  }

  const ok = result.deadRulePaths.length === 0 && result.deadNegations.length === 0;

  if (options.json) {
    console.log(JSON.stringify([{ label: "ignore-audit", data: { ok, ...result } }], null, 2));
  } else {
    renderText(result);
  }

  return ok ? 0 : 1;
}

if (import.meta.main) {
  main().then((code) => process.exit(code));
}
