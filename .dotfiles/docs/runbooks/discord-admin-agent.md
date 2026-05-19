---
title: Discord Admin Agent — Runbook
audience: Marcus (server-owner workflow) + AI assistants in an OpenCode session
related-plan: docs/plans/2026-05-18-001-feat-discord-server-revival-plan.md
mcp-server: saseq/discord-mcp:1.0.0 (commit 6725bce7ed057a2d9485473f04b3e56a2eee775e)
---

# Discord Admin Agent — Runbook

The **admin-agent path** is an ephemeral OpenCode session that uses the [SaseQ/discord-mcp](https://github.com/SaseQ/discord-mcp) MCP server to perform one-shot server-admin tasks against Marcus's Discord server. It is **distinct from** the Fro Bot gateway daemon (which runs persistently and is owned by `fro-bot/agent` + `marcusrbrown/infra`).

This runbook covers:

- **Pin + provenance** — version, image source, review record
- **Preflight** — verifying the environment before starting an admin-agent session
- **Token sourcing** — how `DISCORD_TOKEN` reaches the MCP container
- **Capability surface** — what the 50 SaseQ tools cover
- **Action discipline** — R15a/R15b/R15c enforcement (procedural)
- **Token handoff** — pointer to `marcusrbrown/infra` for the canonical token-lifecycle runbook
- **Fallback** — direct Discord REST if the MCP server is unavailable
- **Review cadence** — R24 pinned-SHA review cycle

---

## Pin + provenance

| Field                 | Value                                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `pinned_image`        | `saseq/discord-mcp:1.0.0`                                                                                                     |
| `pinned_sha`          | `6725bce7ed057a2d9485473f04b3e56a2eee775e`                                                                                    |
| `source_repo`         | https://github.com/SaseQ/discord-mcp                                                                                          |
| `release_date`        | 2026-03-16                                                                                                                    |
| `platform_limitation` | arm64-only on Docker Hub at v1.0.0 — Apple Silicon machines (this one) are fine; x86_64 hosts won't pull                      |
| `reviewed_at`         | 2026-05-18                                                                                                                    |
| `reviewed_by`         | Marcus R. Brown                                                                                                               |
| `next_review_trigger` | Before every write-capable admin session AND quarterly while configured                                                       |
| `provenance_verdict`  | Safe to use (no security advisories; no security-themed open issues; README documents tooling clearly; v1.0.0 tagged release) |

Re-review consists of (a) checking the upstream repo for new security advisories or maintainer changes, (b) scanning recent commits for red flags, (c) confirming the pinned SHA is not behind a relevant security fix. Update `reviewed_at` and bump the pin if anything material changes; freeze MCP use and fall back to direct REST if upstream changed hands, was archived, or has unexplained privileged-surface changes.

---

## Preflight

Run these checks before starting an admin-agent OpenCode session. Each check is non-mutating. The default flow assumes macOS with Rancher Desktop; on Linux or in a devcontainer, ensure `docker` is reachable however your environment provides it, and substitute the macOS Keychain step (Token sourcing → Option A) with a `chmod 600` plaintext env file (Option B).

```bash
# 1. Docker daemon reachable (Rancher Desktop must be running on this machine)
docker ps >/dev/null 2>&1 && echo "✅ docker OK" || echo "❌ start Rancher Desktop"

# 2. Pinned image is pulled locally (pull once; subsequent sessions reuse the image)
docker image inspect saseq/discord-mcp:1.0.0 >/dev/null 2>&1 \
  && echo "✅ image present" \
  || (echo "pulling..." && docker pull saseq/discord-mcp:1.0.0)

# 3. DISCORD_TOKEN is in the shell env (token sourcing options below)
[ -n "$DISCORD_TOKEN" ] && echo "✅ token in env" || echo "❌ set DISCORD_TOKEN (see Token sourcing)"

# 4. (Optional) DISCORD_GUILD_ID set if you want a default server scope
[ -n "$DISCORD_GUILD_ID" ] && echo "✅ guild id in env" || echo "ℹ️  no default guild (per-call guild_id required)"
```

If any check fails, do NOT start the session. The admin-agent path is non-destructive when it can't reach Discord — the OpenCode session simply won't see the Discord MCP tools.

---

## Token sourcing

`saseq/discord-mcp` v1.0.0 takes the token as a direct `DISCORD_TOKEN` env var (no `*_FILE` indirection). Token sourcing options on this machine, in order of preference:

### Option A — macOS Keychain (recommended)

Store the token once:

```bash
security add-generic-password \
  -a "$USER" \
  -s "discord-bot-fro-bot" \
  -w "<paste-discord-bot-token>" \
  -U
```

Export it at shell startup via a gitignored file under `.config/bash/local.d/`:

```bash
# .config/bash/local.d/discord.bash  (gitignored — DO NOT commit)
if command -v security >/dev/null 2>&1; then
  export DISCORD_TOKEN="$(security find-generic-password -s discord-bot-fro-bot -w 2>/dev/null)"
  export DISCORD_GUILD_ID="<your-guild-id>"
fi
```

### Option B — plaintext local-only env file

If you don't want to use Keychain, set the env vars directly in a gitignored file:

```bash
# .config/bash/local.d/discord.bash  (gitignored — DO NOT commit)
export DISCORD_TOKEN="<paste-discord-bot-token>"
export DISCORD_GUILD_ID="<your-guild-id>"
```

Filesystem permissions: `chmod 600 ~/.config/bash/local.d/discord.bash` so only your user can read it.

### Option C — 1Password CLI (future)

Once `op` is installed (add to `Brewfile` first), the export becomes:

```bash
export DISCORD_TOKEN="$(op read 'op://Personal/discord-fro-bot/credential')"
```

### Where the token MUST NOT live

- Any tracked file under `~/.dotfiles/` (including this runbook, the plan, AGENTS.md, opencode.json)
- `~/.config/bash/exports` (tracked) or `~/.config/bash/init.d/*.bash` (tracked)
- Any `.env` in a tracked directory
- Any Discord MCP server config snippet that gets committed

The dotfiles' `.gitignore` allowlist + `~/.config/git/ignore` global-credential-shape patterns + the gitleaks pre-commit hook are the three defense layers; rely on all three.

---

## Starting an admin-agent session

1. Run preflight (above).
2. Toggle the MCP server on in `~/.config/opencode/opencode.json` by changing `mcp.discord.enabled` from `false` to `true`. **Do not commit this toggle.** (Future: a per-session flag would be nicer; for now it's a manual flip.)
3. Start OpenCode from a project root (the `dotfiles-opencode` alias works) so AFT doesn't refuse to configure on `$HOME`.
4. Prompt the agent — e.g., `"Use the discord MCP tools to enumerate channels, roles, and integrations in the server. Read-only audit only — do not perform any mutation."`
5. When the session is done, **flip `mcp.discord.enabled` back to `false`** before committing any unrelated dotfiles work. Default-disabled posture means no other OpenCode session unexpectedly gets Discord write access.

---

## Capability surface (65 tools)

SaseQ/discord-mcp v1.0.0 exposes these tool categories. Read-only-safe tools are marked ✅; write-capable tools are marked ⚠️.

| Category            | Read-only ✅                                                     | Write-capable ⚠️                                                                                                               |
| ------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Server info         | `get_server_info`                                                | —                                                                                                                              |
| User                | `get_user_id_by_name`, `read_private_messages`                   | `send_private_message`, `edit_private_message`, `delete_private_message`                                                       |
| Message             | `read_messages`                                                  | `send_message`, `edit_message`, `delete_message`, `add_reaction`, `remove_reaction`                                            |
| Channel             | `find_channel`, `list_channels`, `get_channel_info`              | `create_text_channel`, `edit_text_channel`, `delete_channel`, `move_channel`                                                   |
| Category            | `find_category`, `list_channels_in_category`                     | `create_category`, `delete_category`                                                                                           |
| Webhook             | `list_webhooks`                                                  | `create_webhook`, `delete_webhook`, `send_webhook_message`                                                                     |
| Role                | `list_roles`                                                     | `create_role`, `edit_role`, `delete_role`, `assign_role`, `remove_role`                                                        |
| Moderation          | `get_bans`                                                       | `kick_member`, `ban_member`, `unban_member`, `timeout_member`, `remove_timeout`, `set_nickname`                                |
| Voice/Stage         | —                                                                | `create_voice_channel`, `create_stage_channel`, `edit_voice_channel`, `move_member`, `disconnect_member`, `modify_voice_state` |
| Scheduled events    | `list_guild_scheduled_events`, `get_guild_scheduled_event_users` | `create_guild_scheduled_event`, `edit_guild_scheduled_event`, `delete_guild_scheduled_event`                                   |
| Channel permissions | `list_channel_permission_overwrites`                             | `upsert_role_channel_permissions`, `upsert_member_channel_permissions`, `delete_channel_permission_overwrite`                  |
| Invites             | `list_invites`, `get_invite_details`                             | `create_invite`, `delete_invite`                                                                                               |
| Emoji               | `list_emojis`, `get_emoji_details`                               | `create_emoji`, `edit_emoji`, `delete_emoji`                                                                                   |

For the Phase 0 audit (plan Unit 2), only the ✅ read-only tools are needed. The agent should be explicitly instructed to use only those tools during audit; this is the procedural enforcement of plan R15a + R23.

---

## Action discipline (R15a / R15b / R15c)

The MCP server does not enforce typed confirmation independent of the OpenCode session's prompt flow. R15c is a **procedural** control, not a technical one:

- **R15a (read-only audit):** Prompt the agent with explicit "read-only — no mutations" framing. Reject any tool-call attempt from the ⚠️ Write-capable column during audit phases. If the agent attempts one, abort the session.
- **R15b (reversible mutations — rename, role create, permission grant):** Confirm each action before approving in the OpenCode permission flow.
- **R15c (irreversible — channel delete, role delete, member remove, message bulk-delete):** Type-confirm: enter the channel/role name verbatim before the action proceeds. This is human discipline; the MCP server itself cannot enforce it.

When in doubt, do the dry-run version first. The agent can `list_channels` before `delete_channel`, `list_roles` before `delete_role`, etc.

---

## Role + permission policy (declared)

This section is the **declared policy** that the permission-drift detector (Unit 8) compares against the live Discord state. Every role or override mutation must update this section in the same PR; the drift detector reads this as its source of truth.

### Roles

| Role                                     | Position                          | Members declared                                    | Owner                  | Project status                                                                               |
| ---------------------------------------- | --------------------------------- | --------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------- |
| `@admin`                                 | 9                                 | server owner only                                   | server owner           | active                                                                                       |
| `Fro Bot` (managed)                      | 3                                 | applied automatically by Discord when the bot joins | server owner           | active — admin-agent + future gateway-daemon paths                                           |
| `@<project>-collab` (e.g. `poly-collab`) | below `@admin`, above `@everyone` | every active collaborator on the named project      | server owner (default) | active when the project is active; retired during drift cleanup when the project is archived |
| `@<project>-viewer` (e.g. `poly-viewer`) | below the matching `-collab` role | optional; read-only outside collaborators           | server owner (default) | tracks the matching `-collab` role's lifecycle                                               |

Historic collaboration roles inherited from the server's pre-revival state (positions 4-8 in this server) — 0 declared members; project status: retired. Removal deferred to drift cleanup.

### Category overrides

| Category        | Override target                                                                                                                                                                                                                                               | Effect                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `Server Info`   | (none)                                                                                                                                                                                                                                                        | inherits `@everyone` defaults — public-readable |
| `Cross-cutting` | (none)                                                                                                                                                                                                                                                        | inherits `@everyone` defaults — public-readable |
| `Operations`    | `@everyone` deny ViewChannel; `@Fro Bot` allow ViewChannel + ManageChannels + ManageRoles + ManageWebhooks + ReadMessageHistory                                                                                                                               | admin-only                                      |
| `<project>`     | `@everyone` deny ViewChannel; `@<project>-collab` allow ViewChannel + SendMessages + ReadMessageHistory; `@<project>-viewer` allow ViewChannel + ReadMessageHistory and deny SendMessages; `@Fro Bot` allow ViewChannel + ManageChannels + ReadMessageHistory | per-project restricted                          |

### Channel-level overrides

Inherited from category overrides unless explicitly noted. As of the most recent restructure, no per-channel overrides exist above the category baseline.

### `#fro-bot` placement

`#fro-bot` is the GitHub Actions integration channel that receives webhook posts from `fro-bot/agent`. It lives under the `Cross-cutting` category (public-readable, inherits `@everyone` defaults), not `Operations`. This is intentional: the channel is an activity feed any collaborator should be able to read, not an admin-only surface. The Discord webhook bound to channel id `1496350231158063288` survives category moves (webhooks key on channel id, not name or parent), and was verified post-restructure by observing two webhook posts arriving in the channel after the move.

### Update protocol

Every change to this table is paired with the matching Discord state mutation in the same PR. The drift detector halts and surfaces the delta when the live state diverges from this declared policy. If a mutation lands without updating this table, that's a process miss to catch in the next drift run.

---

## AutoMod policy (declared)

This section is the **declared AutoMod policy** that the drift detector (Unit 8) compares against the live Discord rule set. Every rule mutation must update this section in the same PR.

### Active rules

| Rule name                | Trigger type         | Configuration                                                         | Actions                                                                                                                  | Exempt roles | Exempt channels |
| ------------------------ | -------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------ | --------------- |
| `Block Mention Spam`     | `MENTION_SPAM` (5)   | `mention_total_limit=7`, `mention_raid_protection_enabled=true`       | BLOCK with custom message `"Message blocked by Fronomenal AutoMod (mention spam)."`; SEND_ALERT to `#mod-logs`           | `@admin`     | `#mod-logs`     |
| `Commonly Flagged Words` | `KEYWORD_PRESET` (4) | `presets=[1,2,3]` (PROFANITY, SEXUAL_CONTENT, SLURS), `allow_list=[]` | BLOCK with custom message `"Message blocked by Fronomenal AutoMod (commonly-flagged words)."`; SEND_ALERT to `#mod-logs` | `@admin`     | `#mod-logs`     |

The custom-keyword rule referenced in the Phase 2 plan is intentionally not yet created. It will be added when an actual keyword pattern needs to be blocked; the drift detector treats its absence as expected until then.

### Action and trigger reference

- BLOCK_MESSAGE (`type=1`): deletes the offending message before it's posted, optionally surfaces a custom message to the author (max 150 chars).
- SEND_ALERT_MESSAGE (`type=2`): posts a `[message blocked]` event embed to the configured alert channel; metadata includes the original author, channel, and trigger phrase preview.
- KEYWORD_PRESET (`trigger_type=4`) presets: `1`=PROFANITY, `2`=SEXUAL_CONTENT, `3`=SLURS.
- MENTION_SPAM (`trigger_type=5`) counts **unique** role and user mentions per message (`@everyone` and `@here` count as one each).

### Exemptions

Server owners, members with the `Administrator` permission, members with the `Manage Server` permission, bots, and webhooks are **always** exempt from AutoMod evaluation. This is a Discord platform behavior, not a configuration choice. `exempt_roles` in this policy is additive on top of that platform baseline; in this server `@admin` is in `exempt_roles` to make the policy explicit when audited even though the holder is already implicitly exempt as the server owner.

### Why alert-channel routing requires the Discord UI

When creating an AutoMod rule with a `SEND_ALERT_MESSAGE` action via the API, Discord requires the requesting bot to have `ViewChannel` + `SendMessages` permissions on the target alert channel as **channel-level explicit overrides**. Category-level inheritance does not satisfy this check; the API returns `400 INVALID_AUTO_MODERATION_CHANNEL_FLAG_ACTION_ACCESS`. Since `#mod-logs` lives in the admin-only `Operations` category and `@Fro Bot`'s allow set is granted at the category level, alert routing must be configured via Server Settings → AutoMod → click into the rule → enable "Send Alert" → choose `#mod-logs`. The server owner's UI session is not subject to this constraint.

### Verification approach

The plan's literal acceptance criterion ("Marcus posts a triggering message; alert lands in `#mod-logs`") cannot be exercised by the server owner because Discord exempts owners from AutoMod by design. Unit 5 is verified instead by **configuration assertion**: each live rule's `trigger_type`, `trigger_metadata`, `actions`, `exempt_roles`, and `exempt_channels` are compared against the declared policy table above. End-to-end trigger verification is deferred to whenever a non-Admin user first joins the server (R7 onboarding path); the drift detector flags it as a one-time check during that onboarding.

Updates to this section follow the same protocol as the channel-permission policy above: every rule mutation is paired with the matching update here in the same PR. See ["Update protocol" under "Role + permission policy"](#update-protocol) for the canonical wording.

---

## Onboarding policy (declared)

This section is the **declared Onboarding + Welcome Screen policy** for the server. Both surfaces require Community Mode (✅ already on).

### Welcome Screen

| Field              | Value                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------- |
| `enabled`          | `true`                                                                                  |
| `description`      | `Marcus's projects. Read #welcome first for the AI/bot disclosure.` (65 chars; max 140) |
| `welcome_channels` | 5 entries (max 5): `#welcome`, `#rules`, `#announcements`, `#general`, `#fro-bot`       |

The Welcome Screen renders on the invite-page splash before the new member finalizes joining. It points first at `#welcome` because that channel holds the pinned AI/bot disclosure — the disclosure is therefore reachable in one click from the first contact surface, satisfying R7's "disclosure precedes any data-exposing interaction".

### Onboarding

| Field                    | Value                                                                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `enabled`                | `false` (gated — see below)                                                                                                                                                                                  |
| `mode`                   | `0` (`ONBOARDING_DEFAULT`)                                                                                                                                                                                   |
| `default_channel_ids`    | 6 channels: `#rules`, `#welcome`, `#announcements`, `#general`, `#fro-bot`, voice `General`                                                                                                                  |
| `prompts`                | 1 prompt: `"What brings you to Fronomenal?"` (`single_select=true`, `required=false`, `in_onboarding=true`)                                                                                                  |
| prompt options           | `"Interested in poly"` (routes to `#general`) and `"Just looking around"` (routes to `#welcome`)                                                                                                             |
| role grants from prompts | **None.** Neither option assigns a role. Per R7 + plan Unit 4, `@<project>-collab` roles are server-owner-assigned only; the prompts route members to channels they can already see, not to elevated access. |

#### Why Onboarding is currently disabled

Discord requires `default_channel_ids` to contain **at least 7 channels** when `enabled: true`, and at least 5 of those 7 must allow `@everyone` to View + Send messages. The server currently has 6 public-readable channels (the 5 in the Welcome Screen plus the voice `General`). Onboarding is fully configured but `enabled: false` until either (a) a 7th public channel exists, or (b) the policy is updated to count a different shape.

The configured prompt + options are already saved; only the `enabled` flag is gated. When a 7th public channel lands, flipping `enabled: true` is a single API call with no other changes required.

#### Fallback (`@everyone` view)

R9's `@Visitor`-equivalent fallback is satisfied by Discord defaults: a member who declines or skips Onboarding lands in `@everyone` and inherits read access to all channels under categories without `@everyone deny ViewChannel`. In this server that means: `Server Info`, `Cross-cutting` (and the contents of those categories). The admin-only categories (`Operations`, `poly`) remain hidden by their existing overrides. No separate `@Visitor` role is created; the `@everyone` baseline IS the fallback.

#### Trigger verification

Per Discord's design, server owners and Admin/Manage-Server holders bypass the Onboarding flow on their own joins. Live end-to-end Onboarding verification ("a test member completes Onboarding and lands in the expected channel set") is deferred to the first non-Admin user join, the same trigger point as the AutoMod verification deferral noted in Unit 8 of the revival plan.

Updates to this section follow the same protocol as the channel-permission policy above: every Onboarding or Welcome Screen mutation is paired with the matching update here in the same PR. See ["Update protocol" under "Role + permission policy"](#update-protocol) for the canonical wording.

---

## Token handoff (pointer to `marcusrbrown/infra`)

The **canonical token-lifecycle runbook** lives in [`marcusrbrown/infra`](https://github.com/marcusrbrown/infra), not here. That repo owns:

- Host-side token-file storage path + ownership + filesystem permissions
- Rotation procedure (Developer Portal regeneration → secret update → daemon reload)
- Emergency revocation path
- Handling of in-flight Discord interactions during rotation

### Where to find the canonical doc

| State                             | Read from                                                                                                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Today (no standalone runbook yet) | [`apps/gateway/AGENTS.md`](https://github.com/marcusrbrown/infra/blob/main/apps/gateway/AGENTS.md) covers the deployment-time token setup as part of the gateway stack documentation. |
| Future (standalone runbook lands) | The canonical token-lifecycle runbook in `marcusrbrown/infra` will be linked here.                                                                                                    |

> 📌 **TODO** (plan Unit 11): Once a dedicated `docs/runbooks/discord-token-lifecycle.md` (or equivalent) exists in `marcusrbrown/infra`, replace this paragraph with the direct URL. The trigger is the next PR in `infra` that creates a standalone token-lifecycle runbook; the marker exists so a future review or audit of this section catches the missing link.

### Handoff contract

The dotfiles-side admin-agent path and the production gateway daemon consume the **same Discord bot token** through different channels:

| Consumer                              | Channel                                                                                                                                                                                                                                      | Lifecycle                                                      |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Admin-agent (this runbook)            | `DISCORD_TOKEN` env var, sourced from macOS Keychain on this machine                                                                                                                                                                         | Ephemeral per OpenCode session                                 |
| Gateway daemon (`marcusrbrown/infra`) | `${NAME}_FILE` precedence then `process.env[name]` pattern (see [`packages/gateway/src/config.ts:20-101`](https://github.com/fro-bot/agent/blob/main/packages/gateway/src/config.ts) in the upstream pinned at `apps/gateway/upstream.json`) | Long-running, file-backed, rotated via `infra` deploy pipeline |

Both consumers point at the same Discord application — the token bound to bot user `Fro Bot#4027` (application id [`1505811646956830781`](https://discord.com/developers/applications/1505811646956830781)). Rotating the token in the Developer Portal invalidates BOTH consumers simultaneously; the rotation procedure in `infra` must therefore coordinate or accept brief admin-agent unavailability during the rotation window.

The dotfiles-side admin-agent path uses the bot token only for read-mostly audit work; the production deploy (gateway daemon) consumes the same token via `infra`'s deploy pipeline. Same token, different consumers, single source of truth (the Discord Developer Portal).

---

## Fallback: direct Discord REST

If the MCP server is unavailable (Docker down, image pull failure, upstream supply-chain concerns), fall back to direct Discord REST calls via `curl` or a small script. The OpenCode agent can author and execute these directly; no MCP needed.

```bash
# Example: list channels (read-only)
curl -s -H "Authorization: Bot $DISCORD_TOKEN" \
  "https://discord.com/api/v10/guilds/$DISCORD_GUILD_ID/channels" \
  | jq '.[] | {id, name, type, parent_id}'
```

Direct REST has the same capability surface as the MCP server's underlying calls but loses the typed tool definitions and per-tool documentation. Acceptable for one-shot ops.

---

## Review cadence

Per plan R24, this runbook's pin metadata is re-reviewed:

1. **Before every write-capable admin-agent session** (re-check upstream for security advisories, maintainer changes)
2. **At least quarterly** while the MCP config remains tracked (calendar reminder; or trigger via session note when reviewed)
3. **When the pinned SHA falls behind a relevant security fix** (re-pin after review, or fall back to direct REST)

Update the `reviewed_at` field in the pin table when re-reviewed. If re-pinning, also update `pinned_image` + `pinned_sha`.
