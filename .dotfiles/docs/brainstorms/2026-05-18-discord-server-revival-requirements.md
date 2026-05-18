---
date: 2026-05-18
topic: discord-server-revival
---

# Discord Server Revival — Hybrid Portfolio + Agent Gateway Host

## Summary

Revive a dormant 2016-era Discord server as a project-organized workspace: one channel (or category) per project, with per-project roles controlling who can read and who can collaborate. Some projects stay private to trusted collaborators; some have public-readable surfaces. The Fro Bot gateway daemon operates inside project channels where collaborators have consented (vibe-coding, agent work, ops surface). Server-admin tasks (audit, archive, restructure) happen out-of-band via an MCP-server admin agent in an OpenCode session; gateway daemon deployment is sequenced after structural revival lands. Hosting is owned by the parallel `marcusrbrown/infra` repo and deferred from this brainstorm.

---

## Problem Frame

A 2016-vintage Discord server sits dormant. Discord itself has changed substantially since: AutoMod (2022), Community Mode + Onboarding + Forums (2021–2023), privileged-intent gating (Aug 2022), slash commands replacing prefix bots, and a maturing AI-bot governance ecosystem. The server's three remaining private channels (`#general`, `#internal`, `#team`) plus a working `#fro-bot` GitHub Actions notification channel represent the only live state. Members have already been pruned; the social cost of structural changes is low.

A separate problem motivates the timing: Marcus's `fro-bot/agent` codebase ships a Discord-first gateway daemon (discord.js 14.26.4, slash commands, mention handling, Compose deploy) that has no home to run in. The server is the natural target. But deploying an interactive AI agent into a project-organized workspace requires a structure that supports per-project access roles, channel-scoped permissions, a moderation baseline, and AI-disclosure norms that didn't exist when the server was built. Skipping the modernization step risks a poorly-permissioned bot, a stale workspace shape, and rework when the gateway adds features.

---

## Actors

- **A1. Marcus (admin):** Server owner, primary collaborator on every project, deploys gateway, makes structural decisions.
- **A2. Project collaborators:** Hold per-project roles (`@<project>-collab`). A given collaborator may hold roles for multiple projects or just one. Roles grant access to that project's channel(s) only.
- **A3. Project viewers (public-readable projects only):** Members with read access to public-readable project channels. May hold `@<project>-viewer` per-project read role, or fall back to `@everyone` view permission on channels that are server-public.
- **A4. Fro Bot gateway daemon:** Long-running Discord bot user (discord.js 14, daemon-mode). Channel-scoped behavior driven by Discord permission overrides per project channel. Defaults to mention-only or slash-only in any channel readable by `@everyone` or non-collab roles.
- **A5. Admin agent (this session + future ones):** OpenCode session with Discord MCP server attached. One-shot audit/restructure/moderation tasks. NOT persistent — runs only when Marcus prompts it.

---

## Key Flows

- **F1. Server audit and archive**
  - **Trigger:** Marcus prompts the admin agent in an OpenCode session.
  - **Actors:** A1, A5
  - **Steps:** Admin agent (via Discord MCP) enumerates channels, roles, members, integrations; exports content of the 3 private channels to local markdown; archives Marcus's local copy; reports inventory + recommendations.
  - **Outcome:** Marcus has an offline archive of historical content; the live server state is documented; recommendations for the restructure are pinned.
  - **Covered by:** R1, R2, R3, R4

- **F2. Structural rebuild**
  - **Trigger:** Marcus approves the audit's recommendations.
  - **Actors:** A1 (decisions), A5 (execution)
  - **Steps:** Enable Community Mode; create a project-organized channel layout (one channel or category per active project, plus a small set of cross-cutting channels for announcements/discussion); migrate `#fro-bot` integration to the appropriate channel under the new layout; configure AutoMod rules; set up Onboarding with a minimal role gate; create per-project roles for collaboration access (`@<project>-collab`) and where applicable read access (`@<project>-viewer`); preserve original 3 channels as renamed `#archive-*` or remove if the offline archive is sufficient.
  - **Outcome:** Server is project-organized with per-project access control and a clear permission model.
  - **Covered by:** R5, R6, R7, R8, R9

- **F3. Gateway deployment (deferred from this brainstorm)**
  - **Trigger:** `marcusrbrown/infra` adds `gateway` as an app and produces a running deployment.
  - **Actors:** A1, A4
  - **Steps:** Create Discord application + bot user; configure intents and OAuth invite URL; deploy daemon; invite bot with minimum permissions; verify channel-scoped behavior.
  - **Outcome:** Fro Bot lives in the server with documented permission scope.
  - **Covered by:** R10, R11, R12 (acceptance lives in this doc; sequencing lives in `infra` PR)

