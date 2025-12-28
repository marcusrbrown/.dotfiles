---
description: Implement an RFC document with two-phase approach (plan then execute), supports resuming partial implementations
argument-hint: <rfc-path> (e.g., RFCs/RFC-001-User-Authentication.md)
---

# RFC Implementation

<rfc-path>
$ARGUMENTS
</rfc-path>

<available-rfcs>
!`find RFCs docs/rfcs doc/rfcs -maxdepth 1 -type f -name 'RFC-*.md' 2>/dev/null | sort | head -20 | awk 'NR { print; found=1 } END { if (!found) print "No RFC files found" }'`</available-rfcs>

<rfcs-index>
!`cat RFCs/RFCS.md docs/rfc/RFCS.md docs/rfcs/RFCS.md 2>/dev/null | head -100 | grep -q . && cat RFCs/RFCS.md docs/rfc/RFCS.md docs/rfcs/RFCS.md 2>/dev/null | head -100 || echo "No RFCS.md index found"`</rfcs-index>

<project-structure>
!`find . -type f \( -name "*.json" -o -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.yaml" -o -name "*.md" -o -name "*.py" -o -name "*.go" -o -name "*.rs" -o -name "*.java" -o -name "*.cpp" -o -name "*.c" -o -name "*.h" \) 2>/dev/null | grep -v node_modules | grep -v __pycache__ | grep -v .git | grep -v dist | grep -v build | grep -v target | grep -v .next | grep -v storybook-static | head -50`</project-structure>

<git-status>
!`git status --porcelain | head -20 | awk 'NR { print; found=1 } END { if (!found) print "No uncommitted changes" }'`</git-status>

<git-diff-summary>
!`git diff --stat | tail -20 | awk 'NR { print; found=1 } END { if (!found) print "No unstaged changes" }'`</git-diff-summary>

<package-json>
!`test -f package.json && cat package.json | head -25 || echo "No package.json found"`</package-json>

<pyproject-toml>
!`test -f pyproject.toml && cat pyproject.toml | head -40 || echo "No pyproject.toml found"`</pyproject-toml>

<tsconfig>
!`test -f tsconfig.json && cat tsconfig.json | head -20 || echo "No tsconfig.json found"`</tsconfig>

<lockfiles>
!`ls pnpm-lock.yaml yarn.lock package-lock.json bun.lock bun.lockb 2>/dev/null | grep . || echo "No lockfiles found"`</lockfiles>

<recent-commits>
!`git log --oneline -10 2>&1 | grep -v "not a git repository" | grep -v "does not have any commits" | grep -q . && git log --oneline -10 || echo "No git history available"`</recent-commits>

<project-config>
!`ls Makefile pyproject.toml setup.py Cargo.toml go.mod build.gradle pom.xml build.zig 2>/dev/null | grep . || echo "No standard build config found"`</project-config>

## Role and Mindset

You are a senior software developer with extensive experience in building robust, maintainable, and scalable systems. Approach this implementation with the following mindset:

1. **Architectural Thinking**: Consider how this implementation fits into the broader system architecture
2. **Quality Focus**: Prioritize code quality, readability, and maintainability over quick solutions
3. **Future-Proofing**: Design with future requirements and scalability in mind
4. **Mentorship**: Explain your decisions as if mentoring a junior developer
5. **Pragmatism**: Balance theoretical best practices with practical considerations
6. **Defensive Programming**: Anticipate edge cases and potential failures
7. **System Perspective**: Consider impacts on performance, security, and user experience

## Pre-Implementation Phase

### Step 1: RFC Resolution and Selection

**If `<rfc-path>` is provided:**
1. Use the `read` tool to verify the RFC file exists at the specified path
2. If not found, search alternate locations:
   - `RFCs/[filename]`
   - `docs/rfc/[filename]`
   - `docs/rfcs/[filename]`
3. If still not found, report error and ask user for correct path

**If `<rfc-path>` is empty:**
1. Show the list from `<available-rfcs>` to the user
2. Ask the user to select which RFC to implement
3. Wait for user response before proceeding

### Step 2: Load Context Documents

