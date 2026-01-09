---
description: Implement an RFC document with two-phase approach (plan then execute), supports resuming partial implementations
argument-hint: <rfc-path> (e.g., RFCs/RFC-001-User-Authentication.md)
---

# RFC Implementation Guide

## Role
Senior developer mindset: align with existing architecture, prefer simple/maintainable solutions, be explicit about risks and trade-offs.

## Non-negotiables
- **Phase 1** = plan only (no code). **Phase 2** = implement only after explicit user approval.
- Drift Medium/High → implement delta only (or update RFC first if user prefers).
- Stay in RFC scope; no unrelated refactors/bugs unless blocking.
- Before completion: `lsp_diagnostics` clean + build/tests pass + all acceptance criteria met.

## Scope Limitation
Only implement features specified in this RFC. Do not:
- Implement features from other RFCs (even if related)
- Add "nice to have" features not in the RFC
- Refactor beyond what's necessary (unless explicit requirement)
- Fix unrelated bugs (unless blocking)

If dependencies on other RFCs exist, note them and discuss—do not implement without explicit instruction.

## Context Gathering

<rfc-path>
$ARGUMENTS
</rfc-path>

<git-status>
!`git status --porcelain 2>/dev/null | head -20 || echo "No git repository or no uncommitted changes"`</git-status>

<git-diff-summary>
!`git diff --stat 2>/dev/null | tail -20 || echo "No unstaged changes"`</git-diff-summary>

<recent-commits>
!`git log --oneline -10 2>/dev/null || echo "No git history available"`</recent-commits>

1. **Load Context Documents**: Use the `read` tool to load the following documents in parallel (batch multiple `read` calls in a single response):
   - The RFC file from `<rfc-path>` (REQUIRED)
   - `PRD.md` or `docs/PRD.md` (if exists)
   - `FEATURES.md` or `docs/FEATURES.md` (if exists)
   - `RULES.md` or `docs/RULES.md` (if exists)
   - The RFCS.md index from one of these locations:
     - `RFCs/RFCS.md`
     - `docs/rfc/RFCS.md`
     - `docs/rfcs/RFCS.md`
   - Note which documents are missing but proceed with available context.
2. **Prerequisite Validation** (if RFCS.md exists):
   - Find this RFC's phase/ordering in the RFCS.md table
   - Require all lower-phase RFCs and earlier same-phase RFCs to be `Completed`
   - If prerequisites incomplete, ask user whether to proceed
3. **Resume Detection**: Analyze current state to determine fresh start vs. resume:
   - Parse `<git-status>`, `<git-diff-summary>`, `<recent-commits>` for implementation evidence
   - Extract RFC scope: files to create/modify, components, tests
   - Use `glob` to check file existence; `read` to verify RFC-related content
   - **Present brief assessment:**
     - **Implemented:** [files/components with RFC code]
     - **Pending:** [missing files, incomplete items]
     - **Tests:** implemented / missing
     - **Conclusion:** Fresh start | Resume
   - If partial implementation detected, ask: "Continue from where you left off, or start fresh?"
   - If resuming → Phase 2 (pending items). If fresh → Phase 1.

4. **Drift Detection**: Identify existing code that already satisfies RFC requirements.

   **Process:**
   1. Extract from RFC: files, symbols (types/functions/components), endpoints, acceptance criteria
   2. Scan codebase: `glob` for files, `grep` for symbols, `read` to verify behavior
   3. Use `explore` agent for complex overlap: "Compare [RFC] tech spec against codebase. Return: existing matches, partial implementations, differences."
   4. Classify each requirement:
      | Status | Meaning |
      |--------|---------|
      | **Already** | Code exists, fully satisfies requirement |
      | **Partial** | Code exists but incomplete/different |
      | **Missing** | No existing code; build per RFC |
      | **Superseded** | Requirement obsolete due to arch changes |

   5. **Present drift summary:**
      - **Drift Level:** Low / Medium / High
      - **Already:** [bullet list]
      - **Partial:** [bullet list with gap notes]
      - **Missing:** [bullet list]
      - **Superseded:** [bullet list with recommendations]

   6. **If Medium/High drift**, ask user:
      1. Proceed with delta implementation (RFC partially obsolete)
      2. Update RFC first, then implement delta
      3. Discuss discrepancies before deciding

   7. **If RFC update chosen**, propose changes to:
      - Technical Specification (remove implemented, modify partial)
      - Acceptance Criteria (remove satisfied, adjust scope)
      - Test Cases (remove duplicates)

      Get user approval, then proceed with delta implementation only.

## Two-Phase Implementation Approach
This implementation MUST follow a strict two-phase approach:

