# Wave 3 sweep: packages/platform (sessions, OTP, photos, rate limits, people and memberships, export and deletion, bans)

Hand-written. Read-only sweep of branch `claude/quint-state-machines` (f02196f). Inputs: the catalog (section 2) and register
(section 5) of docs/research/2026-11-07-state-machines.md, quint/*.qnt, docs/research/quint-findings/*.md, the per-area
reports (platform-identity.md, platform-consent.md, implicit-sweep.md), and the drift review on `claude/formal-main`
(docs/results/2026-11-09-quint-drift.md). One probe was run (section 4, D1) with the memory store, from the scratchpad.

Not reported again (known or fixed elsewhere): the session rotation race (fixed on formal-main), the under-13 age on the
invite_only exit (fixed on formal-main), the global `lockTail` queue (platform-identity.md D26), the banned-number OTP
start that skips the rate buckets (otp.ts / api.ts:473 on this branch; fixed on formal-main with `send=false`), SD-489
(no caller for `/api/me/phone/*`), SD-255 (no staff path for e-mail export or delete).

## 1. Coverage check

| Platform machine | Code | Model | Verdict |
|---|---|---|---|
| OTP challenge start (4 buckets), verify, consume | otp.ts:166-215, pg-store.ts:224-241 | auth_edge `otpStart*`, `otpVerify` | covered, but verify throttle and per-app challenge key missing (G1) |
| Web session, rotation, step-up | sessions.ts:34-64 | auth_edge | covered |
| Cloud handoff, validation | api.ts:241-299, 411-452 | auth_edge `cloudLogin`, `account` | covered; the `validated` TTL cache is not (N2) |
| Member number change: request, pending row, confirm | accounts.ts:229-276, pg-store.ts:399-465, api.ts:590-628 | identity_sagas `mvStart`/`mvStep` (confirm only) | request half not covered (G2) |
| Rate window store (hit / hitAll / purge, keep_until) | pg-store.ts:264-293, 330-341; store.ts:359-375 | auth_edge (OTP buckets, abstract), turn_consent (stop hint, M-007) | generic store not covered (N1) |
| Share offer and share grant | accounts.ts:515-535, api.ts:571-579, service.ts:1660-1716, pending kind `share` | none (M-224 left out, P2) | not covered (N3) |
| Photo rating runs | photos.ts:526-603, 625-640 | photos_rating (one rate slot) | concurrent runs and upload cost not covered (G3, D4) |
| Membership states | store.ts:10, accounts.ts:393-401 | join_age, identity_sagas | `onboarding` has no exit (G4) |
| Lock queues `withLock`, `withPhoneAgeGuard` | pg-store.ts:86-95, 295-311 | turn_consent M-002 (sender serialization) | known D26; not a new item |
| Ban, person lifecycle, erasure, suppression, hold | accounts.ts, pg-store.ts | identity_sagas | covered; see D2, D3 for movePhone residue |
| Photo object, consent, rating, relay item | photos.ts, photo-relay.ts | photos_rating, relay (and photo_relay_item on formal-main) | covered |

## 2. New machines (no model has their states and transitions)

### N1. Rate window store (`platform.rate_limits`) — P2, new small module `rate_window.qnt` or a LemmaScript core

States per bucket: rows `(bucket, window_start, count, last_at, keep_until)`; at most two windows kept
(pg-store.ts:289). Transitions: `hit` counted (count+1, last_at, keep_until = at + minGap), `hit` refused (no write),
`hitAll` all-or-none in bucket-name lock order (pg-store.ts:268-291), purge at `now - 2 days` that keeps a row until
`keep_until` (pg-store.ts:336, service.ts:598).

Callers in this area: OTP start (4 buckets, otp.ts:172-179), OTP verify (otp.ts:205-206), number change
(accounts.ts:238, 3 a day per person), and the service buckets `stop_hint` (30 days with minGap), `invite_only`,
`join_ask`, `photo_msg`, photo text `once` (1 a day, no rule: count only).

Rules: a refused hit never counts and never extends a gap (store.ts:162-166, otp.ts header); `hitAll` counts in all or
none; a minGap row survives the purge until the gap ends (SD-004 fix); every bucket whose window is longer than the
purge age (2 days) must carry a minGap at least as long (today only `stop_hint`, which does).

Notes for a model: the windows are fixed, so "3 sends per number per hour" (otp.ts:3) allows 3 at the end of one hour
and 3 at the start of the next (5 in about 2 minutes with the 30 s gap; the day limit 6 still holds). The memory store
(store.ts:362-375) keeps one row per bucket and the Pg store two; their results agree.
Value in Quint: low to medium. The store is one transaction per call with no interleaving to explore; the useful
rule is the purge/window/minGap relation, which a pure check over the bucket table does as well. formal-main already
has a verified `hitPasses` core (docs/formal-coverage.md:388). Recommend: no new Quint module; add the
"window > purge age implies minGap >= window" rule to runtime_ops (retention loop, M-140) as a static check of the
bucket table, and add the verify buckets to auth_edge (G1).

### N2. Cloud validation cache (`validated` map) — P2, extend auth_edge (M-060)

api.ts:265-283, 320-326, 438: in-memory `Map<sessionHash, until>`; states absent / valid-until(t); set on callback,
on rotation (without a new validation, api.ts:324) and on a positive validation; deleted on a bad identity cookie or a
denial; `clear()` above 10 000 entries. Production Cloud mode bypasses it (`!productionCloud &&`, api.ts:273), so it
runs only in the staging/local tuple. Rule: a denial is never cached (api.ts:263-264). Value: low (no production
path); auth_edge already says "In production every request asks Cloud (no cache)". Add only if the staging mode stays.

### N3. Share offer and share grant — P2, no model recommended

States: pending `share` text (service.ts:1662, purged after 2 days) -> SHARE answer -> one grant per other live
membership (service.ts:1710-1716); grant `granted` -> `revoked` (accounts.ts:516-523, forgetMembership
pg-store.ts:348), row deleted by deleteAll. Rules: only shareable fields (accounts.ts:37), both memberships live
(accounts.ts:531). No code reads a grant for any effect (`shareGrants` has one caller, revokeShare): a grant "copies
nothing" (service.ts:1708). A dead-letter machine. Quint adds nothing until a reader exists; if one is added, it
belongs in join_age or a new `cross_app_share` module with the rule "nothing crosses apps without a live grant".

## 3. Model gaps

- **G1 auth_edge: verify throttle and challenge key.** `otpVerify` (auth_edge.qnt:351-375) needs a live challenge and
  keys challenges by phone only. The code keys them by (app, phone) (pg-store.ts:229-231), counts every well-formed
  verify in `otp:verify:ip` and `otp:verify:phone` before it looks for a challenge (otp.ts:205-207), and anyone can
  call verify. The drift review recorded "the verify rate limits are not modelled". Add an attacker `verifyGuess(p)`
  that writes the buckets with no challenge, and a liveness witness "the holder of p logs in within one hour of a
  code". It fails today (D1).
- **G2 identity_sagas: number change request half.** The model starts at "code verified" (`mvStart`,
  identity_sagas.qnt:1007). Not modelled: `startNumberChange` guards (fresh login, hold, stale, ban, 3 a day:
  accounts.ts:229-242), the pending `phone_changes` row and its replacement (pg-store.ts:399-407), the 15-minute window
  (accounts.ts:257), purge of unconfirmed rows (pg-store.ts:338), the code going through `otp.start`/`otp.verify` for
  `change.app` (api.ts:601, 619) so that a login code of the new number also confirms the change, and the old-number
  residue movePhone leaves (D2, D3). The reverted identity_sagas drift patch (forget-listener order, forgetPhone in the
  under-13 decline, export of a banned number) is still open on formal-main.
- **G3 photos_rating: concurrent rating runs.** The model has one rate slot (photos_rating.md section 5). Two uploads
  in a row start two `rate()` runs (photos.ts:550). Trace: photo p1, upload p2: run B reads {p1,p2}, writes its score;
  run A (started for p1 alone, slower rater) passes its check 2 (p1 still there, photos.ts:589) and writes its score
  last (`onRating`, photos.ts:594). The stored rating is from {p1} while {p1,p2} are live. No safety rule breaks
  (scores are never shown); a freshness rule "the stored rating used the newest live photos" would fail. Add a second
  rate slot if freshness matters for matching.
- **G4 join_age: `onboarding` is a sink.** `joinMode: "waitlist"` gives `onboarding` (accounts.ts:396,
  service.ts:1644, 1696) and nothing moves it to `active`; no app is waitlist today (apps.ts:70-85). The text join
  then makes no network member (service.ts:1649). Dead state; a model should mark it unreachable or the code should drop
  it.
- **G5 turn_consent x identity_sagas: named_app across a number move.** turn_consent has `named` and
  `startResumesNamedApp` but no movePhone; identity_sagas has movePhone but no `named`. D2 lives in the gap.

## 4. Suspected defects

### D1. Anyone can block a number's web and agent login for an hour, repeatedly (P1, confirmed by probe)

otp.ts:201-209: a well-formed code is counted in `otp:verify:phone:<number>` (limit 10 an hour) before the challenge is
read, with or without a live challenge, and the verify route has no Turnstile (api.ts:481-497; MCP hooks.ts:169 uses the
same `otp.verify`). Trigger: an attacker posts `/api/auth/otp/verify {phone: V, code: "000000"}` 10 times (one IP is
enough: the IP limit is 30). For the rest of the hour the holder of V gets `invalid_code` for the right code, on every
app, on the MCP phone step and on `/api/me/phone/confirm` to V. Repeat each hour. Five wrong guesses also kill V's live
challenge (claimAttempt, pg-store.ts:233-236). Probe (scratchpad wave3/probe/lockout.ts, MemoryPeopleStore, same
`hitAll` semantics as Pg): after 10 attacker verifies, `start` -> ok, victim's right code -> `false`.
Rule: the OTP header says the limits fight guessing; the MVP signup path (SKILL.md: the person confirms their own phone)
must not be blockable by a stranger who knows the number (dating context: an ex). Fix options: count only checks against
a live challenge in the phone bucket; or key the phone bucket by (phone, IP bucket); or make a right code pass the
phone bucket.

### D2. A number change drops `named_app` of the consent ledger (P2)

pg-store.ts:427-429 copies `consent_events` to the new number with the column list `(e164, app_id, line, state,
source, wording, wording_version, ref, at)`: `named_app` (migration 0042) is not copied. addConsent's own
person-follow copy (pg-store.ts:148-149) keeps it, and the memory store moves events in place (store.ts:423), so
memory-store tests cannot see this. Trigger: P is a member of slop and friends; texts STOP on the shared line routed to
slop (global opt-out, namedApp slop, consent.ts:96-99); with a fresh login P calls `/api/me/phone/start` and `/confirm`
to number B; P texts START from B. route() reads the global row of B (service.ts:1085-1087): namedApp is null, so START
goes to the app that wrote last or to ntwrk, not slop. The STOP confirmation said "Reply START to resume slop.date";
slop stays opted out (the SD-318 rule `startResumesNamedApp`, turn_consent.qnt:871-878). Reachable only through the API
(no site page calls it, SD-489).

### D3. A number change leaves the old number's `line_conversations` row (P2)

movePhone (pg-store.ts:412-465) deletes the old number's sessions, challenges, pending texts and waiting outbound rows,
but not `platform.line_conversations where address = old`. deleteAll removes it (pg-store.ts:376, the SD-092 fix).
The line purge keeps a row while `unanswered > 0` (outbound-queue.ts:756-760), so the plain old number stays for good
when the person had an unanswered text. The next holder of the old number inherits the counters (`unanswered`,
`reengagement_used`) until they write: a web or agent join (no inbound text) gets its first proactive messages held
(`held_awaiting_reply`, outbound-queue.ts:403-411). Same class as SD-092; rule: "delete everything leaves no line
counter that holds the number" and the number-change rule "it may belong to someone else next" (pg-store.ts:442).

### D4. Web photo upload and delete have no rate limit; each runs a metered Clef call (P2)

photos.ts:694-727 (route) and api.ts:349-366 apply auth, origin and an 8 MB cap only. Each upload calls `rate()`
(photos.ts:550) and each delete calls it again (photos.ts:629); `rate()` sends up to 4 photos of up to 4 MiB with up to
3 attempts (photos.ts:82, 143-159). The cost ledger meters but does not cap (cost.ts:170-187). The text path has a 1 a
day bucket (photoIntake.ts:138). Trigger: an adult slop member scripts upload/delete in a loop: two Workers AI calls per
cycle, no bound. Fix: a per-person hit bucket on `/api/photos` writes, or rate at most once per N minutes.

### D5. Ban status leaks through the OTP start timing (P2, plausible)

api.ts:473 answers a banned number before `otp.start`, so no provider call runs; `pad` sets a minimum of 700 ms only
(api.ts:478). When the provider takes longer than 700 ms (Twilio Verify or Blooio send), a banned number answers
faster than any other. formal-main keeps the same order (it counts the buckets with `send=false` but skips the
provider). Rule: otp.ts:8 and api.ts:472 ("A banned number gets the same answer as any other"). Fix: pad to the
provider's p99, or run a dummy delay of the same distribution.

## 5. Not machines (checked, nothing to model)

Turnstile (oracle), body caps (body.ts), staff photo view links (stateless HMAC with a 5-minute expiry, photos.ts:663-692),
photo relay delivery capability (covered by relay / photo_relay_item), proxy signature (auth_edge).
