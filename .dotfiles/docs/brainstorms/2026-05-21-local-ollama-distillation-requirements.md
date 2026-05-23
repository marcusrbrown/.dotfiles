---
date: 2026-05-21
topic: local-ollama-distillation
---

# Local Ollama Distillation Pipeline

## Summary

Tune the Ollama install to fit a memory-constrained M1 Pro and ship a manual-trigger distillation pipeline (v1) that condenses recent OpenCode session activity into a Markdown report Marcus reads. Local model is `qwen3:8b` (current 7-8B SOTA on Ollama, already installed). Input is OpenCode's live SQLite session store at `~/.local/share/opencode/opencode.db`, opened read-only. Output is a Markdown report. **No promotion mechanism, no `ctx_memory` integration, no Magic Context coupling** — v1 is purely a reader's tool. v1 is gated by a validation pass that confirms output is worth reading before any production pipeline code is written.

---

## Problem Frame

Ollama has been installed on this M1 Pro for 19+ months and produces zero value today. The setup was six models totalling 34GB, with four of them stale (19 months) or oversized (`qwen3:14b` doesn't fit alongside OpenCode + Claude Code + browser on 16GB unified memory). The Electron Ollama.app auto-launched at login and kept `ollama serve` running continuously, consuming resident memory on a machine that's already pressured during normal work (~15GB used, ~175MB unused at investigation time). (Setup tuning per R1-R4 has since reclaimed 29GB of disk and removed all autostart mechanisms.)

Meanwhile, OpenCode's session store at `~/.local/share/opencode/opencode.db` (SQLite, 3.7GB on this machine) holds every session, message, and tool-call part from past work. Sessions capture decisions, mistakes, recurring patterns, and reusable rules. Magic Context's historian compacts them into compartments but does not surface them as readable reports. Cross-session learnings get re-derived rather than recovered. Reusable patterns that would be useful to revisit silently stay locked in old session data.

The hardware constrains the cure: local LLMs cannot become another always-on substrate. The pipeline must run opportunistically, produce reviewable artifacts, and fail without blocking primary work. v1 deliberately picks a single input stream, a single trigger, and a single output: a Markdown report. There is no promotion path back into Magic Context, no `ctx_memory` integration, no candidate-memory framing — those mechanisms require LLM tool invocations that don't fit a non-interactive pipeline and add coupling that v1 doesn't need to prove its value. Marcus reads the report, full stop. If the reports are useful, v2 can add integration. If they're not, v1 fails honestly and the work ends.

---

## Actors

- A1. **Marcus**: Runs `mise run distill` when he wants a fresh distillation. Reads the Markdown report. That's it.
- A2. **Distillation pipeline**: Manual-trigger process that reads OpenCode session data from SQLite, invokes Ollama, produces one Markdown report. Exits when done.
- A3. **Ollama daemon (`ollama serve`)**: On-demand only — started by the pipeline if not running, left running for `OLLAMA_KEEP_ALIVE` seconds, then unloads the model.

---

## Key Flows

- F1. **Validation pass (one-time, gates everything else)**
  - **Trigger:** Marcus or planning agent runs the validation script.
  - **Actors:** A1, A3.
  - **Steps:**
    1. Pick 5-10 OpenCode sessions from the SQLite store spanning short/long, recent/older, distinct projects.
    2. Run each through `qwen3:8b` with the v1 distillation prompt.
    3. Marcus reads the generated report blocks by hand.
    4. Qualitative judgement: "Are these reports worth reading?" Pass = yes for the majority. Fail = no, mostly noise/hallucination.
  - **Outcome:** Project proceeds to F2 if validation passes. Project ends or pivots (e.g., to the retrieval-first reframe in Deferred) if validation fails. No production pipeline code is written until F1 passes.

- F2. **Manual distillation run**
  - **Trigger:** Marcus runs `mise run distill` (optionally with `--since=<window>` or `--session=<ses_xxx>` flags).
  - **Actors:** A1, A2, A3.
  - **Steps:**
    1. Resolve input window: sessions modified since last successful run, or per flag. Apply the per-run input cap (R7).
    2. Skip-and-exit if no new sessions exist.
    3. Start `ollama serve` if not running.
    4. Invoke `qwen3:8b` per session chunk with the v1 distillation prompt.
    5. Apply the report length cap (R12) — keep top-5 report blocks; remainder optionally summarized in an "also-ran" tail.
    6. Write the Markdown report.
    7. Log run metadata to `~/.local/state/ollama-distill/runs.jsonl`.
  - **Outcome:** Marcus has a fresh report he can open and read.

---

## Requirements

**Setup tuning (already executed in-session; documented here for record)**

- R1. The Electron `Ollama.app` is removed and Ollama is installed via Homebrew formula (`brew install ollama`). No autostart at login, no `brew services start ollama`, no resident daemon. Pipeline starts `ollama serve` on-demand only.
- R2. `OLLAMA_KEEP_ALIVE=30s` is set in `~/.config/bash/exports` so models unload soon after each pipeline run.
- R3. Installed models pruned. `qwen3:8b` is the only blessed text model for this pipeline.
- R4. Setup tuning reclaimed ≥ 16GB of disk in `~/.ollama/models` (actual: 29GB reclaimed; from 34GB to 4.9GB).

**Validation gate (must pass before any pipeline code is written)**

- R5. Before any production pipeline code is built, run F1 (the validation pass) against 5-10 representative OpenCode sessions. Marcus qualitatively scores: "Are these reports worth reading?" Pass requires a majority of the sample to be judged useful (subjective; no numeric precision threshold). The sampling rule used in F1 (recency span, project span, length span) is documented in the validation script for repeatability. If validation fails, the project either pivots (different prompt, different stream, retrieval-first reframe — see Deferred) or ends — no production pipeline build-out happens.

  **Status (2026-05-21): PASSED.** Round C run produced 7/8 reports judged worth reading (87.5%). Round A baseline was 5/8; Round C iteration added quality-rule prompt patterns (drop forced 5-block min, require specific values/paths/commands in each insight, ban tautologies and topic-paraphrases). The empirical artifacts (`/tmp/r5-distill-v2.py`, `/tmp/r5-outputs-roundC/*.md`) are throwaway; planning lifts the validated prompt + invocation strategy into proper production code. Validated invocation strategy: Ollama HTTP API `/api/chat` with system + user messages, `think: false`, `temperature: 0.3`, `num_ctx: 32768`, transcript wrapped in `<transcript>...</transcript>` XML tags. Two known caveats: (a) model occasionally invents categories outside the allowed 6-label set (saw "Configuration", "Verification") — minor format violation worth tightening in production; (b) meta-work sessions (about restructuring docs) produce weaker reports because source is recursive.

**Pipeline — input**

- R6. v1 ingests one input stream only: OpenCode's SQLite session store at `~/.local/share/opencode/opencode.db`. Pipeline opens the DB **read-only** (`PRAGMA query_only=ON`) with WAL-aware connection settings, joins `session` + `message` + `part` tables (LEFT JOIN part on `part.message_id = message.id`), filters by `WHERE session.time_updated >= <last_run_timestamp> AND session.parent_id IS NULL`, and orders rows by `message.time_created ASC, part.time_created ASC, part.id ASC` for stable chronological traversal. The text content lives in `part.data` (NOT `message.data` — `message.data` is envelope metadata: `role`, `time`, `agent`, `model`). Per-part-type filter for v1:
  - **Included** — `text` parts (`data.text` content) and `reasoning` parts (`data.text` content). Each emitted line is prefixed with the message role (USER:/ASSISTANT:) read from `message.data.role`.
  - **Excluded** — `file`, `source-url`, `snapshot`, `patch` parts (binary or diff-heavy, low signal per byte) and `tool-invocation`, `subtask`, `agent`, `step-start`, `step-finish`, `compaction`, `retry` parts (structured context, deferred to v2).
  - Subagent transcripts (sessions with `parent_id IS NOT NULL`) are deferred to v2 along with GitHub PR review history, Fro Bot daily report digests, and the excluded part types.
  - Schema in use (verified against OpenCode v1.15.5 source via `@explorer`):
    - `session(id, project_id, parent_id, title, agent, model, time_created, time_updated, ...)` — 21 columns total
    - `message(id, session_id, time_created, time_updated, data TEXT)` — `data` is envelope metadata only (`role`/`time`/`agent`/`model`)
    - `part(id, message_id, session_id, time_created, time_updated, data TEXT)` — `data.type` discriminator; text content in `data.text` for `text`/`reasoning` types
    - Indexes used: `session_project_idx`, `session_parent_idx`, `part_session_idx` (and implicit `part.message_id` index via FK)
- R7. Pipeline enforces a per-run input cap of **N=50 sessions OR cumulative `len(message.data) ≤ 1.5 MB`, whichever is smaller**, regardless of how many sessions match the recency filter. This protects against first-run / long-gap explosions. Excess sessions are deferred to the next run (cursor advances to the oldest unprocessed session, not to `now()`). Caps are configurable but the defaults stand for v1.
- R8. When no new sessions exist since the last successful run AND any pending-from-overflow cursor is empty, the pipeline exits clean without invoking the model.
- R9. Pipeline handles known SQLite read failure modes explicitly: `SQLITE_BUSY` and `SQLITE_LOCKED` are retried (3 attempts, 100ms backoff) before being logged as a skipped session; `SQLITE_SCHEMA` is treated as fatal and aborts the run with an actionable error (likely caused by OpenCode upgrade — pin and re-test). JSON decode failures in `message.data` log the offending session ID and continue with the next session.

**Pipeline — model**

- R10. Pipeline uses `qwen3:8b` (Q4_K_M quantization, ~5.2GB) as its sole model in v1. Model identity is the v1 default, not a permanent commitment.
- R11. Pipeline invokes the model with `num_ctx` sized to the input batch but never exceeding 32K tokens (per `@librarian` recommendation for safe memory pressure on 16GB).

**Pipeline — output**

- R12. Pipeline writes one Markdown report per run to a configurable local path (default: TBD per Outstanding Question OQ2). If the file exists, the new content appends with a timestamped subheading. The report contains at most 5 report blocks (top-5 by length/specificity heuristic). Additional blocks above the cap are either summarized in an "also-ran" tail or omitted (pipeline's choice per planning). This is a readability/scannability constraint, not a safety one — there's no downstream system to protect.

**Pipeline — trigger**

- R13. A `mise run distill` task runs the pipeline on-demand from any shell. Accepts `--since=<window>` and `--session=<ses_xxx>` flags. **v1 has no scheduled trigger.** A launchd job is explicitly deferred to v2 pending validation that the manual-only flow produces enough value.

**Reliability and observability**

- R14. Each run produces a JSONL line at `~/.local/state/ollama-distill/runs.jsonl` recording: timestamp, sessions read, sessions deferred to next run (overflow), report blocks generated, report blocks included after cap, report path, duration, success/failure, error context if failed.
- R15. Pipeline runs best-effort: failures in input collection, model invocation, or report writing log the failure to the JSONL run record and complete with whatever output was produced; the run never blocks other work on the machine.

**Privacy and DB safety**

- R16. No input collected by the pipeline is sent to any cloud service. All processing happens locally via Ollama.
- R17. Pipeline never writes to `opencode.db`. SQLite connection is opened with `PRAGMA query_only=ON`; planning verifies the chosen runtime (Bun's `bun:sqlite` or Python `sqlite3`) enforces this at the connection layer and fails closed if the pragma can't be set.
- R18. The pipeline acquires a file lock before processing to prevent concurrent batch runs from corrupting the cursor or report.
- R19. The JSONL audit log records every distillation run (batch and session mode) so all activity is auditable from one place.
- R20. `--session <id>` mode does not advance the cursor and does not acquire the run lock, so a single-session distillation is safe to run alongside a normal batch. It still writes to the JSONL audit log so all distillation activity is auditable from one place.

---

## Acceptance Examples

- AE1. **Covers R5.** Given the validation pass (F1) is run against 8 OpenCode sessions, when Marcus reads the report blocks, fewer than 5 are judged "worth reading." Validation fails. No production code is written; project is reopened to brainstorm a different prompt, different stream, or retrieval-first reframe.

- AE2. **Covers R7.** Given the SQLite recency filter matches 120 sessions modified since the last successful run, when the pipeline processes them, it consumes the first 50 (per R7 cap), records the remaining 70 as "deferred to next run" in the JSONL record, and the next-run cursor advances to the timestamp of the 50th session (not to `now()`).

- AE3. **Covers R8.** Given the pipeline ran successfully an hour ago, no new sessions have been modified since, and the deferred-overflow cursor from R7 is empty, when Marcus runs `mise run distill` again, the pipeline exits clean within seconds without starting `ollama serve` or invoking the model, and logs the skip to the JSONL run record.

- AE4. **Covers R9, R15.** Given the model produces 12 report blocks in one run and the pipeline encounters a `SQLITE_BUSY` error on one session that doesn't resolve after 3 retries, when the pipeline completes, the report still gets written with top-5 blocks from the 2 successful sessions, the JSONL run record marks success=false with the busy-error context, and the run does not block any other work.

- AE5. **Covers R12.** Given the pipeline runs against 3 sessions and the model produces 9 report blocks, when the run completes, the Markdown report contains exactly 5 blocks (top-5 per R12), and either an "also-ran" tail with the remaining 4 or no mention of them, per the planning-chosen behavior.

---

## Success Criteria

- **Validation gate (R5) passed on 2026-05-21.** Round C run (qwen3:8b + `think=false` + system-message prompt with quality rules + `<transcript>` XML delimiters + lower temperature + output prefix priming) produced 7/8 reports judged worth reading. 100% format pass-rate. Known weakness: meta-work sessions (e.g., restructuring an AGENTS.md or other documentation) produce weaker reports because the source content itself is recursive — block insights end up paraphrasing the topic. This is acceptable for v1; future-Marcus reading a report on a meta-work session will recognize the limitation by category.
- **Marcus runs `mise run distill` at least 5 times in the first two weeks after launch** — the manual-trigger version of "is this actually useful?"
- **After 4 weeks, Marcus's qualitative answer to "would you keep using this?" is yes.** Subjective; no numeric proxy. This replaces the round-1/2 brainstorm's "≥5 manual promotions" success criterion, which depended on a promotion path that's been cut.
- Total disk usage of `~/.ollama/models/` stays at or below 8GB (current: 4.9GB) after R1-R4 setup tuning.
- No occurrence of "pipeline broke my OpenCode session" or "pipeline made the machine swap" — the on-demand-only resident-memory posture is preserved.
- No occurrence of "pipeline wrote to opencode.db" — R17 holds.
- Planning can proceed without inventing input source paths, output destination, model configuration, scope, or success criteria. All are pinned in this doc.

---

## Scope Boundaries

### Deferred for later

- **Integration with Magic Context (`ctx_memory`, candidate memories, promotion path).** v1 is read-only Markdown reports; no agent-tool invocations, no `ctx_memory` writes, no `CANDIDATE_*` namespace. v2 path is mechanically clean: invoke `opencode -p "<prompt that asks for a ctx_memory(action=\"write\", ...) call for this block>"` per block to promote, since OpenCode supports non-interactive prompt invocation from the CLI. v2 gate: reports prove useful AND Marcus explicitly wants the automation.
- **Retrieval-first reframe.** The SQLite session store's rich metadata (`project_id`, `agent`, `parent_id`, `model`, `time_*`, token counts) plus FTS over `message.data` enables a different product shape: "find me the session where I solved X" instead of (or alongside) report-style distillation. Natural v2 direction AND the natural pivot if R5 validation fails. The SQLite migration that forced R6's correction makes this materially cheaper to build than the JSON-walk version would have been — worth keeping in scope as a fallback even if v1 distillation succeeds.
- **Subagent (parent_id) traversal.** v1 reads only top-level sessions. Subagent transcripts via `session.parent_id` join are deferred to v2.
- **Tool-call and tool-result content** from the `part` table. Excluded from v1 for byte/signal efficiency; reachable in v2 via `part_session_idx` if quality requires it.
- **OpenCode subagent transcripts as an additional input stream.** v2 if v1 proves out.
- **GitHub PR review history as an input stream.** v2 if v1 proves out.
- **Fro Bot daily report digests as an input stream.** v2 if v1 proves out.
- **Scheduled trigger (launchd nightly).** v2 if v1 manual-trigger usage proves the pattern. Defers all the operational-risk findings (battery, sleep, cold-start budget, CPU pre-conditions) along with it.
- **Two-stage model pipeline (3-4B filter + 7-8B synthesizer).** v2 if v1 quality is empirically insufficient.
- **Grammar-constrained decoding (xgrammar/outlines) for structured output reliability.** v2 if v1 structured-output reliability becomes a problem.

### Outside this product's identity

- **No web tasks.** Cloud models win decisively; not in scope.
- **No screen reading.** Vision-model + agent-runtime + macOS permissions = trap.
- **No file organization.** Local model tool-calling is too weak; irreversible mistakes too costly.
- **No PR/commit message drafting.** Existing cloud-agent flow is better; this pipeline is not a writing assistant.
- **No replacement of AFT's local ONNX embeddings.** AFT works today; switching to Ollama embeddings is a separate decision.
- **No tool-calling, agentic behavior, or multi-turn reasoning in the model invocation.** Single-prompt, single-response per input chunk.
- **No local model fallback for cloud-rate-limited tasks.** Two prompt profiles is double burden.
- **No interactive chat UI on top of local models.** Not building an Ollama-WebUI substitute.

---

## Key Decisions

- **v1 produces a Markdown report; that's all.** No promotion path, no `ctx_memory` integration, no candidate-memory framing, no Magic Context coupling. `ctx_memory` is an MCP tool callable only by an LLM inside an OpenCode/Claude session, so a CLI pipeline reaches it by spawning a one-shot `opencode -p "<prompt>"` invocation per block — mechanically clean but extra scope v1 doesn't need to prove its value. v2 layers that on if reports prove useful AND Marcus wants the automation; the design has a known shape, not a blocker.

- **Pipeline reads `message.data` from OpenCode's SQLite session store, not the legacy JSON tree:** The JSON tree at `~/.local/share/opencode/storage/{session,message,part}/` was migrated to SQLite on 2026-02-18 and is no longer the canonical store. SQLite is materially easier to filter (indexed `time_updated`, single-column subagent linkage via `parent_id`) than walking JSON files would have been.

- **Validation gate as Step 0 (R5):** v1 must prove output quality on 5-10 sample sessions before any production code is written. Qualitative pass/fail (subjective: "worth reading?"), not numeric precision. Earlier rounds tried 50% then 70% precision thresholds; both were arbitrary given how subjective "useful report block" is. Marcus's read of the sample is the signal.

- **Per-run input cap with overflow cursor (R7):** Addresses the round-2 feasibility finding that `WHERE time_updated >= <last_run>` alone can blow up on first run or long-gap backfill. Hard cap at N=50 sessions OR 1.5MB cumulative, whichever hits first; deferred sessions roll into the next run.

- **Explicit SQLite failure-mode handling (R9):** Addresses the round-2 finding that `PRAGMA query_only=ON` alone isn't a complete concurrency spec. `SQLITE_BUSY`/`SQLITE_LOCKED` retry with backoff; `SQLITE_SCHEMA` aborts as fatal (signals OpenCode upgrade); JSON decode failures continue past the affected session.

- **Single input stream for v1 (R6):** OpenCode session transcripts only. Subagent, PR history, Fro Bot reports deferred to v2 to bound complexity and isolate the v1 signal-quality question.

- **Manual trigger only for v1 (R13):** Defers launchd job, battery/CPU pre-conditions, sleep-wake behavior, and cold-start budget concerns to v2. Validates the workflow first; automates only if there's a workflow worth automating.

- **Report length cap of 5 blocks (R12):** Readability/scannability constraint, not a memory-protection constraint (no memory to protect). Earlier rounds framed this as a "safety cap on writes"; with writes removed, it's just "the report should be readable in 2 minutes."

- **Single-stage model invocation for v1, not two-stage:** Oracle proposed 3-4B-filter + 7-8B-synthesizer for best quality-per-resource. Adopting it adds pipeline complexity before the single-stage baseline has been validated. Defer until v1 quality is empirically insufficient.

- **`qwen3:8b` (Q4_K_M) is the v1 default model:** `@librarian` confirmed it is the current 7-8B SOTA on Ollama as of 2026-05-21. Qwen 3.5 and 3.6 exist but skip the 7-8B size class entirely. Validation gate may discover quality requires Modelfile/prompt tuning.

- **`OLLAMA_KEEP_ALIVE=30s` is non-negotiable:** Memory-pressure reality on 16GB. Default 5-minute keep-alive holds 5GB resident long after the pipeline finishes.

- **Architectural posture: Ollama as `ffmpeg`, not as a substrate:** On-demand only, no always-loaded model, no Electron app, no interactive dependency. The pipeline produces a reviewable artifact and fails without blocking primary work.

- **Canonical terminology: "report block".** Earlier rounds drifted between "candidate memory" / "candidate block" / "memory candidate." With the promotion concept cut, the unit is unambiguously a section in the Markdown report — "report block."

---

## Dependencies / Assumptions

- Assumes `qwen3:8b` quality is good enough to produce report blocks worth reading on M1 Pro 16GB. **Risk acknowledged:** `@librarian` notes "moderate hallucination rate in summarization" and "moderate JSON/structured output reliability without grammar-constrained decoding." Mitigation: the validation gate (R5) catches this before any production code is written. Additional mitigation: v1 is read-only Markdown — hallucinations land in a report Marcus reads, not in a memory store, so noise is filtered at read time, not after the fact.

- Assumes OpenCode's `message.data` JSON shape is stable enough across the minor versions Marcus will run during v1's life. **Risk acknowledged (round-2 finding):** the blob is unversioned; OpenCode 1.16 could change `role`, tool-call nesting, etc. Mitigation: planning pins the OpenCode version v1 is validated against (currently 1.15.5); the pipeline records the detected OpenCode version (from the binary or DB metadata) in each run's JSONL log so silent rot is detectable. If the parser hits an unrecognized shape, the affected sessions are logged as skipped (R9 JSON-decode behavior).

- Assumes SQLite concurrency between OpenCode (writer) and the pipeline (reader) is well-behaved under WAL mode + `PRAGMA query_only=ON` + R9's explicit error handling. Planning verifies on real workloads during validation.

---

## Outstanding Questions

### Resolve Before Planning

(None. The premise was nailed down through five review passes plus the manual-step cut.)

### Deferred to Planning

- **OQ1.** [Affects R12][User decision] Where should the Markdown report land? Default to a non-Obsidian markdown path like `~/notes/daily/` or `~/.local/share/ollama-distill/reports/` unless Marcus specifies an existing vault path.
- **OQ2.** [Affects R10, R11, R5][Needs research] Does `qwen3:8b` need any specific Ollama Modelfile tuning (system prompt, stop sequences, temperature, top_p) for this pipeline's use case? Investigated as part of the validation gate (R5).
- **OQ3.** *(Resolved during R5 prep via explorer source citation and direct SQLite probe.)* `message.data` is envelope metadata only (`role`/`time`/`agent`/`model`); text content lives in `part.data` as `data.text` for `type=text` and `type=reasoning` parts. Pipeline reads JOIN of message + part with the v1 part-type filter (R6). Planning still resolves per-runtime concerns: (a) JSON path extraction via `bun:sqlite` JSON functions vs runtime parse, and (b) graceful handling of part types not yet seen (treat as skip + log).
- **OQ4.** [Affects R6, R17][Technical] Bun's `bun:sqlite` vs Python's `sqlite3`: which has cleaner WAL read-only semantics, JSON extraction ergonomics, and error-handling hooks for R9's `SQLITE_BUSY`/`SQLITE_LOCKED`/`SQLITE_SCHEMA` cases? Planning picks based on a small benchmark.
- **OQ5.** [Affects R12][User decision] "Also-ran" tail in the report (showing the blocks above the top-5 cap) or omit them entirely? Planning's call after seeing example outputs.

---

## Pipeline shape (visual aid)

```
                          ┌─────────────────────────┐
                          │   VALIDATION GATE (R5)  │
                          │                         │
                          │   Sample 5-10 sessions  │
                          │   Run qwen3:8b prompt   │
                          │   Marcus reads output   │
                          │                         │
                          │   Worth reading?        │
                          │     yes → continue      │
                          │     no  → stop / pivot  │
                          └────────────┬────────────┘
                                       │
                            (gates everything below)
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    INPUT (read-only SQLite)                          │
│                                                                      │
│    ~/.local/share/opencode/opencode.db                               │
│                                                                      │
│    SELECT m.data, p.data FROM session s                              │
│    JOIN message m ON m.session_id = s.id                             │
│    LEFT JOIN part p ON p.message_id = m.id                           │
│    WHERE s.time_updated >= <last_run_timestamp>                      │
│      AND s.parent_id IS NULL                                         │
│    ORDER BY m.time_created, p.time_created, p.id                     │
│    LIMIT N=50 sessions OR 1.5MB cumulative text (R7)                 │
│                                                                      │
│    Filter parts: include type=text/reasoning, skip the rest          │
│    (text content = p.data.text; m.data.role = USER/ASSISTANT label)  │
│    PRAGMA query_only=ON; SQLITE_BUSY/LOCKED retried,                 │
│      SQLITE_SCHEMA fatal — R9                                        │
└────────────────────────────────┬─────────────────────────────────────┘
                                 │
                                 ▼
              ┌──────────────────────────────────────────┐
              │   DISTILLATION PIPELINE (manual only)    │
              │                                          │
              │   Trigger: `mise run distill`            │
              │                                          │
              │   1. Skip if no new input + no overflow  │
              │   2. Start `ollama serve` (if needed)    │
              │   3. Invoke qwen3:8b per session chunk   │
              │   4. Apply top-5 length cap (R12)        │
              │   5. Write Markdown report               │
              │   6. Log run metadata to JSONL           │
              │                                          │
              │   NO writes to opencode.db (R17)         │
              │   NO ctx_memory writes (no promotion)    │
              └────────────────────┬─────────────────────┘
                                   │
                                   ▼
                ┌────────────────────────────────────────┐
                │   Markdown report                      │
                │   (path per OQ1)                       │
                │                                        │
                │   ## Report (top 5 blocks)             │
                │     - block 1                          │
                │     - block 2                          │
                │     - ...                              │
                │                                        │
                │   ## Also-ran (optional — OQ5)         │
                │     - ...                              │
                │                                        │
                │   Marcus reads it. End of v1.          │
                └────────────────────────────────────────┘
```

---

## What planning still has to figure out

- Report destination (OQ1).
- Modelfile/prompt tuning during the validation gate (OQ2).
- `message.data` JSON parser (OQ3).
- Implementation language + SQLite runtime choice (OQ4) — `bun:sqlite` and Python `sqlite3` are the natural candidates.
- "Also-ran" tail inclusion (OQ5).
- The validation gate's distillation prompt itself — first deliverable.
- Markdown report formatting: block structure, headings, source-session linkage in each block (e.g., session id + title) so Marcus can dig into the source if a block is intriguing.
- The "length/specificity heuristic" used to pick top-5 blocks (R12).
- OpenCode-version detection mechanism for the JSONL run log (round-2 hardening for `message.data` drift).
