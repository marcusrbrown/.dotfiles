---
name: copilot-coding-agent
description: Use when configuring or troubleshooting GitHub Copilot coding agent, setting up copilot-setup-steps, MCP servers, hooks, firewall rules, custom agents, or Copilot CLI workflows for issue-to-PR automation.
---

# Copilot Coding Agent Configuration

## Overview

Configure GitHub Copilot coding agent to execute autonomous issue/PR work reliably.
This skill covers setup-steps workflows, instructions, custom agents, hooks, MCP configuration, firewall scope, Copilot CLI usage, and harness interoperability.

## When to Use

- Setting up Copilot coding agent for a new repository
- Copilot PRs failing CI because environment/setup is incomplete
- `copilot-instructions.md` is missing, duplicated, or not steering output well
- You need hooks, MCP, or firewall guardrails
- You need concrete CLI workflows for planning, delegation, and review
- You need Copilot and harness agents (Claude Code/OpenCode/Codex) to run in parallel

## File Inventory

Assess which files exist. Every item below is optional but high impact.

| File                                         | Purpose                                          | Greenfield Action                            |
| -------------------------------------------- | ------------------------------------------------ | -------------------------------------------- |
| `.github/copilot-instructions.md`            | Global instructions for ALL Copilot interactions | Create first                                 |
| `.github/workflows/copilot-setup-steps.yaml` | Prepare dependencies before agent starts         | Create to prevent setup failures             |
| `.github/agents/*.agent.md`                  | Repo-level custom Copilot agents                 | Add for recurring specialist tasks           |
| `.github/hooks/*.json`                       | Agent hooks (session/tool lifecycle)             | Add for policy/security guardrails           |
| `AGENTS.md`                                  | Project map and conventions                      | Keep current and reference from instructions |
| `.github/instructions/**/*.instructions.md`  | Path-scoped instruction overlays                 | Optional for large multi-domain repositories |

`copilot-setup-steps` workflow and hook config only apply when present on the default branch.

## Setup Steps Workflow

Job name must be `copilot-setup-steps`.
Both workflow filename extensions are supported: `.yml` and `.yaml`.

```yaml
name: Copilot Setup Steps

on:
  workflow_dispatch:
  push:
    paths: [.github/workflows/copilot-setup-steps.yaml]
  pull_request:
    paths: [.github/workflows/copilot-setup-steps.yaml]

permissions:
  contents: read

jobs:
  copilot-setup-steps:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v6
      - name: Setup environment
        run: pnpm install --frozen-lockfile
      - name: Build project
        run: pnpm run build
      - name: Configure git hooks
        run: git config core.hooksPath .github/git-hooks
```

### Setup gotchas

- Copilot overrides checkout fetch depth for rollback support
- Supported job-level keys are constrained (`steps`, `permissions`, `runs-on`, `services`, `snapshot`, `timeout-minutes`)
- Setup failure does not stop the coding agent; it continues with partial environment
- If build artifacts are committed, include a build step or Copilot PRs drift from CI state

## Custom Instructions

`copilot-instructions.md` is the highest-leverage file.

Recommended structure:

1. Reference canonical docs first (`AGENTS.md`, subdirectory AGENTS files)
2. List high-risk do/don't patterns with concrete examples
3. Include repo conventions AI usually misses
4. Include exact verification commands
5. Include explicit security and safety constraints

### Common AI failure modes to pin down

| Pattern                                       | Why AI misses it                 |
| --------------------------------------------- | -------------------------------- |
| ESM import style and extension rules          | Defaults drift to broad corpus   |
| Strict boolean expression style               | Defaults to implicit truthiness  |
| Repo-specific testing and command conventions | Defaults to Jest/npm assumptions |
| Required dependency/context injection         | Omits required parameters        |
| Error/result-style conventions                | Defaults to generic try/catch    |

Legacy high-signal patterns from prior versions (still useful to keep explicit):

- Functions-only patterns (if your codebase discourages classes)
- Project-specific test framework defaults drifting to Jest
- Logger/context parameter injection requirements
- Result-object conventions over thrown exceptions

### Anti-patterns

- Duplicating the same rules across instructions and agent files
- Overlong instruction documents that hide critical rules
- Missing verification commands

