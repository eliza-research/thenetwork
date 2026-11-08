# Quint findings: `quint/join_age.qnt`

Date: 2026-11-08. Branch `wave2/join_age`, base commit ad67275. Model: [quint/join_age.qnt](../../../quint/join_age.qnt).
Module plan: section 6.3 of [2026-11-07-state-machines.md](../2026-11-07-state-machines.md). This file is
hand-written. The traces are short forms of simulator and Apalache counterexamples (generated), checked by hand
against the code. No code was changed.

## 1. What the model covers

Machines: `text-join` (M-014), `web-join` (M-015), `age-floor` (M-016), `member-age-policy` (M-017),
`minor-single-player` (M-018), `looking-for-enroll` (M-019), `membership` (M-020), `staff-invite` (M-021),
`eliza-notice` (M-112), `member-onboarding` (M-113).

Scope: one phone, one person, three apps (ntwrk, slop, friends). Text ages {12, 15, 25}. Web ages {0, 12, 15, 25}.
Join modes are the production values: ntwrk invite-only on the web, slop and friends open (AGENTS.md 2026-10-09).
`min_join_age` is 13 on every app (migration 0007:141). Every text turn is a signed gateway turn.

State: `db` (durable rows: person, `lowest_age`, `age_floor`, pending join and looking-for rows, memberships and
member ids, network members with record age, `minor`, stage and awaiting interview, the Eliza notice row), `vol`
(the in-memory `statedAges` of R:131), `turn` (the turn in flight and its program counter), and `g` (ghost history
for the invariants).

Steps: one action per transaction or unit of work, in code order:

- Text join (S:1384-1463): `receive` (route, read only), `noticeStep` (S:1187-1196), `joinStep` (the decision),
  `underStep` and `underNoticeStep` (S:1417-1424, S:1146), `personStep`, `ageStep`, `memberStep`, `createStep`,
  `welcomeStep`, `afterStep`, `lfPendStep`.
- Member text (S:1110-1124): `unitStep` (one ConsentNetwork unit, N:674-842 abstracted), `flushStep` (S:1293-1301
  `takeAges` and `recordAge`), `flushForgetStep` (S:1302-1309).
- Looking-for answer (S:1471-1503): `enrollStart`, `enrollApp(a)`, `enrollCreate`, `enrollNext`, `enrollEnd`.
- Web join (A:347-393, S:788-794): `webJoin`, `webCheck`, `webPerson`, `webAge`, `webMember`, `webCreate`,
  `webWelcome(throws)`, `webCatch`.
- Other actors and failures: `staffInvite`, `pendingExpire` (S:119, one day), `deleteAll` (A:415-427), `crash`
  (memory and `onFail` lost; the turn becomes `unresolved` and its replies never go out), `stepThrows` (a step
  throws; `onFail` runs). At most 1 crash and 1 throw per trace.

Oracles (README rule 7): the message carries the output of `keywordApp`, `parseJoinText`, `lookingFor` and the
network classifier (`kw`, `age`, `name`, `wants`, `signal`, `long`, `explicit`), and `doneStep(present)` chooses
the presence check in `singlePlayer`.

Not modelled: two turns at the same time (the text and web joins share the `join:<phone>` lock; the member path is
taken as alone), STOP, leave, holds, bans, photos, suppression, waitlist join mode, and staff `clearMinorSignal`.

## 2. Invariants (all in `val safety`)

