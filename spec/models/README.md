# Quint flow models

The [product stories](../product/stories.md) describe the member and staff flows. This directory holds their existing standalone Quint state machines. Each Markdown file contains the flow, its safety scope, and one executable `quint` block. Change the Markdown source when you update a model.

The 31 modules came from `claude/quint-state-machines` at `30d950e1d6fa027a67b94cc6b03ba379dc923a63`. That source revision includes the latest local wave 4 model changes. Their comments document bounds, abstractions, code locations, excluded cases, and existing drift at that revision. The source revision also contains the research plan and findings referenced in comments. Code locations and results need a new comparison with the runtime on this branch.

## Run the models

```bash
bun run spec:setup
bun run quint:check                         # typecheck, replay traces, simulate safety and reachability
bun run quint:check turn_consent            # one model
bun run quint:check --tangle-only           # write the model blocks to runs/quint-models/
bun run quint:check --verify --jobs 2       # include bounded Apalache checks, requires Java 17+
```

A `witness_*` assertion is the negation of an expected reachable state. A witness check passes when the simulator reaches that state and the assertion fails. Random simulation and bounded model checking cover the modeled states within the run bounds.

These models use mutable variables, actions, nondeterministic environment steps, or executable traces. Vibespec generates TypeScript from pure definitions and guards in top-level `spec/*.md`. Keep whole-flow checks here while moving pure policy definitions into the Vibespec specs. When a generated policy takes over a production decision, compare its behavior with the corresponding action guard and keep the sequence, failures, and retry behavior in the flow model.

The [source coverage ledger](baseline/coverage.md), [drift record](baseline/drift.json), [LemmaScript file list](baseline/LemmaScript-files.txt), and [Dafny proof sources](baseline/proofs/) record the original relationships among models, code, and obligations. The historical proof sources include manually added lemmas and are scoped to the original branch. Vibespec's checks prove its own generated modules and eligible source files.

## Model index

| Model | Flow |
|---|---|
| [auth_edge](auth_edge.md) | Web sessions and trusted requests |
| [backup_restore](backup_restore.md) | Database restore |
| [boot_config](boot_config.md) | Service start and proxy configuration |
| [candidate_pool](candidate_pool.md) | Candidate retrieval and groups |
| [chatjson_loop](chatjson_loop.md) | Structured model calls |
| [cloud_auth](cloud_auth.md) | Eliza Cloud sign-in and grants |
| [console_privacy](console_privacy.md) | Staff console data visibility |
| [console_views](console_views.md) | Staff member views |
| [engine_rules](engine_rules.md) | Matching rules and outreach budgets |
| [identity_sagas](identity_sagas.md) | Phone ownership and account changes |
| [join_age](join_age.md) | Membership and age |
| [join_flow](join_flow.md) | Browser signup |
| [matching_engine](matching_engine.md) | Matching, interviews, and job seats |
| [notify_capital](notify_capital.md) | Inbox and network capital |
| [oauth_mcp](oauth_mcp.md) | Connector authorization and member tools |
| [observatory_sync](observatory_sync.md) | Staff console synchronization |
| [opportunity](opportunity.md) | Proposal, review, and response |
| [outbound_queue](outbound_queue.md) | Outbound queue and delivery receipts |
| [phone_identity](phone_identity.md) | Phone number identity |
| [photo_relay_item](photo_relay_item.md) | Selected-photo delivery |
| [photos_rating](photos_rating.md) | Photo storage and private ratings |
| [plan_crew](plan_crew.md) | Crew invitations and sessions |
| [plan_run](plan_run.md) | Group plans and fallback |
| [profile_learning](profile_learning.md) | Suggestions from connected sources |
| [profile_read](profile_read.md) | Read a saved profile |
| [relay](relay.md) | Relay between matched members |
| [review_desk](review_desk.md) | Staff review desk |
| [runtime_ops](runtime_ops.md) | Runtime work, retention, and alerts |
| [safety_trust](safety_trust.md) | Safety reports, holds, and blocks |
| [staff_console](staff_console.md) | Staff roles and console actions |
| [turn_consent](turn_consent.md) | Signed turns and carrier consent |
