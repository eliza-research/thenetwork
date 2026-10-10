# A2P 10DLC registration for The Network (Twilio)

Superseded as a launch gate (2026-10-08): registration is in the deferred compliance backlog (PRD 40.7), and the pilot runs on one Blooio iMessage line (PRD 40.3). Kept as reference for when SMS sending starts.

US carriers require every application-to-person SMS sent from a 10-digit long code to be registered: one **brand** (the company) and one **campaign** (what we send and how people opt in). Unregistered traffic is filtered or blocked. Approval typically takes 1-3 weeks; launch gate PRD 28.5 requires it before the first live SMS sends (Section 37 marks the old M6 milestone superseded; iMessage on Blooio is P2P and not covered).

Prerequisite done in this repo: [`sites/ntwrk.party`](../../sites/ntwrk.party/) is a site describing the program, with a privacy policy and SMS terms. Carriers check these URLs during vetting, so it must be **live before submitting the campaign**.

## Brand (Twilio Console → Messaging → Regulatory Compliance → A2P 10DLC)

The founders fill these in; they must match IRS records exactly.

| Field | Value |
|---|---|
| Legal company name | Eliza Research Corporation (must match the EIN letter exactly) |
| EIN | entered by the founders in the console |
| Company type | Private for-profit (or as applicable) |
| Website | https://ntwrk.party |
| Vertical | Technology |
| Authorized contact | founder name, email, phone |
| Brand type | Standard (secondary vetting recommended for higher throughput) |

## Campaign

| Field | Value |
|---|---|
| Use case | **Low Volume Mixed** (under 2,000 segments a day; fits a 150-300 member pilot per city). Move to Standard **Mixed** if volume grows. Sub-use cases: Customer Care, Account Notification. |
| Campaign description | The Network is an invite-only service that introduces members to people, small groups and events in San Francisco and New York. Members text with The Network's conversational agent, which replies to their requests, proposes introductions and plans they opted into, relays messages between members who both agreed to an introduction, schedules meetups, and sends reminders and follow-ups. Recipients are members who accepted an invitation and opted in to texts. |
| Message flow / call to action | Members join only by invitation. An existing member or our team sends an invite link. On the invitation page, and in the first text, the member sees: "By joining, you agree to receive text messages from The Network about introductions, plans and reminders. Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out, HELP for help. Terms: ntwrk.party/terms, Privacy: ntwrk.party/privacy." The member opts in by accepting the invitation, or by replying to the first message. The opt-in wording and timestamp are recorded in our consent ledger. Program details: https://ntwrk.party/#sms |
| Opt-in keywords | START, UNSTOP, SUBSCRIBE, RESUME |
| Opt-in message | You're back on The Network. Reply STOP anytime to opt out, HELP for help. |
| Opt-out keywords | STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, REVOKE, OPTOUT |
| Opt-out message | You're unsubscribed from The Network and won't get more messages here. Reply START to resume. |
| Help keywords | HELP, INFO |
| Help message | The Network: invite-only messages about people, plans, and events you asked for. Message frequency varies. Reply STOP to opt out. Help: help@ntwrk.party |
| Embedded links | Yes (event pages, the member's own settings page) |
| Embedded phone numbers | No (contact swaps happen only after both members agree, as relay text) |
| Age-gated content | No |
| Direct lending / affiliate marketing | No |

### Sample messages (2-5 required)

1. "Hi Maya, it's The Network. Sam (product designer, also into bouldering) is free Thursday evening near Mission Cliffs. Want an intro? Reply YES or NO. Reply STOP to opt out."
2. "You're set: coffee with Sam at Ritual Coffee, Thu 6:30pm. I'll check in that morning. Reply STOP to opt out."
3. "Sam says: 'Running 10 min late, saving you a seat!' (via The Network)"
4. "How did it go with Sam? Reply 1-5, or tell me in your own words."
5. "Done: your Network intros are paused until Oct 20."

## Code alignment

The keyword sets and replies above match `packages/blooio/src/ledger.ts`, the Eliza Cloud gateway STOP/HELP/START handling on branch `spike/network-plugin`, and the sample confirmations produced by `packages/plugin-network`. When registration is approved:
- set the HELP support contact (`defaultCopy(supportContact)`) to `help@ntwrk.party`;
- attach the Twilio number to a Messaging Service tied to the campaign.

## Notes

- **iMessage traffic** through Blooio isn't carrier SMS; Blooio's SMS fallback and any Twilio SMS do need this registration.
- **Fees** (Twilio, as of 2026; check the console): a one-time brand registration fee, campaign vetting, then a monthly campaign fee, plus per-message carrier surcharges. The founders confirm the charges at submission.
