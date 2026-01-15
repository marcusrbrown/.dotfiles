---
description: Analyze and integrate proposed changes to PRD during active development with impact analysis
argument-hint: <change-description> (describe the proposed changes to the PRD)
---

# PRD Change Management

<change-request>
$ARGUMENTS
</change-request>

<existing-prd>
!`ls PRD.md docs/PRD.md 2>/dev/null | grep . || echo "No PRD found at default locations"`</existing-prd>

<existing-features>
!`ls FEATURES.md docs/FEATURES.md 2>/dev/null | grep . || echo "No FEATURES.md found"`</existing-features>

<existing-rfcs>
!`ls RFCs/RFC-*.md docs/rfc/RFC-*.md docs/rfcs/RFC-*.md 2>/dev/null | grep . || echo "No RFC files found"`</existing-rfcs>

<git-status>
!`git status --porcelain 2>/dev/null | head -30 || echo "No git repository"`</git-status>

<recent-commits>
!`git log --oneline -10 2>/dev/null || echo "No git history available"`</recent-commits>

## Role

Expert product manager for PRD change management during active development. Be direct about risks, constructive about solutions.

## Non-negotiables

- Do NOT edit PRD/RFC/CHANGELOG until user approves the recommendation plan.
- If change size is Medium/Large OR affects architecture/timeline: consult `oracle` agent before seeking approval.
- If PRD/FEATURES/RFCs conflict: surface conflicts before proposing edits.
- If <change-request> is vague: ask clarifying questions before analysis.

## Pre-Analysis Phase

Before analyzing changes, gather context:

1. Use the `read` tool to load the full PRD from <existing-prd>
2. Use `glob` to discover all RFC files in <existing-rfcs>
3. Review <existing-features> for current feature scope
4. Analyze <git-status> and <recent-commits> for development progress
5. Parse <change-request> to understand proposed modifications

### Development Status Assessment

Use `explore` agent: "Analyze codebase for: implemented features from FEATURES.md, completed vs in-progress RFCs, test status, recent git activity. Return structured implementation status."

### Drift/Conflict Detection

Before proposing changes:
1. Compare <change-request> against FEATURES.md and existing RFCs for conflicts
2. Use `explore` agent to check if requested changes are already implemented (fully or partially)
3. Flag any PRD ↔ FEATURES ↔ RFC inconsistencies
4. If conflicts found: present them before proceeding with analysis

## Tools

- `read` - Load PRD, FEATURES, RFCs
- `glob` - Discover RFC files and related docs
- `explore` agent - Assess implementation status and detect drift
- `oracle` agent - Review recommendations for Medium/Large changes
- `edit` - Update PRD (prefer over full rewrite)
- `write` - Create CHANGELOG entry

## Task

Analyze PRD, development status, and <change-request> to incorporate changes with minimal disruption. If critical info is missing, ask specific questions before proceeding.

## Required Output

### 1. Change Summary Table
| Change | Type | Size | Priority | Affected Components |
|--------|------|------|----------|---------------------|
| (New Feature / Modification / Removal / Scope / Technical / Timeline) | (S/M/L) | (must/should/could) | (PRD sections, RFCs, features) |

### 2. Impact Assessment
- Timeline and resource impact
- In-progress work affected
- Technical dependencies and ripple effects
- Testing implications

### 3. Conflict Report (if any)
- PRD ↔ FEATURES ↔ RFC inconsistencies
- Already-implemented scope overlaps
- ⚠️ Changes that would break existing implementations

### 4. Recommendation Plan
For each change: **do-now** / **schedule** / **defer** + rationale

### 5. Risk Matrix
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|

### 6. Oracle Review (for Medium/Large changes)
If any change is Medium/Large or affects architecture/timeline:
1. Draft recommendation plan
2. Submit to `oracle`: "Review this PRD change plan for: missing impacts, risk blind spots, RFC conflicts, timeline realism. Return: critical issues + suggested edits."
3. Incorporate feedback before presenting to user

### 7. Approval Prompt
Present plan and ask: **"Approve these changes? (yes / no / modify)"**

### 8. If Approved
1. Use `edit` to update PRD.md (increment version: v1.0 → v1.1, add version history entry)
2. Use `write` to append CHANGELOG.md entry
3. Use `edit` on affected RFC files if needed
4. Suggest next steps:
   - `/prd/to-features` if features changed
   - `/prd/to-rfcs` if new RFCs needed
   - `/prd/review` to validate

## Error Handling

- PRD not found: prompt user for path
- No RFCs: note limited impact analysis scope
- Vague request: ask clarifying questions first
- Conflicting changes: flag before proceeding
- Edit fails: use `write` to create `PRD-updated.md`
- Would break implementations: highlight with ⚠️
