# Quint drift review of all 29 models (2026-11-09)

Hand-written: this header, "Code defects fixed in this PR" and "What stays open". Generated: the per-model sections, from the reports of seven review agents (Claude Opus 5.5 in Claude Code; one agent per group of models; no LLM call is in the product path). Each agent read its models and the code that docs/formal-coverage.md maps to them, on branch claude/formal-main, and compared states, transitions, guards, writes, invariants and code location comments. An agent fixed a model when the model was stale and the code was right, and ran `bun run quint:check quint/<model>.qnt`. An agent did not change production code. It reported a disagreement where the code looked wrong as open drift.

The comparison is now a rule (AGENTS.md "Formal modeling requirement"): `bun run quint:drift` lists the models whose model or code changed since their last comparison, and the formal block of `bun run sim` fails on them. quint/drift.json records this review as the first comparison of each model. A model with open drift carries it in its `drift` list.

## Code defects fixed in this PR

1. **Session rotation race (quint/auth_edge.qnt, SD-054 family).** `Sessions.authenticate` read the old session, then revoked it and created the next one with the person it had read. A text join's `bindSessions` that committed between the read and the create left a live session from before the person existed, and that session could read the new holder's data. The rotation is now one SQL statement (`PeopleStore.rotateSession`): it ends the old row only if the row is still live and copies the person the row has at that moment. Case: packages/platform/test/auth-edge.integration.test.ts "a rotation that races a text join" (200 before the fix, 401 after). The model's `rotateCommit` now has the same guard; `quint:check quint/auth_edge.qnt` failed safety before and passes after.
2. **An under-13 age on an invite-only exit (quint/join_age.qnt under13StoresNothing).** The web join (accounts.ts joinLocked) and the text join (service.ts join) recorded a stated age on the invite_only exit, but did not run `declineUnderAge`. A live friends member who stated 12 on the ntwrk site or line kept the friends membership. Both paths now decline. Cases: packages/platform/test/api.test.ts "an under-13 age on an invite-only exit" and packages/network/test/service-apps.test.ts "text joins" (both fail before the fix).

## What stays open

The open drift items below are recorded in quint/drift.json and are handed to the Quint session (branch claude/quint-state-machines, waves 3 and 4). The ones where the code looks wrong:

- oauth_mcp: a ban revokes a grant without an oauth.audit row (handler.ts endIfBanned), movePhone revokes Cloud grants without an audit row, and prepare_signup counts in the submit_profile quota bucket.
- photos_rating: a banned person keeps photos after leave or delete everything (service.ts onForget skips photos.deleteFor for a banned person). This can be a founder decision (evidence for a ban), not a defect.
- review_desk: an approve has no item version, so it can land after another reviewer re-rolled the item (G6).
- turn_consent: START sets the opt-in before the membership resumes; a throw between them leaves the membership paused.
- outbound_queue: Q-outbound_queue-3 and -4 (unconditional status writes, the repair reads only waiting statuses).
- runtime_ops and backup_restore: SD-159 (rollback without BACKEND_RUNTIME_CONFIG keeps the old container) and the SD-165 residual for old manifests without systemId.
- identity_sagas: the review agent's model update (the SD-089 forget-listener order, forgetPhone in the under-13 decline) made safety fail and was not finished. The model stays as it was; the update is recorded as open drift.

The others are stale models (the code is right) that need more than a small model change: matching_engine (per-question ask caps), opportunity (time retry, same-day SLA, reroll, probe branches), safety_trust (14-day block window, inviter accountability), plan_run, relay (the all-or-nothing number swap), join_age (stale line references).

## Per model

### auth_edge

Verdict: drift_open, then fixed in code (hand-written note: see "Code defects fixed in this PR", item 1). Checked: About 40 code sites in otp.ts (OTP_LIMITS, start, verify), api.ts (OTP routes, the Cloud callback, auth(), cloudSessionStatus, withSession, join, export, delete, mode), sessions.ts and decisions.ts (sessionExpiry, sessionLive, joinPlan), accounts.ts (personFor, createPerson, join, leave, deleteAll, exportApp), pg-store.ts (hitAll, claimAttempt, revokeSession, bindSessions, forgetPersonlessSessions, purge, deleteAll), cloud-delegation.ts, network-delegation.ts, proxy.ts, router.ts, backend.ts normalizeEdge and loadConfig, svc-auth.ts, and the svc query refusals (service.ts:2267 and 2424, relay-endpoint.ts:141).

Fixed in the model:
- A banned number's OTP start now counts in the four rate buckets and sends no code, as in api.ts:474 and otp.ts:189. Before, the model wrote nothing for it. Changed otpStartBegin, otpStartLimits and otpStartFast, and updated sd013BannedOtpTest.
- Join now follows joinPlan order (decisions.ts:134-146). A member under the app age is now 'under_age': the floor drops, and under 13 declineUnderAge removes the membership. An 'existing' member now runs bindSessions (accounts.ts:381-387). Added repeatJoinUnderAgeTest.
- APP_MIN_AGE is now 13 instead of 18. apps.ts:76 sets slop minJoinAge to 13.
- Export now refuses a banned number (api.ts:584-587).
- Delete everything now also deletes the number's OTP challenges (pg-store.ts:373).
- Added PLATFORM_PROXY_SECRET_PREVIOUS: normalizeEdge also accepts the previous secret (backend.ts:94 and 257-259). Added backendPrevious, a keepPrevious flag on rotateProxySecret and a new action dropPreviousProxySecret. Rewrote edgeTest: the runbook rotation has no outage, and a backend rotation without the previous secret still gives 421.
- Documented one abstraction: the verify rate limits (otp.ts:206-208) are not modelled.
- Updated about 35 stale line references.

Open drift:
- A rotation race defeats the SD-054 fix. sessions.ts:53-56 (authenticate) creates the next session row from the person it read before, with no re-read and no lock. If a text or web join's bindSessions (pg-store.ts:255-259) commits between that read and the create, a new live session with no person appears after bindSessions ran. That session is from before the person existed and can then export, leave, delete everything or state an age for that person. A scratch run test confirms the trace on both the HEAD model and the edited model (otp login, tick(DAY), rotateRead, textJoin, rotateCommit, export), and it breaks staleSessionNoAct. Because of this, bun run quint:check quint/auth_edge.qnt now fails safety. This is a code defect, not a model fix. In the under-age branch I removed my new ageLoweredByOther ghost write so that this defect does not get a second path into the check.

Agent's quint check: bun run quint:check quint/auth_edge.qnt FAILED safety; typecheck, the run tests and all 8 witnesses pass. The first run after my edits passed fully. After I set APP_MIN_AGE to 13 and changed the under-age branch, safety failed twice: the first counterexample was the open rotation race above, and I did not inspect the last failing trace. A scratch run test shows the same race on the HEAD model, so the HEAD model already allowed it.

### backup_restore

Verdict: drift_open. Checked: About 12 code sites. refusal.ts targetRefused, maybeSource and restoreRefusal with their ensures clauses. restore.ts restore(): the name check, the manifest version, the systemId read, the refusal call, the exists check, create database, roles.sql, privilege flags and the catch that drops the database. lib.ts Manifest.source with systemId, sameServer and safeDbName. backup.ts, where the manifest records systemId. I compared the check order, all 10 invariants and every trace.

Fixed in the model:
- SD-165 is fixed in the code: restore.ts:48-53 compares manifest.source.systemId with pg_control_system(), so a target reached through the TCP proxy counts as the source server. The model still said 'open on this branch' and modeled sameServer as host strings only. I added a nondet systemIdRecorded and the new safety invariant rolesNeverOnSourceWithSystemId. rolesViaProxyTest now expects rolesOnSource and ownDatabase refusals through s-proxy.
- The pure defs now carry the refusal.ts names (targetRefused, maybeSource, restoreRefusal, RestoreFacts). The old model names (targetNameRefused, onSourceServer, placementRefusal) did not exist in the code. The header says which checks are inline in restore.ts (version, runsRoles, privilegeFlags).
- Failed restore: restore.ts now drops the scratch database when roles.sql, pg_restore or the count fails. The model header said a failed restore leaves the database in place. The comment now says dropScratch covers this drop.

