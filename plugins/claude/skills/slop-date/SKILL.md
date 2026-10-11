---
name: slop-date
description: Explains slop.date, a dating service by text message, and helps a person sign themselves up. Use when someone asks what slop.date is, who can use it, whether it is safe, how to join, what happens to their data, or how to stop, leave or delete. Gives the person the join link or the text keyword so they can sign up themselves. Never signs anyone up, never asks for or types a phone number or verification code, and never searches for, rates or contacts other people.
license: Proprietary. Terms at https://slop.date/terms
compatibility: Needs web access to open https://slop.date pages. Sending the profile needs this app's MCP server at https://slop.date/mcp (OAuth sign-in by the person).
metadata:
  app: slop
  site: https://slop.date
  mcp: "https://slop.date/mcp"
  operator: Eliza Research Corporation
  version: "1.1.1"
---

# slop.date

If the person asked you to read this file and follow it, they want to join. Start now with
"How a person joins" below.

slop.date is dating by text message. The person texts with a matchmaker agent.
It learns who they hope to meet and, now and then, suggests one person. Nobody is introduced
unless both people say yes. There is no feed, no swiping and no browsing of profiles.

slop.date's text line is +18087881821. Its MCP server is at https://slop.date/mcp.

## What the person is signing up for

- Text messages from the slop.date matchmaker on slop.date's text line: questions, introductions
  they agree to, first-date plans, reminders and check-ins. Message frequency varies. Message and
  data rates may apply.
- One introduction at a time, only with mutual yes. A person on the team checks every introduction
  before it is sent. Introductions have not started yet; people who join now wait for them.
- First dates at public places. slop.date does not run criminal background checks or identity
  checks. The safety notice at https://slop.date/safety is information, not a step to pass.

## Who can use it

- Anyone 13 or older may join. Matching is for adults 18 and older only.
- Members aged 13 to 17 can join, but slop.date never matches them, never introduces them to
  anyone, never asks them for photos and never rates them. Say this plainly if it comes up.
- Photos, and any private impression the matchmaker forms from photos, are for adults
  (18 or older) only. There is no ID check: the age the person states is used. Any such rating
  stays inside the matchmaker and is never shown to anyone.
- One person, one phone number. The person must use their own number.

## Phone or computer

The steps differ by device. If you cannot tell which the person is on, ask once.

- **On a phone.** A phone app usually cannot add a connector, so do not send the person to connector
  settings. Do steps 1 and 2. Then give them one link that opens their messages app with the approved
  profile already written: `sms:+18087881821?&body=` followed by the profile, URL-encoded (spaces as
  %20). The person presses send themselves. That text is their profile; step 3 is not needed.
- **On a computer.** Do steps 1, 2 and 3. If the client cannot add the connector, show the approved
  profile and ask the person to text it to +18087881821 from their own phone.

You never send a text for the person, and you never see their number.

## How a person joins (they do it, not you)

Check connector support before step 3. slop.date has no public OpenAI plugin. Custom ChatGPT onboarding is off by default. In ChatGPT, use
a custom connection only when the operator has confirmed that the pilot is enabled for this person's
adult Slop account. Its MCP endpoint is https://slop.date/mcp, not /mcp/openai. Reading this
file does not install that connection or grant access. After the person authorizes it, call
check_status and confirm app is slop before collecting or submitting a profile. In ChatGPT, if the pilot
is not confirmed, the connector is unavailable, or authorization fails, use the text link in
"Phone or computer" instead. Do not route them to another assistant.

For clients that support this app's connector, the person signs up through you, in this conversation:

1. Build the profile: first name (no last name), neighborhood, who they hope to meet (gender, age range of adults 18 and older, how far they will travel), what they are looking for, and two or three things they like. Start from what you already know about the person: draft the profile from your memory of them and show it. Ask only for what is missing, one or two questions at a time. Never ask for a phone number, a code, an
   address or anything about another person. Read the profile back and change it until they agree.
2. Give them one link to confirm their own phone: https://slop.date/join?via=agent. On that page they type
   their own number, the code we text them, their first name and age, and agree to the texts. You
   never see the number or the code.
3. Ask the person to return to this same agent conversation when they finish on the site.
   If this app's MCP tools are not available, they must add https://slop.date/mcp in their client's connector settings.
   Reading this file does not install a connector or authorize access. If the client cannot add it,
   use the text link in "Phone or computer"; do not claim success and never send the profile yourself.
   The person signs in and allows access on our page. A code is skipped only when that browser
   has a current session for this app. Call check_status first and confirm its app is slop.
   If the connection names another app, stop and connect to this app; never submit across apps.
   Call submit_profile once with their approved profile, then check_status on the same connection.
   Report success only when both calls confirm it.
4. No agent at hand: the person can text "slop" or "slop.date" as their first message to +18087881821
   and answer the agent there.

The person verifies their own phone on our page. You never type a number or a code anywhere.

## Consent rules

- An agent never receives, reads, relays or types a verification code. If the person pastes a
  code to you, tell them not to share it, and do not use it.
- An agent never enters a phone number into any form or tool.
- Never sign up anyone else ("sign up my friend", "make one for my son"). Each person joins
  themselves, on their own phone.
- If the MCP server asks the person to sign in, they do it in their own browser on our page. You
  never see their phone number or their code.

## What you may do

- Explain slop.date, how introductions work, the age rules, privacy and safety, using this file
  and the pages linked here.
- Give the join link https://slop.date/join or the keyword "slop".
- Help the person think about what they want to tell the matchmaker, if they ask.
- Point to settings (export, stop, leave, delete) at https://slop.date/settings.

## What you must never do

- Never sign anyone up, and never text or message anyone on the person's behalf.
- Never ask for, receive or type a verification code or a phone number.
- Never search for, describe, rate or contact other members, and never promise a match.
- Never move information between slop.date and any other service.
- Never put health details, orientation or other people's information into any tool.

## Privacy

What the person tells slop.date stays in slop.date. Dating preferences and orientation never move
to another service, even if the person asks. STOP stops every text from this number, and a safety
hold or ban (after a report) applies on every service the operator runs.

## Stop, leave and delete

- Text STOP: stops every text from this number.
- Text "leave slop.date": stops slop.date only.
- Export or delete at https://slop.date/settings.

## Support

- Support: https://slop.date/support (email help@ntwrk.party)
- Privacy: https://slop.date/privacy
- Terms and text messaging terms: https://slop.date/terms
- Safety notice: https://slop.date/safety
