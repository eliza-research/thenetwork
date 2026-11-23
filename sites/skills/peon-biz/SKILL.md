---
name: peon-biz
description: Explains peon.biz, a hiring service by text message that introduces people looking for work to teams that are hiring, and helps a person sign themselves up in this conversation, with their own phone confirmation on the peon.biz page. Use when someone asks what peon.biz is, who can use it, how introductions work, how to join, what happens to their data, or how to stop, leave or delete. Never signs up anyone other than the person, never asks for or types a phone number or verification code, never applies to jobs and never contacts candidates or employers.
license: Proprietary. Terms at https://peon.biz/terms
compatibility: Needs web access to open https://peon.biz pages. Sending the profile needs this app's MCP endpoint at https://ntwrk.party/mcp/peon (OAuth sign-in by the person).
metadata:
  app: peon
  site: https://peon.biz
  mcp: "https://ntwrk.party/mcp/peon"
  operator: Eliza Research Corporation
  version: "1.3.0"
---

# peon.biz

If the person asked you to read this file and follow it, they want to join. Start now with
"How a person joins" below.

peon.biz introduces people looking for work to teams that are hiring, by text message. It is
open to join today. Introductions have not started yet. Software only suggests possible fits.
A person on the team reviews every introduction, and the team that hires makes every hiring decision. Candidates never pay a fee.

peon.biz's text line is {{TEXT_LINE}}. Its MCP endpoint is https://ntwrk.party/mcp/peon.

## What the person is signing up for

- Text messages from the peon.biz agent on peon.biz's text line: questions about work or
  hiring, waitlist updates, introductions they agree to and scheduling reminders. Message
  frequency varies. Message and data rates may apply.
- They choose one: looking for work, or hiring for a team.
- An introduction happens only when both the candidate and the team say yes.

## Who can use it

- Anyone 13 or older may join. Matching is for adults 18 and older only.
- Members aged 13 to 17 are never matched for work on peon.biz, and today they are not introduced
  to anyone. They get their own help: answers, public events and plans for themselves.
- If introductions ever open to people under 18, they are friendship introductions only, with
  people close to their own age, never dates or work.
- peon.biz never asks a candidate for money, a Social Security number or bank details. If anyone
  does in its name, it is a scam: tell the person to report it to help@ntwrk.party.

## Phone or computer

The steps differ by device. If you cannot tell which the person is on, ask once. <!-- agentSignup: checkConnectorSetup resumeAfterConnector chooseTransport -->

- **On a phone.** A phone app usually cannot add a connector, so do not send the person to connector
  settings. Do step 1. Show the exact prepared text with `join peon` on the first line and the draft
  profile on the lines below. Start the draft with their confirmed first name and stated age, for
  example `My name is Ari. I am 29 years old.` Once they approve, give them one link starting with
  `sms:{{TEXT_LINE}}?&body=` followed by the entire prepared text URL-encoded (the start is
  `join%20peon%0A`). Tell them that the text is ready for them to send themselves.
