---
description: Generate a RULES.md file from PRD and features defining technical standards and guidelines
argument-hint: <path-to-prd> (e.g., docs/PRD.md)
---

# PRD to RULES.md Generator

<prd-path>
$ARGUMENTS
</prd-path>

<project-structure>
!`find . -type f \( -name "*.json" -o -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.yaml" -o -name "*.md" -o -name "*.py" -o -name "*.go" -o -name "*.rs" -o -name "*.java" -o -name "*.cpp" -o -name "*.c" -o -name "*.h" \) 2>/dev/null | grep -v node_modules | grep -v __pycache__ | grep -v .git | grep -v dist | grep -v build | grep -v target | grep -v .next | grep -v storybook-static | head -50`
</project-structure>

<package-json>
!`cat package.json 2>/dev/null || echo "No package.json found"`
</package-json>

<existing-rules>
!`cat RULES.md 2>/dev/null || cat docs/RULES.md 2>/dev/null || cat .cursor/rules/RULES.md 2>/dev/null || echo "No existing RULES.md found"`
</existing-rules>

<existing-docs>
!`ls -la docs/ 2>/dev/null || ls -la *.md 2>/dev/null | head -10 || echo "No docs found"`
</existing-docs>

## Role

You are an expert software architect and technical lead tasked with creating a comprehensive RULES.md file based on the Product Requirements Document (PRD) and features list.

Create a clear, structured RULES.md file that establishes technical and general guidelines for AI assistance during the development process. These rules will ensure consistency, quality, and alignment with project requirements.

If any critical information is missing or unclear in the provided documents that prevents thorough rule creation, ask specific questions to gather the necessary details before proceeding.

## Pre-Analysis Phase

### Step 1: Read Input Documents
Use the `read` tool to analyze the following files (in parallel):
- The PRD file specified in <prd-path>
- Look for FEATURES.md in the project (check <existing-docs> for location)
- Review <package-json> for existing tech stack information

### Step 2: Check Existing Rules
Review <existing-rules> output. If existing rules are found:
- Ask user whether to replace entirely, merge, or append
- Note any existing conventions that should be preserved

### Step 3: Codebase Analysis (if existing code)
If <project-structure> shows existing source code, use the `explore` subagent to detect conventions:

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

## Tool Usage

Throughout this command, use the following tools:
- `read` - To analyze PRD, FEATURES.md, and config files
- `glob` - To discover existing files and detect patterns
- `write` - To create the RULES.md file
- `list` - To verify folder structure
- `explore` subagent - For deep codebase convention analysis

## Rules Generation Process

Generate the RULES.md by:

1. TECHNOLOGY STACK DEFINITION:
   - Identify the core technologies mentioned or implied in the PRD/features
   - Specify the latest stable versions to use for each technology
   - Define any specific libraries, frameworks, or tools required

2. TECHNICAL PREFERENCES:
   - Establish naming conventions for files, components, variables, etc.
   - Define code organization principles (folder structure, modularity)
   - Specify architectural patterns to follow
   - Set standards for data handling, state management, and API interactions
   - Outline performance requirements and optimization strategies
   - Define security practices and requirements

3. DEVELOPMENT STANDARDS:
   - Establish testing requirements and coverage expectations
   - Define documentation standards
   - Specify error handling and logging requirements
   - Set accessibility standards to follow
   - Define responsive design requirements

4. IMPLEMENTATION PRIORITIES:
   - Clarify which features are core vs. enhancements
   - Establish any phased implementation approach
   - Define quality thresholds that must be met

5. GENERAL GUIDELINES:
   - Establish rules for following requirements precisely
   - Define expectations for code quality, readability, and maintainability
   - Set standards for completeness (no TODOs or placeholders)
   - Establish communication guidelines for questions or clarifications
   - Define how to handle uncertainty or ambiguity

6. RULES.MD CREATION:
   - Format the rules in clean, well-structured markdown
   - Organize rules logically with clear headings
   - Ensure rules are specific, actionable, and unambiguous
   - Include examples where helpful for clarity

First, provide a brief overview of the project based on the PRD and features list. Then create the comprehensive RULES.md content following the structure above.

Ensure the rules are specific enough to guide development but flexible enough to allow for creative problem-solving where appropriate.

## Error Handling & Edge Cases

Handle these situations appropriately:

1. **Missing PRD file**: If the file in <prd-path> doesn't exist, prompt the user for the correct path
2. **Missing FEATURES.md**: Proceed with PRD only; note that feature-specific rules may be incomplete
3. **Existing RULES.md found**: Check <existing-rules> - ask user whether to:
   - Replace entirely with new rules
   - Merge new rules with existing ones
   - Cancel and review existing rules first
4. **Tech stack unclear**: Use <package-json> and `explore` agent to detect from existing code
5. **Conflicting requirements**: If PRD contains contradictions, list them and ask for resolution
6. **No existing codebase**: If <project-structure> shows no source files, base rules purely on PRD specifications

## Output

Use the `write` tool to create the RULES.md file. Choose location based on project structure:
- `RULES.md` (project root) - default
- `docs/RULES.md` - if docs folder exists
- `.cursor/rules/RULES.md` - if .cursor folder exists (for Cursor IDE)

After writing, use `read` to verify the file was created correctly and report success to user.