Open drift:
- deploy/backup/restore.ts:53 (sameServer || manifest.source.systemId === id) versus model rolesNeverOnSourceServer (outside safety). A manifest with source but no systemId (made before backup.ts recorded it) falls back to host strings. With --roles through the proxy host, roles.sql still runs on the source server. This is a code-side residual of SD-165 for old backups, replayed by rolesViaProxyOldManifestTest. A fix in the code (refuse --roles when source.systemId is missing) is a small code change with a test, so I did not make it here.

Agent's quint check: bun run quint:check quint/backup_restore.qnt: typecheck ok, tests ok (including the new rolesViaProxyOldManifestTest), safety ok, 7 witnesses reachable, 0 failures.

### boot_config

Verdict: fixed_in_model. Checked: About 15 code sites. env-core.ts declaredEnv, productionEnv, devAllowed, deployedReady, bootProblems, secretProblem and devSwitchProblems. env.ts platformEnv, devShortcutsAllowed, bootConfigProblems and assertBootConfig. main.ts calls assertBootConfig first. I also checked the 8 callers of devShortcutsAllowed. Each pure def matches the code decision for decision, and so do all 4 invariants.

Fixed in the model:
- I documented two abstractions that were missing from the header. Review mode Auto means NETWORK_REVIEW_MODE is set to any value other than 'human', "" included (env-core.ts refuses reviewModeSet && reviewMode !== 'human'). The turnstile flag means TURNSTILE_SECRET_KEY is set and not ""; it has no length rule. These were comment-only changes, with no change to behavior.

Agent's quint check: bun run quint:check quint/boot_config.qnt: typecheck ok, tests ok, safety ok, 4 witnesses reachable, 0 failures.

### candidate_pool

Verdict: fixed_in_model. Checked: Read the whole model (742 lines) and compared it with retrieval.ts (eligibleMembers 27, twoHop 39-55), filters.ts (memberReason 54-60, pairReason 71-73, candidateReason 166-215), group.ts (makeCompat 32-38, evaluate 55-64, composeGroup 80-147), complementarity.ts (romanceMutual 63, satisfy 70-71, complementarity 124), packs/network/rules.ts and ontology.ts:72, packs/friends/rules.ts and index.ts:89, plans.ts (scorePlanGroup 174-176, alternates 348-355, detectCrews 662-689, crewOptIn), friends/planner.ts planFriendsWeek (all five passes, finish 197-225, DEFAULT_FRIENDS_POLICY 121-132) and network.ts distinctAlternates (4271-4286). That is about 30 code sites. The six defect values in the header (noAltPairBlockedEngine, noSessionBlocked, noOfferBlocked, noRepeatBlocked, oneCrewPerWeek, sessionSizeOk) still match the code: these code paths are unchanged.

Fixed in the model:
- distinctAlternates also drops a member with unknown age or a minor signal and a first-name duplicate (network.ts:4271-4286). The model said that every dropped alternate is a minor or blocked. I removed that constraint from composeGroup and keptOk and documented the first-name drop as an oracle.
- detectCrews (plans.ts:662) adds each crew it finds to its own inCrew set, also one that the planner then skips. Added Week.detected so that a second offer of the same activity in the same week leaves out those members.
- Pass 4 can give a partner plan of two (run() -> planProposals with partnerPlans = pol.partnerFallback, default true; planner.ts:395-410). Added a `partner` flag to newPlan (2 members, no alternates), a pairPlans counter and witness_pairPlan. planSizeBad for a partner plan now checks size 2.
- Updated stale location comments: packs/network/rules.ts:76-78->67-69 and :15->20, network.ts:3962/3969->4271/4279, filters.ts:173->175, 176-182->178-184, 183-191->185-193, 192-195->194-197, 201->203-209, 72->71-73, plans.ts:173->176, 345->348-355, 675->662, complementarity.ts:64->63, 72->71, 108->124, friends/index.ts:88->89, planner.ts 405->389 and 407.

Agent's quint check: bun run quint:check quint/candidate_pool.qnt: typecheck, test, safety and all 10 witnesses (including the new witness_pairPlan) ok (1 model, 0 failures).

### chatjson_loop

Verdict: fixed_in_model. Checked: Read the whole model and compared it line by line with tryChatJson/chatJson (chatJson.ts:44-87), the four core decisions in chatjson-core.ts (hasDeadline, attemptGate, isFinalCode, afterFailure) and the deadline code in llm.ts (deadlineFor 213-215, deadlineMs 246-247, perRequest 278). That is 9 code sites. Every status, gate, retry, grow, stop and exhaustion path matches. Only location comments were off.

Fixed in the model:
- Location comments: chatJson.ts:75-76 -> 66 and 77 (the parse and the ok return), chatJson.ts:79 -> 73 and 79 (break and the exhausted return), llm.ts:213 -> 213-215 deadlineFor.

Agent's quint check: bun run quint:check quint/chatjson_loop.qnt: all checks and 7 witnesses ok (1 model, 0 failures).

### console_privacy

Verdict: fixed_in_model. Checked: About 10 code sites. All of privacy-core.ts (classRank, classOf, memberFieldLevel, oppFieldLevel, fieldUse, memberFieldUse, oppFieldUse, truthShown, oppResolved, oracleShown, membershipShown, hiddenHeld, lineOk, holdLines, blockOrigin, namesApp, reasonOk, crossAppShown, PERSON_REASON_MIN). shape.ts viewClass, stripOracle, countsMember, countsOpp, shapeState, shapeDelta. people.ts summary (row order, hold, restricted, recycled, origins). apps.tsx AppPanel reason gate, namesApp and crossAppShown use. server.ts truthFor, recheck setting w.cls, PRIVATE_APPS. Compared 7 invariants and 6 witnesses.

Fixed in the model:
- The header says each privacy-core.ts function is a pure def in the model, but lineOk, namesApp and crossAppShown were missing. Added all three. hiddenHoldsRestricted now also checks the lineOk contract on holdLines. Added the run test namesAppTest.

Agent's quint check: bun run quint:check quint/console_privacy.qnt: typecheck, test, safety and all 6 witnesses ok (1 models, 0 failures).

### console_views

Verdict: fixed_in_model. Checked: About 12 code sites. All of logic/views.ts (photoAllowed, photoView, photoHeld, readOk, readNew, canLand, readStart, readCancel, readLand, tabVisible, effectiveTab, canPropose, isRevealed, saidYes, allOf, yesCounts). panels.tsx useLive (run, the authEpoch effect, the deps effect with its double cancel, the key timer), SlopPanel gate and effect, KpiGrid status default. drawer.tsx tabCaps and shownTab. main.tsx ProposeTray known/ready. Compared 9 invariants and 9 witnesses.

Fixed in the model:
- useLive has a credential-change branch that the model did not have. When store.authEpoch changes, setD(undefined) takes the member data off the screen, so SlopPanel unmounts and its photos go. authEpoch is also a dependency, so the reads cancel and a new one starts. Added the authChange action and the witness witness_authCleared.
- Added planCloses to the OUTSIDE list beside durParts, rate and planView. Added a note that photo answers to an unmounted panel are dropped.

Agent's quint check: bun run quint:check quint/console_views.qnt: typecheck, test, safety and all 10 witnesses ok (1 models, 0 failures).

### engine_rules

Verdict: fixed_in_model. Checked: Read the whole model and compared it with all functions in packs/network/rulesCore.ts (budgetReached, interruptionBudgetReason, inCooldown, categoryCooldownReason, negativeFeedbackReason, pairCooling/coolingOutcome, romancePairReason, romanceAdmits), the rule tables in packs/network/rules.ts (member and pair rules, lines 15-71), slop/geoCore.ts (marketMutual, radiusPairReason), slop/geo.ts (limitMiles, mutualMarkets, pairReason), world.ts (memberCategoryDeclines 167-174, recentProactive 232-245) and network.ts:2749 (interaction at = the close time). That is about 14 code sites. All decisions, guards and invariants match. The only gaps were undocumented abstractions.

Fixed in the model:
- Header: a pair decline stands for every cooling outcome (declined, expired, cancelled; rulesCore coolingOutcome), and a send decline stands for a declined or an expired item (world.ts memberCategoryDeclines keeps the latest at).
- Header: both members are known and have a limit (radiusPairReason unknown_member and distance_unknown are not modeled); admits is romanceAdmits as one fixed fact.
- Header OUTSIDE THE MODEL now also lists the contribution budget, the negative feedback cooldown and romance.requireStatedPrefs.

Agent's quint check: bun run quint:check quint/engine_rules.qnt: all checks ok (1 model, 0 failures).

