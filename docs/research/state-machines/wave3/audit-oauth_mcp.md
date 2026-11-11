# Audit: coverage of quint/oauth_mcp.qnt (wave 3)

Branch claude/quint-state-machines (HEAD f02196f). The model follows the wave2 code on this branch.
Code read in full: packages/mcp/src/handler.ts, tools.ts (callTool), hooks.ts, pg-store.ts, db/oauth.sql;
packages/network/service/serve.ts:85-112, service.ts onForget/forgetPhone/statedAge/submitProfile/updatesFor/
sharedAction(/internal/updates); packages/platform/src/accounts.ts leave/deleteAll/declineUnderAge/clearHold;
packages/notify setActive. Also compared with claude/formal-main (docs/results/2026-11-09-quint-drift.md,
quint/drift.json). Hand-written. One probe run (below) is generated.

Short names: H handler.ts, T tools.ts, P mcp pg-store.ts, K hooks.ts, SVC service.ts, ACC accounts.ts, M quint/oauth_mcp.qnt.

## 0. Probe: `safety` fails on this branch (quotaCountsAccepted)

Scratch copy of the model plus one run test (scratchpad/wave3/probe/m.qnt):

```
run probeQuota = init.then(createPerson("n2")).then(connectOn(1, "cF", "n2", false))
  .then(prepareSignup(1)).then(join("p2", "friends")).then(submitProfile(1)).then(submitProfile(1))
  .expect(gh.last.kind == "quotaRefused" and not(quotaCountsAccepted))
$ quint test m.qnt --main oauth_mcp --match probeQuota   ->  ok probeQuota passed 1 test(s)
```

So the findings file's "safety passes" (section 3) is a sampling miss: 10000 random traces did not find an
~16-step trace, and Apalache at 5 steps does not reach tokens. Code: prepare_signup (T:292) and submit_profile
(T:318) hit the same bucket `profile:grant:<id>` (H:874). This is the drift item already open on formal-main;
here it also shows that the safety claim is unproved for every token-phase invariant past random sampling.

## 1. suspected_defect (new)

D1. Under-13 decline through accounts.declineUnderAge keeps OAuth grants (SD-089 residual). ACC:440-452
calls onForget only for each live membership and never onForgetPhone, and returns at `if (!person) return`.
Only SVC statedAge (SVC:1471) runs forgetPhone. Text join path SVC:1615 and web join ACC:371/384 use the
ACC path. Trigger: number n has no person; the person connects an agent to friends.help (grant, personId null,
H:546); then texts "friends" and states age 11 -> SVC:1611-1615 recordAge + accounts.declineUnderAge(e164,
undefined) -> return before any listener -> the grant (phone_key next to app friends) stays live; check_status
still answers. With a person: grants of an app with no membership stay. AGENTS age policy: under 13 "declined
kindly with nothing stored". formal-main declineUnderAge (accounts.ts:446-458) is the same. Fix: call
`hooks.onForgetPhone({e164})` in declineUnderAge after deletePending, before the person check. Test: e2e text
join under 13 after an OAuth grant; expect zero oauth.grants rows for the key.

D2. /internal/updates (Eliza shared agent) gives a minor their inbox, and closed items. SVC:2162-2166 reads
`notifications.readUpdates` directly: no minor filter (SD-214 fix is only in updatesFor SVC:673-674), no
closed-opportunity filter (SD-430), no output leak gate (T:332). Trigger: adult member gets an intro (delivered
-> inbox item naming another member), then states age 16 (ageLowered), then in an open turn Eliza calls the
updates action -> the intro summary returns to a 13-17 member. Minors get open turns (they can use the agent).
Same on formal-main (service.ts:2212). Fix: route both branches through one function that applies the minor
check and the closed filter inside the transaction. Test: shared-actions.integration.test.ts case.

D3. revokeGrant/approval race turns the surface signal off while a live grant exists (breaks the in-safety
`activeKeptWhileLive`). H:181-191 is three steps: store.revokeGrant, grantsFor reads, linked(false).
notify setActive is a blind upsert (notify pg-store.ts:201-205). Trigger: grant g1 live (Claude, p1). Client
calls /oauth/revoke on g1's refresh token while p1 approves a new Claude connection g2 (a reconnect does
both): revoke(g1) commits, grantsFor finds no other live grant -> approveConsent(g2) commits -> linked(g2,true)
-> revoke's linked(g1,false). Final: g2 live, approval done, signal off. The model cannot show it: unlinkAfter
(M:151) is atomic with the revocation. Fix: after linked(false), read grantsFor again and call linked(true)
when a live grant of the same person and assistant appeared (an approval that commits later sends its own
linked(true)). Same fix can close Q-oauth_mcp-2 if the re-read is by person, not by phone key.

