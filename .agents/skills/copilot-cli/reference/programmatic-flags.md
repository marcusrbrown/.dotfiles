# Programmatic flags quick-reference

Flags most relevant when running `copilot -p` non-interactively. From `copilot help` (v1.0.34) plus the official programmatic reference.

| Flag | Required for `-p`? | Purpose |
|---|---|---|
| `-p, --prompt <text>` | yes | Non-interactive prompt; exits when done |
| `-s, --silent` | no but recommended | Strip stats/decoration; agent response only |
| `--allow-all-tools` | **yes** (or scoped `--allow-tool`) | Required for non-interactive — without it, hangs waiting for tool approval |
| `--no-ask-user` | usually | Disables `ask_user` tool; agent works without clarifying questions |
| `--model <model>` | no | `claude-sonnet-4.5` (default), `claude-opus-4.5`, `claude-haiku-4.5`, `gpt-5.3-codex`, `gpt-5.2` |
| `--effort low\|medium\|high\|xhigh` | no | Reasoning effort on supported models |
| `--allow-tool=PATTERN` | no | Allow a specific tool (`shell(git:*)`, `write`, etc.) |
| `--deny-tool=PATTERN` | no | Deny a specific tool — beats `--allow-all-tools` |
| `--allow-url=DOMAIN` | no | Allow web access to a domain |
| `--deny-url=DOMAIN` | no | Block a domain — beats `--allow-url` |
| `--allow-all-urls` | no | All URL access |
| `--add-dir <path>` | no | Extend file access beyond cwd; repeatable |
| `--allow-all-paths` | no | Disable path verification (sandbox only) |
| `--disallow-temp-dir` | no | Block automatic tempdir access |
| `--available-tools=LIST` | no | Whitelist tools the model can see |
| `--excluded-tools=LIST` | no | Hide specific tools from the model |
| `--secret-env-vars=K1,K2` | no | Strip env vars from agent shell + redact from output |
| `--share[=path]` | no | Save markdown transcript (default `./copilot-session-<id>.md`) |
| `--share-gist` | no | Publish secret gist on github.com |
| `--output-format text\|json` | no | `json` = JSONL event stream; `text` = default |
| `--agent <name>` | no | Use a custom agent from `~/.copilot/agents/` |
| `--add-github-mcp-tool <tool>` | no | Enable additional GitHub MCP tool beyond default subset |
| `--add-github-mcp-toolset <set>` | no | Enable additional GitHub MCP toolset |
| `--enable-all-github-mcp-tools` | no | Enable everything in built-in GitHub MCP server |
| `--disable-mcp-server <name>` | no | Disable a configured MCP server for this run |
| `--config-dir <dir>` | no | Override `~/.copilot` location |
| `--no-custom-instructions` | no | Skip loading `AGENTS.md`/`copilot-instructions.md` |
| `--no-auto-update` | no | Disable update check (auto-disabled in CI) |
| `--no-color` | no | Disable color (also via `NO_COLOR` env) |
| `--allow-all` / `--yolo` | no | All tools + paths + URLs (avoid outside sandbox) |
| `--share-gist` redaction | n/a | `COPILOT_GITHUB_TOKEN` and `GITHUB_TOKEN` redacted by default |

## Auth precedence (highest to lowest)

1. `COPILOT_GITHUB_TOKEN`
2. `GH_TOKEN`
3. `GITHUB_TOKEN`
4. Stored credentials at `~/.copilot/auth`

## Useful env vars

- `COPILOT_ALLOW_ALL=true` — equivalent to `--allow-all-tools`
- `COPILOT_MODEL=<model>` — default model
- `COPILOT_HOME=<dir>` — override `~/.copilot`
- `COPILOT_OFFLINE=true` — skip all network; requires `COPILOT_PROVIDER_BASE_URL`
- `COPILOT_AUTO_UPDATE=false` — disable update checks
- `GH_HOST=<host>` — for GitHub Enterprise Cloud with data residency
