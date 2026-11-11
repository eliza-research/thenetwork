# Audit: quint/phone_identity.qnt coverage

Branch claude/quint-state-machines. Read-only. `bun run quint:check quint/phone_identity.qnt` passes
(typecheck, test, safety, 4 witnesses; 7 s). There is no docs/research/quint-findings/phone_identity.md.
The drift entry (quint/drift.json) maps 3 files: the model, packages/blooio/src/phone.ts,
packages/platform/src/otp.ts; its `drift` list is empty. The drift review
(docs/results/2026-11-09-quint-drift.md:246-254) says "fixed_in_model, only location comments stale".

## Suspected defects (new)

### D1 (P1). A member's number change sends an OTP code to a banned number
- api.ts:604 `accounts.startNumberChange(app, who, e164, async () => (await otp.start(app, e164, ip)).ok)`:
  `otp.start` is called with the default `send = true` (otp.ts:170, 189). No ban check of the new number
  before the send. accounts.ts:228-229 says the answer must not show whether the new number is banned,
  and confirmNumberChange refuses it later (accounts.ts:264), but the code SMS has already gone.
- Founder decision 3 (AGENTS.md): "a banned number is refused at join (web, text, MCP), OTP and inbound".
  Web OTP start (api.ts:474) and MCP startOtp (hooks.ts:141) pass `send = !banned`; this path does not.
- Trigger: number X is banned (service.ts ban). Member M (not banned) logs in, then within the fresh
  window POSTs /api/me/phone/start {phone: X}. otp.start runs the rate buckets, then provider.send(X):
  X receives "<app> verification code ...". Repeatable 3 times a day per person (NUMBER_CHANGES_PER_DAY)
  and up to the per-number limits, from any number of colluding or throwaway accounts.
- Fix in scope (security): `otp.start(app, e164, ip, !(await accounts.banned(e164)))` at api.ts:604. The
  answer stays the same (ok:true), so no enumeration. Add an integration case in
  packages/platform/test/api-security.test.ts (dev_console provider log shows no code for X).
- Model: add `changeStart(w)` that serves ("change", w, banned(owner(w))) with no ban check; it breaks
  `bannedNeverServed` today, and passes with the fix.

### D2 (P2). Legacy webhook path: a member found by a non-phone address skips the hold and ban checks
- service.ts:1197 `e164 = normalizePhone(ev.from)`; the hold check (1214) and the member ban check
  (1268 `if (memberId && e164 && banned(e164))`) both need `e164`. `memberId` (1194) comes from
  runtime.ts:444 `memberOf` = normalizeAddress, and runtime.ts:425-428 keeps legacy
  `channel_identities` rows whose address does not start with "+" (Apple ID emails) even for members
  with a person.
- Trigger (only where /webhooks/blooio is configured, service.ts:2824; the signed turn guard at
  service.ts:2347 refuses a non-E.164 `from`): person P with a platform phone and a legacy Apple-ID row
  is banned (rows in platform.bans by phone hash). P sends an iMessage from the Apple ID. memberOf finds
  the member, e164 is undefined, both checks are skipped, and memberMessage (1307) stores and handles the
  text (ages, probe answers, reports). Replies go to addressOf = the phone (runtime.ts:439-440) and the
  send gate refuses them, so nothing is sent; but the "not stored, not handled" rule fails.
  consentRefused (service.ts:752) also skips any send whose address is not a phone.
- Fix: in inbound, when `memberId` is set and `e164` is undefined, use the member's platform phone
  (addressOf, or the person of the membership) for the hold and ban checks, or refuse the turn.

### D3 (P2, founder question). A recycled number keeps the old owner's ban after staff decide new_owner
- accounts.ts:196-215 clearHold new_owner: "the number starts clean (no suppression and no age floor:
  those were the old owner's)". pg-store.ts:403-408 deletes suppression and age floor, nulls the
  tombstone's phone_hash, but platform.bans keeps the rows with the old hash (pg-store.ts:194-200 writes
  phone_hash for both scopes), and isBanned (pg-store.ts:203-205) matches phone_hash for any scope.
