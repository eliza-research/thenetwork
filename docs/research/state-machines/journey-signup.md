# Journey report: joining The Network

Key: `journey-signup`. Date: 2026-11-07. Branch: `claude/quint-state-machines`. Hand-written.

This report follows the join journeys across packages. It does not repeat the per-package reports. It names their machines and defects by report and number, and it adds what only shows when you follow one person across two or more machines.

Short names for files:

| Name | File |
|---|---|
| S | `packages/network/service/service.ts` |
| I | `packages/network/service/inbox.ts` |
| R | `packages/network/service/runtime.ts` |
| N | `packages/network/src/network.ts` |
| A | `packages/platform/src/accounts.ts` |
| API | `packages/platform/src/api.ts` |
| PS | `packages/platform/src/pg-store.ts` |
| H | `packages/mcp/src/handler.ts` |
| T | `packages/mcp/src/tools.ts` |
| K | `packages/mcp/src/hooks.ts` |

Other reports: PI = `platform-identity.md`, IN = `network-service-inbound.md`, MO = `mcp-oauth.md`.

Evidence labels: **probe** means I ran the code. **trace** means I read the code path line by line and did not run it. I ran one probe only: `parseJoinText` under bun, with no database and no network. The script is at `/private/tmp/claude-501/-Users-nubs-thenetwork/fb3a81a2-1e7b-4e4d-a9fa-a85215213426/scratchpad/p.ts`. The Eliza gateway and Eliza Cloud are not in this repository. Claims about them come from the contract mirror and the docs only.

## 1. Summary

### 1.1 Journey-level machines (new in this report)

| Id | Kind | What it is | Priority |
|---|---|---|---|
| `first-contact-classifier` | implicit | What a non-member's message means: nothing, name, age, or a full join | P0 |
| `join-journey` | implicit | One phone from first text to live member, over pending, floor, person, membership, consent, member | P0 |
| `person-safety-carryover` | implicit | Whether a hold, report or minor signal stays with the person across member ids | P0 |
| `fence-sync` | implicit | Ledger state against the gateway send-time fence | P1 |
| `resume-scope` | implicit | Which memberships a START can reach after a global STOP | P1 |
| `signup-channel-mode` | implicit | Which join channels are open for each auth mode and app | P1 |
| `agent-profile-handoff` | implicit | Where the agent's approved profile goes after Join | P1 |
| `eliza-nonmember-loop` | implicit | What an eliza.app user who does not join gets, message by message | P1 |
| `number-change-reach` | implicit | Who can start a number change, on which auth mode | P2 |

### 1.2 New defects, most severe first

| # | Title | Where | Confidence |
|---|---|---|---|
| J1 | A word and a number in a first text is a full join, with an opt-in text never shown | S:243-266, 1402-1447 | High (probe) |
| J2 | Chat text sets a permanent age floor. No staff path clears it | S:1416-1424, PS:97-110, N:1570-1572 | High (probe plus trace) |
| J3 | Leave then rejoin ends a safety hold, an open report and a minor signal. A join on a new app is not held | S:1079-1093, N:942-945, N:1311-1324, S:1437-1450 | High (trace) |
| J4 | Join and enroll opt-ins do not reach the gateway fence | S:1447, 1491, A:384 | High for the gap; effect depends on upstream |
| J5 | After a global STOP, a second app cannot be resumed by text | S:1100-1110, 957-981, consent.ts:101-102 | High (trace) |
| J6 | The approved `about` profile never reaches the Network | A:380, S:792, SKILL steps 8-10 | High (trace) |
| J7 | A non-member on the eliza.app line gets asks, then silence, against the notice text | S:1411-1413, copy.ts:209, S:2094 | High (trace) |
| J8 | Production Cloud mode closes the agent flow, and `/join` return goes nowhere | API:463, 404, deploy/router.ts:40-49, SKILL step 4 | High (trace) |
| J9 | A number change moves the age floor off the old number | PS:356-360 | High (trace) |
| J10 | A banned or held person can delete the photos kept for safety by leaving | S:1078-1093, S:758-760, S:1752 comment | High (trace) |
| J11 | An under-13 statement in chat skips the forget listeners and keeps the person | S:1304-1309, S:758-766 | High (trace) |
| J12 | An invite to a non-ntwrk app, answered with no keyword, joins ntwrk | S:957-981, A:335-343 | High (trace) |
| J13 | Number change has no caller, and no staff path exists | API:583-624, grep of sites and skills | High (trace) |
| J14 | "leave <app>" during a join is read as a name; an invited person's leave is lost | S:1081-1094, 1402 | High (probe plus trace) |
| J15 | Web under-age refusal keeps a session with the number for 30 days | API:545-561, A:366-370 | High (trace) |
| J16 | A ban covers only current numbers; a number moved off earlier stays free | S:1740-1751, PS:374 | High (trace, design gap) |

### 1.3 Earlier defects that these journeys hit

| Journey step | Defect |
|---|---|
| Age given, no name yet | PI-D1 / IN-D3: a later older age replaces it. Section 6 adds a variant through an app switch |
| Reply to "what are you looking for" | IN-D4, IN-D6, IN-D7, PI-D6 |
| Join commit sequence crash | IN-D10, IN-D11, PI-D10 |
| Join after STOP in a signed turn | IN-D5 |
| Web OTP for a banned number | PI-D2 / MO-D2 |
| Live grant after a ban | MO-D1, PI-D14 |
| Agent contract conflict | MO-D3 |
| `/join` links in tools | MO-D6, MO-D7 |
| Number change with a Cloud grant row | MO-D5, PI-D25 |
| Non-member receipts | IN-D22 |

