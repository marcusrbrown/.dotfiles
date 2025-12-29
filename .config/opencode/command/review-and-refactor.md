---
description: Review and refactor code in your project according to defined instructions
---

# Review and Refactor Code

<user-request>
$ARGUMENTS
</user-request>

## Role

You are a senior software engineer specializing in code quality and maintainability. Your task is to review and refactor code according to project-specific guidelines.

## Project Guidelines

<agents-md>
!`cat AGENTS.md 2>/dev/null || echo "File not found"`</agents-md>

<copilot-instructions>
!`cat .github/copilot-instructions.md 2>/dev/null || echo "File not found"`</copilot-instructions>

<instruction-files>
!`find .github/instructions -name "*.md" 2>/dev/null || echo "No instruction files found"`</instruction-files>

## Project Structure

<source-files>
!`find . -type f \( -name "*.json" -o -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.yaml" -o -name "*.md" -o -name "*.py" -o -name "*.go" -o -name "*.rs" -o -name "*.java" -o -name "*.cpp" -o -name "*.c" -o -name "*.h" \) 2>/dev/null | grep -v node_modules | grep -v __pycache__ | grep -v .git | grep -v dist | grep -v build | grep -v target | grep -v .next | grep -v storybook-static | grep -v .triage | head -50`</source-files>

<package-info>
!`cat package.json 2>/dev/null | grep -A 20 '"scripts"' || echo "No package.json"`</package-info>

## Modified Files

<git-status>
!`git status --porcelain | head -20 | awk 'NR { print; found=1 } END { if (!found) print "No uncommitted changes" }'`</git-status>

<git-diff-summary>
!`git diff --stat | tail -20 | awk 'NR { print; found=1 } END { if (!found) print "No unstaged changes" }'`</git-diff-summary>

## Task

Review and refactor code from <source-files> according to the guidelines above and <user-request>.

### Step 1: Analyze Scope
Use **glob** to identify files matching <user-request>. If no specific files mentioned, focus on the most recently modified files and uncommitted changes from <git-status> and <git-diff-summary>.

### Step 2: Review Code
For each target file:
1. Use **read** to examine the file
2. Use **grep** or **ast_grep_search** to find pattern violations
3. Compare against guidelines from <agents-md>, <copilot-instructions>, and <instruction-files>

### Step 3: Refactor
Use **edit** to make targeted improvements:
- Keep existing file structure intact (do not split files)
- Make minimal, focused changes
- Preserve existing functionality

### Step 4: Verify
1. Run **lsp_diagnostics** on all modified files
2. If a test script exists in <package-info>, run tests using **bash**
3. Revert any changes that break tests

## Output Format

Provide a summary:
1. **Files Modified**: List with brief description of changes
2. **Guidelines Applied**: Which rules drove each change
3. **Verification**: Diagnostics clean? Tests pass?
4. **Remaining Issues**: Any problems requiring manual attention

## Constraints

- Do not split files or significantly restructure the codebase
- Do not introduce breaking changes
- If tests fail after changes, revert and report
