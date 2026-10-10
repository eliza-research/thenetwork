<!-- Pending edits for the canonical PRD (Google Doc). Edit the Google Doc, not the snapshot. https://docs.google.com/document/d/1lLQAZNAMSC_yHCkUBVbp1CCwvyR17PuvV7TnpfuY8Xc/edit -->

# PRD pending edits

The PRD Google Doc is canonical: https://docs.google.com/document/d/1lLQAZNAMSC_yHCkUBVbp1CCwvyR17PuvV7TnpfuY8Xc/edit. `docs/prd-snapshot.md` is a copy of it.

This file lists proposed PRD edits that are not yet in the PRD. Apply an edit in the Google Doc, re-snapshot `docs/prd-snapshot.md`, then delete the edit here. Mark items that need a founder decision first with **[DECIDE]**.

Earlier items were applied on 2026-10-08 (PRD 28, 31, 32, 34, 35, 36, 37, 38, 40, Appendix B, and the new Section 41); the open founder questions moved to PRD 27 and `docs/mvp-gaps.md` section 5.

## Pending

1. **PRD 34 (and the summary rows in 28, 27 and the decision log): validation is simulations + integration + e2e** (founder, after 2026-10-08). Retitle 34 "Validation: simulations, integration and e2e". Unit and smoke tests are not kept; integration tests (real Postgres, real HTTP servers, several packages together, the full service) and e2e tests (`tests/e2e`) are. The security suite is kept as part of the integration suite (CI job "integration"), so the "Keep the security suite?" row in 27 is closed. Classification and the restored files: `docs/tests-policy.md`.
2. **PRD 27 "Clef weight fitting" row: ratings are ON** (founder). Appearance ratings feed slop matching from launch (never shared), on the placeholder weights until P2's fitted weights pass the decision rule; remove "keep ratings off until fitted weights exist".
3. **Founder decisions of 2026-10-09** (PRD 27, 28, 32.3, 37.1, 40 and the decision log; Appendix B where it names the plugin). Apply these in the Google Doc. Then re-snapshot `docs/prd-snapshot.md` from the Google Doc. Do not edit the snapshot first.
   - **Open join for every app.** slop.date, peon.biz and friends.help are open: anyone aged 13 or more can join. The Network (ntwrk.love) stays invite-only on the web. This closes the "production join mode for peon and friends" question in PRD 37.1 item 0(c) and 40.6.
   - **eliza.app is one entry.** eliza.app is one more way into The Network, like the four sites. A person who arrives through eliza.app joins The Network and is asked what they are looking for (friends, dating, work), or is routed by keyword. It is not a separate product with separate members. An existing eliza.app user gets a one-time notice and is not matched before the normal join and consent.
   - **Eliza is The Network's agent.** The shared agent that was eliza.app's assistant is now The Network's agent, still named Eliza. The member conversation runs in Eliza (Eliza Cloud and its gateway). The Network service provides matching, platform, review and relay through signed calls (`/internal/turn` and the other `/internal/*` endpoints). This closes "where the conversation runs" in PRD 32.3, 37.1 item 0(b) and 27. STOP and HELP on the shared line have one owner, the Eliza gateway; the service parses STOP inside `/internal/turn` and reports it as consent in the handled response (closes 37.1 item 0(a)).
   - **Bans are by phone number.** A banned number is refused at join (web, text, MCP), at login (OTP), and on inbound messages, on every app.
   - **Clef scam detection.** Clef is also the scam and harassment classifier for relayed messages (clef-flash by default). Clef photo ratings stay on and are never shown; the placeholder weights ship until fitted weights pass the P2 decision rule.
   - **The plugin lives upstream.** The Network plugin is `@elizaos/plugin-network` in elizaOS/eliza (`plugins/plugin-network`). This repo has no plugin package and no eliza submodule. It keeps a byte-identical copy of the wire contract in `packages/core/src/svc/contract.ts` and `svc-auth.ts`. Replace the 2026-10-07 decision log entry "Network code lives in the thenetwork repository, including the Network plugin (packages/plugin-network). Eliza is included as a git submodule".
   - **Unchanged.** Minors (13-17) are never matched. A person reviews every proactive proposal. Every LLM use is gpt-6-luna on Surplus.
