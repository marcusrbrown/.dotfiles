---
description: Convert a PRD into sequentially-ordered RFC documents
argument-hint: <path-to-prd> (e.g., docs/PRD.md)
---

# PRD to RFCs Converter

<prd-path>
$ARGUMENTS
</prd-path>

<project-structure>
!`find . -type f \( -name "*.md" -o -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" \) | grep -v node_modules | grep -v .git | grep -v dist | head -50`
</project-structure>

<existing-rfcs>
!`ls -la RFCs/ 2>/dev/null || ls -la docs/rfc 2>/dev/null || echo "No RFCs folder exists yet"`
</existing-rfcs>

<existing-docs>
!`ls -la docs/ 2>/dev/null || ls -la *.md 2>/dev/null | head -20 || echo "No docs folder found"`
</existing-docs>

## Role

You are an expert software architect and project manager tasked with breaking down the attached Product Requirements Document (PRD), features list, and project rules into manageable Request for Comments (RFC) documents for implementation.

Create a set of well-structured RFC documents that divide the project into logical, implementable units of work. Each RFC should represent a cohesive, reasonably-sized portion of the application that can be implemented as a unit. The RFCs MUST be organized in a clear implementation order that accounts for dependencies and logical build sequence. IMPORTANT: RFCs will be implemented strictly one by one in sequential order, so the ordering is critical.

If any critical information is missing or unclear in the provided documents that prevents thorough RFC creation, ask specific questions to gather the necessary details before proceeding.

## Pre-Analysis Phase

### Step 1: Read Input Documents
Use the `read` tool to analyze the following files (in parallel):
- The PRD file specified in <prd-path>
- If unspecified, look for FEATURES.md in the project (check <project-structure> or <existing-docs> for location)
- If unspecified, look for RULES.md in the project (check <project-structure> or <existing-docs> for location)

If any of these files don't exist, note which are missing and proceed with available documents.

### Step 2: Codebase Analysis (if existing code)
If <project-structure> shows existing source code, use the `explore` subagent to analyze the codebase:

**Explore Agent Prompt:**
```
Analyze this project's codebase to understand:
1. Current architecture and folder structure
2. Existing components, services, and utilities that can be reused
3. Technology stack and frameworks in use
4. Existing patterns for state management, API calls, and error handling
5. Any existing database schemas or data models

Focus on identifying reusable foundations for RFC planning. Return a structured summary of findings.
```

### Step 3: Verify Output Location
Use the `list` tool to check if the RFCs folder exists. If not, it will be created during file generation.

## Tool Usage

Throughout this command, use the following tools:
- `read` - To analyze PRD, FEATURES, RULES, and any referenced files
- `glob` - To discover existing files matching patterns (e.g., `RFCs/*.md`)
- `write` - To create new RFC files and RFCS.md index
- `list` - To verify folder structure before and after file creation
- `explore` subagent - For deep codebase analysis when existing code is present

## RFC Generation Process

Generate the RFC files under RFCs folder by:

1. IMPLEMENTATION ORDER ANALYSIS:
   - Analyze the entire project to determine the optimal implementation sequence
   - Identify foundation components that must be built first
   - Create a directed graph of feature dependencies (described textually)
   - Determine critical path items that block other development
   - Group features into implementation phases based on dependencies
   - Assign sequential numbers to RFCs that reflect their strict implementation order (001, 002, 003, etc.)
   - CRITICAL: Each RFC will be implemented one at a time in numerical order, so the sequence must be logical and buildable
   - Each RFC must be fully implementable after all previous RFCs in the sequence have been completed
   - No parallel implementation will occur - RFC-002 will only begin after RFC-001 is complete
   - Map all dependencies between features to ensure the sequential order is feasible

2. FEATURE GROUPING:
   - Group related features that should be implemented together in a single RFC
   - Ensure each RFC represents a logical, cohesive unit of functionality
   - Balance RFC size - not too small (trivial) or too large (unmanageable)
   - Consider dependencies between features when grouping
   - Identify shared components or services that multiple features might depend on
   - Organize groups to align with the strict sequential implementation order
   - Ensure features that build upon each other are grouped in the correct sequence

3. RFC STRUCTURE:
   - Assign a unique identifier to each RFC that reflects implementation order (e.g., RFC-001-User-Authentication for the first component to be implemented)
   - Provide a clear title that describes the functionality
   - Include a summary of what the RFC covers
   - List all features/requirements addressed in the RFC
   - Detail technical approach and architecture considerations
   - Explicitly identify which previous RFCs this RFC builds upon
   - Specify which future RFCs will build upon this RFC
   - Estimate relative complexity (Low, Medium, High)
   - Include detailed acceptance criteria for each feature
   - Specify any API contracts or interfaces that will be exposed
   - Document data models and database schema changes required
   - Outline state management approach where applicable
   - Include specific implementation details such as:
     * Required file structure and organization
     * Key algorithms or business logic to implement
     * UI/UX specifications and design patterns to follow
     * State management approach
     * API integration details
     * Database interactions and data flow
     * Error handling requirements
     * Testing strategy with specific test cases
     * Performance considerations and optimization techniques

