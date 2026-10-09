# Runbook: safety escalation

This runbook is for the person on safety duty. It covers what the system does by itself, what you must do, and how fast. It applies to every app on the shared line: The Network, slop.date, peon.biz and friends.help.

PRD sources: 17.4 (safety architecture), 32.14 (safety classifier, cases, holds), 36.3 (trust and safety operations), 28.5 (launch gate: this runbook is rehearsed), 40.3 (holds follow the person), F23 (block, report, safety) and F24 (delete, with safety retention). Code: `packages/network/src/safety.ts`, `reports.ts`, `trust.ts`, `network.ts` (handleBlock, fileReport, onDistress), `packages/network/service/service.ts` (safety, hold, ban, clearPersonHold) and migration `0019_person_safety.sql`.

**Never** text a member from a personal phone. Never share one member's details with another. Never write a member's words into a ticket or chat: use the case id and the member id.

## 1. Response targets

| Kind | Target | Who |
|---|---|---|
| Urgent: danger now, harassment, unsafe date, scam, a minor | First human action within **1 hour** | On-call safety person |
| Everything else (lying, a no-show the member calls unsafe, "other") | Within **24 hours** | Safety queue |
| Outside covered hours | The automated reply and the automatic hold stand until the next shift starts. Urgent items are first in the morning. | Next on-call |

Covered hours for the pilot: [FOUNDER: hours and days]. The alert for urgent items is the `safety_alert` event (37.1 item 11, monitoring): [FOUNDER: where it pages, for example a phone number or a channel].

## 2. What the system does by itself

The member never waits for a person to get the emergency line. These happen in code, at once:

| Trigger | Member hears | System does |
|---|---|---|
| Danger in any message ("he followed me home", "I don't feel safe") | "If you are in danger, call 911 now..." and that a person will follow up | Opens an urgent case on the member (kind `distress`), logs `safety_alert`, keeps the member's messages as evidence. Nothing else in the message is handled. |
| Harm told about someone ("he kept texting me after I said no", "she asked me for money") | A short supportive reply and how to block or report | A case on the member (kind `distress`, not urgent), evidence kept. |
| "block X" | "Done..." only when the block was applied | Block between the two people on every app. A booked plan between them is called off; the other person hears only that it is off. |
| "report X" about someone they met, urgent kind (harassment, unsafe, scam, minor) | 911 first, then that the person is paused and staff will follow up | Report, block, urgent case, **automatic hold** on the subject on every app (`platform.person_safety`, reason `urgent_report`), evidence kept for both. |
| "report X" about someone they met, other kinds | Thanks, blocked, staff will look | Report, block, case, evidence kept. No hold. |
| "report X" about someone they never met (or nobody) | The same neutral reply either way | A case on the named member if the name is a member's. Never a hold: a stranger's report cannot take anyone out (audit network-consent-7). |
| "block him" or a first name two of their matches share | "Who do you mean: ...?" with first names of people they were introduced to | Nothing is applied until they answer. A day later the question lapses. |
| A date check-in answer (slop): rude, lying, unsafe | Same as "report X" | Same as "report X" (source `check_in`). |
| A date check-in answer: "they didn't show" | An apology and an offer to look again | No safety report. The no-show counts against the other person only if they confirm it or stay silent (one forgiven in 90 days, then trust points). |
| A member's own scam or hostile messages, or a sign they are under 18 | The usual abuse reply | A `safety:*` cue on the member (scam_pattern, hostile_language, age_signal). slop sends them to safety review instead of matching; friends holds them. |

Report kinds and their words are in `packages/network/src/reports.ts` (reportKindOf). A report keeps ids and a kind, never the member's words.

## 3. Holds

A hold means: never matched, never probed, never put in a plan, never contacted except for replies and safety notices. Open items with the person are closed or replaced.

| Hold | Where it lives | Set by | Cleared by |
|---|---|---|---|
| Automatic hold (urgent report) | Each app's report (status `open`) and `platform.person_safety` | The system | Staff: dismiss the report (`POST /safety/dismiss`) on the app it came from, **and** clear the person (`POST /safety/clear-person`) |
| Staff hold | Trust level `hold` on each app, and `platform.person_safety` (reason `staff_hold`) when held by safety@* | `POST /safety/hold` | `POST /safety/lift` on each app, then `POST /safety/clear-person` |
| Minor report | `platform.person_safety` (reason `minor_report`), the person's age | The system | See section 4 |
| Ban | `platform.bans` | `POST /safety/ban` (safety@* only) | Not in the product. See section 6. |

