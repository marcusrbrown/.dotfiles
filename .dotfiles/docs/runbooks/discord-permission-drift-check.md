---
title: Discord Permission Drift Check — Runbook
audience: Marcus (server-owner workflow) + AI assistants in an OpenCode session
related-plan: docs/plans/2026-05-18-001-feat-discord-server-revival-plan.md
related-runbook: docs/runbooks/discord-admin-agent.md
cadence: monthly while the server has active collaborators; on-demand after any major Discord-side change
---

# Discord Permission Drift Check — Runbook

This runbook is the manual procedure for **R20's drift detection**: periodic comparison of the live Discord server state against the declared policies in [`discord-admin-agent.md`](./discord-admin-agent.md). The check is read-only; it surfaces deltas for review but does not auto-remediate.

The runbook covers four declared-policy sections:

1. **Roles** — set, position, and project status
2. **Category overrides** — `@everyone` deny + role allow shapes on each category
3. **AutoMod rules** — trigger configuration, exemptions, alert routing
4. **Onboarding + Welcome Screen** — surface config and prompt set

Automation is deferred to a follow-up. The current procedure is one OpenCode session running through the steps below.

---

## When to run

- **Monthly**, calendar-driven, while the server has any active project category. Skip months where no project category exists.
- **On-demand** after any of:
  - A new project category was added or an existing one retired.
  - A new role was created or position was changed.
  - An AutoMod rule was added, removed, or threshold-changed.
  - A new member joined and was assigned any role.
  - Any change made via the Discord UI rather than the API (Discord UI changes don't get recorded in dotfiles history, so the drift check is the only way to catch them).
  - Before a major bot-permission change (e.g., re-inviting the bot with a different mask).

## How to run

The drift check is read-only (R15a). All commands below use `GET`. The output of each command is compared against the declared policy table by eye; differences are recorded under "Findings" at the end of the runbook.

### Preflight

Same as [`discord-admin-agent.md` Preflight](./discord-admin-agent.md#preflight). Token in env, guild id in env, docker up if you want MCP, otherwise direct REST.

For the rest of this runbook, the environment variables `DISCORD_TOKEN`, `DISCORD_GUILD_ID`, and `UA` are assumed to be set, e.g.:

```bash
UA="DiscordBot (dotfiles-admin-agent, 0.1.0)"
```

### Step 1 — Roles

```bash
curl -sS -H "Authorization: Bot $DISCORD_TOKEN" -H "User-Agent: $UA" \
  "https://discord.com/api/v10/guilds/$DISCORD_GUILD_ID/roles" \
  | jq -r '.[] | select(.name != "@everyone") | "\(.position)\t\(.name)\t\(.id)\t\(.managed)"' \
  | sort -rn
```

Expected shape (per declared policy):

- `@admin` at the top of the manual roles.
- `Fro Bot` (managed) somewhere between `@admin` and the project roles.
- One `@<project>-collab` + one `@<project>-viewer` per active project.
- Historic collaboration roles (with 0 members) sitting above or below — declared "retired"; they can stay or be cleaned up as a separate drift action.

**Compare against:** the Roles table in `discord-admin-agent.md` § "Role + permission policy".

**Common drift cases:**
- A role was added without updating the runbook → file the addition or remove the role.
- A role's position changed → fix position via PATCH or re-document the new position.
- A retired role gained a member → either retire the member or re-classify the role as active.

### Step 2 — Category overrides

```bash
# List all categories, then dump overrides for each
curl -sS -H "Authorization: Bot $DISCORD_TOKEN" -H "User-Agent: $UA" \
  "https://discord.com/api/v10/guilds/$DISCORD_GUILD_ID/channels" \
  | jq -r '.[] | select(.type == 4) | "\(.id)\t\(.name)"'

# For each category id from above, fetch its overrides
CAT_ID="<paste-id>"
curl -sS -H "Authorization: Bot $DISCORD_TOKEN" -H "User-Agent: $UA" \
  "https://discord.com/api/v10/channels/$CAT_ID" \
  | jq '{name, overwrites: .permission_overwrites}'
```

For each override, decode the `allow` and `deny` integers against Discord's permission bit reference:

| Bit | Value | Permission |
| --- | --- | --- |
| 10 | `0x400` | `VIEW_CHANNEL` |
| 11 | `0x800` | `SEND_MESSAGES` |
| 16 | `0x10000` | `READ_MESSAGE_HISTORY` |
| 4 | `0x10` | `MANAGE_CHANNELS` |
| 28 | `0x10000000` | `MANAGE_ROLES` |
| 29 | `0x20000000` | `MANAGE_WEBHOOKS` |

**Compare against:** the Category overrides table in `discord-admin-agent.md` § "Role + permission policy".

**Common drift cases:**
- New category exists without a row in the declared policy → add the row or delete the category.
- A category's override shape (allow + deny ints) doesn't match the row → either fix Discord or re-document.
- An override targets a role not in the declared role set → that's a role-drift carried through to permissions.

### Step 3 — Channel-level overrides

```bash
# Walk all non-category channels, check whether any has overrides beyond inheritance
curl -sS -H "Authorization: Bot $DISCORD_TOKEN" -H "User-Agent: $UA" \
  "https://discord.com/api/v10/guilds/$DISCORD_GUILD_ID/channels" \
  | jq -r '.[] | select(.type != 4 and ((.permission_overwrites // []) | length) > 0) | "\(.name)\t\(.id)\t\(.parent_id)\t\(.permission_overwrites | length) overrides"'
```

**Compare against:** the Channel-level overrides paragraph in `discord-admin-agent.md` § "Role + permission policy", which currently declares "Inherited from category overrides unless explicitly noted. As of the most recent restructure, no per-channel overrides exist above the category baseline."

**Common drift cases:**
- A channel has overrides that duplicate the category's — usually harmless redundancy; document or remove. (Example: `#poly` carries an inherited `@everyone` deny ViewChannel that duplicates its category override. The shape is identical to the category's, so behavior is correct, but the runbook should call out the duplication when it appears so a future reader understands the per-channel row is intentional or removable.)
- A channel has overrides that contradict the category — this is real drift; investigate immediately.
- A new per-channel override appeared without being declared → add the row or remove the override.

### Step 4 — AutoMod rules

```bash
curl -sS -H "Authorization: Bot $DISCORD_TOKEN" -H "User-Agent: $UA" \
  "https://discord.com/api/v10/guilds/$DISCORD_GUILD_ID/auto-moderation/rules" \
  | jq '.[] | {id, name, trigger_type, enabled, exempt_roles, exempt_channels, actions, trigger_metadata, creator_id}'
```

**Compare against:** the Active rules table in `discord-admin-agent.md` § "AutoMod policy".

For each declared rule, verify:

- `enabled: true`
- `trigger_type` matches (4 = KEYWORD_PRESET, 5 = MENTION_SPAM)
- `trigger_metadata.presets` for KEYWORD_PRESET matches the declared preset set
- `trigger_metadata.mention_total_limit` for MENTION_SPAM matches the declared threshold
- `actions` has at least the BLOCK_MESSAGE entry; SEND_ALERT_MESSAGE points at `#mod-logs`
- `exempt_roles` contains `@admin`'s id (additive over the platform-baseline owner/Admin/Manage-Server/bot/webhook exemption)
- `exempt_channels` contains `#mod-logs`'s id

**Common drift cases:**
- A new rule appeared owned by Discord's `automod` user (id `1008776202191634432`) — Discord's built-in baseline. Bots can't edit or delete these (returns 404). Toggling the rule in the UI reclaims ownership; from then on the bot owns it and the runbook covers it.
- A rule's threshold was loosened via the UI without runbook update → tighten back via PATCH or re-document.
- Alert routing was removed → re-add via UI (SEND_ALERT_MESSAGE actions require channel-level explicit View+Send on the alert channel; the bot's category-level grant doesn't satisfy this check, so this stays UI-only).

### Step 5 — Onboarding + Welcome Screen

```bash
# Welcome Screen
curl -sS -H "Authorization: Bot $DISCORD_TOKEN" -H "User-Agent: $UA" \
  "https://discord.com/api/v10/guilds/$DISCORD_GUILD_ID/welcome-screen" \
  | jq '.'

# Onboarding
curl -sS -H "Authorization: Bot $DISCORD_TOKEN" -H "User-Agent: $UA" \
  "https://discord.com/api/v10/guilds/$DISCORD_GUILD_ID/onboarding" \
  | jq '{enabled, mode, below_requirements, default_channel_ids, prompts: [.prompts[] | {title, single_select, required, in_onboarding, options: [.options[] | {title, channel_ids, role_ids}]}]}'
```

**Compare against:** `discord-admin-agent.md` § "Onboarding policy".

**Common drift cases:**
- A welcome channel was added or removed (max 5 entries) → re-document or re-PATCH.
- An Onboarding prompt or option text was changed → re-document or re-PUT.
- `enabled: true` flipped on without the policy being updated to reflect a 7-channel `default_channel_ids` → review whether the new shape is intentional.
- A prompt option started granting a role → that's a posture change; collab access was declared server-owner-assigned only.

### Step 6 — Bot identity + perms

```bash
# Bot user id
curl -sS -H "Authorization: Bot $DISCORD_TOKEN" -H "User-Agent: $UA" \
  "https://discord.com/api/v10/users/@me" \
  | jq '{id, username, bot}'

# Bot role perms on the server
curl -sS -H "Authorization: Bot $DISCORD_TOKEN" -H "User-Agent: $UA" \
  "https://discord.com/api/v10/guilds/$DISCORD_GUILD_ID/roles" \
  | jq '.[] | select(.managed == true) | {name, id, permissions}'
```

**Compare against:** the bot's intended tuned-mask state. Production posture is `Manage Channels + Manage Roles + Manage Webhooks + Manage Server + View Channels + Read Message History` and NOT `Administrator`. If `Administrator` is on (bit 3, `0x8`), that's drift from a one-shot grant that wasn't revoked.

**Common drift cases:**
- `Administrator` bit set → revoke once the operation that needed it is done; document the temporary grant if it's still required.
- A perm was removed that the bot needs → re-invite with the correct mask.

### Step 7 — Deferred trigger verification (AutoMod)

> **One-time check, runs the first time a non-Admin user joins the server.**

This step is deferred from Unit 5 of the revival plan. Discord exempts server owners and Admin/Manage-Server holders from AutoMod by design, so the live trigger test could not be exercised when the rules shipped.

When the first non-Admin user joins (and once a project-collab role has been assigned where appropriate), do the following:

1. Identify a non-Admin user account that is a member of the server.
2. From that account, post a triggering message in `#general`. Two valid trigger shapes:
   - **Mention spam**: any message containing 7 or more unique user/role mentions. (`@everyone` and `@here` each count as one unique mention; the rule's `mention_total_limit` is 7.)
   - **Commonly flagged words**: any message containing a word from Discord's PROFANITY, SEXUAL_CONTENT, or SLURS presets. Use a mild but unambiguously-matched profanity to avoid serving an actually-offensive test message.
3. Confirm the message is blocked (Discord shows the configured custom message to the author).
4. Confirm an alert entry appears in `#mod-logs` within a few seconds.
5. Record the verification result in the "Findings" section of this runbook with the date, the test type used, and any anomalies. Do not re-run this step unless the AutoMod rule shape changes; the verification is one-time per active rule config.

If the test fails (no block, no alert, or both), file a separate issue and stop using AutoMod-dependent features until the underlying cause is fixed.

---

## Error-injection test (happy-path verification of the drift check itself)

To verify that the drift check actually catches drift, run this test on demand when the runbook is materially changed (rare):

1. Pick a category that the declared policy says is admin-only (e.g., `Operations`) and a role that should not have view access there (e.g., `@poly-viewer`).
2. Add a temporary override granting `@poly-viewer` View Channel on that category. This is a real reversible mutation, R15b-class — confirm before applying.
3. Run Step 2 (Category overrides) above. The drift check should surface the new override row that doesn't appear in the declared policy.
4. Remove the temporary override.
5. Re-run Step 2. The drift check should now report no delta.

Record both runs in "Findings" with timestamps and the override id used. The test confirms the procedure is sensitive to real drift and that reverting it returns to clean state.

---

## Findings

This section is the running log of drift-check runs. Each run gets a dated subsection.

### 2026-05-19 — Drift check + initial cataloging

- Source-of-truth runbook section: `discord-admin-agent.md` § "Role + permission policy", § "AutoMod policy", § "Onboarding policy".
- All four declared-policy sections match live state.
- **Observation (carry-forward):** `#poly` carries a per-channel override identical in shape to its parent category's `@everyone` deny ViewChannel. Behavior is correct — the override duplicates the category's, so effective access is unchanged. Decision: leave as documented duplication; future cleanup is optional and would not change behavior. This is logged once here and is not re-flagged as drift on subsequent runs.
- **Observation (schema shape, future automation):** The declared policy table currently uses prose-with-bullet syntax inside cells (e.g. `@<project>-collab` allow ViewChannel + SendMessages + ReadMessageHistory). When automation lands, the parser will need either a strict allow/deny integer column per role or a regex over the existing prose. Choice is deferred; for the manual runbook this prose form is the most readable.
- AutoMod trigger verification status: deferred (see Step 7). No non-Admin members in the server yet.

---

## Gateway-side enforcement (cross-reference)

Plan Unit 9 wires the gateway daemon (in `fro-bot/agent`) to read a channel-policy file and refuse privileged actions when a channel's effective permissions don't match the declared policy. The drift check in this dotfiles runbook is the **dotfiles-side mirror** of the same intent: catch drift from a human operator (this runbook) and from a daemon (Unit 9) independently. If both mechanisms disagree at any point, the daemon is canonical for refusal decisions and this runbook is canonical for human-facing review.

---

## Review cadence

This runbook itself is re-reviewed:

1. Whenever any of the policy sections in `discord-admin-agent.md` change (the cross-reference becomes stale otherwise).
2. After any Discord API change that affects the read endpoints used in Steps 1-6.
3. At least annually while the server has active project categories.

The cadence note exists so the drift-check procedure doesn't quietly become stale faster than the policy it checks.
