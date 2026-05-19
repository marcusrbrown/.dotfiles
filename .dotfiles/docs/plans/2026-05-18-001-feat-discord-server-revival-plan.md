---
title: Discord Server Revival — Project-Organized Workspace + Gateway Host
type: feat
status: active
date: 2026-05-18
deepened: 2026-05-18
origin: .dotfiles/docs/brainstorms/2026-05-18-discord-server-revival-requirements.md
---

# Discord Server Revival — Project-Organized Workspace + Gateway Host

**Target repo:** This plan spans three repos. Most work lives outside `.dotfiles` itself:
- `.dotfiles` (this repo) — the plan document, OpenCode MCP server configuration for the admin-agent path, runbooks (under `.dotfiles/docs/`)
- `fro-bot/agent` (https://github.com/fro-bot/agent) — code change to `packages/gateway/` (intent-posture flip only; R20/R21 enforcement deferred to a follow-up plan owned by `fro-bot/agent`)
- `marcusrbrown/infra` (parallel work in progress) — gateway-app deployment (out of scope here, sequenced via dependency)

All file paths in the plan are repo-relative to their respective repo. The plan document and dotfiles changes live in `.dotfiles`.

## Overview

Revive a dormant Discord server as a project-organized workspace. Restructure channels by project rather than tier. Stand up per-project roles for collaboration access. Modernize moderation via Discord-native AutoMod. Update the Fro Bot gateway's intent posture so it complies with the minimum-permission requirements before any production deploy. Publish an AI disclosure document before any privileged-intent activation. Deployment of the gateway daemon itself is owned by `marcusrbrown/infra`.

## Problem Frame

The server is dormant, member-pruned, and structurally stale (channels named `#general`, `#internal`, `#team` plus a working `#fro-bot` integration channel). Discord has changed substantially since 2016 — AutoMod, Community Mode, privileged intents, slash commands, Onboarding. Separately, the `fro-bot/agent` gateway daemon (discord.js 14.26.4, slash commands, mention handling, Compose deploy) has no home to run in. The server is the natural target, but it needs a structure that supports per-project access roles and a minimum-permission posture before the bot lands.

Origin: `.dotfiles/docs/brainstorms/2026-05-18-discord-server-revival-requirements.md` (24 requirements, 6 AEs).

## Requirements Trace

This plan implements requirements **R1–R24** from the origin document. Critical groupings:

- **Audit + archive (R1–R4):** Read-only enumeration of server state; offline export of the 3 original channels' content AND the `#fro-bot` channel's history (4 archive files); preserve `#fro-bot` integration live per R4.
- **Structural modernization (R5–R9):** Community Mode, project-organized channels, per-project roles, AutoMod baseline, minimal Onboarding.
- **Gateway deployment contract (R10–R12):** OAuth scopes, Bot Token auth, opt-in privileged intents. Implementation owned by `infra`.
- **AI disclosure (R13–R14):** Pinned disclosure document covering bots, intents, retention, appeals, AND admin-agent message-body processing.
- **Operational safety (R15–R24):** Admin-agent action discipline; single-writer rule with the gateway; token lifecycle; admin-agent data handling; permission-drift detection; prompt-injection minimum envelope; gateway intent code flip; audit fail-closed rule; MCP supply-chain hygiene.
- **LLM data-processing disclosure + tracked-doc hygiene (R25 — added during deepening):** No real Discord user message bodies may be committed to dotfiles-tracked disclosure/runbook examples. Disclosure must identify the LLM providers actively used by the admin-agent path and the gateway daemon path **at the time of launch**, including whether content may be retained, reviewed, or used for training. Future provider/router changes trigger a disclosure-review prerequisite (not a standing scope expansion). This is a deepening-time addition; the origin doc captures the spirit of this requirement in R19 + Unit 7's disclosure scope but does not name it explicitly.
- **Disclosure-freshness check (R26 — added during plan document-review):** Before any change to gateway intents (`MessageContent`, `GuildMembers`) or LLM provider/routing, the disclosure document MUST be compared to the proposed new state. If the disclosure does not already cover the proposed configuration, disclosure update is a prerequisite before the configuration change ships. Enforcement at launch is procedural (Marcus + admin agent checklist before any `infra` deploy or gateway config change); automated drift detection between live gateway config and pinned disclosure is a follow-up.
- **Release-order discipline across repos (R27 — added during plan document-review):** PRs across the 3 repos (`.dotfiles`, `fro-bot/agent`, `marcusrbrown/infra`) merge in an explicit order: (1) `fro-bot/agent` Unit 9 (intent-posture flip) merges FIRST, (2) `.dotfiles` plan + disclosure + runbooks merge SECOND, (3) `marcusrbrown/infra` deploy merges LAST. If `.dotfiles` ships before Unit 9, the disclosure asserts behavior the gateway does not yet enforce. If `infra` deploys before Unit 9, the gateway comes up with the wrong default intents.
- **R15c enforcement clarification (added during plan document-review):** R15c (type-confirm for irreversible actions) is enforced procedurally by the admin agent's runbook discipline and per-action confirmation prompts, NOT by an automated technical control at the MCP-server layer (the MCP server cannot enforce typed confirmation independent of the OpenCode session's prompt flow). The control is real but human-mediated; this is acceptable for a one-shot admin-agent workflow but not for autonomous tooling.

## Scope Boundaries

