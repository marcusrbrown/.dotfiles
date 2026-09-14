---
name: probing-mcp-oauth
description: Use when adding, configuring, or debugging a remote OAuth-protected MCP server — choosing between endpoint variants, deciding whether a client ID and secret are required, selecting OAuth scopes, or evaluating a vendor claim that admin approval is needed.
---

# Probing MCP OAuth

## Overview

A remote MCP server tells you exactly how to authenticate to it. Three unauthenticated
`curl` calls return the endpoint's discovery pointer, its authorization server, its
registration capability, and its full scope list.

**Core principle: the metadata a server serves is authoritative; its documentation is a
claim.** Probe before writing config. It takes about five minutes and it is the only way
to know which of several plausible configurations is the correct one.

## When to Use

Adding a remote MCP server; choosing between endpoint variants (`/mcp`, `/sse`,
`/v1/mcp/authv2`); deciding whether a client ID and secret are needed; selecting scopes;
evaluating a docs claim that an administrator must provision credentials; debugging a
failed handshake.

Not for local stdio MCP servers — they have no OAuth discovery surface.

## The Probe

```bash
BASE=https://mcp.example.com/v1/mcp

# 1. Expect 401. The header names the discovery document (RFC 9728).
curl -s -D- -o /dev/null "$BASE" | grep -i 'www-authenticate'
#   → Bearer resource_metadata="https://.../.well-known/oauth-protected-resource/v1/mcp"

# 2. Protected-resource metadata → authorization server + full scope list.
curl -s "https://mcp.example.com/.well-known/oauth-protected-resource/v1/mcp" | jq

# 3. Authorization-server metadata → the two decisive fields (RFC 8414).
curl -s "https://<as-host>/.well-known/oauth-authorization-server" | jq \
  '{registration_endpoint, token_endpoint_auth_methods_supported, scopes_supported}'
```

If step 1 returns no `resource_metadata`, try the well-known paths directly. An endpoint
variant that serves discovery metadata is the one to use; a variant that does not is
either legacy or undocumented.

### Path-scoped issuers — the step that silently gives a wrong answer

When `authorization_servers` contains a **path**, RFC 8414 inserts the well-known segment
between host and path. Querying the bare host returns a *different, generic* document —
often one with no `registration_endpoint` — and you will wrongly conclude DCR is
unavailable.

```
issuer:  https://auth.example.com/AbC123
✅ https://auth.example.com/.well-known/oauth-authorization-server/AbC123
❌ https://auth.example.com/.well-known/oauth-authorization-server
```

Also try the resource host itself (`https://mcp.example.com/.well-known/oauth-authorization-server`) —
some servers front their own registration endpoint there.

### Decision

| `registration_endpoint` | `none` in auth methods | Config shape                                    |
| ----------------------- | ---------------------- | ----------------------------------------------- |
| present                 | yes                    | URL only — client self-registers via RFC 7591   |
| present                 | no                     | Self-registers, but a secret is issued          |
| **absent**              | —                      | Pre-create an OAuth app; supply clientId+secret |

Confirm DCR by POSTing to the **`registration_endpoint` value read from the metadata** —
never to a guessed `/register` path. A 404 on a URL you invented proves nothing.

```bash
curl -s -X POST "$REGISTRATION_ENDPOINT" -H 'Content-Type: application/json' \
  -d '{"client_name":"probe","redirect_uris":["http://127.0.0.1:19876/callback"],
       "token_endpoint_auth_method":"none"}' -w '\n%{http_code}\n'
# 201 + client_id → DCR works.
```

If you conclude DCR is unavailable, your config must supply `clientId`/`clientSecret`.
Recommending "omit oauth, let it self-register" *and* "DCR is unavailable" is a
contradiction — one of the two is wrong, and it is usually the probe.

## Scope Discipline

`scopes_supported` from step 2 is the real list. Read it before authorizing.

- **Pin scopes explicitly** when the server offers granular ones. Omitting `scope` accepts
  whatever default the server chooses, which is not a decision you made.
- **Derive scopes from the stated task, not from the vendor's list.** Write down the
  capability asked for, map it to the narrowest scopes that deliver it, and exclude
  everything else. "Search and read files" does not justify a write scope, and never
  justifies an AI/content-analysis scope — those route document contents to third-party
  model providers.
