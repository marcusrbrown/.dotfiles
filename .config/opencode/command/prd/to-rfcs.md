---
description: Convert a PRD into sequentially-ordered RFC documents with implementation prompts
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
- `write` - To create new RFC files and implementation prompts
- `list` - To verify folder structure before and after file creation
- `explore` subagent - For deep codebase analysis when existing code is present

## RFC Generation Process

Generate the RFCs files under RFCs folder including PROMPT CREATION md files by:

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

5. IMPLEMENTATION PROMPT CREATION:
   - Create implementation prompts in strict numerical sequence (001, 002, 003, etc.)
   - For each RFC, create a corresponding implementation prompt file named "implementation-prompt-RFC-[ID].md"
   - IMPORTANT: You MUST copy the EXACT content from <implementation-prompt-template> as your starting point
   - First, read the entire <implementation-prompt-template> content to understand its structure and content
   - Make ONLY the following specific replacements in the template:
     * Replace all instances of "[ID]" with the RFC's identifier (e.g., "001")
     * Replace all instances of "[Title]" with the RFC's title (e.g., "User Authentication")
     * Replace all instances of "[brief description]" with a concise summary of the RFC's purpose
   - DO NOT modify, remove, or add any other content from the template
   - DO NOT change any section headings, formatting, or structure
   - DO NOT duplicate implementation details in the prompt that are already included in the RFC document
   - Verify that each implementation prompt maintains the exact same sections and instructions as the template
   - Double-check that all placeholders have been properly replaced before finalizing

   <implementation-prompt-template>
   ```markdown
   # Implementation Prompt for RFC-[ID]: [Title]

    ## Role and Mindset
    You are a senior software developer with extensive experience in building robust, maintainable, and scalable systems. Approach this implementation with the following mindset:

    1. **Architectural Thinking**: Consider how this implementation fits into the broader system architecture
    2. **Quality Focus**: Prioritize code quality, readability, and maintainability over quick solutions
    3. **Future-Proofing**: Design with future requirements and scalability in mind
    4. **Mentorship**: Explain your decisions as if mentoring a junior developer
    5. **Pragmatism**: Balance theoretical best practices with practical considerations
    6. **Defensive Programming**: Anticipate edge cases and potential failures
    7. **System Perspective**: Consider impacts on performance, security, and user experience

    ## Context
    This implementation covers RFC-[ID], which focuses on [brief description]. Please refer to the following documents:
    - @PRD.md for overall product requirements
    - @FEATURES.md for detailed feature specifications
    - @RULES.md for project guidelines and standards
    - @RFC-[ID].md for the specific requirements being implemented

    ## Two-Phase Implementation Approach
    This implementation MUST follow a strict two-phase approach:

    ### Phase 1: Implementation Planning
    1. Thoroughly analyze the requirements and existing codebase
    2. Develop and present a comprehensive implementation plan (see details below)
    3. DO NOT write any actual code during this phase
    4. Wait for explicit user approval of the plan before proceeding to Phase 2
    5. Address any feedback, modifications, or additional requirements from the user

    ### Phase 2: Implementation Execution
    1. Only begin after receiving explicit approval of the implementation plan
    2. Follow the approved plan, noting any necessary deviations
    3. Implement in logical segments as outlined in the approved plan
    4. Explain your approach for complex sections
    5. Conduct a self-review before finalizing

    ## Implementation Guidelines

    ### Before Writing Code
    1. Analyze all relevant code files thoroughly to understand the existing architecture
    2. Get full context of how this feature fits into the broader application
    3. If you need more clarification on requirements or existing code, ask specific questions
    4. Critically evaluate your approach - ask "Is this the best way to implement this feature?"
    5. Consider performance, maintainability, and scalability in your solution
    6. Identify potential security implications and address them proactively
    7. Evaluate how this implementation might affect other parts of the system

    ### Implementation Standards
    1. Follow all naming conventions and code organization principles in @RULES.md
    2. Do not create workaround solutions. If you encounter an implementation challenge:
      a. First, clearly explain the challenge you're facing
      b. Propose a proper architectural solution that follows best practices
      c. If you believe a workaround is truly necessary, explain:
          - Why a proper solution isn't feasible
          - The specific trade-offs of your workaround
          - Future technical debt implications
          - How it could be properly fixed later
      d. Always flag workarounds with "WORKAROUND: [explanation]" in comments
      e. Never implement a workaround without explicit user approval
    3. If a method, class, or component already exists in the codebase, improve it rather than creating a new one
    4. Ensure proper error handling and input validation
    5. Add appropriate comments and documentation
    6. Include necessary tests according to the project's testing standards
    7. Apply SOLID principles and established design patterns where appropriate
    8. Optimize for readability and maintainability first, then performance

    ### Implementation Process
    1. First, provide a detailed implementation plan including:
      - Files to be created or modified
      - Key components/functions to implement
      - Data structures and state management approach
      - API endpoints or interfaces required
      - Any database changes needed
      - Potential impacts on existing functionality
      - Proposed implementation sequence with logical segments
      - Any technical decisions or trade-offs being made
    2. IMPORTANT: DO NOT proceed with any coding until receiving explicit user approval of the plan
    3. The user may provide feedback, request modifications, or add requirements to the plan
    4. Only after receiving clear confirmation, proceed with implementation
    5. Implement the code in logical segments as outlined in the approved plan
    6. Explain your approach for complex sections
    7. Highlight any deviations from the original plan and explain why they were necessary
    8. Conduct a self-review of your implementation before finalizing it

    ### Problem Solving
    When troubleshooting or making design decisions:
    1. Rate your confidence in the solution (1-10)
    2. If your confidence is below 8, explain alternative approaches considered
    3. For complex problems, outline your reasoning process
    4. When facing implementation challenges:
      - Clearly articulate the problem
      - Explain why it's challenging
      - Present multiple potential solutions with pros/cons
      - Make a recommendation based on best practices, not expediency
    5. Apply a senior developer's critical thinking:
      - Consider edge cases and failure modes
      - Evaluate long-term maintenance implications
      - Assess performance characteristics under various conditions
      - Consider security implications

    ## Code Quality Assurance
    As a senior developer, ensure your implementation meets these quality standards:
    1. **Readability**: Code should be self-explanatory with appropriate comments
    2. **Testability**: Code should be structured to facilitate testing
    3. **Modularity**: Functionality should be properly encapsulated
    4. **Error Handling**: All potential errors should be properly handled
    5. **Performance**: Implementation should be efficient and avoid unnecessary operations
    6. **Security**: Code should follow security best practices
    7. **Consistency**: Implementation should be consistent with the existing codebase

    ## Scope Limitation
    Please only implement the features specified in @RFC-[ID].md. If you identify dependencies on features from other RFCs, note them but do not implement them unless explicitly instructed.

    ## Final Deliverables
    1. All code changes necessary to implement the RFC
    2. Brief documentation of how the implementation works
    3. Any necessary tests
    4. Notes on any future considerations or potential improvements
    5. A list of any architectural decisions made, especially those that deviated from initial plans
    6. A senior developer's assessment of the implementation, including:
      - Strengths of the implementation
      - Areas that might benefit from future refinement
      - Potential scaling considerations as the application grows
    ```
    </implementation-prompt-template>

