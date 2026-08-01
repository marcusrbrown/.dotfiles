## Impeccable Live Mode Routing

- When the user invokes Impeccable `live` mode, load the Impeccable skill only to identify the workflow, then delegate the entire live session to `@designer` as one background task. Do not run the live helper, dev server, poll loop, variant generation, source edits, browser automation, or cleanup in the Orchestrator.
- Give Designer a complete self-contained brief: project root, requested target when present, the exact user request, and the requirement to follow Impeccable `live.md` through exit and cleanup.
- Do not load or use `agent-browser` for Impeccable live mode. The user owns the browser session.
- Designer publishes the exact app URL atomically to `.impeccable/live/app-url.txt` after both the live helper and app server are ready, then remains in the live poll loop. After dispatch, wait only for that readiness file, present its URL to the user, and stop narrating; browser controls drive the session.
- Treat the background Designer task ID as the live-session handle. Never replace it with a fresh task. If continuation is required, pass that exact task ID plus a complete brief and verify the returned task ID matches.
- When Designer exits, report whether a variant was accepted and whether cleanup restored a clean source state. Do not perform UI edits inline to repair a failed live session; return the failure to the same Designer session when possible.
