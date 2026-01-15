---
description: Generate a RULES.md file from PRD and features defining technical standards and guidelines
argument-hint: <path-to-prd> (e.g., docs/PRD.md)
---

# PRD to RULES.md Generator

<prd-path>
$ARGUMENTS
</prd-path>

<existing-prd>
!`ls PRD.md docs/PRD.md 2>/dev/null | grep . || echo "No PRD found at default locations"`</existing-prd>

<project-structure>
!`find . -maxdepth 4 -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.py" -o -name "*.go" -o -name "*.rs" \) 2>/dev/null | head -40`</project-structure>

<package-json>
!`test -f package.json && cat package.json | head -25 || echo "No package.json found"`</package-json>

<existing-rules>
!`ls RULES.md docs/RULES.md 2>/dev/null | grep . || echo "No existing RULES.md found"`</existing-rules>

<existing-docs>
!`ls docs/*.md *.md 2>/dev/null | head -15 || echo "No docs found"`</existing-docs>

## Role

Expert software architect creating RULES.md from PRD. Rules establish technical standards and guidelines for AI-assisted development, ensuring consistency and quality.

## Non-negotiables
- Do NOT write RULES.md until user explicitly approves the draft.
- If existing RULES.md found: classify changes and get approval before overwriting.
- If PRD conflicts with detected codebase conventions: surface conflict and ask.
- If <prd-path> is empty or ambiguous: ask for clarification.
- If critical information missing: ask specific questions before proceeding.

## Phase 1: Gather Context

### Step 1: Read Input Documents
Use `read` tool on these files **in a single parallel batch**:
- PRD file from <prd-path> (or <existing-prd> if unspecified)
- FEATURES.md, RULES.md if they exist (check <existing-docs>)
- Review <package-json> for tech stack

Note missing files and proceed with what's available.

### Step 2: Codebase Analysis (if existing code)
If <project-structure> shows source files, use `explore` agent:

**Explore Agent Prompt:**
```
Analyze this project's codebase to identify:
1. Current tech stack, frameworks, and library versions
2. Existing naming conventions (files, components, variables)
3. Folder structure patterns and organization
4. Testing frameworks and patterns in use
5. Code style patterns (formatting, imports, exports)
6. State management and data flow patterns

Return a structured summary of detected conventions to inform RULES.md creation.
```

### Step 3: External Reference (if unfamiliar stack)
If tech stack includes unfamiliar frameworks, use `librarian` agent:
```
Find best practices and conventions for [framework] projects.
Focus on: naming conventions, folder structure, testing patterns, common pitfalls.
```

---

## Phase 2: Drift Detection (if existing RULES.md)

**Skip this phase if no existing RULES.md.**

### Drift Assessment
Compare existing rules against current PRD and detected codebase conventions:

| Drift Level | Criteria | Action |
|-------------|----------|--------|
| **None/Low** | Rules still accurate, minor updates only | Keep as-is |
| **Medium** | Some sections outdated or incomplete | Propose targeted patches |
| **High** | Major mismatch with PRD or codebase reality | Propose regeneration |

### Classification Process
1. Extract key rules from existing RULES.md by category
2. Compare against: PRD requirements + detected codebase patterns
3. List specific mismatches (quote discrepancies)

### Approval Gate (MANDATORY)
Present drift classification to user:
```
## RULES.md Drift Assessment

### Keep (No/Low Drift)
- [Category]: [reason still accurate]

### Patch (Medium Drift)
- [Category]: [list specific changes needed]

### Regenerate (High Drift)
- [Category]: [list concrete mismatches]

**Proceed with patching/regenerating?** [Wait for approval]
```

**Do NOT modify RULES.md until user approves.**

---

## Tool Usage

Tools:
- `read` - PRD, FEATURES, existing RULES, config files
- `glob` - Discover files (e.g., `docs/*.md`)
- `write` - Create RULES.md
- `explore` agent - Codebase convention analysis
- `librarian` agent - External framework docs/best practices
- `oracle` agent - Validate rules draft before presenting to user

---

## Phase 3: Oracle Review Gate (MANDATORY)

Before presenting RULES.md draft to user, consult `oracle` agent:

**Oracle Prompt:**
```
Review this RULES.md draft for a [project type] project:

Tech Stack: [detected/specified stack]
Key Rules by Category:
- Technology: [summary]
- Code Style: [summary]
- Testing: [summary]
- Security: [summary]

Validate:
1. Are rules internally consistent?
2. Any contradictions with detected codebase patterns?
3. Missing critical areas (security, testing, accessibility, error handling)?
4. Are rules actionable and specific enough?
5. Any rules that are too restrictive or too vague?

Return: approval or specific issues to address.
```

**Only proceed to present draft to user after oracle approval.**

---

## Phase 4: Rules Generation

Generate RULES.md covering these categories:

| Category | Key Areas |
|----------|-----------|
| **Technology Stack** | Core tech + versions, required libraries/frameworks |
| **Code Style** | Naming conventions, folder structure, architectural patterns |
| **Data & State** | State management, API interactions, data handling |
| **Quality** | Testing requirements, coverage, error handling, logging |
| **Security** | Auth patterns, input validation, secrets handling |
| **Accessibility** | WCAG compliance level, responsive design requirements |
| **General** | Code quality expectations, no TODOs/placeholders, ambiguity handling |

### RULES.md Structure
```markdown
# Project Rules

## Technology Stack
[Specific versions and libraries]

## Code Style & Organization
[Naming, structure, patterns]

## Testing & Quality
[Coverage requirements, testing patterns]

## Security
[Auth, validation, secrets]

## Accessibility
[Standards to follow]

## General Guidelines
[Quality expectations, communication]
```

Rules must be **specific and actionable**, not vague. Include examples where helpful.

---

## Phase 5: User Approval

### Present Draft for Approval
Before writing any files, present:
1. Brief project overview
2. Key rules by category (summary)
3. If existing RULES.md: drift decisions
4. Ask: **"Proceed with generating RULES.md?"**

**Do NOT write files until user approves.**

---

## Error Handling

| Situation | Action |
|-----------|--------|
| Missing PRD | Prompt for correct path |
| Missing FEATURES.md | Proceed with PRD only; note limitation |
| Existing RULES.md | Run drift detection (Phase 2) |
| Tech stack unclear | Use `explore` agent to detect from code |
| Conflicting requirements | List contradictions, ask for resolution |
| No existing codebase | Base rules purely on PRD specs |

## Phase 6: Output & Verification

### Output Location
Use `glob` with `docs/*.md` to check if docs folder exists:
- If `docs/` folder exists → `docs/RULES.md`
- Otherwise → `RULES.md` (project root)

### After Approval
Use `write` tool to create RULES.md at determined location.

### Verification
Use `read` to verify file was created correctly.

---

## Completion Message

```
RULES.md generated at [location]. 

Key rules established:
- Technology: [brief summary]
- Code Style: [brief summary]
- Testing: [brief summary]

Next steps:
1. Review generated rules for project-specific adjustments
2. Use `/prd/to-rfcs` to create implementation RFCs
3. Reference RULES.md during all development work
```
