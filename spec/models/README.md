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

The last column identifies a generated production seam for that flow.
Imported whole-flow models still need comparison with the runtime. A
generated decision or subflow alone does not establish coverage for the
entire imported model.

| Model | Flow | Vibespec production seam |
|---|---|---|
| [auth_edge](auth_edge.md) | Web sessions and trusted requests | [Phone verification](../otpLimits.md), [web sessions](../webSession.md) |
| [backup_restore](backup_restore.md) | Database restore | [Scratch restore lifecycle](../databaseRestore.md) |
| [boot_config](boot_config.md) | Service start and proxy configuration | [Startup configuration](../bootPolicy.md) |
| [candidate_pool](candidate_pool.md) | Candidate retrieval and groups | [Candidate screening](../candidateScreening.md), [exposure floor state machine](../exposureFloor.md), [group formation](../groupFormation.md) |
| [chatjson_loop](chatjson_loop.md) | Structured model calls | [Structured request state machine](../chatRetry.md) |
| [cloud_auth](cloud_auth.md) | Eliza Cloud sign-in and grants | [Cloud callback and session issuance](../cloudSignIn.md), [session and grant validation](../cloudAuthority.md) |
| [console_privacy](console_privacy.md) | Staff console data visibility | [Staff permissions and view scope](../staffPermissions.md) |
| [console_views](console_views.md) | Staff member views | [Member inspector and photo reads](../consoleMemberView.md) |
| [engine_rules](engine_rules.md) | Matching rules and outreach budgets | [Matching budgets and cooldowns](../matchingBudgets.md), [dating radius](../datingRadius.md) |
| [identity_sagas](identity_sagas.md) | Phone ownership and account changes | [Phone change lifecycle](../phoneChange.md), [account privacy](../accountPrivacy.md) |
| [join_age](join_age.md) | Membership and age | [Shared-line enrollment](../textEnrollment.md), [member age](../memberAge.md) |
| [join_flow](join_flow.md) | Browser signup | [Current site enrollment](../siteEnrollment.md), [member age](../memberAge.md), [phone verification limits](../otpLimits.md) |
| [matching_engine](matching_engine.md) | Matching, interviews, and job seats | [Judgment passes](../judgmentRun.md), [judgment cache and attempts](../judgmentAttempt.md), [matching questions](../engineAsks.md), [global selection run](../selectionRun.md), [Slop assignment rounds](../slopAssignment.md), [Slop onboarding](../slopOnboarding.md), [Peon capacity](../peonCapacity.md) |
| [notify_capital](notify_capital.md) | Inbox and network capital | [Notification delivery](../notificationDelivery.md), [digest dispatch and rechecks](../notificationDispatch.md), [reading and acknowledgements](../notificationAcknowledgement.md), [capital ledger](../capitalLedger.md), [capital levers](../capitalLevers.md), [attendance events](../meetingSettlement.md) |
| [oauth_mcp](oauth_mcp.md) | Connector authorization and member tools | [Browser authorization](../oauthBrowserAuthorization.md), [connector grant issuance](../oauthGrantIssuance.md), [token lifecycle](../oauthTokenLifecycle.md), [signup draft](../mcpSignupDraft.md) |
| [observatory_sync](observatory_sync.md) | Staff console synchronization | [Snapshot and delta lifecycle](../observatorySync.md) |
| [opportunity](opportunity.md) | Proposal, review, and response | [Member requests](../memberRequest.md), [opportunity lifecycle](../opportunityLifecycle.md), [probe dispatch and settlement](../probeDispatch.md), [review deadline](../reviewDeadline.md), [probe reply](../probeReply.md), [booked meeting settlement](../meetingSettlement.md) |
| [outbound_queue](outbound_queue.md) | Outbound queue and delivery receipts | [Outbound admission](../outboundAdmission.md), [provider receipt lifecycle](../outboundReceipt.md), [outreach cap](../outreachPolicy.md), [participation budgets](../participationBudgets.md), [quiet hours](../quietHours.md) |
| [phone_identity](phone_identity.md) | Phone number identity | [Phone change lifecycle](../phoneChange.md) |
| [photo_relay_item](photo_relay_item.md) | Selected-photo delivery | [Selected-photo request and review](../photoRelayReview.md), [selected-photo claim and fetch](../photoRelayItem.md) |
| [photos_rating](photos_rating.md) | Photo storage and private ratings | [Photo eligibility and limits](../photoPolicy.md), [upload and retention](../photoRetention.md), [asynchronous rating lifecycle](../photoRating.md) |
| [plan_crew](plan_crew.md) | Crew invitations and sessions | [Crew offer state machine](../crewOffer.md), [formation rules](../planDecision.md), [Friends weekly pass reservations](../friendsWeek.md) |
| [plan_run](plan_run.md) | Group plans and fallback | [Single-slot plan formation](../planFormation.md), [plan reply, fallback and allowance](../planDecision.md), [plan dispatch](../planDispatch.md), [Friends weekly pass reservations](../friendsWeek.md), [booked meeting settlement](../meetingSettlement.md) |
| [profile_learning](profile_learning.md) | Suggestions from connected sources | [Source collection and cleanup](../profileSuggestionSource.md), [suggestion review state machine](../profileSuggestionReview.md) |
| [profile_read](profile_read.md) | Read a saved profile | [Saved-profile read](../savedProfileRead.md), [profile isolation and app leave](../savedProfileJourney.md), [suggestion review](../profileSuggestionReview.md) |
| [relay](relay.md) | Relay between matched members | [Consent timing and verdict](../relayDecision.md), [item lifecycle](../relayLifecycle.md) |
| [review_desk](review_desk.md) | Staff review desk | [Staff review interaction](../staffReview.md), [server review deadline](../reviewDeadline.md) |
| [runtime_ops](runtime_ops.md) | Runtime work, retention, and alerts | [Stored units and tick follow-up](../runtimeUnit.md), [backend tick and shutdown lifecycle](../backendLifecycle.md), [platform retention](../platformRetention.md), [Observatory timing](../operationsTiming.md), [operations alert dispatch](../opsAlertDispatch.md), [weekly bias monitoring](../weeklyBias.md) |
| [safety_trust](safety_trust.md) | Safety reports, holds, and blocks | [Safety case lifecycle](../safetyCase.md), [trust levels](../trustLevel.md) |
| [staff_console](staff_console.md) | Staff roles and console actions | [Staff request permissions](../staffPermissions.md) |
| [turn_consent](turn_consent.md) | Signed turns and carrier consent | [Carrier consent](../carrierConsent.md), [shared-line consent journey](../sharedLineConsentJourney.md), [signed inbox and recovery](../signedInbox.md), [webhook queue](../webhookInbox.md), [signed receipt processing](../turnReceipt.md), [shared agent context](../sharedContext.md) |