- **F4. AI disclosure publication**
  - **Trigger:** Before A4 goes live with `MessageContent` intent.
  - **Actors:** A1, A5
  - **Steps:** Admin agent drafts a disclosure document covering bots/intents/data retention/appeals; Marcus reviews; admin agent posts to a pinned `#bot-info` or `#announcements` thread.
  - **Outcome:** Public-facing disclosure exists before any AI-bot reads user message content.
  - **Covered by:** R13, R14

---

## Requirements

**Audit + archive (Phase 0)**

- R1. Admin agent uses an MCP server (default candidate: `SaseQ/discord-mcp`) connected via OpenCode session to enumerate the server's current state (channels, roles, members, integrations, webhooks).
- R2. The 3 current private channels (`#general`, `#internal`, `#team`) and the `#fro-bot` integration channel are exported to local markdown before any destructive action. Archives live outside the dotfiles repo (path TBD in execution).
- R3. The audit produces a written inventory + recommendations document; Marcus approves before Phase 1 proceeds.
- R4. The `#fro-bot` GitHub Actions integration (currently posting from `fro-bot/.github` actions) MUST keep working through and after the restructure. The `#fro-bot` channel MUST NOT be deleted; rename is allowed but recreation/replacement is forbidden until the new channel is live, the new webhook is verified end-to-end against the source repo, and a brief dual-posting window has confirmed continuity. If the channel must be renamed, the webhook URL is preserved or recreated and the source repo's webhook is updated atomically.

**Structural modernization (Phase 1)**

- R5. Community Mode is enabled on the server (prerequisite for AutoMod, Onboarding, Forums, Insights).
- R6. The channel layout is project-organized: one channel (or category, when a project needs multiple channels) per active project, plus a small set of cross-cutting channels (announcements, general discussion, off-topic, mod-logs). Exact channel names and per-project granularity finalized during execution. Channels for projects without public visibility default to private (no `@everyone` view permission).
- R7. Role hierarchy uses per-project roles rather than tiered membership: at minimum `@Admin` (Marcus), one `@<project>-collab` role per active project (grants post + agent-invocation access to that project's channel), and where applicable one `@<project>-viewer` role (grants read access to that project's channel for non-collaborator members). Cross-cutting channels use `@everyone` defaults. There is no global "Inner Circle" tier — access is per-project.
- R8. AutoMod is enabled with at minimum: commonly-flagged-words rule, mention-spam rule (threshold to be set during execution), and routing to a mod-logs channel.
- R9. Onboarding is configured with a minimal opt-in choice set (likely just project-interest signaling or skipping entirely). Members who decline all choices land in a documented fallback state (`@everyone` read access to cross-cutting channels only) and can re-run Onboarding via a documented re-entry mechanism. Project-specific role assignment happens via Marcus, not via Onboarding self-service.

**Gateway deployment (Phase 2 — sequencing-only here, hosting in `infra`)**

> **Ownership note:** R10–R12 set the contract that `marcusrbrown/infra`'s gateway-app execution MUST satisfy. Implementation, deployment verification, and host-side secret distribution are owned by the `infra` repo's planning and execution, not by this brainstorm. R10–R12 live here so that Phase 1 disclosure (R13/R14) and Phase 1.5 sequencing have a stable anchor.

- R10. Fro Bot is registered as a Discord application with a bot user; OAuth invite URL uses minimum-viable scopes (`bot`, `applications.commands`) and minimum-viable permissions (read channels, send messages, use slash commands; NOT `Administrator`).
- R11. Gateway daemon uses Bot Token auth (NOT OAuth user token, which is against Discord ToS). Token is provided via `${NAME}_FILE` secret pattern already supported in `packages/gateway/`.
- R12. Privileged intents fall into two categories with different enablement rules:
  - **MCP-required (R12-mcp):** `GUILD_MEMBERS` is hardcoded in `SaseQ/discord-mcp@v1.0.0` (`dev.saseq.configs.DiscordMcpConfig.java:62-70`); the bot cannot start without it. This intent exposes only data already visible to any guild member through Discord's UI (roster, join dates, role assignments). Enablement is a prerequisite for Unit 1; not gated by R13/R14.
  - **Disclosure-gated (R12-msg):** `MessageContent` is enabled in production only after R13/R14 (disclosure-before-intent) is satisfied for any new member onboarding. Documented historical deviation: `MessageContent` was enabled out-of-order on 2026-05-18 to complete the Unit 2 audit archive (Discord redacts content for bots without the intent — first audit pass returned 1,282 empty shells). Server had 2 members (Marcus + bot owned by Marcus) at the time; no third party was exposed during the gap. Disclosure doc (`docs/runbooks/discord-ai-disclosure.md`) MUST be authored and ready to ship before any new member onboards. From this date forward, no new privileged intent is enabled before disclosure is updated.
  - **Staging:** A sandbox server with a synthetic disclosure placeholder MAY be used to test the gateway's behavior with privileged intents before production-server activation.

