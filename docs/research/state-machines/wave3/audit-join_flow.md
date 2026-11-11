# Audit: quint/join_flow.qnt coverage (wave 3)

Read-only audit, 2026-11-11, branch claude/quint-state-machines (4061b99). Hand-written by an agent; nothing in the repository was changed.

Inputs read: quint/join_flow.qnt (534 lines, all), quint/drift.json `join_flow` entry (files only, no `drift` list), docs/formal-coverage.md rows 86, 365, 498-505, quint/FRONTEND.md:11 and :36, docs/results/2026-11-09-quint-drift.md "### join_flow", docs/research/lemmascript/frontend-sites.md (B2, B7, B8, latent notes). There is no docs/research/quint-findings/join_flow.md.
Code read in full: sites/shared/join-core.ts, sites/shared/join.ts, sites/shared/auth.ts, sites/shared/prefill.ts, sites/shared/api.ts, sites/shared/ui.ts `busy`/`showStep`, sites/peon.biz/public/join.html; packages/platform/src/api.ts:464-571 (otp/start, otp/verify, /api/me, /api/join), packages/platform/src/accounts.ts:83-107 (parseJoin), :280-300 (recordAge), :317-326 (canJoin), :355-421 (join/joinLocked), :446-458 (declineUnderAge), packages/platform/src/decisions.ts:134-146 (joinPlan), packages/platform/src/phone.ts, packages/mcp/src/handler.ts:931-955 (signup-draft gate).

Probes (scratch copy only, /private/tmp/.../scratchpad/wave3/jf/probe.qnt; quint 0.33.1):
- `quint run quint/join_flow.qnt --invariant=signInMatchesSession --max-samples=8000 --max-steps=20 --seed=29`: no violation. `joinAppliesToShownAccountWithMarker`: no violation. `joinAppliesToShownAccount`: violated (JF-2, expected).
- Reachable (violated probes): Invite step, Blocked step, Profile with notice account_changed, Done with markerApp=true, and Blocked-from-Profile with the cookie equal to the shown account (only after a cookie flip and flip back).

## Headline

1. The only shipping /join page is sites/peon.biz/public/join.html. friends.help and ntwrk.party have no join.html. /api/me gives `signupView` only on ntwrk and friends (api.ts:518), so in production `markerApp` is always false. The model's `markerApp = true` branch, where JF-2 and JF-3 "hold", describes no deployed page. In production the account_changed path (join.ts:206-211, KMeReroute) never runs.
2. JF-2 is worse than the model and FRONTEND.md:36 say. The model's ghost `joinedAs` records only a new membership. The server also writes the typed age to the cookie account on every exit (accounts.ts:371-383: under_age, invite_only, existing), and `declineUnderAge` removes every membership of that person. On peon.biz a stale tab can make another adult account a permanent minor, or remove all of its memberships (trigger below).
3. `signInMatchesSession` and `joinAppliesToShownAccountWithMarker` hold but are not in `safety` (join_flow.qnt:514-518). scripts/quint-check.ts:65-73 runs only `safety` and `witness_*`, so CI does not check the JF-1 and JF-3 fixes.
4. Two `safety` conjuncts cannot fail by construction (`foreignNumberNeverStarts`, `joinSentOnlyWhenFormPasses`), and `staleAnswerNeverMovesStep` follows from `noStaleAnswerSeen`.

## model_gap

G1. Age refusal at join for an account that /api/me said can join (P1).
Code: accounts.canJoin does not check age (accounts.ts:314-326). The age is checked only in joinLocked/joinPlan (decisions.ts:141-145). So a person who types an age below `minJoinAge` sees Profile, then gets `under_age`, and the page goes to Blocked (join.ts:212-214). For a session with no person, api.ts:558-562 also clears the session cookie. The model's `refused` set is static and also feeds `canJoinOf` (join_flow.qnt:231), so a refused account never reaches Profile. `Refused` from Profile happens only after another tab changes the cookie. The main under-age path is not modeled, and neither is the cookie clear.
Proposal: add a server set `ageRefused` (canJoin is true at /api/me, the join answers under_age). On that answer, if the account has no person, set `cookie := ""`. This should break no invariant, because Refused goes to Blocked and flowOk holds. Add a witness for Blocked reached from Profile with an unchanged cookie.

