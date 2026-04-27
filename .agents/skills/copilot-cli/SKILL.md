---
name: copilot-cli
description: Use when delegating coding work to GitHub Copilot CLI from another agent (OpenCode, Claude Code, scripts, CI), or when invoking `copilot` non-interactively with `-p`. Covers auth, permissions, model selection, tool filters, multi-repo `--add-dir`, JSONL output, and the bash-subprocess delegation pattern.
---

# GitHub Copilot CLI

## OpenCode plugin: prefer when available

If your tool catalog includes `copilot_delegate`, `copilot_output`, and `copilot_cancel` — provided by [`opencode-copilot-delegate`](https://github.com/marcusrbrown/opencode-copilot-delegate) — **prefer those tools** for Copilot CLI delegation from OpenCode. They:

- Spawn the subprocess for you, parse JSONL output, and inject a completion notification back into the OpenCode session.
- Track running tasks by id: `copilot_output(task_id)` retrieves results (with optional blocking), `copilot_cancel(task_id)` aborts and reaps the process tree.
- Discover available `--agent` values from `~/.copilot/agents/`, `<repo>/.github/agents/`, and Copilot CLI builtins.

See the plugin README for tool argument schemas and behavior. **The rest of this skill is the bash-subprocess fallback** — use it when the plugin isn't installed (other agents, scripts, CI without the plugin), when you need direct shell control, or when delegating from outside OpenCode entirely.

## Overview

Two CLIs with confusingly similar names — never conflate:

| Binary | Package | Purpose |
|---|---|---|
| `gh copilot` | `gh` extension | Legacy chat helper. **Not the CLI this skill covers.** Lazy-installs `copilot` on first interactive run, exits silently on non-TTY stdin. |
| `copilot` | `@github/copilot` (npm), `copilot-cli` (brew), `gh.io/copilot-install` | The real agent. Standalone binary. **This skill is about `copilot`.** |

Verify which you have: `which copilot && copilot --version`. If only `gh copilot` exists, install the standalone (see Install).

## When to use this skill

Load this skill when:
- Delegating implementation work to `copilot -p` from OpenCode, Claude Code, or another orchestrator
- Writing scripts or GitHub Actions that call `copilot` programmatically
- Setting up auth/permissions for non-interactive Copilot runs
- Invoking custom Copilot agents (`--agent`) or routing through MCP servers
- Debugging silent failures (almost always missing `--allow-all-tools` or auth precedence)

Do **not** load this skill for OpenCode subagent delegation (use the native `task` tool) or for `gh copilot suggest`/`explain` (different product).

## Critical rules (cause silent failures)

1. **`--allow-all-tools` is required for `-p`.** Without it, the agent prompts for tool approval and hangs because there's no TTY. The public "best practices" doc does not emphasize this — `copilot help` does. For tighter scopes, combine with `--deny-tool=` rather than omitting `--allow-all-tools`.
2. **Auth precedence: `COPILOT_GITHUB_TOKEN` > `GH_TOKEN` > `GITHUB_TOKEN`.** A stale `GH_TOKEN` in your shell will silently override `~/.copilot/auth` even if you ran `copilot login`. When debugging "wrong account" issues, check `env | grep -iE 'github_token|gh_token'` first.
3. **Always use `-s` (silent) for scripted output.** Without it, the response is wrapped in stats/decoration that breaks downstream parsing.
4. **Use `--no-ask-user` for true non-interactive runs.** Otherwise the agent may hang on a clarifying question even with full tool permissions.
5. **`COPILOT_GITHUB_TOKEN` is redacted from output by default.** Add other secrets via `--secret-env-vars=KEY1,KEY2` — values are stripped from the agent's shell environment AND redacted from output.

## Install

```bash
# Preferred on macOS/Linux: npm via mise (matches dotfiles convention — bun-backed)
npm install -g @github/copilot

# Alternative: Homebrew
brew install copilot-cli

# Alternative: install script (good for CI)
curl -fsSL https://gh.io/copilot-install | bash
```

Requires Node.js 22+ for the npm install. On `mise`-managed Node, install runs against the active version.

## Auth

**Interactive first time:** `copilot` → `/login` → device-code OAuth. Token stored at `~/.copilot/auth`.

**Programmatic / CI:** Use a fine-grained PAT with the **"Copilot Requests"** permission (under user permissions, not repo). Visit https://github.com/settings/personal-access-tokens/new. Export as `COPILOT_GITHUB_TOKEN` (not `GH_TOKEN` — too easy to collide with `gh` CLI).

```bash
export COPILOT_GITHUB_TOKEN='github_pat_...'
```

The OAuth token in `~/.local/share/opencode/auth.json` (used by OpenCode for the Copilot model API) is **not** valid for `copilot` CLI auth — it has only `read:user` scope. Use a separate PAT for CLI use.

## Programmatic invocation — minimal correct form

```bash
copilot \
  -p "PROMPT" \
  -s \
  --allow-all-tools \
  --no-ask-user \
  --model gpt-5.3-codex
```

That's the floor. Drop `--model` to use the default (Claude Sonnet 4.5 in current Copilot CLI). Tighter permission examples follow.

## Permissions — tool filter syntax

`--allow-tool` and `--deny-tool` accept a `kind(argument)` pattern. Deny always beats allow.

| Pattern | Effect |
|---|---|
| `shell` | All shell commands (rare; prefer `--allow-all-tools` if you need this) |
| `shell(git:*)` | All `git` subcommands (`git push`, `git status`, etc.) |
| `shell(npm:*)` | All `npm` subcommands |
| `shell(npm test)` | Exactly `npm test`, no other npm commands |
| `write` | Any file write (no path filter — use `--add-dir` to scope) |
| `write(README.md)` | Write any file whose path ends in `/README.md` |
| `write(.github/copilot-instructions.md)` | Write only that exact relative path |
| `url(github.com)` | Fetch from `https://github.com` (HTTPS implied) |
| `url(https://*.github.com)` | Any github.com subdomain over HTTPS |
| `url(http://localhost:3000)` | HTTP+port required for non-HTTPS local servers |
| `<mcp-name>` | All tools from named MCP server (e.g., `github`) |
| `<mcp-name>(tool_name)` | Single tool from MCP server (e.g., `github(create_issue)`) |

**Wildcards:** Only supported as `:*` suffix in `shell`, and as `*.host` prefix or `path/*` suffix in `url`. Not general glob.

**Tool visibility vs approval:** `--available-tools=` and `--excluded-tools=` decide what the model can *see*; `--allow-tool`/`--deny-tool` decide what runs without prompting. They're orthogonal — denying a tool the model can't see does nothing.

### Tightly-scoped delegation example

```bash
copilot -p "Run npm test, fix failures, commit with conventional message" \
  -s --no-ask-user \
  --add-dir "$PWD" \
  --allow-tool='shell(git:*),shell(npm:*),shell(npx:*),write' \
  --deny-tool='shell(git push),shell(rm:*)' \
  --allow-url=github.com \
  --model gpt-5.3-codex
```

Refuses `git push` and `rm` even though `git:*` and `write` are allowed (deny precedence). No autonomous push.

## Multi-repo / multi-directory

Default file access is restricted to `cwd` + subdirs + system tempdir. Two ways to expand:

```bash
# Add specific extra dirs (recommended for security)
copilot -p "..." -s --allow-all-tools \
  --add-dir /Users/me/projects/backend \
  --add-dir /Users/me/projects/frontend

# Disable path verification entirely (dangerous; only in sandboxes)
copilot -p "..." -s --allow-all-tools --allow-all-paths
```

For coordinated cross-repo refactors, prefer running `copilot` from a parent directory containing all repos — its built-in repo discovery handles the rest.

## Models

`--model` and `COPILOT_MODEL` accept these strings (verified via `copilot help` 2026-04-20):

| String | Notes |
|---|---|
| `claude-sonnet-4.5` | Default; fast, cheap, good for routine work |
| `claude-opus-4.5` | Deep reasoning, complex refactors. Premium. |
| `claude-haiku-4.5` | Fastest/cheapest; summaries, explanations |
| `gpt-5.3-codex` | Code generation and review specialty |
| `gpt-5.2` | General GPT |

**Model namespace differs from Copilot API** — the CLI uses unprefixed strings (`claude-opus-4.5`), while the API/OpenCode uses `github-copilot/claude-opus-4.7`. Don't copy strings between contexts.

`--effort low|medium|high|xhigh` controls reasoning effort on supported models.

Persist a default in `~/.copilot/config.json`:

```json
{ "model": "gpt-5.3-codex", "reasoning_effort": "low" }
```

## Output formats

```bash
# Default: text (decorated with stats)
copilot -p "..." 

# Silent text (parseable; agent response only)
copilot -p "..." -s

# JSONL (one JSON object per line — best for structured parsing in scripts)
copilot -p "..." --output-format json
```

`--output-format json` is undocumented in the public best-practices page but is in `copilot help`. Use it when you need structured event streams (tool calls, file edits, etc.) instead of just the final response.

## Sharing / archiving sessions

```bash
copilot -p "Audit deps for vulnerabilities" -s --allow-all-tools \
  --share=./audit-report.md          # Markdown transcript to local file

copilot -p "Summarize architecture" -s --allow-all-tools \
  --share-gist                        # Secret gist on github.com (not for EMUs / GHE.com)
```

Transcripts may contain secrets — review before sharing. `--secret-env-vars=KEY1,KEY2` redacts values from the transcript too.

## Custom agents

Create a custom agent at `~/.copilot/agents/<name>.md` with frontmatter + system prompt + optional tool restrictions. Then invoke:

```bash
copilot -p "Review the latest commit" -s --allow-all-tools --agent code-review
```

A custom agent's `model` field overrides `--model`. Use this for repeatable specialized workflows (security review, doc generation, etc.).

## Hooks

Place shell scripts in `~/.copilot/hooks/<event>` to run at lifecycle points (e.g., `pre-tool`, `post-edit`). Useful for forcing format/lint after every write or auditing tool calls. See `copilot help` and the "Using hooks" doc for event names.

## Delegation pattern: calling `copilot` from OpenCode / another agent

When you (an OpenCode agent) need to delegate a contained implementation task to Copilot CLI as a bash subprocess:

```bash
copilot \
  -p "Implement X. Files Y and Z. Run tests after." \
  -s --no-ask-user \
  --add-dir "$PWD" \
  --allow-tool='shell(git:*),shell(npm:*),shell(npx:*),shell(mise:*),write' \
  --deny-tool='shell(git push)' \
  --model gpt-5.3-codex \
  --share=./.copilot-session.md
```

Then read `.copilot-session.md` for the transcript and verify the changes with `git diff` / `lsp_diagnostics`. **You** still own verification — `copilot` will report success even when tests don't pass unless the prompt explicitly demands proof.

**Prompt structure for delegated runs (mandatory):**

1. **Atomic goal** — one outcome, not a list of features
2. **Files in scope** — explicit paths
3. **Verification** — "run `npm test`; report pass/fail with output"
4. **Constraints** — "do not modify package.json", "no commits"
5. **Output expectation** — "summarize changes in ≤5 bullets at end"

Vague prompts produce vague output, same as any agent.

## Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Hangs forever, no output | Missing `--allow-all-tools` (or denied tool needed for task) | Add `--allow-all-tools` or expand `--allow-tool` |
| Hangs after partial output | Missing `--no-ask-user` | Add `--no-ask-user` |
| "Authentication required" despite `copilot login` | Stale `GH_TOKEN` or `GITHUB_TOKEN` in env | `unset GH_TOKEN GITHUB_TOKEN`; or `export COPILOT_GITHUB_TOKEN=...` |
| Wrong account / org | Same — token precedence override | Same fix |
| Output mangled in script | Missing `-s` | Add `-s`; or switch to `--output-format json` |
| `gh copilot` exits silently in CI | `gh copilot` is a downloader; no TTY = no install prompt | Install standalone `copilot` directly |
| Permission denied on file outside repo | Default path restriction to cwd | Add `--add-dir /path`; avoid `--allow-all-paths` outside sandboxes |
| Network calls blocked | URL permission missing | Add `--allow-url=domain.com` |

## CI pattern (GitHub Actions)

```yaml
- name: Run Copilot review
  env:
    COPILOT_GITHUB_TOKEN: ${{ secrets.COPILOT_PAT }}
  run: |
    npm install -g @github/copilot
    copilot -p "Review changed files in this PR for bugs and security issues" \
      -s --no-ask-user \
      --allow-tool='shell(git:*)' \
      --deny-tool='write' \
      --model claude-opus-4.5 \
      --share=./review.md
```

Auto-update is disabled in CI (detected via `CI`/`BUILD_NUMBER`/`RUN_ID`/`SYSTEM_COLLECTIONURI`). To pin a version, use the install script with `VERSION=`:

```bash
curl -fsSL https://gh.io/copilot-install | VERSION="v0.0.369" bash
```

## Reference

- @reference/programmatic-flags.md — quick-reference table of every `-p`-relevant flag
- @reference/permission-patterns.md — copy-paste filter patterns for common task shapes

## Sources

- https://docs.github.com/en/copilot/how-tos/copilot-cli/cli-best-practices
- https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/run-cli-programmatically
- https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference
- https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli
- `copilot help`, `copilot help environment`, `copilot help permissions` (CLI v1.0.34, 2026-04-20)
