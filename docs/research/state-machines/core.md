# State machines in packages/core

Scope: `packages/core` (policy, leak guard, reply and opt-out parsers, LLM client, chatJson, run log,
clock, time, RNG, and the `svc/` wire contract and proofs).

Status: hand-written from a full read of every source file in `packages/core/src` and its one test.
Callers outside core were read only where a core rule depends on them. Those are cited by file and line.

Probes: I ran the pure functions with `bun run` on sample inputs, and I ran the LLM client against a fake
`fetch`. No model, provider or database was called. "Probe:" marks a result that I saw in that run.

The other reports in this folder own these machines: inbound inbox (`network-service-inbound.md`),
outbound queue (`network-service-outbound.md`), consent ledger and identity (`platform-identity.md`).
This report covers the core half and the wire contract, and points at those reports for the rest.

## 1. Summary

Core has almost no stored state. It has decision functions and wire types. Most of these machines are
guards or message protocols. Their state lives in another package, or on the other side of a service
boundary.

| id | machine | kind | priority | where |
|---|---|---|---|---|
| age-band | age band and lowest-age rule | implicit | P0 | `policy.ts:15-24`, `platform/src/age.ts` |
| leak-gate | leak guard decision and guard lifecycle | implicit | P0 | `guard.ts:415-590` |
| reply-reader | yes / no / unsure reading | explicit | P0 | `replies.ts:188-254` |
| optout-reader | STOP, START, HELP and leave reading | explicit + implicit | P0 | `replies.ts:281-373`, `platform/src/consent.ts:65-88` |
| svc-auth | signed request acceptance | explicit | P0 | `svc/svc-auth.ts:86-115` |
| turn-wire | gateway turn and receipt protocol | explicit | P0 | `svc/contract.ts:74-156` |
| wire-consent | `consent` mirror into the gateway fence | implicit | P0 | `svc/contract.ts:121-127` |
| relay-photo-descriptor | approved photo descriptor | implicit | P0 | `svc/contract.ts:161-313` |
| review-proofs | owner, source, disconnect, withdrawal and consent-context proofs | implicit | P0 | `svc/profile-review-*.ts`, `svc/learning-consent-context.ts` |
| network-delegation | Cloud login delegation | implicit | P0 | `svc/network-delegation.ts` |
| deliver-wire | outbound deliver and receipt lookup | explicit | P1 | `svc/contract.ts:315-351` |
| open-actions | set-state, signals, updates, relay | explicit | P1 | `svc/contract.ts:353-436` |
| participation-mapping | 4-state wire to 5-state member | explicit | P1 | `svc/contract.ts:96`, `types.ts:7` |
| route-authority | isolated route admit and drain | implicit | P1 | `svc/contract.ts:28-72` |
| collection-lifetime | Google collection 24-hour lifetime | implicit | P1 | `svc/learning-collection-command.ts` |
| contract-mirror | wire file change sequence | implicit | P1 | `test/contract-mirror.test.ts`, `scripts/check-contract-mirror.ts` |
| llm-call | one `chat()` call | implicit | P1 | `llm.ts:238-337` |
| llm-budget | shared spend limit | implicit | P1 | `llm.ts:96-115` |
| chatjson-loop | ask, parse, validate, retry | implicit | P2 | `chatJson.ts:46-77` |
| domain-enums | `OpportunityState` and other enum types | explicit | P2 | `types.ts` |
| run-log | run record stream | implicit | P2 | `runlog.ts` |
| clock-rng-time | clock, RNG, quiet hours, caches | implicit | P2 | `clock.ts`, `rng.ts`, `time.ts` |

Most important results (section 5 has all of them):

- **D1 (P0).** The backend does not honor ordinary STOP phrasing such as "stop it", "STOP STOP" and
  "stop now". They become open conversation. An agent `opt_out` signal only waits for staff.
- **D2 (P0).** AGENTS decision 11 says to use `parseOptOut` on the inbound path. No production code
  calls it. It disagrees with the ledger reader in both directions.
- **D4 (P0).** `classifyYesNo` reads questions as yes ("are you sure?", "ok?"), and two production paths
  act on that.
- **D10 (P1).** Only 2 of the 9 `svc/` wire files have a mirror pin.

## 2. Consent and safety machines

### 2.1 age-band (implicit, P0)

**State.** Core keeps no age state. It classifies one number. The stored state is
`platform.people.lowest_age` and `platform.age_floor.lowest_age` (keyed by phone hash), and the in-memory
`m.age`, `m.statedAge`, `m.minor`, `m.minorSignal`, `m.ageConflict` and `m.ageUnknown` in
`packages/network/src/network.ts`.

**States.**

| state | definition | canJoin | isMinor | canBeMatched |
|---|---|---|---|---|
| Unknown | not a finite number in 0..120 (`policy.ts:15`) | false | true | false |
| Under13 | valid, below 13 | false | true | false |
| Minor | valid, 13 up to but not including 18 | true | true | false |
| Adult | valid, 18 to 120 | true | false | true |

An age above 120 is Unknown, not Adult (`policy.ts:12`). Fractions are valid to core. Only
`platform/src/accounts.ts:87` requires an integer at the join API.

**Transitions (person level).**

| from | event | guard | to | where | actor |
|---|---|---|---|---|---|
| Unknown | states a valid age | none | the band of that age | `accounts.ts:282-297`, `network.ts:686` | member |
| Any known | states a lower age | valid | band of the lower age | `pg-store.ts:99-101` (`least`), `age.ts:8` | member |
| Any known | states a higher age | valid | unchanged | `lowestAge` | member |
| Any known | invalid age | not valid | unchanged | `accounts.ts:283` | member |
| Unknown, `m.minor` | adult age, no record age, no minor signal | see `network.ts:713` | Adult (`m.minor=false`) | `network.ts:713` | member |
| Adult | a minor signal in text | `c.minorSignal` | Minor (`m.minor` sticky) | `network.ts:717` | member |
| Under13 | at join | none | declined, nothing stored | `network.ts:4831` | system |

**Invariants.**

- `lowest` never rises while the phone exists. Deleting the person keeps the floor
  (`accounts.ts:435`). AGENTS decision 1.
- `canBeMatched(a)` implies `canJoin(a)` and `a >= 18`.
- Unknown is never matched. AGENTS "Age policy".
- No match, probe or plans copy reaches a person with `isMinor`. AGENTS decision 11.