G2. Banned and held numbers (P2; the drift review notes it, but drift.json does not record it).
- /api/me for a banned session answers 403 review (api.ts:511). The page treats that as no session and shows Phone (join.ts:121-122). The model puts banned in `refused`, so canJoin is false and the page shows Blocked (join_flow.qnt:257-264).
- otp/verify refuses a banned number with invalid_code (api.ts:487). The model's onOtpVerify (join_flow.qnt:250-254) accepts any started number and sets the cookie.
- otp/start answers ok for a banned number and sends no code (api.ts:474-476). The model adds the number to `codes`.
- A held number (canJoin reason review) gets no signupView even on marker apps (api.ts:518, `c.reason !== "review"`), so `marked` becomes false (join.ts:71). That does not matter, because canJoin is false.
Proposal: split `refused` into `banned` (me fails, verify fails, start silent) and `refusedAtJoin` (invite_only, review). This is not expected to break an invariant. It removes a reachable model state (Blocked through verify for a banned number) that the code cannot reach.

G3. The order of the join answer checks differs from joinPlan (P2). joinPlan checks in this order: consent_wording, review (held or banned), member (existing or under_age), invite_only (decisions.ts:139-145). The model checks `refused` before `members` (join_flow.qnt:300-304). For a member on an invite-only app whose cookie moves into this tab, the code answers ok with the existing membership and the page shows Done. The model shows Blocked. consent_wording (a stale page) maps to "server" (sites/shared/api.ts:49): the page stays in Profile with an error. The model folds that into `failed`. This is low impact. It cannot hide a violation of doneOnlyAfterConsent, because Joined needs a ticked box.

G4. Server writes on exits that are not a join (P1, connected to suspected_defect D1). The model's onJoin writes server state only for a new membership (join_flow.qnt:305-308). The code also does the following:
- On exits other than join, it writes the typed age through recordAge to the phone floor and the person (accounts.ts:371-375).
- If that age is under 13, declineUnderAge forgets every membership (accounts.ts:446-458).
- On the existing exit, it calls bindSessions and the onJoin hook with the newly stated age (accounts.ts:385-390).
The ghost `joinedAs`/`joinedFor` therefore misses the age and decline writes that land on the wrong account.
Proposal: add a ghost `wroteFor: Set[(cookieAccount, shownAccount)]` on every exit where `recordAge` is true. Add the invariant `serverWritesOnlyShownAccount`. With markerApp=false this fails at once, which is JF-2 with its full impact. With markerApp=true it should hold, because the 409 check comes before any write (api.ts:552-555).

G5. Membership changes from another tab (P2). `members` and `refused` change only through this tab's own join (join_flow.qnt:306) or `serverRepeats`. In the code, another tab or the agent can join, leave (`/api/me/delete`, state removed, canJoin true again), STOP, or get banned at any time. Add an `otherTabMembership` action that toggles `members` for A or B. A first look finds no invariant this could break. It would make the "existing" exit reachable without `serverRepeats`, and it would exercise Member to Profile on the next sign-in.

G6. Load-time inputs that the model fixes (P2).
- If /api/app fails, inviteOnly comes from `data-join-mode` (join.ts:106), not from the server. peon.biz has no such attribute. The model reads `srv.inviteOnly` (join_flow.qnt:260).
- The load notice `api_unreachable` (join.ts:108, B8) is never non-empty in the model, because onMeLoad passes `notice: ""`. So the notice clause of `doneOnlyAfterConsent` is tested only through `account_changed` and SessionEnded, and in production `account_changed` never occurs.
- Invite is a dead end, with no event out of it (join-core.ts:108). peon.biz has no `data-step="invite"` section (latent, frontend-sites.md:404).
Proposal: draw the load notice from {"", "api_unreachable"}, and draw the page's inviteOnly apart from the server's.

G7. Auth-mode lookup and cloud mode (P2).
- auth.ts:51-58 retries /api/auth/mode up to 3 times, with a 1 s and a 2 s backoff, and keeps the phone form busy during the lookup.
- Cloud mode replaces the form and does a full navigation (auth.ts:68-84).
- When the lookup fails 3 times, OTP mode is mounted, and otp/start then answers 409 cloud_auth_required (api.ts:465) against a cloud backend.
The model starts in OTP mode with the phone form free. This is outside the model by the header (line 55). It has no invariant impact, because the step does not change and the page reloads.

G8. Resend without Turnstile (P2). auth.ts:164-165 calls otp/start again with the code form busy. The server's codes change (a new code), and there is no step change. The header puts this outside the model (line 55). It cannot break an invariant.

G9. Page reload and bfcache restore (P2). There is no reload action.
- A reload loses the fragment prefill, because prefill.ts:7 already called replaceState. The form is reset (join.ts:46). In-flight requests still reach the server, which `serverRepeats` covers.
- A bfcache restore (Back button) brings back the old page state without a new /api/me. In effect that is `otherTab` followed by a resumed tab.
No new invariant break is expected. It is a second trigger for JF-2.