D4. Sweep can delete a client, and with it a just-committed grant (cascade). P:242-243 deletes a day-old
client when `not exists` grant and no consent_granted audit row, with the statement snapshot. A concurrent
approveConsent (P:126) holds FOR KEY SHARE on the client row; the sweep's DELETE waits, the row itself is
unchanged so there is no EvalPlanQual recheck, and the delete proceeds after the approval commits; the RI
cascade then deletes the new grant and its code. Trigger: DCR client registered more than 24 h ago with no
consent; the person connects now; the once-a-minute sweep runs during the approval transaction. Result: the
client gets a code that is unknown (invalid_grant), linked(true) left the signal on, the client is gone
although it got consent_granted (breaks clientKeptOnceGranted), and no revocation audit row. Low probability.
Fix: `delete ... where id in (select id from oauth.clients where ... for update skip locked)`, or re-check
under lock. Test: pg integration test with two connections.

D5. Leave stopped by a listener error is not clean (model claims it is). SVC:814-823 runs this.forget (network
member) and photo delete before the listeners; a listener throw stops ACC:476-477 before forgetMembership. The
platform membership stays active with no network member: check_status says "active", submit_profile passes the
status gate, consumes the quota (T:318), and SVC:1373 answers not_member. The leave retry must handle a member
already forgotten. Severity low; it is the identity_sagas listener-order item seen from the MCP side.

## 2. model_gap

G1. Session paths (M has none): authorizeStart with a site session goes straight to step consent with no OTP
and no login check (H:407-422); approve requires a current session matching r (H:513-517); createSession
(H:505). Adding: no invariant breaks expected (approve re-checks login H:515-517), but the "Your account
changed" delete branch is missing.
G2. Cloud hand-off: beginCloudOAuth, /oauth/cloud-return (H:423-460), cloudGrantAuthority phone-key check
(H:524-528), "unavailable" retry pages, authority expiry clipping grant expiry (H:546, H:763-768). Modelled only as
a boolean `cloud` and an owner oracle. Low risk.
G3. Concurrency of one actor: one approval process per request (double-submit: the first 303 can be lost,
leaving a committed grant and active=true with no client code), one exchange per code (a client retry during
the first exchange revokes the new grant as a replay, H:621-624), one refresh per token. The second and
third reduce to existing actions; the first can break activeExactlyGrants only (out of safety).
G4. Non-atomic revocation: revokeGrant then audit (H:595-596, H:622-623, H:653-654, H:694-695, H:879-880,
H:983-985) is one action in M (header line 32 carve-out). Also a throw, not only a crash: if store.audit
throws inside revokeAllFor, the leave stops, and the retry's grantsFor (live only) no longer sees the grant,
so its audit row is never written. Adding it breaks everyRevocationAudited. Fix in code: insert the audit row
inside store.revokeGrant's transaction when the update returned a row.
G5. revokeGrant's three steps (D3) and linked(true) after commit can run late after a revoke (activeExactlyGrants
direction: signal on with no grant).
G6. Assistant kinds: both clients are Claude; the signal is per person in M (Inbox.active: Set[str]) but per
(person, assistant) in code (H:185-188, notify surface key). The kind filter of the SD-186(c) fix is never
exercised. Add a ChatGPT client (clientApp/kind map) and key `active` by (person, kind); expected to hold.
G7. Bans: per person only; number bans (scope phone, null-person grants) and unban are absent (K:182-184). On
formal-main a ban revokes at first use (endIfBanned) without audit (drift open).
G8. Timers: the sweep has a 60 s guard (H:203-207) and runs only after ticks on this instance (SVC:543); a sweep
error is swallowed by the tick and fails the OAuth request in fetch (H:997). M deletes a request exactly at
TTL. Grant keep of 30 days (P:240) is abstracted to "any time". Rate windows are fixed windows (P:222-229): two
day-windows let 10 profiles through around a boundary.
G9. Access-token revocation (/oauth/revoke with an access token, H:675) and token_revoked audit for refresh
(H:676) are absent (formal-main model added revokeAccessToken).
G10. Signup draft lifecycle: draft expiry (10 min, T:294; sweep P:233), discardSignupDrafts by the age cleanup
(K:133-137, H:167), claimSignupDraft (P:61-78, no caller, SD-115). M drafts never expire.
G11. Delete everything with a listener failure (ACC:489-492 then store.deleteAll) and clearHold new_owner
(ACC:199-213, same forget path) are not modelled; also the D1 decline path.
G12. formal-main movePhone revokes Cloud grants (platform pg-store.ts:452-457) with no token revocation, no
draft scrub (the draft row moves to the new key with its fields), no audit row, no linked(false). M still aborts.
G13. The status gate admits "onboarding" (T:317); M has no onboarding state.
G14. Turnstile, PKCE, redirect_uri, resource/app binding of tokens (H:749) are left out by design (attacker model).