**Notes.**

- `effectiveAge` is not in core (AGENTS decision 11 says it was removed). The "lowest wins" rule lives
  in `platform/src/age.ts:8` and in inline minimum sites in `network.ts` (lines 653, 686, 716, and
  the lists at 1064, 2693, 4886). Quint should model one rule; the code has several.
- `network.ts:4423` sets `m.age = r.age` for any different valid record age, so `m.age` can rise. I did
  not find a harm: `m.minor` is sticky and `Math.min` also reads `m.statedAge`.
- Age never grows. There is no birth date, so a 17-year-old stays a minor forever. This follows the
  founder rule, and it is safe. It is a state with no exit by design.

**Concurrency.** `recordAge` is two writes (floor, then person) with `try/finally`, and a hook that
reconciles on retry. `noteAgeFloor` is one atomic `on conflict` statement.

**Quint.** Variables: `floor: phone -> int|none`, `lowest: person -> int|none`. Actions: `state(age)`,
`deletePerson`, `rejoin`. Invariant: `matched(p) implies lowest(p) >= 18`. Merge with the identity model
(`platform-identity.md`). Bounds: ages {none, 12, 15, 18, 30}.

### 2.2 leak-gate (implicit, P0)

**State.** `LeakGuard` instances are immutable after the constructor (`guard.ts:436-512`). The one
mutable module state is `LABEL_KEY` (`guard.ts:244`). `CONTACT_PATTERNS` holds global regexes with a
`lastIndex`, reset around each use (`guard.ts:571-574`).

**Guard lifecycle.** `Compiled` from option lists, with labels fixed at compile time, then `check`
many times. `dropped` records inputs that compiled to nothing (`guard.ts:434`). No caller action on
`dropped` is required by the type, so an empty fact fails open silently.

**Label key states.**

| from | event | to | where |
|---|---|---|---|
| Unset | module load with `LEAK_LABEL_KEY` in the environment | Keyed (no length check) | `guard.ts:244` |
| Any | `setLeakLabelKey(k)`, 32+ bytes | Keyed | `guard.ts:251`, `deploy/backend/server.ts:33` |
| Any | `setLeakLabelKey(undefined)` | Unset | `guard.ts:253` |

`deploy/backend/backend.ts:107` refuses a short key at start. The key change also changes stored
labels, but labels are logs, so nothing depends on their stability.

**Decision order for `check` (`guard.ts:515-580`).**

1. `text.length > maxLength` returns `["too_long"]` and stops.
2. BIDI controls add `format:bidi`.
3. Canaries, canary shapes.
4. Forbidden strings: whole, 4-grams, sensitive words and phrases, vocabulary.
5. Exact strings (digits, word, substring).
6. Fuzzy facts (only candidates that share 2+ tokens, or squashed ones).
7. Contact patterns on `contactVariants`, with `allow` text removed first.

The result is a set of reasons. Empty means clean. `exceptOwner` removes only entries whose every owner
is the recipient. Entries with no owner always count (`guard.ts:519`).

**`checkThread` (`guard.ts:586-589`).** The last 5 texts: new text alone, joined with a space, joined with
nothing. Two callers:

- Outbound queue (`blooio/src/outbound-queue.ts:444-454`): the contact check runs on the new text alone;
  the thread check has `contacts: false`. Compliance rows skip the thread.
- Relay (`engine/src/relay.ts:354`): the contact check runs on the joined thread, on the sender's last 3
  passed texts (`network/src/relay.ts:220`).

I tested the idea that a thread could stick forever because a blocked text never leaves the window. It
does not stick. Only passed texts enter `mine`, and a held text does not enter it.

**Invariants.**

- Every outbound message passes the gate. AGENTS "Code invariants".
- Reasons never hold the matched value (hash labels only).
- Monotonic: adding a forbidden item cannot remove a reason, except through `publicPhrases`.
- Fail closed: too long, a leak-source error (`["leak_check_error"]`, `outbound-queue.ts:439`).

**Concurrency.** Pure and synchronous. The risk is staleness: the caller's forbidden lists come from a
snapshot, so a fact added after the snapshot is not in the guard. Model that in the queue.

**Quint.** Do not model regexes. Model `leakCheck: (msg, knowledge) -> bool` as an uninterpreted oracle
with the property `sent(msg) implies gatePassed(msg)`. Use the eval corpus for the function itself. Merge
with the outbound queue model.

### 2.3 reply-reader (explicit, P0)

**State.** The union `yes | no | unsure` (`replies.ts:23`), plus `counter`, `leaning` and `constraints`.
Each call is a pure pipeline.

**Pipeline.** `normalize` → rules in fixed order, each masking its span (`replies.ts:142-156`) → negation
scope → condition scope → bare-no mark → cut at the last reversal if a decisive signal follows
(`replies.ts:198`) → decide on the first decisive signal.

| first decisive | condition | answer | reason |
|---|---|---|---|
| none | counter | unsure | counter |
| none | conditions | unsure | condition_only |
| none | >3 words or `?` | unsure | question, no_signal |
| none | no emoji | no | emoji_no |
| none | unsure emoji | unsure | emoji_unsure |
| none | yes emoji | yes | emoji_yes |
| no | always | no | refusal |
| timeNeg | a later yes | unsure, counter | time_refused_other_offered |
| timeNeg | otherwise | no | time_refusal |
| unsure | always | unsure | hedge, hedge_counter |
| yes | later no, same sentence, last word no | no | yes_then_no |
| yes | later bare no, new sentence | no | yes_then_bare_no |
| yes | later strong no | unsure | yes_no_conflict |
| yes | later hedge | unsure | yes_then_hedge |
| yes | counter | unsure | yes_other_time |
| yes | non-time condition | unsure | conditional_yes |
| yes | otherwise | yes | yes, yes_with_time_constraint |

There is no `?` check on the path where the first decisive signal is yes. Section 5, D4.

**Consumers.**

| consumer | use | effect |
|---|---|---|
| `network/src/classify.ts:601` (`consentOf`) | veto only: `parseReply == "no"` makes it unclear | probe and plan consent |
| `network/service/packs.ts:128` | `classifyYesNo == "yes"` | widens slop radius to 25 miles |
| `engine/src/packs/slop/onboard.ts:93` | `classifyYesNo == "yes"` | sets read-back `confirmed` |
| `sim/src/agent/policy.ts:44`, `sim/src/snapshot.ts:384`, `sim/src/judge/metrics.ts:432` | simulator | none in production |

