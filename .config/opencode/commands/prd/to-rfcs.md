---
description: Convert a PRD into sequentially-ordered RFC documents
argument-hint: <path-to-prd> (e.g., docs/PRD.md)
---

# PRD to RFCs Converter

<prd-path>
$ARGUMENTS
</prd-path>

<existing-prd>
!`ls PRD.md docs/PRD.md 2>/dev/null | grep . || echo "No PRD found"`</existing-prd>

<existing-rfcs>
!`find . -maxdepth 3 -name "RFC-*.md" -o -name "RFCS.md" -type f 2>/dev/null | sort || echo "No RFC files found"`</existing-rfcs>

<existing-docs>
!`(find docs -maxdepth 1 -type f -name '*.md' 2>/dev/null || ls *.md 2>/dev/null) | sort | head -20 |  awk 'NR { print; found=1 } END { if (!found) print "No docs found" }'`</existing-docs>

<project-manifests>
!`ls package.json pyproject.toml go.mod Cargo.toml pom.xml 2>/dev/null | grep . || echo "No manifests"`</project-manifests>

## Role
Expert software architect breaking down PRD into sequential RFC documents. Each RFC = cohesive, implementable unit. Ordering is critical—RFCs are implemented strictly one-by-one.

## Non-negotiables
- Do NOT write/overwrite RFC files until user explicitly approves the plan.
- If existing RFCs have drifted from PRD/codebase: classify drift and get approval before regenerating.
- Later RFCs MUST build on earlier RFCs—no contradicting established decisions.
- If PRD conflicts with existing code: surface conflict and ask before proceeding.
- If <prd-path> is empty or ambiguous: ask for clarification.

## Phase 1: Gather Context

### Step 1: Read Input Documents (parallel)
Use `read` tool on:
- PRD file from <prd-path> (or <existing-prd> if unspecified)
- FEATURES.md, RULES.md if they exist (check <existing-docs>)

Note missing files and proceed with what's available.

### Step 2: Codebase Analysis (if existing code)
If <project-manifests> shows a project, use `explore` agent:
```
Analyze codebase: architecture, reusable components, tech stack, patterns (state, API, errors), data models. Return structured summary for RFC planning.
```

### Step 3: Read Existing RFCs (if any)
If <existing-rfcs> shows RFC files, use `read` tool to load ALL existing RFCs in parallel. These are needed for drift detection and dependency chaining.

---

## Phase 2: Drift Detection & RFC Regeneration

**Skip this phase if no existing RFCs.**

### Drift Assessment
For each existing RFC, compare against current PRD and codebase:

| Drift Level | Criteria | Action |
|-------------|----------|--------|
| **None/Low** | Still accurate, minor updates only | Keep as-is |
| **Medium** | Partially accurate, some sections outdated | Propose targeted patches |
| **High** | Major mismatch with PRD or codebase reality | Propose regeneration |

### Classification Process
For each RFC:
1. Extract: purpose, scope, key decisions (APIs, types, schemas), acceptance criteria
2. Compare against: PRD requirements + current implementation reality
3. List specific mismatches (quote PRD vs RFC discrepancies)

### Approval Gate (MANDATORY)
Present drift classification to user:
```
## RFC Drift Assessment

### Keep (No/Low Drift)
- RFC-001: [reason still accurate]

### Patch (Medium Drift)
- RFC-002: [list specific changes needed]

### Regenerate (High Drift)
- RFC-003: [list 3-5 concrete mismatches]

**Proceed with patching/regenerating?** [Wait for approval]
```

**Do NOT modify any RFC files until user approves.**

---

## Phase 3: RFC Dependency Chaining

**Principle**: Later RFCs MUST build on earlier RFCs. Never contradict established decisions.

### Dependency Identification
For each RFC beyond RFC-001:
- **Depends on**: List earlier RFCs this builds upon (with specific reasons)
- **Provides to later RFCs**: What contracts/APIs/types this establishes

### When Drafting RFC-002+
Before writing RFC-00N:
1. **Read dependency RFCs** in full (use `read` tool)
2. **Extract and pin**:
   - Terminology / domain model from earlier RFCs
   - Key decisions: APIs, data models, auth, storage, error handling
   - File/module boundaries established
   - Non-goals and constraints that affect later work