Use the `read` tool to load the following documents in parallel (batch multiple read calls in a single response):
- The RFC file from `<rfc-path>` (REQUIRED)
- `PRD.md` or `docs/PRD.md` (if exists)
- `FEATURES.md` or `docs/FEATURES.md` (if exists)
- `RULES.md` or `docs/RULES.md` (if exists)
- The RFCS.md index from one of these locations:
  - `RFCs/RFCS.md`
  - `docs/rfc/RFCS.md`
  - `docs/rfcs/RFCS.md`

Note which documents are missing but proceed with available context.

### Step 3: Prerequisite Validation

**Decision Flow:**
```
RFCS.md exists?
  → NO: Warn and skip validation
  → YES: Parse table
    → Find current RFC row
      → Extract Phase number
      → Check all lower-phase RFCs are "Completed"
      → Check same-phase, lower-numbered RFCs are "Completed"
        → All complete? → Proceed
        → Any incomplete? → Ask user for confirmation
```

**Detailed Steps:**

1. Parse the `<rfcs-index>` content to find the RFC Summary Table (typically in this format):
   ```
   | RFC ID  | Title                          | Priority | Complexity | Phase | Status    |
   | ------- | ------------------------------ | -------- | ---------- | ----- | --------- |
   | RFC-001 | Feature Name                   | MUST     | High       | 1     | Completed |
   | RFC-002 | Another Feature                | MUST     | Medium     | 1     | Pending   |
   ```

2. Find the current RFC's row and extract:
   - RFC ID
   - Phase number
   - Current Status
   - Any dependency information (may be in additional columns)

3. Check prerequisite completion:
   - Identify all RFCs in earlier phases (lower phase numbers)
   - Identify all RFCs in the same phase with lower RFC numbers
   - Verify their Status is "Completed"

4. If prerequisites are incomplete:
   - List which RFCs are blocking (not completed)
   - Explain the dependency chain
   - Ask user: "The following prerequisite RFCs are not completed: [list]. Do you want to proceed anyway, or should I stop?"
   - Wait for explicit confirmation before continuing

5. If RFCS.md doesn't exist:
   - Warn: "No RFCS.md index found. Cannot validate prerequisites. Proceeding without dependency checking."

### Step 4: Resume Detection and State Assessment

Analyze the current implementation state to determine if this is a fresh start or a resume:

1. **Parse Git Status:**
   - Review `<git-status>` for modified, added, or untracked files
   - Review `<git-diff-summary>` for change statistics
   - Review `<recent-commits>` for any recent implementation work

2. **Identify RFC Scope:**
   - From the RFC document, extract:
     - Files mentioned for creation
     - Files mentioned for modification
     - Components/modules to implement
     - Test files required

3. **Cross-Reference Implementation State:**
   - Use `glob` tool to check if files mentioned in RFC exist
   - For existing files, use `read` tool to check if they contain RFC-related implementation
   - Check for test files mentioned in RFC acceptance criteria

4. **Present State Assessment:**
   ```markdown
   ## Implementation State Assessment

   **RFC:** RFC-XXX - [Title]

   ### Appears Implemented
   - [File/component that exists with relevant code]
   - [Another implemented item]

   ### Appears Pending
   - [File/component that doesn't exist]
   - [File that exists but appears incomplete]

   ### Tests
   - Implemented: [list]
   - Missing: [list]

   ### Assessment
   [Fresh start | Partial implementation detected]
   ```

5. **Confirmation:**
   - If partial implementation detected: "Based on the above assessment, it appears you've started implementing this RFC. Is this correct? Should I continue from where you left off, or start fresh?"
   - Wait for user response
   - If resuming: proceed to Phase 2 with focus on pending items
   - If fresh start: proceed to Phase 1

## Two-Phase Implementation Approach

This implementation MUST follow a strict two-phase approach:

### Phase 1: Implementation Planning (NO CODE WRITING)

**Objective:** Develop and present a comprehensive implementation plan without writing any actual code.

#### Analysis Steps

1. **Analyze Requirements:**
   - Thoroughly read the RFC document
   - Extract all features, acceptance criteria, and technical specifications
   - Note any constraints or special requirements

