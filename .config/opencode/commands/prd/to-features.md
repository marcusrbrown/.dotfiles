---
description: Extract and organize features from PRD into prioritized FEATURES.md with MoSCoW classification
argument-hint: <path-to-prd> (e.g., PRD.md or docs/PRD.md)
---

# PRD to Features Extractor

<prd-path>
$ARGUMENTS
</prd-path>

<existing-prd>
!`ls PRD.md docs/PRD.md 2>/dev/null | grep . || echo "No PRD found at default locations"`</existing-prd>

<existing-features>
!`ls FEATURES.md docs/FEATURES.md 2>/dev/null | grep . || echo "No existing FEATURES.md found"`</existing-features>

<project-docs>
!`(find docs -maxdepth 1 -type f -name '*.md' 2>/dev/null || ls *.md 2>/dev/null) | sort | head -20 |  awk 'NR { print; found=1 } END { if (!found) print "No docs found" }'`</project-docs>

## Role

You are an expert product manager and technical lead tasked with extracting and organizing features from the Product Requirements Document (PRD).

## Pre-Extraction Phase

Before extracting features, gather context:

1. Use the `read` tool to load the PRD file:
   - If <prd-path> contains a path, read that file
   - Otherwise, check <existing-prd> for content
   - If neither has content, prompt user for the correct path

2. Check <existing-features> - if features already exist, ask whether to:
   - Replace entirely
   - Merge with new features
   - Create with different filename

3. Review <project-docs> for related files (RULES.md, RFCs) that provide context

## Tool Usage

Throughout this command, use the following tools:
- `read` - To load the PRD and any related documentation
- `glob` - To discover related docs and check for existing FEATURES.md
- `write` - To save the FEATURES.md file
- `explore` subagent - For technical complexity validation (if codebase exists)
- `librarian` agent - To reference library documentation or external resources if needed

## Task

Create a comprehensive FEATURES.md file that clearly outlines all features described in the PRD, organized by priority and category. This features list will be used by the development team for implementation planning.

If any critical information is missing or unclear in the PRD that prevents a thorough feature extraction, ask specific questions to gather the necessary details before proceeding.

## Feature Extraction Process

Extract and organize the features by:

1. FEATURE IDENTIFICATION:
   - Extract all explicit and implicit features mentioned in the PRD
   - Ensure each feature is discrete, specific, and implementable
   - Assign a unique identifier to each feature (e.g., F1, F2, F3)

2. FEATURE CATEGORIZATION:
   - Group features by logical categories (e.g., User Authentication, Dashboard, Reporting)
   - Identify core features vs. enhancements or nice-to-haves
   - Tag features by user type/persona where applicable

3. PRIORITIZATION:
   - Apply MoSCoW prioritization to each feature:
     * Must have: Critical for the minimum viable product
     * Should have: Important but not critical for initial release
     * Could have: Desirable but can be deferred
     * Won't have: Out of scope for the current release but noted for future
   - Consider dependencies between features when prioritizing

4. FEATURE DETAILING:
   - Provide a clear, concise description for each feature
   - Include acceptance criteria for each feature
   - Note any technical considerations or constraints
   - Identify potential edge cases or special handling requirements

5. IMPLEMENTATION COMPLEXITY:
   - Estimate relative complexity for each feature (Low, Medium, High)
   - Identify features that may require third-party integrations or special expertise
   - Note any features that might present significant technical challenges

6. FEATURES.MD CREATION:
   - Format the features list in clean, well-structured markdown
   - Include a table of contents with links to each category
   - Add a summary section with feature counts by priority and category
   - Ensure the document is easy to navigate and reference

First, provide a brief overview of the product based on the PRD. Then create the comprehensive features.md content following the structure above.

Be specific and clear in your feature descriptions to ensure they can be understood by both technical and non-technical stakeholders.

## Output

Save the FEATURES.md using the `write` tool:
- If PRD was at `docs/PRD.md` → save as `docs/FEATURES.md`
- If PRD was at root → save as `FEATURES.md`
- Use `read` to verify the file was created correctly

After saving, suggest next steps:
- "Run `/prd/to-rules` to generate technical guidelines"
- "Run `/prd/to-rfcs` to break down features into implementation RFCs"

## Error Handling

- If PRD not found in <prd-path>: check <existing-prd>, prompt for correct path
- If PRD is too vague for feature extraction: suggest `/prd/review` to improve it first
- If <existing-features> shows existing FEATURES.md: ask to overwrite, merge, or rename
- If `write` fails: output FEATURES.md content directly in chat
- If PRD lacks clear user stories or requirements: extract what's possible, flag gaps explicitly