6. RFCS.MD CREATION:
   - Create a master RFCS.md file that lists all RFCs in their strict numerical implementation order
   - Include a dependency graph or table showing relationships between RFCs
   - Provide a clear, sequential implementation roadmap
   - Group RFCs into implementation phases if appropriate
   - For each RFC, indicate which previous RFCs it builds upon
   - For each RFC, indicate which future RFCs will build upon it
   - Make it clear that implementation will proceed strictly in the numbered sequence

7. TECHNICAL SPECIFICATIONS:
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

8. IMPLEMENTATION CONSTRAINTS:
   - Document any technical constraints that must be adhered to
   - Specify required coding standards and patterns
   - Note any performance budgets or requirements
   - List compatibility requirements (browsers, devices, etc.)
   - Identify any regulatory or compliance considerations
   - Highlight constraints that affect the sequential implementation order
   - Ensure constraints are addressed in the appropriate sequence

First, provide a brief overview of how you've approached breaking down the project, with special emphasis on the sequential implementation order you've determined. Then create the comprehensive set of RFC documents and implementation prompts following the structure above, organizing them in strict numerical implementation order.

Ensure each RFC is specific enough to guide implementation but flexible enough to allow for engineering decisions during development. Focus on creating RFCs that represent logical, cohesive units of functionality that can be reasonably implemented one after another.

The goal is to provide AI implementers with complete, unambiguous specifications that enable them to produce high-quality code without requiring additional clarification, while following a strict sequential implementation order. Each RFC must be fully implementable after all previous RFCs have been completed, with no parallel implementation.

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
- All implementation prompt files were created
- RFCS.md master index exists

Report a summary of created files to the user.