## 2. Shared state map

One person's join touches these. "Boundary" says what commits apart from the rest.

| State | Where | Written by | Boundary |
|---|---|---|---|
| Turn claim | `platform.inbound` | I:81-132 | Own tx, before effects |
| Pending text | `platform.pending_texts` | S:1411, 1431, 1456, 1461 | Own tx |
| Age floor | `platform.age_floor` | PS:97 | Own lock (`phone-age:`) |
| Person, phone | `platform.people`, `phone_identities` | PS:64 | Own tx |
| Membership | `platform.memberships` | PS:124 | Own statement |
| Consent ledger | `platform.consent_events` | PS:131 | Own statement, unique by `(e164, ref)` |
| Suppression | `platform.suppression` | PS:183, 191 | Own statement |
| Member row | `network.members` | S:728 | Own tx |
| Network state | `network.network_state` | unit of work | Own tx and network lock |
| Notice | `platform.eliza_notices` | S:1187 | Tx with collected reply |
| Gateway fence | upstream | gateway, from `consent` in a handled turn | Other process |
| Session | `platform.sessions` | API:491 | Own statement |
| OTP challenge | `platform.otp_challenges` | otp.ts:187 | After the provider send |
| OAuth grant | `oauth.grants` | H:finishAuthorization | Own statements |

No join path has one transaction over person, membership, consent and member. Every journey below has a crash window at each row boundary. The inbound and identity reports list those windows. Section 8 adds the journey view.

## 3. Journeys

Each table shows the state after the step. `-` means no change. Columns: pending (P), floor (F), person (Pn), membership (M), consent for this app (C), member row (Mr), fence (Fe).

### 3.1 First text with a keyword (slop, stranger, signed turn)

Actor: member. Trigger: Blooio webhook, gateway, `POST /internal/turn`.

| # | Step | Code | P | F | Pn | M | C | Mr | Fe |
|---|---|---|---|---|---|---|---|---|---|
| 0 | Before | | none | none | none | none | none | none | none |
| 1 | "slop" reaches `sharedTurn`, claim row | S:1976-2067, I:86-99 | - | - | - | - | - | - | - |
| 2 | `route`: whole text names slop | S:966 | - | - | - | - | - | - | - |
| 3 | Lock `join:<e164>`; notice collected, row written | S:1140-1141, 1187-1191 | - | - | - | - | - | - | - |
| 4 | `join`: no age, pending, ask collected | S:1411-1413 | asked | - | - | - | - | - | - |
| 5 | Response `handled`, reason `onboarding_asked` | S:2084, 2094 | - | - | - | - | - | - | - |
| 6 | Gateway sends, posts receipt | S:2003-2049 | - | - | - | - | - | - | - |
| 7 | "Sam, 29": `route` step 3 (pending, not a member) | S:971-972 | - | - | - | - | - | - | - |
| 8 | Age check passes, name present | S:1416-1435 | none | - | - | - | - | - | - |
| 9 | Person created | S:1437 | - | - | new | - | - | - | - |
| 10 | Floor and person age, suppression lifted | S:1438-1440 | - | 29 | age 29 | - | - | - | - |
| 11 | Membership active | S:1446 | - | - | - | active | - | - | - |
| 12 | Consent with the ask text | S:1447 | - | - | - | - | opted_in | - | **unchanged (J4)** |
| 13 | Member row, `turn.memberId` set | S:1450, 750 | - | - | - | - | - | new | - |
| 14 | First message: Network welcome, collected | S:1452, N:730, 976 | - | - | - | - | - | stage q1 | - |
| 15 | Link notice or looking-for, as a queued send | S:1454-1462 | maybe | - | - | - | - | - | - |

Result: `handled`, reason `joined`, `accountEligible` true.

Stick and loop points:

- Step 4 repeats. After 3 asks in the day bucket, no reply and the turn is handled with an empty list. See J7.
- A first text with a word and a number skips steps 4-7. See J1.
- A crash in steps 9-14 is IN-D10, IN-D11. The turn ends `unresolved`, and the retry is refused (I:107). The next text enters `join` again.

### 3.2 First text with no keyword

Same as 3.1 with `route` ending at S:980 (`ntwrk`, shared). The invite gate at S:1393 lets it pass because `route.shared && app.id === "ntwrk"`.

| # | Step | Code | Added state |
|---|---|---|---|
| 1-14 | As 3.1, app ntwrk | | ntwrk membership and member |
| 15 | `ask:` system send of `lookingForAsk(age)`, queued, not collected | S:1459-1460, R:449 | Goes by Cloud deliver as `proactive` (cloud-channel.ts:37) |
| 16 | `looking_for` pending, after the unit | S:1461 | P = looking_for |
| 17 | Reply routes to ntwrk; `lookingFor(text)` non-empty | S:1115-1117 | |
| 18 | `enroll`: per app, membership, consent (`looking_for`), member | S:1486-1492 | Other apps active, opted_in; **fence unchanged (J4)** |
| 19 | Delete pending; reply in a unit | S:1496-1501 | Not collected: IN-D6 |

Dead ends: a reply with no app word leaves P open (IN-D6). A minor who answers "dating" joins nothing and hears nothing (IN-D7). Stated ages in the reply are not read (IN-D4).