A person-level hold follows the person and their phone number. Leaving an app, deleting everything, or joining again with the same number does not end it. Other apps never learn why; they see only that the account is restricted.

Every hold, lift, clear and ban is written to the staff audit log before it runs.

## 4. The minor path

When a member reports that someone is under 18 ("report Ben, he's only 16"), or the check-in says so:

1. The system, at once: the person's lowest age becomes 17 on every app (pending review). Every photo and every rating of their looks is deleted on every app. Every membership is out of matching. The case is kind `minor`, urgent. Adults the person met are listed in the case (`minor_after_contact`), and each adult gets a case event (`contact_with_minor`).
2. You, within 1 hour: open the case. Check who the person met through the Network and whether anything is still open with them. Check the reporter's and the person's messages (evidence is kept).
3. If the person is under 18: leave the age as it is. They keep single-player use only (13-17 may join but are never matched). If under 13: every membership must go (under 13 cannot use any app). There is no staff action for this yet; an admin runs the delete-everything path for the number [FOUNDER: who]. Consider whether any adult they met needs a hold or a ban.
4. If the report was wrong (for example a joke, or a typo): clear the person (`POST /safety/clear-person`). This puts back the age they had before the report (stored as `prior_age`). Then on each app run `clearMinorSignal` for the member (the minor flag on a member is sticky until staff clear it), and dismiss the report. Photos that were deleted are not restored: tell the member they can upload again.

## 5. Evidence

A report or a case keeps the messages, feedback and events of both people for **180 days** (`EVIDENCE_RETENTION_DAYS` in `packages/network/src/safety.ts`, a proposed default for the founder and counsel to confirm with the privacy policy), even if they delete their data. The rows are in `network.evidence_holds`.

- What is kept is staff-only. The member's row is emptied and marked removed, so no member-facing page or export shows it.
- A reporter's feedback about someone else is never deleted while it is evidence.
- After 180 days the purge (every tick, `NetworkService.purge`) deletes what was kept for members who left, and the expired holds.
- An under-13 decline keeps nothing of the child's own data. The adults' cases stay.
- A police or legal request: do not export anything yourself. Escalate to [FOUNDER: legal contact].

## 6. Bans and appeals

- A ban is by phone or by person (PRD 40.5). Only safety@* or admin@* can ban. The number can never join any app again, every membership is restricted, and every assistant connection (OAuth grant) of the person's phones is revoked at once.
- An under-13 decline also revokes the assistant connections of that app.
- Appeals are manual for now. A member who writes in to appeal gets a person, not the bot. Record the appeal in the case note. Two people decide, and neither is the one who banned. There is no unban in the product: an unban is a database change by an admin, written in the audit log with the reason. [FOUNDER: who decides appeals.]

## 7. Escalation contacts

| Situation | Contact |
|---|---|
| Danger now, the member is unreachable after a 911 message | [FOUNDER: on-call lead phone] |
| A minor in contact with adults | [FOUNDER: safety lead] and [FOUNDER: legal contact] |
| Threats against staff or the company | [FOUNDER] |
| Police or legal request | [FOUNDER: legal contact] |
| Press | [FOUNDER] |
| The shared line flagged or banned by the carrier or Blooio | [FOUNDER: messaging owner] |

## 8. Rehearsal checklist

Run this before launch (28.5) and after any change to the safety code, on staging with test phones (555-01xx numbers) and the dry-run adapter. Never on the live line.

1. [ ] Text "I'm scared, he followed me home" from a test member. The reply starts with "If you are in danger, call 911". An urgent case and a `safety_alert` event appear.
2. [ ] Book a test date between two test members. From one, text "report <name>, he grabbed me". The reply starts with 911. The other member is held on every app they use (`platform.person_safety`), and their open probes stop.
3. [ ] From the same member, text "block him" with two past dates. The reply asks "Who do you mean" with both first names. Answer with one name; only that block is applied.
4. [ ] Text "block Nobody". The reply does not say "Done".
5. [ ] Report a test member as "only 16". Their age reads 17, their photos are gone, and they are out of matching on a second app.
6. [ ] The held member deletes everything and joins again with the same number. They are still held.
7. [ ] Clear the hold with `POST /safety/clear-person` and dismiss the report. They can be matched again.
8. [ ] Ban a test member who has an assistant connected. The connection stops working.
9. [ ] Check the response timer: the alert reached the on-call person, and someone acted within the hour.
10. [ ] Write down what was slow or unclear, and fix this runbook.

Last rehearsed: [FOUNDER: date, who].