- Server-side restructure (channels, roles, AutoMod, Onboarding, disclosure) executed via the admin-agent path
- `.dotfiles` changes for OpenCode MCP server configuration (the admin-agent path's tooling)
- `.dotfiles` runbooks for token lifecycle, "add a new project" procedure, and permission-drift checks
- `fro-bot/agent` code change to flip privileged-intent posture from on-by-default to opt-in-via-config (R22 + the channel-policy declaration that R20/R21 reference)
- Offline archive of the 3 original channels' content + the `#fro-bot` integration channel's history (created by admin agent; stored outside the dotfiles repo). `#fro-bot` is also preserved live per R4; the archive is a separate snapshot of its history.

### Deferred to Separate Tasks

- Gateway daemon hosting + deployment → owned by `marcusrbrown/infra` (gateway-app)
- **Gateway-side R20/R21 enforcement** (channel-policy file, refusal patterns, rate limit, drift refusal, allowed-external-API allowlist) → scope-split to a follow-up plan in `fro-bot/agent`. This plan ships only the minimum handoff: R22's intent-posture flip in Unit 9.
- **Token + secret lifecycle runbook (R18 implementation)** → owned by `marcusrbrown/infra`. This plan ships only a pointer note (Unit 11) so admin-agent sessions know where the canonical runbook lives.
- New gateway features beyond the intent-posture flip → owned by `fro-bot/agent`
- Final prompt-injection tuning beyond R21's minimum envelope → gateway-side ADR
- Discord MCP server containerization for repeatable invocation → optional follow-up if the one-off OpenCode-session model proves limiting

## Context & Research

### Relevant Code and Patterns

In `fro-bot/agent` (paths repo-relative to that repo's root):

- `packages/gateway/src/discord/client.ts:10-14` — `DEFAULT_INTENTS` includes `MessageContent` + `GuildMembers` by default. R22 flips this to opt-in.
- `packages/gateway/src/main.ts:48-111` — daemon entrypoint, slash-command registration, login flow.
- `packages/gateway/src/discord/mentions.ts` — mention handling pattern (relevant to R21's mention-only restriction).
- `packages/gateway/AGENTS.md:49-53` — secret loading pattern `${NAME}_FILE` then `process.env[name]`.
- `deploy/compose.yaml:16-40` — Docker Compose secret wiring (for `infra` to mirror).

In `.dotfiles` (this repo):

- `docs/2026-04-01-001-feat-devcontainer-ci-publishing-plan.md` — prior plan; matches the `docs/<date>-NNN-<type>-<name>-plan.md` filename convention (which this plan supersedes by moving plans into `docs/plans/`).

### Institutional Learnings

- AFT plugin refuses `project_root=$HOME` — runbooks and CLIs that need file edits must be invoked from a project subdirectory or via direct bash. (Memory ID 2035.)
- Inherited `GIT_DIR=$HOME/.dotfiles` contaminates `/tmp` git ops — always `unset GIT_DIR GIT_WORK_TREE` before unrelated git operations. (Memory ID 2036.)
- The dotfiles `.gitignore` allowlist currently covers `!/.dotfiles/docs/`, `!/.dotfiles/docs/*.md`, `!/.dotfiles/docs/brainstorms/`, and `!/.dotfiles/docs/brainstorms/*.md`. Plans in this repo live at `docs/` top level (not `docs/plans/`) per the existing convention. New subdirs under `docs/` trigger a known gitignore precedence quirk requiring `git add -f` for first commit.

### External References

- `SaseQ/discord-mcp` (https://github.com/SaseQ/discord-mcp) — most mature Discord MCP server. 310 ★, Docker-deployable, 50+ tools. Default admin-agent dependency for R1/R24.
- Discord AutoMod docs: https://support.discord.com/hc/en-us/articles/4421269296535-AutoMod-FAQ — keyword filters, mention-flood detection, alert channel routing.
- Discord developer portal intent docs: https://support-dev.discord.com/hc/en-us/articles/5324827539479-Message-Content-Intent-Review-Policy — privileged-intent gating.
- discord.js 14.x permission overrides: https://discord.js.org/docs/packages/discord.js/14.26.4/PermissionOverwriteManager:Class

## Key Technical Decisions

- **Admin-agent path uses an MCP server in an OpenCode session, not a long-running tool.** Lower attack surface; ephemeral; no separate identity to manage. (Origin: KD "Two integration paths, not one".)
- **`SaseQ/discord-mcp` is the default MCP server.** Pinned to a specific commit-SHA. Fallback to direct Discord REST calls from the admin agent if the MCP server is unavailable or untrustworthy. (R24.)
- **Per-project roles, not tiered membership.** `@<project>-collab` per project; optional `@<project>-viewer` for read-only outside access. No global "Inner Circle" tier. (R7 + origin KD.) Per-project roles scale until active project surfaces exceed ~20 projects or ~40 project roles (including viewers); beyond that, pause before adding more and re-evaluate grouping (archive inactive projects, merge related projects under a category-level role, or introduce a documented collection role only when several projects intentionally share the same collaborator set).
- **Channel-permission overrides are the primary access gate; bot code is defense-in-depth only.** Drift detection (R20) ensures the primary gate stays intact.
- **Gateway intent posture must flip BEFORE Phase 2 production deploy.** Current default-on state is incompatible with minimum-permission requirements. (R22 + origin KD.)
- **Disclosure-before-production-intent.** `MessageContent` or `GuildMembers` MAY be tested pre-disclosure only in a **non-production Discord server** using a **non-production bot application/token** and **synthetic messages from consenting test accounts**. The following are forbidden before disclosure is posted and approved: production server channels, real member content, archived channel exports, production bot token, production channel IDs, or any operation against the revived server. Enabling intents in the Developer Portal for a test application is distinct from production-server activation; only the latter is gated by R13/R14. (R12 + R13/R14.)
- **AutoMod-only baseline for moderation.** No third-party moderation bot (Modly, VibeBot) in the initial rebuild. Revisit only if AutoMod is insufficient. (Origin KD.)

## Open Questions

### Resolved During Planning

- *Where does the MCP server run for the admin agent?* — In an OpenCode session via stdio or HTTP transport on Marcus's machine. No long-running daemon. Pinned commit SHA.
- *Where does the offline archive of the 3 channels live?* — Local to Marcus's machine outside the dotfiles repo. Path resolved at execution. NOT in dotfiles (memory hygiene).
- *Does R22's intent-posture flip block this plan's Phase 1?* — No. Phase 1 (server restructure) is independent of the gateway intent posture. R22 only blocks Phase 2 (the `infra` deployment).

### Deferred to Implementation

- Exact channel names per project (Unit 3).
- Exact role names (Unit 4) — convention `@<project>-collab` likely but project names need to be enumerated first.
- Which projects warrant a `@<project>-viewer` role vs collab-only (Unit 4).
- Forum Channel vs standard text channel per project (Unit 3, per project).
- Exact AutoMod mention-spam threshold (Unit 5).
- The set of "allowed external APIs" in R21's allowlist (Unit 9 — channel-policy declaration in the gateway).
- Exact rate-limit thresholds for R21's prompt-injection envelope (Unit 9; tunable via config).
- Per-channel rollout order for the bot — which project channel gets the bot first (Unit 11, post-`infra` deploy).

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
                    ┌─────────────────────────────────────────────────────────────┐
                    │ Marcus (admin)                                              │
                    └────┬────────────────────────────────────────────────────────┘
                         │
            ┌────────────┴──────────────┐
            │                           │
   Admin agent path                Production path
   (ephemeral, this session)       (persistent, owned by infra)
            │                           │
            ▼                           ▼
   ┌─────────────────┐         ┌────────────────────┐
   │ OpenCode + MCP  │         │ Fro Bot gateway    │
   │ (SaseQ/         │         │ daemon             │
   │  discord-mcp)   │         │ (discord.js 14)    │
   └────────┬────────┘         └─────────┬──────────┘
            │                            │
            │ (R15a/b/c: action          │ (R10–R12: minimum-permission
            │  discipline)               │  posture; R22: opt-in intents)
            │                            │
            │ (R17: maintenance lock     │
            │  pauses daemon during      │
            │  structural change)        │
            │                            │
            └─────────────┬──────────────┘
                          │
                          ▼
                  ┌───────────────┐
                  │ Discord API   │
                  └───────┬───────┘
                          │
                          ▼
            ┌──────────────────────────────────────────┐
            │ Server: project-organized layout         │
            │                                          │
            │  Cross-cutting:    announcements, mod-   │
            │                    logs, general, off    │
            │                                          │
            │  Per-project:      #<project>            │
            │                      ↳ @<project>-collab │
            │                      ↳ @<project>-viewer │
            │                        (optional)        │
            │                                          │
            │  Archive:          #archive-* (renamed   │
            │                    from original)        │
            │                                          │
            │  Integration:      #fro-bot (preserved)  │
            └──────────────────────────────────────────┘
```

Key flows:
1. **Audit (F1):** Admin agent runs R1's read-only enumeration. Output goes to a report Marcus reviews before any mutation.
2. **Archive (F1 cont.):** Admin agent exports the 3 original channels to local markdown. Verified offline before Phase 1.
3. **Restructure (F2):** Admin agent applies channel + role changes via R15b/c discipline with explicit confirmations. Gateway daemon stays offline throughout (R17).
4. **Disclosure publication (F4):** Admin agent drafts disclosure (covers bot intents + admin-agent data handling per R13). Marcus reviews; admin agent posts to pinned channel.
5. **Gateway deploy (F3):** Owned by `marcusrbrown/infra` after R22's intent-posture flip lands and disclosure is live.

## Implementation Units

- [x] **Unit 1: Configure admin-agent MCP server (SaseQ/discord-mcp pinned)**

**Goal:** Make the Discord MCP server available in OpenCode sessions for one-shot server-admin tasks. Pin to a specific commit-SHA. Document fallback.

**Requirements:** R1, R24

**Dependencies:** None (entry point of the plan)

**Files:**
- Create or modify: `.config/opencode/opencode.json` — add MCP server entry with pinned image/SHA (decided at execution)
- Create: `.dotfiles/docs/runbooks/discord-admin-agent.md` — how to start an OpenCode session with the Discord MCP server attached, expected capabilities, and the direct-REST fallback procedure

**Approach:**
- Pin `SaseQ/discord-mcp` at the `v1.0.0` release (commit `6725bce7ed057a2d9485473f04b3e56a2eee775e`, released 2026-03-16). Verified at deepening time: no `SECURITY.md`, no published advisories, no security-themed open issues, README documents both HTTP (recommended) and stdio transports clearly. Provenance verdict: safe to use with normal scrutiny.
- If a newer tagged release exists at execution time, re-pin to that release after a quick provenance check (recent commits for red flags, maintainer identity, repo not archived).
- Fall back to `hanweg/mcp-discord` or direct Discord REST calls if provenance review surfaces issues.
- Transport: **stdio** (the only mode SaseQ/discord-mcp v1.0.0 supports — earlier session research incorrectly claimed HTTP / port 8085; verified against the v1.0.0 README at commit `6725bce7`). OpenCode starts the Docker container itself per-session via the `mcp.<name>.command` array; no pre-running daemon.
- **Preflight check** (documented in the runbook): Docker daemon is reachable (`docker ps` returns 0), `saseq/discord-mcp:1.0.0` image is pulled, and `DISCORD_TOKEN` is available in the shell environment (or via `security find-generic-password` from the macOS keychain). If preflight fails, the OpenCode session simply won't see the Discord MCP tools — non-destructive failure mode.
- Pin via Docker image digest (`saseq/discord-mcp@sha256:...`) or commit SHA tag.
- Document the bot-token injection method — `DISCORD_TOKEN` env var passed directly into the container (no `*_FILE` indirection support in SaseQ/discord-mcp). Token sourcing options on this machine (in order of preference): (a) macOS Keychain via `security find-generic-password -s discord-bot-fro-bot -w` invoked from a shell init file under `.config/bash/local.d/` (gitignored); (b) plaintext export in `.config/bash/local.d/discord.bash` (gitignored, machine-local); (c) future option: 1Password CLI via `op read` once `op` is installed and added to the Brewfile. Token MUST NOT land in any tracked dotfiles content.
- The runbook records `pinned_sha`, `source_repo`, `reviewed_at`, `reviewed_by`, and the next review trigger. Re-review is required before every write-capable Discord admin session AND at least quarterly while the MCP config remains tracked (R24 cadence).
- Capture the "no token, read-only audit only" mode where applicable (some MCP tools may work without a token for certain enumerate operations).

**Patterns to follow:**
- Existing MCP servers in `.config/opencode/opencode.json` (if any) — match config shape.
- Plugin pinning convention from PR #1554 (Renovate `customManager` watches `package@semver` in plugin arrays).

**Test scenarios:**
- Happy path: Start an OpenCode session with the MCP server attached; the agent can call `list_channels` (or equivalent) and return the live server's channel inventory.
- Error path: Invalid token → MCP server reports an auth error; admin agent surfaces it instead of silently retrying.
- Edge case: MCP server unavailable (Docker not running, image not pulled) → admin agent detects the failure and announces the direct-REST fallback path.

**Verification:**
- A fresh OpenCode session can attach the MCP server and enumerate the server state.
- The runbook is in `.dotfiles/docs/runbooks/discord-admin-agent.md` and tracked in dotfiles via the existing `!/.dotfiles/docs/*.md` allowlist (or `runbooks/` if added).
- The MCP server's pin is human-readable in `opencode.json`.

---

- [x] **Unit 2: Run the Phase 0 audit (read-only) + archive the 3 original channels**

**Goal:** Produce the inventory report + offline archive that gates the restructure.

**Requirements:** R1, R2, R3, R15a, R19, R23

**Dependencies:** Unit 1

**Files:**
- Create: `<archive-path>/2026-05-XX-discord-server-audit-report.md` (path outside dotfiles, resolved at execution)
- Create: `<archive-path>/general.md`, `<archive-path>/internal.md`, `<archive-path>/team.md`, `<archive-path>/fro-bot.md` (the 4 active channels' content as plain text)

**Approach:**
- Single OpenCode session with admin agent + Discord MCP server. Marcus prompts the agent to enumerate the server state.
- Audit MUST be read-only per R15a + R23: every Discord API call is logged; the agent halts and reports if it encounters a write-capable tool or a rate-limit response.
- Output format for the report: per-channel section with name, ID, last message timestamp, member count with access, integration listings, webhook listings. Role inventory with member counts. Member list with join dates.
- Archive format: one markdown file per channel, oldest message at top, with author + timestamp + content. No raw IDs unless needed for permission audit.
- Marcus reviews the audit report. Approval gate before any Phase 1 work.
- Per R19, the admin agent does NOT echo raw archive content into terminal logs; writes only to the archive file path.

**Patterns to follow:**
- The `<archive-path>` is documented in the runbook from Unit 1; do not hardcode in this plan.

**Test scenarios:**
- Happy path: Audit completes; report + 4 archive files exist; report shows expected channel/role/member counts.
- Error path (R23): Discord rate-limits mid-audit → admin agent halts, surfaces partial state to Marcus, does NOT continue.
- Error path: Channel content too large for a single archive file → admin agent splits into dated parts (one per month) rather than truncating.
- Integration: The archive contains the `#fro-bot` integration's message history (so the audit captures the integration's behavior before any structural change).

**Verification:**
- Audit report exists and Marcus has reviewed it.
- 4 archive files exist; spot-check confirms message ordering + author + timestamps are intact.
- No Discord-state mutation occurred (audit log shows only GET-equivalent operations).

---

- [x] **Unit 3: Enable Community Mode + design + create new project-organized channel layout**

**Goal:** Restructure channels into the project-organized layout, per audit recommendations.

**Requirements:** R5, R6, R15b, R15c, R17

**Dependencies:** Unit 2 (audit completed + approved)

**Files:**
- No code files in any repo. All work is server-state via Discord MCP.
- Update: `.dotfiles/docs/runbooks/discord-admin-agent.md` — add a "channel inventory" section listing the new layout, populated at execution.

**Approach:**
- Enumerate active projects from Marcus's curated list (drawn from his local source tree under `marcusrbrown` plus a curated subset). Marcus confirms the final project list before channel creation.
- Enable Community Mode (R5). This unlocks AutoMod + Onboarding + Forums + Insights.
- Before any mutation: gateway daemon is offline (R17's maintenance lock — Phase 1 happens entirely with the daemon down; deploy from `infra` is sequenced after Phase 1).
- **Pre-mutation state revalidation:** At the start of Unit 3 execution, the admin agent re-enumerates current server state and compares it to the state recorded in the Unit 2 audit report. If channels, roles, members, or permissions have materially changed since the audit, halt and surface the delta to Marcus before proceeding. This catches between-approval interventions (another client, automation, or accidental change).
- Decide cross-cutting channels: announcements, general discussion, off-topic, mod-logs, possibly `#bot-info` (for disclosure pinning per Unit 7).
- Per-project granularity: single text channel OR a project category with multiple channels (e.g., `#<project>-general`, `#<project>-releases`). Forum channel vs text channel decided per project.
- Rename original channels to `#archive-general`, `#archive-internal`, `#archive-team` — preserved in the server but flagged as archive (or removed entirely if the offline archive from Unit 2 is sufficient and Marcus approves the rename-then-delete path).
- Per R15b, every channel creation/rename is per-action confirmed.

**Patterns to follow:**
- Per-project channels can be grouped under a `📂 Projects` category; cross-cutting under a `📌 General` category.
- Channel topic strings (1-2 sentences) populated at creation time.

**Test scenarios:**
- Happy path: New channels exist with correct names and topics; categories are organized.
- Edge case: A project name conflicts with an existing or reserved channel name → admin agent prompts Marcus to disambiguate before creating.
- Error path: Discord rate-limits mid-restructure → admin agent halts, leaves the server in a documented partial state, surfaces the recovery path.
- Integration: Original channels are renamed (not deleted), preserving message history during Phase 1.

**Verification:**
- Server has the new layout; the audit report's "current state" no longer matches (proves the restructure happened).
- Original 3 channels are either archived (renamed) or removed per Marcus's approved approach.
- Community Mode is enabled.

---

- [x] **Unit 4: Create per-project roles + apply channel permission overrides**

**Goal:** Implement R7's role hierarchy. Per-project access via channel overrides becomes the primary gate (R16).

**Requirements:** R7, R15b, R16

**Dependencies:** Unit 3

**Files:**
- No code files. All work is server-state via Discord MCP.
- Update: `.dotfiles/docs/runbooks/discord-admin-agent.md` — add a "role + permission policy" section documenting the declared policy that R20's drift detection will compare against.

**Approach:**
- Create roles per project: `@<project>-collab` for every active project (full post + agent-invocation permission within the project's channel(s)). Optional `@<project>-viewer` for read-only outside access on public-readable project channels.
- Cross-cutting channels use `@everyone` defaults (no per-channel role gate).
- Apply channel permission overrides: for each project channel, deny `@everyone` view + grant the relevant `@<project>-collab` (and optionally `@<project>-viewer`).
- Declare the policy in the runbook in a machine-readable form (table) so Unit 8's drift detection can diff actual vs declared.
- Marcus is `@Admin` (already server owner; no new role needed unless current role hierarchy needs sharpening).
- Per R15b, every role creation + permission override is per-action confirmed.
- **Role lifecycle hygiene:** Every project role has an owner (Marcus by default) and a project status (active / dormant / retired). When a project is retired or archived, its `@<project>-collab` and `@<project>-viewer` roles are removed (or renamed to `@archive-<project>-collab`) during the next permission-drift check (Unit 8). This prevents role sprawl and keeps the declared-policy table in the runbook accurate.

**Patterns to follow:**
- Role color convention: muted colors for `-collab`, even more muted for `-viewer`. Marcus's preference.
- Role position: project roles below `@Admin` but above `@everyone`; viewer roles below collab roles.

**Test scenarios:**
- Happy path: For each project, the `@<project>-collab` role exists, the channel exists, and a member assigned the role can view + post in the channel while `@everyone` cannot.
- Edge case: A member who currently lacks any project role should land in `@everyone` and see only cross-cutting channels.
- Integration: The declared policy table in the runbook matches the effective Discord permissions for at least one sample project (verified manually).

**Verification:**
- All declared roles exist with the documented permissions.
- The runbook's policy table is the source of truth and is committed alongside the role changes (next commit in this branch).

---

- [x] **Unit 5: Configure AutoMod baseline + alert routing**

**Goal:** Enable Discord-native moderation. No third-party bot.

**Requirements:** R8, R15b

**Dependencies:** Unit 3 (Community Mode + mod-logs channel exist)

**Files:**
- No code files.
- Update: `.dotfiles/docs/runbooks/discord-admin-agent.md` — add an "AutoMod policy" section documenting the rules and the alert routing.

**Approach:**
- Enable "Commonly Flagged Words" rule.
- Add a custom keyword rule for any project-specific terms Marcus wants to block (likely empty at first).
- Enable "Block Mention Spam" rule. Threshold tuned at execution (likely 5–7 mentions per message).
- Route all AutoMod alerts to the `#mod-logs` channel. Alert-channel routing is supported for the rule types this plan uses (commonly-flagged-words, mention-spam, custom-keyword); if Discord's UI rejects the configuration in the current server state, fall back to per-rule alert channels or accept a temporary unrouted state and document the fallback.
- Verify: post a test message in a test channel that triggers the mention-spam rule; confirm the alert lands in `#mod-logs`.
- Per R15b, every rule creation is per-action confirmed.

**Test scenarios:**
- Happy path: A message containing 7+ mentions is auto-deleted and an alert appears in `#mod-logs`.
- Edge case: Marcus posts a high-mention message (e.g., notifying multiple roles) — AutoMod fires; Marcus exempts `@Admin` from the rule via Discord's rule exception mechanism.
- Verification: A message with no triggers passes cleanly with no `#mod-logs` noise.

**Verification:**
- Three rules are active: commonly-flagged-words, custom-keywords (possibly empty), block-mention-spam.
- Alert routing to `#mod-logs` is confirmed via test message.

---

- [x] **Unit 6: Configure minimal Onboarding + `@Visitor` fallback**

**Goal:** R9's minimal Onboarding. Members who decline all choices land in a documented fallback state.

**Requirements:** R9

**Dependencies:** Unit 4 (roles exist) + Unit 5 (cross-cutting channels in place) + **Unit 7 (disclosure published before Welcome Screen references it — prevents a gap window where a public member could join, complete onboarding, and not yet see the disclosure)**

**Files:**
- No code files.
- Update: `.dotfiles/docs/runbooks/discord-admin-agent.md` — add an "Onboarding" section documenting the choice set + fallback.

**Approach:**
- Discord Onboarding has a minimum role-choice set requirement (typically ≥3). Choose 3 low-stakes options like "Interested in [project A]", "Interested in [project B]", "Just looking around (no role)" — none of which grant project-collab access (collab roles are assigned by Marcus, not via self-service).
- Members who select "just looking" or skip lands in `@everyone` with read-only access to cross-cutting channels (R9's `@Visitor`-equivalent fallback). No separate `@Visitor` role unless Marcus prefers it.
- The Welcome Screen has 3-4 sentences pointing to `#announcements`, `#general`, and the disclosure document (once Unit 7 lands).
- Per R15b, Onboarding setup is per-action confirmed.

**Test scenarios:**
- Happy path: A test alt account joins the server, completes Onboarding picking one option, and sees the expected channel set.
- Edge case: Alt account skips Onboarding entirely → lands in `@everyone` cross-cutting view; can re-trigger Onboarding via Discord's re-entry mechanism.
- Edge case: Alt account picks "Interested in [project A]" but is NOT a collaborator → does not get `@<project A>-collab`; sees only cross-cutting channels.

**Verification:**
- Onboarding is enabled and a test member can complete it.
- The fallback state is documented in the runbook and matches real behavior.

---

- [x] **Unit 7: Draft + publish AI disclosure document (pinned)**

**Goal:** R13 + R14. Disclosure-before-intent.

**Requirements:** R13, R14, R19 (referenced in disclosure scope), R25 (LLM disclosure + tracked-doc hygiene)

**Dependencies:** Unit 3 (cross-cutting channels exist for pinning), Unit 4 (role policy declared; referenced in disclosure). **Unit 6's Welcome Screen depends on this unit landing first** to avoid a disclosure-gap window.

**Files:**
- Create: `.dotfiles/docs/runbooks/discord-ai-disclosure.md` — canonical version of the disclosure document, tracked in dotfiles. Marcus posts the rendered content in the server's pinned channel.
- The canonical version is the source of truth; future revisions update both the file and the pinned message.

**Approach:**
- Draft the disclosure covering:
  - The bot itself (Fro Bot gateway daemon, what it is, who operates it)
  - Intents declared (`Guilds` baseline; `MessageContent` + `GuildMembers` opt-in per-deploy)
  - Data accessed (which channels; which message types — slash command inputs vs mention-triggered reads)
  - Data retention windows (gateway-side logs; admin-agent archive files; LLM provider logs by reference)
  - Third-party processors (LLM provider servicing the agent; Discord platform itself)
  - Appeals process (DM Marcus or open a GitHub issue on `fro-bot/.github`)
  - Admin-agent message-body processing during audit/restructure (R19's scope: when it reads, where it writes, how long archives are retained)
- Marcus reviews + approves the draft (R14).
- Admin agent posts the rendered content to the chosen channel (likely `#bot-info` or `#announcements`) and pins it.
- Per R15b, posting + pinning is per-action confirmed.
- **R25 hygiene:** No real Discord message bodies appear in the canonical disclosure file or any tracked runbook example. Synthetic example messages only. The disclosure names the LLM providers actively used **at the time of launch** by the gateway daemon and the admin-agent session, and links/describes their retention + training policies. Future provider changes trigger a disclosure-review prerequisite per R26 (not absorbed as standing scope here).

**Test scenarios:**
- Happy path: Disclosure document file exists and is committed; pinned message in server matches the file content.
- Edge case: Disclosure scope misses an intent the gateway later activates → caught by R12's "must reference specific intents being used" clause; disclosure update is a prerequisite for the intent change.
- Integration: The disclosure references the dotfiles runbook for the admin-agent's data-handling policy.

**Verification:**
- File at `.dotfiles/docs/runbooks/discord-ai-disclosure.md` is tracked.
- A pinned message exists in the server matching the file's content as of the post date.
- The disclosure covers all 7 scope items listed above.
- **R26 freshness procedure:** A short section in the disclosure file lists the gateway intents and LLM providers it currently covers, dated. This makes drift between live config and disclosure visually obvious in `git diff` and in the server's pinned message.

---

- [x] **Unit 8: Permission-drift detection runbook**

**Goal:** R20's drift detection. Periodic check that effective channel permissions match the declared policy from Unit 4.

**Requirements:** R20

**Dependencies:** Unit 4 (declared policy exists)

**Files:**
- Create: `.dotfiles/docs/runbooks/discord-permission-drift-check.md` — manual procedure for now; can be automated later.

**Approach:**
- The runbook describes a manual or scripted check that:
  - Enumerates current per-channel role grants via Discord MCP (or direct REST).
  - Compares against the declared policy table in `discord-admin-agent.md`.
  - Reports any deviation to Marcus.
- Automation is deferred to a follow-up; for now, the runbook documents the manual procedure (admin-agent invocation).
- Wire the gateway-side enforcement (Unit 9): the gateway refuses privileged actions in channels whose effective permissions don't match its declared channel-policy file.
- Per R15a, the drift check is read-only.

**Test scenarios:**
- Happy path: Run the drift check; output matches declared policy exactly; "no drift" report.
- Error injection: Marcus temporarily grants `@everyone` view on a `@<project>-collab`-only channel → next drift check flags the deviation.

**Verification:**
- Runbook is committed.
- A test deviation is detected by the runbook procedure.

**Deferred from Unit 5:** AutoMod end-to-end trigger verification was deferred from Unit 5 because Discord exempts server owners from AutoMod by design (see the AutoMod policy section of the admin-agent runbook). The drift-check runbook must include a one-time check that runs when the first non-Admin user joins the server: post a triggering message from that account, confirm the alert lands in `#mod-logs`, and record the verification date in the runbook. Without this hook, the deferred trigger test risks silently dropping.

---

- [x] **Unit 9: Gateway intent-posture flip (in `fro-bot/agent`) — minimal handoff boundary only** _(cross-repo handoff: tracked in [fro-bot/agent#646](https://github.com/fro-bot/agent/issues/646); ticked here because the dotfiles-side acknowledgment is complete — the gateway implementation happens in its own dedicated session in `fro-bot/agent`)_

**Goal:** R22's intent-posture flip ONLY. The gateway's `DEFAULT_INTENTS` becomes opt-in. This is a small PR in `fro-bot/agent`. R20/R21's full gateway-side enforcement (channel-policy declaration + refusal patterns + rate limit) is **scope-split to a follow-up plan in `fro-bot/agent`** (see "Deferred to Separate Tasks"); a minimal contract is set here so that disclosure (Unit 7) and `infra` deployment have a stable handoff.

**Requirements:** R10 (OAuth scopes — verified via the bot invite, not gateway code), R11 (Bot Token auth), R12 (privileged intents opt-in), R22 (intent code flip)

**Dependencies:** Unit 7 (disclosure scope known; informs the policy declaration). Independent of Units 3-6 (the gateway is offline during Phase 1, so the code change can happen in parallel with server restructure if convenient).

**Files (target repo: `fro-bot/agent`):**
- Modify: `packages/gateway/src/discord/client.ts:10-15` — `DEFAULT_INTENTS` (currently includes `Guilds`, `GuildMessages`, `MessageContent`, `GuildMembers`) becomes opt-in. New config field selects which intents to enable; defaults to `Guilds` + `GuildMessages` only (the non-privileged set needed for slash commands + mention reception). Configuration loaded via the existing `readSecret` / `readOptionalSecret` pattern in `packages/gateway/src/config.ts:20-101`.
- Modify or create: `packages/gateway/src/discord/client.test.ts` — test that the opt-in baseline is `Guilds` + `GuildMessages` and that privileged intents are added only when explicitly configured.
- Update: `packages/gateway/AGENTS.md` — document the new intent-configuration knob.

**Approach:**
- Single commit / single PR: flip `DEFAULT_INTENTS` to the non-privileged baseline (`Guilds` + `GuildMessages`) and add a config knob (env var or config field) that opt-in adds `MessageContent` and/or `GuildMembers`.
- The configuration shape mirrors the existing `readSecret` / `readOptionalSecret` pattern in `packages/gateway/src/config.ts:20-101`. No new schema framework introduced.
- This PR does NOT implement channel-policy enforcement, refusal patterns, rate limits, or drift refusal — those are scope-split to a follow-up plan owned by `fro-bot/agent`. The intent flip is the minimum handoff boundary that lets disclosure (Unit 7) and `infra` deployment proceed.
- Bounded implementation work suitable for delegation to `@fixer` once the PR is opened.

**Patterns to follow:**
- Existing gateway config-loader pattern in `packages/gateway/src/config.ts:20-101` (`readSecret()` / `readOptionalSecret()` — `${NAME}_FILE` precedence then `process.env[name]`). Mirror this shape for the new intent-config field. No new schema framework (per `packages/gateway/AGENTS.md:34-45` which explicitly excludes structured-schema loaders at this scope).
- Test colocation convention: `*.test.ts` next to implementation file. See existing `packages/gateway/src/config.test.ts` as a model.
- Effect 3.x composition layer per `packages/gateway/AGENTS.md:1-4`.

**Test scenarios:**
- Happy path: Gateway boots with the non-privileged baseline (`Guilds` + `GuildMessages`) only, unless config explicitly opts in to privileged intents.
- Happy path: Gateway boots with `MessageContent` opt-in via config; the intent appears in the running `Client` constructor's intents array.
- Happy path: Gateway boots with `GuildMembers` opt-in via config (same shape).
- Edge case: Both `MessageContent` and `GuildMembers` opted in via config; both appear in the intents array.
- Error path: Config value malformed (typo in intent name) → loader fails to start with a clear error; does not silently default to permissive.
- Integration: Test isolation MUST prevent live-Discord contact — see "Test isolation guard" in the verification section. Tests use a fake token; runtime asserts that no real network call to `discord.com` / `gateway.discord.gg` is attempted during the test suite.


**Verification:**
- `packages/gateway/src/discord/client.ts` `DEFAULT_INTENTS` constant contains only the non-privileged baseline (`Guilds` + `GuildMessages`); `MessageContent` and `GuildMembers` are opt-in via configuration.
- Tests pass for all 6 scenarios above.
- README/AGENTS notes mention the new config knob.
- **Test isolation guard:** Before any test in the gateway test suite runs, an environment assertion verifies that the configured token is a known-fake placeholder (e.g., the literal `"test-token"` or a regex-matched test sentinel) and refuses to start the suite otherwise. This prevents accidental live-Discord contact via stray env vars.

---

- [x] **Unit 10: Migrate `#fro-bot` channel under the new layout (preserve webhook continuity)**

**Goal:** R4. The `#fro-bot` GitHub Actions integration must keep working through the restructure.

**Requirements:** R4, R17

**Dependencies:** Unit 3 (new layout exists)

**Files:**
- No code files in `.dotfiles`.
- Potentially modify `fro-bot/.github` repo's workflow files if the webhook URL must change (verified at execution; likely no change needed if the channel is renamed in place).

**Approach:**
- Default plan: leave `#fro-bot` in place at the same channel ID. Rename it if needed for naming consistency under the new layout (e.g., `#ops-notifications`). Discord webhooks are bound to channel ID, not name, so rename is safe.
- R4's no-delete clause is hard: the channel MUST NOT be deleted. If a category move is needed, do it without delete/recreate.
- If for some reason the channel must be recreated (extremely unlikely): create the new channel + new webhook FIRST, dual-post for one workflow cycle to confirm continuity, then update the source repo's workflow secret/config, then delete the old channel.
- The audit from Unit 2 already captured the channel's content + integration behavior, so any recreation has a fallback snapshot.

**Test scenarios:**
- Happy path: The next scheduled `fro-bot/.github` workflow run posts to the (renamed or unmoved) channel; no missed messages.
- Edge case: Channel is moved to a different category — webhook continues to work (channel ID unchanged).
- Recovery: If a webhook break is detected, follow the recreate-with-dual-post procedure in R4.

**Verification:**
- A workflow run from `fro-bot/.github` posts a message in the channel after the restructure.

---

- [x] **Unit 11: Minimal token-handoff note (pointer to `infra`)**

**Goal:** R18 is implemented in `marcusrbrown/infra`, not here. This dotfiles unit produces a thin pointer note so admin-agent sessions know where the canonical token-lifecycle runbook lives.

**Requirements:** R18 (pointer only; canonical implementation lives in `infra`)

**Dependencies:** Unit 9 (gateway intent posture flipped before `infra` deploys)

**Files:**
- Update: `.dotfiles/docs/runbooks/discord-admin-agent.md` — add a short "Token handoff" section: where the canonical token-lifecycle runbook lives in `marcusrbrown/infra`, what the handoff contract is (the gateway-side `${NAME}_FILE` interface), and a placeholder URL to update once `infra` lands the runbook.

**Approach:**
- This unit is intentionally thin. The full token lifecycle (storage path, file ownership/permissions, rotation, emergency revocation, in-flight interaction handling during rotation) is owned by `infra` and lives in that repo.
- The dotfiles pointer ensures admin-agent sessions can find the canonical runbook without re-deriving it.
- When `infra` lands the runbook, update the pointer to a working URL.

**Test scenarios:**
- This unit produces a pointer note, not a deployable artifact. Verification = the note exists and Marcus can navigate from it to `infra`'s canonical runbook (once that exists).

**Verification:**
- `.dotfiles/docs/runbooks/discord-admin-agent.md` has a "Token handoff" section.
- If `infra`'s canonical runbook is not yet landed at execution time, the section is committed with a `TODO: update URL when infra lands the runbook` marker.

---

## System-Wide Impact

- **Interaction graph:** Admin agent (this plan's primary execution path) ↔ Discord MCP server ↔ Discord API. Gateway daemon (out of scope here) ↔ Discord API. `fro-bot/.github` workflow → Discord webhook → `#fro-bot` channel. `marcusrbrown/infra` → host-side token file → gateway daemon.
- **Message-content data path:** Mention/slash invocations in project channels flow Discord → gateway daemon → configured LLM provider(s) when agent processing is required. The gateway disclosure (Unit 7) MUST name the active provider or routing layer, link/describe retention and training-use policy, and distinguish three retention boundaries: Discord platform retention, Marcus-controlled gateway/archive/log retention, and third-party LLM retention (which is OUTSIDE Marcus's control once data is submitted). Changing provider or provider-routing requires disclosure review before production use. Admin-agent sessions follow the same trace: archive reads → admin agent's LLM provider → admin agent output.
- **Error propagation:** Admin agent failures during F1/F2 must halt-and-report per R23. Gateway daemon failures during normal operation are owned by `infra`/gateway. Webhook failures during the restructure are caught by R4's no-delete rule + AE1.
- **State lifecycle risks:** Concurrent mutations from admin agent + gateway daemon are prevented by R17's single-writer rule (gateway offline during Phase 1). Permission drift after restructure is caught by R20's runbook (Unit 8) + gateway-side refusal (Unit 9).
- **API surface parity:** None within dotfiles. The `fro-bot/agent` gateway gains a new config knob (intent opt-in); existing callers of `packages/gateway/src/discord/client.ts` that rely on default intents will break unless explicitly opt-in. This is the desired behavior per R22.
- **Integration coverage:** AE1 (`#fro-bot` webhook continuity), AE4 (maintenance lock), AE5 (drift detection), AE6 (prompt-injection envelope) cover the integration surfaces.
- **Unchanged invariants:** Dotfiles structure (allowlist gitignore, bare-repo convention, GPG-signed commits, conventional commits) is unaffected by this plan. The `fro-bot/.github` repo's workflow files are not modified by this plan (Unit 10 may modify them only if a webhook URL change is forced; default path is no change).

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Discord MCP server (`SaseQ/discord-mcp`) has a hidden bug that mutates state during the audit | R23's audit fail-closed rule + R15a's verified read-only capability set. R24 documents the direct-REST fallback if the MCP server is untrustworthy. |
| Channel rename mid-restructure breaks the `#fro-bot` webhook | R4's no-delete clause + AE1. Default plan keeps the channel in place; rename is webhook-safe. |
| Concurrent admin-agent + gateway mutations cause race | R17's single-writer rule. Gateway is offline during Phase 1. Reconciliation step before re-enable. |
| Permission drift erodes the `@<project>-collab` security boundary silently | R20's drift-detection runbook (Unit 8) + gateway-side refusal on drift (Unit 9). |
| Prompt injection in public-readable channels coerces the bot into privileged action | R21's minimum envelope (mention-only/slash-only in non-collab channels, rate limit, refusal patterns, mod-logs alerts). Final tuning is gateway-side ADR. |
| Disclosure scope misses what the admin agent does with message bodies | R13's expanded scope (Unit 7) explicitly covers admin-agent processing per R19. |
| `infra`'s gateway-app deploy stalls; Phase 2 unblocks late | R22 + Phase 1 are independent of Phase 2. The server modernization is valuable on its own even if the gateway lands later. |
| Bot token leak | R18's lifecycle runbook (Unit 11). File permissions + rotation + revocation documented before `infra` deploys. |
| MCP server supply chain compromise (first use) | R24's pinned commit SHA + provenance review. Direct-REST fallback path documented. |
| Sandbox boundary accidentally includes production data during pre-disclosure intent testing | KD wording sharpened ("Disclosure-before-production-intent" — synthetic data only, non-production server, non-production bot token, no real members, no copied archives). Pre-disclosure testing against the revived server is explicitly forbidden. |
| MCP server pin becomes stale OR upstream trust changes after first use (security fixes land but pin stays frozen; maintainer transfer; repo archival; behavioral changes) | Before each privileged admin-agent session, re-check the pinned SHA against upstream security fixes/releases, maintainer/repo ownership, archive status, and recent commits. If upstream changed hands, was archived, has unexplained privileged-surface changes, or the pin is behind a relevant security fix, freeze MCP use and either re-pin after review or use direct Discord REST fallback. Runbook records `pinned_sha`, `source_repo`, `reviewed_at`, `reviewed_by`, next review trigger. Quarterly review minimum. |
| Real Discord message content lands in dotfiles-tracked docs/examples (privacy faceplant) | R25 (added during deepening): synthetic examples only in disclosure + runbooks. Pre-commit gitleaks hook does NOT catch this — discipline + review only. |
| HTTP transport preflight fails on Marcus's host (port collision, Docker missing, etc.) | Unit 1 preflight check; fall back to stdio with same admin-agent capabilities. |
| Server state changes between Unit 2 approval and Unit 3 execution (another client, automation) | Unit 3 pre-mutation revalidation step (R-15a-style read-only enumeration before any write). |
| Onboarding Welcome Screen references disclosure document that doesn't exist yet | Unit 6 sequenced AFTER Unit 7 (disclosure published first). |
| Disclosure goes stale relative to running gateway (intent flag flipped without disclosure update) | R26 disclosure-freshness procedure (procedural at launch; automated drift detection deferred). |
| Out-of-order PR merges across 3 repos cause docs/code/deploy mismatch | R27 release-order discipline (Unit 9 first, dotfiles second, infra last). |
| Unit 9 tests accidentally hit live Discord | Test isolation guard in Unit 9 verification: tests refuse to start unless token is a known-fake placeholder. |
| R15c type-confirm is procedural, not technical (MCP server cannot enforce typed confirmation) | Documented as procedural control in R15c clarification. Acceptable for one-shot admin-agent use; not suitable for autonomous tooling. |
| Privileged intent enabled before disclosure shipped (documented 2026-05-18 deviation: `GUILD_MEMBERS` for MCP startup; `MessageContent` for audit content) | R12 revised post-execution to split MCP-required from disclosure-gated intents. Mitigation going forward: new-member onboarding is gated on disclosure doc landing in the server (Unit 7 prerequisite). No new privileged intents will be enabled before disclosure is current. Disclosure ships in this same PR as `docs/runbooks/discord-ai-disclosure.md`. |

## Documentation / Operational Notes

- 2 runbooks land in `.dotfiles/docs/runbooks/`: `discord-admin-agent.md` (includes the Token handoff pointer section per Unit 11), `discord-permission-drift-check.md`. `discord-add-new-project.md` is a future iteration (deferred from this plan). The canonical token-lifecycle runbook lives in `marcusrbrown/infra`, not here.
- 1 disclosure doc at `.dotfiles/docs/runbooks/discord-ai-disclosure.md`.
- 1 plan + 1 brainstorm + 1 `.gitignore` update + 1 Unit-9 PR (in `fro-bot/agent`) = 4 + (2 runbooks + 1 disclosure) = 7 tracked artifacts across 2 repos from this work. The third repo (`marcusrbrown/infra`) owns its own token-lifecycle runbook + deployment artifacts; not counted here.
- `.dotfiles/.gitignore` already allowlists `docs/runbooks/` (per PR #1654). The disclosure doc lives under that existing allowlist; no separate `docs/disclosures/` path is used.
- `.dotfiles` commit messages follow `type(scope): description` convention.
- This plan does NOT add Renovate / CI / changelog automation to the runbooks. Out of scope.

## Sources & References

- **Origin document:** [.dotfiles/docs/brainstorms/2026-05-18-discord-server-revival-requirements.md](brainstorms/2026-05-18-discord-server-revival-requirements.md)
- Related repo (gateway code): https://github.com/fro-bot/agent
- Related repo (gateway hosting, Phase 2): https://github.com/marcusrbrown/infra (parallel work in progress)
- MCP server (default candidate): https://github.com/SaseQ/discord-mcp
- Discord platform docs:
  - AutoMod: https://support.discord.com/hc/en-us/articles/4421269296535-AutoMod-FAQ
  - MessageContent intent policy: https://support-dev.discord.com/hc/en-us/articles/5324827539479-Message-Content-Intent-Review-Policy
  - discord.js 14.x PermissionOverwriteManager: https://discord.js.org/docs/packages/discord.js/14.26.4/PermissionOverwriteManager:Class
- Prior dotfiles plan (for filename convention): `.dotfiles/docs/2026-04-01-001-feat-devcontainer-ci-publishing-plan.md`
