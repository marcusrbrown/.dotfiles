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
!`cat FEATURES.md 2>/dev/null || cat docs/FEATURES.md 2>/dev/null || echo "No FEATURES.md found"`</existing-features>

<existing-rfcs>
!`ls RFCs/RFC-*.md docs/rfc/RFC-*.md docs/rfcs/RFC-*.md 2>&1 | grep -E "^RFCs/|^docs/" | head -20 || echo "No RFC files found"`</existing-rfcs>

<git-status>
!`git status --porcelain | head -20 | awk 'NR { print; found=1 } END { if (!found) print "No uncommitted changes" }'`</git-status>

<recent-commits>
!`git log --oneline -10 2>&1 | grep -v "not a git repository" | grep -v "does not have any commits" | grep -q . && git log --oneline -10 || echo "No git history available"`</recent-commits>

## Role

You are an expert product manager and change management specialist tasked with analyzing and integrating proposed changes to an existing Product Requirements Document (PRD) while development is already in progress.

## Pre-Analysis Phase

Before analyzing changes, gather context:

1. Use the `read` tool to load the full PRD from <existing-prd>
2. Use `glob` to discover all RFC files in <existing-rfcs>
3. Review <existing-features> for current feature scope
4. Analyze <git-status> and <recent-commits> for development progress
5. Parse <change-request> to understand proposed modifications

### Development Status Assessment

Ask the explore agent to understand current implementation state:

**Prompt:** "Analyze the codebase to determine:
1. Which features from FEATURES.md are already implemented
2. Which RFCs have been completed vs in-progress
3. Current test coverage and passing status
4. Recent git activity related to PRD features
Return a structured implementation status report."

## Tool Usage

Throughout this command, use the following tools:
- `read` - To load PRD.md, FEATURES.md, and relevant RFCs
- `glob` - To discover all RFC files and related docs
- `explore` agent - To assess current implementation status
- `edit` - To update PRD.md with changes (prefer edit over full rewrite)
- `write` - To create CHANGELOG.md entry documenting updates

## Task

Analyze the existing PRD, the current development status, and the proposed changes in <change-request> to determine the optimal way to incorporate these changes with minimal disruption to the ongoing development process.

If any critical information is missing that prevents a thorough change impact analysis, ask specific questions to gather the necessary details before proceeding.

## Change Analysis Process

Assess and integrate the proposed changes by:

1. CHANGE CLASSIFICATION:
   - Categorize each proposed change as:
     * New Feature: Entirely new functionality not in the original PRD
     * Feature Modification: Changes to existing planned features
     * Feature Removal: Removing previously planned features
     * Scope Change: Fundamental changes to project scope or objectives
     * Technical Change: Changes to technical approach or architecture
     * Timeline Change: Changes to delivery schedule or milestones
   - Assess the size of each change (Small, Medium, Large)
   - Determine if each change is a "must-have" or "nice-to-have"

2. IMPACT ANALYSIS:
   - Identify all components, features, and RFCs affected by each change
   - Assess impact on project timeline and resources
   - Evaluate technical dependencies and potential ripple effects
   - Determine impact on already completed or in-progress work
   - Identify any testing or validation implications
   - Assess impact on user experience and product coherence

3. IMPLEMENTATION STRATEGY:
   - Recommend whether each change should be:
     * Implemented immediately (integrated into current sprint)
     * Scheduled for a future sprint
     * Implemented as a separate phase or release
     * Deferred to a future version
   - Suggest refactoring needs for already implemented components
   - Identify parallel work streams that could minimize disruption
   - Propose testing strategy for validating changes

4. RISK ASSESSMENT:
   - Identify risks introduced by implementing the changes mid-development
   - Suggest mitigation strategies for each identified risk
   - Assess potential impact on product quality and technical debt
   - Evaluate business risks of not implementing the changes

5. DOCUMENTATION UPDATES:
   - Provide updated PRD sections incorporating the changes
   - Highlight all modifications to the original PRD
   - Update affected user stories and acceptance criteria
   - Revise any impacted technical specifications
   - Update timeline and milestone documentation

First, provide a summary of your overall assessment of the proposed changes and their impact. Then provide detailed analysis following the structure above. Finally, deliver a clear recommendation on how to proceed with each change.

Be specific in your recommendations and provide concrete steps for implementing the changes while minimizing disruption to ongoing development.

## Version Tracking

When updating the PRD:
- Increment version number (e.g., PRD v1.0 → v1.1)
- Add version history section if not present
- Document date, author, and summary of changes for each version

## Output

1. Display change impact summary in chat first
2. Use `edit` to update PRD.md with approved changes
3. Use `write` to create/append to `CHANGELOG.md` documenting the update (if necessary)
4. If RFCs need updates, use `edit` on affected RFC files

After updates, suggest next steps:
- "Run `/prd/to-features` to regenerate FEATURES.md if features changed"
- "Run `/prd/to-rfcs` if new RFCs are needed for added features"
- "Run `/prd/review` to validate the updated PRD"

## Error Handling

- If PRD not found in <existing-prd>: prompt user for correct path
- If no RFCs exist in <existing-rfcs>: note that impact analysis will be limited to PRD scope
- If <change-request> is vague: ask clarifying questions before analysis
- If proposed changes conflict with each other: flag conflicts before proceeding
- If `edit` fails: use `write` to create updated PRD as `PRD-updated.md`
- If changes would break already-implemented features: highlight with ⚠️ warning

## Tone Guidelines

Be direct about risks and impacts—stakeholders need honest assessments. Be constructive about solutions—every problem should come with options. Prioritize clarity over diplomacy when development timeline is at stake.