**Invariants.** AGENTS decision 11: only `answer: "yes"` is consent, and a counter is not a yes. The
eval gate "no negated or hedged reply read as yes" is at `scripts/sim/evals.ts:117`.

**Quint.** Treat the reader as a nondeterministic oracle in the consent models. Use three inputs: a true
yes, a true no, and an ambiguous text that the oracle may read either way. The check is then: which
effects can a misread reach, and can the member undo them? Do not model the regex rules.

### 2.4 optout-reader (explicit and implicit, P0)

**Readers.** There are four. They do not agree.

| reader | file | production use |
|---|---|---|
| `KEYWORDS` + `keywordKey` | `replies.ts:306-326` | yes, through `detectKeyword` |
| `optOutPhrase` | `replies.ts:368-373` | yes, through `detectKeyword` |
| `detectKeyword`, `leaveTarget` | `platform/src/consent.ts:65-88` | yes: `service.ts` `inbound`, `inbox.ts:38-40` |
| `parseOptOut` | `replies.ts:281-296` | **no**, only `scripts/sim/evals.ts` |
| sim `detectKeyword` | `sim/src/channel.ts:21` | simulator only |

**Output states of the production reader.** `stop_all | stop | start | help | undefined`, and then a
separate `leaveTarget`. Precedence (`consent.ts:65-73`): stop all, stop words or phrase, start, help.
In `optOutPhrase`, a leave reading wins over a stop phrase (`replies.ts:371`).

**Precedence in `NetworkService.inbound` (service.ts:1047-1110).** `stop` first, then held numbers, photo
consent answers, photos, then leave, then the member branch with START. `isComplianceText`
(`inbox.ts:37`) decides what jumps the per-sender queue. It uses the same reader, so a phrase the reader
misses gets no priority and cancels no earlier rows.

**Transitions it drives.** Ledger details are in `platform-identity.md`.

| from | text | to | scope |
|---|---|---|---|
| any | stop, stop_all | opted_out | global on the shared line |
| any | leave `<app>` | opted_out, membership forgotten | one app |
| opted_out | start | opted_in for the routed app only | one app |
| any | help | unchanged | none |
| any | undefined | unchanged, turn goes on | none |

**Invariants.**

- STOP on the shared line stops every app. AGENTS decision 7.
- Only one system answers STOP, and that is the backend inside a turn. AGENTS founder decision 2.
- A per-app leave never stops every app.
- No message after a STOP except its confirmation.
- A person who opts out in their own words is honored (the `replies.ts:328` comment cites TCPA).

### 2.5 wire-consent (implicit, P0)

**State.** The optional `consent` field on a handled turn (`contract.ts:121-127`):
`{state, scope, app, at}`. The gateway copies it into its send-time fence. The fence is upstream and not
in this repository.

**Producers.**

| event | wire `at` | ledger `at` | where |
|---|---|---|---|
| STOP | `event.at` = `consentAt(ev)` | same | `service.ts:1322-1325` |
| START, member | `consentAt(ev)` | same | `service.ts:1104-1112` |
| START, line 1135 | `consentAt(ev)`, called twice | can differ by clock movement only when `receivedAt` is above now | `service.ts:1135-1136` |
| leave, person | `t` = clock now | `this.now()` in `accounts.leave` | `service.ts:1090`, `accounts.ts:422` |
| leave, no person | `t` = clock now | `consentAt(ev)` | `service.ts:1089-1090` |

**Invariants to model.**

- After both sides settle, the fence equals `resolveConsent` of the ledger.
- A retried or replayed older handled response cannot undo a newer consent state in the fence.
- The ledger order follows person time, not retry time (`service.ts:1353-1356`).

**Boundary.** A replay of `/internal/turn` returns the stored response, with the old `consent` and old
`at`. The gateway must apply it by last `at`, not by arrival. That code is not here, so I could not
verify it. Add it to the model as an assumption, and check the assumption upstream.

**Quint.** Model two state variables: `ledger` (service) and `fence` (gateway), with a network that can
reorder and duplicate turn responses. Merge with `platform-identity.md` consent and
`network-service-inbound.md` turn handling. This is the highest-value model for this report.

### 2.6 svc-auth (explicit, P0)

**State.** Stateless on the request, except that replay protection depends on an idempotent id at each
endpoint. Result union: `ok | missing | stale | bad_signature | no_secret` (`svc-auth.ts:81-83`).

**Check order (`svc-auth.ts:95-114`).**

| step | guard | result |
|---|---|---|
| 1 | secret absent or under 32 characters | no_secret (503 at callers) |
| 2 | ts not finite, or id or sig missing | missing |
| 3 | `abs(now - ts) > 60` | stale |
| 4 | HMAC length differs | bad_signature |
| 5 | constant-time compare differs | bad_signature |
| 6 | else | ok, returns id |

Canonical string: `METHOD\nPATH\nTS\nID\nsha256(body)` (`svc-auth.ts:40-48`). The method, path, id and
body are all covered. The query string is not covered, so endpoints must refuse one.

**Id binding at each endpoint (verified).** The id is the replay key, so each endpoint must bind it to
the body.

| endpoint | required id | where | query refused |
|---|---|---|---|
| `/internal/turn` | `messageId` | `service.ts:2051` | yes |
| `/internal/turn-receipt` | `<messageId>:receipt` | `service.ts:2004` | yes |
| `/internal/set-state` | `idempotencyKey` | `service.ts:1855-1857` | yes |
| `/internal/signals`, `/internal/updates` | `<messageId>:signals`, `:updates` | `service.ts:1854-1857` | yes |
| `/internal/relay` | `<messageId>:relay` | `relay-endpoint.ts:155` | yes |
| `/internal/relay-photo/resolve` | `b.id` | `service.ts:2138` | yes |
| profile suggestions | `<messageId>:suggestions:<action>` | `profile-suggestion-endpoint.ts:64` | not checked here |
| consent context | `<messageId>:learning-consent:<nonce>` | `learning-consent-context-endpoint.ts:30-31` | not checked here |
| disconnect | `connection-cleanup:<nonce>` | `profile-suggestion-disconnect-endpoint.ts:50` | not checked here |
| withdrawal | `learning-withdrawal:<nonce>` | `profile-suggestion-withdrawal-endpoint.ts:47` | not checked here |
| proof response | `<id>:proof` | `profile-review-proof-transport.ts:33` | not applicable |

