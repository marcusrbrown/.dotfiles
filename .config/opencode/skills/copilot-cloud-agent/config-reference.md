# Copilot Cloud Agent Config Reference

## Setup-Steps Workflow

Job name **must** be `copilot-setup-steps`. Supported job-level keys: `steps`, `permissions`, `runs-on`, `services`, `snapshot`, `timeout-minutes` (max 59).

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
        run: |
          # Install dependencies with your package manager
          # pnpm install --frozen-lockfile
          # bun install --frozen-lockfile
          # npm ci
      - name: Build project
        run: |
          # Build if CI depends on build artifacts
          # pnpm run build
      - name: Configure git hooks
        run: git config core.hooksPath .github/git-hooks
```

### Setup gotchas

- Copilot overrides checkout fetch depth for rollback support
- Setup failure does **not** stop the agent — it continues with partial environment
- If CI depends on build artifacts, include the build step or agent PRs will drift
- Must be on **default branch** to activate

---

## MCP Configuration

Cloud agent MCP config lives in **Repo Settings → Copilot → Coding agent → MCP configuration**.

### HTTP/SSE server

```json
{
  "mcpServers": {
    "docs-search": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "tools": ["search_docs", "get_page"],
      "headers": {
        "API_KEY": "$COPILOT_MCP_DOCS_API_KEY"
      }
    }
  }
}
```

### Local/stdio server

```json
{
  "mcpServers": {
    "project-tools": {
      "type": "local",
      "command": "npx",
      "args": ["-y", "@example/mcp-server@latest"],
      "tools": ["list_symbols", "search_code"],
      "env": {
        "TOKEN": "COPILOT_MCP_PROJECT_TOKEN"
      }
    }
  }
}
```

### Substitution rules

| Field location    | Syntax                      | Example                          |
| ----------------- | --------------------------- | -------------------------------- |
| `env` map values  | Bare name (no `$`)          | `"COPILOT_MCP_MY_SECRET"`       |
| All other strings | `$` or `${VAR}` or `${VAR:-default}` | `"$COPILOT_MCP_MY_SECRET"` |

All secret values must use `COPILOT_MCP_` prefix and be set in the `copilot` environment.

### MCP limitations

- Cloud agent supports MCP **tools only** (not resources or prompts)
- Remote MCP servers requiring OAuth are not supported
- Restrict `tools` to least privilege — `["*"]` allows all
- GitHub MCP server and Playwright MCP are enabled by default

---

## Firewall

Firewall applies to network egress from agent-started processes (Bash tool) only.

| Surface                             | Firewall applies |
| ----------------------------------- | ---------------- |
| Agent-started shell processes       | Yes              |
| MCP server traffic                  | No               |
| Setup-steps processes               | No               |
| Self-hosted / Windows runners       | No               |

**Org-level settings (Apr 2026):** org admins can enable/disable firewall, manage recommended allowlist, add org-wide custom rules, and control whether repos can add their own rules. Default: "Let repositories decide."

Do not model firewall as the primary security boundary.

---

## Custom Instructions

`copilot-instructions.md` is the highest-leverage file. Keep it concise.

### Structure

1. Reference canonical docs first (`AGENTS.md`, subdirectory AGENTS files)
2. High-risk do/don't patterns with concrete examples
3. Repo conventions AI usually misses (import style, test framework, error handling)
4. Exact verification commands
5. Security and safety constraints

### Common AI failure modes

| Pattern                              | Why AI misses it               |
| ------------------------------------ | ------------------------------ |
| ESM import style and extensions      | Defaults to broad corpus       |
| Strict boolean expressions           | Defaults to implicit truthiness |
| Repo-specific test framework         | Defaults to Jest/npm           |
| Required dependency injection        | Omits required parameters      |
| Error/result-style conventions       | Defaults to generic try/catch  |

### Anti-patterns

- Duplicating rules across instructions and agent files
- Overlong instructions that hide critical rules
- Missing verification commands

---

## Custom Agents

Agent files use YAML frontmatter. `description` is required.

```yaml
---
name: security-review-agent
description: Reviews code changes for security vulnerabilities and credential exposure.
tools:
  - read
  - search
model: claude-sonnet-4-6
---

