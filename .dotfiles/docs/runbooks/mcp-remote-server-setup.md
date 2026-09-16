---
title: Remote MCP Server Setup — Runbook
audience: Marcus + AI assistants in an OpenCode session
skill: ~/.agents/skills/probing-mcp-oauth/SKILL.md
scope: OpenCode remote (HTTP) MCP servers using OAuth
---

# Remote MCP Server Setup — Runbook

Procedure for adding an OAuth-protected remote MCP server to OpenCode, getting the
config right on the first attempt, and keeping credentials out of tracked files.

The core technique — probing a server's OAuth discovery chain before writing any
config — is documented as a reusable skill at
`~/.agents/skills/probing-mcp-oauth/SKILL.md`. This runbook is the machine-specific
companion: where files go on _this_ machine, how secrets are sourced, and the
results of servers already configured.

> **Tenant identifiers are placeholdered** (`<tenant>`, `<work-repo>`) throughout.
> This repo is public. See "Placement" below.

---

## Why probe instead of reading docs

Three servers were configured by probing first. In all three cases the probe beat
the documentation:

| Server    | What the docs implied                          | What probing established                                               |
| --------- | ---------------------------------------------- | ---------------------------------------------------------------------- |
| Aha!      | (setup docs describe a UI flow)                | RFC 7591 DCR available → config is a bare URL, zero setup              |
| Box       | Admin Console Integration Credentials required | A self-serve Developer Console app authenticates fine; no admin needed |
| Atlassian | research and older docs pointed at `/v1/mcp`   | Only `/v1/mcp/authv2` serves RFC 9728; `/v1/mcp` has no discovery      |

Vendor docs describe the _supported_ path, not the _minimum_ path, and they lag
endpoint changes. The metadata a server actually serves is authoritative.

---

## Procedure

Full technique and decision table: `~/.agents/skills/probing-mcp-oauth/SKILL.md`.
Short form:

```bash
BASE=https://mcp.example.com/v1/mcp

# 1. Expect 401 and read the discovery pointer
curl -s -D- -o /dev/null "$BASE" | grep -i 'www-authenticate'

# 2. Protected-resource metadata → authorization_servers, scopes_supported
curl -s "$(…resource_metadata URL from step 1…)" | jq

# 3. Authorization-server metadata → the decisive fields
curl -s "https://<as-host>/.well-known/oauth-authorization-server" | jq \
  '{registration_endpoint, token_endpoint_auth_methods_supported, scopes_supported}'
```

Decision:

| `registration_endpoint` | `none` in auth methods | Config shape                                |
| ----------------------- | ---------------------- | ------------------------------------------- |
| present                 | yes                    | URL only — omit `oauth`, DCR self-registers |
| present                 | no                     | DCR, but a secret is still issued           |
| **absent**              | —                      | Pre-create an OAuth app; clientId + secret  |

Always read `scopes_supported` before authorizing, and pin `oauth.scope` explicitly
when the server offers granular scopes. Servers that offer only a coarse scope give
you no way to reduce the grant later.

---

## Placement

`~/.config/opencode/opencode.json` is **tracked** and this repo is **public**. Never
put a work tenant URL or any credential in it.

| Location                                | Tracked?                | Use for                                  |
| --------------------------------------- | ----------------------- | ---------------------------------------- |
| `~/.config/opencode/opencode.json`      | **tracked, public**     | Vendor-neutral servers only              |
| `<work-repo>/.opencode/opencode.json`   | gitignored in that repo | Work servers — preferred                 |
| `~/.local/state/opencode/private.jsonc` | ignored by allowlist    | User-wide private, via `OPENCODE_CONFIG` |

Everything under `~/.config/` is **not** ignored by the dotfiles allowlist (`.config/`
is allowlisted as a directory), so a "private" file there shows as untracked in
`git status` and is one `git add -A` from being published. Only `~/.local/…` is
ignored by default.

Config layers deep-merge — global, then `OPENCODE_CONFIG`, then project,
then `.opencode/` — so `mcp` entries from different layers coexist rather than
clobber. Verified in `sst/opencode` `packages/opencode/src/config/config.ts`.

---

## Secrets

Only needed when the server has no `registration_endpoint`.

**Never** in the config file, even a gitignored one. Use macOS Keychain plus
`{env:VAR}` interpolation.