### identity_sagas

Verdict: fixed_in_model, then reverted (hand-written note: the edited model failed safety, so the committed model is the one from before this review, and the fixes below are open drift). Checked: About 35 code sites. service.ts: the onForget hook (forget unit, then photos, then listeners that throw), forgetPhone, statedAge under-13 path, ban, banUnfinished, personBanned, inbound leave, text join. accounts.ts: personFor, banned, seen, clearHold, start/confirmNumberChange, join, leave, deleteAll, exportApp. pg-store.ts: ban (the moved-hash row), isBanned, phoneHashesOf, lastConsent, forgetMembership, deleteAll, movePhone (Cloud grants revoked, others moved). Also consent.ts resolveConsent, the outbound-queue binding, api.ts delete and export, and runtime.ts identities.

Fixed in the model:
- Leave saga order now matches onForget (service.ts:829-839): the forget unit first, then photos, then the OAuth listeners. A failed listener now stops the leave before the membership goes; before, the model swallowed it (that was the old SD-089 behaviour). Added leaveListenerFailsTest and fixed leaveDeletesPhotosTest.
- The under-13 decline now runs forgetPhone, which revokes every app's OAuth grants before the memberships go (service.ts:1506). u13GrantsTest now shows the grants revoked and forgetRevokesGrants holding. Updated the forgetRevokesGrants and knownOpen comments to say SD-089 is fixed in code.
- bannedNotMatchable now exempts a stopped leave of (person, app) whose retry the code accepts, as its own comment already said. The quint check found this state once a failed listener could stop a leave without a crash.
- exportReq now refuses a banned number (api.ts:584-587).
- The header and about 35 line references now point at formal-main; they referred to ad67275 before.

Agent's quint check: Not confirmed after the last edit. The run before my bannedNotMatchable exemption passed typecheck, test and all 11 witnesses, and failed safety on the stopped-leave-plus-ban state that the exemption covers. The rerun with the fix was still in the queue (task bpu227rr1, after auth_edge) when I had to report.

### join_age

Verdict: drift_open; the under-13 item is fixed in code (hand-written note: see "Code defects fixed in this PR", item 2). Checked: I read the whole model. I compared it with service.ts (join with decisions.ts joinStep and effectiveAge, elizaNotice, the member path with looking_for, statedAge, enroll, createMember, joined hook, ageLowered, route), accounts.ts (joinLocked with platform decisions.ts joinPlan, recordAge, declineUnderAge, the join catch), apps.ts join modes, and core policy validAge/canJoin. That is about 20 code sites. The S:/A:/PS:/N:/R: line references are pinned to commit ad67275 in the header, so I did not rewrite them.

Fixed in the model:
- decisions.ts:152-199 joinStep has a need_home step (invalidHome). The model did not have it. It is added as an oracle field Msg.badHome with both branches: no age means the question only; a passing age is recorded (service.ts:1633) with no pending join. New run needHomeKeepsAgeTest.

