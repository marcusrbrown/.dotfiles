# OpenCode Doctor Reference Guide

## Introduction

`opencode-doctor` is a diagnostic utility for OpenCode environments. It inspects various aspects of the running OpenCode server, project configuration, and integrated tools to provide a comprehensive health check and debugging information.

If an OpenCode server is not already running on the target port, the doctor will attempt to spawn a temporary server instance for the duration of the diagnostic run.

---

## Installation and Execution

The doctor script is located at `~/.config/opencode/scripts/opencode-doctor.ts`.

### Running via mise (Recommended)

If you have `mise` configured, you can run the doctor using the defined task:

```bash
mise run opencode:doctor
```

### Running Directly with Bun

The script requires [Bun](https://bun.sh/) to execute directly:

```bash
bun ~/.config/opencode/scripts/opencode-doctor.ts [options]
```

---

## CLI Options

| Flag               | Argument       | Description                             | Default     |
| ------------------ | -------------- | --------------------------------------- | ----------- |
| `--port`           | `<number>`     | OpenCode server port                    | `4096`      |
| `--host`           | `<string>`     | Hostname for base URL                   | `localhost` |
| `--directory`      | `<path>`       | Directory to target                     | `cwd`       |
| `--format`         | `<text\|json>` | Output format                           | `text`      |
| `--json`           | -              | Shortcut for `--format json`            | -           |
| `--no-tui`         | -              | Disable ANSI styling and colors         | -           |
| `--only`           | `<keys>`       | Comma-separated sections to include     | All         |
| `--full`           | -              | Include expanded data where available   | -           |
| `--limit`          | `<number>`     | Limit list size for multi-item sections | `10`        |
| `--tools-provider` | `<string>`     | Provider ID for tool schemas            | -           |
| `--tools-model`    | `<string>`     | Model ID for tool schemas               | -           |
| `--db-health`      | -              | Read-only DB maintenance metrics        | -           |
| `--prune-older`    | `<days>`       | Prune sessions older than N days (dry-run unless `--execute`) | `30` |
| `--execute`        | -              | Required to perform the irreversible prune + VACUUM | -   |
| `--db-path`        | `<path>`       | Override DB path                        | `~/.local/share/opencode/opencode.db` |
| `--help`, `-h`     | -              | Show help message                       | -           |

---

## Diagnostic Sections

You can filter the output using the `--only` flag followed by a comma-separated list of these section keys:

- `server`: Server connection details (URL, port, mode)
- `health`: Server health status and latency
- `config`: OpenCode configuration settings (redacted)
- `providers`: Configured model providers
- `project`: Current project details
- `projects`: List of available projects
- `path`: Environment path information
- `vcs`: Version Control System (Git) status
- `agents`: Available OpenCode agents
- `commands`: Available CLI commands/aliases
- `tools`: Detailed tool information (use `--full` for schemas)
- `tool-ids`: List of available tool identifiers
- `mcp`: Model Context Protocol server status
- `lsp`: Language Server Protocol status
- `formatter`: Code formatter configuration
- `sessions`: Active OpenCode sessions
- `session-status`: Status of current session

---

## Usage Examples

### Standard Health Check

```bash
mise run opencode:doctor
```

### Detailed Tools Inspection

To see full tool schemas and all available tools:

```bash
bun ~/.config/opencode/scripts/opencode-doctor.ts --only tools --full --limit 100
```

### JSON Output for Scripting

```bash
bun ~/.config/opencode/scripts/opencode-doctor.ts --json > diagnostic.json
```

### Targeting a Specific Port

```bash
bun ~/.config/opencode/scripts/opencode-doctor.ts --port 5000
```

---

## DB Maintenance

OpenCode never prunes its SQLite session DB (`~/.local/share/opencode/opencode.db`), so it grows unbounded. These flags operate directly on the SQLite file and do **not** spawn the OpenCode server.

- `--db-health` — read-only metrics: file/WAL/shm sizes, page and freelist counts, free %, journal mode, `auto_vacuum`, per-table row counts, and a session age histogram. Safe to run anytime.
- `--prune-older=<days>` — **dry-run by default**: reports how many sessions have not been used in `<days>` and the reclaimable bytes per table. Deletes nothing without `--execute`. Selection is based on last-use (`time_updated`), not creation time, and is tree-aware: a session tree (root + all descendants via `parent_id`) is only selected if *no* session in the tree was touched within the window — one active leaf keeps the whole tree.
- `--prune-older=<days> --execute` — **IRREVERSIBLE.** Deletes old sessions and their messages, parts, and events, then runs `VACUUM` to reclaim space. Refuses to run if other OpenCode processes are active (a full VACUUM needs exclusive access), if free disk is below ~1.1× the DB size, or if `<days>` is less than 1.

```bash
# Inspect DB health
mise run opencode:doctor -- --db-health

# Preview what a 30-day prune would reclaim (no changes)
mise run opencode:doctor -- --prune-older=30

# Actually prune + VACUUM (close all other OpenCode instances first)
mise run opencode:doctor -- --prune-older=30 --execute
```

Pruning events is only safe for local-first usage — `event` rows back OpenCode's sync / cross-device replay / history features. See `docs/solutions/2026-06-25-opencode-sqlite-db-bloat-prune-vacuum.md` for the full safety contract.

### One-time: switch to incremental auto-vacuum

```bash
mise run opencode:doctor -- --set-incremental-vacuum
```

Converts the DB from `auto_vacuum=NONE` to `INCREMENTAL` (sets the pragma, then runs a full `VACUUM` to rewrite the file). After this, future prunes free pages that can be reclaimed incrementally without a full exclusive VACUUM each time. Same constraints as `--execute` (close other OpenCode instances; needs ~1.1× DB size free disk). Safe to re-run — it re-attempts the full VACUUM until the conversion is confirmed.

---

## SDK Workaround Note

> **Note:** The `@opencode-ai/sdk` types may occasionally lag behind the runtime API. The doctor handles this by using a `{ query: {} }` wrapper pattern where necessary to ensure compatibility with the current server response structures.

---

## Verification

To verify the doctor is functioning correctly, run it with the `--only health` flag:

```bash
mise run opencode:doctor -- --only health
```

(Note: The `--` is used to pass arguments through `mise` to the underlying script).
