---
description: Review a PRD for gaps, clarity, and implementation-readiness - produces improved version
argument-hint: <path-to-prd> (e.g., PRD.md or docs/PRD.md)
---

# PRD Verification and Improvement Prompt

<prd-path>
$ARGUMENTS
</prd-path>

<existing-prd>
!`ls PRD.md docs/PRD.md 2>/dev/null | grep . || echo "No PRD found"`</existing-prd>

## Role

Expert product manager reviewing PRDs for gaps, clarity, and implementation-readiness. Be constructive, not critical—focus on actionable improvements.

## When to Use This Command

- **`/prd/review`**: Pre-development quality pass. May restructure heavily. Creates `PRD-improved.md`.
- **`/prd/update`**: During development when requirements change. Minimal disruption. Updates existing `PRD.md` + CHANGELOG.

## Non-negotiables

- Do NOT write `PRD-improved.md` until user approves the proposed changes outline.
- If existing downstream docs (FEATURES/RULES/RFCs) conflict with PRD changes, surface conflicts first.
- If rewrite is Medium/Large (>30% sections changed, scope change, or new integrations): consult `oracle` before finalizing.
- If <prd-path> is empty and <existing-prd> shows nothing: prompt user for path and STOP.

## Pre-Review Phase

1. **Load PRD**: Use `read` on path from <prd-path>, or first match in <existing-prd>
2. **Discover related docs**: Use `glob` for `docs/*.md` and `*.md` patterns
3. **Read key docs**: Load FEATURES.md, RULES.md, RFCs index if they exist
4. **Codebase check**: If source files exist, use `explore` agent for technical feasibility

### Drift/Conflict Detection

Before proposing changes:
1. Compare PRD against existing FEATURES.md, RULES.md, RFCs for inconsistencies
2. If downstream docs exist, note any PRD claims that contradict them
3. Flag conflicts before proceeding with analysis

### Technical Feasibility (if codebase exists)

Use `explore` agent: "Analyze project architecture and tech stack. Flag PRD requirements that conflict with existing implementation. Return: constraints, patterns, conflicts."

## Tools

- `read` - Load PRD and related documentation
- `glob` - Discover docs (FEATURES.md, RULES.md, RFCs)
- `write` - Save improved PRD (after approval)
- `explore` agent - Technical feasibility validation
- `librarian` agent - External library documentation
- `oracle` agent - Review significant rewrites

## Review Process

### 1. Findings Table

Analyze PRD and produce a structured findings table:

| Severity | Area | Issue | Recommendation |
|----------|------|-------|----------------|
| High/Med/Low | Product/Technical/Business/Implementation | Gap or problem | Specific fix |

**Areas to check:**
- **Product**: Vision, problem statement, target users, success metrics, scope
- **Technical**: Tech constraints, integrations, security, performance, infrastructure
- **Business**: Timeline, budget, regulatory, market factors
- **Implementation**: Dependencies, team resources, testing, deployment

### 2. Quality Scores

Score PRD (1-10) on:
- **Completeness**: All required sections present
- **Clarity**: Requirements are unambiguous
- **Feasibility**: Technically achievable
- **User-Focus**: Clear user needs and journeys

### 3. Proposed Changes Outline

Present a summary of key changes before writing:
- Sections to add/restructure
- Requirements to clarify
- User stories to improve
- Scope boundaries to define

### 4. Oracle Review (for Medium/Large rewrites)

If rewrite affects >30% of sections, changes scope, or adds integrations:
1. Draft proposed changes outline
2. Submit to `oracle`: "Review this PRD improvement plan for: missing gaps, feasibility issues, structural problems, downstream doc conflicts. Return: critical issues + suggested edits."
3. Incorporate feedback before presenting to user

### 5. Approval Prompt

Present findings + proposed outline and ask: **"Approve this improvement plan? (yes / no / modify)"**

## Output (after approval)

1. Write improved PRD:
   - `PRD.md` → `PRD-improved.md`
   - `docs/PRD.md` → `docs/PRD-improved.md`
2. Use `read` to verify file was created
3. Suggest next steps:
   - `/prd/to-features` to extract features list
   - `/prd/to-rules` to generate technical guidelines
   - `/prd/to-rfcs` to break down into RFCs

## Error Handling

- PRD not found: check <existing-prd>, prompt for path
- PRD too brief: suggest `/prd/update` to expand first
- Write fails: output content in chat
- Fundamental issues (no vision, no users): recommend `/prd/create`
- Technical conflicts with codebase: flag specific conflicts with alternatives
