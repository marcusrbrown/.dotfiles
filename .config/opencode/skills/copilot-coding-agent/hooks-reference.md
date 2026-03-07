# Copilot Coding Agent Hooks Reference

## Config File

Place hook config in `.github/hooks/<name>.json` (e.g., `.github/hooks/security.json`). Files are auto-discovered.

```json
{
  "version": 1,
  "hooks": {
    "<hookType>": [
      {
        "type": "command",
        "bash": "./scripts/my-hook.sh",
        "powershell": "./scripts/my-hook.ps1",
        "cwd": "scripts",
        "timeoutSec": 30,
        "comment": "Optional description"
      }
    ]
  }
}
```

Multiple hooks per type execute in array order. Default timeout: 30s (max via `timeoutSec`).

---

## Hook Types

### sessionStart

**Fires:** New session, resume, or startup.

**Input:**

```json
{
  "timestamp": 1704614400000,
  "cwd": "/path/to/project",
  "source": "new",
  "initialPrompt": "Create a new feature"
}
```

| Field           | Type   | Values                               |
| --------------- | ------ | ------------------------------------ |
| `timestamp`     | number | Unix ms                              |
| `cwd`           | string | Working directory                    |
| `source`        | string | `"new"` \| `"resume"` \| `"startup"` |
| `initialPrompt` | string | User's initial prompt (if provided)  |

**Output:** Ignored.

---

### sessionEnd

**Fires:** Session completes, errors, aborts, or times out.

**Input:**

```json
{
  "timestamp": 1704618000000,
  "cwd": "/path/to/project",
  "reason": "complete"
}
```

| Field       | Type   | Values                                                                 |
| ----------- | ------ | ---------------------------------------------------------------------- |
| `timestamp` | number | Unix ms                                                                |
| `cwd`       | string | Working directory                                                      |
| `reason`    | string | `"complete"` \| `"error"` \| `"abort"` \| `"timeout"` \| `"user_exit"` |

**Output:** Ignored.

---

### userPromptSubmitted

**Fires:** User submits a prompt.

**Input:**

```json
{
  "timestamp": 1704614500000,
  "cwd": "/path/to/project",
  "prompt": "Fix the authentication bug"
}
```

| Field       | Type   | Values            |
| ----------- | ------ | ----------------- |
| `timestamp` | number | Unix ms           |
| `cwd`       | string | Working directory |
| `prompt`    | string | Exact user text   |

**Output:** Ignored (prompt modification not supported).

---

### preToolUse

**Fires:** Before agent invokes any tool. **Can block execution.**

**Input:**

```json
{
  "timestamp": 1704614600000,
  "cwd": "/path/to/project",
  "toolName": "bash",
  "toolArgs": "{\"command\":\"rm -rf dist\",\"description\":\"Clean build directory\"}"
}
```

| Field       | Type   | Values                                               |
| ----------- | ------ | ---------------------------------------------------- |
| `timestamp` | number | Unix ms                                              |
| `cwd`       | string | Working directory                                    |
| `toolName`  | string | Tool name (`"bash"`, `"edit"`, `"view"`, `"create"`) |
| `toolArgs`  | string | JSON string of tool arguments                        |

**Output (optional):**

```json
{
  "permissionDecision": "deny",
  "permissionDecisionReason": "Destructive operations require approval"
}
```

| Field                      | Type   | Values                           |
| -------------------------- | ------ | -------------------------------- |
| `permissionDecision`       | string | `"allow"` \| `"deny"` \| `"ask"` |
| `permissionDecisionReason` | string | Human-readable explanation       |

**Notes:**

- Only `"deny"` is currently enforced. `"allow"` and `"ask"` are accepted but `"deny"` is the only blocking action.
- No output = allow by default.

---

### postToolUse

**Fires:** After tool execution completes (success or failure).

**Input:**

```json
{
  "timestamp": 1704614700000,
  "cwd": "/path/to/project",
  "toolName": "bash",
  "toolArgs": "{\"command\":\"npm test\"}",
  "toolResult": {
    "resultType": "success",
    "textResultForLlm": "All tests passed (15/15)"
  }
}
```

| Field                         | Type   | Values                                   |
| ----------------------------- | ------ | ---------------------------------------- |
| `timestamp`                   | number | Unix ms                                  |
| `cwd`                         | string | Working directory                        |
| `toolName`                    | string | Tool name                                |
| `toolArgs`                    | string | JSON string of tool arguments            |
| `toolResult.resultType`       | string | `"success"` \| `"failure"` \| `"denied"` |
| `toolResult.textResultForLlm` | string | Result text shown to agent               |

**Output:** Ignored.

---

### errorOccurred

**Fires:** When an error occurs during agent execution.

**Input:**

```json
{
  "timestamp": 1704614800000,
  "cwd": "/path/to/project",
  "error": {
    "message": "Network timeout",
    "name": "TimeoutError",
    "stack": "TimeoutError: Network timeout\n    at ..."
  }
}
```

| Field           | Type   | Values                     |
| --------------- | ------ | -------------------------- |
| `timestamp`     | number | Unix ms                    |
| `cwd`           | string | Working directory          |
| `error.message` | string | Error message              |
| `error.name`    | string | Error type/class name      |
| `error.stack`   | string | Stack trace (if available) |

**Output:** Ignored.

---

## Script Patterns

### Read input (Bash)

```bash
#!/bin/bash
set -e
INPUT=$(cat)
TIMESTAMP=$(echo "$INPUT" | jq -r '.timestamp')
CWD=$(echo "$INPUT" | jq -r '.cwd')
```

### Read input (PowerShell)

```powershell
$ErrorActionPreference = "Stop"
$input = [Console]::In.ReadToEnd() | ConvertFrom-Json
$timestamp = $input.timestamp
$cwd = $input.cwd
```

### Output JSON (Bash)

```bash
# Static
echo '{"permissionDecision":"deny","permissionDecisionReason":"Blocked"}' | jq -c

# Dynamic
REASON="Too dangerous"
jq -n --arg reason "$REASON" '{permissionDecision: "deny", permissionDecisionReason: $reason}'
```

### Block dangerous commands (preToolUse)

```bash
#!/bin/bash
set -e
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.toolName')

[ "$TOOL_NAME" != "bash" ] && exit 0

COMMAND=$(echo "$INPUT" | jq -r '.toolArgs' | jq -r '.command')
if echo "$COMMAND" | grep -qE "rm -rf /|sudo|mkfs|DROP TABLE"; then
  jq -n '{permissionDecision: "deny", permissionDecisionReason: "Dangerous system command blocked"}'
fi
```

### Restrict editable paths (preToolUse)

```bash
#!/bin/bash
set -e
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.toolName')

if [ "$TOOL_NAME" = "edit" ] || [ "$TOOL_NAME" = "create" ]; then
  FILE_PATH=$(echo "$INPUT" | jq -r '.toolArgs' | jq -r '.path')
  if [[ ! "$FILE_PATH" =~ ^(src/|test/) ]]; then
    jq -n '{permissionDecision: "deny", permissionDecisionReason: "Can only edit files in src/ or test/"}'
  fi
fi
```

### Multiple hooks (same type)

```json
{
  "version": 1,
  "hooks": {
    "preToolUse": [
      { "type": "command", "bash": "./scripts/security-check.sh", "comment": "Security — runs first" },
      { "type": "command", "bash": "./scripts/audit-log.sh", "comment": "Audit — runs second" }
    ]
  }
}
```

Hooks execute in array order. A `deny` from any hook blocks execution.
