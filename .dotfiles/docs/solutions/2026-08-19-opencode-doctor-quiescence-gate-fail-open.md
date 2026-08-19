---
title: Destructive-operation gate failed open because pgrep cannot see the OpenCode process tree from inside it
date: 2026-08-19
category: logic-errors
module: opencode-doctor
problem_type: logic_error
component: tooling
symptoms:
  - "`pgrep -f opencode` and `pgrep -x opencode` returned no matches from inside an OpenCode session while `ps` listed the same PIDs plainly"
  - "the quiescence gate reported `safe: true` with the database actively held open"
  - "`--prune-older --execute` and `--set-incremental-vacuum` were cleared to run against a live 68 GB database"
  - "importing the module from the test suite executed the entire CLI and spawned a server"
root_cause: wrong_api
resolution_type: code_fix
severity: critical
related_components:
  - database
  - development_workflow
  - testing_framework
tags:
  - opencode-doctor
  - pgrep
  - lsof
  - fail-open
  - safety-gate
  - process-detection
  - sqlite
  - import-meta-main
---

# Destructive-operation gate failed open because pgrep cannot see the OpenCode process tree from inside it

## Problem

`opencode-doctor` refuses to run its irreversible operations — `--prune-older --execute`, `--prune-events-older --execute`, `--set-incremental-vacuum` — while another process is using the OpenCode SQLite database. That interlock detected activity with `pgrep -f "opencode"` and treated exit code 1 as "nothing running, safe to proceed".

`pgrep` cannot see the OpenCode process tree from a process running inside it. Because the doctor is normally invoked from within a session (`mise run opencode:doctor`), the gate reported "safe" and cleared destructive operations against a live ~68 GB database.

## Symptoms

- Every `pgrep` variant returned empty from inside a session, while `ps` listed the same PIDs.
- The gate returned `{safe: true, count: 0}` with the database open.
- Destructive prune and vacuum operations passed the gate unimpeded.
- Test runs produced an unreadable report dump instead of a test summary.

Measured at a single instant, with the TUI at PID 75090 (`ucomm=opencode`) and its `harness` parent at 75084:

```text
pgrep -f opencode              -> (empty) rc=1
pgrep -x opencode              -> (empty) rc=1
pgrep -f harness-darwin-arm64  -> (empty) rc=1
pgrep .  | grep -x 75090       -> NOT PRESENT   (603 processes enumerated)
pgrep -x Finder                -> 622 rc=0
ps -ww -eo pid,ppid,ucomm,command -> both PIDs listed plainly
```

The blindness is contextual, not global. From a clean Terminal window the same command works:

```text
pgrep -f opencode -> 2661 2662 75090 (rc=0)
```

## What Didn't Work

**Assuming `pgrep -f` only misses argv-less processes.** A spawned `harness serve --hostname=... --port=...` child *was* matched while the bare TUI was not, which made argv matching look like the variable. Refuted: PID 75090 has arguments (`-s ses_...`) and was still invisible, and `pgrep -x` matches on process name without touching argv — it missed the process too.

**Unioning three `pgrep` probes.** A second attempt combined `pgrep -f opencode`, `pgrep -x opencode`, and `pgrep -x harness`, deduplicating PIDs and failing closed if any probe errored. It was written, unit-tested, and staged before being discarded: all three probes are blind in the same execution context, so the union added code without adding evidence.

Both attempts shared a mistake — reasoning about *why* a probe missed instead of first establishing *what the probe can see at all*. Enumerating every visible PID (`pgrep .` → 603 processes) and finding the targets absent, while `ps` listed them and `pgrep -x Finder` worked, settled it in one command.

## Solution

Ask who holds the file instead of guessing from process names. `lsof` works from exactly the context where `pgrep` fails, and costs ~0.4s on a 68 GB database because it reads the kernel file-descriptor table rather than the file.

Check the database and both SQLite sidecars:

```ts
const paths = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];

for (const path of paths) {
  result = spawnSync(["lsof", "-F", "pc", path]);
  // fail closed on spawn error, unexpected exit code, or unparseable output
}
```

`lsof -F pc` emits `p<PID>` and `c<COMMAND>` records interleaved with `f<FD>` lines, repeating a PID across descriptors. A holder is only recorded on a valid `c` following a valid `p`, and anything that breaks that sequence is unparseable rather than empty:

