---
title: 'feat: Add local Ollama distillation pipeline (mise run distill)'
type: feat
status: active
date: 2026-05-22
origin: docs/brainstorms/2026-05-21-local-ollama-distillation-requirements.md
---

# feat: Add local Ollama distillation pipeline (mise run distill)

## Overview

Implement a Bun/TypeScript CLI that reads OpenCode's SQLite session store, runs the validated `qwen3:8b` distillation prompt against recent sessions, and writes a Markdown report. Exposed as `mise run distill`. No `ctx_memory` writes; no Magic Context coupling; pipeline is strictly a reader. R5 validation gate is already passed (7/8 reports judged worth reading); this plan lifts the validated prompt + invocation strategy from the throwaway R5 script into production code.

## Problem Frame

OpenCode's SQLite session store at `~/.local/share/opencode/opencode.db` (3.7GB on this machine) holds every past session, message, and tool-call. The historian compacts them into compartments but doesn't surface readable reports. Cross-session learnings re-derive instead of recover. Meanwhile Ollama on this M1 Pro 16GB has been installed for 19 months producing zero value; setup tuning (R1-R4) has reclaimed 29GB of disk and removed all autostart, leaving a properly-pinned `qwen3:8b` ready for on-demand work. This pipeline gives Ollama a real job: turn recent OpenCode activity into a Markdown report Marcus reads.

Origin: `docs/brainstorms/2026-05-21-local-ollama-distillation-requirements.md`

## Requirements Trace

- R1-R4 (origin): Setup tuning — done in-session 2026-05-21 (29GB reclaimed, no autostart, only qwen3:8b retained). This plan does not re-implement them.
- R5 (origin): Validation gate — PASSED on 2026-05-21 (7/8 reports worth reading using qwen3:8b + system message + `think=false` + XML delims + quality rules + lower temperature). This plan lifts the validated strategy.
- R6 (origin): Read-only SQLite ingest with role-labeled text extraction from `text`/`reasoning` parts, joined with session metadata, filtered by recency + `parent_id IS NULL`.
- R7 (origin): Per-run input cap (50 sessions OR 1.5MB cumulative text, whichever first).
- R8 (origin): Skip-and-exit if no new sessions since last successful run.
- R9 (origin): Explicit SQLite failure-mode handling (`SQLITE_BUSY`/`SQLITE_LOCKED` retry, `SQLITE_SCHEMA` fatal, JSON decode failures skip session).
- R10 (origin): `qwen3:8b` Q4_K_M is the v1 model.
- R11 (origin): `num_ctx` ≤ 32K (validated by R5).
- R12 (origin): Markdown report output with top-5 report-block length cap.
- R13 (origin): Manual trigger `mise run distill` with `--since` and `--session` flags; no scheduled trigger.
- R14 (origin): JSONL run log at `~/.local/state/ollama-distill/runs.jsonl`.
- R15 (origin): Best-effort execution — failures log to JSONL and complete with partial output.
- R16 (origin): No cloud egress.
- R17 (origin): Pipeline never writes to `opencode.db`; verify read-only at connection layer.

(R1-R4 already shipped; this plan covers R5-R17.)

## Scope Boundaries