All production `svcSign` callers pass `nowS` from their clock, so the `Date.now()` default
(`svc-auth.ts:69`) is not used in production.

**Failure analysis.**

- One secret, both directions and every endpoint. There is no key id and no second accepted key, so a
  rotation cannot overlap. During a rotation every turn fails with `bad_signature`.
- Clock skew above 60 s rejects every request as `stale`. A gateway retry must sign again, with the same
  id. The signature ages; the id does not.
- A reflected signature is structurally refused: a response must carry `<id>:proof` and a typed body.

The `svc-auth.ts:10-11` comment says "both endpoints". The system now has more than ten signed
endpoints. All that I checked bind the id, so the comment is out of date, not wrong in effect.

**Quint.** Variables: `seen: id -> response`, `now`, `skew`. Actions: `send`, `replay`, `reorder`,
`rotate`. Invariant: a side effect runs at most once for an id. Abstract the HMAC as a set of ids signed
by the honest side. Merge with turn-wire.

### 2.7 turn-wire (explicit, P0)

**State.** Wire union at `contract.ts:107-138`, stored in `platform.inbound` (`status`, `response`,
`replies`, `receipt`, `receipt_hash`). The row machine is in `network-service-inbound.md`. This section
covers only what crosses the boundary.

**Gateway view of one message.**

| from | event | guard | to | where |
|---|---|---|---|---|
| Received | POST turn | signature ok, id = messageId | Waiting | `service.ts:1985-2051` |
| Waiting | 409 `turn_busy` | still processing | Waiting (retry) | `inbox.ts:102-106` |
| Waiting | 409 `turn_failed` | nothing committed | Waiting (same id) | `inbox.ts:152` |
| Waiting | 200 handled | none | Sending | `service.ts:2094-2096` |
| Waiting | 200 open | binding ok, context present | Conversing | `service.ts:2089-2091` |
| Waiting | 200 ignored | no network or unknown sender | Done | `service.ts:2093` |
| Waiting | 409 `turn_context_changed` | replay, context differs | Refused | `service.ts:2103` |
| Waiting | 409 `turn_onboarding_changed` | replay, admission changed | Refused | `service.ts:2109` |
| Waiting | 401, 403, 503 | auth, route | Refused | `service.ts:1986-1997` |
| Sending | gateway sends replies | none | Sent or Unknown | upstream |
| Sent, Unknown | POST receipt | scope matches | Acknowledged | `service.ts:2003-2041` |

**Receipt states (per inbound row).**

| from | receipt | guard | to |
|---|---|---|---|
| none | accepted | providerIds present, history recorded or account-free reply | accepted |
| none | rejected | history false | rejected |
| none | unknown | history false | unknown |
| unknown | accepted, rejected | same guards | final |
| final | same body or deep-equal | none | replayed, no change |
| final | a different body | none | 409 `receipt_conflict` |

**Invariants.**

- `replyIds` in a receipt equal the collected ids, in order (`service.ts:2025`).
- A handled turn runs no model. `memberId` and `app` come from the service, never the model.
- "collected" is not "accepted". Only a receipt moves a message to `sent`.
- Respond within 8 s (AGENTS). The production service wires no LLM reader (`understand` has no caller
  in `packages/network/service`), so the LLM timeouts do not apply on this path.

**Stuck state to model.** A row with no receipt. The gateway crashes after a send: `network.messages`
stays `collected`. Nothing in the contract forces a later receipt. See the inbound report for the
sweep, if one exists.

### 2.8 relay-photo-descriptor (implicit, P0)

**State.** `ApprovedRelayPhoto` is an immutable descriptor. The stored machine is in
`platform/src/photo-relay.ts`. The parser enforces shape only (`contract.ts:205-313`).

**Ordering on the descriptor.** `consentedAt <= reviewedAt < expiresAt` and
`expiresAt - consentedAt <= 15 min`. All items share one consent, review, thread, sender, recipient,
policy and expiry. There are 1 to 3 distinct photos, and sender differs from recipient.

**Freshness.** By design the parser does not check the clock, so receipt recovery can still read an
expired descriptor (`contract.ts:202-204`). `cloud-channel.ts` and `outbound-queue.ts` do not compare
`expiresAt` to now. The check is at the resolve and fetch steps: `photo-relay.ts:204-222`. A late queue
send therefore reaches Cloud, and then resolve refuses. That fails closed. `PHOTO_RELAY_TTL` equals
`RELAY_PHOTO_CONSENT_TTL_MS` (both 15 minutes), so a fresh descriptor always parses.

`service.ts:2143` accepts exactly one photo in a resolve, while the parser and `RELAY_PHOTO_MAX_ITEMS`
allow 3. A multi-photo delivery cannot resolve. It fails closed.

**Quint.** Merge with the relay machine. Add `now` and a resolve action. Check: a photo reaches a
recipient only if consent, review and expiry all hold at resolve time.

### 2.9 review-proofs (implicit, P0)

**Shared pattern.** One bounded exchange, with no cache and no retry:

1. Service builds a request with a fresh `requestNonce` (UUID).
2. Service signs and posts to Cloud.
3. Cloud returns a signed proof, with id `<id>:proof`.
4. Service verifies the signature over exact bytes, then parses the proof with the request.
5. The proof binds the request SHA-256, and it is valid only in `[issuedAt, expiresAt)`.

| proof | purpose string | max lifetime | extra binding |
|---|---|---|---|
| owner | `network-profile-review-owner-v1` | 30 s | selector hash, all request keys |
| source | `network-profile-learning-source-v1` | 5 s | nonce, person, app; `pendingExpiresAt >= expiresAt` |
| disconnect | `network-profile-review-revoked-owner-v1` | 30 s | `connectionState: revoked`, `revokedAt <= issuedAt` |
| withdrawal | `network-profile-review-withdrawal-v2` | 30 s | `cutoffAt <= issuedAt`, channel, message, command hash |
| consent context | `network-learning-membership-v1` | 30 s | selection hash; `expiresAt <= collectionExpiresAt` |

**Machine for one proof.** `Absent → Requested → (Verified | Null) → (Accepted | Expired)`. `Null` covers
a timeout at 3 s, a non-200, oversize, a bad signature or a parse failure
(`profile-review-proof-transport.ts:20-38`).