3. **Reference explicitly**: Use "Per RFC-001 §[Section]..." when building on earlier decisions
4. **No silent divergence**: If changes needed to earlier RFC decisions, propose an amendment instead

### Consistency Check (required in each RFC)
Include at end of each RFC-002+:
```markdown
## Compatibility with Dependencies
- RFC-001: [Confirm no contradictions, or list required amendments]
- RFC-002: [If applicable]
```

---

## Tool Usage

Tools:
- `read` - PRD, FEATURES, RULES, existing RFCs
- `glob` - Discover files (e.g., `RFCs/*.md`)
- `write` - Create RFC files and RFCS.md index
- `explore` agent - Codebase analysis
- `librarian` agent - External library docs
- `oracle` agent - Validate RFC plan before presenting to user

---

## Phase 4: Oracle Review Gate (MANDATORY)

Before presenting the RFC plan to the user, consult `oracle` agent:

**Oracle Prompt:**
```
Review this RFC plan for a PRD-to-RFC conversion:

PRD Summary: [brief PRD overview]
Proposed RFCs: [list RFC-001 through RFC-00N with titles]
Dependency Chain: [show which RFCs depend on which]
Drift Decisions: [if applicable - what's being kept/patched/regenerated]

Validate:
1. Is the sequential order correct? Any dependency issues?
2. Are RFC scopes appropriate (not too large/small)?
3. Any contradictions between proposed RFCs?
4. Missing critical components that should be separate RFCs?
5. Any technical feasibility concerns?

Return: approval or specific issues to address.
```

**Only proceed to present plan to user after oracle approval.**

---

## Phase 5: RFC Generation

### 5.1 Implementation Order Analysis
1. Identify foundation components (must build first)
2. Create dependency graph (textual)
3. Assign sequential numbers (001, 002, 003...)
4. **Critical**: Each RFC fully implementable after all previous RFCs complete. No parallel implementation.

### 5.2 Feature Grouping
- Group related features into cohesive RFCs
- Balance size: not trivial, not unmanageable
- Shared components → earlier RFCs

### 5.3 RFC Template
Each RFC must include:

```markdown
# RFC-00N: [Title]

## Summary
[What this RFC covers]

## Dependencies
- **Builds on**: RFC-00X (reason), RFC-00Y (reason)
- **Provides to later RFCs**: [contracts/APIs/types established]

## Features/Requirements
[List from PRD]

## Technical Approach
- Architecture considerations
- API contracts / interfaces
- Data models / schema changes
- State management (if applicable)

## Implementation Details
- File structure
- Key algorithms / business logic
- UI/UX patterns (if applicable)
- Error handling
- Testing strategy

## Acceptance Criteria
[Specific, testable criteria]

## Complexity
[Low | Medium | High]

## Compatibility with Dependencies
[Confirm no contradictions with earlier RFCs]
```

### 5.4 RFCS.md Index
Create master index with:

| RFC ID | Title | Priority | Complexity | Phase | Status |
|--------|-------|----------|------------|-------|--------|
| RFC-001 | [Title] | MUST/SHOULD/COULD | Low/Med/High | 1 | Pending |

Include:
- Dependency graph showing RFC relationships
- Note: Use `/prd/implement` for each RFC in order
- Status auto-updates to "Completed" after implementation

---

## Phase 6: User Approval & File Generation

### Present Plan for Approval
Before writing any files, present:
1. RFC list with titles and dependencies
2. Drift decisions (if existing RFCs)
3. Ask: **"Proceed with generating these RFCs?"**

### After Approval
Use `write` tool to create:
- `RFCs/RFC-001-[Title].md` through `RFC-00N-[Title].md`
- `RFCS.md` index

### Verification
Use `glob` with `RFCs/*.md` to confirm all files created.

---

## Error Handling

| Situation | Action |
|-----------|--------|
| Missing PRD | Prompt for correct path |
| Missing FEATURES/RULES | Proceed with available; note missing |
| RFCs folder missing | Create via `write` |
| Existing RFCs | Run drift detection (Phase 2) |
| Circular dependencies | Flag and propose resolution |
| Ambiguous requirements | List and ask for clarification |

---

## Completion Message

```
RFCs generated. Next steps:
1. `/prd/implement RFCs/RFC-001-[Title].md`
2. Implement strictly in order (001 → 002 → ...)
3. Status auto-updates to "Completed" after each RFC
```
