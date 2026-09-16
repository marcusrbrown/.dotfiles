import { describe, test, expect, afterEach, beforeAll } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findDeadNegations, findDeadRulePaths, parseArgs, runAudit } from "./ignore-audit";

const SCRIPT_PATH = join(import.meta.dir, "ignore-audit.ts");

// ─── Env Isolation ──────────────────────────────────────────────────────────
//
// A leaked GIT_DIR/GIT_WORK_TREE makes `git init`/`git config` in a scratch
// dir silently mutate the real bare dotfiles repo's config instead of the
// fixture. Every git invocation below goes through `scratchEnv()`, which
// strips both vars from a copy of the process env — never the ambient env
// directly — so a leaked var in the test runner's own environment can't
// leak into the fixtures either.

function scratchEnv(): Record<string, string> {
  const env = { ...Bun.env } as Record<string, string | undefined>;
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  return env as Record<string, string>;
}

beforeAll(() => {
  const env = scratchEnv();
  expect(env.GIT_DIR).toBeUndefined();
  expect(env.GIT_WORK_TREE).toBeUndefined();
});

// ─── Temp Dir + Scratch Repo Helpers ────────────────────────────────────────

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = join(tmpdir(), `ignore-audit-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  }
});

function gitRun(cwd: string, args: string[], input?: string): { stdout: string; exitCode: number } {
  const proc = Bun.spawnSync(["git", ...args], {
    cwd,
    env: scratchEnv(),
    stdin: input != null ? Buffer.from(input) : undefined,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0 && !args.includes("check-ignore")) {
    throw new Error(`git ${args.join(" ")} failed: ${proc.stderr.toString()}`);
  }
  return { stdout: proc.stdout.toString(), exitCode: proc.exitCode ?? -1 };
}

type ScratchRepo = { gitDir: string; workTree: string; ignoreFile: string };

/** Init a throwaway repo with its own excludesFile-based allowlist, isolated from the real dotfiles repo. */
function makeScratchRepo(ignoreContent: string): ScratchRepo {
  const workTree = makeTempDir();
  gitRun(workTree, ["init", "-q"]);
  gitRun(workTree, ["config", "user.email", "test@example.com"]);
  gitRun(workTree, ["config", "user.name", "Test"]);
  const ignoreFile = join(workTree, "ignore");
  writeFileSync(ignoreFile, ignoreContent);
  gitRun(workTree, ["config", "core.excludesFile", ignoreFile]);
  return { gitDir: join(workTree, ".git"), workTree, ignoreFile };
}

function trackFile(repo: ScratchRepo, relPath: string, content = ""): void {
  const full = join(repo.workTree, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
  gitRun(repo.workTree, ["add", "-f", relPath]);
  gitRun(repo.workTree, ["commit", "-q", "-m", `add ${relPath}`]);
}

function runCli(args: string[]): { exitCode: number; stdout: string; stderr: string } {
  const proc = Bun.spawnSync(["bun", SCRIPT_PATH, ...args], {
    env: scratchEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: proc.exitCode ?? -1,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

// ─── Unit: findDeadNegations ────────────────────────────────────────────────

describe("findDeadNegations", () => {
  test("flags leading-space negations", () => {
    const content = ["/*", "!/ok.txt", " !/broken.txt", "\t!/also-broken.txt", "!/fine.txt"].join("\n");
    const findings = findDeadNegations(content);
    expect(findings).toHaveLength(2);
    expect(findings[0]).toEqual({ line: 3, text: " !/broken.txt" });
    expect(findings[1]).toEqual({ line: 4, text: "\t!/also-broken.txt" });
  });

  test("healthy allowlist has no findings", () => {
    const content = ["/*", "!/ok.txt", "!/fine.txt"].join("\n");
    expect(findDeadNegations(content)).toEqual([]);
  });
});

// ─── Integration: findDeadRulePaths ─────────────────────────────────────────

describe("findDeadRulePaths", () => {
  test("healthy allowlist → no dead rule paths", () => {
    const repo = makeScratchRepo(["/*", "!/keep.txt"].join("\n"));
    trackFile(repo, "keep.txt");
    expect(findDeadRulePaths(repo.gitDir, repo.workTree, repo.ignoreFile)).toEqual([]);
  });

  test("tracked path swallowed by a parent rule with no negation", () => {
    const repo = makeScratchRepo(["/*", "!/dir/", "/dir/*"].join("\n"));
    trackFile(repo, "dir/swallowed.txt");
    const dead = findDeadRulePaths(repo.gitDir, repo.workTree, repo.ignoreFile);
    expect(dead).toEqual(["dir/swallowed.txt"]);
  });

  test("handles tracked paths containing spaces", () => {
    const repo = makeScratchRepo(["/*", "/dir/*"].join("\n"));
    trackFile(repo, "dir/bad name.txt");
    trackFile(repo, "dir/good name.txt");
    const dead = findDeadRulePaths(repo.gitDir, repo.workTree, repo.ignoreFile);
    expect(dead).toContain("dir/bad name.txt");
    expect(dead).toContain("dir/good name.txt");
  });

  test("finds dead rules even without core.excludesFile wired in git config (CI checkout shape)", () => {
    const repo = makeScratchRepo(["/*", "!/dir/", "/dir/*"].join("\n"));
    trackFile(repo, "dir/swallowed.txt");
    gitRun(repo.workTree, ["config", "--unset", "core.excludesFile"]);
    const dead = findDeadRulePaths(repo.gitDir, repo.workTree, repo.ignoreFile);
    expect(dead).toEqual(["dir/swallowed.txt"]);
  });
});

// ─── Integration: runAudit ──────────────────────────────────────────────────

describe("runAudit", () => {
  test("leading-space negation that currently breaks a tracked file", () => {
    // ` !/broken.txt` is literal, so /* still swallows broken.txt.
    const repo = makeScratchRepo(["/*", " !/broken.txt"].join("\n"));
    trackFile(repo, "broken.txt");
    const result = runAudit(repo.gitDir, repo.workTree, repo.ignoreFile);
    expect(result.deadRulePaths).toEqual(["broken.txt"]);
    expect(result.deadNegations).toEqual([{ line: 2, text: " !/broken.txt" }]);
  });

  test("leading-space negation for a path that is not yet tracked is still a latent bug", () => {
    // No file named never-tracked.txt exists, so findDeadRulePaths sees
    // nothing wrong -- but the dead-negation scan must still catch it,
    // because it becomes a live bug the moment someone tries to track that path.
    const repo = makeScratchRepo(["/*", "!/keep.txt", " !/never-tracked.txt"].join("\n"));
    trackFile(repo, "keep.txt");
    const result = runAudit(repo.gitDir, repo.workTree, repo.ignoreFile);
    expect(result.deadRulePaths).toEqual([]);
    expect(result.deadNegations).toEqual([{ line: 3, text: " !/never-tracked.txt" }]);
  });
});

// ─── CLI: parseArgs ─────────────────────────────────────────────────────────

describe("parseArgs", () => {
  test("applies defaults", () => {
    const opts = parseArgs([]);
    expect(opts.help).toBe(false);
    expect(opts.json).toBe(false);
    expect(opts.ignoreFile).toBeUndefined();
  });

  test("parses --git-dir, --work-tree, --ignore-file, --json", () => {
    const opts = parseArgs(["--git-dir", "/a", "--work-tree", "/b", "--ignore-file", "/c/ignore", "--json"]);
    expect(opts.gitDir).toBe("/a");
    expect(opts.workTree).toBe("/b");
    expect(opts.ignoreFile).toBe("/c/ignore");
    expect(opts.json).toBe(true);
  });

  test("--help short-circuits", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
  });
});

// ─── CLI: end-to-end ─────────────────────────────────────────────────────────

describe("CLI", () => {
  test("--help exits 0", () => {
    const result = runCli(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("ignore-audit");
  });

  test("healthy repo → exit 0, no findings", () => {
    const repo = makeScratchRepo(["/*", "!/keep.txt"].join("\n"));
    trackFile(repo, "keep.txt");
    const result = runCli(["--git-dir", repo.gitDir, "--work-tree", repo.workTree, "--ignore-file", repo.ignoreFile]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("OK");
  });

  test("broken repo → exit 1, names the offending path", () => {
    const repo = makeScratchRepo(["/*", "!/dir/", "/dir/*"].join("\n"));
    trackFile(repo, "dir/swallowed.txt");
    const result = runCli(["--git-dir", repo.gitDir, "--work-tree", repo.workTree, "--ignore-file", repo.ignoreFile]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("dir/swallowed.txt");
  });

  test("--json emits valid JSON on the healthy path", () => {
    const repo = makeScratchRepo(["/*", "!/keep.txt"].join("\n"));
    trackFile(repo, "keep.txt");
    const result = runCli(["--git-dir", repo.gitDir, "--work-tree", repo.workTree, "--ignore-file", repo.ignoreFile, "--json"]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed[0].label).toBe("ignore-audit");
    expect(parsed[0].data.ok).toBe(true);
    expect(parsed[0].data.deadRulePaths).toEqual([]);
    expect(parsed[0].data.deadNegations).toEqual([]);
  });

  test("--json emits valid JSON on the failing path", () => {
    const repo = makeScratchRepo(["/*", " !/broken.txt"].join("\n"));
    trackFile(repo, "broken.txt");
    const result = runCli(["--git-dir", repo.gitDir, "--work-tree", repo.workTree, "--ignore-file", repo.ignoreFile, "--json"]);
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed[0].label).toBe("ignore-audit");
    expect(parsed[0].data.ok).toBe(false);
    expect(parsed[0].data.deadRulePaths).toEqual(["broken.txt"]);
    expect(parsed[0].data.deadNegations).toEqual([{ line: 2, text: " !/broken.txt" }]);
  });
});