- No `ctx_memory` writes — pipeline is read-only Markdown report output.
- No subagent transcript ingestion (sessions with `parent_id IS NOT NULL`).
- No `part` content beyond `type=text` and `type=reasoning`.
- No scheduled trigger (launchd nightly). Manual only.
- No GitHub PR / Fro Bot / additional input streams.
- No interactive UI; CLI only.
- No write integration with Magic Context or any agent tool.
- No agent invocation from the pipeline. (Brainstorm's Deferred section notes `opencode -p` as a v2 path; v1 does not use it.)

## Context & Research

### Relevant Code and Patterns

- **CLI utility precedent**: `.config/opencode/scripts/opencode-doctor.ts` is the canonical Bun/TS CLI utility in this repo. Pairs with companion `.config/opencode/scripts/opencode-doctor.test.ts`. Uses `#!/usr/bin/env bun` shebang, executable bit. The distill script lands at `.config/opencode/scripts/ollama-distill.ts` + companion `.test.ts`.
- **Mise task convention**: `.config/mise/tasks/<name>` files with executable bit + shebang + `#MISE description=...` header. Auto-discovered. Distill task is `tasks/distill` (no sub-namespace).
- **Example mise task wrapping Bun script**: `.config/mise/tasks/opencode/doctor` invokes `.config/opencode/scripts/opencode-doctor.ts` with `bun run`. Distill mirrors this.
- **XDG state directory**: `~/.local/state/` is endorsed by AGENTS.md. No existing tool in dotfiles uses it yet but convention is established.
- **R5 validated script (throwaway, not committed)**: `/tmp/r5-distill-v2.py` contains the validated extraction SQL, prompt, and Ollama HTTP API invocation. This plan ports the logic to Bun/TS — the script itself is not preserved.

### Institutional Learnings

- `docs/solutions/` does not exist in this repo. No prior solutions to inherit.

### External References

- Ollama HTTP API `/api/chat` reference: <https://github.com/ollama/ollama/blob/main/docs/api.md> — validated in R5 with `think: false`, `temperature: 0.3`, `num_ctx: 32768`.
- Bun SQLite docs: <https://bun.sh/docs/api/sqlite>.
- Qwen3 thinking-mode control: API `think: false` parameter or `--think=false` CLI flag. (Memory ID 3670.)

## Key Technical Decisions

- **Implementation language: Bun + TypeScript.** Mirrors `.config/opencode/scripts/opencode-doctor.ts` precedent. Bun ships `bun:sqlite` built-in, has native `fetch`, has built-in test runner.
- **Implementation file: `.config/opencode/scripts/ollama-distill.ts`** + companion `.test.ts`. Both need allowlist entries in `.dotfiles/.gitignore`.
- **Mise task: `.config/mise/tasks/distill`.** Thin wrapper that invokes `bun run .config/opencode/scripts/ollama-distill.ts "$@"`.
- **State directory: `~/.local/state/ollama-distill/`** for `runs.jsonl` (run log), `cursor.json` (last-run timestamp), and `reports/YYYY-MM-DD.md` (default report path).
- **Report destination default: `~/.local/state/ollama-distill/reports/YYYY-MM-DD.md`** (resolves brainstorm OQ1). Override via `--out=<path>` flag.
- **No Modelfile** (resolves OQ2). Ollama HTTP API options pass `think: false`, `temperature: 0.3`, `num_ctx: 32768`.
- **No "also-ran" tail** (resolves OQ5). R5 quality-rules prompt eliminates padding.
- **Simplified cursor (revision-1 finding F1):** `cursor.json` stores only `{ last_run_timestamp: number | null }`. No overflow tracking — the recency filter (`WHERE session.time_updated > <last_run_timestamp>`) naturally re-surfaces any sessions not processed in the previous run. R7's per-run cap (50/1.5MB) selects a subset of matching sessions ordered ASC by `time_updated`; on success, the cursor advances to the `time_updated` of the LAST processed session (NOT to `now()`), so unprocessed sessions remain visible to the next run. No state can be silently skipped.
- **`--session=<id>` does not advance cursor (R20):** When `--session` is passed, the pipeline processes exactly that session and exits. Does NOT read cursor, does NOT update cursor, does NOT acquire the run lock, and does NOT write to the default daily report file. Output goes to stdout by default; pass `--out=<path>` to redirect to a file. JSONL log records the run with a `mode: "session"` field so all distillation activity is auditable from one place.
- **`--since=<value>` is a recency-filter override that does NOT mutate cursor:** Behaves the same as a regular run except `last_run_timestamp` is read from the flag rather than the cursor. Cursor still updates after success per the simplified-cursor rule. This is the correct behavior for one-off catch-ups (you may want to backfill the last 30 days without losing your normal-cadence cursor position). If a user wants to BOTH backfill AND reset the cursor, they delete `cursor.json` first.
- **Schema-invariant check at startup (revision-1 finding F4):** Replaces the brittle hash check with explicit column-presence assertions. On open, query `PRAGMA table_info('session')`, `('message')`, `('part')` and verify expected columns exist (`session.id, project_id, parent_id, time_updated`; `message.id, session_id, time_created, data`; `part.id, message_id, message_id, time_created, data`). If ANY expected column is missing, **fail closed** with `SchemaError` and exit code 3. This is fail-closed (not warn-only) because the parser produces silent garbage on missing columns.
- **Skip the `agent` part type** even though it carries text — structured subagent context, not user/assistant conversation text. Per brainstorm R6.
- **Treat unknown part types as skip + log** (forward-compat). Stats hash in JSONL log reports unknown types.
- **Read-only enforcement (R17):** open SQLite with URI mode `file:...?mode=ro` + `PRAGMA query_only=ON` + a runtime probe (`CREATE TEMP TABLE _verify(x)` must fail with SQLITE_READONLY). Belt-and-suspenders justified because R17 explicitly says "fails closed at the connection layer."
- **Explicit `busy_timeout`:** SQLite connection sets `PRAGMA busy_timeout=5000` (5s) in addition to the per-query 3-retry / 100ms backoff. Reduces test brittleness; matches OpenCode's likely write-burst patterns.
- **No retry on `SQLITE_SCHEMA`** (R9). Fatal because parser may produce garbage. JSONL records the error; next run succeeds after Marcus re-validates against updated OpenCode.
- **Collapsed exit codes (revision-1 finding F8):** `0` = success (report written, all sessions processed cleanly), `1` = failure or partial failure (some sessions failed, no-ollama, schema error, anything non-success). JSONL log carries detailed cause; exit code is binary signal for "did this work or not."
- **Compound doc deferred to its own task** (revision-1 finding F7): The brainstorm + plan + session memories already capture the institutional learnings. A compound doc duplicating them adds no signal. If a genuinely-reusable pattern emerges from implementation (e.g., a Bun/TS recipe for reading WAL SQLite from a CLI), THAT becomes the compound entry post-implementation, separate from this PR. Per the stated flow, the compound doc still lands in the same PR but as a thin entry capturing only what's net-new from implementation (likely: Bun's bun:sqlite WAL-mode behavior + read-only enforcement pattern that wasn't pre-validated by R5).

## Open Questions

### Resolved During Planning

- OQ1 (origin: report destination): `~/.local/state/ollama-distill/reports/YYYY-MM-DD.md` default; `--out=<path>` flag for override.
- OQ2 (origin: Modelfile tuning): No Modelfile needed; HTTP API options sufficient.
- OQ3 (origin: message.data schema): Resolved during R5 via explorer + direct probe.
- OQ4 (origin: Bun vs Python): Bun/TS per repo precedent.
- OQ5 (origin: also-ran tail): Omit; R5 quality-rules prompt eliminates padding.

### Deferred to Implementation

- **Exact `--since` flag parsing format**: accept `7d`, `2026-05-15`, or epoch ms? Implementer picks; documented in `--help`.
- **Exact JSONL field naming** (snake_case vs camelCase, timestamp format): plan recommends snake_case + RFC 3339 + ms epoch but implementer decides.
- **Cursor bootstrap default on first run**: plan recommends `now() - 7d`; implementer confirms during execution.

## Output Structure

3 new tracked files + 1 modified file + 1 thin compound doc:

```
.dotfiles/.gitignore                                            # modified — allowlist entries added
.config/opencode/scripts/
  ollama-distill.ts                                             # new — Bun/TS CLI implementation
  ollama-distill.test.ts                                        # new — Bun test runner companion
.config/mise/tasks/
  distill                                                       # new — mise task wrapper (executable)
docs/solutions/
  2026-05-22-bun-sqlite-readonly-wal-pattern.md                 # new — compound doc (post-implementation, captures the WAL/read-only pattern only)
```

State directory created at runtime (untracked):

```
~/.local/state/ollama-distill/
  cursor.json
  runs.jsonl
  reports/
    YYYY-MM-DD.md
```

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
┌─────────────────────────────────────────────────────────────────────┐
│                     mise run distill [--since X] [--session ID]     │
│                                                                     │
│  ↓ wraps                                                            │
│                                                                     │
│  bun run .config/opencode/scripts/ollama-distill.ts "$@"            │
└────────────────────────────────────┬────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     ollama-distill.ts (Bun)                         │
│                                                                     │
│  Phase A: load cursor + parse args + Ollama health check            │
│    ~/.local/state/ollama-distill/cursor.json                        │
│       → { last_run_timestamp }                                      │
│    --since overrides for the run (cursor still advances)            │
│    --session does not advance cursor (R20)                          │
│    GET /api/tags → if fails, exit 1 with actionable error           │
│                                                                     │
│  Phase B: open SQLite (read-only, verified, schema-checked)         │
│    file:~/.local/share/opencode/opencode.db?mode=ro                 │
│       + PRAGMA query_only=ON                                        │
│       + PRAGMA busy_timeout=5000                                    │
│       + R17 probe: CREATE TEMP TABLE _verify(x) MUST fail           │
│       + schema invariant check: expected columns must exist         │
│         (fail-closed, exit 1, on any missing column)                │
│                                                                     │
│  Phase C: select sessions                                           │
│    SELECT id, time_updated FROM session                             │
│    WHERE time_updated > <last_run_timestamp>                        │
│      AND parent_id IS NULL                                          │
│    ORDER BY time_updated ASC                                        │
│    LIMIT N=50 OR cumulative extracted text ≤ 1.5MB (R7)             │
│                                                                     │
│    (--session mode skips this; processes the one passed ID)         │
│                                                                     │
│  Phase D: per session — extract + invoke Ollama                     │
│    extract_transcript: JOIN message + part, ORDER BY time_created   │
│      filter parts: type IN (text, reasoning)                        │
│      label by message.data.role (USER:/ASSISTANT:)                  │
│      truncate at 60K chars                                          │
│      retry on SQLITE_BUSY/LOCKED (3x, 100ms backoff)                │
│      fail-closed on SQLITE_SCHEMA (exit 1)                          │
│      skip session on JSON decode failure                            │
│                                                                     │
│    callOllama: POST /api/chat (system + user, think=false,          │
│                temperature=0.3, num_ctx=32768)                      │
│                                                                     │
│  Phase E: write outputs                                             │
│    Markdown report: ~/.local/state/ollama-distill/reports/<date>.md │
│      (or --out path; or stdout in --session mode)                   │
│    JSONL run log: ~/.local/state/ollama-distill/runs.jsonl          │
│    Update cursor: last_run_timestamp = max(time_updated of          │
│      processed sessions); ONLY in normal mode, not --session mode   │
│                                                                     │
│  Exit codes: 0=success, 1=any failure (JSONL has detail)            │
└─────────────────────────────────────────────────────────────────────┘
```

## Implementation Units

- [x] **Unit 1: SQLite reader + transcript extraction**

**Goal:** Implement read-only SQLite connection with R17 hardening (URI mode + PRAGMA + temp-table probe), schema-invariant check (fail-closed on missing columns), and the role-labeled transcript-extraction function.

**Requirements:** R6, R9, R17

**Dependencies:** None.

**Files:**
- Create: `.config/opencode/scripts/ollama-distill.ts` (initial: imports, types, SQLite reader module, extract function)
- Create: `.config/opencode/scripts/ollama-distill.test.ts` (Unit 1 tests)
- Modify: `.dotfiles/.gitignore` (allowlist `.config/opencode/scripts/ollama-distill.ts` and `.test.ts`)

**Approach:**
- Open SQLite via `new Database("file:" + dbPath + "?mode=ro", { readonly: true })` from `bun:sqlite`
- After open: `PRAGMA query_only=ON; PRAGMA busy_timeout=5000`
- Read-only verification probe: `CREATE TEMP TABLE _verify(x)` — MUST throw SQLITE_READONLY; if it succeeds, abort with explicit error
- Schema invariant check: for each of `session`/`message`/`part`, query `PRAGMA table_info(<name>)` and assert expected columns exist. Expected columns (from explorer + 2026-05-21 probe): `session: id, project_id, parent_id, time_created, time_updated`; `message: id, session_id, time_created, data`; `part: id, message_id, session_id, time_created, data`. Throw `SchemaError` on any missing column; CLI catches and exits 1 with the missing-column name in the message.
- Extract function: `extractTranscript(sessionId): { transcript: string, stats: { messages, text_parts, reasoning_parts, skipped_parts, skipped_types[], transcript_chars, truncated } }`
- SQL: `SELECT m.id, m.data, p.data FROM message m LEFT JOIN part p ON p.message_id = m.id WHERE m.session_id = ? ORDER BY m.time_created ASC, p.time_created ASC, p.id ASC`
- Group by message_id; parse `m.data.role` and uppercase it; per part: parse `p.data`; if `type === "text"` emit `${role}: ${data.text}`; if `type === "reasoning"` emit `${role} [reasoning]: ${data.text}`; otherwise increment skipped_parts and add to skipped_types Set
- Truncate at 60000 chars with marker
- SQLITE_BUSY/SQLITE_LOCKED retry: 3-attempt loop with 100ms backoff around the SELECT
- SQLITE_SCHEMA: throw `SchemaError`; caller maps to exit 1

**Patterns to follow:**
- `.config/opencode/scripts/opencode-doctor.ts` for module/error/exit conventions
- AGENTS.md gitignore allowlist quirk: new files may need `git add -f`

**Test scenarios:**
- **Happy path:** session with 3 messages (each with one text part) → 3 role-labeled lines in chronological order, stats correct
- **Mixed part types:** session with text + reasoning + tool + step-start parts → only text/reasoning emit; others recorded in skipped_types
- **Truncation:** session with >60K chars text → truncated content + marker + `stats.truncated === true`
- **Read-only verification:** fresh DB open → `CREATE TEMP TABLE` probe throws SQLITE_READONLY
- **Schema-missing-column:** mock or fixture DB missing `session.parent_id` → SchemaError thrown with the column name
- **SQLite busy retry:** mock driver returns SQLITE_BUSY twice then success → returns successfully after 2 retries
- **JSON decode failure:** part row with malformed JSON → part skipped, extract continues, stats records skipped_parts

**Verification:**
- `bun test .config/opencode/scripts/ollama-distill.test.ts` passes all Unit 1 scenarios
- Manual cross-check: extracted transcript for a known session matches what `/tmp/r5-distill-v2.py` produced (compare against Round C R5 output for the same session)

---

- [x] **Unit 2: Cursor + session selection + Ollama client + report writer**

**Goal:** Implement the simplified cursor (last_run_timestamp only), session selection with R7 cap, Ollama HTTP client with validated R5 strategy, and the Markdown report writer + JSONL run log.

**Requirements:** R7, R8, R10, R11, R12, R14, R15

**Dependencies:** Unit 1 (uses extract function).

**Files:**
- Modify: `.config/opencode/scripts/ollama-distill.ts` (add cursor, selection, Ollama client, report/log writer modules)
- Modify: `.config/opencode/scripts/ollama-distill.test.ts` (add Unit 2 tests with mocked fetch)

**Approach:**
- Cursor at `~/.local/state/ollama-distill/cursor.json` as `{ last_run_timestamp: number | null }` (epoch ms). File-missing bootstrap: `now() - 7d`.
- Selection (normal mode): `SELECT id, time_updated FROM session WHERE time_updated > ? AND parent_id IS NULL ORDER BY time_updated ASC`. Iterate, call extract for byte count, stop when 50 sessions OR cumulative bytes ≥ 1.5MB. Track `max_processed_time_updated`.
- Cursor advances on success to `max_processed_time_updated` (NOT to `now()` — unprocessed sessions remain visible next run by natural recency filter).
- Cursor atomic-write: write to `cursor.json.tmp` + rename. Skip cursor update entirely in --session mode.
- Ollama client: `callOllama(transcript): Promise<{ output, durationMs, error? }>`. Lifts SYSTEM_PROMPT + USER_TEMPLATE verbatim from `/tmp/r5-distill-v2.py` Round C version. POST to `http://127.0.0.1:11434/api/chat` with payload `{ model: "qwen3:8b", messages: [system, user], stream: false, think: false, options: { temperature: 0.3, num_ctx: 32768 } }`. 300s timeout via `AbortSignal.timeout(300_000)`. No retry on HTTP failure.
- Report writer: path = `--out` flag OR `~/.local/state/ollama-distill/reports/YYYY-MM-DD.md`. Append if same-day file exists with `\n\n---\n\n## Run at HH:MM\n\n` separator. Per-session content: `### <session-title> (<session-id>)\n\n<ollama-output>\n\n`. `mkdir -p` parent dir before write.
- JSONL log writer: append to `~/.local/state/ollama-distill/runs.jsonl`. Record per run: `{ ts, ts_ms, duration_ms, mode: "normal" | "session", model, sessions_read, report_blocks_generated, report_path, success, errors[] }`. On per-session error: append to `errors` as `{ session_id, phase, message }`. `success` mirrors process exit code (true = exit 0).

**Patterns to follow:**
- `.config/opencode/scripts/opencode-doctor.ts` module organization
- Bun: `bun:sqlite`, `Bun.file().json()`, `Bun.write()`, `node:fs` `renameSync` for atomic write
- AbortController/AbortSignal for fetch timeout

**Test scenarios:**
- **Cursor bootstrap:** missing file → bootstraps to `now() - 7d`
- **Cap reached at 50 sessions:** 75 small candidates → first 50 selected, cursor advances to time_updated of 50th
- **Cap reached at 1.5MB:** cumulative extracted text just over 1.5MB after the 7th of 10 sessions → first 7 selected
- **Unprocessed sessions re-surface naturally:** after a capped run, the same recency-filter query at next run includes the not-yet-processed sessions (because cursor advanced only to last-processed, not to now)
- **Atomic cursor write:** simulate kill mid-write → old cursor still valid on next read
- **Ollama happy path:** mocked fetch returns `{ message: { content: "## Block\n..." } }` → callOllama returns correct output + duration
- **Ollama network error:** mocked fetch throws → returns `{ output: "", error: "..." }` with non-zero duration
- **Ollama timeout:** mocked fetch never resolves (small AbortSignal in test) → returns error "timeout"
- **Report append behavior:** existing same-day file → new content appended with separator
- **Partial failure:** 3 sessions, 1 Ollama call fails → report has 2 session blocks + JSONL `errors` has one entry + JSONL `success: false`

**Verification:**
- `bun test` passes all Unit 2 scenarios
- Manual: run pipeline twice quickly → second run reports zero new sessions and exits clean
- Manual: smoke test against 1-2 real sessions → output matches Round C R5 output within model temperature variation

---

- [x] **Unit 3: CLI entry + flag parsing + Ollama health check**

**Goal:** Wire all modules into a CLI with `--since`, `--session`, `--out`, `--extract-only`, `--help`. Implement Ollama health check + non-mutating `--session` semantics + fail-closed exit codes.

**Requirements:** R13, R15

**Dependencies:** Units 1, 2.

**Files:**
- Modify: `.config/opencode/scripts/ollama-distill.ts` (main entry + flag parser)
- Modify: `.config/opencode/scripts/ollama-distill.test.ts` (Unit 3 tests for flag parsing + dispatch)

**Approach:**
- Simple positional + `--flag=value` parsing via `Bun.argv` (no full arg-parsing lib)
- Flags:
  - `--since=<value>` — recency filter override; accepts ISO date, `Nd` relative, or epoch ms. Cursor still updates after success.
    - `--session=<id>` — does not advance cursor (R20): process exactly one session; does NOT read or write cursor; does NOT acquire run lock; output to stdout unless `--out` provided; JSONL logged with `mode: "session"`.
  - `--out=<path>` — override report destination (or output target in --session mode).
  - `--extract-only` — debug: print extracted transcript, skip Ollama. Does NOT update cursor.
  - `--help` — usage.
- Ollama health check at startup: `GET http://127.0.0.1:11434/api/tags` with 2s `AbortSignal.timeout`. On failure: stderr `"ollama serve not reachable at 127.0.0.1:11434. Start it with: ollama serve &"` + exit 1.
- Best-effort completion (R15): main wrapped in try/catch; uncaught exceptions write a failure JSONL record and stderr message, exit 1.
- Exit codes (collapsed per F8): `0` = clean success (report written, every session processed without error), `1` = any failure (no-ollama, schema error, partial-success with errors, fatal SQLite error). JSONL carries cause detail.

**Patterns to follow:**
- `.config/opencode/scripts/opencode-doctor.ts` for exit code + stderr conventions
- Don't spawn `ollama serve` — user-managed lifecycle (brainstorm's "Ollama as ffmpeg")

