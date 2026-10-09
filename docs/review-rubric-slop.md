# slop.date review rubric

Status: 2026-10-08. For reviewers of slop.date in the admin console (the Observatory). Written by a Claude agent from the PRD (32.8, 34.6, 35, 37.3, 40.3, 40.5, F27), `packages/observatory/src/apps.ts` (APP_REASONS.slop) and the review code. Read it before your first shift.

Every slop introduction waits for a person before anyone is contacted. You decide whether the anonymous probe goes out. You see the people, the probe text each one will get and the reveal text they get if both say yes. You never see a score.

## 1. What a card shows

- The two members, their area, and badges: Under 18, Hold, Watch, busy.
- **probe**: the exact text each person gets first. It is anonymous: an activity, an age band, a distance band, at most one fact the other person allowed us to share. Time options are added when it goes out.
- **reveal**: what each person gets after both say yes. The place and the time are filled in then.
- **told**: the reason the Network gives each person.
- History between the two, and alternates.
- No score, no score components, no ratings. slop folds appearance into the engine score, so the console never shows it (`SCORELESS_APPS` in `src/shape.ts`).

Badges in the header:

- **SHADOW**: a shadow item. Matching is off. Your approve or reject is a label. Nobody is contacted.
- **SECOND REVIEW**: a blind second review. Someone else already decided this item. Decide it as if you were first. Your decision is stored and changes nothing.

## 2. When to approve

Approve when all of these hold:

1. Both are adults. No badge says Under 18, and nothing in what you see suggests a minor (section 5).
2. Each person's stated filters hold both ways: who they want to meet, the age range, the distance.
3. The probe is true, short and kind. It names no one, gives no contact details, and says nothing about looks.
4. There is a plain reason this could be a good first date: a shared interest, the same kind of date, close enough to meet.
5. Neither person is on hold or watch, or busy with another introduction.
6. Nothing in their history says they should not meet again (a decline, a report, a block).

If one of these fails, reject with the matching reason. If you are unsure, reject with "Other" and say why in the note. A missed introduction costs little; a bad one costs trust.

## 3. Reason codes (APP_REASONS.slop)

Pick one reason for every reject. Keys 1-8 in the queue, in this order.

| Key | Code | Use it when | Example |
|---|---|---|---|
| 1 | `weak_reason` | Nothing in what we know makes this a good date. | Two people whose only shared fact is "lives in Manhattan". |
| 2 | `preference_mismatch` | A stated filter fails, or the two want different things. | She wants 30-40; he is 27. One wants something long-term, the other said casual only. |
| 3 | `safety_concern` | Anything that makes a meeting unsafe or a member at risk. | A member with an open report, a scam signal, a minor signal, a pattern of no-shows after dark. |
| 4 | `privacy_risk` | A text would reveal something private, or the two may already know each other. | The probe mentions an employer; the two share a small workplace. |
| 5 | `wrong_timing` | One of them should not hear from us now. | One just had a date through us yesterday; one is away this week. |
| 6 | `tone` | The probe or the reason reads wrong for a dating intro. | Pushy, sexual, too long, or reads like an ad. Edit it instead when one small change fixes it. |
| 7 | `duplicate` | The same pair is already in review or was introduced recently. | The same two people in a second card. |
| 8 | `other` | None of the above. A note is required. | "Both said they are in recovery; a bar is a bad first venue." |

`preference_mismatch` and `safety_concern` reach the Network as `weak_reason` and `safety` with the app code at the start of the note, so the training label keeps it.

## 4. What you must never see or write

- **Ratings and scores.** Never ask for them, never write them, never guess them. The console strips them for slop.
- **Appearance.** Never write about looks in a probe, a reason or a note: no "attractive", "cute", "good-looking", body types, "out of your league", photo ratings or percentiles. An edit with such words is refused (`appearance_leak`).
- **Names and contact details in a probe.** The probe is anonymous until both say yes. Phone numbers, emails, handles, employers and exact addresses are refused by the leak guard (`edit_leak`).
- **What members wrote.** Their messages stay hidden unless a safety reviewer opens a member with a reason. Do not paste them into notes.
- **Other apps.** slop membership is private (PRD 40.3). Do not mention a member's other apps in a note or a text.

## 5. Minors and age liars

Members aged 13-17 can join slop but are never matched. The Network keeps anyone with a minor signal out of the engine, and approve is refused for a known minor (`participant_minor`). You are the last check.

Reject with `safety_concern` and add a note when you see any of these:

- A stated age that does not fit other facts: school words ("my teacher", "homework", "prom", "after class"), a graduation year in the future, "my mom won't let me".
- A member reported as under 18 by another member (the case shows `minor_reported`, urgent).
- A member whose age changed in chat, or who gave two different ages.

Then tell safety (the Safety tab). Do not contact the member. Never approve an item while you suspect a minor, even with an edit.

## 6. Photo checks in the probe

The probe may carry one photo when the photo-probe flag is on (PRD 40.5, prototype P5). When it is on, check before you approve:

- The photo shows one adult, the member, clearly. No children, no other people as the main subject.
- No nudity, no sexual pose, no weapons, no drugs.
- No phone number, handle, QR code, license plate, school logo or workplace badge in the picture.
- It does not look like a stock photo or a celebrity (catfish).

If one fails, reject with `safety_concern` (or `privacy_risk` for contact details in the picture) and tell safety. Photos are never rated by you; the rater's output is never shown.

## 7. The 6-hour SLA

slop items expire 6 hours after they are queued (REVIEW_SLA_HOURS in `packages/platform/src/apps.ts`; the Network and the console use the same number). An expired item is never sent late. Work the queue oldest first; the countdown is on each card. If the queue grows faster than you can work it, tell the on-call admin instead of rushing.

## 8. Shadow labelling

Before matching goes on, the engine runs daily in shadow mode: its proposals wait in your queue with a SHADOW badge. Nobody is contacted, whatever you press.

- Label each one as if it were real: **Good match** (approve) or reject with the reason you would use.
- Label every day. Turning matching on needs 14 days, each with at least one label, and 40 committed adults (the launch gate, PRD 37.3). An admin can override the gate only with a typed reason, which is logged.
- Shadow precision (approved over labelled, last 14 days) shows in the scorecard. It is the baseline the pilot is measured against, so do not approve to make it look good.
- Unlabelled shadow items expire after 6 hours like any other item. That does not count as a missed SLA.

## 9. Second reviews

About 1 in 10 decided items comes back to another reviewer as a SECOND REVIEW card. You do not see the first decision. Decide it on its own. The first reviewer cannot take their own item (`same_reviewer`). Reviewer agreement (second decisions that match the first) shows in the scorecard; the target is 80% or more. Disagreements are discussed in the weekly review meeting, not on the card.

## 10. Composing an introduction

A reviewer can compose an introduction (Compose in the Review tab): two member ids, what it is for, and the reason each is told. The Network runs the same checks as for any proposal (minors, holds, blocks, busy, caps, quiet hours) and refuses with a code if one fails. A composed item waits in the queue like any other; another reviewer should approve it.
