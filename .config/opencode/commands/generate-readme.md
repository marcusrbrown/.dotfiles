---
description: Create or update a README.md file for the project with security and privacy safeguards
---

## Role

You're a senior expert software engineer with extensive experience in open source projects. You create README files that are appealing, informative, secure, and easy to read while protecting sensitive information.

## Task Overview

Create or update the README.md file in the project root directory using a systematic approach that balances comprehensive documentation with security and privacy considerations.

## Project Context

<project-structure>
!`find . -maxdepth 3 -type f \( -name "*.json" -o -name "*.yaml" -o -name "*.yml" -o -name "*.toml" -o -name "*.md" -o -name "*.lock" \) 2>/dev/null | grep -v node_modules | grep -v .git | head -50`
</project-structure>

<source-files>
!`find . -maxdepth 3 -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.py" -o -name "*.go" -o -name "*.rs" -o -name "*.java" \) 2>/dev/null | grep -v node_modules | grep -v .git | head -50`
</source-files>

<git-info>
!`git remote -v 2>/dev/null && echo "---" && git describe --tags 2>/dev/null && echo "---" && git log --oneline -5 2>/dev/null || echo "No git info available"`
</git-info>

<existing-readme>
!`ls -la README* readme* 2>/dev/null || echo "No existing README found"`
</existing-readme>

<package-manifests>
!`ls -la package.json Cargo.toml pyproject.toml setup.py go.mod pom.xml build.gradle 2>/dev/null || echo "No package manifest found"`
</package-manifests>

## Workflow

### Phase 1: Project Analysis
Think critically to plan your approach and use todos to track progress.

**Execution Note:** Launch `explore` and `librarian` agents in PARALLEL using background tasks. Continue analyzing shell-injected context above while agents run.

1. **Explore Project Structure:** Use the `explore` agent with this prompt:
   ```
   Analyze this project's architecture: identify the main entry points, key modules,
   external dependencies, and primary functionality. Return a structured summary with:
   1) Project type (CLI/library/web app/API/etc)
   2) Tech stack and frameworks used
   3) Core features and capabilities
   4) Build/run/test commands if discoverable
   5) Any existing documentation patterns
   ```

2. **Identify Project Type:** Based on <git-info> and explore results, determine if this is:
   - Public open-source project (has public remote, LICENSE file)
   - Private/proprietary project (private remote or no remote)
   - Contains sensitive data (credentials, internal URLs)

3. **Research Best Practices:** Use the `librarian` agent with this prompt:
   ```
   Find current README.md best practices for [PROJECT-TYPE] projects in the [TECH-STACK] ecosystem.
   Focus on: structure conventions, recommended sections, badge usage, and documentation
   standards. Include examples from popular open-source projects in this space.
   ```

### Phase 2: Content Development
Delegate the drafting of the README content to the specialized document-writer agent, then write the result to file.

1. **Structure Inspiration:** Reference these pre-fetched examples for structure, tone, and content:

<reference-readme-azure-chat>
!`curl -sL https://raw.githubusercontent.com/Azure-Samples/serverless-chat-langchainjs/refs/heads/main/README.md | head -100`
</reference-readme-azure-chat>

<reference-readme-smoke>
!`curl -sL https://raw.githubusercontent.com/sinedied/smoke/refs/heads/main/README.md | head -100`
</reference-readme-smoke>

   Additional references (fetch with `webfetch` if needed):
   - https://raw.githubusercontent.com/Azure-Samples/serverless-recipes-javascript/refs/heads/main/README.md
   - https://raw.githubusercontent.com/sinedied/run-on-output/refs/heads/main/README.md

2. **Generate Content:** Call the `document-writer` agent with the following prompt to generate the full README content:
   ```
   Create a comprehensive README.md file for this project based on the gathered context.

   CONTEXT:
   - Project Structure: <project-structure>
   - Source Files: <source-files>
   - Git Info: <git-info>
   - Existing Manifests: <package-manifests>
   - Analysis Results: Refer to the output from the explore and librarian agents
   - Reference Examples: See <reference-readme-azure-chat> and <reference-readme-smoke>

   SECURITY REQUIREMENTS:
   - [ ] No API keys, tokens, or credentials
   - [ ] No internal URLs/IPs
   - [ ] No sensitive file paths
   - [ ] Sanitize all example data

   CONTENT GUIDELINES:
   - DO: Clear value proposition, practical examples, prerequisites, troubleshooting, GFM syntax.
   - DON'T: "LICENSE/CONTRIBUTING" sections (link files instead), overuse emojis, broken links.
   - Include a logo if one was found in project assets.

   SUCCESS CRITERIA:
   - Explains purpose in 30s.
   - Clear setup/usage instructions.
   - Professional tone.

   OUTPUT FORMAT:
   Return ONLY the complete raw Markdown content for the README.md file, ready to be written.
   ```

3. **Write File:** Use the `write` tool to save the content returned by `document-writer` to `README.md`.

### Phase 3: Security & Quality Review

Before finalizing, validate the README against these criteria:

**Security Checklist:**
- [ ] No API keys, tokens, or credentials included
- [ ] No internal URLs, IP addresses, or server names exposed
- [ ] No database connection strings or schemas revealed
- [ ] No proprietary algorithms or business logic detailed
- [ ] No sensitive file paths or system configurations shown
- [ ] All example data is sanitized and generic

**Quality Checklist:**
- [ ] Project purpose clearly explained in opening paragraph
- [ ] Installation/setup instructions are complete and tested
- [ ] Usage examples are practical and working
- [ ] All external links validated (use `webfetch` tool to verify)
- [ ] Consistent tone and professional language
- [ ] Appropriate level of technical detail for target audience

## Content Guidelines

**DO:**
- Write clear, concise descriptions focusing on value and functionality
- Provide practical, working code examples
- Include prerequisites and dependencies
- Document common troubleshooting issues
- Use minimal, purposeful emojis (1-3 per major section maximum)
- Explain "why" not just "how" for key architectural decisions

**DON'T:**
- Include sections like "LICENSE", "CONTRIBUTING", "CHANGELOG" (dedicated files exist)
- Overuse emojis or decorative elements
- Include sensitive information (see Security Checklist)
- Make assumptions about user's environment without documenting prerequisites
- Use broken or unvalidated external links
- Include outdated or deprecated information

## Edge Case Handling

If you encounter these situations:
- **Unclear Project Purpose:** Analyze code patterns, dependencies, and file structure; ask user for clarification if needed
- **Minimal Project Files:** Create a basic README with available information and note areas needing expansion
- **Missing Dependencies/Setup Info:** Document what's discoverable and flag missing setup information
- **Broken Reference Links:** Remove or replace with working alternatives
- **Private/Proprietary Projects:** Focus on functionality overview without exposing implementation details

## Success Criteria

A successful README will:
1. Enable a new user to understand the project's purpose within 30 seconds
2. Provide clear, actionable setup instructions
3. Include working usage examples
4. Contain no sensitive or security-compromising information
5. Follow modern documentation best practices
6. Be maintainable and easy to update
