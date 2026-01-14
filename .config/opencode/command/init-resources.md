---
description: Initialize external resources for focused librarian/exa/context7 searches
agent: Sisyphus
---

# Initialize External Resources

Create or update a curated `## EXTERNAL RESOURCES` section in AGENTS.md that librarian agent uses for focused searches.

## Process

### Step 0: Check Existing Resources

Use the read tool to check if AGENTS.md exists and already contains an `## EXTERNAL RESOURCES` section.

If the section exists, ask the user:
```
AGENTS.md already has an EXTERNAL RESOURCES section. Replace it or append new entries?
```

**WAIT for user response if section exists.**

### Step 1: Detect Project Dependencies

<detected-files>
!`ls package.json Cargo.toml go.mod pyproject.toml requirements.txt build.zig 2>/dev/null`</detected-files>

Based on the files shown in <detected-files>, use the read tool to examine the relevant dependency file (e.g., `package.json` for Node.js, `Cargo.toml` for Rust). Focus on just the dependencies section, not the entire file.

**If no dependency files are detected**, inform the user:
```
No dependency files detected (package.json, Cargo.toml, go.mod, pyproject.toml, requirements.txt, build.zig).
This command works best with projects that have a package manifest.
You can still manually provide doc URLs and GitHub repos below.
```

### Step 2: Ask User for Key Resources

Present the detected dependencies, then ask:

```
I found these dependencies in your project:
[list detected dependencies here]

To help librarian searches be more focused, please provide any of these (optional):

1. **Doc URLs** - Official documentation sites
   Example: https://tokio.rs, https://docs.rs/sqlx

2. **GitHub Repos** - Source repos for key libraries
   Example: tokio-rs/tokio, launchbadge/sqlx

3. **Other** - Blogs, tutorials, internal wikis

Just list them. Type "skip" to auto-resolve top 5 deps via Context7.
```

**WAIT for user response. Handle these cases:**
- If user provides URLs/repos: Use those directly and resolve Context7 IDs for mentioned libraries
- If user types "skip": Auto-resolve Context7 IDs for top 5 dependencies (see prioritization below)
- If unclear: Ask for clarification

### Step 3: Resolve Context7 IDs

For user-provided libraries OR top 5 important dependencies if skipped, use the context7_resolve-library-id tool in parallel for each library.

**Dependency Prioritization** (to identify the top 5 most important):
1. Async runtimes (tokio, async-std, asyncio)
2. Web frameworks (actix, axum, express, fastapi, next.js)
3. Database libraries (sqlx, diesel, prisma, mongoose)
4. Serialization/validation (serde, zod, pydantic)
5. HTTP clients (request, axios, httpx)
6. Testing frameworks (jest, pytest, vitest)
7. Core utilities with complex APIs

Make these calls in parallel since they are independent operations:
- Call context7_resolve-library-id with libraryName for each selected library
  ```
  Tool 1: context7_resolve-library-id("tokio")
  Tool 2: context7_resolve-library-id("sqlx")
  // Run in parallel
  ```
- Record the returned Context7-compatible library ID and snippet count

### Step 4: Write to AGENTS.md

Use the write tool (or edit tool if appending) to add the `## EXTERNAL RESOURCES` section to AGENTS.md:

```markdown
## EXTERNAL RESOURCES

### Dependencies (from Cargo.toml)
tokio, sqlx, serde, tracing, redis, polars, reqwest, clap

### Context7 IDs
| Library | ID | Snippets |
|---------|-----|----------|
| Tokio | /tokio-rs/tokio | 500+ |
| SQLx | /launchbadge/sqlx | 200+ |

### GitHub Repos
- tokio-rs/tokio
- launchbadge/sqlx

### Documentation
- https://tokio.rs
- https://docs.rs/sqlx
```

Adjust the example content above based on actual detected dependencies and user input.

### Step 5: Confirm

```
=== init-resources Complete ===

Written to: ./AGENTS.md

Librarian will now:
- Use pre-resolved Context7 IDs (faster)
- Focus grep_app on listed repos
- Prioritize listed doc sites in web searches

To update: Edit AGENTS.md or run /init-resources again.
```

---

## Notes

1. Keep dependencies list compact (just names, one line)
2. Only resolve Context7 for 5-10 key libraries (not all dependencies)
3. Librarian filters to relevant dependencies per-query (won't use all every time)
4. If AGENTS.md doesn't exist, create it (using the `/init` command) with the `## EXTERNAL RESOURCES` section
