---
title: "Read-only SQLite opens via a file: URI failed on Linux, hidden until the scripts first ran in CI"
date: 2026-08-25
category: database-issues
module: opencode-doctor
problem_type: database_issue
component: tooling
symptoms:
  - "every read-only section failed on ubuntu-latest with `unable to open database file` while the read-write `--execute` path worked"
  - "`Cannot find module '@opencode-ai/sdk'` on a clean checkout, so zero tests ran"
  - "a section that threw rendered as `\"data\": null` in JSON and a bare `null` in text, with exit 1 and no reason given"
root_cause: wrong_api
resolution_type: code_fix
severity: high
related_components:
  - database
  - testing_framework
  - development_workflow
tags:
  - bun
  - sqlite
  - read-only
  - linux
  - ci
  - opencode-doctor
  - ollama-distill
---

# Read-only SQLite opens via file: URI failed on Linux, hidden until the scripts first ran in CI

## Problem

Two Bun test suites under `.config/opencode/scripts/` had never run in any CI workflow. Both were green on macOS. Wiring them into a `Script Tests` job on `ubuntu-latest` exposed four independent defects in the same change, the largest being that every read-only database open failed on Linux.

## Symptoms

- `Cannot find module '@opencode-ai/sdk'` — the module could not import at all, so zero tests ran.
- `unable to open database file` from every read-only section, while the read-write `--execute` path worked normally. That asymmetry is the signature.
- Failed sections printed `"data": null` in JSON and a bare `null` in text, with exit code 1 and no reason anywhere.

## What Didn't Work

**Reading the CLI help as the authority on behavior.** It disagreed with the implementation, and trusting it produced a documentation fix that was itself wrong.

**Adding `PRAGMA query_only=ON` to the doctor's read-only helper.** It broke the prune dry-run with `attempt to write a readonly database`, because `estimateReclaim` builds temp tables. A connection can be read-only with respect to the main database and still need temp writes.

**Claiming text output already handled section errors.** The commit that fixed the JSON emitter asserted this in its message. It was false — `renderSection` read only the error nested inside section data, never `SectionResult.error`. Fixing one output path is not evidence about the others.

**A fixture that pre-created the SQLite sidecars.** An earlier `lsof` change treated exit 1 with non-empty stderr as an error, which is right for paths that exist and wrong for paths that do not — and SQLite deletes `-wal`/`-shm` on clean shutdown, exactly when a prune is safe. The integration test called `writeFileSync` on both sidecars before probing, so the suite stayed green while the gate would have refused every clean-shutdown prune.

## Solution

### Open read-only with the flag, not a URI

```ts
// before — fails on Linux
new Database("file:" + dbPath + "?mode=ro", { readonly: true })

// after
function openReadOnlyDb(dbPath: string): Database {
  const db = new Database(dbPath, { readonly: true });
  db.exec("PRAGMA busy_timeout=5000");
  return db;
}
```

Applied to three call sites in `opencode-doctor.ts` and to `openDatabase` in `ollama-distill.ts`. The distiller keeps its stronger guard, which still works without the URI:

```ts
const db = new Database(dbPath, { readonly: true });
db.exec("PRAGMA query_only=ON");
db.exec("PRAGMA busy_timeout=5000");
// probe: CREATE TEMP TABLE must throw, or the connection is not read-only
```

### Load the SDK only when a server is needed

```ts
// before — top-level, on a dependency nothing declared
import { createOpencodeClient } from "@opencode-ai/sdk";

// after — inside startOpencode, with the type erased at build time
const { createOpencodeClient } = await import("@opencode-ai/sdk");
```

The type reference becomes `ReturnType<typeof import("@opencode-ai/sdk").createOpencodeClient>`, erased under `verbatimModuleSyntax`. DB-only paths — including the destructive-operation gate — never reach the import.

### Surface section errors in both output formats

```ts
// text
const error = extracted.error ?? section.error;

// json
label: section.label,
...extractData(section.data),
...(section.error == null ? {} : { error: section.error }),
```

## Why This Works

`readonly: true` maps to `SQLITE_OPEN_READONLY`, which is the actual guard. A `file:...?mode=ro` filename only means anything if SQLite's URI handling is enabled; where it is not, the whole string is taken as a literal path, nothing exists there, and the open fails. That is why reads failed while writes succeeded — only the read path used a URI. Both platforms ran bun 1.4.0, so this is a platform difference in SQLite URI handling, not a version difference.

The error-reporting fixes are what made the rest tractable. Before them, CI reported `data: null` and exit 1 for a failure whose cause was one string away.

## Prevention

- Prefer open flags over URI filenames. `{ readonly: true }` is portable; `?mode=ro` depends on a build option you do not control.
- Do not add `query_only` to a connection that legitimately writes temp tables. Read-only to the main database and read-only to temp storage are different guarantees.
- Every output format needs its own error test. An error visible in one serializer says nothing about the others.
- Fixtures must model lifecycle states, including files that are normally absent. Creating `-wal`/`-shm` because it makes a test convenient removes the case most likely to break.
- Run platform-sensitive scripts on a platform other than the one they were written on.

## Related Issues

- [`docs/solutions/2026-05-22-bun-sqlite-readonly-wal-pattern.md`](2026-05-22-bun-sqlite-readonly-wal-pattern.md) — the layered read-only pattern this code follows. Its URI-mode layer is corrected by this finding.
- [`docs/solutions/2026-08-19-opencode-doctor-quiescence-gate-fail-open.md`](2026-08-19-opencode-doctor-quiescence-gate-fail-open.md) — the `lsof` safety gate whose follow-ups shipped alongside this work.
- marcusrbrown/.dotfiles#2366 — the Bun suites did not run in CI.
- marcusrbrown/.dotfiles#2368 — `lsof` gate follow-ups.
