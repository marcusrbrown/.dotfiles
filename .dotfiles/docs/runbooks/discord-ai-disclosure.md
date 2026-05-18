---
title: AI Disclosure — Solidarity Discord Server
audience: Members and prospective members of the Solidarity Discord server
last-updated: 2026-05-18
canonical-source: docs/runbooks/discord-ai-disclosure.md (this file)
publication-target: pinned message in a public-readable server channel (Unit 7)
related-plan: docs/plans/2026-05-18-001-feat-discord-server-revival-plan.md
related-brainstorm: docs/brainstorms/2026-05-18-discord-server-revival-requirements.md
---

# AI + Bot Disclosure — Solidarity

This document is the canonical disclosure for AI and bot activity in the [Solidarity Discord server](https://discord.com/channels/223846469327650816). It is reviewed and approved by the server owner (Marcus R. Brown) and pinned in a public-readable channel before any new member joins.

If you are reading this in the dotfiles repository, this is the version-controlled source. The pinned in-server version is canonical for member-facing disclosure; both are kept in sync.

## TL;DR

- A bot named **`Fro Bot#4027`** operates in this server with elevated read access to message content and member roster.
- It is owned and controlled by Marcus. It does not transmit member data to third parties beyond the LLM providers listed below.
- An **admin-agent path** exists where Marcus invokes the bot's read-and-write tools through an OpenCode session for one-shot server-admin tasks. The admin-agent has the same access surface as the bot itself; what's different is the **invocation pattern** (ephemeral session, human-in-the-loop, not a persistent daemon).
- A **gateway daemon path** exists where the same bot identity runs persistently (in the future, when the gateway is deployed). It will be limited by per-channel and per-role policy and rate-limits documented separately by the gateway implementation.

## Bots operating in the server

| Bot | Application ID | Type | Role | Owner |
|---|---|---|---|---|
| `Fro Bot#4027` | `1505811646956830781` | Discord application bot | `@Fro Bot` (managed) | Marcus R. Brown |

No other bots are currently in the server. If additional bots are added, this disclosure will be updated before they join.

## Enabled privileged intents

Discord requires "privileged intents" to be explicitly granted by the bot owner. Each intent expands the data the bot sees beyond the public default. The intents currently enabled on `Fro Bot`'s application are:

| Intent | Status | Enabled on | What it exposes | Why |
|---|---|---|---|---|
| `GUILD_MEMBERS` (Server Members) | ✅ ON | 2026-05-18 | Roster: usernames, IDs, join dates, role assignments — same data any guild member sees in the member list UI | Required by the chosen MCP server (`SaseQ/discord-mcp@v1.0.0`) — bot cannot start without it. This intent is part of the admin-agent path; gateway-daemon use also relies on it. |
| `MessageContent` | ✅ ON | 2026-05-18 | The plain-text body of messages in any channel the bot can read | Required to archive historic channel content during the Phase 0 audit (Unit 2 of the revival plan). Without it, Discord redacts the `content` field for bots. |
| `PRESENCE` | ⛔ OFF | — | Per-member online status changes | Not requested. Bot does not need to know who is online. |

## Historical timing note

The first audit pull (Unit 2 of the server revival plan) ran on 2026-05-18 **before** this disclosure document was authored and pinned in the server. Justification: the server had only 2 members at that time (Marcus + `Fro Bot` owned by Marcus); no third party was exposed to bot-side processing during the gap. From the date this disclosure is pinned forward, no new privileged intent is enabled before the disclosure is updated and a new audit cycle would re-trigger this section.

## What the bot sees and stores

### Through the admin-agent path (this OpenCode session pattern)

- **Reads:** Channels, roles, members, integrations, webhooks, message history (text, attachments metadata, embeds) — limited to channels and content the bot has Discord permissions to see.
- **Stores locally:** During an audit cycle, the bot writes channel-content snapshots and structural metadata to a host-side directory outside the dotfiles repository (the path is documented in the admin-agent runbook). Archive files are mode `700`, not uploaded anywhere, and live only on Marcus's local machine. Archive contents: one markdown file per accessible channel plus structural raw JSON.
- **Retention:** Audit archives are kept for as long as they are useful for re-running the revival plan. After Phase 1 work is complete and no further audit-based revalidation is expected, archives are deleted. Currently no automated retention schedule; manual cleanup by Marcus.
- **Mutations:** The admin-agent uses Discord's write APIs (create/delete channels, create/edit/delete roles, assign roles, send messages) only when Marcus explicitly directs it in an OpenCode session. Each write operation is confirmed in the OpenCode permission flow before it executes. Irreversible actions (channel delete, role delete, member remove, bulk message delete) require typed confirmation per the admin-agent runbook's R15c discipline.

### Through the gateway daemon path (future, when deployed)

- **Reads:** Same intents (`GUILD_MEMBERS`, `MessageContent`). Per-channel policy will restrict which channels the daemon reacts to.
- **Stores locally:** Daemon state (which slash commands are registered, current presence, etc.) — no message bodies stored persistently outside Discord.
- **Mutations:** Limited to slash-command responses, mention-handler responses, and any explicitly-allowed automation. Policy is enforced in the gateway daemon's source code, separately from this disclosure.

## Third-party processors

The admin-agent path passes message content from the bot through the OpenCode session into LLM providers when Marcus's prompts mention channel content. As of the launch state (2026-05-18) the LLM providers reachable from Marcus's OpenCode setup are:

- **Anthropic** — current generation of Claude models
- **GitHub Copilot proxy** — current generation routed through Copilot (subset of Anthropic + OpenAI catalogs)
- **OpenAI** — current generation of GPT models direct via OpenAI API
- **OpenCode-Go** — current generation of DeepSeek + Moonshot models via OpenCode's hosted router

Each provider's retention and training policy applies. Marcus does not enable training-on-input where the option is configurable. Members who do not want their messages potentially processed by any of the above should not post in channels Marcus can read (which is every public channel + any private channel the bot has been granted access to).

## Appeals + opt-out

- If you do not want your messages processed by the admin-agent or the gateway daemon, contact Marcus directly and ask him to revoke the bot's access to the channel(s) you post in. Per-channel permission overrides can deny the bot view access on specific channels.
- If you object to your data appearing in a Marcus-side archive that was already captured, contact Marcus and request deletion of that specific channel's archive file. Marcus will confirm deletion.
- If you object to the bot operating in the server at all, you can leave the server. There is no continued bot processing of data once you are no longer a member (Discord stops sending member-related events for non-members).

## Updates

- This document is updated whenever:
  - Privileged intents change
  - A new bot is added to the server
  - A new LLM provider becomes reachable from Marcus's OpenCode setup
  - The admin-agent's archive retention policy changes
- Updates land in the dotfiles repository first (`docs/runbooks/discord-ai-disclosure.md`) and propagate to the pinned server copy within 24 hours.
- Members are notified of material changes via a message in a public channel.

## Contact

Marcus R. Brown — `marcusrbrown` on Discord, GitHub, and most other platforms; `git@mrbro.dev` for the trust-and-safety-related concerns.