**Crash windows.** The cleanup receipts are stored by `request_nonce`
(`profile-suggestions.ts:304-350`), so a repeat is detected. Details belong in the network service report.

**Check.** The purpose strings differ, so a proof of one type cannot pass another parser. Key sets
are exact, so an extra field fails.

**Invariants.** A proof is parsed only after its signature is verified. No proof outlives its stated
maximum. `issuedAt > now` is refused in all five, so clock skew between Cloud and the service causes
refusal, not acceptance. A proof issued 1 ms ahead fails. This is a liveness cost that a model with
skew will show (see D12).

**Quint.** One parametric module (`ttl`, `purpose`). Abstract hashes as ids. Model skew as a bounded
offset.

### 2.10 network-delegation (implicit, P0)

**State.** `NetworkDelegation` in `svc/network-delegation.ts`, stored in a session grant.
`CloudGrantAuthority` is declared here. Realm is `canonical | fresh-person-20261015`.

**Time units are mixed on purpose.** `issuedAt` is in seconds, `expiresAt` and `now` are in ms
(`network-delegation.ts:40-41`). The check is `issuedAt*1000 <= now`, `expiresAt > now`, and
`expiresAt <= issuedAt*1000 + 1 h`. A wrong unit on `issuedAt` fails closed. A test should pin this.

**Transitions (`platform/src/cloud-delegation.ts`).**

| from | event | result |
|---|---|---|
| Code | `exchange(code, verifier)`, response ok, identity parses, proof `ensd_` | Delegated |
| Delegated | `validate`, 403 and `ok:false` | invalid |
| Delegated | `validate`, other failure or a throw | unavailable |
| Delegated | `validate`, identity differs on any key | invalid |
| Delegated | local parse fails (expired) | invalid |

`unavailable` must not grant access. That rule is in the caller, in `platform-identity.md`.

The UUID check here allows versions 1-8 (`network-delegation.ts:31`). Every other `svc/` parser allows
1-5. An id of version 6, 7 or 8 passes login and then fails all review parsers. I did not verify which
versions Cloud issues.

### 2.11 Other wire machines

**deliver-wire (P1).** `DeliverRequest.id` is the idempotency key and also `x-ntwrk-svc-id`
(`cloud-channel.ts:42`). States of one id at the sender:

| response | meaning | sender state | where |
|---|---|---|---|
| ok | accepted, maybe `replayed` | accepted | `cloud-channel.ts:51-55` |
| `opted_out` | fence refused | blocked, terminal | line 63 |
| `rejected`, retryable | refused before dispatch | retry with same id | line 64 |
| `invalid` or `rejected` with 4xx | refused | invalid, terminal | line 65 |
| `unknown`, timeout, parse failure | may be sent | unknown: receipt lookup, same id only | lines 46, 67 |
| receipt lookup, `rejected`, retryable | never admitted | resend, same id | line 60 |

Safety property: at most one provider send per id. Liveness: an `unknown` must end. Queue details are in
`network-service-outbound.md`. `acceptedAt` is required in the contract (`contract.ts:342`), but
`cloud-channel.ts:47-55` treats it as optional. See D11.

**open-actions (P1).** `set-state` (key `idempotencyKey`), `signals`, `updates`, `relay`. All require a
`done` open turn with the same `app` and `memberId` for relay (`relay-endpoint.ts:162`).
`/internal/updates` marks items seen on read (`contract.ts:406`). A lost response loses the items for
that surface, unless the response is replayed by id. Signals of kind `opt_out` and `safety_concern` do
not act; they wait for staff (`service.ts:1957`).

**participation-mapping (P1).** Wire `open | busy | traveling | paused`. Internal
`open | normal | quiet | receiving | paused`.

| wire to internal, inside the window (`snapshot.ts:31`) | internal to wire, no window (`runtime.ts:712-713`) |
|---|---|
| open → normal | open, normal, receiving → open |
| busy, traveling → quiet | quiet → busy |
| paused → paused | paused → paused |
| opted out → paused always | |

The window expires lazily: `effectiveParticipation` computes it from the clock, with no writer. "open"
names different things on the two sides. Round-trip is not the identity: `traveling` outside its window
reads as the stored state, and internal `receiving` reads as wire `open`.

**route-authority (P1).** Only in staging (`route-authority.ts:13`). Time zones: `now < admitUntil`
(new turns admitted), `admitUntil <= now < drainUntil` (only rows that already exist), and
`now >= drainUntil` (refused). Without a policy, an envelope is refused, and an absent one is allowed
(`route-authority.ts:32-34`). Isolated realms cannot originate relays (`relay-endpoint.ts:151`,
`service.ts:2140-2141`).

**collection-lifetime (P1).** The `collect` command is parsed from stored bytes.
`networkCollectionDeadline` fixes the end at `turnReceivedAt + 24 h` and refuses `now < turnReceivedAt`
(`learning-collection-command.ts:65-69`). A retry cannot extend it. The maximum window is 31 days,
enforced only in `parseNetworkCollectionScope`. `parseProfileReviewSourceRequest` and
`parseLearningCollectionSelection` do not check the window size. That is safe when the selection is
joined to the stored command with `learningSelectionMatchesStoredCommand`
(`learning-consent-context-endpoint.ts:68`).

**contract-mirror (P1).** A release sequence: upstream changes first, copy files unchanged, update pins,
`check:mirror`. The states are `Same`, `UpstreamAhead`, `LocalAhead`. In `LocalAhead` or `UpstreamAhead`,
signed requests still verify, but a field can drift. The pinned hashes match the files today (I ran
`shasum`). I could not run `check:mirror`, because it calls GitHub. See D10.

## 3. LLM machines

Production note: the service builds one LLM client, the engine judge, which is off by default
(`service.ts:363-379`). The reader `llmUnderstand` has no caller in `packages/network/service`. So these
machines matter for sims, evals, judges and staged qualification more than for live turns.

### 3.1 llm-call (implicit, P1)

**State (locals in `chatCompletions`, `llm.ts:238-337`).** `e` (endpoint index), `retries`, `regrows`,
`attempt`, `opts.maxTokens`, and the fixed `deadlineAt`.