### 3.3 Agent-first signup (direct flow: slop, friends, ntwrk; SKILL 1.2.5)

Actor: the person's own agent. The agent holds the phone number and the code. MO-D3 records the contract conflict.

| # | Step | Code | Session | Pn | M | C | Mr | Network profile |
|---|---|---|---|---|---|---|---|---|
| 1 | GET `/api/app` | API:454 | none | | | | | |
| 2 | Draft and approval in chat | SKILL 2-3 | none | | | | | |
| 3 | GET `/api/auth/mode` | API:400 | none | | | | | |
| 4 | POST `otp/start`. Stops here in cloud mode (J8) | API:462-477 | none | | | | | |
| 5 | POST `otp/verify` | API:479-496 | live, person null | | | | | |
| 6 | GET `/api/me` | API:505 | live | | | | | |
| 7 | POST `/api/join` | API:545, A:351-395 | live | new | active | opted_in | | |
| 8 | `onJoin`: `createMember` | S:788-792 | | | | | new | interests and zip only |
| 9 | `welcomeJoined` | S:793, N:4825 | | | | | stage q1 | welcome text is queued |
| 10 | GET `/api/me`, GET export; read-back matches `about` | SKILL 9, A:447 | | | | | | **`about` is not in the Network: J6** |

After step 10 the agent says the profile is saved for future introductions. The member sits at stage `q1`, and only a text answer moves them on.

Join side effects when the person has a `paused` membership: `canJoin` is false, reason `member`. SKILL step 7 stops. The status tool says to text START. See J5.

### 3.4 Agent signup through MCP and OAuth (peon; other apps as a reader)

| # | Step | Code | Result |
|---|---|---|---|
| 1 | `start_signup` | T:262-276 | URL `<site>/join?via=agent`. Only peon has this page. Others redirect to `/` (MO-D6) |
| 2 | Person opens join, OTP, join on the page | `sites/peon.biz/public/join.html`, `sites/shared/join.ts` | Web join |
| 3 | Client starts OAuth | H:355-417 | With a site session: `step: consent`, skip phone |
| 4 | Phone and code, if no session | H:458-490 | `startOtp` silently skips a banned number (K:154-161); `login` gives `held` |
| 5 | Consent approve | H:494-515 | `login` runs again here. A banned session stops here |
| 6 | Token, `check_status`, `submit_profile` | T:294-316 | `submit_profile` runs `memberMessage` with `fromThread=false` and `statedAge` (S:1216-1217) |

A grant made before Join has `personId: null` and dies at Join (MO section 10). The person reconnects. This is a designed loop, with one extra step. `submit_profile` is the only channel that puts an agent's profile into the Network. The direct-flow skills do not use it.

### 3.5 eliza.app takeover notice

| Case | Notice? | Then | Code |
|---|---|---|---|
| Non-member, no STOP, first text "hi" | yes | Join ask | S:1141, 1175 |
| Non-member, first text STOP | no | Stop | S:1054 |
| Non-member, first text HELP | no | Help | S:1129 |
| Non-member, later text after STOP | **yes** | Notice, ask, hint (IN-D5) | S:1141-1144 |
| Member of any app | no | | S:1177-1178 |
| Banned | no | Silent, `held` | S:1180, 1390 |
| Held number | no | Silent, `held` | S:1061-1065 |
| Age under 13 in text, pending or floor | no | Decline | S:1183-1185 |
| Under 13 in the second text | Yes on the first; row deleted at decline | Decline | S:1146 |
| Turn fails after the notice row | Row removed by `onFail` | Next try sends it again | S:1195, I:134 |
| "Area 51" | yes | Full join in the same turn (J1) | |

After the notice, a person who does not join is in `eliza-nonmember-loop` (J7).

### 3.6 Under 13

| Entry | Stored | Reply | After |
|---|---|---|---|
| Text, stranger | Floor only | Kind decline (compliance) | Later text: join ask again (IN-D19); any age declined |
| Text, person on another app, app keyword | Floor, person age | Decline | Other memberships stay (PI-D5) |
| Text, a member states it in chat | Member forgotten; person and phone stay (J11) | Decline | |
| Text, adult record | Recorded as 13, staff case | None | S:1300 |
| Web `/api/join` | Floor. Session stays (J15) | `under_age` | Retry refused |
| Repeat `/api/join` as a member | Floor, person; membership stays | `under_age` | PI-D5 |
| MCP | No tool takes an age. `submit_profile` text runs the Network classifier | | S:1216-1217 |
| Agent, SKILL step 1 | Nothing | Agent stops | Client-side only |

### 3.7 Minor, 13-17

| Step | Result | Code |
|---|---|---|
| Text join to slop, age 15 | Allowed by founder decision 1. Member, `welcomeMinor`, stage active | N:985 |
| No-keyword join, age 15 | `LOOKING_FOR_ASK_MINOR` | S:128-130 |
| Answer "dating" | Filtered, silent | S:1481, IN-D7 |
| Answer "friends" | Enrolled, minor age on the member | S:1492 |
| Web join to slop, age 15, with `about` | The dating text stays in `membership.profile` | A:380 |
| "show my profile" | The saved text with age comes back to the same number | profile-read.ts:64-69 |
| OAuth on slop | Allowed on the full surface | |
| Age stated, no name, then an app switch or STOP | Age gone. See section 6, variant of PI-D1 | S:1401, S:1328 |

Age-lowering after join reaches every app (`ageLowered`, S:776-785). Photos and ratings go (S:779). Matching drops on the next tick (IN section 10).