**Test scenarios:**
- **Flag parsing happy path:** `--since=2026-05-15 --out=/tmp/r.md` → `{ since: <ms>, out: "/tmp/r.md" }`
- **`--since` formats accepted:** `7d`, `2026-05-15`, `1747267200000` all parse correctly
- **`--session` does not advance cursor (R20):** passing `--session=ses_xxx` runs against that one session, does NOT touch cursor.json, does NOT acquire run lock; output goes to stdout when no --out
- **`--session` + `--out`:** output redirected to specified file, JSONL records `mode: "session"`
- **No ollama:** mock fetch on `/api/tags` returns ECONNREFUSED → exit 1 with actionable stderr message
- **Schema error in extract:** mock extract throws SchemaError → exit 1 + JSONL records the error
- **Partial success:** 3 sessions, 1 fails → exit 1 (binary: any failure → non-zero) + report still written + JSONL records details
- **Unknown flag:** `--foo=bar` → exit 1 + usage to stderr

**Verification:**
- `bun test` passes all Unit 3 scenarios
- Manual: `bun run .config/opencode/scripts/ollama-distill.ts --help` shows usage
- Manual: smoke test producing same outputs as `/tmp/r5-distill-v2.py` Round C against the same samples

---

- [x] **Unit 4: Mise task wrapper + allowlist + compound doc**