4. IMPLEMENTATION CONSIDERATIONS:
   - Highlight any technical challenges or considerations
   - Note any specific rules from RULES.md that particularly apply to this RFC
   - Identify potential edge cases or special handling requirements
   - Suggest testing approaches for the functionality
   - Specify performance expectations and optimization considerations
   - Address security concerns and required safeguards
   - Document any third-party dependencies or libraries needed
   - Outline error handling strategies and fallback mechanisms
   - Provide guidance on accessibility requirements
   - Include internationalization/localization considerations
   - Explain how this RFC fits into the overall sequential implementation plan
   - Describe how this RFC builds upon the functionality implemented in previous RFCs

5. RFCS.MD CREATION:
   - Create a master RFCS.md file that lists all RFCs in their strict numerical implementation order
   - Include an RFC Summary Table with the following columns:
     * RFC ID (e.g., RFC-001, RFC-002)
     * Title (brief, descriptive name)
     * Priority (MUST, SHOULD, COULD)
     * Complexity (Low, Medium, High)
     * Phase (implementation phase number)
     * Status (Pending - all RFCs start as Pending, will be updated to Completed by /prd/implement command)
   - Example table format:
     ```markdown
     ## RFC Summary Table

     | RFC ID  | Title                          | Priority | Complexity | Phase | Status  |
     | ------- | ------------------------------ | -------- | ---------- | ----- | ------- |
     | RFC-001 | IndexedDB Storage Foundation   | MUST     | High       | 1     | Pending |
     | RFC-002 | Security Infrastructure        | MUST     | High       | 1     | Pending |
     | RFC-003 | Provider Abstraction Layer     | MUST     | Medium     | 1     | Pending |
     ```
   - Below the table, include a dependency graph or section showing relationships between RFCs
   - Provide a clear, sequential implementation roadmap grouped by phases
   - For each RFC, indicate which previous RFCs it builds upon
   - For each RFC, indicate which future RFCs will build upon it
   - Make it clear that:
     * Implementation will proceed strictly in the numbered sequence
     * Each RFC should be implemented using the `/prd/implement` command
     * The Status column will be automatically updated to "Completed" after successful implementation

6. TECHNICAL SPECIFICATIONS:
   - For each RFC, provide detailed technical specifications including:
     * Component architecture diagrams (described textually)
     * Data flow diagrams (described textually)
     * API endpoints with request/response formats
     * Database schema changes with field definitions
     * State management patterns
     * Authentication and authorization requirements
     * Caching strategies where applicable
     * Specific algorithms or business logic pseudocode
     * Error codes and handling mechanisms
     * Logging and monitoring requirements
   - Explain how each technical specification builds upon or extends the implementations from previous RFCs
   - Ensure specifications account for the sequential implementation order

7. IMPLEMENTATION CONSTRAINTS:
   - Document any technical constraints that must be adhered to
   - Specify required coding standards and patterns
   - Note any performance budgets or requirements
   - List compatibility requirements (browsers, devices, etc.)
   - Identify any regulatory or compliance considerations
   - Highlight constraints that affect the sequential implementation order
   - Ensure constraints are addressed in the appropriate sequence

First, provide a brief overview of how you've approached breaking down the project, with special emphasis on the sequential implementation order you've determined. Then create the comprehensive set of RFC documents following the structure above, organizing them in strict numerical implementation order.

Ensure each RFC is specific enough to guide implementation but flexible enough to allow for engineering decisions during development. Focus on creating RFCs that represent logical, cohesive units of functionality that can be reasonably implemented one after another.

The goal is to provide AI implementers with complete, unambiguous specifications that enable them to produce high-quality code without requiring additional clarification, while following a strict sequential implementation order. Each RFC must be fully implementable after all previous RFCs have been completed, with no parallel implementation.

## Implementation Workflow

After generating the RFCs, inform the user:

```
RFCs have been successfully generated. To implement each RFC:

1. Use the /prd/implement command with the RFC file path:
   /prd/implement RFCs/RFC-001-[Title].md

2. The implementation command will:
   - Validate prerequisites (check previous RFCs are completed)
   - Support resuming partial implementations
   - Follow a two-phase approach (planning → approval → execution)
   - Run project-adaptive validation (tests, build, lint)
   - Update RFCS.md status to "Completed" after verification

3. Implement RFCs strictly in numerical order (001, 002, 003, etc.)
```

## Error Handling & Edge Cases

Handle these situations appropriately:

1. **Missing PRD file**: If the file in <prd-path> doesn't exist, prompt the user for the correct path
2. **Missing FEATURES.md or RULES.md**: Proceed with available documents; note which are missing in the output
3. **RFCs folder doesn't exist**: Create it using `write` tool when generating the first RFC
4. **Existing RFCs found**: Check <existing-rfcs> - if RFCs already exist, ask user whether to:
   - Overwrite existing RFCs
   - Append new RFCs with incremented numbers
   - Cancel and review existing RFCs first
5. **Circular dependencies detected**: If features have circular dependencies, flag this explicitly and propose a resolution before proceeding
6. **Ambiguous requirements**: If PRD contains ambiguous or contradictory requirements, list them and ask for clarification before generating RFCs

## Output Verification

After generating all files, use the `glob` tool with pattern `RFCs/*.md` to verify:
- All planned RFC files were created
- RFCS.md master index exists

Report a summary of created files to the user, including:
- Number of RFCs created
- Implementation phases identified
- Location of files
- Next steps (use /prd/implement to begin implementation)