| Invariant | Rule | Result |
|---|---|---|
| `lowestWins` | AGENTS.md decision 1, A:4-6: the lowest stated age wins (once the phone has a person or a stored age) | fails: SD-010, SD-011, SD-038, SD-383 |
| `minorNeverMatched` | AGENTS.md decision 1 and code invariants: a person who stated an age under 18 is matchable nowhere | fails: SD-010, SD-011, SD-038, SD-383 |
| `under13StoresNothing` | policy.ts:2, A:7: under 13 stores nothing but the floor | fails: SD-014, SD-315 |
| `noOrphanMember` | S:719-722: a network member belongs to a live membership with the same member id | fails: SD-015 |
| `activeImpliesMember` | A:11-12: an active membership has its network member | fails: SD-128 (text), Q-join_age-2 (web) |
| `oneMemberPerApp` | A:11-12: one member per app; a live membership keeps its member id | fails: SD-127, SD-015 |
| `minorNoAdultQuestion` | policy.ts:3, N:985: no adult interview for a minor | fails: SD-213 |
| `noticeSpentImpliesDelivered` | S:1167-1174: a failed turn stores nothing | fails: SD-276 |
| `enrollAnswered` | S:1464-1470: the Network confirms in one text | fails: SD-126 |
| `enrollTurnApp` | AGENTS.md decision 2: the turn names the app of the member that replies | fails: SD-125 |
| `enrollOnlyFromAnswer` | S:1114: enroll is the answer to the question | fails: SD-179 |
| `lookingForAnswerEnrolls` | S:1114: an answer that names an app is that answer | fails: Q-join_age-1 |
| `inviteReplyJoinsInvitedApp` | S:1550-1552: the reply with name and age is the join of the invited app | fails: SD-488 |
| `minorIsSinglePlayer` | AGENTS.md decision 1, R:732: a member the network holds as a minor is single-player in the open context | fails: SD-066 |
| `minorChatReachesAgent` | AGENTS.md age policy: a member aged 13-17 can chat with the agent | fails: SD-065 |

Witnesses (all reachable): `witness_adultTextJoin` (an adult joins by text in at most 3 texts),
`witness_minorJoined` (a 15-year-old joins and is matchable nowhere), `witness_under13Declined` (under 13: only
the floor), `witness_enrolled`, `witness_noticeDelivered`, `witness_webJoined`, `witness_matchable`.

Not added from the plan: `inviteRespected` (the join modes are fixed to production values, so only the ntwrk web
path is invite-only and the model has no path around it; SD-123 was refuted for the same reason) and the
`waitlist` liveness property (no app uses waitlist; SD-295 was refuted).

## 3. Model errors found and fixed

The first runs gave counterexamples that were errors in the model, not in the code:

1. `minJoin(slop)` was 18. It is 13 (apps.ts:75, migration 0007:141). With 18 the model showed a "15 recorded as
   18" defect at S:1300 that cannot happen.
2. The age of a web join refused as invite-only was counted as a statement. A:364 refuses before the age is read.
3. The age of a web join counted as a statement at `webCheck` on the accept path. Nothing commits there; the age is
   first stored at `webAge` (A:372).
4. `minorIsSinglePlayer` fired for an orphan member. `sharedContext` returns null without an active membership
   (R:705-706), so no context goes out. The invariant now applies only when a context exists.
5. `lowestWins` fired for a stranger whose pending age expired and who never joined. The rule now binds once the
   phone has a person or a stored age.

## 4. Real defects: traces and code

Each trace below is also a `run` test in the model (name in brackets). All 20 run tests pass. S, A, PS, R, N as in
the model header.