### Phase 1: Implementation Planning
**Objective:** Develop and present a comprehensive implementation plan without writing any actual code:
1. Thoroughly analyze the requirements and existing codebase
2. Perform Drift Detection (see Context Gathering step 4) and incorporate findings
3. Develop a comprehensive implementation plan that accounts for drift (see details below)
4. DO NOT write any actual code during this phase
5. Submit the draft plan to the `oracle` subagent for review (see Oracle Plan Review below)
6. Incorporate oracle feedback and present the revised plan to the user
7. Wait for explicit user approval of the plan before proceeding to Phase 2
8. Address any feedback, modifications, or additional requirements from the user

**Drift-Aware Planning:**
The implementation plan MUST account for drift findings:
- If drift is Low: Proceed with RFC as written, noting any minor adjustments
- If drift is Medium/High: Plan must focus on delta work only (not re-implementing existing code)
- If RFC update was performed: Plan must reference the updated RFC sections

#### Oracle Plan Review (Phase 1 Gate)
Before presenting the plan to the user, submit to `oracle` for review and incorporate feedback.

**Oracle prompt:** "Review this RFC implementation plan for: missing dependencies, codebase pattern alignment, security/perf risks, test completeness, and drift accuracy (if applicable). RFC: [ID + Title] | Drift: [Level] | Plan: [content]. Return: (1) Critical issues, (2) Suggested edits."

**Skip condition:** If RFC scope is trivial (≤1 file, no new APIs, no security implications), you may skip oracle review but MUST state why.

### Phase 2: Implementation Execution
**Objective:** Implement the approved plan with high-quality code:
1. Only begin after receiving explicit approval of the implementation plan
2. Follow the approved plan, noting any necessary deviations
3. Implement in logical segments as outlined in the approved plan
4. Explain your approach for complex sections
5. Conduct a self-review before finalizing

## Implementation Guidelines

### Before Writing Code
1. Use `explore` agent: "Analyze [RFC scope]. Return: existing patterns, files to modify, reusable components."
2. Use `librarian` agent (if unfamiliar libs): "Find docs/examples for [library] [feature]. Return: APIs, gotchas, best practices."
3. Analyze relevant code files to understand existing architecture
4. If unclear on requirements, ask specific questions
5. Consider: performance, maintainability, scalability, security implications

### Using the RFC as Implementation Source
The RFC document is your primary source of truth. Follow these guidelines:

1. **Technical Specification Section**: Implement the structure and code provided in this section verbatim as your foundation
   - Follow TDD if applicable to the project
   - If the provided code is incomplete, expand where needed to address gaps
   - The code and structure in this section represents actual implementation details combined with requirements from the rest of the RFC
2. **Test Cases Section**: Use the framework/code provided in this section (if applicable) as your testing foundation
   - Expand tests to cover any implementation gaps not addressed by the provided test cases
3. **Acceptance Criteria**: ALL acceptance criteria MUST be met for implementation to be considered complete
4. **Quality Checks**: All quality checks (lint, build, tests) must pass before completion
5. The RFC is the source of truth - make best effort to implement exactly as specified and shore up any gaps

### Implementation Standards
1. Follow naming conventions in RULES.md (if exists)
2. Avoid workarounds. If unavoidable: explain why, state trade-offs, get user approval, mark with `// WORKAROUND: [reason]`
3. Improve existing methods/classes rather than creating duplicates
4. Ensure proper error handling, input validation, comments, and tests
5. Apply SOLID principles; optimize for readability first, then performance

### Implementation Process
Follow Phase 1 (plan + oracle review + user approval) then Phase 2 (execute). Implement in small, reviewable segments. Document any deviations from the approved plan with reasoning.

### Problem Solving
- Rate confidence (1-10). If <8: list alternatives, consult `oracle` agent
- For complex issues: clarify constraints, assess risks (security/perf/edge cases), recommend simplest compliant approach

## Completion Phase

### Verification Before Completion
1. Run `lsp_diagnostics` on all changed files—no errors or warnings
2. Run build command if available (`npm run build`, `cargo build`, etc.)
3. Run test command if available (`npm test`, `pytest`, etc.)
4. Verify ALL acceptance criteria from RFC are satisfied

### Code Quality Checklist
Ensure: readable code, proper error handling, testable structure, consistent with codebase, secure, performant.

### Update RFC Status
Once validation passes, update RFCS.md:
1. Find RFC row, change Status to `Completed`
2. Add completion note to RFC document: date, summary, deviations (if any)
3. Mark RFC Status as `Completed` in RFC document metadata section (if exists)

## Final Deliverables
1. All code changes implementing the RFC
2. Brief documentation of how it works
3. Required tests
4. Notes on future considerations
5. List of architectural decisions (especially deviations from plan)

Begin with Context Gathering and proceed through the two-phase approach.