**AI disclosure + governance (Phase 1.5, BEFORE Phase 2 goes live)**

- R13. A pinned disclosure document exists in the server before the bot's privileged intents serve any **new** member (existing 2-member state of 2026-05-18 is pre-disclosure; see R12 historical deviation note). The disclosure enumerates EVERY enabled intent by name (`GUILD_MEMBERS`, `MessageContent`, etc.) and explains what each exposes. Other content: bots operating in the server, data retention windows, third-party processors (if any), appeals process for moderation actions, AND the admin-agent's own message-body access during audit/restructure operations (what it reads, what it archives, where archives live, how long they're retained). The disclosure also acknowledges the audit-pull deviation (timing: `MessageContent` was enabled and the first audit pull was completed on 2026-05-18 before this doc shipped).
- R14. The disclosure is reviewed and approved by Marcus before posting.

**Cross-cutting**

- R15. Admin-agent action discipline. Three rules:
    - **R15a.** Read-only actions (Phase 0 audit, F1) require no per-action confirmation but MUST be performed with a verified read-only capability set; the admin agent MUST refuse to invoke any tool whose capability surface includes write/mutate operations during the audit phase.
    - **R15b.** Reversible mutations (renames, role creation, permission grants) require explicit per-action confirmation from Marcus before execution.
    - **R15c.** Irreversible actions (channel deletion, role deletion, member removal, message bulk-delete) MUST name the specific irreversible effect in the confirmation prompt before execution, AND require Marcus to type-confirm rather than checkbox-confirm.
- R16. The Fro Bot gateway's channel-scoped behavior is enforced at the Discord permission level (channel overrides), not solely in bot code. Bot code may rely on channel ID matching as defense-in-depth, but the primary gate is permission overrides.

**Operational safety + hardening (cross-cutting additions)**

- R17. Single-writer discipline between the admin agent and the gateway daemon. During admin-agent structural-change windows (any operation in F2 that mutates channels, roles, permissions, or webhooks), the gateway daemon MUST be paused or placed in a read-only mode before the first mutation. After the change window closes, a reconciliation step (gateway re-reads server state) precedes resuming normal operation.
- R18. Bot token lifecycle. Token storage path, file ownership, file permissions (must be readable only by the gateway service account), and rotation/revocation procedure are documented in a runbook before the gateway is deployed. The runbook covers: where the token file lives on the host, how it is regenerated in the Developer Portal, how the running daemon is told to reload it without downtime where possible, and the emergency revocation path when compromise is suspected.
- R19. Admin-agent data handling. When the admin agent reads message bodies during audit/restructure (R1, R2), it MUST: (a) write outputs only to a known archive path, (b) NOT echo raw message content into terminal logs or other ephemeral surfaces that may be screenshot/copied accidentally, (c) NOT transmit message content to third-party services other than the LLM provider servicing the admin-agent session, (d) honor a documented retention window for any local archive of message content.
- R20. Permission-drift detection. A periodic check (runbook step or scripted audit) compares declared channel-permission policy (per R7's role model) against effective channel permissions; deviations are reported to Marcus. The gateway daemon MUST refuse privileged actions (anything beyond mention-only response) in any channel whose effective permissions deviate from declared policy until reconciled.
- R21. Prompt-injection minimum envelope (this brainstorm sets the floor; gateway repo owns tuning via ADR). The gateway MUST: (a) in any channel readable by non-collab roles, restrict to mention-only or slash-only response, (b) enforce a per-user rate limit on agent invocations, (c) refuse to perform privileged actions (modifying server state, posting to channels other than the invocation channel, calling external APIs not in an explicit allowlist) unless invoked from an `@<project>-collab` role in that project's channel, (d) log refused-action attempts to the mod-logs channel.
- R22. Gateway intent code alignment. Before Phase 2 production deploy, the gateway code (`packages/gateway/src/discord/client.ts` default intents) MUST be updated so privileged intents (`MessageContent`, `GuildMembers`) are explicitly opt-in via configuration, not on by default. The current default-on state is incompatible with R10–R14's minimum-permission posture.
- R23. Audit fail-closed rule. The admin agent's audit phase (F1) MUST log every API call it makes and halt-and-report (rather than continue with partial state) on: rate-limit response from Discord, encountering a tool in its capability set that supports write operations during the audit pass, or any unexpected error reading a channel/role/member it expected to find. Halt-and-report produces a report to Marcus before any subsequent action.
- R24. MCP supply-chain hygiene. The Discord MCP server used by the admin agent (default candidate: `SaseQ/discord-mcp`) is pinned to a specific commit-SHA or version tag in the admin-agent's session configuration. A brief provenance review (read the README, scan recent commits for red flags, confirm maintainer identity) is performed before first use. If the MCP server is unavailable or has changed maintainer/behavior at a future use, the admin agent falls back to direct Discord REST calls per the fallback noted in Dependencies / Assumptions.

---

## Acceptance Examples

**AE1 — Covers R4** (behavioral-conditional: integration preservation):
> *When* the restructure renames the `#fro-bot` channel, *then* the GitHub Actions notification posted from `fro-bot/.github` on the next workflow run appears in the renamed channel with no missing messages. If the webhook URL must be regenerated, the regeneration and the workflow update land in a single coordinated change.

**AE2 — Covers R10, R12** (behavioral-conditional: minimum-permission scoping):
> *When* the gateway bot is invited to the server with the production OAuth URL, *then* a Discord audit-log check confirms the bot has only the documented minimum permissions (no `Administrator`, no `Manage Server`), and Developer Portal shows only the intents declared in `packages/gateway/src/discord/client.ts`.

**AE3 — Covers R12, R13, R14** (behavioral-conditional, forward-looking after the 2026-05-18 deviation):
> *Given* the disclosure doc has been authored and pinned, *when* any new member joins the server (i.e., any member beyond Marcus + bot present on 2026-05-18) OR any additional privileged intent is enabled beyond the current `GUILD_MEMBERS` + `MessageContent`, *then* the disclosure already exists, is current, and references the specific intents being used. The historical state (`GUILD_MEMBERS` + `MessageContent` enabled on 2026-05-18 before disclosure shipped) is a documented one-time deviation; no further intent changes happen before disclosure is current.

**AE4 — Covers R17** (behavioral-conditional: maintenance-lock):
> *When* the admin agent begins any structural-change operation (F2 steps), *then* the gateway daemon is paused or placed in read-only mode before the first Discord-state mutation, and a reconciliation step runs before the daemon resumes normal operation.

**AE5 — Covers R20** (behavioral-conditional: permission-drift refusal):
> *When* the gateway detects that a channel's effective permissions deviate from the policy declared in R7 (e.g., `@everyone` accidentally has view access to a `@<project>-collab`-only channel), *then* the gateway refuses any privileged action in that channel and posts an alert to the mod-logs channel until Marcus reconciles the permissions.

**AE6 — Covers R21** (behavioral-conditional: prompt-injection envelope):
> *When* a non-collab user mentions the gateway in a channel readable by non-collab roles and attempts to coerce a privileged action (e.g., "post this message to a different channel", "call this external API"), *then* the gateway refuses the privileged action, responds with a documented refusal message, and logs the refused attempt to the mod-logs channel.

---

## Success Criteria

1. Marcus can run agent work in any project channel by mentioning Fro Bot or invoking a slash command. The bot's content-reading behavior is gated per-channel by Discord permission overrides; in any channel readable by non-collab roles, the bot defaults to mention-only or slash-only.
2. Active projects are visible as their own channels (or categories), so the server reflects current project organization rather than 2016 state.
3. Adding a new project to the server is a small, repeatable operation: create channel(s), create `@<project>-collab` (and optionally `@<project>-viewer`) role, set permission overrides, optionally invite the bot. No structural redesign required per project.
4. AutoMod handles spam and obvious abuse without manual intervention; moderation alerts land in a logged channel.
5. The `#fro-bot` GitHub Actions notification path is uninterrupted through the restructure.
6. The disclosure document is live and pinned before any privileged-intent bot operates in channels readable by anyone other than `@Admin` + the relevant `@<project>-collab` role.
7. The original 3 private channels' content is archived offline before any structural change.
8. No admin-agent action is destructive without explicit per-action confirmation.

---

## Scope Boundaries

**In scope:**
- Audit + archive of current server state (admin agent path)
- Channel restructure into project-organized layout (Community Mode + per-project channels/categories + cross-cutting channels)
- Per-project role hierarchy (`@<project>-collab`, optional `@<project>-viewer`)
- AutoMod baseline + minimal Onboarding
- AI-disclosure document
- `#fro-bot` integration continuity
- Discord developer-portal setup for the gateway bot
- Permission/intent scoping for the gateway (channel-override-driven)
- Documentation: channel topics, pinned messages, disclosure, mod policy, "how to add a new project" runbook

**Out of scope (deferred or owned elsewhere):**
- Gateway daemon hosting decision → owned by `marcusrbrown/infra`
- New gateway features beyond what `packages/gateway/` ships → owned by `fro-bot/agent`
- Dedicated public Q&A channel for the bot — removed from scope; Q&A happens inside project channels where collaborators have consented to the bot's presence
- Third-party moderation bot (Modly, VibeBot, etc.) — start with Discord-native AutoMod only; add a third-party bot later only if AutoMod is insufficient
- Public-facing community programming (events, AMAs, Stage Channels) — postpone until structure proven
- Server Discovery / public-listing in Discord — explicitly NOT pursuing
- Voice channels beyond a minimal default — not a stated goal
- Promoting the server to grow a public audience — server is project-organized for Marcus's benefit; public visibility happens per project as projects mature, not via server-level promotion
- Migration to a different Discord server — staying on the existing server
- Multi-server federation / cross-posting — not in scope

---

## Key Decisions

- **Server is project-organized, not tier-organized.** The unit of organization is a project, not a membership tier. Per-project roles replace a global "inner circle" tier. This avoids identity dilution and scales as projects are added or retired without restructuring the server.
- **No dedicated public Q&A channel.** The bot operates inside project channels where collaborators have consented. Public visibility happens per project as projects mature, not via a server-level Q&A surface. This removes a chunk of disclosure-scope and `MessageContent` intent exposure.
- **Two integration paths, not one.** Fro Bot gateway (persistent daemon, channel-scoped via Discord permission overrides) is separate from the admin agent (this OpenCode session + MCP server, ephemeral, one-shot ops). This factoring lets the gateway stay lower-privilege.
- **Gateway intent posture must be flipped before Phase 2.** Current gateway code (`packages/gateway/src/discord/client.ts`) requests privileged intents by default. The minimum-permission posture in R10–R14 requires the opposite: privileged intents opt-in. R22 captures the code update; sequenced before any production deploy.
- **Audit-first revival, not burn-and-rebuild.** Member cleanup already done; structural rebuild happens alongside an offline archive, not by destroying the existing channels until the new structure is verified.
- **Community Mode is mandatory.** Unlocks AutoMod + Onboarding + Forums + Insights. Required prerequisite for everything in Phase 1.
- **Disclosure-before-intent.** Privileged intents (`MessageContent`, `Server Members`) only activate after disclosure is posted.
- **Defer gateway hosting.** Owned by `marcusrbrown/infra` (gateway app in progress). This brainstorm sequences Phase 2 but does not pick a host.
- **Start with Discord-native AutoMod only.** Third-party moderation bots (Modly, VibeBot) are not added in the initial rebuild; revisit only if AutoMod is insufficient.
- **No `Administrator` permission for Fro Bot.** Channel-scoped permission overrides + targeted bot permissions; least privilege enforced.

---

## Dependencies / Assumptions

- Marcus retains server-owner status on the existing Discord server.
- `marcusrbrown/infra` will land a `gateway` app and produce a deployable artifact; gateway daemon deployment unblocks once that's done.
- `fro-bot/agent`'s `packages/gateway/` continues to use the secret-file pattern (`${NAME}_FILE`) for token injection.
- Discord MCP server (default candidate: `SaseQ/discord-mcp`, Docker-deployable) is suitable for the admin-agent workflow. If integration friction is high, the fallback is direct Discord REST calls from the admin agent (no third-party MCP server in the loop) for one-shot tasks.

---

## Outstanding Questions

- Exact channel names + topic strings (resolved during execution).
- Which projects get a single channel vs a category with multiple channels (resolved per-project during execution).
- Per-project viewer roles: which projects get a `@<project>-viewer` role for read-only outside access, and which stay collab-only.
- Whether to use Forum Channels for high-volume project channels or stick to standard text channels.
- `@thejustinwalsh` joins per-project (which projects?) rather than as a global tier.
- Whether the archive of the 3 private channels lives in `marcusrbrown/poly`-style private docs vault or somewhere else; not in dotfiles.
- Tuning of prompt-injection envelope beyond R21's minimum (output filtering specifics, exact rate-limit thresholds, refusal-message wording). Defer to gateway-side ADR.