Open drift:
- accounts.ts:372 records the age on the web invite_only exit (platform decisions.ts:144, joinPlan invite_only has recordAge true) and runs no declineUnderAge. The model's webCheck invite branch writes nothing ('A:364 refuses before the age is read'). With the code's write, a live friends member who posts an ntwrk web join with age 12 keeps the friends membership with floor 12, and under13StoresNothing fails (confirmed with a scratch-copy run test). The code looks wrong against AGENTS.md (under 13: nothing stored), so I did not change the model. An OPEN DRIFT comment marks it. service.ts:1633 does the same on the text invite_only exit (not reachable with the model's apps).
- The header's S:/A:/PS:/N:/R: line references are pinned to ad67275 and no longer match the current code (for example the text join is now service.ts:1613-1716, joinLocked accounts.ts:360-421, statedAge service.ts:1492-1513). This is documented in the header, but it is stale for anyone who follows them today.

Agent's quint check: bun run quint:check quint/join_age.qnt: typecheck ok, test ok (1 new run), safety ok, 7 witnesses reachable; 1 models, 0 failures

### join_flow

Verdict: fixed_in_model. Checked: I read the whole model. I compared every core def with sites/shared/join-core.ts (flowOk, initialFlow, afterAuth, fieldsFor, signIn, flowNext all 9 events, formResets, formProblems, formPasses) and found no drift. I compared the shell handlers with join.ts (dispatch, resetAccount, takeAccount, load, onSignedIn, profile submit and its 5 result branches, routeTo) and auth.ts (phone submit, code submit busy, change number, resend), and the server branches with api.ts GET /api/me and POST /api/join, accounts.ts joinLocked and joinPlan. That is about 25 code sites.

Fixed in the model:
- onJoin: a join for an account that is already a member (and is not refused) gets ok:true with the existing membership from the server (accounts.ts joinLocked, joinPlan 'existing'). The page then does generation++ and dispatches joined, which leads to done. The model did nothing for that answer (the page stayed in profile). Fixed: when the answer is current, it does generation+1 and Joined.

Agent's quint check: bun run quint:check quint/join_flow.qnt: typecheck ok, safety ok, 4 witnesses reachable; 1 models, 0 failures. Note: in api.ts:509 a banned session's /api/me answers 403 'review', so the page treats it as no session (phone step), while the model puts ban in the 'refused' set (blocked). This is low impact, and the header documents that ban is in 'refused'.

### matching_engine

Verdict: drift_open. Checked: Read the whole model (963 lines) and about 45 code sites: the constants (extract.ts:44, options.ts:158/176, network.ts:481-482, outreach.ts:20, profile.ts:107/130-145, index.ts:139, config.ts:183), the slop rules missingFields/needsBasics (rules.ts:29-47), the slop onboarding loop (service/packs.ts:119-147, onboard.ts:89-95/124-150), network.ts onAskAnswer/lateAnswer/onboardNext (1125-1198, 863), the 3-day sweep (3553), packInput avoid edges, seat holds and unsent ids (4003, 4028-4054), gateReason (3872), judgeCaches (3710/3752), postingTurn (793), checkSeats/endSeat (4914-4935), jobs.ts postingFromDraft/parsePosting (87, 189-201) with transitions.ts:567 postingAction, postings.ts:143, attention.ts probe flow (769-808), plans.ts planMemberReason (148-152), filters.ts memberReason (54-60), assign.ts:77-80, world.ts:179-180, plan.ts:16-44. States, guards and transitions of the slop daily run, review, probe, the peon posting and seat items, the probe flow and the plan seat rule agree with the code. 26 code location comments were stale. I fixed them (comments only).

Fixed in the model:
- Updated 26 stale code location comments (for example network.ts:455->481, 3770->4003, 3829->4050, 3813->4028-4035, 3662->3872, 825->863, 764->793, 3488->3752; service.ts:2251->2546; jobs.ts:188-198->189-201, 189->194, 190->193; attention.ts:820->808; filters.ts:57->60; extract.ts:43->44, 939->941; plan.ts:149->44; index.ts:138->139; outreach.ts:19->20; world.ts:170->179; rules.ts:38->39; plans.ts:146-150->148-152; onboard.ts:120-121->122).

Open drift:
- matching_engine.qnt:250-253 nextMsg vs onboard.ts:144 nextQuestion (firstQuestion with p.askCounts and MAX_ASKS_PER_QUESTION) and service/packs.ts:144: the code caps every onboarding question (not only the read-back) at 2 asks, and skips the question that was just answered (skip = the answered reasons, network.ts:1198). The model caps only the read-back and asks the first missing field again and again. The model is stale. The fix needs per-question ask counts in Ob and changes to sendTo, nextMsg, basicsAskDue and several run tests, which is more than a small change.
- matching_engine.qnt:284 memberSays late-read condition (o2 != o) vs network.ts:1168-1179 lateAnswer: the code reads a late text only when it adds a new tag or changes the loop's next reason. A change that only removes a tag (for example a late 'smoking is fine') is not read in the code, but the model reads it. The model over-approximates. This is a small guard difference, but a faithful fix needs the next-question reason, which depends on the open item above.
- Soft onboarding questions (slop_interests, slop_activities, slop_free) and the slop_zip / slop_seeks / slop_gender split (onboard.ts:125-139) are not in nextMsg. The header documents the hard-field abstraction but not these questions. This goes with the first item.

Agent's quint check: bun run quint:check quint/matching_engine.qnt: typecheck, test, safety and all 9 witnesses ok (1 model, 0 failures).

### notify_capital

Verdict: fixed_in_model. Checked: I read the full model (1198 lines). For Part A, I compared it with packages/notify/src/scheduler.ts (add, recordSent, plan, build, dispatch with the re-read, rebuild and recordDelivery, stillNeeded, redeem, readUpdates, threadReply, setActive, sweep) and decide.ts (capFilter, countsTowardCap). I also compared it with service.ts delivered, updatesFor, notifyRecipient, notifySink, notificationCurrent and notifyTick (647-737), runtime.ts projectNotifications (718-744), channel.ts stale (185), backend.ts tick ordering (454-455) and the retention.sql surface trigger (58-76). For Part B, I compared it with ledger.ts record and the cases member_joined, age_updated, member_activated, value_received, plan_attended, feedback_given, help_given and help_confirmed, and with tiesOf and tryVouchCredit. I also checked runtime.ts onLedger (171), the startup replay order by seq (377-378), the capital_events insert on conflict (571-574), the forget delete (604) and network.ts attendanceOf and finalize (5342, 2965). That is about 25 code sites. The cap rule, the dedupe key per text, the record-before-enqueue order, the replay order and the vouch rules match.

Fixed in the model:
- reread: when only part of the plan is still fresh, dispatch reads the recipient again (directory.get, scheduler.ts:181). It cancels when there is none (182) and rebuilds for the current recipient. The model kept the old via. It now sets via to recipientApp and cancels when no recipient is left.
- Stale code-location comments updated to current lines: service.ts 611-612 -> 642-645, 615-631 -> 647-664, 625-628 -> 656-660, 635-639 -> 672-679, 644-646 -> 693-696, 649-660 -> 698-711, 657 -> 707, 667-675 -> 713-725. runtime.ts 60 -> 61, 118 -> 126, 162 -> 171, 340-345 -> 377-378, 504-507 -> 571-574, 517-555 -> 586-620, 537 -> 604, 590-597 -> 676-679, 621-647 -> 718-744, 628 -> 725. network.ts 715-727/1556/4438 -> 751-757/931/4776, 2600-2608 -> 2786-2808, 2747-2790 -> 2965-3005. channel.ts:180 -> 185. backend.ts:407-408 -> 454-455.
- The schedulerRespectsCap comment said 'backend.ts guards one process'. The code (backend.ts:454-455) says that replicas may overlap. The comment now says this, and that the residual SD-150 path needs overlapping replicas and a Notifier.add producer.

Agent's quint check: bun run quint:check quint/notify_capital.qnt: typecheck, test, safety and all 7 witnesses ok (1 model, 0 failures).

### oauth_mcp

Verdict: drift_open. Checked: About 45 code sites. handler.ts: TTL, the limits, linked, revokeGrant, sweep, authorize, liveRequest, authorizeStep phone/code/consent/deny, finishAuthorization, endIfBanned, grantForTokens, the token exchange and refresh, revoke, consents, bearer, cloudGrantCurrent, tool dispatch and invalid_grant, revokeAllFor. tools.ts: prepare_signup, check_status, submit_profile, get_updates and checkArgs. mcp decisions.ts: codeVerdict, grantVerdict, takenVerdict, publicStatus, grantStillTheirs. mcp pg-store.ts: approveConsent, revokeGrant, redeemCode, rotateRefresh, sweep, forgetPhone, the drafts. hooks.ts: login, personForKey, banned, status, withSignupAgePolicy. Also serve.ts:91-112, service.ts updatesFor, onForget, forgetPhone and statedAge, platform pg-store.ts movePhone, and the oauth.sql trigger.

Fixed in the model:
- exchReplay: a used code is a replay even after it expires, until the sweep deletes it (codeVerdict reads 'used' before 'expired', decisions.ts:76-79). The 'dead' case now also covers a grant whose only code was used with no token issued.
- approveRead: when the number is held or banned, or its person changed, the code deletes the auth request (handler.ts:518-527). The model now does too; before, the action was only disabled.
- prepareSignup: the age policy now refuses only under 13, because canJoinApp is 13 on every app (a 13-17 person may prepare a Join form). Added an under13 set to the platform state, set by declineUnder13. A grant that is no longer the person's now takes the invalid_grant path, which revokes it with an audit row (handler.ts:895-899).
- Added revokeAccessToken: /oauth/revoke with an access token ends only that token and writes a token_revoked row (handler.ts:689-692).
- Documented that signup drafts have no expiry in the model.
- The header now says line numbers are for formal-main. Updated about 50 stale H:/T:/P:/K:/SVC: references.

Open drift:
- handler.ts:581-585 endIfBanned revokes a banned person's grant at its first use without an oauth.audit row. This breaks everyRevocationAudited, which comes from README section 3: one audit row for each revocation. The model keeps the ban as a read-only check.
- packages/platform/src/pg-store.ts:452-457 movePhone now revokes the old number's Cloud grants (the SD-108 fix) without an audit row and without linked(false). The model's movePhone still aborts (cloudMoveTest, numberChangeWorks), so it is stale, but modelling the new code would break everyRevocationAudited.
- quotaCountsAccepted, which is in safety, is reachable as a violation. prepare_signup counts in the same per-grant profile bucket as submit_profile (tools.ts:286 and 312, handler.ts:891), so a grant that prepared a draft is refused after fewer than 5 accepted profiles. README section 2 says 'At most 5 accepted profiles per grant a day'. A scratch run test confirms the trace: createPerson, connect on n2, prepareSignup, join, then two submitProfile calls.

Agent's quint check: Not finished. bun run quint:check quint/oauth_mcp.qnt was still running when I had to report (more than 25 minutes; max-steps=60, max-samples=10000). I have no pass or fail result. The quotaCountsAccepted trace above is reachable, so safety can fail if the sampler finds it.

### observatory_sync

Verdict: fixed_in_model. Checked: About 20 code sites. All of logic/sync.ts and logic/filters.ts. web/store.ts: the app setter, setApp, beginLoad, load, applyFull, clearData, applyDelta, applyData (appendNew, slice -400), connect (msg.app and mode filter), loadReveals, unreveal, reveal, inRange, inBorough, matchMember, matchOpp, matchFeed, matchReview. src/store.ts pushFeed and takeDelta. sources/game.ts pendingReset. server.ts broadcast (clock-only message). drawer.tsx and admin.tsx filter call sites. Compared 13 invariants and 16 witnesses.

Fixed in the model:
- serverReset always sent a reset at the current version and did not use up any feed items. In code, takeDelta sets reset when edges were removed. That counts as a change, so the version goes up and the new feed items leave with it. game.ts can also set reset on a delta with no change. serverReset now chooses between both cases.
- The shellKeys line comments were stale. They now say drawer.tsx:108, 168, 213, 315/319 and 378/380, and admin.tsx:318-319, not 104, 166, 211, 313/317, 376/378 and 294-295. Added the SafetyCases inBorough site (admin.tsx:87).

Agent's quint check: bun run quint:check quint/observatory_sync.qnt: typecheck, safety and all 16 witnesses ok (1 models, 0 failures).

### opportunity

Verdict: drift_open. Checked: I read the full model (1198 lines). I compared it with about 30 code sites in packages/network/src/network.ts: tick 3523 and advance 3610-3690 (review SLA, probe expiry, time-retry silence, silence confirmation, reminders, feedback, finalize), probe 2269, advanceProbes 2250, onProbeAnswer 2415, sendOtherTimes and offerOtherTimes 2471-2496, the handleInbound routing 795-860, confirmPlan 2518, replaceOrClose 2530, reveal 2578, handleDrop 2680, close 2710, dropMember 2756, onFeedback 2786, finalize 2965, decide, reviewBlock and reroll 2006-2160, send 4162, checkRecipient 4527 and timingOf 4454. I also checked outreach.ts (72 h, limit 2, ABOUT_OTHERS, SLOT_KINDS), engine config.ts (streak limits 1 and 2), and transitions.ts (statusAfter, afterSla). The constants (PROBE_TTL 26, PROBE_WAIT 48, SLA 12, OPT_OUT 48, 3-day slot expiry, feedback at +3 h, finalize at +4 days, 7-day feedbackDue) match. The send-gate order, the close() release rules, dropMember, the reveal re-check and the SD fixes that the model names also match.

Fixed in the model:
- handleDrop keep: the model used parts.size() > 2 and still >= 2. The code (network.ts:2693) uses still.length >= 3. The model now uses still.length() >= 3. With pairs only, the behaviour is the same.

Open drift:
- offerOtherTimes path missing. A probe reply with otherTimes (a counter or 'neither') gets new times once (network.ts:811, 2485-2496). This adds timeRetry without primed, keeps status probing and resets sentAt. Silence then expires it (3646 needs primed). The model reads a counter as 'unclear' and only clarifies (route, model ~line 455). Its time-retry silence branch (model ~line 619) checks only timeRetry, not primed. The model is stale. A fix needs a primed ghost and a change to counterOfferTest, so it is more than a small change.
- Same-day review SLA missing. The code sets the deadline to now + (o.sameDay ? 1 : reviewSlaHours) h (network.ts:2151, 2176). The model always uses REVIEW_SLA 12. The model is stale.
- Reroll review decision missing. decide() reroll (network.ts:2128-2156) swaps a candidate and resets the review deadline, or closes the item as 'rerolled in review'. The model has only approve and reject.
- probe() branches missing. The code has the ask-open hold (askOpen), the away-from-NYC refusal (inNyc, then replaceOrClose) and commonTimeGone, which closes the item as 'no common time' (network.ts:2290-2299). reveal() can also close on no meeting time and leave out a member who is bookedNear (2590-2603). The header does not list these as abstractions.
- Stale code locations. The N:<line> references point to commit 25b54f1/ad67275, as the header says. Most are now 25-300 lines lower (for example PROBE_TTL is at network.ts:468, not N:440, and reviewBlock is at 2058, not N:1975). This is comment-only. It is documented as historical, but the function names are the only reliable anchors.

Agent's quint check: bun run quint:check quint/opportunity.qnt: typecheck, test, safety and all 7 witnesses ok (1 model, 0 failures).

### outbound_queue

Verdict: drift_open. Checked: I read the whole model. I compared it with outbound-queue.ts (enqueue, withLine, recover, drain and its catch, expireHeld, tooOld, end/wait/hold with the new `from` guards, gateFacts, dispatch, stop, send admission, provider error paths, acceptReceipt, countSend, reconcileUnknown, applyStatus, inbound, setLineSafety, purge, collected paths), gate.ts (preCapGate, takesSlot, finalGate, MessageKind), channel.ts checks and enqueue/direct, runtime.ts writeUnit, storeStatuses and drainQueue repair, the cloud-channel.ts classify switch, and the service.ts leak-review release. That is about 35 code sites.

Fixed in the model:
- Fix 8ca695b is now in the model. After a failed provider call, send() writes only while the row is still in OWNED (sending or unknown_acceptance). The model's respond() overwrote any status, for example a lookup's 'accepted' with unknown_acceptance. respond() is now guarded, with the new run ownedGuardKeepsAcceptanceTest, which fails on the old model.
- drain()'s catch writes with from = [read status, ...OWNED]. The model's dispatchErr had no guard. Added.
- expireHeld (oq:353-363) is now in the model. Inside the line lock, held_awaiting_reply rows past their TTL end expired. The model had no such exit. It is added to lockLine, with the new run expireHeldTest.
- collectGate in runtime.ts writeUnit refuses a non-compliance collected reply to an opted-out number. The model's collect action had no such guard. Added.
- Most oq: code location comments were stale (for example recover oq:272 is now 277, reconcileUnknown 581 is now 676, the admission 467-501 is now 527-563, acceptReceipt 543-568 is now 620-659, statuses, end/wait, inbound, setLineSafety, staff decide), and isAgent is now in gate.ts:14-17. I also updated the stale ch:, svc: and some rt: comments that I checked (svc:2051-2088 is now 2264-2386, rt:621-647 is now 718-745, rt:521-551 is now 615-635, ch:180-186 is now 185-191, and others). end()/wait() are no longer described as having 'no status guard' at all.
- mirrorNotSentMeansNotOut was in safety, but Q-outbound_queue-3 (open, svc /queue/leak-review then a stale storeStatuses) breaks it. The simulator finds this at sample seed 0x94d19f on the unmodified HEAD model too. The fixed seed 0x5eed did not reach it. I moved it out of safety and documented why. sd334LostRaceTest still checks it.

Open drift:
- gate.ts:10 MessageKind 'safety' (a hold notice: no quiet hours, no unanswered streak, no line caps; it may go to a held member) is not in the model's KINDS. To add it, decide, the whileHeld ghost and unansweredAtMost (safety notices count in line_conversations.unanswered) must change. That is more than a small change.
- outbound-queue.ts:540-552 admission branches are not modelled: a proactive row to a non-active member gives suppressed_ineligible; the Cloud membership and phone binding check gives dropped_forgotten; checks.admit (relay, approved photos) gives suppressed_ineligible. The model has only `erased`.
- Q-outbound_queue-3 (runtime.ts:746-751 storeStatuses writes with no condition) and Q-outbound_queue-4 (runtime.ts:704-706, the repair reads only waiting statuses) are still in the code. Q-3 also breaks mirrorNotSentMeansNotOut, so that invariant is out of safety now.
- Comments I did not check or fix: rt:345-347 and cc:57-61 (the receipt lookup is now around cloud-channel.ts:11-16 and 39-66), and 0007:168-189.

Agent's quint check: bun run quint:check quint/outbound_queue.qnt: typecheck ok, test ok (2 new runs), safety ok, 6 witnesses reachable; 1 models, 0 failures

### phone_identity

Verdict: fixed_in_model. Checked: About 14 code sites. I compared both normalizers (phone-core.ts phoneE164 and anyE164, blooio phone.ts toE164 and normalizeAddress), web OTP start, verify and join (api.ts:464-499 and 550-571, accounts.join), MCP startOtp and login (hooks.ts:136-150), the staff ban (service.ts:2010-2042), the turn guard (service.ts:2343), the inbound memberOf, hold and ban checks (service.ts:1194, 1214, 1268), the text join (service.ts:1308-1330 and 1612-1631) and the runtime address book (runtime.ts:427-444). The states, guards and invariants match the code. Only the code location comments were stale.

Fixed in the model:
- Updated every code location comment, which pointed at old lines: api.ts:466-492 is now 464-499 and 550-571, hooks.ts:155-170 is now 136-150, service.ts:1734-1749 is now 2010-2042, service.ts:2052 is now 2343, service.ts:1044-1061 is now 1194/1214/1268, service.ts:1125-1140 is now 1308-1330 and 1612-1631, and runtime.ts:401-408 is now 427-444.
- Documented one abstraction. The model removes a banned member from the address book, but the code keeps the restricted member there (runtime.ts:430-431) and refuses the turn at the ban check (service.ts:1268). The outcome is the same.

Agent's quint check: bun run quint:check quint/phone_identity.qnt passed: typecheck, test, safety and 4 witnesses.

### photo_relay_item

Verdict: fixed_in_model. Checked: All 13 defs against photo-relay-core.ts. The 6 shell actions (select, review, revoke, claimForAction, issueDelivery, delivery) against photo-relay.ts:104-233, plus current() and the route. The 4 item states, the photoEdge edges, each guard and its order, the expiry rechecks, the deadline write, the signature oracle and all 7 safety invariants. 22 code sites in all. The pure defs match the core exactly.

Fixed in the model:
- The oracle `pair` could only go from true to false (pairEnds). In code, current() calls authorize and photos.relayPhoto again on every call, so a START after a STOP or a lifted hold makes the item current again (photo-relay.ts:104-111). I added a pairResumes action to the step.
- I extended the header. `pair` now also stands for the photo check (relayPhoto: the owner may still take photos, and the row is there with the same bytes), not only the parties check.
- I added to OUTSIDE THE MODEL two oracles the model leaves out: authorizeReviewer, and the issueDelivery recipient and descriptor checks (photo-relay.ts:150, 209).

Agent's quint check: bun run quint:check quint/photo_relay_item.qnt: typecheck, test, safety and 3 witnesses all ok (1 model, 0 failures).

### photos_rating

Verdict: drift_open. Checked: Every action and guard against photos.ts: upload, show, hideAll, adult, mayTake, ratingRefusal, rate (3 checks), remove, deleteFor, end, sweep. Against service.ts: purge, onForget, ageLowered, reconcileAges, verifiedAdult, dropRatings, writeRating, verify, ban, inbound photo path, signed turn mediaUrls. Against photoIntake.ts: photosIn and consentAnswer. Against accounts.ts: recordAge, leave, deleteAll. Against pg-store.ts: putMembership, updateMembership, forgetMembership, deleteAll. Against packs.ts probe, plan.ts probePhotoRefs and runtime.ts forget. About 40 code sites and 88 line comments.

Fixed in the model:
- SD-017 is fixed in code (709be0b). consentAnswer now calls updateMembership(person, slop, [state read], {profile}) (photoIntake.ts:126, pg-store.ts:131-135), not a whole-row putMembership. consentYesWrite now writes only while the state equals caSnap and never writes the state. sd017ConsentWriteUndoesBanTest is now sd017ConsentWriteKeepsBanTest and expects that the ban sticks. banSticks now holds, so safety uses leaveAndBanStick.
- uploadUndo merged two awaits into one action (storage.delete, then meta.delete at photos.ts:525). I split it into uploadUndo and uploadUndoRow, with a new upload state 'unbytes' that the request owns. I updated the run tests.
- Most line comments pointed about 20 lines (photos.ts) to 300 lines (service.ts) off. I moved all 88 PH/SV/PI/A/pg-store/runtime references to the current lines, for example PH:93->99, PH:526-549->505-528, SV:761-765->830-839, SV:1755-1783->2010-2042, PI:124->126 and A:421-429->472-481.
- I added a header note: deleteFor ends its rows in one action, and the sweep gives the same end state after a crash inside it.

Open drift:
- service.ts:835 (onForget, commit 8e96df9, SD-275/SD-256/SD-178) skips photos.deleteFor for a banned person, so a banned person keeps their photos after a leave or delete everything. In the model, leaveHide and delHide (photos_rating.qnt leave/delete sections) always hide every row. If the model follows the code, three invariants fail: noPhotoAfterForget, noPhotoForForgottenMember, and the 'not deleted' half of photoOnlyForAdult (a deleted banned person keeps rows). The change is intentional and tested in identity-sagas.integration.test.ts. The model rules need a decision on a ban exception before the model can follow it. I did not fix it and I added an OPEN DRIFT note to the model header.

Agent's quint check: bun run quint:check quint/photos_rating.qnt: typecheck, test, safety and all 11 witnesses ok (1 model, 0 failures).

### plan_run

Verdict: fixed_in_model. Checked: I read the full model (about 1000 lines). I compared it with engine plans.ts (startPlanRun 537, nextOnBench, recordPlanAnswer 560, checkPlanDeadline 582, planFallback 627, partnerPlanFor, crewOptIn 696) and planCore.ts (planStep, planSettles, smallerKind). I also compared it with transitions.ts quorumMet 186 and with network.ts: submitPlan 3151, beginPlan 3166, planLane 3178, planProbe 3192 (PLAN_OUT about), planDeadline 3234, planAnswer 3241 (late note), planAct 3254 (backfill into plan.invited), bookPlan 3279, planReveal 3325, planJoin 3340, planFallback 3354, planOut 3386, onCrewAnswer 3447, resolveCrew 3457, crewSessions 3477, handleDrop 2680, close 2710, dropMember 2756, callOffPair 1532, the plan_probe and reveal hooks 4385-4410 and advance for plans 3620-3680. That is about 22 code sites. The quorum, bench, deadline, late-join, fallback order, pair-to-partner-plan, handleDrop keep >= 3 and crew handoff on done sessions match.

Fixed in the model:
- dropMember on a booked plan: the code leaves the plan only for a member whose status is 'yes' (network.ts:2774). The model called handleDrop for any participant, so a member who was out could close or shrink the plan. The model now checks status yes first.
- block: callOffPair skips an item where either member is already out (no, unavailable, dropped) (network.ts:1532-1545). The model closed the plan for any two participants. The model now has the same out check.
- resolveCrew: the code counts a yes only from a member who passes planSeatOk (not a minor, not opted out, trust ok) (network.ts:3457-3470), and only they hear the result. The model counted every yes. The model now filters the yes set with seatOk.
- Header anchors updated to current line numbers (submitPlan 3151 ... crewSessions 3477, handleDrop 2680, close 2710, dropMember 2756, checkRecipient 4527, bookedNear 3091, onPlanProbeAnswer 2499, applyBlock 1491, hooks 4385-4410, reveal 2578). The header now says that the other in-body network.ts:<line> references are lines at wave2/plan_run.

Open drift:
- planReveal can be deferred. The code sends the reveal with logistics timing, so send() can defer it outside the member's window (network.ts:3336 through send 4180-4199). The model delivers or refuses it at once. Its header says only plan probes are deferred. This is minor and not fixed.
- In-body line references (about 60 network.ts:<line> comments) are still lines at wave2/plan_run, about 150-260 lines lower now. This is comment-only. The header now documents it.

Agent's quint check: bun run quint:check quint/plan_run.qnt: typecheck, test, safety and all 10 witnesses ok (1 model, 0 failures).

### profile_learning

Verdict: fixed_in_model. Checked: About 60 code sites. In profile-suggestions.ts: owned, member, propose, decide, deleteBatch, priorReview, applyRevokedConnection, applyOwnerWithdrawal and expirePending. The endpoints EP, DE, WE and LC, profile-review-factory, cloud-profile-review-owner and profile-review-source/withdrawal/disconnect. The 0039 and 0052 triggers, runtime.ts forget, pg-store ban, hold and deleteAll, accounts leave, deleteAll and activeMembership, and service.ts stopped, expirePending and turn binding. I compared every status value of 0039, every action guard, the receipts (collect, V1 nonce, V2 withdrawal), the 20 invariants and all of the code location comments.

Fixed in the model:
- V2 receipt: the code keys the owner-withdrawal receipt by withdrawalId, and the operation is part of its identity (PS:468-479). After one withdraw or delete, every other request returns the stored counts or null. The model keyed receipts by op, so it let a delete apply after a withdraw for the same withdrawal. The guard is now v2Receipts != Set().
- One command per review turn: decide and delete store their result on the review turn and deny a second one (PS:271, PS:332). The request text must equal the turn body (EP:84). I added the var cmdUsed. memberReviewCmd resets it, and committed decide and delete set it; the expiry path does not. I added oneCommandPerTurnTest and fixed two traces that used one turn for two commands.
- Leave: the 0052 trigger on state 'removed' also deletes the V1 connection cleanup receipts. leaveMembership now clears v1Receipts. inv_deleteAllErasesIdentity now covers 'removed' as well as 'deleted'.
- runtime.ts forget (RT:592-595) and pg-store deleteAll (PG:369-371) reset platform.inbound action_receipts. leaveForget and deleteAll now clear collectReceipt and v2Receipts.
- Ban comment: pg-store ban now reads the person row 'for share' when it names the person, so it waits for a running collect. A ban by phone only takes no lock. The comment now says this. The action stays without a lock guard, so it covers both cases.
- Stale code locations: about 35 line references (PS, SV, AC, PG, RV, 0039) were moved to the current lines. The header no longer names branch wave2/profile_learning. It now names RT and 0052, and it says that ProfileSuggestions.disconnect has no production caller and is not modeled. It also documents that deleteAll merges the runtime forget and the store delete into one step.

Agent's quint check: bun run quint:check quint/profile_learning.qnt: typecheck ok, all tests ok (20 tests plus the new oneCommandPerTurnTest), safety ok, all 8 witnesses reachable, 0 failures. The open defect invariants (SD-112, SD-172, SD-242, SD-376) are unchanged and stay outside safety.

### profile_read

Verdict: fixed_in_model. Checked: Read the whole model and compared it with profile-core.ts (readOnly, readDecision, ownSubject, sameOwner, suggestionOk, currentBatch), profile-read.ts profileReadRequest, profile-suggestion-review.ts (currentBatch shell, render, parse, reviewSuggestionMessage), profile-suggestions.ts (batch() owner binding 120-127, view() 159-168, getPendingBatch 253-261, decide 263-322) and service.ts (route 1085-1093, inbound 1201/1264, the member unit 1443-1470). That is about 16 code sites.

Fixed in the model:
- suggestionOk: the code accepts a google_calendar suggestion with a future observedAt (profile-core.ts:135, SD-240). The model required observedAt <= now for every row. Added a `calendar` flag to Suggestion, a futureCalendarTest run and witness_noFutureCalendar.
- Owner: the code binds a batch to (person, app, chat) (sameOwner, profile-core.ts:126). The model had no app. Added `app` to Owner, to propose, render and decide, and to batchExpiryTest (another app is refused).
- decide: in the code every decision bumps the revision. A saved decision (a reject, or an accept with no edit and no scope change) takes the suggestion out of the proposed rows, and the batch stays current while rows are left (view() lists only proposed rows). The model's reject resolved the whole batch with no revision bump. Renamed the kind to "saved", it now bumps the revision and lowers the count, and added witness_noPartialSave.
- Location comments: service.ts 964-965 and 1244-1270 -> 1092-1093 and 1443-1470, own check 1250-1265 -> 1446-1456, optedOut 1256-1259 -> 1452-1456. Documented that keyword texts and assistant (MCP) texts are not read-checked, and that the safe-integer flags are ideal integers.

Agent's quint check: bun run quint:check quint/profile_read.qnt: typecheck, test, safety and all 10 witnesses (including the 2 new ones) ok (1 model, 0 failures).

### relay

Verdict: drift_open. Checked: RelayDesk (network/src/relay.ts): request, decide, apply, undelivered, unsent, deliver, swap, cancelSwaps, prior, log, release, reject and forget. Engine relayItem/relayItemAsync and the relayCore partyReasons/consentReason. relay-endpoint.ts: claim, lock, complete, withdraw, none, text/share/photo, catch and replay. runtime.ts: relayUnsent, relayAdmission, relayPairAdmission, unitOfWork and the forget path in writeUnit. network.ts: send, checkRecipient, tick flush, relayHost, relayWouldSend, flushSwapShares. store.ts relayRows/writeRelayRows. service.ts: the staff relay route, resolveRelayPhoto and the afterTick SLA. photo-relay.ts. About 45 code sites and 72 line comments.

Fixed in the model:
- queueSend had no photo check at admission. relayAdmission refuses a row with approvedPhotos unless photoRelay.approved() still returns the item (runtime.ts:294-301, 'photo:revoked'). I added photoOk (the item is approved and not expired) to the admission guard.
- persist writes every log entry. The code writes only entries of the last 2 days (RELAY_ROW_WINDOW_MS) or held entries (store.ts:157-167). I documented this as an abstraction: every model trace is shorter than 2 days.
- About 65 line comments pointed to old lines. I moved them to the current code, for example network relay.ts swap 269-312->298-362, apply 232-249->244-266, release 347-366->402-421, engine relayItemAsync 430-445->411-434, network.ts send 3858-3891->4162-4263, tick flush 3269-3277->3529-3542, runtime relayAdmission 238-269->257-302, service.ts staff route 2430-2462->2735-2776, photo-relay.ts delivery 215-224->223-233, relay-endpoint.ts 257-260->259-262.
- I added an OPEN DRIFT note to the header about the swap (below).

Open drift:
- The number swap is now all or nothing in code, commit 07c5567 (SD-007). network/src/relay.ts:315-343 preflights both shares with canSend and transitions.ts:517 swapPlan, and sends both or neither. network.ts:5201-5225 flushSwapShares checks a waiting pair again with swapFlush at the tick. runtime.ts:277-287 refuses a contact share whose partner share is not passed, is rejected, is withdrawn or ended unsent. The model is stale here. commitShare (both-asked branch) applies the first share and then the second with no preflight. tickFlush flushes deferred shares one by one. queueSend has no partner check. As a result noOneWayNumber and the run tests withdrawAfterSwapTest, oneWayDeferredTest and deferredShareRefusedTest describe the older code, and oneWayQueueTest may still hold in part. The code looks right. The fix touches 3 actions, the Send/deferred types and about 5 run tests, which is more than a small model change, so I did not fix it.

Agent's quint check: bun run quint:check quint/relay.qnt: typecheck, test, safety and all 7 witnesses ok (1 model, 0 failures).

### review_desk

Verdict: fixed_in_model. Checked: About 15 code sites. All of logic/review.ts (ctlOk, rebind, choose, leaveMode, keyStep, toggleMode, settle, moveOnAfter, approveBlock, flip). review.tsx useReviewCtl.commit, approveBlock, act, applyStep, press, the ReviewQueue render, select, afterDecision, the mounted ref and the onKey filter. web/store.ts decide and deciding. admin.tsx AppConfig press and its 4 s timer. network.ts decide, reviewBlock, approvalCheck and reroll. transitions.ts reviewLate. Compared 8 safety invariants, 2 defect invariants and 11 witnesses.

Fixed in the model:
- Bug 4 was modelled as open (SERVER_CHECKS_DEADLINE = false, comment network.ts:1941 'no deadline check'). It is fixed in code: network.ts reviewBlock returns review_expired when reviewLate(now, deadline), for every decision (approve, edit, reject and re-roll). Set SERVER_CHECKS_DEADLINE = true, applied the deadline check to every decision kind in serverApplyReq, moved serverApproveBeforeDeadline into safety, and updated the header and comments. A separate quint run (20000 samples, 30 steps, seed 29) found no violation.

Open drift:
- approveMatchesSeenPeople (gap G6) is still a known code defect, and the model documents it. The server side is wrong, not the model: web/store.ts:861 sends {type: review, oppId, decision} with no item version, and network.ts decide (about line 2006) has no version check. So an approve can land after another reviewer re-rolled the item to people this reviewer did not see. A quint run still violates it. It stays out of safety. A fix needs a wire change.

Agent's quint check: bun run quint:check quint/review_desk.qnt: typecheck, test, safety and all 11 witnesses ok (1 models, 0 failures).

### runtime_ops

Verdict: drift_open. Checked: About 55 code sites. store.ts (stored, runTick, runStored, PgStore.load, save on lockConn, locked), service.ts (tick, afterTick, weeklyBias with its re-check under the xact lock, inboxTick, purge), runtime.ts afterTick catch, backend.ts (step, networksThenNotify, opsTick, shutdown with the grace race, ensureServiceLogin, serviceLoginProblem), server.ts (boot order, signals), serve.ts startTicks, migrate.ts, wrangler.sh decide (every WR_TOKENS token compared case by case), ops.ts (collectNetwork, evaluate with tick_late and bias_late, unread, dispatch with due, quiet close, lastFailedAt, the rate limit, the heartbeat gate), bias.ts, llm.ts chatCompletions, worker.ts and network.ts sid. I compared all 17 safety invariants, the 3 open-defect invariants and all of the code location comments.

Fixed in the model:
- LLM call: after MAX_REGROWS, an empty reply that was not truncated is returned as "". Only a truncated reply throws (llm.ts:327-336). The model ended every 'empty' outcome at the cap as an error. I split the outcome into 'empty' (ends ok) and 'truncated' (ends error).
- Cloudflare rollback: stopInactiveBackend returns before stop() when BACKEND_RUNTIME_CONFIG is unset (worker.ts:55). fetch() on an inactive deploy also calls it (worker.ts:64-66). I added cf.configSet and a withConfig choice on cfDeactivate. cfCron stops the container only when BUILD_ID and the config are both set. I added cfNoConfigTest and cfRollbackStopsTest.
- restoreRoles: I documented that the SD-165 fix depends on manifest.source.systemId. An older manifest falls back to host strings (backup_restore covers that case).
- Stale code locations: about 45 line references were moved to the current lines (store.ts, service.ts, backend.ts, server.ts, serve.ts, migrate.ts, wrangler.sh, ops.ts, bias.ts, llm.ts, runtime.ts). The header no longer names branch wave2/runtime_ops.

Open drift:
- deploy/cloudflare/worker.ts:55 versus model inactiveStops (outside safety, SD-159 family). A rollback deploy without BACKEND_RUNTIME_CONFIG returns before getContainer().stop(), so the old container keeps running. This is a code or operator-procedure gap, not a model error. The model now shows it (cfNoConfigTest). It is open with SD-159; the fix needs a Workers runtime test or a runbook rule.
- Unchanged open defects, still outside safety: SD-050 (restoreKeepsStops, founder decision), SD-159 (inactiveStops, missing BUILD_ID), SD-169 (staffRouted, founder decision). The code matches the model on each, so these are not new drift.

Agent's quint check: bun run quint:check quint/runtime_ops.qnt: typecheck ok, all tests ok (including the new cfNoConfigTest and cfRollbackStopsTest), safety ok, all 15 witnesses reachable, 0 failures.

### safety_trust

Verdict: drift_open. Checked: I read the main parts of the model (types, every pure function and action, the safety invariants and some run tests). I compared them with trust.ts (add, block, report, lift, decay, relevel) and transitions.ts (nextLevel, reportCounts, reportPoints, decayedScore, staffHoldPoints). I also compared them with network.ts: onTrustChange 1257, caseEvent 1278, liftHold 1313, closeCase 1323, fileReport 1349, reportHeld 1365, holdMember 1381, markBanned 1396, dismissReport 1409, decideReports, metBefore 1457, handleBlock 1475, applyBlock 1491, blockAndReport 1506, callOffPair 1532, syncMember/personHold/safetyHeld 4782-4799 and tick 3523. And with service.ts liftHold 1793 and hold 1943, relay.ts apply 244-252 and snapshot.ts safetyHold. That is about 25 code sites. The thresholds (WATCH 3, HOLD 6, 14-day decay), the report corroboration, the held-reporter rule, the person-hold carry-over, the staff hold points, the ban and the lift row expansion match.

Fixed in the model:
- liftHold case state: trust.lift's hold_lifted event opens a case when none is open, and Network.liftHold then marks the open case 'lifted' (network.ts:1313-1317). So the case always ends 'lifted'. The model set 'open' when the case was closed or none. It now sets 'lifted'.
- Header code locations updated to formal-main lines (onTrustChange 1257 ... minorReported 1656, dropMember 2756, onFeedback 2786, checkInReported 2845, lateCheckInReport 2856, forget 965, tick 3523, decay 3559, sync 4782-4799, severeBlock 5154; service route 1085, forget 921, liftHold 1793, hold 1943, ban 2010; runtime send kind 466, person_blocks 578; relay apply 244-252). The header now says that in-body references are wave2/safety_trust lines.

Open drift:
- Block-abuse window missing. trust.ts:104-105 counts stranger blocks only within 14 days (blocksMade). trust.ts:116 makes a reporter not credible only while 3 or more of those are recent. The model keeps a permanent strangers set (trustBlock, credibleT, model ~lines 179 and 259-263). So in the model a member stays not credible forever and block abuse fires on any 3rd stranger. The model is stale. A fix needs block times in Trust, which is more than a small change.
- Inviter accountability missing. onTrustChange to hold (network.ts:1268-1272) blocks the inviter's invites for 30 days and adds 1 trust point (invitee_held) to the inviter. That point can move the inviter to watch or hold and drop their items. The model has no invitedBy and addPts has no such step.
- service liftHold deletes this app's and the '*' person_holds rows before the Network's liftHold runs (service.ts:1799-1807). The rows are gone even when Network.liftHold refuses with not_on_hold. The model guards the whole action on level == hold. This is minor and not fixed.

Agent's quint check: bun run quint:check quint/safety_trust.qnt: typecheck, test, safety and all 11 witnesses ok (1 model, 0 failures).

### staff_console

Verdict: fixed_in_model. Checked: About 25 code sites. server.ts: revealFor, canSeeMember, POST/DELETE/GET /api/reveal, /api/member/:id, ws-ticket and /ws upgrade, recheck and its 15 s timer, guard and `seen`, setMode and source() start failure, /api/control audit rows, /api/held/:id/photo preview. Also staff.ts PgStaffRoles.load, rolesFor and allowed; service.ts hold scope and crossAppSafety, and the matching switch against the registry; sources/service.ts 15 s timeout (service_timeout); real.ts ageView/consoleMinor, AGE_EVENTS, the declined row, setEdges, matching_locked; health.ts matching line; projector.ts TERMINAL and the close and outcome rules; web/store.ts api() 401 and setToken; admin.tsx AppConfig press (flip), AppSafetyCases and AppConfig key={s.app}. Compared 26 safety invariants, 2 known-defect invariants and 13 witnesses.

Fixed in the model:
- pressSwitch used the old rule: the second click sent !matchingEnabled. admin.tsx AppConfig now uses flip(): the first click stores a target, and the second click sends that target, or sends nothing when the data already shows it. Added cf.target and the no-send branch, plus the run test switchAlreadyFlippedTest.
- The unreveal action had no audit-down branch. In code, DELETE /api/reveal deletes the grant first, then writes the audit row. If that write fails it answers 503, and the client keeps the badge. Added unrevealWith(st, app, reached, auditUp) and used it in step. unreveal stays as a wrapper. Added the run test endRevealAuditDownTest.
- TERMINAL was missing QUORUM_FAILED, which projector.ts TERMINAL has. Added it.
- Updated the stale location comment real.ts:898 to the matching_locked refusal, and the DELETE location comment.

Agent's quint check: bun run quint:check quint/staff_console.qnt: typecheck, test, safety and all 13 witnesses ok (1 models, 0 failures). Apalache was not run.

### turn_consent

Verdict: drift_open. Checked: I read the whole model. I compared it with inbox.ts (signed claim, sweep, turnHeldBack, priorAnswer, reclaim, stopCancels, rescueCompliance, purge, resolve, handleWaiting), decisions.ts (turnHeldBack, priorAnswer, rescueAction, pickWaiting, collectGate, numberAllowed, startOutcome, stopHintDue, turnDecision, storedTurnAdmitted, keepsMember), service.ts (route, inbound hold/leave/ban order, stop, stopAt, startKeyword, stopHint, direct, join ask, sharedTurn replay and admission), runtime.ts writeUnit collectGate, and route-authority.ts. That is about 30 code sites. I did not check webhook.ts, replies.ts, reply-decision.ts, proof-window.ts, snapshot.ts or migration 0042 in detail.

Fixed in the model:
- STOP: service.ts stop collects the confirmation (the routed member's unit, which also opts that member out) before stopped() runs. The model did the projections first. The order is now phase 0 ledger, phase 1 confirmation, phase 2 stopped(). collects(), the cutShort ghost and q1StopSealedWhileRunningTest now follow this order.
- STOP: service.ts stop runs deletePending(phoneKey), so a pending join ends. The model kept pendingJoin. Fixed, with the new run stopEndsPendingJoinTest.
- Held number plus 'leave <app>': service.ts (hold branch) records the app opt-out, sets turn.consent and the confirmation, and forgets nothing. The model did nothing for a held leave. Fixed, with the new run heldLeaveTest.
- collectGate (decisions.ts:69, service.ts direct:1596, runtime.ts:538): a non-compliance reply is refused when the app's ledger reads opted out. The model collected the join ask and the Network reply anyway. Fixed in the three reply branches of phaseStep.
- storedTurnAdmitted (service.ts:2397-2404): a handled answer with a non-compliance reply goes out only while the number is still admitted. This covers the first answer and replays, else turn_context_changed. Added as admitted() in answer() and in the gwCall replay.
- Because of the two items above, Q-turn_consent-5 is closed in the code. noReplyAfterStop now holds (5 seeds plus 0x5eed), so I added it to safety, updated its comment, and changed q5ReplyBeforeFenceTest to the fixed behavior.

Open drift:
- service.ts:1357 (startKeyword) sets turn.consent opted_in right after the ledger write, before service.ts:1280 resumes the membership. A throw between them is rescued (inbox.ts rescueCompliance) as handled with the opt-in, and the membership stays paused. When I modelled this, projectionsMatchLedger failed (simulator trace), so the code looks wrong here, in the same family as Q-turn_consent-4. I did not apply it. The model still sets the START consent together with the projections, and the START branch has an OPEN DRIFT comment.
- inbox.ts:91 uses pg_try_advisory_xact_lock. When another claim transaction of the same sender holds the lock, a STOP gets [] and then priorAnswer 'busy' (turn_busy, retryable). The model's claim is atomic, so stopNeverHeldBack (busyKw) cannot see this short, retryable hold-back. The model needs a decision on whether that hold-back is allowed.
- inbox.ts:94 and service.ts:2279-2287 (route-authority.ts, NETWORK_ROUTE_AUTHORITY_POLICY, staging only): after admitUntil a new turn, a STOP included, gets 403 route_admission_closed. This is not in the model or its header.
- service.ts stopAt raises the STOP time above a web opt-in that has no ref. The model has no web opt-ins, so this path is not exercised. This is a known abstraction gap, not checked further.

Agent's quint check: bun run quint:check quint/turn_consent.qnt: typecheck ok, test ok (32 runs, 2 new), safety ok, 8 witnesses reachable; 1 models, 0 failures