### 3.8 Invite-only ntwrk

| Entry | Non-invited stranger | Invited | Former member (removed) |
|---|---|---|---|
| Shared line, no keyword | Joins | Joins, no looking-for (S:1457 `!invited`) | Joins |
| Shared line, "ntwrk" | Joins | Joins | Joins |
| Own line (`app_lines`) | One reply a day | Joins | One reply a day |
| Web `/api/join` | `invite_only` after phone proof | Joins | `invite_only` (A:364) |
| Skill | Step 1 respects `joinMode`; invited person continues | | |
| `app_info` text | "There is no public sign-up form" (T:193) | | True for the web only |

The web rule and the text rule differ by founder decision 2026-10-09 #1. The former-member row is a consequence that no doc states.

An invite creates a membership in state `invited` and a person with method `staff` (A:335-343). It writes no pending row and no member row. `member_apps` hides it. So the reply depends on `route`, and J12 follows.

### 3.9 Banned number at each entry

| Entry | Check | Result | Status |
|---|---|---|---|
| Text, non-member | S:1390 | Silent, nothing stored | Good |
| Notice | S:1180 | None | Good |
| START | S:1103, 1134 | Refused | Good |
| STOP | none, by design | Recorded, confirmed | Good |
| HELP, non-member | none, S:1129 | Answered | Compliance text; accepted |
| Text, banned member | none in `inbound` | Network trust hold returns silent (N:746), but block and report still answer | See note |
| Open turn | `activeMembership` A:324 | `context_unavailable`, no model | Good |
| `enroll` | S:1476 | Nothing joined | Good |
| Leave | none | Forget runs, photos go | **J10** |
| Web OTP start and verify | none | Code sent, session made | PI-D2 |
| Web `/api/join` | A:355 | `review` | Good |
| Delete everything | none | Runs. The ban row stays | Sound, section 7 |
| Cloud callback | API:437 | Refused | Good |
| MCP OTP start | K:159 | Silent, no code | Good |
| MCP login | K:168 | `held` | Good |
| OAuth with a live site session | K:206 checks hold only | Reaches consent; stopped there by `login` (H:498) | Sound, late |
| Existing grant | none on legacy grants | Live | MO-D1 |
| Invite | A:336 | Refused | Good |
| Number change | A:235, 260-261 | `review` | Good |
| Queued sends | S:707-709 | Refused | Good |
| Collected replies | none | See note | Gap |

Note: `consentRefused` runs on the queue path (R:575). Collected replies do not pass it. `sharedTurn` computes `policyAllowed` but returns `collected` anyway (S:2094). A banned member who sends a block text gets its answer (N:740 runs before the hold return at N:746). The text is a safety acknowledgement, so the harm is small. The rule "nothing but compliance texts" (S:708) does not hold on this path. Confidence: medium, trace.

### 3.10 Phone change

| # | Step | Code | Old number | New number |
|---|---|---|---|---|
| 1 | Fresh login on old | API:593 | session fresh | |
| 2 | `startNumberChange`: checks, rate limit, code, row | A:227-240 | row in `phone_changes` | code sent |
| 3 | Code from new | A:257 | | code consumed |
| 4 | Lock on new; ban and use checks | A:259-262 | | |
| 5 | `movePhone` tx | PS:341-378 | identity gone, consent copied then deleted, floor **moved** (J9), sessions and pending gone, waiting outbound suppressed | identity new |
| 6 | Unsuppress new | A:265 | | |
| 7 | Merge new number's floor | A:270-271 | | |
| 8 | Listeners: `identities()` | A:272, server.ts:93 | | Only this process |
| 9 | New session | API:618 | | |

A crash after step 5 is safe for ages: `lowestAge` reads floor and person. Reachability is J13. Cloud grant rows break step 5 (MO-D5). Fence: the new number has no gateway fence, and the ledger still governs sends (PI-D20).

### 3.11 Rejoin after leave, STOP or delete

| From | Text path | Web path | Result |
|---|---|---|---|
| Left app (text "leave") | Keyword, ask, hint if consent is out, then name and age | `/api/join` | New member id. Open app keeps working. **Hold, reports, signals, pair memory lost (J3)** |
| Left ntwrk | Joins by text | `invite_only` | Section 3.8 |
| STOP, member | `memberOf` true, so no join; hint; START only | `canJoin` false | Paused until START. **J5** for a second app |
| STOP, non-member | Join path, ask plus hint in a turn (IN-D5). A join opts in | Web join opts in | **Fence stale (J4)** |
| Delete everything, by staff or email | Join ask; join lifts suppression; tombstone revived | Same | Blocks stay. Floor stays |
| Under-13 decline | Declined forever | Same | Floor |
| Number on `new_owner` | Clean start, unless banned | | Ban rows stay on the hash |

The stated age is not carried over in the ask. A person who left must state an age again. `joinAgeCheck` still applies the stored lowest.

## 4. Cross-journey checks

### 4.1 Where a join needs what

| Guard | Text | Web | Enroll | Invite | MCP |
|---|---|---|---|---|---|
| Hold (recycled) | S:1061 | A:353 | via S:1061 | A:336 | K:168, 206 |
| Ban | S:1390 | A:355 | S:1476 | A:336 | K:159, 168 |
| Age floor and lowest | S:1416 | A:365 | S:1477-1485 | none, at reply | K:148 |
| Invite-only | S:1393 | A:364 | none, open apps only by data | n/a | n/a |
| Opt-in shown | Not on one-message join (J1) | Wording or version | Shown in the ask | Shown at reply | n/a |
| Safety hold of the person | **none** | **none** | **none** | **none** | none |
| STOP respected | IN-D5 | A join is a new opt-in | Age guard only | A:336 has no ledger check | n/a |
| Fence echo | none | none | none | n/a | n/a |