- Trigger: A is banned (by person or phone). A is silent 12 months; the carrier gives the number to H.
  H's login puts it on hold (accounts.ts:187); staff choose new_owner. H then asks for a code: otp.start
  gets send=false (api.ts:474), H gets ok:true and never a code; a text join is refused_banned
  (service.ts:1631) with no answer. H is silently locked out forever.
- Either intended ("bans are by phone number") or a defect. Needs a founder decision; if not intended,
  clearHold new_owner must also end phone-hash matches of the old person's bans (keep the person-scope
  row by person_id only).

### D4 (P2). Session and grant paths that skip the ban
- hooks.ts:182-190 `session()` checks `held` only, not `banned`. A banned person with a pre-ban site
  cookie gets the consent page directly (handler.ts:417-422) and can read and write signup drafts
  (handler.ts:931-954) and see the consents page (handler.ts:700). The final grant is still refused
  (handler.ts:518 login -> "held"), so no grant is served.
- api.ts:567-575 /api/me/share has no ban check, and accounts.ts:538 `live()` counts a `restricted`
  membership as live, so a banned person can write share grants. Low impact (they are never matched).

## Model gaps

| # | Code element left out | Where | Could it break an invariant? |
|---|---|---|---|
| G1 | Number change step 1 (code to the new number) | api.ts:593-611, accounts.ts:230-243 | Yes: D1 breaks bannedNeverServed |
| G2 | Number change step 2 (movePhone: identity leaves old key, takes new) | accounts.ts:252-277, pg-store.ts:423-470 | identities and members never shrink or move in the model; with a move, the ban on the old hash must follow the person (pg-store.ts:197-200 handles the race). identity_sagas models it; here it would test turnKeysAgree after a move |
| G3 | OTP verify as its own step, ban re-read after verify | api.ts:488, hooks.ts:149 | No (both check). The ban-between-send-and-verify race is in auth_edge (lateBanCode) |
| G4 | Eliza Cloud SSO identity (identity.e164 from Cloud) | api.ts:435-441 | No today (normalizePhone equality, held, banned, suppressed checked) |
| G5 | MCP pre-existing site session reuse | hooks.ts:182-190, handler.ts:410-422 | Not for "served" (grant refused at consent), but D4 |
| G6 | Recycled-number hold, `seen`, clearHold same_owner/new_owner | accounts.ts:182-215, service.ts:1214, runtime.ts:430-431 | Yes for a "new owner is served" property: D3. The header says the hold "is the same as a ban"; it is not (below, E3) |
| G7 | Legacy channel_identities and non-phone addresses (Apple ID) in memberOf | runtime.ts:423-441 | Yes: D2 (a member turn with e164 undefined). The model's guard P(w)==w removes such senders |
| G8 | Legacy Blooio webhook inbound (no signed-turn guard) | service.ts:2824+, 1178 | Yes: D2; also a fullwidth or formatted `from` reaches memberOf (Q) while e164 (P) is undefined |
| G9 | Inbound steps that run before the member ban check: photo consent answer, photo intake, leave, profile read, HELP, START | service.ts:1233-1263, 1272-1279, 1316-1322 | Checked by reading: photo paths need a LIVE (not restricted) membership (photoIntake.ts:32, 74) and replies are gated (decisions.ts:76-77); START checks the ban (1352). The model says "the model checks the ban first", which the code does not do |
| G10 | Ban saga steps and crash (rows, suppress, restrict memberships, markBanned, retry) | service.ts:2018-2045 | No (rows first; identity_sagas models the saga) |
| G11 | Ban by person with several hashes; `no_phone`, `no_person` refusals; ban of a member with no person | service.ts:2016-2022 | A legacy member with person_id null cannot be banned (refused "no_person"); the model's ban needs only `identities.contains(k)` |
| G12 | Staff invite (checks ban) and submit_profile (checks ban) | accounts.ts:345-347, service.ts:1409 | No |
| G13 | Outbound send gate keyed by phone (consentRefused, collectGate) | service.ts:747-773, 1591-1600 | Yes for a non-phone address (D2) |
| G14 | Rate limits and enumeration (same answer for banned) | otp.ts:170-189 | Out of scope (auth_edge) |
| G15 | NANP non-US numbers (+1 809 ...): P refuses, Q accepts with a +1 key | phone-core.ts:12-16, 139-176 | No (behaves like F_uk); the FORMS table has no such row |
| G16 | Delete everything / leave (identities removed, ban rows kept) | accounts.ts:488-501, pg-store.ts:365-410 | No; a re-join is refused by the kept ban rows |