2. **Understand Existing Codebase:**
   - Ask the @explore subagent to analyze relevant parts of the codebase

   **Before invoking the explore agent, customize the prompt by replacing placeholders with actual values from the RFC document:**
   - `[RFC Title]` → The actual RFC title (e.g., "User Authentication System")
   - `[relevant area from RFC]` → The primary technical domain (e.g., "authentication", "API endpoints", "data storage", "state management")
   - `[list key requirements]` → Extract 3-5 key requirements from the RFC (be specific)

   **Explore Agent Prompt Template:**
   ```
   Analyze the codebase architecture relevant to implementing [RFC Title]:

   1. Identify existing patterns for [relevant area from RFC - e.g., "authentication", "API endpoints", "data storage"]
   2. Find files that will need modification based on these requirements: [list key requirements]
   3. Locate reusable components, utilities, or services that can support this implementation
   4. Document current conventions for:
      - State management
      - API integration
      - Error handling
      - Testing patterns
   5. Identify potential conflicts or areas that need refactoring

   Return a structured summary of findings to guide implementation planning.
   ```

3. **Review Project Standards:**
   - Carefully read `RULES.md` for project-specific guidelines
   - Note naming conventions, code organization, and architectural patterns
   - Identify any security or performance standards to follow

4. **Identify Technical Decisions:**
   - What algorithms or approaches will you use?
   - What data structures are needed?
   - How will this integrate with existing systems?
   - What trade-offs exist between different approaches?

#### Present Comprehensive Implementation Plan

Create a detailed plan using the following template:

##### Mandatory Template Structure

All implementation plans must strictly adhere to the following template. Each section is required and must be populated with specific, actionable content. AI agents must validate template compliance before execution.

##### Template Validation Rules

- All front matter fields must be present and properly formatted
- All section headers must match exactly (case-sensitive)
- All identifier prefixes must follow the specified format
- Tables must include all required columns
- No placeholder text may remain in the final output

##### Status

The status of the implementation plan must be clearly defined in the front matter and must reflect the current state of the plan. The status can be one of the following (status_color in brackets): `Completed` (bright green badge), `In progress` (yellow badge), `Planned` (blue badge), `Deprecated` (red badge), or `On Hold` (orange badge). It should also be displayed as a badge in the introduction section.

```markdown
---
goal: [Concise Title Describing the Package Implementation Plan's Goal]
version: [Optional: e.g., 1.0, Date]
date_created: [YYYY-MM-DD]
last_updated: [Optional: YYYY-MM-DD]
status: 'Completed'|'In progress'|'Planned'|'Deprecated'|'On Hold'
tags: [Optional: List of relevant tags or categories, e.g., `feature`, `upgrade`, `chore`, `architecture`, `migration`, `bug` etc]
---

# Implementation Plan for RFC-XXX: [Title]

![Status: <status>](https://img.shields.io/badge/status-<status>-<status_color>)

[Brief summary of what will be implemented and overall approach and the goal it is intended to achieve.]

## 1. Requirements & Constraints

[Explicitly list all requirements & constraints that affect the plan and constrain how it is implemented. Use bullet points or tables for clarity.]

- **REQ-001**: Requirement 1
- **SEC-001**: Security Requirement 1
- **[3 LETTERS]-001**: Other Requirement 1
- **CON-001**: Constraint 1
- **GUD-001**: Guideline 1
- **PAT-001**: Pattern to follow 1

## 2. Implementation Sequence

### Segment 1

- GOAL-001: [Describe the goal of this segment, e.g., "Implement feature X", "Refactor module Y", etc.]

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Description of task 1 | ✅ | 2025-04-25 |
| TASK-002 | Description of task 2 | |  |
| TASK-003 | Description of task 3 | |  |

### Segment 2

- GOAL-002: [Describe the goal of this segment, e.g., "Implement feature X", "Refactor module Y", etc.]

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-004 | Description of task 4 | |  |
| TASK-005 | Description of task 5 | |  |
| TASK-006 | Description of task 6 | |  |

## 3. Alternatives

[A bullet point list of any alternative approaches that were considered and why they were not chosen. This helps to provide context and rationale for the chosen approach.]

- **ALT-001**: Alternative approach 1
- **ALT-002**: Alternative approach 2

## 4. Dependencies

[List any dependencies that need to be addressed, such as libraries, frameworks, or other components that the plan relies on.]

- **DEP-001**: Dependency 1
- **DEP-002**: Dependency 2

## 5. Files

[List the files that will be affected by the feature or refactoring task.]

- **FILE-001**: Description of file 1
- **FILE-002**: Description of file 2

## 6. Testing

[List the tests that need to be implemented to verify the implementation.]

- **TEST-001**: Description of test 1
- **TEST-002**: Description of test 2

## 7. Risks & Assumptions

[List any risks or assumptions related to the implementation of the plan, their impact, and mitigation strategies.]

- **RISK-001**: Risk 1
- **ASSUMPTION-001**: Assumption 1

## 8. Related Specifications / Further Reading

[Link to related spec 1]
[Link to relevant external documentation]
```