G10. Server commit with a failed answer (covered within bounds). `serverRepeats` followed by a failed `deliver` covers "the server joined, the page saw api_unreachable" (sites/shared/api.ts:127-128). This is bounded by `dupLeft = 1` (join_flow.qnt:344). A join_failed rollback (accounts.ts:409-421: forgetMembership plus opted_out after the hook fails, then 500) is the same as `failed` with no server effect. That matches.

G11. Fields other than JoinFields (P2). zip, homeCity, neighborhood, interests and about are cleared by `profile.reset()` but are not in the owner rule. peon.biz has only firstName, age and consent, so there is no impact today. A friends or ntwrk page with more fields would carry them across accounts unless formResets fires. formResets fires only when the owner changes and the flow fields become empty (join-core.ts:140-143).

G12. Drift-ledger and coverage gaps (P2). quint/drift.json maps join_flow to 7 files. The model also encodes these files:
- sites/shared/api.ts, through the status-to-error mapping that chooses the branches in onJoin and onMeVerify: 401 maps to unauthorized, 409 to account_changed, and a 200 that is not JSON to api_unreachable (api.ts:117-147).
- sites/shared/ui.ts, through `busy()` (ui.ts:60-74), which disables every control in the form, including the change-number and resend buttons. The JF-1 and JF-3 fixes depend on it, because the model's `codeBusy` and `profileBusy` guards stand for it.
- packages/platform/src/accounts.ts (canJoin, joinLocked, the existing exit) and packages/platform/src/decisions.ts (joinPlan).
- sites/peon.biz/public/join.html: the buttons are inside `form[data-form=code]`, there is no invite panel, and there is no data-join-mode.
docs/formal-coverage.md:505 marks ui.ts "na, DOM helpers only", and :498 gives api.ts Quint "none". A change to `busy()` or to the error map would not mark join_flow stale.
Proposal: add these files to the ledger and update the two rows.

## open_carveout

