import { describe, test, expect, afterEach } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  mergeObjects,
  mergeTemplateIntoTarget,
  unionArrays,
  diffObjects,
  parseArgs,
  type JsonObject,
} from "./settings-sync";

const SCRIPT_PATH = join(import.meta.dir, "settings-sync.ts");

// ─── Temp Dir Helpers ───────────────────────────────────────────────────────

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = join(tmpdir(), `settings-sync-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

function writeJson(path: string, obj: unknown): void {
  writeFileSync(path, JSON.stringify(obj, null, 2) + "\n");
}

function runCli(args: string[]): { exitCode: number; stdout: string; stderr: string } {
  const proc = Bun.spawnSync(["bun", SCRIPT_PATH, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: proc.exitCode ?? -1,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

// ─── Unit: merge primitives ─────────────────────────────────────────────────

describe("unionArrays", () => {
  test("preserves target order first, then appends new template entries", () => {
    expect(unionArrays(["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"]);
  });

  test("dedups primitives by strict equality", () => {
    expect(unionArrays(["a", "a"], ["a", "b"])).toEqual(["a", "b"]);
  });

  test("dedups object entries by JSON serialization", () => {
    const result = unionArrays([{ x: 1 }], [{ x: 1 }, { x: 2 }]);
    expect(result).toEqual([{ x: 1 }, { x: 2 }]);
  });
});

describe("mergeObjects", () => {
  test("target-only keys are preserved", () => {
    const template: JsonObject = { a: 1 };
    const target: JsonObject = { a: 1, enabledPlugins: { foo: true } };
    const merged = mergeObjects(template, target);
    expect(merged.enabledPlugins).toEqual({ foo: true });
  });

  test("template scalar overrides a differing target scalar", () => {
    const template: JsonObject = { model: "opus" };
    const target: JsonObject = { model: "sonnet" };
    const merged = mergeObjects(template, target);
    expect(merged.model).toBe("opus");
  });

  test("nested objects deep-merge", () => {
    const template: JsonObject = { env: { A: "1", B: "2" } };
    const target: JsonObject = { env: { B: "override", C: "3" } };
    const merged = mergeObjects(template, target);
    expect(merged.env).toEqual({ A: "1", B: "2", C: "3" });
  });

  test("array union + dedup, including duplicate object entries", () => {
    const template: JsonObject = { permissions: { allow: ["Bash(git:*)", "Bash(ls:*)"] } };
    const target: JsonObject = { permissions: { allow: ["Bash(ls:*)", "Bash(rm:*)"] } };
    const merged = mergeObjects(template, target);
    expect(merged.permissions).toEqual({ allow: ["Bash(ls:*)", "Bash(rm:*)", "Bash(git:*)"] });
  });

  test("type mismatch (target array vs template scalar) — template wins", () => {
    const template: JsonObject = { model: "opus" };
    const target: JsonObject = { model: ["not", "a", "scalar"] };
    const merged = mergeObjects(template, target);
    expect(merged.model).toBe("opus");
  });
});

describe("mergeTemplateIntoTarget", () => {
  test("null target (missing) — merged equals template, everything reported added", () => {
    const template: JsonObject = { a: 1, b: { c: 2 } };
    const { merged, changes } = mergeTemplateIntoTarget(template, null);
    expect(merged).toEqual(template);
    expect(changes.some((c) => c.path === "a" && c.kind === "added")).toBe(true);
  });

  test("no drift when target already matches merged result", () => {
    const template: JsonObject = { a: 1 };
    const target: JsonObject = { a: 1 };
    const { changes } = mergeTemplateIntoTarget(template, target);
    expect(changes).toEqual([]);
  });
});

describe("diffObjects", () => {
  test("reports array-added with count", () => {
    const before: JsonObject = { allow: ["a"] };
    const after: JsonObject = { allow: ["a", "b", "c"] };
    const changes = diffObjects(before, after);
    expect(changes).toEqual([{ path: "allow", kind: "array-added", count: 2 }]);
  });
});

describe("parseArgs", () => {
  test("defaults to apply mode with default paths", () => {
    const opts = parseArgs([]);
    expect(opts.check).toBe(false);
    expect(opts.dryRun).toBe(false);
    expect(opts.templatePath).toContain("settings.template.json");
    expect(opts.targetPath).toContain("settings.json");
  });

  test("respects --template and --target overrides", () => {
    const opts = parseArgs(["--template", "/tmp/t.json", "--target", "/tmp/x.json"]);
    expect(opts.templatePath).toBe("/tmp/t.json");
    expect(opts.targetPath).toBe("/tmp/x.json");
  });

  test("--check and --dry-run and --json set booleans", () => {
    const opts = parseArgs(["--check", "--dry-run", "--json"]);
    expect(opts.check).toBe(true);
    expect(opts.dryRun).toBe(true);
    expect(opts.json).toBe(true);
  });
});

// ─── CLI: end-to-end ────────────────────────────────────────────────────────

describe("CLI apply mode", () => {
  test("target missing — template copied verbatim", () => {
    const dir = makeTempDir();
    const templatePath = join(dir, "settings.template.json");
    const targetPath = join(dir, "settings.json");
    const template = { a: 1, b: { c: 2 } };
    writeJson(templatePath, template);

    const result = runCli(["--template", templatePath, "--target", targetPath]);
    expect(result.exitCode).toBe(0);
    expect(existsSync(targetPath)).toBe(true);
    expect(JSON.parse(readFileSync(targetPath, "utf8"))).toEqual(template);
  });

  test("target-only keys survive (enabledPlugins)", () => {
    const dir = makeTempDir();
    const templatePath = join(dir, "settings.template.json");
    const targetPath = join(dir, "settings.json");
    writeJson(templatePath, { model: "opus" });
    writeJson(targetPath, { model: "sonnet", enabledPlugins: { foo: true } });

    const result = runCli(["--template", templatePath, "--target", targetPath]);
    expect(result.exitCode).toBe(0);
    const written = JSON.parse(readFileSync(targetPath, "utf8"));
    expect(written.enabledPlugins).toEqual({ foo: true });
    expect(written.model).toBe("opus");
  });

  test("apply mode creates a backup of the prior target", () => {
    const dir = makeTempDir();
    const templatePath = join(dir, "settings.template.json");
    const targetPath = join(dir, "settings.json");
    writeJson(templatePath, { a: 2 });
    writeJson(targetPath, { a: 1 });

    const result = runCli(["--template", templatePath, "--target", targetPath]);
    expect(result.exitCode).toBe(0);

    const backupDir = join(dir, "backups");
    expect(existsSync(backupDir)).toBe(true);
    const backups = readdirSync(backupDir);
    expect(backups.length).toBe(1);
    const backupContent = JSON.parse(readFileSync(join(backupDir, backups[0]), "utf8"));
    expect(backupContent).toEqual({ a: 1 });
  });

  test("output ends with a trailing newline", () => {
    const dir = makeTempDir();
    const templatePath = join(dir, "settings.template.json");
    const targetPath = join(dir, "settings.json");
    writeJson(templatePath, { a: 1 });

    runCli(["--template", templatePath, "--target", targetPath]);
    const raw = readFileSync(targetPath, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
  });
});

describe("CLI --check mode", () => {
  test("exits 0 when in sync and writes nothing", () => {
    const dir = makeTempDir();
    const templatePath = join(dir, "settings.template.json");
    const targetPath = join(dir, "settings.json");
    writeJson(templatePath, { a: 1 });
    writeJson(targetPath, { a: 1 });
    const before = readFileSync(targetPath, "utf8");

    const result = runCli(["--check", "--template", templatePath, "--target", targetPath]);
    expect(result.exitCode).toBe(0);
    expect(readFileSync(targetPath, "utf8")).toBe(before);
    expect(existsSync(join(dir, "backups"))).toBe(false);
  });

  test("exits 1 when drifted and writes nothing", () => {
    const dir = makeTempDir();
    const templatePath = join(dir, "settings.template.json");
    const targetPath = join(dir, "settings.json");
    writeJson(templatePath, { a: 2 });
    writeJson(targetPath, { a: 1 });
    const before = readFileSync(targetPath, "utf8");

    const result = runCli(["--check", "--template", templatePath, "--target", targetPath]);
    expect(result.exitCode).toBe(1);
    expect(readFileSync(targetPath, "utf8")).toBe(before);
    expect(existsSync(join(dir, "backups"))).toBe(false);
  });
});

describe("CLI --dry-run mode", () => {
  test("writes nothing and creates no backup", () => {
    const dir = makeTempDir();
    const templatePath = join(dir, "settings.template.json");
    const targetPath = join(dir, "settings.json");
    writeJson(templatePath, { a: 2 });
    writeJson(targetPath, { a: 1 });
    const before = readFileSync(targetPath, "utf8");

    const result = runCli(["--dry-run", "--template", templatePath, "--target", targetPath]);
    expect(result.exitCode).toBe(0);
    expect(readFileSync(targetPath, "utf8")).toBe(before);
    expect(existsSync(join(dir, "backups"))).toBe(false);
  });
});

describe("CLI malformed JSON", () => {
  test("malformed target JSON — clear error, non-zero exit, target left untouched", () => {
    const dir = makeTempDir();
    const templatePath = join(dir, "settings.template.json");
    const targetPath = join(dir, "settings.json");
    writeJson(templatePath, { a: 1 });
    writeFileSync(targetPath, "{ not valid json");

    const result = runCli(["--template", templatePath, "--target", targetPath]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.length > 0 || result.stdout.length > 0).toBe(true);
    expect(readFileSync(targetPath, "utf8")).toBe("{ not valid json");
    expect(existsSync(join(dir, "backups"))).toBe(false);
  });
});

describe("CLI atomic writes", () => {
  test("destination content is correct after apply and no leftover *.tmp files remain", () => {
    const dir = makeTempDir();
    const templatePath = join(dir, "settings.template.json");
    const targetPath = join(dir, "settings.json");
    writeJson(templatePath, { a: 2, b: { c: 3 } });
    writeJson(targetPath, { a: 1, enabledPlugins: { foo: true } });

    const result = runCli(["--template", templatePath, "--target", targetPath]);
    expect(result.exitCode).toBe(0);
    const written = JSON.parse(readFileSync(targetPath, "utf8"));
    expect(written).toEqual({ a: 2, b: { c: 3 }, enabledPlugins: { foo: true } });

    const leftoverTmp = readdirSync(dir).filter((name) => name.endsWith(".tmp"));
    expect(leftoverTmp).toEqual([]);
  });

  test("a failed write (read-only destination directory) leaves the original file intact and exits non-zero", () => {
    const dir = makeTempDir();
    const targetDir = join(dir, "ro-target");
    mkdirSync(targetDir, { recursive: true });
    const templatePath = join(dir, "settings.template.json");
    const targetPath = join(targetDir, "settings.json");
    const backupDir = join(dir, "backups"); // outside the read-only dir, so backup succeeds

    writeJson(templatePath, { a: 2 });
    writeJson(targetPath, { a: 1 });
    const before = readFileSync(targetPath, "utf8");

    chmodSync(targetDir, 0o555);
    try {
      const result = runCli(["--template", templatePath, "--target", targetPath, "--backup-dir", backupDir]);
      expect(result.exitCode).not.toBe(0);
      expect(readFileSync(targetPath, "utf8")).toBe(before);
    } finally {
      chmodSync(targetDir, 0o755);
    }
  });
});

describe("CLI backup retention (--keep)", () => {
  function makeBackup(backupDir: string, epoch: number, content: unknown = { a: 1 }): void {
    mkdirSync(backupDir, { recursive: true });
    writeJson(join(backupDir, `settings.json.${epoch}.bak`), content);
  }

  test("--keep N retains exactly the N newest backups by embedded epoch", () => {
    const dir = makeTempDir();
    const backupDir = join(dir, "backups");
    const epochs = [1000, 2000, 3000, 4000, 5000];
    for (const epoch of epochs) makeBackup(backupDir, epoch);

    const templatePath = join(dir, "settings.template.json");
    const targetPath = join(dir, "settings.json");
    writeJson(templatePath, { a: 2 });
    writeJson(targetPath, { a: 1 });

    const result = runCli([
      "--template",
      templatePath,
      "--target",
      targetPath,
      "--backup-dir",
      backupDir,
      "--keep",
      "2",
    ]);
    expect(result.exitCode).toBe(0);

    const remaining = readdirSync(backupDir)
      .filter((name) => /^settings\.json\.\d+\.bak$/.test(name))
      .map((name) => Number(/^settings\.json\.(\d+)\.bak$/.exec(name)?.[1]));
    // the apply itself creates a new backup of the prior target, so the newest
    // 2 by epoch should survive: the freshly-created one plus the next newest.
    expect(remaining.length).toBe(2);
    expect(Math.max(...remaining)).toBeGreaterThan(5000);
  });

  test.each([["abc"], ["NaN"], ["Infinity"], ["-1"], ["2.9"]])(
    "--keep %s is rejected and prunes nothing",
    (badValue) => {
      const dir = makeTempDir();
      const backupDir = join(dir, "backups");
      const epochs = [1000, 2000, 3000];
      for (const epoch of epochs) makeBackup(backupDir, epoch);

      const templatePath = join(dir, "settings.template.json");
      const targetPath = join(dir, "settings.json");
      writeJson(templatePath, { a: 2 });
      writeJson(targetPath, { a: 1 });

      const result = runCli([
        "--template",
        templatePath,
        "--target",
        targetPath,
        "--backup-dir",
        backupDir,
        "--keep",
        badValue,
      ]);

      // A malformed --keep must fail loudly rather than coercing to NaN, where
      // `slice(NaN)` would collapse to `slice(0)` and delete every backup.
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("--keep expects a non-negative integer");

      const remaining = readdirSync(backupDir).filter((name) => /^settings\.json\.\d+\.bak$/.test(name));
      expect(remaining.length).toBe(epochs.length);

      // the target must be left exactly as it was, since apply never ran
      expect(JSON.parse(readFileSync(targetPath, "utf8"))).toEqual({ a: 1 });
    },
  );

  test("--keep with no value is rejected", () => {
    const dir = makeTempDir();
    const templatePath = join(dir, "settings.template.json");
    const targetPath = join(dir, "settings.json");
    writeJson(templatePath, { a: 2 });
    writeJson(targetPath, { a: 1 });

    const result = runCli(["--template", templatePath, "--target", targetPath, "--keep"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--keep expects a value");
  });

  test("--keep 0 prunes nothing", () => {
    const dir = makeTempDir();
    const backupDir = join(dir, "backups");
    const epochs = [1000, 2000, 3000];
    for (const epoch of epochs) makeBackup(backupDir, epoch);

    const templatePath = join(dir, "settings.template.json");
    const targetPath = join(dir, "settings.json");
    writeJson(templatePath, { a: 2 });
    writeJson(targetPath, { a: 1 });

    const result = runCli([
      "--template",
      templatePath,
      "--target",
      targetPath,
      "--backup-dir",
      backupDir,
      "--keep",
      "0",
    ]);
    expect(result.exitCode).toBe(0);

    const remaining = readdirSync(backupDir).filter((name) => /^settings\.json\.\d+\.bak$/.test(name));
    // 3 pre-existing + 1 created by this apply
    expect(remaining.length).toBe(4);
  });

  test("default retention is 10", () => {
    const dir = makeTempDir();
    const backupDir = join(dir, "backups");
    const epochs = Array.from({ length: 15 }, (_, i) => 1000 + i);
    for (const epoch of epochs) makeBackup(backupDir, epoch);

    const templatePath = join(dir, "settings.template.json");
    const targetPath = join(dir, "settings.json");
    writeJson(templatePath, { a: 2 });
    writeJson(targetPath, { a: 1 });

    const result = runCli(["--template", templatePath, "--target", targetPath, "--backup-dir", backupDir]);
    expect(result.exitCode).toBe(0);

    const remaining = readdirSync(backupDir).filter((name) => /^settings\.json\.\d+\.bak$/.test(name));
    expect(remaining.length).toBe(10);
  });

  test("unrelated files in the backups directory survive pruning untouched", () => {
    const dir = makeTempDir();
    const backupDir = join(dir, "backups");
    mkdirSync(backupDir, { recursive: true });
    for (let i = 0; i < 5; i++) makeBackup(backupDir, 1000 + i);
    writeFileSync(join(backupDir, ".claude.json.backup.1787634437646"), "{}");
    writeFileSync(join(backupDir, "notes.txt"), "do not touch");

    const templatePath = join(dir, "settings.template.json");
    const targetPath = join(dir, "settings.json");
    writeJson(templatePath, { a: 2 });
    writeJson(targetPath, { a: 1 });

    const result = runCli([
      "--template",
      templatePath,
      "--target",
      targetPath,
      "--backup-dir",
      backupDir,
      "--keep",
      "1",
    ]);
    expect(result.exitCode).toBe(0);

    expect(existsSync(join(backupDir, ".claude.json.backup.1787634437646"))).toBe(true);
    expect(existsSync(join(backupDir, "notes.txt"))).toBe(true);
    expect(readFileSync(join(backupDir, "notes.txt"), "utf8")).toBe("do not touch");
  });

  test("pruning does not run in --check or --dry-run", () => {
    const dir = makeTempDir();
    const backupDir = join(dir, "backups");
    const epochs = [1000, 2000, 3000];
    for (const epoch of epochs) makeBackup(backupDir, epoch);

    const templatePath = join(dir, "settings.template.json");
    const targetPath = join(dir, "settings.json");
    writeJson(templatePath, { a: 2 });
    writeJson(targetPath, { a: 1 });

    const checkResult = runCli([
      "--check",
      "--template",
      templatePath,
      "--target",
      targetPath,
      "--backup-dir",
      backupDir,
      "--keep",
      "1",
    ]);
    expect(checkResult.exitCode).toBe(1);

    const dryRunResult = runCli([
      "--dry-run",
      "--template",
      templatePath,
      "--target",
      targetPath,
      "--backup-dir",
      backupDir,
      "--keep",
      "1",
    ]);
    expect(dryRunResult.exitCode).toBe(0);

    const remaining = readdirSync(backupDir).filter((name) => /^settings\.json\.\d+\.bak$/.test(name));
    expect(remaining.length).toBe(3);
  });
});