```bash
security add-generic-password -U -s <service>-client-id     -a "$USER" -w '<id>'
security add-generic-password -U -s <service>-client-secret -a "$USER" -w '<secret>'
```

Export from `~/.zshrc.local` (gitignored via the `*.local` rule):

```zsh
() {
  local id secret
  id="$(security find-generic-password -s <service>-client-id -w 2>/dev/null)"
  secret="$(security find-generic-password -s <service>-client-secret -w 2>/dev/null)"
  [[ -n "$id" ]] && export <SERVICE>_CLIENT_ID="$id"
  [[ -n "$secret" ]] && export <SERVICE>_CLIENT_SECRET="$secret"
  return 0
}
```

`return 0` matters — without it the function's exit status is the last `[[ ]]` test,
which is nonzero when the Keychain items are absent.

> **Trap:** `~/.config/bash/local.d/` is **not** the hook. zsh never sources it, and
> `~/.config/bash/main:170` loops over `~/.bash/local.d`, which does not exist on this
> machine. That directory is dead. The live hook is `source ~/.zshrc.local` at the end
> of `~/.config/zsh/.zshrc`.

---

## Authenticate

OpenCode is invoked through the `harness` wrapper; `opencode` is not on `PATH`.

```bash
cd <work-repo>                 # config is project-scoped
harness mcp auth <name>
harness mcp list               # expect: connected
harness mcp debug <name>       # on failure
```

Run from the directory whose config defines the server. Start a fresh shell if you
just added Keychain exports.

---

## Configured servers

Config lives in `<work-repo>/.opencode/opencode.json` (gitignored).

| Name        | Endpoint                                  | Auth                          | Secrets  |
| ----------- | ----------------------------------------- | ----------------------------- | -------- |
| `aha`       | `https://<tenant>.aha.io/api/v1/mcp`      | DCR, public client            | none     |
| `box`       | `https://mcp.box.com`                     | confidential, clientId+secret | Keychain |
| `atlassian` | `https://mcp.atlassian.com/v1/mcp/authv2` | DCR, public client            | none     |

Per-server notes:

- **Aha!** — `scopes_supported` is `["full"]` only. Read-only is not a token property;
  it is an account-level toggle under Settings → Account → AI controls.
- **Box** — no DCR. Credentials from the **Developer Console** (`app.box.com/developers/console`),
  Custom App → User Authentication (OAuth 2.0), redirect URI
  `http://127.0.0.1:19876/mcp/oauth/callback`. The Admin Console path the docs
  describe is not required. Only scope used is `root_readwrite`; there is no
  read-only MCP scope. `ai.readwrite` is deliberately omitted so document content
  is not routed to external model providers.
- **Atlassian** — must be `/v1/mcp/authv2`. `/v1/sse` was sunset 2026-06-30 and
  `/v1/mcp` serves no discovery metadata. Scopes are granular and separable;
  Compass and TWG scopes are omitted as unused.

---

## Troubleshooting

| Symptom                                 | Cause                                                                  |
| --------------------------------------- | ---------------------------------------------------------------------- |
| `redirect_uri_mismatch`                 | App's registered URI ≠ `http://127.0.0.1:19876/mcp/oauth/callback`     |
| `invalid_client`                        | Wrong or unset client ID — check `${#VAR}` in a new shell              |
| Consent succeeds, MCP still 401         | Server gates on an admin-minted client; app-level creds insufficient   |
| "app not authorized" / "pending"        | Enterprise blocks unpublished apps; needs admin approval               |
| Connects but no auth actually happening | `{env:VAR}` resolved empty — config implies auth that is not occurring |
| Handshake never opens a browser         | Callback port 19876 occupied, or DCR rejected                          |

A server reporting `connected` does **not** prove authentication succeeded. Some
servers accept anonymous requests and silently degrade to a free tier. Verify by
checking `${#VAR}` is non-zero, or by calling a tool that requires identity.

---

## Adding another server

1. Probe (skill: `probing-mcp-oauth`) — five minutes, before writing anything.
2. Choose placement: work tenant → `<work-repo>/.opencode/opencode.json`.
3. If no DCR: create the OAuth app, store credentials in Keychain, export from
   `~/.zshrc.local`, reference with `{env:VAR}`.
4. Pin `oauth.scope` from the server's advertised `scopes_supported`.
5. `harness mcp auth <name>` → `harness mcp list`.
6. Update the table above.
