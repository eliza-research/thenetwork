# Respect availability start dates in Friends planning

## Result and scope

Friends used future-dated weekly availability before it took effect. Adding availability starting 30 days later changed the current week's complete plan output on all three reproduced seeds. The fix preserves the original plans until those facts become active; availability starting now still affects planning.

This is a reproduced scheduling bug in the existing Friends local-pilot workflow (PRD 40.6 and the scheduling requirements in section 32). Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`. Implementation: `8445da500784aab5cebafc6fe91347eecd28b09d`. The branch is independent of the earlier Friends planning fixes.

## Cause and implementation

Friends reads private availability tags directly from `World.input.facets`. Its `tagsBy` helper skipped expired facets but did not check `validFrom`. The core World index and the Peon and Slop profile readers already reject facts whose start date is later than the snapshot time. That core check does not apply automatically to Friends' separate raw-facet traversal.

Add the same start-date check at the Friends tag-reading boundary. A facet starting exactly at `w.now` remains active; missing start dates and the existing end-date policy retain their behavior. No parser, planner policy, privacy scope, schema or copy template changes.

Alternatives considered:

- Filter the snapshots separately in every caller. This duplicates the validity rule across service and simulator paths while the Friends reader still accepts inactive tags from other callers.
- Filter only when building availability evidence. This leaves the shared Friends profile interpretation inconsistent for other preferences and duplicates a rule already owned by the facet-reading boundary.

## measurement

One new blocking gate in `scripts/sim/friends.ts` runs the actual `World`, Friends profile reader, availability-evidence builder and weekly planner. It creates three generated NYC worlds, seeds **101, 102 and 103**, each with **160 members and three weeks of random-baseline history**, then advances to the next planning week using the existing snapshot pattern.

The fixture adds a hand-written private availability facet to each adult, containing the eleven weekly slots already supported by Friends. Its `validFrom` is 30 days after the snapshot time, beyond the planner's configured 6.5-day horizon. For each seed the gate runs four arms: unchanged snapshot, future availability, the same availability active exactly now, and the same availability already expired. This is 12 planner runs over three generated worlds, not a statistical friendship-quality estimate.

| Seed | Original weekly plan count | With future availability, before | With future availability, after | Complete future-input output equals original, before -> after |
|---|---:|---:|---:|---|
| 101 | 17 | 19 | 17 | false -> true |
| 102 | 22 | 22 | 22 | false -> true |
| 103 | 16 | 18 | 16 | false -> true |

Exact weekly-output equivalence improves from **0/3 to 3/3**. The original 55 plan objects are preserved after the fix; before it the future-input arm returned 59, and even the equal-count seed had different plan contents. The assertion compares the entire weekly result, including participants, options and scores, rather than only counts. Counts include all plan types returned by the planner and are not a count of delivered invitations or attended meetings.

Positive control: availability with `validFrom == now` changes the plan output on all three seeds, before and after. Expired availability leaves the original output unchanged on all three seeds. Each original world has nonempty plans. These controls prevent a fix that simply discards all new availability.

Same command before and after, with only the new gate applied to the base first:

```sh
bun run sim --only friends
```

- Before: **18/19 blocking gates**, the new regression fails for all three seeds; 52.9 seconds.
- After: **19/19 blocking gates**; 51.6 seconds.
- All **21 pre-existing gate records are identical excluding runtime**, including the pack/random/oracle fingerprint `e5bf70e069eaa7e9`.
- The existing tracked undetected-adversary harm metric remains off target at 1.67x random; no value or threshold changes.

One implementation was tried, with no adjustment to the expected results after reproducing the failure. No performance or aggregate planning-quality gain is claimed. The official Friends comparison remains seeds 5-8, eight weeks and 400 personas per world. The one-full-simulation-per-agent allowance was already used for PR #136, so only the affected block was rerun.

Additional checks:

```sh
bun run typecheck
REQUIRE_PG=1 bun run test:integration
REQUIRE_PG=1 bun run test:e2e
```

- Typecheck: all four configurations pass.
- Full integration including security: **675 pass, 8 skip, 6 fail**, 13,741 assertions across 689 tests in 68 files; 586.10 seconds. The six failures match pristine main on Windows: an absolute `/bin/bash` requirement, SIGTERM exit status, and four site path-separator comparisons. The eight skips require the separately enabled retry-reconciliation suite.
- E2E: **42 pass, 1 optional skip, 0 fail**, 654 assertions across 43 tests in three files; 78.08 seconds.
- Combined with the preceding twelve contribution PRs: all four typecheck configurations and **22/22 blocking Friends gates** pass (60.5 seconds), with the same pre-existing tracked miss. The new three-world regression passes in the combination. The merge required combining imports and preserving both the existing DST gate and the new gate at their shared insertion point; no production compatibility adjustment was needed.

## safety_gates

Existing age, consent, block, review, travel and leak gates retain their passing values. Only availability facts are added by the regression fixture. Synthetic members and venues, simulation output and dry-run service tests only; no live sends or deployment.

## llm_evidence and agent_clients

Deterministic facet validity and planning: zero validation LLM calls and $0 model cost. No model-backed behavior changed. No real-client acceptance run is claimed for Claude Code, Codex/ChatGPT, Hermes Agent, OpenClaw, Muse, Grok bot, elizaOS or Cursor. The actual weekly planning path is exercised directly; service suites are reported separately.

Authoring: OpenAI / `gpt-6-astra`, identified by the operator; Codex desktop `26.1021.3705.0`. Validation: Windows, Bun 1.4.2, TypeScript 5.9.3, PostgreSQL 16.15 on local port 54339, frozen lockfile dependencies.

## Limits

This respects the existing facet validity contract when reading a snapshot. It does not add natural-language parsing of future availability, migrate stored facts, retract previously sent invitations, or cancel already-created plans. The evidence is exact snapshot equivalence, not a real-world attendance claim. Linux CI remains required before merge.
