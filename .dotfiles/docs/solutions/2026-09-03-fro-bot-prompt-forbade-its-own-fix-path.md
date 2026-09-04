---
title: A scheduled agent reported the same fix as done for five days because its prompt forbade every delivery path
date: 2026-09-03
category: workflow-issues
module: fro-bot
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when: "Writing or reviewing a prompt for an autonomous agent that is expected to deliver changes, not just report them — especially a scheduled job whose checkout is discarded at run end."
symptoms:
  - "An agent reports the same fix as applied on every run, and the fix is never present on the next run"
  - "The run reports success, so nothing escalates and the loop continues indefinitely"
  - "The agent's own root-cause claim points at the calling harness rather than its instructions"
root_cause: missing_workflow_step
resolution_type: workflow_improvement
related_components:
  - documentation
  - tooling
tags:
  - fro-bot
  - agent-prompts
  - github-actions
  - silent-failure
  - delivery-path
---

# A scheduled agent reported the same fix as done for five days because its prompt forbade every delivery path

## Context

`.github/workflows/fro-bot.yaml` runs an autonomous maintenance agent daily and files a report issue. Its prompt is a YAML literal block organized into numbered categories, each with its own permissions — some categories may push commits, others are report-only.

For five consecutive runs the agent detected the same three-line drift in `AGENTS.md`, applied the correction, and reported it fixed. The drift was still there the next day, every time. From report issue #2474:

> The same 3 mechanical drift points flagged and "fixed" on 2026-08-27 through 2026-08-30 were **still present** in the working tree today, confirming the prior four days' edits never persisted. […] **This is now the fifth consecutive day this exact 3-line fix has been re-applied without persisting — see Needs Human Attention, this is a caller-workflow bug, not a content problem.**

The agent's diagnosis in that last sentence was wrong, and following it would have sent someone to debug the calling workflow instead of the prompt.

The prompt contradicted itself across three instructions in two categories:

```yaml
     3. CONFIG QUALITY & REPO HYGIENE
        - Check that AGENTS.md accurately reflects the current directory
          structure. If drift is found, open a PR with corrections.
        Report findings but put actual fixes into category 4.

     4. DEVELOPER EXPERIENCE
         Report on static analysis findings only. Do not run formatting tools
         or open formatting PRs.
```

Instruction one grants a delivery path. Instruction two routes the fix to another category. That category revokes the path. Nothing remained except editing the ephemeral Actions checkout, which is discarded when the run ends.

## Guidance

**Never route a fix into a category that forbids delivering it.** Cross-category handoffs move the work but not the permissions. If a category needs an exception, state it in place:

```yaml
        - Check that AGENTS.md accurately reflects the current directory
          structure and documented behavior. If drift is found, deliver the
          correction: create a branch, commit it, push, and open a PR. This
          is the one exception to this category's report-only default, so do
          not defer it to another category. Editing the working tree without
          opening a PR does not persist and will silently recur every run.
        Everything else in this category is report-only.
```

Three things changed there, and each does separate work:

1. **The delivery mechanism is named concretely** — branch, commit, push, PR. "Open a PR" is an outcome; an agent that cannot infer the steps will substitute whatever action is still permitted.
2. **The routing is removed.** The exception lives where the instruction lives.
3. **The failure mode is stated in the prompt**, so the agent can recognize the trap rather than fall into it silently.

**Treat a repeated identical "fixed" report as a missing delivery path.** It is the signature of this bug. A genuinely flaky commit step produces intermittent success; a closed delivery path produces a perfectly consistent no-op.

**Be skeptical of an agent's diagnosis of its own harness.** It can observe that it made an edit and that the edit is gone. It cannot see that its instructions never permitted the edit to leave the container. That gap makes "the caller is broken" the natural conclusion and the wrong one.

**Grep for the shape.** This class is mechanically detectable in prompt text:

```bash
# Cross-category routing that may strip permissions
grep -nE "fixes into category|handle .* in category|defer .* to category" .github/workflows/*.yaml

# A category that both forbids and is a routing destination
grep -nE "report-only|Report on .* only|Do not .* open .* PRs" .github/workflows/*.yaml

# Delivery described as an outcome rather than steps
grep -nE "open a PR|fix it|apply corrections" .github/workflows/*.yaml
```

Any instruction that grants a delivery path deserves a check that no later instruction takes it away.

## Why This Matters

Contradictory instructions do not raise an error. They narrow the action space. The agent takes the only action still permitted, and reports it honestly — from inside a single run it really did apply the fix.

That makes the failure self-reinforcing in both directions. The success report suppresses escalation, so no human investigates. The drift survives, so the next run detects it again and repeats. The loop is stable and can run indefinitely; this one was caught only because the report happened to say "again."

The cost is not the stale documentation. It is that a maintenance agent's reports become unreliable in a way that reads as reliable — the one category it could not fix looked identical to the ones it could.

## When to Apply

Review the prompt whenever an agent is expected to produce a durable change rather than a report, and specifically when:

- categories or sections carry different permissions
- one section routes work to another
- the agent runs in an ephemeral environment where an unpushed edit is indistinguishable, from inside, from a real fix
- a report says the same thing two runs in a row

## A Second Failure of the Same Kind

The drift being reported was itself understated. `AGENTS.md` documented a Bash load chain — `.bashrc` → `.config/bash/main` → `functions` → `aliases` → `init.d/*` → `local.d/*` — that never ran. `.bashrc` sources sheldon, which loads `mise activate` and `starship init` and nothing else.

Reading the files supports the documented chain: the scripts exist, they are well-formed, they use consistent conventions. Only a live shell disproves it:

```console
$ zsh -ic 'echo "PAGER=$PAGER"'     # init.d/pager.bash exports PAGER
PAGER=

$ zsh -ic 'alias ls'                 # resolves to aliases:37, not init.d/ls.bash:23
ls='LC_COLLATE=C lsd --color=auto --group-directories-first'

$ bash -ic 'type .dotfiles'          # zsh-only, via sheldon's [plugins.aliases]
```

Nineteen `init.d/` scripts plus `main` and `functions` are dead code that the documentation presented as live configuration. The corrected prompt now requires verifying load order against a live shell, because the file contents are actively misleading.

This has a real consequence beyond documentation: `docs/runbooks/discord-admin-agent.md` instructs exporting `DISCORD_TOKEN` from `.config/bash/local.d/discord.bash`. That file exists on this machine, and `DISCORD_TOKEN` is empty in a live shell — `local.d/` is never sourced, so the runbook's setup step silently does nothing.

Both failures share a shape: a plausible-looking artifact that never executes, reported as working by something that could not observe the difference.

## Related

- PR #2498 — the prompt fix and the `AGENTS.md` correction
- `docs/solutions/2026-09-03-devcontainer-git-dir-leak-mise-pyenv.md` — same day, also a latent defect that only surfaced when something downstream changed