`enroll` has no invite-only check. Today every target app is open. If a founder sets one to invite, enroll passes it. The check is a data-dependent gap, P2.

### 4.2 Mode matrix (`signup-channel-mode`)

| Config | Text | Skill direct | Peon `/join` | OAuth phone page | Number change |
|---|---|---|---|---|---|
| No Cloud, Turnstile, no OTP-only | Open | Stops at Turnstile (SKILL step 5) | Works in a browser | Works | Works, no caller |
| No Cloud, `PLATFORM_PHONE_OTP_ONLY_APPS` | Open | Works for listed apps | Works | Works | Works, no caller |
| `production-v1` Cloud | Open | **Stops, `mode: cloud`** | Cloud sign-in, returns to `/join` | Replaced by Cloud | **409** |
| `production-v1`, ntwrk, slop, friends | Open | Stops | **`/join` redirects to `/`** | Replaced | 409 |

`PLATFORM_PHONE_OTP_ONLY_APPS` cannot list peon (API:140). `deploy` holds no committed value, so the chosen production row is a configuration fact I could not read. `docs/results/2026-10-18-production-cloud-network-handoff.md` names the production Cloud mode.

## 5. Machine notes

### 5.1 `first-contact-classifier`

State: none stored. It is a pure function of the text and `nameOk`. Output: `{age?, name?, homeCity?, invalidHome?}`. It feeds `join` and `elizaNotice`.

Classes of input and result (probe):

| Text | nameOk | Result | Journey effect |
|---|---|---|---|
| hi | no | nothing | Ask |
| Sam 29 | no | age 29, Sam | Join now |
| Area 51 | no | age 51, "Area" | Join now, adult |
| iPhone 15 | no | age 15, "Iphone" | Join now, minor |
| Windows 11 | no | age 11 | Decline, floor 11 |
| top 10 | no | age 10 | Decline, floor 10 |
| Route 9 | no | age 9 | Decline, floor 9 |
| GPT 5 | no | age 5 | Decline, floor 5 |
| my daughter is 9 | either | age 9, "Daughter" | Decline, floor 9 |
| I am 40 and my kid is 8 | no | age 40, "Kid" | Join with the name Kid |
| Tell me about jazz | yes | "Tell" | Name stored in pending |
| what time is it | yes | "Time" | Name stored in pending |
| leave slop | yes | "Leave" | Name stored in pending |
| my son turned 12 today | no | nothing | Correct |

The doc comment at S:238 says a name is read "when `nameOk`". S:263 returns early only if `age` is undefined, so an age turns the name on.

Invariants: INV-C1 a join needs an earlier ask of this app, or a clear join statement. INV-C2 a floor comes from a statement about the sender. Both fail.

### 5.2 `person-safety-carryover`

| Fact | Scope | Survives leave and rejoin? | Reaches a new app? |
|---|---|---|---|
| Ban | Phone hash, person | Yes | Yes |
| Lowest age, floor | Person, phone | Yes | Yes |
| Block | Person | Yes | Yes |
| Trust hold (`staff_hold`) | Member in Network | **No** | **No** |
| Open or held report | `subjectId` = old member | **No** (stays on the old id) | **No** |
| `minorSignal`, `minorReported` | Member | **No** | **No** |
| Decline pairs, `avoid` | Member pairs | **No** | n/a |
| Rating, photos | Person and app | Deleted | n/a |

The person row has no field for a hold. The rule is PRD 40.3: "A safety hold alone does not refuse a join, but the person cannot be matched until staff resolve it."

### 5.3 `fence-sync`

States per (number, app): ledger in or out, fence in or out. Writers of the fence: `consent` in a handled turn only (AGENTS.md "Consent path"). Echo sites: S:1090, 1108, 1136, 1325, and I:158. A ledger opt-in with no echo: S:1447, S:1491, A:384. Out with no echo: A:391, A:400, A:425, S:1308.

Out-of-sync states:

| Ledger | Fence | Effect |
|---|---|---|
| in | out | Member active, Cloud answers `opted_out`, each send ends blocked (cloud-channel.ts:63) |
| out | in | Safe. The service refuses before Cloud (S:696-716) |

### 5.4 `resume-scope`

States per person: set of paused memberships. START removes one, the routed app. `route` has no keyword form for a START with an app. `consent.ts:101-102` writes the app of the turn. `packages/platform/README.md:57` states the scope. Hint text (`apps.ts:63`) says "Reply START to resume <app>", for the app the person named.

### 5.5 `eliza-nonmember-loop`

States: `new`, `noticed`, `asked(n)`, `silent`, `joined`, `stopped`. Transition: each text goes to `join`, `asked(n+1)`. At n > 3 in the day bucket: `silent`. Window reset: UTC day bucket by `at % DAY` (PS:230). Pending keeps moving forward at each message, so it does not expire while the person writes.

## 6. Defect detail

### J1. A word and a number in a first text is a full join. P0 (consent), high, probe.