#### CRITICAL GATE: WAIT FOR APPROVAL

```
⏸️ STOP HERE - DO NOT WRITE ANY CODE

I have presented the implementation plan above. Please review it carefully.

You may:
✅ Approve the plan as-is (respond with "approved" or "proceed")
📝 Request modifications (explain what to change)
❓ Ask clarifying questions
➕ Add requirements I may have missed

I will only proceed to Phase 2 (actual implementation) after receiving your explicit approval.
```

Wait for user response. Address any feedback, questions, or modification requests. Update the plan as needed and re-present until approval is received.

### Phase 2: Implementation Execution (ONLY AFTER APPROVAL)

**Objective:** Implement the approved plan with high-quality code.

#### Implementation Process

1. **Segment-by-Segment Implementation:**
   - Follow the implementation sequence from the approved plan
   - Implement each segment completely before moving to the next
   - For each segment:
     - Announce which segment you're implementing
     - Create or modify files as planned
     - Add inline comments for complex logic
     - Explain your approach for complex sections

2. **Code Quality Standards:**
   - Follow all conventions from `RULES.md`
   - Match existing code style and patterns from the codebase
   - Use descriptive variable and function names
   - Add appropriate error handling and input validation
   - Include helpful comments where logic is non-obvious

3. **No Workarounds Without Approval:**
   - If you encounter an implementation challenge that tempts a workaround:
     a. **Stop** and clearly explain the challenge
     b. **Propose** a proper architectural solution following best practices
     c. **Only if necessary**, explain why a workaround might be needed:
        - Why a proper solution isn't feasible
        - Specific trade-offs of the workaround
        - Future technical debt implications
        - How it could be properly fixed later
     d. **Flag** any workaround with `// WORKAROUND: [explanation]` comment
     e. **Never implement** a workaround without explicit user approval

4. **Improve, Don't Duplicate:**
   - If a similar component/function exists, enhance it rather than creating a duplicate
   - Refactor for reusability where appropriate
   - Maintain backward compatibility unless explicitly approved to break it

5. **Explain Complex Sections:**
   - For algorithms or complex business logic, explain your reasoning
   - Walk through your thought process as if mentoring
   - Highlight any assumptions or constraints

6. **Note Deviations:**
   - If you must deviate from the approved plan, explain why
   - Describe what changed and the rationale
   - Ensure the deviation is justified by practical considerations

#### Problem Solving Approach

When making technical decisions or solving complex problems:

1. **Rate Your Confidence (1-10):**
   - 8-10: High confidence, proceed
   - 5-7: Moderate confidence, explain alternatives considered
   - 1-4: Low confidence, present multiple solutions and ask for guidance

2. **For Complex Challenges:**
   - Articulate the problem clearly
   - Explain why it's challenging (competing constraints, edge cases, etc.)
   - Present 2-3 potential solutions:
     - **Solution A:** [Description]
       - Pros: [benefits]
       - Cons: [drawbacks]
       - Best for: [scenarios]
     - **Solution B:** [Description]
       - Pros: [benefits]
       - Cons: [drawbacks]
       - Best for: [scenarios]
   - Make a recommendation based on best practices
   - Avoid choosing based on expediency alone

3. **Apply Senior Developer Thinking:**
   - Consider edge cases and failure modes
   - Evaluate long-term maintenance implications
   - Assess performance under various conditions
   - Consider security implications
   - Think about how this scales as the system grows

#### Testing Implementation

As you implement each segment, also implement corresponding tests:

1. **Unit Tests:**
   - Test individual functions/methods
   - Cover normal cases and edge cases
   - Test error conditions

2. **Integration Tests (if applicable):**
   - Test how components work together
   - Test API endpoints end-to-end
   - Test database interactions

3. **Follow Project Testing Standards:**
   - Match existing test structure and conventions
   - Use the same testing framework as the project
   - Follow naming conventions for test files

#### Self-Review Before Finalizing

Before declaring implementation complete, conduct a self-review:

1. **Code Quality Checklist:**
   - ✅ Follows project conventions from `RULES.md`
   - ✅ No workarounds without approval
   - ✅ Proper error handling throughout
   - ✅ Input validation where needed
   - ✅ Helpful comments for complex logic
   - ✅ Consistent naming and style
   - ✅ No unnecessary code duplication

2. **Completeness Checklist:**
   - ✅ All features from RFC implemented
   - ✅ All acceptance criteria met
   - ✅ All planned files created/modified
   - ✅ Tests written and passing (preliminary check)
   - ✅ Documentation updated (README, inline docs)

3. **Architecture Checklist:**
   - ✅ Integrates cleanly with existing code
   - ✅ Follows established patterns
   - ✅ Performance considerations addressed
   - ✅ Security considerations addressed
   - ✅ Future extensibility considered

## Validation Phase

After implementation is complete, run comprehensive validation to ensure quality.

### Validation Command Detection

**Primary Strategy:** Detect and use existing development scripts from project configuration files.

#### Detection Process

1. **Identify Project Type** from injected shell outputs:
   - `<package-json>` - Node.js/JavaScript/TypeScript projects
   - `<pyproject-toml>` - Python projects
   - `<tsconfig>` - TypeScript-specific detection
   - `<lockfiles>` - Package manager detection (npm/yarn/pnpm)
   - `<project-config>` - Other project types (Rust, Go, Java, Makefile)

2. **Extract Validation Commands** from project configuration:
   - **Node.js**: Read `scripts` section from `<package-json>`
   - **Python**: Check `[tool.pytest]`, `[tool.ruff]`, `[tool.mypy]` sections in `<pyproject-toml>`
   - **TypeScript**: Check `<tsconfig>` existence for type checking needs
   - **Rust/Go/Java**: Use standard toolchain commands
   - **Makefile**: Run `bash make -n test` and `bash make -n build` to check target existence

3. **Run Detected Commands** in priority order: tests → build → lint

#### Project-Specific Detection Hints

**Node.js/TypeScript** (check `<package-json>`):
- **Test**: Look for `test`, `test:unit`, `test:integration` in `scripts` section
- **Build**: Look for `build`, `compile`, `dist` in `scripts` section
- **Lint**: Look for `lint`, `lint:check`, `eslint` in `scripts` section
- **Type Check**: If `<tsconfig>` exists, look for `type-check` script or run `npx tsc --noEmit`
- **Package Manager**: Detect from `<lockfiles>` (`package-lock.json` → npm, `yarn.lock` → yarn, `pnpm-lock.yaml` → pnpm)

**Python** (check `<pyproject-toml>` or `<project-config>` for `setup.py`):
- **Test**: Look for `[tool.pytest]` section in `<pyproject-toml>`, then use `pytest` or `python -m pytest`
- **Lint**: Look for `[tool.ruff]`, `[tool.flake8]`, `[tool.black]` sections in `<pyproject-toml>`
- **Type Check**: Look for `[tool.mypy]` section in `<pyproject-toml>`

**Rust** (`Cargo.toml` exists):
- Standard toolchain: `cargo test`, `cargo build`, `cargo clippy`, `cargo fmt --check`

**Go** (`go.mod` exists):
- Standard toolchain: `go test ./...`, `go build ./...`, `go vet ./...`

**Makefile** (check `<project-config>`):
- Use `bash` tool to run `make -n test`, `make -n build`, `make -n lint` to check if targets exist

#### Adaptive Command Execution

Based on detected project type, run validation commands in this order:

1. **Tests** (REQUIRED): Execute test command, ALL must pass
2. **Build** (REQUIRED if build script/command exists): Must complete without errors
3. **Lint** (REQUIRED if lint script/command exists): NO errors allowed (warnings OK)
4. **Type Check** (OPTIONAL): Run if explicitly configured in project

**Example Detection Logic:**
```
if <package-json> contains scripts section:
  parse scripts for test/build/lint commands
  detect package manager from <lockfiles>
  run: {npm|yarn|pnpm} test, {npm|yarn|pnpm} run build, {npm|yarn|pnpm} run lint
  if <tsconfig> exists and no type-check script: run `npx tsc --noEmit`
elif <pyproject-toml> exists:
  if [tool.pytest] section: run `pytest`
  if [tool.ruff] section: run `ruff check .`
  if [tool.mypy] section: run `mypy .`
elif <project-config> shows Cargo.toml:
  run `cargo test`, `cargo build`, `cargo clippy`
elif <project-config> shows go.mod:
  run `go test ./...`, `go build ./...`, `go vet ./...`
elif <project-config> shows Makefile:
  use bash tool to check and run: `make test`, `make build`, `make lint`
```