| from | event | guard | to | where |
|---|---|---|---|---|
| Gate | signal aborted | | Fail(aborted) | :259 |
| Gate | `remaining() <= 0` | | Fail(deadline) | :260 |
| Gate | budget exhausted | | Fail(budget) | :261 |
| Gate | else | | InFlight, count one request | :261 |
| InFlight | throw, caller aborted | | Fail(aborted) | :297 |
| InFlight | throw, no time left | | Fail(deadline) | :298 |
| InFlight | throw, time left | | Retry(timeout or network) | :299 |
| InFlight | non-OK, status not 408, 429, 5xx | | Fail(http) | :306 |
| InFlight | 408, 429, 5xx | | Retry(http) | :307 |
| InFlight | 200, no `choices` | | Retry(bad_response) | :316 |
| InFlight | 200, charged | empty or truncated, `regrows < 2` | Regrow | :327 |
| InFlight | 200 | truncated, `regrows == 2` | Fail(truncated) | :332 |
| InFlight | 200 | else | Done(content, maybe "") | :335 |
| Retry | | `e < last` | Gate, `e+1`, at once | :265-270 |
| Retry | | `retries >= max` | Fail(code) | :272 |
| Retry | | `wait >= remaining` | Fail(deadline) | :274 |
| Retry | | else | Backoff, `retries+1`, sleep | :275-276 |
| Backoff | abort during sleep | | Fail(aborted) | :341 |
| Regrow | | | Gate, `regrows+1`, tokens doubled, capped | :328-330 |

**Invariants.**

- Termination: `attempts <= (endpoints - 1) + maxRetries + 2 + 1`. That is 8 with two endpoints and
  default values. No transition lowers `e`, `retries` or `regrows`.
- `e` is monotonic. A call never returns to Surplus.
- Every attempt takes one budget unit before the HTTP request.
- `fallback: false` keeps `e = 0`.
- With a finite deadline, wall time is at most the deadline plus one scheduling delay.
- Errors never carry prompt or reply text.

**Failure analysis.** Retrying a chat call is safe for data, but a timed-out attempt may still bill.
A hook throw is caught. The `AbortSignal.timeout` uses real time, and `remaining` uses `hooks.clock`, so
a frozen sim clock never hits the deadline.

**Quint.** A good small first model: three counters and a nondeterministic response. Invariants: the
attempt bound, `e` monotonic, Done implies an attempt succeeded, and no Done after abort. Model alone.

### 3.2 llm-budget (implicit, P1)

**State.** `spentMicro`, `requests`, `unpricedResponses` (`llm.ts:96-115`).
`Open → Exhausted`, with no way back. `take` counts a request. `charge` adds cost on a 200 only.

**Facts.** Overshoot by concurrent calls is documented. Requests that time out charge 0, so spend can be
under-counted (requests still count). The one production instance is process-wide
(`service.ts:368`) and covers all apps. It resets only by restart. The service README describes this as
bounded qualification, so I treat it as a design choice.

**Quint.** Merge with llm-call. Property: `requests <= maxRequests` holds even with concurrency, since
`take` is synchronous. `spentMicro <= max + inFlight * maxCost`.

### 3.3 chatjson-loop (implicit, P2)

**State.** `attempt`, `maxTokens`, `error`, `deadlineAt` (`chatJson.ts:46-77`).

| from | event | to |
|---|---|---|
| Top | `beforeAttempt` throws | Stop(stopped) |
| Top | signal aborted, deadline passed | Stop(stopped) |
| Top | ok reply and parse | Done |
| Top | LLMError aborted, deadline or budget | Stop(stopped) |
| Top | other failure | Top, `attempt+1`, `grow` |
| Top | attempts used | Stop(not stopped) |

Attempts multiply: two attempts over a client with a 180 s deadline can take 360 s when
`deadlineMs` is not set. No caller outside core sets `deadlineMs`.

## 4. Lower-priority machines

### 4.1 domain-enums (explicit, P2)

| type | states | used by | note |
|---|---|---|---|
| `OpportunityState` (`types.ts:120`) | 23 | observatory only | not used by `packages/network` |
| `SourceStatus` (`types.ts:75`) | 5 | sim, synthetic, validation | no production writer found |
| `Intent.status` | active, paused, closed | snapshot views | `paused` writer not found in the first results; not verified |
| `DeliveryStatus` (`network.ts:10`) | 5 | sim channel, network | |
| `ParticipationState` (`types.ts:7`) | 5 | engine, network, outreach | see participation-mapping |
| `OpenOpportunity.stage` | inviting, scheduled | engine | |
| `SimMeta.type` | 17 values | sim, network | message tag, no machine |

The observatory projector is the only code that drives `OpportunityState`. Its machine is in
`observatory.md`. Eight of the 23 states have no writer outside core: `DRAFT`, `APPROVED`, `SCHEDULING`,
`RESCHEDULE_REQUESTED`, `NEEDS_REPLACEMENT`, `IN_PROGRESS`, `SAFETY_HOLD`, `DISPUTED`. They appear only in
one UI column list (`observatory/web/store.ts:72-75`). See D14.

### 4.2 run-log (implicit, P2)

`RunRecord` is a tagged union (`runlog.ts:31-58`). The intended stream is `run_start`, then records with
non-decreasing `t`, then `run_end`. Implied state per member: `joined`, `opted_out` and back through
`opt_in`, and a participation state. The judge and the observatory projector read it. `parseRunLog`
(`runlog.ts:65`) has no caller outside core; each reader has its own parse. It would throw on a partial
last line after a crash. Only the sim uses these files, so model nothing here. Judge invariants belong in
`sim.md`.

### 4.3 clock-rng-time (implicit, P2)

- `SimClock` is monotonic and refuses a move back (`clock.ts:12-13`). `RealClock` is not monotonic. An NTP
  step can move time back, and the many `now - x` checks in other packages assume it does not.
- `Rng` and `EngineRng` are stream states. `Rng.fork` does not advance; `EngineRng.fork` depends on state,
  so draw order matters. Determinism is a sim gate, not a Quint target.
- `inQuietHours` is a pure function. `s === e` means no quiet hours. A window that wraps midnight is
  handled. An invalid time zone throws from `Intl`.
- `fmtCache` (`time.ts:11`) and `warned` (`llm.ts:233`) are in-memory maps that only grow, keyed by small
  sets. Neither needs a model.