`parseJoinText` reads age from "word number" with `others.length <= 1` (S:257-260). It reads a name whenever an age exists (S:263-265). `join` needs no pending row to proceed (S:1402-1435). S:1405 sets `ask`. S:1447 stores `ask` as `wording`, although the person never saw it on this path.

Sequence: an eliza.app user on the takeover line writes "Area 51". `elizaNotice` passes. `join` makes a person, an ntwrk membership "Area", an opted-in consent event with the ask text, a member and a welcome. S:1440 also lifts suppression, and S:1447 beats an older STOP (`resolveConsent`, consent.ts:42).

So a STOPped non-member who writes "Bus 42" is opted back in, and a person who deleted everything loses suppression. The README says of the notice path: "It enrolls nobody. Joining still needs the age check and the opt-in."

The IN and PI reports treat the age, not the opt-in. The existing test uses "Sam, 12" as a first contact and expects a decline, so the one-message age read is intended for refusal. No test covers a one-message adult join to ntwrk. PRD F3 lists "accept terms and messaging consent".

Quint: action `say(class)`, with class in {chat, chatNumber, nameAge, keyword}. Invariant: `consent(p,a)=in => asked(p,a) before`.

### J2. Chat text sets a permanent age floor. P1, high.

`check.ok` false at S:1417 calls `recordAge`. `noteAgeFloor` keeps the least (PS:100). `clearAgeFloor` has one caller, A:211, the `new_owner` hold decision. `clearMinorSignal` needs a member and refuses when the stated age is under 18 (N:1570-1572). `verify` writes a facet and no age (S:1635-1648). `age_floor` has no staff route.

Sequence 1: "Windows 11". Decline. "Sam 34". `joinAgeCheck(34, 11)` fails. Every later join on every app fails. The adult cannot join.

Sequence 2: "iPhone 15". Member, minor, single-player forever.

Fail-closed is correct for a real statement. This input is not a statement. With J1 it affects the eliza.app population at takeover. The docs give no appeal path.

### J3. Leave then rejoin ends safety state. P0, high, trace.

`leave` has no safety guard (S:1079-1093, A:421-429). `forget` deletes `members`, `trust` and `cases` for the id (N:942-943). Reports keep the old `subjectId` (N:945). `reportHeld(id)` is by id (N:1295). `join` makes a new id with a new UUID (S:1443). Nothing in `join`, `createMember` or `syncMember` reads a person-level hold, since none exists.

Sequence: a member is held after a report. Text "leave slop.date". Text "slop". Text "Ben, 31". The new member passes `trust.ok`, with no held report. Matching may include them, subject to review. A reviewer sees a new member with no history.

Variant, new app: `hold` acts on live members only (S:1675-1685). A held slop member texts "friends". The new friends member is not held.

Variant, minors: "I'm in 6th grade" gives `minorSignal` (N:717-718) with no number, so `statedAge` filters it (S:1294) and the person age stays. Another member's report "he's only 15" sets `minorReported` (N:1550-1558) and writes no person age. Leave, then rejoin with 25: adult, matchable. This meets AGENTS decision 1 and "minor contacts are always 0" only if reviewers catch it.

Tests: `service-safety.test.ts:124` covers report, hold, ban, and join refused after a ban. It has no hold, leave, rejoin case.

### J4. Join opt-ins do not reach the fence. P1, high for the gap.

PRD 40.3: "A join with name and age, or a web join, also opts them back in. The service reports consent changes to the gateway send-time fence." `turn.consent` is set only at the sites in 5.3. `TurnResponse.consent` says "STOP / START / leave" (contract.ts:121).

Sequence: member of nothing sends STOP. Fence `all` out. "slop", then "Sam 29". Ledger in for slop. No `consent` in the response. Later sends reach Cloud, which answers `opted_out`. Each ends `blocked`. The member appears active and hears nothing, or hears only collected replies. I cannot see whether the gateway fence covers collected replies.

Web variant: STOP on the line, then agent signup. No turn exists to carry an echo. `enroll` variant: "leave friends.help", then ntwrk `looking_for` "friends": fence scope app stays out.

### J5. A second app cannot be resumed by text. P1, high, trace.

Sequence: member of slop and friends. STOP. Both paused, global out. START routes to the last writer, say slop (S:974-978). slop resumes (S:1105-1110). Text "friends": `route` picks friends (S:966). Not a keyword. `stopHint`: "You're unsubscribed from friends, so I can't reply. Reply START to resume." START routes to slop again, since its welcome-back raised `last_out`. friends stays paused.

An opted-out app writes nothing: `checkRecipient` refuses (N:4221), and the hint is collected without a `network.messages` row (S:1370). So friends' `last_out` does not rise. Exit paths: wait for an open item in friends that cannot be sent, or leave slop first, which deletes slop data. Web: `canJoin` false; no resume call.

IN-D29 covers which app resumes first. This is the stuck state after it.

### J6. `about` never reaches the Network. P1, high, trace.

`about` goes to `membership.profile` (A:380). Readers: `profile-read.ts:69` and export (A:457). `joined` passes first name, city, neighborhood, interests and zip (S:792). `createMember` has no `about` input (S:723). The only other path for agent text is `submitProfile`, which the direct skills do not call.

SKILL step 8 puts "the complete approved dating profile" in `about`, and step 2 forbids separate fields. Step 10 and the closing text say the profile is saved for introductions. Step 9's read-back passes because it reads `membership.profile`, not the Network.

For slop this means no gender, seeking, age range or distance. The member stays at `q1` until they answer by text. The skill calls texting "the person's separate choice". So a signup can finish with a member who is never matchable, and with a welcome text that asks everything again.