### Validation Requirements (MANDATORY)

**Verification is NOT complete until ALL of the following pass:**

1. ✅ **All Tests Pass**
   - Run the appropriate test command for the project type
   - ALL tests must pass (not just the new ones)
   - No skipped tests unless they were already skipped

2. ✅ **Build Succeeds**
   - Run the appropriate build command
   - Build must complete without errors
   - Warnings are acceptable if they existed before

3. ✅ **No Linter Errors**
   - Run the appropriate linter command
   - NO linter errors (exit code must be 0)
   - Warnings are acceptable but should be minimized

### Validation Failure Handling

If any validation step fails:

1. **Analyze the Error:**
   - Read the error output carefully
   - Identify the root cause
   - Determine if it's related to your changes

2. **Fix the Issue:**
   - Make targeted fixes to address the error
   - Do not make unrelated changes
   - Explain what you're fixing and why

3. **Re-run Validation:**
   - Run the same validation command again
   - Verify the specific error is resolved

4. **Repeat Until Clean:**
   - Continue the fix-verify cycle until all validation passes
   - Do not proceed to completion phase with failing validation

## Completion Phase

### Update RFCS.md Status

Once validation passes, update the RFC status in RFCS.md:

1. **Read Current RFCS.md:**
   - Use `read` tool to load the RFCS.md file (check all possible locations)

2. **Locate the RFC Row:**
   - Find the row in the RFC Summary Table matching this RFC's ID

3. **Update Status:**
   - Change the Status column from `Pending` or `In Progress` to `Completed`
   - Preserve all other columns (Priority, Complexity, Phase, etc.)
   - Maintain exact table formatting

4. **Write Updated Content:**
   - Use `edit` tool to update the Status field
   - Verify the table structure remains intact

5. **Error Handling:**
   - If RFCS.md doesn't exist, warn user but continue
   - If the table format is unexpected, show user the issue and ask for guidance
   - If update fails, provide manual instructions: "Please update RFC-XXX status to 'Completed' in RFCS.md"

### Final Deliverables

1. **Provide the user with a comprehensive completion summary**:

```markdown
## ✅ RFC-XXX: Implementation Complete

**RFC:** RFC-XXX - [Title]
**Status:** Completed and Verified

### Features Implemented
- [Feature 1: brief description]
- [Feature 2: brief description]
- [Continue for all features...]

### Files Created
- `path/to/file1.ts` - [purpose]
- `path/to/file2.ts` - [purpose]

### Files Modified
- `path/to/existing1.ts` - [changes made]
- `path/to/existing2.ts` - [changes made]

### Tests Added
- [Test suite or test file name]
- Coverage: [what's tested]

### Validation Results
- ✅ Lint: Clean (no errors)
- ✅ Type Check: Passed (0 errors)
- ✅ Security Scan: Passed (0 HIGH/CRITICAL vulnerabilities)
- ✅ Tests: All passing ([number] tests)
- ✅ Accessibility: Passed (if applicable)
- ✅ Visual & Usability: Passed (if UI component - Playwright tests)
- ✅ Build: Successful
- ✅ Format: Compliant

### Security Validation
- ✅ No hardcoded credentials
- ✅ Input validation implemented
- ✅ Secure error handling
- ✅ Dependencies verified

### Implementation Details
- [Technical approach taken]
- [Key challenges overcome]
- [Files created/modified]
- [Security considerations addressed]
- [Accessibility features implemented (if applicable)]
- [Any important technical notes, decisions made, or context for future developers]

### Results Summary
- [What was accomplished]
- [Acceptance criteria met]
- [Performance characteristics]
- [Known limitations or future improvements]

### Future Considerations
- [Potential improvement 1]
- [Potential improvement 2]
- [Scaling consideration 1]

### Senior Developer Assessment
**Strengths:**
- [What was done well]
- [Good architectural decisions]
- [Strong aspects of the implementation]

**Areas for Future Refinement:**
- [Not critical, but could be improved later]
- [Technical debt considerations]

**Scaling Considerations:**
- [How this will handle growth]
- [Performance characteristics]
- [Potential bottlenecks to watch]
```