C1. `joinAppliesToShownAccount` (JF-2), kept out of `safety` (join_flow.qnt:507, FRONTEND.md:36). Unfixed. It can be fixed now, in scope, as a security bug:
- At packages/platform/src/api.ts:518, remove `["ntwrk","friends"].includes(appId)` and keep `c.reason !== "review"`.
- This is safe: /oauth/signup-draft has its own app gate (mcp/src/handler.ts:936), the client prefill also gates on friends and ntwrk (join.ts:73), and signupView is an opaque per-app hash (sessions.ts:27).
- At join.ts:196, gate the `/oauth/signup-draft/discard` fetch on friends and ntwrk (as at line 73). Without the gate, peon.biz posts a 404 after each join.
- Add an e2e case in tests/e2e/platform.e2e.test.ts that fails before the fix: peon.biz, /api/me as A, the cookie switches to B, /api/join, then expect 409 account_changed and no age floor for B. sites/test/join-account.test.ts:190-192 now adds a peon signupView by hand ("server need"), so that test does not prove the fix.
- In the model, set markerApp true, or drop it. Move `joinAppliesToShownAccount` (and G4's `serverWritesOnlyShownAccount`) into `safety`, update FRONTEND.md:36, and stamp the model.

C2. `signInMatchesSession` and `joinAppliesToShownAccountWithMarker` hold (seed 29, 8000 samples) but are not in `safety`. This is a model-only fix that can be done now: add both to `safety` (join_flow.qnt:514-518). `staleAnswerNeverMovesStep` is implied by `noStaleAnswerSeen` (see E3). Keep it as a named check, or drop it.

C3. The banned /api/me drift (G2) is written only in docs/results/2026-11-09-quint-drift.md:154. `quint/drift.json` has no `drift` list for join_flow. Fix the model now (G2), or record the drift with `bun run quint:drift --stamp quint/join_flow.qnt --drift "..."`.

C4. Things outside the model by the header: prefill (signup-draft), cloud mode, resend, Turnstile, the radio groups, the server's own join checks. prefill is dead on shipped pages (no friends or ntwrk join.html), so leaving it out is correct today. The latent defect D3 lives there. Keep it out until a friends or ntwrk /join page ships, and then model it: it calls resetAccount and routeTo outside any busy form, so `noStaleAnswerSeen` would no longer hold.

C5. Known research bugs:
- B2 (prefill erased): fixed by fieldsFor and owner. `witness_noPrefillInProfile` is reachable.
- B7 (a first name of 51 characters): fixed by `MAX_FIRST_NAME` in formProblems. The model abstracts the name to "" or "Ann" (join_flow.qnt:153), so it does not test B7. LemmaScript covers it through `formPasses ==> parseJoinTakes`.
- B8 (the api_unreachable banner after a join): fixed by Joined, which sets notice "". The model never starts with that notice (G6), so B8 is not reproduced in Quint.

## model_error

E1. markerApp=true models no deployed page (join_flow.qnt:178 and FRONTEND.md:36 say "friends and ntwrk today"). Only peon.biz ships /join, and peon gets no signupView, so production is markerApp=false. The "holds with marker" results for JF-2 and JF-3 (header lines 33-37, 509-512) describe sites that have no join page. The JF-3 code (join.ts:206-211) is unreachable in production.

E2. `foreignNumberNeverStarts` (join_flow.qnt:483-484) cannot fail. userSubmitPhone sends only `phoneE164(n) != ""` (lines 365-369), and onOtpStart filters with the same oracle again (line 242). The invariant checks the oracle against itself. It would fail only if the shell dispatched otpStarted with the raw input. Reword it as a check of that shell seam, or say in the comment that the invariant checks the shell guard only.

E3. `joinSentOnlyWhenFormPasses` (line 488) is a tautology of the userSubmitJoin guard. `sentUnticked` is set only when the box is not ticked, and the guard requires `formPasses`, which requires ticked (lines 390-394). `staleAnswerNeverMovesStep` (line 495) is implied by `noStaleAnswerSeen`, which is in safety: `staleMoved` needs `stale`. The five `inv_*` conjuncts repeat `inv_flowOk`, and LemmaScript already proves that flowNext keeps flowOk. These are not wrong, but they add no assurance beyond the composition of the shell.

E4. The invariant `joinAppliesToShownAccount` is weaker than its rule (G4). It tracks only new memberships, not the age, decline and bindSessions writes on the other exits. The rule ("the server joins the account the page showed", api.ts:550-551 comment: "Check before recording age, creating a person or accepting consent") covers all of them.

E5. `askStepsHaveNoSession` (join_flow.qnt:105) is about the page's belief (`flow.account`), not the server session. After onSignedIn's /api/me fails (5xx, 429, api_unreachable), join.ts:142 shows Phone while a valid session cookie exists, and the model does the same (join_flow.qnt:272-273). The name claims more than the invariant checks. Rename it, or note this.

E6. onOtpVerify accepts a banned number (G2), and refused comes before member (G3). Both are over-approximations that reach states the code cannot reach (Blocked after verify). They do not hide failures, but they can make a witness pass through an unreal path.

E7. Stale line references: FRONTEND.md:36 says api.ts:513, but the line is now api.ts:518. The drift note says api.ts:509, now 508-512.

## suspected_defect

D1 (P1, new consequence of JF-2, not in the model or FRONTEND.md). On peon.biz, a join from a stale tab writes the typed age to the account in the cookie. The lowest age wins, so an adult account can become a minor for good, or lose every membership.
Trigger:
1. Browser tab 1 opens https://peon.biz/join as A (not a member) and reaches Profile.
2. In tab 2 the same browser signs in as B, an adult member of peon (or of any app), with OTP on peon.biz. This sets a new cookie (api.ts:489-493).
3. Tab 1 types first name Ann, age 16, ticks the box, and clicks Join.
4. No signupView is sent (join.ts:178, account undefined because /api/me gave none).
5. The server takes who = B, member, so joinPlan gives existing (16 >= 13) with recordAge true (decisions.ts:143). accounts.ts:371-375 runs recordAge(B, 16) (accounts.ts:285-299: the phone floor and person.lowestAge become 16, and onAgeLowered runs).
Result: B, an adult, is now a minor in every app and is never matched again (AGENTS.md: the lowest stated age wins). With age 12, declineUnderAge removes every membership of B and records opted_out (accounts.ts:446-458). The page shows "You're in" or the under-age text for the account it believes is A. Fix: C1 (signupView on every app). The 409 check at api.ts:554 then comes before every write.

D2 (P2, same root cause). Masked-key collision at sign-in on peon (join.ts:139). Without signupView, the key is the verified E.164 number when `phoneMasked.endsWith(phone.slice(-4))` is true. If another tab signs in as B with the same last 4 digits between otp/verify and /api/me, the flow takes account = A's number while the session is B. In the code that is the `signInMatchesSession` failure that the model cannot express (header lines 43-44). Fixed by C1: signupView comes first in the key.

D3 (P2, latent). A silent no-op on Join (join.ts:174, `if (marked && !account) return;`). It is reachable on a marker site when prefill's resetAccount (join.ts:74 or 87) bumps the generation while the account_changed reroute waits on /api/me. join.ts:209 then returns early, leaving `account` undefined, `marked` true, and the step profile. Every later Join click does nothing, with no message, because setError was already cleared at line 175. It is not reachable on peon.biz (marked is always false) and not reachable after C1 unless a friends or ntwrk /join page ships with prefill.
