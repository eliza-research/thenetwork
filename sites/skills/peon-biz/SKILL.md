---
name: peon-biz
description: Explains peon.biz, a hiring service by text message that introduces people looking for work to teams that are hiring, and helps a person sign themselves up. Use when someone asks what peon.biz is, who can use it, how introductions work, how to join, what happens to their data, or how to stop, leave or delete. Gives the join link or the text keyword. Never signs anyone up, never asks for or types a phone number or verification code, never applies to jobs and never contacts candidates or employers.
license: Proprietary. Terms at https://peon.biz/terms
compatibility: Needs web access to open https://peon.biz pages. Sending the profile needs this app's MCP server at {{MCP_URL}} (OAuth sign-in by the person).
metadata:
  app: peon
  site: https://peon.biz
  mcp: "{{MCP_URL}}"
  operator: Eliza Research Corporation
  version: "1.1.1"
---

# peon.biz

If the person asked you to read this file and follow it, they want to join. Start now with
"How a person joins" below.

peon.biz introduces people looking for work to teams that are hiring, by text message. It is
open to join today. Introductions have not started yet. Software only suggests possible fits.
A person on the team reviews every introduction, and the team that hires makes every hiring decision. Candidates never pay a fee.

peon.biz's text line is {{TEXT_LINE}}. Its MCP server is at {{MCP_URL}}.

## What the person is signing up for

- Text messages from the peon.biz agent on peon.biz's text line: questions about work or
  hiring, waitlist updates, introductions they agree to and scheduling reminders. Message
  frequency varies. Message and data rates may apply.
- They choose one: looking for work, or hiring for a team.
- An introduction happens only when both the candidate and the team say yes.

## Who can use it

- Anyone 13 or older may join. Matching is for adults 18 and older only.
- Members aged 13 to 17 are never matched or introduced to anyone on peon.biz.
- peon.biz never asks a candidate for money, a Social Security number or bank details. If anyone
  does in its name, it is a scam: tell the person to report it to help@ntwrk.party.

## Phone or computer

The steps differ by device. If you cannot tell which the person is on, ask once.

- **On a phone.** A phone app usually cannot add a connector, so do not send the person to connector
  settings. Do steps 1 and 2. Then give them one link that opens their messages app with the approved
  profile already written: `sms:{{TEXT_LINE}}?&body=` followed by the profile, URL-encoded (spaces as
  %20). The person presses send themselves. That text is their profile; step 3 is not needed.
- **On a computer.** Do steps 1, 2 and 3. If the client cannot add the connector, show the approved
  profile and ask the person to text it to {{TEXT_LINE}} from their own phone.

You never send a text for the person, and you never see their number.

## How a person joins (they do it, not you)

The person signs up through you, in this conversation:

1. Build the profile: whether they are looking for work or hiring, the kind of role, the neighborhood or remote, when they can start, and the skills that matter (no salary history, no Social Security number, no bank details). Start from what you already know about the person: draft the profile from your memory of them and show it. Ask only for what is missing, one or two questions at a time. Never ask for a phone number, a code, an
   address or anything about another person. Read the profile back and change it until they agree.
2. Give them one link to confirm their own phone: https://peon.biz/join?via=agent. On that page they type
   their own number, the code we text them, their first name and age, and agree to the texts. You
   never see the number or the code.
3. Ask the person to return to this same agent conversation when they finish on the site.
   If this app's MCP tools are not available, they must add {{MCP_URL}} in their client's connector settings.
   In ChatGPT, add https://peon.biz/mcp/openai instead; /mcp does not authorize ChatGPT clients.
   Reading this file does not install a connector or authorize access. If the client cannot add it,
   use the text link in "Phone or computer"; do not claim success and never send the profile yourself.
   The person signs in and allows access on our page. A code is skipped only when that browser
   has a current session for this app. Call check_status first and confirm its app is peon.
   If the connection names another app, stop and connect to this app; never submit across apps.
   Call submit_profile once with their approved profile, then check_status on the same connection.
   Report success only when both calls confirm it.
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

- Never sign anyone up, apply to roles, or message employers or candidates.
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
- Export or delete at https://peon.biz/settings.

## Support

- Support: https://peon.biz/support (email help@ntwrk.party)
- Privacy: https://peon.biz/privacy
- Terms and text messaging terms: https://peon.biz/terms
