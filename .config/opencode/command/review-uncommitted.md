---
description: Analyze uncommitted changes, understand the intent, review for edge cases, and suggest next steps. Optional args: focus area or specific files to prioritize
---

# Review Uncommitted Changes

## Context

<user-focus>
$ARGUMENTS
</user-focus>

<git-status>
!`git status --short`
</git-status>

<staged-stat>
!`git diff --stat --cached`
</staged-stat>

<unstaged-stat>
!`git diff --stat`
</unstaged-stat>

<staged-diff>
!`git diff --cached`
</staged-diff>

<unstaged-diff>
!`git diff`
</unstaged-diff>

## Task

Review the uncommitted changes in the current repository and provide a comprehensive analysis.

If <user-focus> contains a focus area or specific files, prioritize those in your review.

## Process

1. **Retrieve uncommitted changes** - The current diff of staged and unstaged changes is provided above in <staged-diff> and <unstaged-diff>
2. **Understand the intent** — Analyze what problem or feature the changes are addressing. If AGENTS.md or .github/copilot-instructions.md exists in the repo, use it to inform code quality expectations.
3. **Review the implementation** — If the diff is very large (100+ lines per file or 500+ total), summarize changes by file first and ask before deep review of every hunk. Evaluate the fix/feature for:
   - Correctness and completeness
   - Edge cases that may have been overlooked
   - Code quality and adherence to project standards
   - Type safety and error handling
4. **Consult Oracle for plan review** — Use the `oracle` subagent with this prompt:
   > "Review my analysis plan and findings for these uncommitted changes. Identify missing edge cases, risks, or review steps. Respond with a bullet list of gaps and improvements."
   
   If the `oracle` subagent is unavailable, note that explicitly and continue with your analysis.
5. **Verify tests** — Detect the test runner from repo signals (package.json → npm/pnpm test, pyproject.toml/requirements.txt → pytest, go.mod → go test ./..., Cargo.toml → cargo test). Use the `bash` tool to run tests. If no test runner is detected, state that explicitly and skip this step.
6. **Propose refinements** — Do not modify code by default. Summarize issues found and propose fixes with specific code suggestions. Ask for explicit user approval before applying any changes with the `edit` tool.
7. **Summarize findings** - Provide:
   - A clear explanation of the issue being solved
   - List of files changed and their roles
   - Edge cases and considerations identified
   - Any code quality issues found
   - Suggested next steps and further direction

## Output Format

Structure the analysis with these sections:
- **Issue Being Solved**: What problem the changes address
- **Files Changed**: Summary table of modified files
- **Edge Cases & Considerations**: Potential issues or overlooked scenarios
- **Code Quality Issues**: Any style, pattern, or maintainability concerns
- **Oracle Review**: Key insights from Oracle consultation
- **Test Results**: Pass/fail status and relevant output
- **Next Steps**: Immediate actions and medium-term improvements