## Open carve-outs

- C1 (drift ledger incomplete, fix now, doc-only). drift.json maps only blooio/src/phone.ts and
  platform/src/otp.ts to phone_identity, but the model cites api.ts, accounts.ts, hooks.ts, service.ts,
  runtime.ts, pg-store.ts (isBanned), core/src/phone-core.ts and platform/src/phone.ts. Their rows in
  docs/formal-coverage.md (lines 86, 203, 243, 245, 363, 365, 377, 378) do not name phone_identity, so
  `bun run quint:drift` never flags this model when those files change. Add phone_identity to those rows
  and restamp.
- C2 (stale coverage note, fix now). formal-coverage.md:60 says toE164 "does not call the proved
  phoneE164 ... and has no proof of its own". blooio/src/phone.ts:16-18 now calls the proved anyE164.
  Also formal-coverage.md:376 note says the OTP start/verify decisions are "not extracted", while otp.ts
  calls otp-core.ts (otpMayAttempt, otpRetryAfterMs, otpExpiry, otpCodeShape). Update both notes.
- C3. normalizeAddress fallback (blooio/src/phone.ts:28-31: "+digits" for a non-E.164 number, and
  lowercase for other text) is outside the proved anyE164 and outside the model. Q("J_text") = "j_text"
  stands in for it. Not a defect for bans (no P key), but unproved.
- C4. No invariant is out of `safety`; no knownOpen list. The drift list is empty, but D1, D2, G6 are
  real disagreements between the header ("every path that reads a number", "the model checks the ban
  first", "the hold is the same as a ban") and the code.

## Model errors

- E1 (invariant that cannot fail). `keysNameOwner` (qnt:165) reads only pure constants (FORMS, P, Q,
  owner); it is true in every state or false in init. It is a check of the oracle table, not of a run.
- E2 (vacuous branches). The inbound guard `P(w) == w` (qnt:118) admits only w = "A" or "B", where
  P(w) = Q(w) = w. So `turnKeysAgree` cannot fail, `e != ""` in the ban branch and the text-join branch
  is always true, and the Q path (NFKC, any country) is never exercised in a turn. The invariant is only
  as strong as the guard; the code paths without the guard (webhook, G8; Apple ID, G7) are where the keys
  differ (D2).
- E3 (too-strong abstraction). Header qnt:28-30: "The 12-month hold is the same as a ban for these keys".
  In code a held number still gets OTP codes (api.ts:474 sends unless banned), a session with no person
  (api.ts:491-495), HELP and leave answers (service.ts:1216-1227), and staff can lift the hold
  (accounts.ts:204-206). The model has no hold at all, so the claim is unused but wrong.
- E4 (merged step hides a check). `webJoin` merges OTP start, verify and join; the code checks the ban
  at start (send flag), after verify (api.ts:488) and in the join lock (accounts.ts:366). The model has
  one check, so a removed check at one of the three would not fail the model.
- E5 (abstraction claim wrong in order). qnt:33-36 says the code's outcome equals the model's "because
  the model checks the ban first". The code checks hold, photo consent, photos, leave and profile read
  before the member ban check (service.ts:1214-1263). By reading these are safe (G9), but the stated
  reason is not what the code does.
- E6 (ban guard). `ban(k)` requires `identities.contains(k)` and bans one key. The code bans a member's
  person (service.ts:2014-2031): it refuses a member with no person and bans every hash of the person,
  and a person-scope ban also matches by person_id. The model cannot express a person-scope ban that
  outlives a number change or delete (identity_sagas does).
- E7 (location comments). qnt:8 api.ts:464-499 and 550-571 match; hooks.ts:136-150 match; service.ts
  2010-2042 is now 2014-2045 (ban), 2343 is now 2346-2348 (guard), 1612-1631 match.