Review all changes for security issues...
```

### Key properties

| Property                   | Type          | Notes                                             |
| -------------------------- | ------------- | ------------------------------------------------- |
| `name`                     | string        | Display name                                      |
| `description`              | string        | **Required**. Purpose/capabilities                |
| `tools`                    | list or `"*"` | Tool access; aliases: `execute`→shell, `read`→view |
| `model`                    | string        | Model override                                    |
| `disable-model-invocation` | boolean       | Prevent auto-selection (replaces retired `infer`)  |
| `user-invocable`           | boolean       | Allow manual `/agent` selection                   |
| `mcp-servers`              | object        | MCP config scoped to this agent                   |
| `target`                   | string        | `vscode`, `github-copilot`, or both (default)     |

### Locations

| Level        | Location                    |
| ------------ | --------------------------- |
| User         | `~/.copilot/agents/`        |
| Repository   | `.github/agents/*.agent.md` |
| Organization | `.github-private/agents/`   |

---

## Copilot CLI

The standalone `copilot` CLI is GA (Feb 2026). If someone references `gh copilot`, treat it as legacy and migrate.

### Install

```bash
npm install -g @github/copilot    # or: brew install copilot-cli
```

### Core usage

```bash
copilot                           # Interactive session
copilot -p "Explain CI failures"  # One-shot
copilot --resume                  # Resume previous session
```

### Key commands

| Command    | Purpose                      |
| ---------- | ---------------------------- |
| `/agent`   | Select custom agent          |
| `/mcp`     | Inspect MCP setup            |
| `/model`   | Switch model                 |
| `/context` | Show context/token footprint |
| `/compact` | Compact context              |
| `/login`   | Authenticate                 |
| `/skills`  | List/add skills              |

### Key flags

| Flag                         | Purpose                              |
| ---------------------------- | ------------------------------------ |
| `--allow-all-tools` / `--yolo` | Approve all tool calls             |
| `--allow-tool 'shell(cmd)'` | Approve specific tool                |
| `--deny-tool 'shell(rm)'`   | Block risky operations               |
| `--agent=NAME`               | Start with specific agent            |
| `-p "..."`                   | One-shot non-interactive             |
| `--resume`                   | Resume previous session              |

### Built-in subagents

| Agent           | Purpose                                         |
| --------------- | ------------------------------------------------ |
| Explore         | Fast codebase exploration, low context pressure  |
| Task            | Bounded task execution with focused output       |
| General-purpose | Multi-step delegated problem solving             |
| Code-review     | Focused review and issue detection               |

---

## Harness Integration (Claude Code, OpenCode, Codex)

Use harness agents as orchestrators, Copilot as delegated execution.

### Pattern

1. Harness agent drafts scoped issue with acceptance criteria
2. Copilot cloud agent executes issue → opens PR
3. Harness agent verifies/reviews independently
4. Optional: Copilot follow-up from review comments via `@copilot`

### Issue template

```markdown
## Task
<one concrete objective>

## Constraints
- Follow AGENTS.md
- No new dependencies

## Verification
- lint, typecheck, test, build commands
```

### Commands

```bash
# Create bounded issue
gh issue create --title "Fix theme toggle" --body "..."

# Assign to Copilot
gh issue edit ISSUE_NUMBER --add-assignee "copilot"

# Track Copilot PRs
gh pr list --author "copilot"

# Request follow-up
gh pr comment PR_NUMBER --body "@copilot please fix the failing typecheck"
```

### Guidelines

- Keep delegation bounded and explicit (issue-level contracts)
- Avoid overlapping write authority on the same branch
- Use separate branches/worktrees for harness vs Copilot edits

---

## Improve-a-Project Workflow

1. Ensure `copilot-instructions.md` and `AGENTS.md` exist
2. Ensure setup-steps workflow is on default branch
3. Ask Copilot to enumerate top technical debt areas
4. Convert findings into scoped issues with acceptance criteria
5. Assign issues to Copilot
6. Review PRs and follow up with `@copilot` in review comments
7. Iterate

---

## Key Changes (2025–2026)

- **Product renamed**: "coding agent" → "cloud agent"
- **Skills**: open standard via `.github/skills/`, `~/.copilot/skills/`; see [agentskills.io](https://agentskills.io)
- **Copilot Memory**: public preview — stores learned repo details across sessions
- **Multi-model**: Claude Opus 4.6, Sonnet 4.6, GPT-5.3-Codex, Gemini 3 Pro available
- **Org-level firewall**: org admins can set firewall policy for all repos (Apr 2026)
- **Custom agents**: `infer` retired; use `disable-model-invocation` + `user-invocable`
- **Copilot CLI**: GA (Feb 2026); install via `npm`, `brew`, `winget`, or shell script
- **Commit signing**: cloud agent now signs its commits