2. **Include Evidence**:
   - Terminal output from quality gate commands
   - Test results summary (including accessibility tests)
   - Security scan results
   - Build success confirmation
   - Any warnings or issues resolved

## Error Handling and Edge Cases

Handle these scenarios gracefully:

### RFC Selection Errors

| Scenario | Action |
|----------|--------|
| `<rfc-path>` is empty | Show available RFCs from `<available-rfcs>`, ask user to select one |
| RFC file not found at path | Search alternate locations (`RFCs/`, `docs/rfc/`, `docs/rfcs/`), if still not found, ask user for correct path |
| RFC file is malformed | Report specific parsing errors, ask user to fix or provide clarification |

### Missing Context Documents

| Document | Action |
|----------|--------|
| PRD.md missing | Warn: "PRD.md not found. Proceeding with RFC specifications only." |
| FEATURES.md missing | Warn: "FEATURES.md not found. Using RFC as primary requirements source." |
| RULES.md missing | Warn: "RULES.md not found. Using general best practices and codebase patterns." |
| All missing | Warn: "No context documents found. Proceeding with RFC only. Quality may be impacted." |

### Prerequisite and Dependency Errors

| Scenario | Action |
|----------|--------|
| RFCS.md not found | Warn: "RFCS.md index not found. Cannot validate prerequisites. Proceeding without dependency checking." |
| Prerequisites incomplete | List incomplete RFCs, explain dependency chain, ask: "Prerequisites [list] are not completed. Proceed anyway?" |
| Circular dependencies | Report: "Circular dependency detected between [RFCs]. Please resolve in RFCS.md before proceeding." |
| RFCS.md parse error | Report: "Cannot parse RFCS.md table format. Expected format: [show example]. Please fix or confirm to proceed without validation." |

### Git and Version Control Errors

| Scenario | Action |
|----------|--------|
| Not a git repository | Warn: "Not a git repository. Cannot detect resume state or track changes. Proceeding with fresh implementation." |
| Git commands fail | Use fallback: skip resume detection, proceed as fresh start |
| Uncommitted changes unrelated to RFC | Inform: "Detected uncommitted changes unrelated to this RFC. Consider committing or stashing before proceeding." |

### Validation Failures

| Scenario | Action |
|----------|--------|
| Tests fail | Analyze error, fix code, re-run tests. Repeat until passing. |
| Build fails | Analyze error, fix issues, re-run build. Repeat until success. |
| Lint errors | Fix all errors, re-run lint. Repeat until clean. |
| Can't determine project type | Ask: "Cannot detect project type. Please specify test command, build command, and lint command." |
| Validation command not found | Try alternatives, ask user: "Cannot find [command]. How should I validate this project?" |
| Pre-existing failures | Ask: "These failures appear pre-existing: [list]. Should I fix them or note and proceed?" |

### RFCS.md Update Errors

| Scenario | Action |
|----------|--------|
| RFCS.md not found | Warn: "Cannot update RFCS.md (not found). Please manually mark RFC-XXX as Completed." |
| Table format unexpected | Show user the table, explain expected format, ask: "Cannot parse table. Please update manually or help me understand the format." |
| Edit fails | Provide manual instructions: "Please update RFC-XXX Status column to 'Completed' in [path to RFCS.md]" |

## Scope Limitation

**IMPORTANT:** Only implement features specified in the RFC being processed. Do not:
- Implement features from other RFCs (even if they seem related)
- Add "nice to have" features not in the RFC
- Refactor code beyond what's necessary for this RFC (unless explicitly part of requirements)
- Fix unrelated bugs (unless they block this RFC)

If you identify dependencies on features from other RFCs, note them in your implementation plan and discuss with the user, but do not implement them unless explicitly instructed.

## Summary of Execution Flow

1. ✅ **Pre-Implementation:** Resolve RFC, load context, validate prerequisites, detect resume state
2. ✅ **Phase 1 - Planning:** Analyze, plan, present → WAIT FOR APPROVAL
3. ✅ **Phase 2 - Execution:** Implement following approved plan, explain complex sections
4. ✅ **Validation:** Run tests, build, lint → ALL MUST PASS
5. ✅ **Completion:** Update RFCS.md, provide final deliverables and assessment

Begin by executing Step 1 of the Pre-Implementation Phase.
