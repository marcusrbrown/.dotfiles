---
name: research-tools
description: External research via Context7 (docs), Grep.app (code examples), and Exa (web search). Loads MCPs on-demand via skill_mcp.
license: MIT
compatibility: opencode
metadata:
  category: research
  triggers: docs, documentation, code examples, web search, how do others, library, API, current info
---

# Research Tools

## CRITICAL: `skill_mcp` Syntax

```
skill_mcp(mcp_name="<MCP_SERVER>", tool_name="<TOOL>", arguments='<JSON>')
```

- `mcp_name` = MCP server (`context7`, `grep_app`, `websearch`) — NOT `"research-tools"`
- `tool_name` = Tool name without prefix — NOT `context7_resolve-library-id`

## Tools

| MCP Server | Tool | Use For |
|------------|------|---------|
| `context7` | `resolve-library-id` | Get library ID (required first) |
| `context7` | `query-docs` | Query library documentation |
| `grep_app` | `searchGitHub` | GitHub code pattern search |
| `websearch` | `web_search_exa` | Web search |

## Examples

**Context7** (2-step: resolve ID → query docs):
```
skill_mcp(mcp_name="context7", tool_name="resolve-library-id", arguments='{"libraryName": "react", "query": "hooks"}')
skill_mcp(mcp_name="context7", tool_name="query-docs", arguments='{"libraryId": "/facebook/react", "query": "useEffect"}')
```

**Grep.app** (search literal code patterns, not keywords):
```
skill_mcp(mcp_name="grep_app", tool_name="searchGitHub", arguments='{"query": "useActionState(", "language": ["TypeScript", "TSX"]}')
```

**Exa**:
```
skill_mcp(mcp_name="websearch", tool_name="web_search_exa", arguments='{"query": "Next.js 15 features", "numResults": 5}')
```

## Common Mistakes

| ❌ Wrong | ✅ Correct |
|----------|-----------|
| `mcp_name="research-tools"` | `mcp_name="context7"` |
| `tool_name="context7_resolve-library-id"` | `tool_name="resolve-library-id"` |
| `tool_name="grep_app_searchGitHub"` | `tool_name="searchGitHub"` |
| `tool_name="context7_get-library-docs"` | `tool_name="query-docs"` |