### J7. Non-member loop on the eliza.app line. P1, high, trace.

Notice text: "Nothing changes for you unless you join". After the notice, each message is `handled` with a join ask (S:1413), and the gateway calls no model. After 3 asks a day, replies is empty. AGENTS says an eliza.app non-member gets "the notice then the join flow", so the flow is intended. The notice text and the silent state are the defect. Free chat also fills `pending.name` (5.1), so a later "I'm 30" joins with the name "Tell". The ask cap does not cover S:1432 or S:1408, which have no limit.

### J8. Cloud mode closes the agent flow. P1, high, trace.

With `production-v1`: `GET /api/auth/mode` answers `cloud` (API:401), `otp/start` answers 409 (API:463). SKILL step 4: "If another sign-in mode is required, explain that this agent's direct sign-in is unavailable and stop". The MCP flow has no join tool. `POST /api/auth/cloud/start` accepts only `/join` as the return path (API:404), and `deploy/router.ts:44` redirects `/join` to `/` for three of the four apps. Only `sites/peon.biz/public/join.html` mounts the shared auth form. So in this mode slop, the first pilot, has text join only, while AGENTS decision 10 makes the agent flow primary.

### J9. Number change moves the floor off the old number. P1, high, trace.

PS:356 deletes the old hash's floor. A:5-6 says the floor keeps the age "for a phone". Sequence: minor (15) on A moves to B. A is now free. From A: "slop", "Sam 25". New person, adult. The person must hold two numbers, and an unused number has no floor anyway, so the gain is small. The rule "a retry with an older age is refused" no longer holds for A. Copy, do not move.

### J10. Leaving deletes the safety photos. P1, high, trace.

S:1752: "The photos stay for the safety team." `onForget` calls `photos.deleteFor` first (S:760). The text leave path has no ban or hold check, nor has `/api/me/delete`. Sequence: person banned after a report. Text "leave slop.date". Photos and metadata go. `staffPhotos` finds nothing.

### J11. Under-13 in chat skips forget listeners. P1, high, trace.

`statedAge` calls `this.forget` and `forgetMembership` (S:1304-1309), not `hooks.onForget`. So `forgetListeners` (S:763) do not run, and OAuth grants stay. Other apps' photos go only through `ageLowered`. Person and phone rows stay, and PRD F3 says nothing beyond what is needed to decline. A `share` pending and other pending rows stay until they age out.

### J12. Invite reply routes to the wrong app. P2, high, trace.

`member_apps` excludes invited (migration 0007), `service.invite` writes no pending (S:1553-1563), and `route` has no invited step. Sequence: staff invite to peon. Reply "Sam, 29". Route ntwrk (S:980). Join ntwrk, plus the looking-for ask. The peon `invited` row stays. S:1393's branch cannot see it. A reply naming the app works.

Second effect: an ntwrk invitee gets no looking-for ask (S:1457), so they stay on ntwrk alone with no prompt.

### J13. Number change has no caller. P2, high, trace.

`grep` finds `/api/me/phone/*` only in `api.ts` and its tests. The founder correction removed settings pages. SKILLs do not name it. Cloud mode answers 409. `accounts.ts:17` speaks of "a staff change"; none exists. PRD F25 needs steward review when the old number is lost. A new number is a stranger, and joins as a new person. The old membership keeps sending to the old number.

### J14. Leave during a join. P2, high.

`leaveTarget` matches first, `lid` is undefined, so control falls through (S:1085-1094). With a pending join the text reaches `join`, and name becomes "Leave" (probe). Then "29" joins "Leave". An invited person's "stop slop" is the same path: no consent event, and the next reply is the join ask. Extends IN-D16.

### J15. Web under-age refusal keeps the session. P2, high, trace.

API:555 returns `under_age` and revokes nothing. `platform.sessions.e164` holds the number in plain text for up to 30 days. Text refusal keeps only the hash floor.

### J16. A ban covers current numbers only. P2, high, trace, design gap.

`phoneHashesOf` reads `people.phone_hash`, one value (PS:177). `phone_changes.old_hash` exists and is not read. Sequence: a person moves A to B, then is banned. A is free. They still hold A. A joins as a new person. The ban rule at the head of `ban` (S:1729-1733) says "every phone they have now", so this is defensible. It needs a decision.

### Variant of PI-D1: age lost by app switch. P0, high, trace.

"slop". "15". Pending has age 15, no floor (S:1431). "friends". `p.app` differs, so `p` is undefined (S:1401), and `putPending` replaces the row with age null (S:1411). "Sam 25". Adult. The same result comes from STOP (S:1328) and from a pending row aged past a day. The fix for PI-D1 must write the floor at S:1431.

## 7. Checked and found sound

- Person ban and delete everything: a person-scope ban row also holds the phone hash (S:1747), `isBanned` matches any row by hash (PS:174), and `deleteAll` keeps bans. A rejoin is refused. I suspected a hole and found none.
- OAuth with a banned site session: refused at consent by `login` (H:498).
- Tombstone revive sets `lowest_age` from the check's effective value (S:1437), so a revive does not raise it; the floor still holds it.
- Rejoin after leave gets a newer consent event, and `consentAt` uses the turn time, so a late retry cannot beat it unless a newer STOP exists.
- `elizaNotice` and `join` read pending the same way, so the notice decision matches the join decision.
- A minor never gets slop from `enroll` (S:1481).
- Text under-13 stores no person (S:1417-1424).
- Web and text joins share `join:<e164>`, so they run one at a time. The wrong answer inside the lock is IN-D10.
- `/api/me` hides membership on a ban (A:311).

