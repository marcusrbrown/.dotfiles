---
description: Research a topic using web search, library docs, and code examples
agent: research
---

<research-query>
$ARGUMENTS
</research-query>

Research the topic described in <research-query>.

If no query was provided, ask what to research.

## Guidelines

- **Library or API question** — Start with Context7 to get current docs, then Grep.app for real usage patterns if needed.
- **How do others do X** — Start with Grep.app to find production code examples, supplement with Exa for blog posts or discussions.
- **Current events or recent changes** — Use Tavily with `topic: "news"` and a short `days` window.
- **Broad comparison or evaluation** — Combine multiple tools: docs via Context7, code via Grep.app, community opinion via Exa or Tavily.
- **Financial or market data** — Use Tavily with `topic: "finance"`.

Prioritize accuracy over volume. Lead with the direct answer, then provide supporting evidence and sources.

## Examples

Here are example queries and how to approach them:

**Library docs**: `/research How does Hono middleware work with context passing?`
Resolve Hono on Context7, then query for middleware and context patterns.

**Code patterns**: `/research Show me how production Next.js apps handle ISR with on-demand revalidation`
Search Grep.app for `revalidatePath(` and `revalidateTag(` in TypeScript files, then check Context7 Next.js docs for the current API.

**Comparison**: `/research Compare Drizzle ORM vs Prisma for edge runtime compatibility`
Query Context7 for both Drizzle and Prisma edge runtime docs. Search Exa for comparison articles. Search Grep.app for `drizzle` usage in edge/worker contexts.

**Current info**: `/research What changed in the latest Bun release?`
Search Tavily with `topic: "news"` and `days: 14` for recent Bun release coverage.

**Hypothetical exploration**: `/research What are the tradeoffs of using SQLite with Litestream vs PostgreSQL for a small SaaS?`
Search Exa for architectural comparison posts. Search Grep.app for Litestream configuration patterns. Query Tavily for recent community discussion.

**Financial**: `/research What's the current pricing for OpenAI and Anthropic API models?`
Search Tavily with `topic: "finance"` for current pricing pages. Supplement with Exa for comparison posts.