## Custom Agents vs Instructions

| File                      | Scope                    | Content                                           |
| ------------------------- | ------------------------ | ------------------------------------------------- |
| `copilot-instructions.md` | All Copilot interactions | Global coding conventions, build/test, guardrails |
| `*.agent.md`              | Invoked agent persona    | Specialized behavior for a bounded class of tasks |

Agent files require YAML frontmatter:

```yaml
---
name: My Agent
description: Use when this specialized behavior is needed.
---
```

### Agent definition locations

| Level        | Location                    | Scope                  |
| ------------ | --------------------------- | ---------------------- |
| User         | `~/.copilot/agents/`        | Local user             |
| Repository   | `.github/agents/*.agent.md` | Current repository     |
| Organization | `.github-private/agents/`   | Org/enterprise context |

Invoke via `/agent`, natural language selection, or `--agent=NAME` when supported by CLI mode.

## Hooks

Copilot hooks are not git hooks.
Config lives in `.github/hooks/*.json`.

| Hook                  | Can Block?       | Use Case                             |
| --------------------- | ---------------- | ------------------------------------ |
| `sessionStart`        | No               | Session startup logging/setup        |
| `sessionEnd`          | No               | Session cleanup/reporting            |
| `userPromptSubmitted` | No               | Prompt audit logging                 |
| `preToolUse`          | Yes (allow/deny) | Security gates before tool execution |
| `postToolUse`         | No               | Metrics and post-tool telemetry      |
| `agentStop`           | No               | Main agent completion hook           |
| `subagentStop`        | No               | Subagent completion hook             |
| `errorOccurred`       | No               | Error tracking and response          |

There is no Copilot `prePush` hook. Use git `pre-push` hooks through `core.hooksPath`.

### Hook config format

```json
{
  "version": 1,
  "hooks": {
    "preToolUse": [
      {
        "type": "command",
        "bash": "./scripts/security-check.sh",
        "powershell": "./scripts/security-check.ps1",
        "cwd": "scripts",
        "env": {
          "LOG_LEVEL": "INFO"
        },
        "timeoutSec": 30
      }
    ]
  }
}
```

Scripts read JSON on stdin and return JSON on stdout.
See `hooks-reference.md` for complete payload and response schema details.

## MCP Configuration

### Where to configure

- Coding agent on GitHub: repo Settings UI
- Copilot CLI: local CLI MCP management and local config

Coding agent path: Repo Settings → Code & automation → Copilot → Coding agent → MCP configuration

### Canonical shape

```json
{
  "mcpServers": {
    "server-name": {
      "type": "http",
      "url": "https://example.com/mcp",
      "tools": ["read_only_tool"]
    }
  }
}
```

Required for every server: `type`, `tools`.
Supported `type`: `local`, `stdio`, `http`, `sse`.

### Local / stdio server example

```json
{
  "mcpServers": {
    "my-local-server": {
      "type": "local",
      "command": "npx",
      "args": ["-y", "@package/mcp-server@latest", "--token=$COPILOT_MCP_TOKEN"],
      "tools": ["search_docs", "list_symbols"],
      "env": {
        "TOKEN": "COPILOT_MCP_TOKEN"
      }
    }
  }
}
```

### Remote http/sse example

```json
{
  "mcpServers": {
    "context7": {
      "type": "http",
      "url": "https://mcp.context7.com/mcp",
      "tools": ["*"],
      "headers": {
        "CONTEXT7_API_KEY": "$COPILOT_MCP_CONTEXT7_API_KEY"
      }
    }
  }
}
```

### Substitution rules that commonly break setups

| Field location      | Correct substitution style   |
| ------------------- | ---------------------------- |
| `env` object values | `"COPILOT_MCP_SOME_SECRET"`  |
| Other string fields | `"$COPILOT_MCP_SOME_SECRET"` |

All values must come from the `copilot` environment and use `COPILOT_MCP_` prefix.

### MCP limitations

- Copilot coding agent supports MCP tools (not resources/prompts)
- Remote MCP servers that require OAuth are not supported
- MCP tools run autonomously; restrict `tools` to least privilege
- GitHub MCP server and Playwright MCP are enabled by default

## Firewall

Copilot firewall applies to network egress from agent-started processes (bash tool) and does not comprehensively sandbox all execution paths.

