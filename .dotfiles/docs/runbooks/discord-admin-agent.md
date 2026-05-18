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

| Field | Value |
|-------|-------|
| `pinned_image` | `saseq/discord-mcp:1.0.0` |
| `pinned_sha` | `6725bce7ed057a2d9485473f04b3e56a2eee775e` |
| `source_repo` | https://github.com/SaseQ/discord-mcp |
| `release_date` | 2026-03-16 |
| `platform_limitation` | arm64-only on Docker Hub at v1.0.0 — Apple Silicon machines (this one) are fine; x86_64 hosts won't pull |
| `reviewed_at` | 2026-05-18 |
| `reviewed_by` | Marcus R. Brown |
| `next_review_trigger` | Before every write-capable admin session AND quarterly while configured |
| `provenance_verdict` | Safe to use (no security advisories; no security-themed open issues; README documents tooling clearly; v1.0.0 tagged release) |

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

## Capability surface (50 tools)

SaseQ/discord-mcp v1.0.0 exposes these tool categories. Read-only-safe tools are marked ✅; write-capable tools are marked ⚠️.

| Category | Read-only ✅ | Write-capable ⚠️ |
|---|---|---|
| Server info | `get_server_info` | — |
| User | `get_user_id_by_name`, `read_private_messages` | `send_private_message`, `edit_private_message`, `delete_private_message` |
| Message | `read_messages` | `send_message`, `edit_message`, `delete_message`, `add_reaction`, `remove_reaction` |
| Channel | `find_channel`, `list_channels`, `get_channel_info` | `create_text_channel`, `edit_text_channel`, `delete_channel`, `move_channel` |
| Category | `find_category`, `list_channels_in_category` | `create_category`, `delete_category` |
| Webhook | `list_webhooks` | `create_webhook`, `delete_webhook`, `send_webhook_message` |
| Role | `list_roles` | `create_role`, `edit_role`, `delete_role`, `assign_role`, `remove_role` |
| Moderation | `get_bans` | `kick_member`, `ban_member`, `unban_member`, `timeout_member`, `remove_timeout`, `set_nickname` |
| Voice/Stage | — | `create_voice_channel`, `create_stage_channel`, `edit_voice_channel`, `move_member`, `disconnect_member`, `modify_voice_state` |
| Scheduled events | `list_guild_scheduled_events`, `get_guild_scheduled_event_users` | `create_guild_scheduled_event`, `edit_guild_scheduled_event`, `delete_guild_scheduled_event` |
| Channel permissions | `list_channel_permission_overwrites` | `upsert_role_channel_permissions`, `upsert_member_channel_permissions`, `delete_channel_permission_overwrite` |
| Invites | `list_invites`, `get_invite_details` | `create_invite`, `delete_invite` |
| Emoji | `list_emojis`, `get_emoji_details` | `create_emoji`, `edit_emoji`, `delete_emoji` |

For the Phase 0 audit (plan Unit 2), only the ✅ read-only tools are needed. The agent should be explicitly instructed to use only those tools during audit; this is the procedural enforcement of plan R15a + R23.

---

## Action discipline (R15a / R15b / R15c)

The MCP server does not enforce typed confirmation independent of the OpenCode session's prompt flow. R15c is a **procedural** control, not a technical one:

- **R15a (read-only audit):** Prompt the agent with explicit "read-only — no mutations" framing. Reject any tool-call attempt from the ⚠️ Write-capable column during audit phases. If the agent attempts one, abort the session.
- **R15b (reversible mutations — rename, role create, permission grant):** Confirm each action before approving in the OpenCode permission flow.
- **R15c (irreversible — channel delete, role delete, member remove, message bulk-delete):** Type-confirm: enter the channel/role name verbatim before the action proceeds. This is human discipline; the MCP server itself cannot enforce it.

When in doubt, do the dry-run version first. The agent can `list_channels` before `delete_channel`, `list_roles` before `delete_role`, etc.

---

## Token handoff (pointer to `marcusrbrown/infra`)

The **canonical token-lifecycle runbook** lives in [`marcusrbrown/infra`](https://github.com/marcusrbrown/infra), not here. That repo owns:
- Host-side token-file storage path + ownership + filesystem permissions
- Rotation procedure (Developer Portal regeneration → secret update → daemon reload)
- Emergency revocation path
- Handling of in-flight Discord interactions during rotation

When `marcusrbrown/infra` lands the runbook, update this section with the URL:

> 📌 **TODO:** Update with the canonical token-lifecycle runbook URL once `marcusrbrown/infra` ships it. Reference: plan Unit 11.

The dotfiles-side admin-agent path uses the bot token only for read-mostly audit work; the production deploy (gateway daemon) consumes the same token via `infra`'s deploy pipeline. Same token, different consumers.

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