- `llm.ts` and `chatJson.ts` use `RealClock`, and `backoffMs` uses `Math.random` as defaults. Both can
  be injected. Since these are I/O paths, they do not break the sim invariant.

## 5. Suspected defects

Confidence: **high** means I saw the behavior in a probe or read the whole path. **Medium** means that
the core behavior is verified, and the effect depends on something I did not fully trace.

### D1. Ordinary STOP phrasing is not an opt-out (P0, high)

`detectKeyword` needs an exact keyword or an `optOutPhrase` regex match. The phrase rules need an object
such as "texting me" (`replies.ts:335-349`). Probe, `detectKeyword` returns nothing for:

```
"stop it"  "STOP IT"  "stop now"  "stop already"  "stop this"  "STOP STOP"  "stop stop stop"
"Stop. Now."  "I said stop"  "I told you to stop"  "I asked you to stop"  "delete my account"
"i want out"  "stop everything"
```

Trigger: a member texts "STOP STOP" on the shared line.

1. `platformKeyword` returns undefined, and `leaveTarget` returns undefined (`service.ts:1049,1079`).
2. `isComplianceText` is false, so the row gets no priority, and no earlier rows are cancelled.
3. The turn goes on, usually to `open`, and the model answers.
4. If the agent posts an `opt_out` signal, it waits for a person (`service.ts:1957`).

So proactive messages keep going. `replies.ts:20` says the caller honors "likely" readings.
`evals/opt-out-parse.jsonl` labels "stop it" as `likely`, but that corpus tests only `parseOptOut`.
A search of `evals/opt-out.jsonl` found no row for "stop it", "stop now", "stop this", "stop stop" or "said stop" as a stop. The opposite row "stop it you're making me blush" is
why a plain regex is not enough. `parseOptOut` already handles that case (`replies.ts:289`).

I could not check the upstream gateway. AGENTS says only one system answers STOP, and that is the backend.

### D2. `parseOptOut` is not on the production path, and the readers disagree (P0, high)

AGENTS decision 11 says "Use `parseOptOut` on the inbound path". The only callers are in
`scripts/sim/evals.ts`. Disagreements seen in a probe:

| text | `detectKeyword` / `leaveTarget` | `parseOptOut` |
|---|---|---|
| "unsubscribe from peon" | leave peon | likely, scope **all** |
| "stop slop", no `apps` passed | leave slop | likely, scope **all** |
| "i said stop texting me" | stop | **none** |
| "stop it" | nothing | likely |

So wiring `parseOptOut` in as it stands breaks the leave rule. Either choice needs one reader. A Quint
model cannot find this. It belongs in a corpus test that runs both readers on every row.

### D3. Reported-speech guard drops a first-person STOP (P0 if wired, high)

`replies.ts:286` matches `said stop`, so "I said stop" and "STOP!! I said stop" return `none`. The rule
was written for "my friend said stop". It does not check the subject. It has no effect today because of
D2. It is a blocker if `parseOptOut` is wired in to fix D1.

### D4. Questions read as yes (P0, high for the reader, medium for effect)

Probe, `parseReply` returns `yes` for:

```
"are you sure?"  "is that ok?"  "ok?"  "yes?"  "sure?"  "sounds good?"  "are you ok"
"who is she? sure"  "i wish i could say yes"  "i said yes to someone else"
```

The file header says "Anything it cannot read confidently is 'unsure'" (`replies.ts:17`). The no-decisive
branch checks for `?` (`replies.ts:210`), but the yes branch does not.

Effect on the consent path is limited: `consentOf` has its own question check (`classify.ts:560`), and
"are you sure?" reads `unclear` there. Two paths use the raw result:

- `engine/src/packs/slop/onboard.ts:93`: at the read-back, "are you sure?" sets `confirmed = true`.
- `network/service/packs.ts:128`: at the widen question, "sure?" widens the radius to 25 miles.

Both are recoverable, but a confirmation that the member did not give is a consent error.

### D5. The consent veto ignores "unsure" (P0, medium)

`classify.ts:601` turns a yes into unclear only when `parseReply` says `no`. AGENTS decision 11 says only
`answer: "yes"` is consent. Probe: "sure if" gives `parseYesNo` = yes and `parseReply` = unsure. Texts
where both say yes but should not: "sure 🤔", "yes!! wait", "sounds good, wait", "yeah right". The comment
at `classify.ts:599` shows that the veto on "no" was a choice, so this may be accepted. The rest of the
table shows that `consentOf` usually catches hedges by itself. The veto could be tightened to require
`yes`, but that needs a corpus run first.

### D6. A leave is timed at processing, not at send time (P1, medium)

`consentAt` says the ledger orders "STOP, START, leave and joins" by when the person sent them
(`service.ts:1353-1356`). `accounts.leave` uses `this.now()` (`accounts.ts:422`).

Trigger: "leave slop" at T1 fails and is retried. A join or START at T2 is handled first. The leave
commits with `at = T3`, so it beats the newer opt-in. That is the reverse of what `service.ts:1106`
protects for START. The inbox handles compliance rows first, which narrows the window on one path.

In the no-person branch the wire `at` (`t`, `service.ts:1090`) and the ledger `at` (`consentAt`,
`service.ts:1089`) also differ, so the gateway fence and the ledger hold different times.

### D7. Authentication and billing errors do not fall back (P1, high)

`llm.ts:306` fails at once on 401, 402 and 403. The reason at `llm.ts:193` is "the next provider would
reject the same request". That is true for a bad request, not for a bad key or an empty account at
Surplus. Probe: a 401 and a 402 from the first endpoint give no call to the second endpoint. Every LLM use
fails until an operator acts, while a working OpenAI key sits unused. AGENTS names only 429, 5xx and
timeouts, so the code matches the written rule. The stated reason is what is wrong.

### D8. Deadline at or below the timeout prevents fallback (P2, high)

The first attempt gets `min(timeout, remaining)` (`llm.ts:278`). If it hangs, `remaining() <= 0` at
`llm.ts:298` throws `deadline`, before `retry` can fall back. Probe: timeout 200, deadline 200: one attempt
at the first endpoint, then the error. No production caller sets a deadline, so the default of 3x avoids
this. It applies to any future caller with a short budget, such as an 8 s turn.

### D9. Smaller LLM client issues (P2, high)

- Empty content after 2 regrows returns `""` as success (`llm.ts:332-335`). Probe confirmed it. `chatJson`
  turns this into `no_json`, but a direct `chat()` caller gets an empty string.
