import { describe, test, expect, afterEach } from "bun:test";
import { $ } from "bun";

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