**SD-010: a pending age is replaced or forgotten** (`sd010PendingAgeReplacedTest`). Text "15" -> `joinStep`
stores `pending{age:15}` with no `recordAge` (S:1430-1432) -> text "Sam 25" -> `said.age` wins over `p.age`
(S:1403) -> `recordAge(25)` (S:1438) -> person and floor 25, stated 15. Same end through `pendingExpire` (S:119)
or `deleteAll` (PS:323 deletes pending rows; the floor gets only the person's age): the 15 is never on the floor.
Fails `lowestWins` and `minorNeverMatched`.

**SD-011: a chat-stated minor age lives in memory** (`sd011CrashLosesMinorAgeTest`). Adult joins ntwrk and
friends at 25 -> text "I'm 15" on ntwrk -> `unitStep` commits (`m.minor` true on ntwrk, R:164 pushes to
`statedAges`) -> `crash` before `statedAge` (S:1123) -> person, floor and the friends member stay 25 -> friends
member matchable. Also through `stepThrows` at `flushStep`: `takeAges` (R:133-137) removed the age before
`recordAge` failed. Fails `lowestWins`, `minorNeverMatched`.

**SD-014: under 13 keeps the other memberships** (`sd014Under12KeepsMembershipsTest`). Web join friends 25 ->
web join slop 12 -> repeat-free branch, `joinAgeCheck` fails -> `recordAge(12)` (A:368) -> `under_age`; the
friends membership stays active (A:366-370; the same in A:357-362 and S:1417-1424). Fails `under13StoresNothing`.

**SD-015: a failed web join leaves an orphan member** (`sd015WebJoinOrphanTest`). Web join slop 25 ->
`createMember` commits (S:792) -> `welcomeJoined` unit throws (S:793) -> catch: `forgetMembership` and
`join_failed` (A:389-391), no `onForget` -> membership `removed`, network member active. A rejoin then makes a
second network member row (`oneMemberPerApp`, flag `dupMember`). Fails `noOrphanMember`, `oneMemberPerApp`.

**SD-038: the looking-for answer skips the age reading** (`sd038EnrollSkipsAgeTest`). Adult joins ntwrk at 25 ->
answer "dating, I'm 15" -> `enroll` (S:1116-1117) runs before `memberMessage`; no unit reads the text, no
`statedAge` -> slop membership and member at the stored 25 (S:1492) -> slop member matchable. Fails
`lowestWins`, `minorNeverMatched`.

**SD-065: a minor's long text never reaches the agent** (`sd065MinorConciergeTest`). "Sam 15" joins ntwrk ->
an ordinary text over 12 characters -> N:835 `concierge` -> `handled`, not `open`. Fails `minorChatReachesAgent`.

**SD-066: `singlePlayer` and `m.minor` differ** (`sd066SinglePlayerTest`). "Sam 25" with a minor signal joins
ntwrk -> the welcome unit sets `m.minor` (N:717-718); no age, so nothing reaches `statedAge` (S:1294 filter) ->
"hey" -> `open` -> `singlePlayer` is `!canBeMatched(lowestAge = 25)` = false while the network holds a minor
(R:732). Fails `minorIsSinglePlayer`.

**SD-125: the enroll turn names the wrong app** (`sd125EnrollTurnAppTest`). Adult joins ntwrk -> "friends
please" -> `enroll` -> `createMember(friends)` sets `turn.app = friends` (S:747-750); the confirmation is the
ntwrk member's (S:1499). Fails `enrollTurnApp`.

**SD-126: an enroll that joins nothing is silent** (`sd126SilentEnrollTest`). "Sam 15" joins ntwrk (minor
question) -> "dating" -> slop filtered out (S:1481) -> `joined` empty -> pending deleted (S:1496), no reply
(S:1499). Fails `enrollAnswered`.

**SD-127: a text join replaces a live member id** (`sd127MemberIdReplacedTest`). "Sam 25" -> crash after
`putMembership` (S:1446) -> no network member, so the next "Sam 25" is a non-member join again -> new member id
`${app}_${uuid}` (S:1442) -> `putMembership` `on conflict ... do update set member_id` (PS:124-129) replaces the
live membership's id. Fails `activeImpliesMember` (the window, SD-128) and `oneMemberPerApp`.

**SD-179: the looking-for question stays open** (`sd179LateEnrollTest`). Adult joins ntwrk -> "not sure yet"
(no app word) -> falls through to `memberMessage` (S:1117-1124), pending stays -> later "going out with friends
tonight" -> `enroll` friends with an opt-in. Fails `enrollOnlyFromAnswer`.

**SD-213: a minor mid-interview gets adult questions** (`sd213MinorGetsInterviewTest`). "Sam 25" joins ntwrk
(stage q1, awaiting interview) -> "i have homework" (minor signal) -> `minorNotice` and return (N:728), awaiting
stays -> "hey" -> `onInterviewAnswer` -> q2 adult question (N:1094). Fails `minorNoAdultQuestion`.

**SD-276: the one-time notice is spent and never delivered** (`sd276NoticeSpentTest`). First contact "hi" ->
`noticeStep` commits the row and the collected notice (S:1188-1189) -> `joinStep` -> `crash` -> `onFail`
(S:1195) is lost; the turn is `unresolved` and the retry is refused -> the row stays, the notice never went out.
Fails `noticeSpentImpliesDelivered`.

**SD-315: a floor under 13 still gets the join question** (`sd315FloorUnder13AskedTest`). Web join slop 12 ->
floor 12 -> text "hi" -> `join` with no age never reads the floor (S:1406-1414) -> pending join row and the join
question. Fails `under13StoresNothing`.

**SD-383: age 0** (`sd383AgeZeroTest`). Web join friends age 0 -> `parseJoin` accepts it (A:87,
`validAge` allows 0) -> `joinAgeCheck` fails -> `recordAge(0)` -> `noteAgeFloor` raises on the check
`lowest_age > 0` (migration 0006:19) -> server error, nothing stored -> web join friends 25 succeeds. Fails
`lowestWins`, `minorNeverMatched`.

**SD-488: an invite reply joins the wrong app** (`sd488InviteReplyTest`). Staff invite to friends -> "Sam, 25"
with no keyword -> `member_apps` ignores invited rows, no pending join, so `route` returns ntwrk (S:980) -> join
ntwrk and the looking-for question; the friends invite stays open. Fails `inviteReplyJoinsInvitedApp`.

### New defects

**Q-join_age-1: the bare answer "friends" to the looking-for question starts a new join**
(`q1BareKeywordAnswerTest`). Trace: adult joins ntwrk with no keyword -> question "What are you looking for:
friends, dating, work, or all of these?" (S:126) -> answer "friends" -> `route` sees the whole-message keyword
first (`namedApp`, S:967; apps.ts:97-104) and routes to friends -> not a friends member -> `join(friends)` with no
age -> pending join and the join question "first name and age" (S:1406-1414). The enroll branch (S:1114-1117) is
never reached; the looking-for pending row stays open (so a later text can still enroll, SD-179). The same for a
bare "slop" or "slop.date". The answer the question offers first is the one that fails. The integration test
(packages/network/test/service-platform.test.ts:180, 201) uses only phrases ("dating and friends please"), so it
does not see this. Fails `lookingForAnswerEnrolls`.

**Q-join_age-2: a web join that stops after `putMembership` is never completed** (`q2WebJoinNoRepairTest`).
Trace: web join friends 25 -> `webMember` commits the active membership and the opt-in (A:383-385) -> the process
dies before `onJoin` (A:388) -> the client retries -> `existing` is active, so the repeat branch (A:357-362)
records the age and returns `{ok: true, membership}` -> no network member and no welcome. The membership stays
active with no member until the person texts, and then the text join replaces its member id (SD-127). SD-128 was
refuted for the text path only (the next text runs `join` again); the web retry has no such path. Fails
`activeImpliesMember`.

## 5. Register defects of this module

Reproduced: SD-010, SD-011, SD-014, SD-015, SD-038, SD-065, SD-066, SD-125, SD-126, SD-127, SD-179, SD-213, SD-276,
SD-315, SD-383, SD-488. Also the window of SD-128 (refuted in the register: the next text repairs it, but only
through SD-127).

Not reached:

- SD-080 (a word and a number in a first text is a full join). The defect is in the parser: "Area 51" reads as
  name and age. The parser is an oracle in the model (README rule 7), so any text can carry `age` and `name`. An
  `evals/` corpus row for `parseJoinText` is the right proof.
- SD-123 (refuted), SD-145 (refuted), SD-270 (refuted), SD-272 (refuted), SD-295 (refuted), SD-436 (refuted): the
  model uses the production join modes and has no waitlist app and no `clearMinorSignal`.

## 6. Check output

`bun run quint:check quint/join_age.qnt` (seed 0x5eed, max-steps 40, max-samples 4000): typecheck ok, 20 run
tests ok, `safety` FAIL (expected: the defects above), 7 witnesses reachable.

`quint verify --invariant safety --max-steps 10` (Apalache): a counterexample at depth 4 in about 7 s. Shortest
Apalache counterexample per invariant: see section 7.