- **Every scope needs a one-line justification.** If you cannot say which requested
  capability a scope serves, drop it.
- **Note when scopes are coarse.** A server offering only one all-or-nothing scope cannot
  be narrowed later; surface that before the user authorizes, not after.
- Include an offline/refresh scope when one exists, or tokens expire with no refresh path.
- **When `scopes_supported` is `null` or absent, you have no authoritative list.** Fall
  back to vendor docs, and label the scope string as unverified. Do not synthesize a
  plausible-looking scope name from the vendor's general platform API — a scope that is
  valid for the REST API is not necessarily accepted by the MCP resource, and the failure
  arrives at consent time.

## Verify the Config Shape

Check the config against the client's published JSON schema, not from memory. An invalid
nesting level or misspelled key usually fails **silently** — the server simply never
registers, and the symptom is absence, not an error.

Use the client's own **interpolation syntax** exactly as documented (`{env:VAR}`,
`${VAR}`, `$VAR` are not interchangeable). A wrong sigil is not a syntax error; it is a
literal string, so the credential silently becomes garbage.

Same rule for CLI commands: cite flags the tool actually documents. Inventing a
plausible-looking flag wastes the user's next five minutes.

## Never Report "Admin Required" From Documentation Alone

Vendor docs describe the provisioning path the vendor supports, which is routinely the
*administrative* one even when a self-serve path exists and works.

Before telling anyone an administrator is needed:

1. Check whether the vendor has a **developer console** distinct from its **admin
   console**. These are different products with different access requirements, and the
   docs frequently name only the admin one.
2. Try creating credentials there yourself.
3. Only after that attempt fails may you report admin involvement as required — and say
   what failed.

If you have not tried, the honest phrasing is *"the docs describe an admin flow; the
self-serve path is untested"* — never *"you cannot do this yourself."* A wrong "needs
admin" costs days of waiting for something achievable in ten minutes. This is the single
most expensive error in this whole procedure.

## Common Mistakes

| Mistake | Why it hurts |
| ------- | ------------ |
| Asserting an answer from documentation without probing | Docs describe the *supported* path, not the *minimum* path, and they lag endpoint changes |
| Treating "admin must provision this" as settled | Often the vendor's recommended path, not the only one. A failed self-serve attempt costs minutes; an unnecessary IT ticket costs days |
| Querying the bare host for a path-scoped issuer | Returns a generic document, usually without `registration_endpoint` → false "no DCR" |
| POSTing to a guessed `/register` path | A 404 on an invented URL is not evidence about DCR |
| Pasting every documented scope | Grants capabilities the user did not ask for; some route content to third-party model providers |
| Omitting `scope` entirely | Abdicates the grant decision to the server |
| Inventing a scope name when `scopes_supported` is null | REST-API scopes are not always MCP-resource scopes; fails at consent |
| Guessing the interpolation sigil | Wrong sigil is a literal string, not an error — credential silently becomes garbage |
| Picking an endpoint because a doc named it | Legacy variants stay reachable long after sunset and answer 401 identically |
| Reporting `connected` as proof of auth | Some servers accept anonymous requests and silently degrade to a free tier |

## Red Flags

Stop and probe if you catch yourself thinking:

- "The docs say X, so X" — docs are a claim; metadata is evidence
- "This needs an admin" / "You cannot do this yourself" — asserted without an attempt
- "I'll include all the scopes to be safe" — broader grant, not safer
- "I'll add the AI scope while I'm here" — that one ships content off-platform
- "`/register` 404'd, so no DCR" — was that URL from metadata, or invented?
- "I'm highly confident" — about something one `curl` would settle

## Real-World Impact

Three vendors configured this way; each contradicted its own docs in a way that mattered:

- Docs required an admin-console flow. A self-serve developer app worked — no admin.
- Docs named an endpoint serving no discovery metadata; only a differently-suffixed
  variant was RFC 9728 compliant. The documented one fails confusingly.
- One server advertised a single all-or-nothing scope where docs implied read-only was
  configurable — visible only in `scopes_supported`.

Agents given these tasks without probing answered from docs at stated *high* confidence,
and were wrong on the expensive question: whether an administrator was required.