```ts
if (field === "p") {
  if (!/^\d+$/.test(value)) return null;
  const pid = Number(value);
  if (!Number.isSafeInteger(pid) || pid < 1) return null;
  if (currentPid != null && currentCommand == null) return null; // p with no c
  currentPid = pid;
  currentCommand = null;
} else if (field === "c") {
  if (currentPid == null || value === "" || currentCommand != null) return null;
  currentCommand = value;
  holders.set(currentPid, {pid: currentPid, command: value});
} else if (field === "f") {
  if (currentPid == null || currentCommand == null || value === "") return null;
} else {
  return null; // unknown field -> unparseable -> refuse
}
```

The strictness is the point: a malformed record stream must be distinguishable from an empty one, because the empty case is what clears a destructive operation to run.

Exclude only the doctor's own PID, and refuse if anything else remains:

```ts
if (holder.pid !== ownPid) holdersByPid.set(holder.pid, holder);

const holders = [...holdersByPid.values()];
return {safe: holders.length === 0, count: holders.length, pids, holders};
```

Refusals name the holders, which makes them actionable:

```text
Found 1 process(es) holding the OpenCode database: opencode (PID 4444).
Close all OpenCode instances and re-run.
```

`pgrep` was removed entirely, along with `classifyPgrepExitCode`.

### Entrypoint guard

A second defect surfaced while verifying the first. The module called `main()` unconditionally at top level, and the test suite imports the module, so every test run executed the whole CLI — spawning a server and burying the summary under report output. It also corrupted a verification probe: importing the module spawned a server that then opened the database, producing a self-contradictory reading where the gate reported no holders and a refusal named a PID that had not existed moments earlier.

```ts
if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(`OpenCode doctor failed: ${formatErrorMessage(error)}`);
    process.exit(1);
  });
}
```

Test output went from an unreadable dump to `84 pass, 0 fail, 319 expect() calls`.

## Why This Works

`pgrep` answers "what processes match this name, among those I can see" — and the visible set depends on the calling context. It returned an empty set rather than an error, which is indistinguishable from a genuinely idle machine.

`lsof` answers the actual question: which processes hold these files right now. It catches holders that no name heuristic would, which is not hypothetical — a `magic-context-dashboard` process was observed holding the database alongside OpenCode. Any holder counts; there is no name filtering, because name filtering is the assumption that failed.

Exit code 1 with empty output means no holders. Every other outcome — spawn failure, unexpected exit code, malformed record, unknown field — refuses.

Note that `main()` short-circuits to a DB-only path when any database flag is present, so destructive operations never spawn a server and the gate cannot block on a process the doctor itself created.

## Prevention

- **Safety gates fail closed.** A check that reports "nothing found" when it cannot see is worse than no check, because it converts an unsafe state into an affirmative green light.
- **Validate detection in the context where it runs.** This gate worked from a terminal and failed from inside a session. Testing it anywhere other than its real invocation context would have confirmed the wrong thing.
- **Prefer direct evidence over proxies.** "Who holds this resource" beats "what processes are named" every time. When a proxy fails, adding more proxies of the same kind adds no information.
- **Establish what an instrument can see before theorizing about why it missed something.**
- **Guard module entrypoints** with `import.meta.main` so importing for tests does not execute the CLI.
- **Keep verification probes non-perturbing.** A probe that spawns a server, opens the database, or otherwise becomes a holder is measuring itself.
- **Mocked tests cannot prove a detection method sees reality.** The unit tests here inject the spawn function, which validates parsing and refusal logic but never runs `lsof` against a real held file — the exact property that failed in production.

## Related Issues

- `docs/solutions/2026-06-25-opencode-sqlite-db-bloat-prune-vacuum.md` — the retention and reclaim side of the same maintenance surface. That doc covers what the destructive operations do; this one covers whether they are allowed to start.
- `docs/solutions/2026-05-22-bun-sqlite-readonly-wal-pattern.md` — reading the same live database without disturbing the writer.
- marcusrbrown/.dotfiles#2366 — the Bun test suites under `.config/opencode/scripts/` do not run in CI.
- marcusrbrown/.dotfiles#2368 — follow-ups: no non-mocked holder test, `lsof` exit 1 with empty stdout is assumed to mean "no holder" though `lsof` also returns 1 on permission errors, `lsof` availability in the devcontainer is unverified, and a time-of-check/time-of-use window remains.