- A regrow at the cap resends the same paid request (`llm.ts:329`). Probe: 32768 three times.
- A regrow from an unset `maxTokens` sets 8192 (`llm.ts:329`), which can be lower than the provider default
  that caused the truncation.
- `LLM_TIMEOUT_MS=0` also removes the deadline, since the default is 3 x 0 (`llm.ts:215`). A hung request
  then never ends. AGENTS describes the two as separate settings.
- `tryChatJson` with `attempts: 0` returns `error: undefined`, and `chatJson` throws `undefined`
  (`chatJson.ts:76,83`). `deadlineMs: 0` means "none" on `ChatOptions` but "the client default" on
  `ChatJsonOptions` (`chatJson.ts:49`).

### D10. Most wire files have no mirror pin (P1, high)

AGENTS and `contract-mirror.test.ts` cover `contract.ts` and `svc-auth.ts`. `check-contract-mirror.ts:10`
has the same two. The other seven files define wire shapes shared with Cloud:
`network-delegation.ts`, `profile-review-owner.ts`, `profile-review-source.ts`,
`profile-review-withdrawal.ts`, `profile-review-disconnect.ts`, `learning-consent-context.ts`,
`learning-collection-command.ts`. The last says it "Matches Cloud's explicit source/window/field/retention
grammar" (`learning-collection-command.ts:40`). A one-sided change there fails with no test. All the parsers
fail closed, so the effect is an outage of the feature, not a bypass.

### D11. Contract and reader differ on `acceptedAt` (P2, high)

`contract.ts:342` requires `acceptedAt: string` on `ok: true`. `cloud-channel.ts:47-55` accepts its absence
and uses its own clock. The AGENTS summary of `DeliverResponse` and `TurnResponse` also omits later fields
(`acceptedAt`, `replyIds`, `delivery`, `replyKind`, `accountEligible`). A strict reader on the contract would
refuse what this reader accepts.

### D12. Zero tolerance for proof clock skew (P2, medium)

All five proof parsers refuse `issuedAt > now`. The HMAC allows 60 s of skew, while the proof allows 0.
With the source proof at 5 s maximum, a Cloud clock 5 s ahead makes every source proof fail. The result is
closed, so this is liveness only. I did not measure skew in production.

### D13. Contact guard exempts a joined number after a keyword (P1, high for the guard, medium for effect)

`isPhone` drops a match that follows `order`, `ref`, `id`, `acct`, `case`, `conf`, `#` and others
(`guard.ts:190`). The 7-digit pattern cannot match inside a longer digit run, so nothing else catches it.
Probe: `findLeaks` returns nothing for "ref 2125550102", "my id 2125550102", "acct 2125550102" and "order
2125550102". With spaces ("id: 212 555 0102") the 7-digit pattern still catches it.

On the relay path `classifyRelayText` catches these (`contact:spelled_phone`, probe). The outbound queue runs
only `LeakGuard`, and its `exact` list catches phones that it knows. The remaining gap is a number that the
guard does not know, in text that reaches the queue. `maskPii` has no such exemption.

### D14. Eight `OpportunityState` values cannot occur (P2, high)

See section 4.1. Staff board columns list states that nothing writes. The projector also adds `SKIPPED`,
which is not in the core type (`observatory/src/types.ts:103`). This is schema noise, but a Quint model should
use the reachable set.

### D15. Stale comment on a booked plan (P2, high)

`core/src/network.ts:72-74` says a reply with "can't" or "cancel" cancels a booked plan. A bare CANCEL is a
global STOP (`replies.ts:308`, `consent.ts:69`, and `network/src/copy.ts:28` says so). A member who wants to
drop one date and sends "cancel" unsubscribes from every app. The copy avoids asking for it, and
`docs/network.md:640` records it. The hazard stays, since members choose their own words.

### Hypotheses checked and rejected

- A blocked thread text sticks forever: no. See section 2.2.
- An HMAC header with a float or `+` timestamp: the signature covers the normalized number, so nothing
  is gained.
- `Number(null)` gives ts 0 when the header is missing: it then fails `stale`, or `missing` if id or sig
  is also absent. It is refused either way.
- A reflected request accepted as a proof response: refused by the `:proof` id and the parser.
- `PHOTO_RELAY_TTL` above the contract limit: no, both are 15 minutes.
- The LLM reader breaks the 8 s turn: not wired in the service.

## 6. Quint plan

Priority order:

1. **consent-fence** (P0): `optout-reader` as an oracle, `wire-consent`, ledger from
   `platform-identity.md`, inbox ordering from `network-service-inbound.md`, gateway fence as an assumption.
   State: `ledger`, `fence`, `pendingTurns`, `responses`. Actions: `sendText(kind)` with kinds stop, start,
   leave, stopLikely, other; `process`, `retry`, `crash`, `deliverResponse`, `proactiveSend`.
   Invariants: no proactive send after a STOP is committed and mirrored; fence equals resolved ledger at
   quiescence; a retry does not undo a newer state. Add a `stopLikely` action to expose D1 as a liveness
   failure: `eventually optedOut` after a stop intent.
2. **turn-receipt** (P0): turn-wire and svc-auth. Bounds: 2 messages, 2 retries, 1 crash.
   Invariants: effect at most once for an id; a receipt cannot move a final state; `collected` is never
   read as `sent`.
3. **proof-exchange** (P0): one parametric module with `ttl` and `skew`. Invariant: no effect after
   expiry. Witness for D12.
4. **age-floor** (P0): merge with identity.
5. **llm-call** (P1): model alone. Quick to write, a good first spec. Invariants in section 3.1.
6. **deliver-id** (P1): merge with the outbound queue.
7. **route-window** (P1): small; three time zones.

Abstractions that apply to all:

- Regex readers, leak checks and HMAC are uninterpreted. Test them with corpora, not Quint.
- Time is an integer with small steps. Model skew as a bounded offset per side.
- Hashes are ids. Secrets are a set of honest signers.
- `reply-reader` and `leak-gate` are oracles with a nondeterministic misread. The question is what a misread
  can reach.

What Quint will not find here: D1 to D5 and D13 are language-reading errors. Corpus rows are the right
gate for those. The repo policy calls for a corpus row or sim gate with a bug fix, and rows for D1, D2, D3 and
D4 are the first fix to make.
