---
name: copilot-cloud-agent
description: Use when GitHub Copilot cloud agent setup is incomplete, PRs are failing CI due to environment drift, MCP tools are unavailable, hooks are not firing, custom agent is not discoverable, or Copilot CLI auth or migration from gh copilot is needed.
---

# Copilot Cloud Agent

## Overview

Configure GitHub Copilot cloud agent (formerly "coding agent") for autonomous issue→PR work. Covers setup-steps, instructions, custom agents, hooks, MCP, firewall, CLI, skills, and harness interoperability.

## When to Use

- Copilot PRs failing CI — environment drift from incomplete setup-steps
- MCP server configured but tools unavailable to the agent
- Hook not firing or not blocking as expected
- Custom agent not showing up in `/agent`
- Migrating from `gh copilot` to standalone `copilot` CLI
- Setting up Copilot for a new repository
- Wiring harness agents (Claude Code/OpenCode/Codex) alongside Copilot

## Quick Reference

| File                                       | Purpose                                    | Activation     |
| ------------------------------------------ | ------------------------------------------ | -------------- |
| `.github/copilot-instructions.md`          | Global instructions for all Copilot work   | Always         |
| `.github/workflows/copilot-setup-steps.yaml` | Environment prep before agent starts       | Default branch |
| `.github/agents/*.agent.md`               | Custom agent personas                      | Default branch |
| `.github/hooks/*.json`                     | Lifecycle hooks (security gates, logging)  | Default branch |
| `.github/instructions/**/*.instructions.md` | Path-scoped instruction overlays           | Always         |
| `.github/skills/`                          | Repository-level agent skills              | Always         |
| `AGENTS.md`                                | Project conventions (reference from above) | Always         |

Setup-steps job name **must** be `copilot-setup-steps`. Both `.yml` and `.yaml` extensions work.

MCP config for cloud agent lives in **Repo Settings → Copilot → Coding agent → MCP configuration** (not repo files).

Firewall applies only to agent-started shell processes. It does **not** cover MCP traffic, setup-steps, or self-hosted runners. Org-level firewall settings are available (Apr 2026).

## Troubleshooting

| Symptom                                          | Likely cause                                                                                       | Fix                                                                                |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Setup-steps passes but PR CI fails               | Setup-steps does not mirror CI prerequisites (install, build, codegen)                             | Add missing install/build steps; include language runtime setup if not pre-installed |
| MCP tools unavailable                            | Config in repo files instead of Settings UI, missing `tools` field, or broken secret substitution | Move to Settings UI; add explicit `tools`; fix `COPILOT_MCP_` prefix              |
| Hook not firing                                  | Hook config not on default branch, or wrong file location                                         | Merge `.github/hooks/*.json` to default branch                                    |
| Hook fires but doesn't block                    | Using non-blocking hook type, or script not returning deny JSON                                   | Use `preToolUse`; return `{"permissionDecision":"deny","permissionDecisionReason":"..."}` |
| Custom agent not in `/agent`                     | Agent file not on default branch, missing YAML frontmatter, or wrong location                     | Put `*.agent.md` in `.github/agents/` on default branch with `name`/`description` frontmatter |
| `copilot-instructions.md` not steering output    | File too long, critical rules buried, or duplicated across multiple files                         | Keep concise; put high-risk do/don't patterns first; single source of truth        |
| CLI says "not authenticated"                     | Need `copilot /login` or token refresh                                                            | Run `copilot /login`; verify Copilot subscription active                           |

## Common Mistakes

| Mistake                                        | Fix                                                            |
| ---------------------------------------------- | -------------------------------------------------------------- |
| Missing build step in setup-steps              | Agent PRs drift from CI state if artifacts aren't built        |
| MCP configured via repo files, not Settings UI | Cloud agent reads MCP from Settings, not checked-in JSON       |
| `$` prefix in MCP `env` map values             | Use bare `COPILOT_MCP_*` names in `env`; use `$COPILOT_MCP_*` elsewhere |
| Assuming firewall covers MCP traffic            | It doesn't — firewall scope is shell processes only           |
| Testing hooks from non-default branch          | Hooks, agents, and setup-steps activate only from default branch |
| Using retired `infer` in agent frontmatter     | Use `disable-model-invocation` and `user-invocable` instead    |

## Reference Files

- `config-reference.md` — setup-steps YAML, MCP config shapes, firewall scope, custom agents/instructions, CLI commands, harness patterns, changelog
- `hooks-reference.md` — hook types, input/output schemas, script patterns for blocking dangerous commands
