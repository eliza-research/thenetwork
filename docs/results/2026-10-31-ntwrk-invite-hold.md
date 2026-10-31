# The invite-only ntwrk app: a no-keyword stranger gets nothing proactive from it (mvp-gaps "ntwrk")

Date: 2026-10-31. Hand-written by the contributor. No model output is in this report. The
reproduction is deterministic: the pipeline world runs on a pinned `SimClock` and seed, and
`bun run sim` never calls a model (it clears the provider keys before it starts).

## The problem

The shared line's no-keyword join (founder decision 2) makes the person a member of the invite-only
ntwrk app, so that the welcome, the "what are you looking for?" ask and the app enrollments run on
the ntwrk runtime. Nothing held that member out of matching. The binding plan says the opposite
(`docs/mvp-gaps.md` section 4.1, the "ntwrk" row): "a stranger texts with no keyword, is enrolled
in slop by 'dating', and gets nothing proactive from ntwk while it stays invite-only."

## The reproduction (before, on a0ed7bc)

Steps (every step through the real signed webhook, the platform queue and the staff API):

1. Staff invite the phone `+12125550122` ("wes"). He joins with "Wes, 31", answers the three
   onboarding questions, then asks: "Anyone around who'd want to find a regular climbing partner?
   I'm near Greenpoint."
2. The stranger `+12125550121` ("zoe") texts "hi there" (no keyword), joins with "Zoe, 27", answers
   "dating" to the looking-for ask, is enrolled in slop, and answers the three onboarding questions.
   She never asks for anything.
3. ntwrk matching goes on. The next day the request retries and finds one candidate: the stranger.
   The reviewer approves the intro (`nw-1-2`). The requester confirms ("Sure, please check").

Result on the base revision: the stranger receives, proactive, from the ntwrk network:
"Someone nearby wants to find a regular climbing partner. Would you be up for it? I could do
[Saturday 10am or Sunday ...]" — row `ntwrk_4f7e97a7-e42f-443c-98f6-86bd06f3bf63:11` in
`platform.outbound`, kind `proactive`, tied to opportunity `nw-1-2`.

```text
FAIL: 15/16 blocking gates (pipeline)
  FAIL [pipeline] pipeline: the invite-only ntwrk app: a no-keyword stranger is enrolled in slop
  and gets nothing proactive from ntwrk (mvp-gaps 4.1): expected ["ntwrk_4f7e97a7-e42f-443c-98f6-86bd06f3bf63:11"] to equal []
```

## The cause

The join path (the founder-decision-2 bypass of the invite-only refusal, `service.ts`) created a
full ntwrk member. The matching path — request candidate search (`searchFor`), the proposal gate
(`gateReason`) and proposal acceptance (`fromProposal`) — had no notion of "joined without an
invitation": for matching, the stranger was indistinguishable from an invited member.

## The fix

`Preferences.inviteHold` (core, platform prefs): the service sets it on the member prefs row when
the invite-only ntwrk app was joined on the shared line with no invitation — founder decision 2's
own condition, `route.shared && app.id === "ntwrk" && !invited`. No other join path writes it. The
conversation, the looking-for ask and the app enrollments continue unchanged. The ConsentNetwork
maps the flag onto member state and enforces it in three places:

- request candidate search skips the member: they are never the answer to another member's ask;
- the proposal gate returns `invite_hold`: the engine never offers them, in any role;
- proposal acceptance (engine and player proposals) skips them the same way.

Their own asks stay open: the request is recorded, acknowledged, and when nobody eligible can
answer it, it ends with the honest "none found" reply. The staff invite path (`account.ts`)
refuses to invite a number that is already a member, so a held member is reached only by leaving
and joining again through an invitation.

## The evidence

| Metric | Before | After | Command and seeds |
|---|---|---|---|
| New pipeline gate (no proactive row, no opportunity-tied row to the stranger, on ntwrk) | FAIL (1 row, id above) | PASS (0 rows) | `bun run sim --only pipeline` (pinned world, deterministic) |
| Pipeline block | 15/16 blocking gates | 16/16 blocking gates | same command |
| The ask's lifecycle | Fulfilled through the stranger; the probe was delivered to her | Recorded and acknowledged with "couldn't find someone for a regular climbing partner this time"; never fulfilled | same command |
| Stranger's memberships | ntwrk active, slop active | ntwrk active, slop active (unchanged) | same command |

Model evidence: none and none needed. The pipeline sim clears the LLM keys and never calls a model;
every number above is from the deterministic run. Agent clients were not driven: the change sits in
the matching/gating path of the service, which the pipeline world exercises end to end (signed
webhook in, platform queue out, staff review between); no new member-facing text or agent workflow
exists in the diff.

## Validation

Same machine, Bun 1.4.4, PostgreSQL 16, dev cluster on :54339. Summary lines are pasted in the pull
request. `bun run sim` (full), `bun run typecheck`, `bun run test:integration` (includes the
security suite) and `bun run test:e2e` were run on the fixed tree; `bun run sim --only pipeline`
was run before the fix (failing) and after (passing), same command and world.

## Limits

- The flag is on the member prefs row, which the service controls; a future staff action that
  turns it off is the natural "lift the hold" surface, but no such action is in the MVP plan, so
  none is built.
- Growth invite asks and plans probes to a held member cannot occur through the matching path the
  fix closes; a growth ask to a held member would still need its own rule if the founders want one.
- Because the platform refuses to invite an existing member, a held member keeps the hold until
  they leave ntwrk and return through an invitation.
