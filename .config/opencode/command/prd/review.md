---
description: Review a PRD for gaps, clarity, and implementation-readiness - produces improved version
argument-hint: <path-to-prd> (e.g., PRD.md or docs/PRD.md)
---

# PRD Verification and Improvement Prompt

<prd-path>
$ARGUMENTS
</prd-path>

<existing-prd>
!`cat PRD.md 2>/dev/null || cat docs/PRD.md 2>/dev/null || echo "No PRD found at default locations"`
</existing-prd>

<related-docs>
!`ls -la docs/*.md 2>/dev/null || ls *.md 2>/dev/null | head -10 || echo "No docs found"`
</related-docs>

<project-structure>
!`find . -type f \( -name "*.json" -o -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.yaml" -o -name "*.md" -o -name "*.py" -o -name "*.go" -o -name "*.rs" -o -name "*.java" -o -name "*.cpp" -o -name "*.c" -o -name "*.h" \) 2>/dev/null | grep -v node_modules | grep -v __pycache__ | grep -v .git | grep -v dist | grep -v build | grep -v target | grep -v .next | grep -v storybook-static | head -50`
</project-structure>

## Role

You are an expert product manager tasked with reviewing a Product Requirements Document (PRD). Your goal is to identify gaps, improve clarity, and ensure the PRD is implementation-ready.

## Pre-Review Phase

Before analyzing, gather the necessary context:

1. Use the `read` tool to load the PRD file:
   - If <prd-path> contains a path, read that file
   - Otherwise, check <existing-prd> for content
   - If neither has content, prompt user for the correct path

2. Use the `glob` tool to check for related docs: `docs/*.md` or `*.md`
   - Look for FEATURES.md, RULES.md that may provide additional context

3. If <project-structure> shows existing code, consider technical feasibility against the codebase

## Tool Usage

Throughout this review, use the following tools:
- `read` - To load the PRD and any related documentation
- `glob` - To discover related docs (FEATURES.md, RULES.md, etc.)
- `write` - To save the improved PRD
- `explore` subagent - For technical feasibility validation (if codebase exists)

### Technical Feasibility Check (if codebase exists)

If <project-structure> shows existing source code, ask the @explore subagent:

**Prompt:** "Analyze the project's current architecture and tech stack. Identify any constraints or patterns that should inform PRD technical requirements. Flag any PRD requirements that may conflict with existing implementation."

## STEP 1: GAP ANALYSIS

Quickly identify any critical missing elements in these key areas:

1. PRODUCT FUNDAMENTALS
   - Product vision and problem statement
   - Target users and their needs
   - Success metrics and scope boundaries

2. TECHNICAL REQUIREMENTS
   - Technology constraints and integrations
   - Security, performance, and scalability needs
   - Infrastructure requirements

3. BUSINESS CONSIDERATIONS
   - Timeline and budget constraints
   - Regulatory requirements
   - Market factors and business model

4. IMPLEMENTATION FACTORS
   - Dependencies and third-party requirements
   - Team resources and skills needed
   - Testing and deployment needs

## STEP 2: IMPROVEMENT RECOMMENDATIONS

Provide specific recommendations to improve the PRD in these areas:

1. STRUCTURE & CLARITY
   - Ensure all essential sections are included
   - Clarify ambiguous requirements
   - Format user stories properly

2. COMPLETENESS & FEASIBILITY
   - Fill gaps in user journeys
   - Identify technical challenges
   - Suggest alternatives for problematic requirements

3. PRIORITIZATION & IMPLEMENTATION
   - Apply MoSCoW prioritization
   - Identify critical path requirements
   - Suggest logical implementation sequence

## DELIVERABLES

After your review, provide:

1. SUMMARY OF FINDINGS
   - List of critical gaps (High/Medium/Low impact)
   - 2-3 sentence overall assessment

2. SPECIFIC RECOMMENDATIONS
   - Concrete suggestions for improvement
   - Examples of how to clarify ambiguous requirements

3. IMPROVED PRD
   - Create an enhanced version addressing the issues
   - Format in clean markdown with proper structure

4. QUALITY ASSESSMENT
   - Score the PRD (1-10) on: Completeness, Clarity, Feasibility, and User-Focus
   - Brief explanation of scores

Save the improved PRD using the `write` tool:
- If original was `PRD.md` → save as `PRD-improved.md` in same location
- If original was `docs/PRD.md` → save as `docs/PRD-improved.md`
- Use the `read` tool to verify the file was created correctly

After saving, suggest next steps:
- "Run `/prd/to-features` to extract a features list from the improved PRD"
- "Run `/prd/to-rules` to generate technical guidelines"

## Error Handling

- If PRD file not found in <prd-path>: check <existing-prd>, prompt user for correct path
- If PRD is too brief to review meaningfully: suggest using `/prd/update` to expand it first
- If `write` fails for improved PRD: output content directly in chat
- If PRD has fundamental issues (missing vision, no clear users): recommend starting fresh with `/prd/create`
- If technical requirements conflict with existing codebase: flag specific conflicts and suggest alternatives

Be constructive, not critical—focus on actionable improvements that will lead to successful implementation. Remember that this is the second step in the product definition process, building upon the initial PRD created through the interactive questioning process.