## 3. open_carveout

C1. activeKeptWhileLiveAll (Q-oauth_mcp-2): fixable now in scope (reproduced bug, AGENTS "reproduced bugs").
Change revokeGrant to look for live grants of the same personId and assistant on any key (new store query
grantsForPerson), plus the D3 re-read. Then drop the oldKey ghost and put the strict form in safety.
C2. activeExactlyGrants (SD-186 a, b): needs a maintainer decision on the hook contract (K:69). Possible code
without a contract change: the sweep sends linked(false) for persons whose last grant expired.
C3. numberChangeWorks (SD-108): fixed in code on formal-main. Port the model (movePhone revokes Cloud grants)
after that branch merges; with G12 fixed in code (audit row and linked(false) through a listener) it can join safety.
C4. quotaCountsAccepted is in safety but violated (section 0). Fix in code: a separate bucket for prepare_signup
(`draft:grant:<id>`), and count submit_profile only on "accepted" (hit after SVC answer, or refund). In scope (README
section 2 rule). Add probeQuota as a run test that must pass after the fix.
C5. Crash between revokeGrant and audit (header line 32): fix as G4.
C6. Listener failure during delete everything (findings section 2 "Left out"): model the failure branch; code
already stops; low value.
C7. SD-430 residue: /internal/updates PG branch and pruned opportunity rows (see D2). Fixable now.
C8. SD-019 residue (a ban between check and transaction still commits tokens) and SD-184 note (a revoked grant
gets tokens): harmless (bearer re-checks). No action.
C9. SD-058, SD-115, SD-182, SD-391: founder or maintainer decisions; out of scope.
C10. formal-main drift open items: endIfBanned without audit (fix: the G4 change covers it), movePhone audit
(G12), prepare_signup quota (C4).

## 4. model_error

E1. submitProfile `accepted = not(banned(now))` (M:523) is never false: bearerOk already requires no ban
on the same person. The not_member answer (SVC:1373-1374: no runtime member, state, number ban) is missing,
so quotaCountsAccepted cannot see the second over-count path (D5).
E2. leave(listenerFails) (M:714-715) changes nothing; the code has already forgotten the network member and photos.
E3. declineUnder13 (M:755-770) needs a membership and forgets every app; that is SVC statedAge only. The
ACC.declineUnderAge path (D1) is stronger in M than in code (vacuous pass of grantDiesWithPerson there).
E4. exchReplay needs an unexpired code (M:376); code checks usedAt before expiry (H:593-599). A used, expired
code still revokes until swept. Fixed in the formal-main model only.
E5. approveRead is disabled when the owner changed (M:250); code deletes the request (H:516-522). Superset, sound,
fixed on formal-main.
E6. prepareSignup refuses minors (M:546) and only guards stillTheirs; code allows 13-17 (canJoinApp) and
revokes on invalid_grant (T:289, H:878-881). Too strong. Fixed on formal-main.
E7. requestRetention with 5-minute ticks and deletion exactly at TTL is stronger than the code (sweep guard, tick
only on the instance that ticked, swallowed sweep errors). The README bound "at most 10 minutes" is exceeded
by up to the sweep period.
E8. Verification depth: Apalache 5 steps covers only sign-in; every token-phase invariant rests on random
sampling, which misses section 0. Add targeted run tests for each in-safety invariant's shortest violation
candidate, or use --max-steps 20 with a mutated init that starts with a connected grant.