**Goal:** Expose pipeline as `mise run distill`; ensure all new files tracked; add the thin post-implementation compound doc capturing only what's net-new from implementation (the Bun/TS WAL-mode SQLite pattern).

**Requirements:** R13 (mise trigger); process step (compound doc per stated flow)

**Dependencies:** Unit 3 (CLI must work first); implementation must be complete to write the compound entry.

**Files:**
- Create: `.config/mise/tasks/distill` (executable Bun-wrapper task)
- Modify: `.dotfiles/.gitignore` (add `.config/mise/tasks/distill` allowlist; verify the plan doc + ts files are also allowlisted; verify `docs/solutions/*.md`)
- Create: `docs/solutions/2026-05-22-bun-sqlite-readonly-wal-pattern.md` (thin compound doc — only captures the Bun-specific WAL/read-only enforcement pattern that wasn't pre-validated by R5 or the brainstorm)

**Approach:**

Task file:
```
#!/usr/bin/env bash
#MISE description="Run local Ollama distillation against recent OpenCode sessions; writes Markdown report to ~/.local/state/ollama-distill/reports/"
#MISE dir="{{cwd}}"
set -euo pipefail
exec bun run "$HOME/.config/opencode/scripts/ollama-distill.ts" "$@"
```

Allowlist entries appended to `.dotfiles/.gitignore`:
```
!/.config/opencode/scripts/ollama-distill.ts
!/.config/opencode/scripts/ollama-distill.test.ts
!/.config/mise/tasks/distill
```

Verify (don't duplicate) entries for `!/.dotfiles/docs/plans/*.md` and `!/.dotfiles/docs/solutions/*.md`.

Make `tasks/distill` executable: `chmod +x .config/mise/tasks/distill`.

Compound doc scope (per F7): NOT a retelling of the brainstorm/plan/memories. Captures only the implementation-discovered pattern: how Bun's `bun:sqlite` honors URI mode + PRAGMA query_only against a live OpenCode WAL database, what the runtime probe pattern looks like, what `busy_timeout` value worked in practice. Approximate length: 1-2 screens. References the plan + memories rather than duplicating them.

**Patterns to follow:**
- `.config/mise/tasks/opencode/doctor` for exact wrapper-script style + header conventions
- AGENTS.md gitignore quirk: even with allowlist entries, may need `git add -f` first commit
- Per the `ce:compound` skill template if invoked: YAML frontmatter + Problem/Solution/Learnings sections

**Test scenarios:**
- Test expectation: none — Unit 4 is config + docs. Verification is structural.

**Verification:**
- `mise tasks ls | grep distill` shows task discovered
- `mise tasks info distill` shows description from `#MISE` header
- `mise run distill --help` runs wrapper successfully and prints CLI usage
- `git --git-dir=$HOME/.dotfiles ls-files | grep -E 'ollama-distill|distill$|bun-sqlite'` shows all 4 new files tracked
- `gitleaks protect --staged` passes on all new/modified files
- Compound doc opens cleanly in `bat`, has YAML frontmatter, references the plan + brainstorm + relevant memory IDs

## System-Wide Impact

- **Interaction graph:** Pipeline is a leaf process. Reads opencode.db (one of multiple concurrent readers). Writes to a dedicated state directory it owns exclusively. No interaction with Magic Context, AFT, or any other plugin.
- **Error propagation:** All errors land in JSONL run log + non-zero exit code. No errors propagate elsewhere.
- **State lifecycle risks:** Cursor.json atomic-write protects against kill-mid-write corruption. Reports/JSONL are append-only.
- **API surface parity:** N/A — no API consumers; CLI flags are the only surface, `--help` is the doc.
- **Integration coverage:** No cross-layer integrations; unit tests + Unit 3 smoke-test verification suffice.
- **Unchanged invariants:**
  - OpenCode session store schema (R17 + Unit 1 read-only verification + schema-invariant check ensures detect + fail-closed)
  - Shell environment (adds one mise task, doesn't modify existing)
  - Magic Context, AFT, OpenCode plugins (no shared state; SQLite WAL coexists with OpenCode's writer by design)

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| OpenCode upgrades `message.data` / `part.data` JSON shape; parser silently produces garbage | Schema-invariant check fails closed on missing columns (Unit 1). Per-session JSON decode failures skip the affected session (R9). If new part types appear, they're logged in stats as unknown skipped_types — visible in JSONL. |
| SQLite WAL checkpoint or busy-write during pipeline run | `PRAGMA busy_timeout=5000` at connection + per-query SQLITE_BUSY/LOCKED retry (3x, 100ms backoff). Transcript SELECT is one quick query per session; not a long transaction. |
| `qwen3:8b` quality regresses on real-world sessions vs R5 sample | Re-validation pattern from R5 is preserved. Marcus can re-run `/tmp/r5-distill-v2.py` (throwaway, recoverable from git history if archived) against fresh samples. Brainstorm's Deferred section names retrieval-first as the persistent-failure pivot. |
| Bun version drift breaks `bun:sqlite` or `Bun.write` API surface (revision-1 F11 partial) | Pipeline is small enough to repair; Bun API stability across minor versions is generally good. If breakage happens, it surfaces immediately (test suite). No production deploy → no urgency. |
| Append-only daily reports + JSONL grow unbounded (revision-1 F10) | Acceptable for v1. Daily report ~5-50KB even with 5 runs/day; 1 year of daily runs <50MB total state. If becomes a problem in v2: add `--rollover` flag or `--max-runs-per-day` cap. |
| Concurrent OpenCode writer + pipeline reader produces inconsistent state across queries (revision-1 F11 partial) | Each query is its own statement; no multi-query transactions in v1 pipeline. WAL mode (which Bun's bun:sqlite supports) means readers see a snapshot at statement boundary. Different sessions' data may be from slightly different OpenCode write states but each session's own messages+parts are atomic. Acceptable for "distill the last few sessions" use case. |
| State directory missing on first run | `mkdir -p` before write. |

## Documentation / Operational Notes

- **README**: None planned for v1. Mise task description + `--help` output are the doc surface.
- **Compound doc** (Unit 4) captures the WAL/read-only pattern only.
- **No rollout, no monitoring, no migration** — local-only tool, single user.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-21-local-ollama-distillation-requirements.md](../brainstorms/2026-05-21-local-ollama-distillation-requirements.md)
- **R5 validated script (throwaway):** `/tmp/r5-distill-v2.py`
- **R5 outputs (throwaway):** `/tmp/r5-outputs-roundC/*.md`
- **Existing CLI utility precedent:** `.config/opencode/scripts/opencode-doctor.ts` + `.test.ts`
- **Existing mise task wrapper precedent:** `.config/mise/tasks/opencode/doctor`
- **Bun SQLite API:** <https://bun.sh/docs/api/sqlite>
- **Ollama HTTP API:** <https://github.com/ollama/ollama/blob/main/docs/api.md>
- **Memory IDs from this session:** 3666 (orchestrator discipline), 3667-3668 (OpenCode SQLite schema + part types), 3670 (qwen3 think=false), 3671 (8B attention degradation + mitigations), 3673 (Ollama install posture), 3675 (read truncation artifacts before claiming about content), 3682 (dotfiles bare-repo docs/ path convention)