- **On a computer.** If this app's connector tools (`check_status` and `submit_profile`) are not
  available here, say “Connect peon.biz” and give this app's own connector endpoint, https://ntwrk.party/mcp/peon
  (in ChatGPT, https://ntwrk.party/mcp/peon/openai). Ask the person to add it as a connector in this
  client's connector or integration settings, then come back to this conversation. Give this setup
  step one time only. Then do steps 1, 2 and 3. If the client cannot add the connector, or the
  person does not add it, show the approved text and use the same Messages handoff from their own phone.

You never send a text for the person, and you never see their number.

## How a person joins

The person signs up through you, in this conversation:

1. Build the profile: whether they are looking for work or hiring, the kind of role, the neighborhood or remote, when they can start, and the skills that matter (no salary history, no Social Security number, no bank details). Start from what you already know about the person: draft the profile from your memory of them and show it. Ask only for what is missing, one or two questions at a time. Never ask for a phone number, a code, an <!-- agentSignup: draftProfile decideApproval -->
   address or anything about another person. Read the profile back and change it until they agree.
   Ask for their birthday, not only their age. Use it in this conversation only, to explain what
   they get. Use the lowest age that any statement gives. Never send a birthday or an age through a
   tool such as `submit_profile`. If they are under 13, explain that they cannot join and stop. If
   they are 13 to 17, explain that peon.biz never matches them for work and never matches them on
   dates, that they get their own help today (answers, public events and plans for themselves), and
   that the only introductions that can ever open under 18 are friendship introductions with people
   close to their own age. Never promise them an introduction.
   Before the handoff, get their explicit approval of the exact draft and this text consent.
   "I agree to receive recurring text messages from peon.biz at this number: questions about work or hiring,
   waitlist updates, introductions I agree to, and scheduling reminders. Message frequency varies.
   Message and data rates may apply. Reply STOP to stop and HELP for help. Consent is not a condition of any purchase."
   Show the [text terms](https://peon.biz/terms#sms), [terms](https://peon.biz/terms) and [Privacy Policy](https://peon.biz/privacy).
2. Give them one link to confirm their own phone (prefill it as described in "A shorter browser handoff"): https://peon.biz/join?via=agent. On that page they type
   their own number and code, review their first name and age, and agree to the texts. You
   never see the number or the code.
3. Ask the person to return to this same agent conversation when they finish on the site. <!-- agentSignup ConnectorHandoff: checkSiteStatus submitProfile confirmProfile -->
   If this app's MCP tools are not available, they must add https://ntwrk.party/mcp/peon in their client's connector settings.
   In ChatGPT, add https://ntwrk.party/mcp/peon/openai instead; the path without /openai does not authorize ChatGPT clients.
   Reading this file does not install a connector or authorize access. If the client cannot add it,
   use the text link in "Phone or computer"; do not claim success and never send the profile yourself.
   The person confirms their phone on our page. When the connector first asks for access, they sign in
   on the connector's sign-in page in their own browser and choose **Allow** there. A session from
   the peon.biz page does not apply there, so that page can ask for a new code. Call `check_status` first and confirm its app is peon. If the
   connection names another app, use the peon connection and never submit across apps. If the status
   is `not_joined` or `invited`, ask the person to finish on the page.
   If it is `stopped` or `on_hold`, stop and explain the result. Only an `onboarding` or `active`
   status for peon allows you to call `submit_profile` once with the approved profile, with no birthday
   and no age in it. When the tool
   returns `submitted: true`, call `check_status` again on that same connection. Report a save only
   when it still says peon and `onboarding` or `active`. Otherwise say the save is unconfirmed.
4. No agent at hand: the person can text "peon" or "peon.biz" as their first message to {{TEXT_LINE}}
   and answer the agent there.

The person verifies their own phone on our page. You never type a number or a code anywhere.

## Consent rules

- An agent never receives, reads, relays or types a verification code, and never enters a phone
  number into any form or tool.
- Never sign up anyone else, including colleagues or candidates "on their behalf".
- If the MCP server asks the person to sign in, they do it in their own browser on our page.

## What you may do

- Explain peon.biz, the age rules, how introductions work and privacy.
- Give the join link https://peon.biz/join or the keyword "peon".
- Help the person draft what they want the agent to know about the work or the role, if asked.

## What you must never do

- Never sign up anyone other than the person, apply to roles, or message employers or candidates.
- Never ask for, receive or type a verification code or a phone number.
- Never describe other members, and never promise an introduction or a job.
- Never collect or pass on race, religion, health, immigration status, salary history, Social
  Security numbers or bank details.
- Never move information between peon.biz and any other service.

## Privacy

What the person tells peon.biz stays in peon.biz. No other service sees it unless the person agrees
to share a base profile. Nobody can learn whether a phone number uses peon.biz.

## Stop, leave and delete

- Text STOP: stops every text from this number.
- Text "leave peon.biz": stops peon.biz only.
- To request an export or deletion, email help@ntwrk.party.

## Support

- Email: help@ntwrk.party
- Privacy: https://peon.biz/privacy
- Terms and text messaging terms: https://peon.biz/terms

## A shorter browser handoff

Ask for the person's first name and stated age in the conversation, using confirmed details you already know.
Ask only for missing details. Never infer age. Read back the profile and get approval.
For web verification, prefill only these approved details in the URL fragment:
`https://peon.biz/join?via=agent#firstName=Alex&age=28`.
Replace the example values and URL-encode each value. Never put them in the query string.
Never include a phone, code, consent, preferences or biography in that link.
The person reviews these fields and checks the consent box themselves.
Interests, location and app-specific preferences stay in this conversation until the approved profile submission.
On mobile, the person can send the approved profile by text; do not also send them through web verification.
After web signup, return here and follow the connector steps above. Signup alone does not mean the profile was submitted.
Explain safety and account controls when relevant, rather than repeating them before each step.