## 8. Failure and concurrency, journey view

| Window | Duplicate delivery | Crash | Two actors | Clock |
|---|---|---|---|---|
| Keyword text | `messageId` replay gives the same response; `onboarding_asked` replay is rechecked (S:2107) | Claim stays `unresolved` for 10 minutes; ordinary texts wait | One turn per sender (I:96) | Pending 1 day |
| Join commit | Refused, `turn_unresolved` | Partial join; the next text restarts; IN-D10 | Web join in the same second: IN-D10 overwrite | |
| Enroll | Same | Some apps joined, pending left; retry refused; a new reply skips `existing` | No join lock (PI-D9) | |
| Web join | Agent told one POST | Hook throw rolls back in part: PI-D10 | Lock | Session rotates at 1 day |
| OAuth consent | Request single use | Consent to code: MO-D15 | | 10-minute request |
| Number change | Code single use | Listeners lost; identities refresh on next inbound | Lock on new number only; a ban on old in the gap is PI-D19 | 15 minutes |
| Leave | Text retry: `lid` gone, falls into join: IN-D9 | Not atomic: PI-D11 | | |
| Notice | Replay no second insert | `onFail` deletes the row; a process crash leaves it, so the notice is lost | One turn per sender | |

The last row is new. `onFail` lives in memory (I:70). If the process dies after S:1191, before the response, the row stays, the collected reply is never returned, and the retry is refused. The notice is lost for good. Severity P2. High, trace.

## 9. Quint modelling notes

Model these as one merged spec, `join_journey.qnt`, P0. Reuse `identity_core.qnt` variables from PI section 5.1 and the turn model from IN.

```
var pending: Phone -> Option[{app, name, age}]
var floor: Phone -> Option[Age]
var person: Phone -> Option[Person]
var lowest: Person -> Option[Age]
var membership: (Person, App) -> MState     // none invited active paused restricted removed
var memberOf: (Person, App) -> Option[MemberId]
var ledger: (Phone, App|ALL) -> {in, out, none}
var fence: (Phone, App|ALL) -> {in, out}
var hold, report, minorSig: MemberId -> bool  // today by member; a fix moves them to Person
var asked: Set[(Phone, App)]                  // history variable
var stated: Phone -> Set[Age]                 // history variable, only true statements
```

Actions: `say(phone, class)`, with class in `hi | keyword(app) | nameAge(a) | ageOnly(a) | chatNumber(n) | stop | start | leave(app) | help`. `webJoin(phone, app, age)`, `invite`, `ban`, `holdMember`, `reportMinor`, `changeNumber`, `deleteAll`. Each commit in a join is its own action, for crash runs.

`chatNumber` is the key abstraction. It is a text that is not a statement. Do not model the regex.

Invariants:

| Name | Statement | Today |
|---|---|---|
| `OptInAsked` | `ledger(p,a)=in` from a join implies `(p,a)` in `asked` | Fails, J1 |
| `FloorIsStatement` | `floor(p)` is in `stated(p)` | Fails, J2 |
| `LowestWins` | `lowest` <= each stated age | Fails, PI-D1 and its variant |
| `HoldFollowsPerson` | A held person's every member is out of matching | Fails, J3 |
| `MinorSignalFollowsPerson` | Same for minor signals | Fails, J3 |
| `FenceNotStricter` | `ledger=in` implies `fence=in` after the turn ends | Fails, J4 |
| `ResumeReachable` | From any paused membership, some text-only path reaches active without leaving another app | Fails, J5 (use a temporal or a reachability check) |
| `BanCovers` | Banned phone: no membership created, by any action | Holds |
| `NoMinorMatch` | Adult-matchable implies no minor age in `stated` | Fails through J3 only by signal, and J9 by number |
| `NoticeOnce` | At most one notice per number | Holds. Model the lost-notice run as a liveness note |

Liveness: every non-member message gets an answer or a named silent state; `eliza-nonmember-loop` must exit by day reset.

Bounds: 2 phones, 2 persons, 3 apps (ntwrk invite, slop open, friends open), ages {9, 15, 29}, 8-12 steps. Treat time as discrete marks for the day TTL and the three-ask cap.

Model `signup-channel-mode` as a table test, not a state machine. It has no dynamics. Model `agent-profile-handoff` as one boolean on the member, `profileInNetwork`, with the invariant "saved claim implies profileInNetwork". J6 fails it.

Priority order: J1 and J3 with the shared carryover model first, then J2 and J4, then J5.

## 10. Coverage limits

- Upstream gateway and Cloud code were not available.
- I read in full: `accounts.ts`, `api.ts`, `pg-store.ts`, `inbox.ts`, `tools.ts`, `hooks.ts`, `age.ts`, `apps.ts`, `consent.ts`, `phone.ts`, `otp.ts`, `sessions.ts`, `cloud-channel.ts`, `cloud-delegation.ts`, `policy.ts`.
- I read the join, inbound, consent, staff and turn ranges of `service.ts`, and targeted ranges of `network.ts`, `runtime.ts`, `handler.ts`, `channel.ts` and `store.ts`. Those files are not read in full here. The per-package reports cover the rest.
- Nothing in this report ran against Postgres. J1 and the 5.1 table are probed at the parser only.
