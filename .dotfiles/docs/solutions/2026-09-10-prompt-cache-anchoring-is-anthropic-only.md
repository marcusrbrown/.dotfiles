---
title: Explicit prompt-cache anchoring reaches only Anthropic-family models
date: 2026-09-10
category: best-practices
module: opencode-provider
problem_type: best_practice
component: tooling
severity: medium
applies_when: "Diagnosing prompt-cache reuse in a multi-provider agent harness, or evaluating a context-management threshold change on the strength of a token-waste number."
symptoms:
  - "Cached tokens pin at a fixed value while the prompt keeps growing, across adjacent turns seconds apart"
  - "One model family holds ~100% cache reuse while every other family degrades in the same harness"
  - "A subjective report that a model 'busts cache a lot', with no per-turn measurement behind it"
root_cause: scope_issue
resolution_type: workflow_improvement
related_components:
  - tooling
  - development_workflow
tags:
  - prompt-cache
  - opencode
  - openai
  - anthropic
  - measurement
  - transform
---

# Explicit prompt-cache anchoring reaches only Anthropic-family models

## Context

A report of "a lot of cache busts using GPT-6 Astra" turned out not to be about Astra.

OpenCode's `applyCaching()` in `packages/opencode/src/provider/transform.ts` places explicit cache breakpoints on the first two system messages and **the last two non-system messages** — an anchor that advances every turn as the conversation grows. Its call site at lines 471-484 gates on model family:

```ts
if (
  (model.providerID === "anthropic" ||
    model.api.id.includes("anthropic") ||
    model.api.id.includes("claude") ||
    model.api.npm === "@ai-sdk/anthropic" ||
    model.api.npm === "@ai-sdk/alibaba" || …) &&
  model.api.npm !== "@ai-sdk/gateway" &&
  !usesAnthropicAutomaticCaching
) {
  msgs = applyCaching(msgs, model)
}
```

A model on `@ai-sdk/openai` matches none of the disjuncts, so the function never runs and reuse falls back to OpenAI's implicit prefix cache — which truncates at the first differing byte and has nothing to re-anchor. The `openrouter` / `bedrock` / `copilot` / `openaiCompatible` keys inside `applyCaching()`'s provider map exist for Claude routed through those gateways; the absence of an `openai` key is a consequence of the gate, not an oversight in the map.

Measured over 10 days, the split follows model **family**, not provider:

| provider/model | family | turns | reuse | collapsed |
|---|---|---|---|---|
| anthropic/claude-sonnet-5 | claude | 17,615 | 100.0% | 0.0% |
| anthropic/claude-opus-5 | claude | 11,499 | 100.0% | 0.1% |
| openai/gpt-6-astra | other | 1,691 | 92.1% | 8.5% |
| openai/gpt-5.6-sol | other | 343 | 64.9% | 27.4% |
| github-copilot/gpt-5.4-mini | other | 2,768 | 80.1% | 18.3% |
| github-copilot/gemini-3.5-flash | other | 693 | 91.3% | 4.6% |

`github-copilot` serves Claude at 100% and its own GPT and Gemini models at 80.1% and 91.3% — same provider, opposite behaviour. That distinction is what made the diagnosis correct; a provider-shaped reading would have missed it.

Filed upstream as `anomalyco/opencode#48246`. There is no local fix: placing a breakpoint needs `providerOptions.<ns>.promptCacheBreakpoint` on a content block, `chat.params` exposes only request-level `options`, and the published `TextPart` type carries `metadata` but no `providerOptions`, with no mapping between them anywhere in the build.

## Guidance

**Measure per turn from stored token counts.** Assistant messages in `~/.local/share/opencode/opencode.db` carry `tokens.input` and `tokens.cache.read`. Open read-only — OpenCode is live against the same file:

```python
sqlite3.connect("file:%s?mode=ro" % db, uri=True)
```

**Normalise for the provider's reporting convention.** Anthropic reports `input` *exclusive* of cache reads; OpenAI reports it *inclusive*:

```
reuse = cached / (input + cached)
```

`cached / input` yields nonsense across providers — an Anthropic row measured that way came out at 12,509,400%.

**Collapse run-lengths into episodes before reading the numbers.** A collapsed turn is a symptom; an episode is the event. Group by model *family*, not provider — one provider can serve both.

**Read the formula in the installed bundle, not the config key name.** Knobs can be capped.

## Why This Matters

The headline number invited the wrong fix. "8.5% of turns cause 89% of the waste" reads as a systemic condition worth tuning against. Decomposed into episodes it isn't:

| | |
|---|---|
| collapsed turns | 144 |
| collapse **onsets** | 84 |
| median episode length | **1 turn** |
| single-turn episodes | 64 of 84, carrying **48.2%** of all waste |
| onsets following a compaction | 13 of 84 |

Half the waste is ordinary single-turn rewarming that recovers by itself. The actionable remainder is two long episodes carrying 30.5% between them — a targeted-recovery problem, not a threshold problem.

Three hypotheses were reasoned to confidently and then killed by measurement. Each is a dead end worth not re-walking:

- **Encrypted reasoning items are not being requested** (the gate at `:1340` excludes `gpt-6-astra`). It has 3,233 of 5,114 reasoning parts *with* encrypted content — the include arrives via an npm-keyed switch at `:1809`, not that gate.
- **Compaction causes the collapse.** One affected session never compacted; only 13 of 84 onsets follow one.
- **Lowering `execute_threshold_percentage` cuts the blast radius.** The knob is capped at 80, and the waste is not threshold-shaped.

## When to Apply

- One model family behaves differently from another in the same harness, especially when they share a provider.
- Any subjective "it feels slow / it's burning tokens" report, before acting on it.
- Before changing a context-management threshold, since the knob may be capped or may not address the dominant trigger.

## Examples

**Collapse trace.** The prompt grows while reuse stays pinned:

```
turn    input    cached
 #18    2,750    95,104     healthy
 #19   95,691     3,712     break
 #26   70,278    38,912     prompt grew 9k, cached frozen
```

Turn 21 ran **12 seconds** after turn 20 and reused 38,912 tokens of a ~100k prefix that had just been written — so not TTL expiry. Every observed cached value is an exact multiple of 128, matching OpenAI's documented prefix-match increment.

**The capped knob.** Magic Context computes the history-summary budget as:

```js
Math.floor(displayContextLimit * (Math.min(executeThresholdPercentage, 80) / 100) * historyBudgetPercentage)
```

`Math.min(…, 80)` makes 80 a ceiling. Lowering `execute_threshold_percentage` to 65 cuts the history budget by exactly 18.75% and buys nothing, while raising it above 80 does nothing at all. Reading the config key alone would not have shown this.

## Related

- `anomalyco/opencode#48246` — the cache-anchoring gap
- `anomalyco/opencode#48247` — a separate model-ID version gate where `gpt-6-astra` matches neither `/gpt-(\d+)\.(\d+)/` nor `includes("gpt-5")`
- `docs/solutions/2026-05-22-bun-sqlite-readonly-wal-pattern.md` — the read-only access pattern this measurement depends on
