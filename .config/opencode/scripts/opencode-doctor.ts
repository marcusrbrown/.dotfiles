#!/usr/bin/env bun
import { spawn, type ChildProcess } from "node:child_process";
import { createOpencodeClient } from "@opencode-ai/sdk";

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
};

type SectionResult = {
  label: string;
  data: unknown;
  error?: string;
};

const DEFAULT_PORT = 4096;
const AUTO_PORT_ATTEMPTS = 10;
const DEFAULT_LIMIT = 10;

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