Path: Repo Settings → Code & automation → Copilot → Coding agent → Firewall

### Scope limits

| Surface                                | Firewall applies      |
| -------------------------------------- | --------------------- |
| Agent-started shell processes          | Yes                   |
| MCP server traffic                     | No                    |
| Setup-steps workflow-started processes | No                    |
| Processes outside GitHub Actions scope | No                    |
| Windows runners                        | No                    |
| Self-hosted runners                    | No (disable firewall) |

Do not model firewall as the primary security boundary.

## Copilot CLI

### Setup and migration note

If you were using `gh copilot`, treat it as legacy language and migrate to the standalone `copilot` CLI.

Install options:

```bash
npm install -g @github/copilot
brew install copilot-cli
winget install GitHub.Copilot
curl -fsSL https://gh.io/copilot-install | bash
```

If a team still says "use `gh copilot`", interpret that as "install and use Copilot CLI now" and offer to do migration immediately.

### Core usage

```bash
copilot
copilot -p "Explain why CI fails on this branch"
copilot --resume
```

### High-value interactive commands

| Command    | Purpose                      |
| ---------- | ---------------------------- |
| `/agent`   | Select/invoke a custom agent |
| `/mcp`     | Inspect and manage MCP setup |
| `/model`   | Switch model                 |
| `/context` | Show context/token footprint |
| `/compact` | Compact context              |
| `/login`   | Authenticate                 |
| `/skills`  | List/add skills              |

### Common CLI flags

| Flag                           | Purpose                                |
| ------------------------------ | -------------------------------------- |
| `--allow-all-tools` / `--yolo` | Approve all tool calls without prompts |
| `--allow-tool 'shell(pnpm)'`   | Approve only specific tool invocations |
| `--deny-tool 'shell(rm)'`      | Explicitly block risky operations      |
| `--agent=NAME`                 | Start with a specific custom agent     |
| `-p "..."`                     | One-shot non-interactive execution     |
| `--resume`                     | Resume previous session                |

### Built-in subagents in Copilot CLI

| Agent           | Purpose                                               |
| --------------- | ----------------------------------------------------- |
| Explore         | Fast codebase exploration with lower context pressure |
| Task            | Execute bounded tasks/tools and return focused output |
| General-purpose | Multi-step delegated problem solving                  |
| Code-review     | Focused review and issue detection                    |

### Offer to set up Copilot CLI

When this skill is used, proactively offer:

1. Installing `copilot` CLI
2. Logging in and validating auth
3. Configuring MCP servers for local CLI if needed
4. Running a smoke test task in the target repo

### Repo-tailored examples for `mrbro.dev`

```bash
# Plan work using repo conventions
copilot -p "Create a plan to add a new React component in src/components using AGENTS.md conventions and pnpm commands"

# Verify quality gate commands used by repo
copilot -p "Run pnpm run lint, pnpm exec tsc --noEmit, pnpm run test, and pnpm run build and summarize failures"

# Inspect theme architecture quickly
copilot -p "Trace theme flow from src/contexts/ThemeContext.tsx to src/hooks/UseTheme.ts and src/utils/preset-themes.ts"

# Generate issue-scoped implementation proposal
copilot -p "Given issue #123, propose a minimal diff strategy that matches existing patterns and avoids new dependencies"

# Review branch quality before PR
copilot -p "Review current branch against main for TypeScript strictness, ESM compliance, and React hook naming conventions"
```

### `gh copilot` legacy-to-current command mapping

Use this when a user explicitly asks for `gh copilot` flows.

| Legacy ask                          | Current command    |
| ----------------------------------- | ------------------ |
| `gh copilot` interactive session    | `copilot`          |
| `gh copilot -p "..."` one-shot task | `copilot -p "..."` |
| `gh copilot` resume prior session   | `copilot --resume` |

Legacy phrasing examples translated for `mrbro.dev`:

```bash
# User asks: gh copilot -p "run repo checks"
copilot -p "Run pnpm run lint, pnpm exec tsc --noEmit, pnpm run test, pnpm run build"

# User asks: gh copilot interactive triage
copilot

# User asks: gh copilot review current branch
copilot -p "Review branch vs main for AGENTS.md compliance, hook naming, and ESM-only patterns"
```

