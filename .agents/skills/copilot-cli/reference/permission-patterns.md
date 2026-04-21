# Permission pattern cookbook

Copy-paste `--allow-tool` / `--deny-tool` combos for common delegation shapes. Pair with `--allow-all-tools` only when you cannot enumerate.

## Read-only review (no writes, no network)

```bash
--allow-tool='shell(git:*),read' \
--deny-tool='write,shell(git push),shell(git commit)'
```

## Implement + test, no push

```bash
--allow-tool='shell(git:*),shell(npm:*),shell(npx:*),write' \
--deny-tool='shell(git push)'
```

## Implement + test + commit, no push (mise/Node project)

```bash
--allow-tool='shell(git:*),shell(npm:*),shell(npx:*),shell(mise:*),write' \
--deny-tool='shell(git push),shell(rm:*)'
```

## Python project (uv/pytest)

```bash
--allow-tool='shell(git:*),shell(uv:*),shell(pytest:*),shell(python:*),write' \
--deny-tool='shell(git push)'
```

## Rust project

```bash
--allow-tool='shell(git:*),shell(cargo:*),shell(rustup:*),write' \
--deny-tool='shell(git push)'
```

## Documentation only (no code execution)

```bash
--allow-tool='shell(git:*),write(*.md),write(docs/**)' \
--deny-tool='shell(npm:*),shell(node:*),shell(python:*)'
```

## Allow GitHub MCP for issue/PR ops, deny dangerous ones

```bash
--allow-tool='github(create_issue),github(add_issue_comment),github(get_pull_request),shell(git:*)' \
--deny-tool='github(delete_repository),github(merge_pull_request)'
```

Or scope to read-only GitHub MCP tools by allowing the whole server then denying writes:

```bash
--allow-tool='github,shell(git:*)' \
--deny-tool='github(delete_repository),github(merge_pull_request),github(create_or_update_file)'
```

## Network-restricted (only github + npm registry)

```bash
--allow-url='github.com,api.github.com,registry.npmjs.org' \
--deny-tool='shell(curl:*),shell(wget:*)'
```

## Local dev server interaction

```bash
--allow-tool='shell(curl localhost:*)' \
--allow-url='http://localhost:3000,http://127.0.0.1:3000'
```

## Multi-repo coordinated change

```bash
--add-dir /Users/me/projects/api \
--add-dir /Users/me/projects/web \
--add-dir /Users/me/projects/shared \
--allow-tool='shell(git:*),write' \
--deny-tool='shell(git push)'
```

Run from a parent directory to avoid `--add-dir` per repo.

## Locked-down CI run (everything explicit)

```bash
copilot -p "..." \
  -s --no-ask-user --no-auto-update \
  --add-dir "$GITHUB_WORKSPACE" \
  --allow-tool='shell(git:*),shell(npm:*),write' \
  --deny-tool='shell(git push),shell(gh:*)' \
  --allow-url='github.com,api.github.com,registry.npmjs.org' \
  --secret-env-vars='NPM_TOKEN,SLACK_WEBHOOK' \
  --model claude-sonnet-4.5 \
  --share=./.copilot-session.md
```

## Notes

- **Deny beats allow always.** Even `--allow-all-tools` cannot override an explicit `--deny-tool`.
- **`shell(cmd:*)` matches first-level subcommands.** `shell(git:*)` allows `git push` *unless* you `--deny-tool='shell(git push)'`.
- **`write` has no path filter natively.** Use `write(path)` for path-suffix matching or scope via `--add-dir`. `write(*.md)` matches any `.md` file.
- **URL permissions are protocol-aware.** `url(github.com)` allows HTTPS only; HTTP requires explicit `url(http://...)`.
- **Repeated flags are additive**, not last-wins. `--add-dir A --add-dir B` allows both.