## Launching Copilot as a Subagent

Use one of these modes:

1. Assign GitHub issues to Copilot coding agent for issue→PR automation
2. Run standalone Copilot CLI in a parallel terminal as a delegated worker
3. Use custom Copilot agents (`/agent`) for specialized sub-tasks

### Practical delegation split

- Harness agent: planning, repository-local edits, orchestration, verification
- Copilot coding agent: issue-assigned autonomous implementation + PR creation
- Copilot CLI: ad-hoc parallel tasks (analysis/review/small bounded execution)

## Harness Integration (Claude Code, OpenCode, Codex)

### Pattern

Use harness agents as orchestrators and Copilot as a delegated execution agent.

1. Harness agent drafts scoped issue with acceptance criteria
2. Copilot coding agent executes issue and opens PR
3. Harness agent performs independent verification/review
4. Optional second-pass Copilot follow-up from review comments

### Minimal handoff template

```markdown
## Task

<one concrete objective>

## Constraints

- Follow AGENTS.md
- Use pnpm
- No new dependencies

## Verification

- pnpm run lint
- pnpm exec tsc --noEmit
- pnpm run test
- pnpm run build
```

### Harness guidance

- Claude Code/OpenCode/Codex should keep Copilot delegation bounded and explicit
- Prefer issue-level contracts over vague prompts
- Avoid overlapping write authority on same branch at the same time
- Use separate branches/worktrees for harness-agent edits vs Copilot-generated edits

### Concrete harness commands (GitHub-native)

```bash
# Create a bounded issue for Copilot coding agent
gh issue create \
  --repo marcusrbrown/marcusrbrown.github.io \
  --title "Optimize theme toggle performance" \
  --body "## Task
Reduce unnecessary rerenders in ThemeToggle.

## Constraints
- Follow AGENTS.md
- No new dependencies

## Verification
- pnpm run lint
- pnpm exec tsc --noEmit
- pnpm run test
- pnpm run build"

# Assign issue to Copilot
gh issue edit ISSUE_NUMBER --repo marcusrbrown/marcusrbrown.github.io --add-assignee "copilot"

# Track Copilot-authored PRs
gh pr list --repo marcusrbrown/marcusrbrown.github.io --author "copilot"

# Request targeted follow-up from Copilot on PR
gh pr comment PR_NUMBER --repo marcusrbrown/marcusrbrown.github.io --body "@copilot please address the failing typecheck and update tests."
```

## Improve-a-Project Workflow

1. Ensure custom instructions exist (`copilot-instructions.md`, `AGENTS.md`, or scoped instructions)
2. Ensure setup-steps workflow exists and is on default branch
3. Ask Copilot to enumerate top technical debt areas (prioritized list)
4. Convert findings into scoped issues with acceptance criteria
5. Assign issue(s) to Copilot
6. Review Copilot PRs and request follow-ups with `@copilot` in review comments
7. Iterate across remaining debt areas

## Common Mistakes

| Mistake                                               | Fix                                                  |
| ----------------------------------------------------- | ---------------------------------------------------- |
| Missing build step in setup-steps                     | Copilot PRs can fail CI due to out-of-sync artifacts |
| Treating `gh copilot` as the primary CLI path         | Use standalone `copilot` CLI                         |
| Missing `tools` in MCP server config                  | Include explicit tool allowlist or `*`               |
| Using `$` in `env` map values                         | Use bare `COPILOT_MCP_*` names in `env` map          |
| Using non-`$` substitution in headers/url/args        | Use `$COPILOT_MCP_*` for non-`env` string fields     |
| Assuming a Copilot `prePush` hook exists              | Use git `pre-push` hook via `core.hooksPath`         |
| Configuring coding-agent MCP through repo files       | Use repository Settings MCP configuration UI         |
| Assuming firewall controls MCP traffic                | It does not; firewall scope is narrower              |
| Testing setup/hook changes from non-default branch    | Merge to default branch before relying on activation |
| Instructions too verbose and missing examples         | Keep concise and include concrete do/don't patterns  |
| No explicit do/don't examples in instructions         | Add concrete positive and negative examples          |
| Duplicating instruction content in multiple locations | Keep one source of truth and cross-reference         |
