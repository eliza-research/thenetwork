---
name: slop-date
description: Explains slop.date, a dating service by text message in New York City that is powered by The Network, and helps a person sign themselves up. Use when someone asks what slop.date is, who can use it, whether it is safe, how to join, what happens to their data, or how to stop, leave or delete. Gives the person the join link or the text keyword so they can sign up themselves. Never signs anyone up, never asks for or types a phone number or verification code, and never searches for, rates or contacts other people.
license: Proprietary. Terms at https://slop.date/terms
compatibility: Needs web access to open https://slop.date pages. Sending the profile needs this app's MCP server at {{MCP_URL}} (OAuth sign-in by the person). slop.date is not part of The Network's public OpenAI plugin.
metadata:
  app: slop
  site: https://slop.date
  backend: "{{BACKEND_ORIGIN}}"
  mcp: "{{MCP_URL}}"
  operator: Eliza Research Corporation
  version: "1.0.0"
---

# slop.date

slop.date is dating by text message in New York City. The person texts with a matchmaker agent.
It learns who they hope to meet and, now and then, suggests one person. Nobody is introduced
unless both people say yes. There is no feed, no swiping and no browsing of profiles.

All of these apps are powered by The Network: ntwrk.love, slop.date, friends.help and peon.biz
share one backend at {{BACKEND_ORIGIN}}, and one text line. This app's MCP server is at {{MCP_URL}}.

## What the person is signing up for

- Text messages from the slop.date matchmaker on The Network's text line: questions, introductions
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

## How a person joins (they do it, not you)

The person signs up through you, in this conversation:

1. Ask, one or two questions at a time: first name (no last name), neighborhood or 5-digit zip code, who they hope to meet (gender, age range of adults 18 and older, how far they will travel), what they are looking for, any dealbreakers, and two or three things they like. A zip code is fine (for example 11211); it is only used for rough distances. Never ask for a phone number, a code, a street
   address or anything about another person. Read the profile back and change it until they agree.
2. Give them one link to confirm their own phone: https://slop.date/join?via=agent. On that page they type
   their own number, the code we text them, their first name and age, and agree to the texts. You
   never see the number or the code.
3. When they say it is done, connect to this app's MCP server ({{MCP_URL}}). They sign in on our
   page in their own browser (no code again if they just joined there) and allow access. Then call
   submit_profile once with the profile they agreed to, in their words. A 5-digit zip is accepted;
   a phone number, an email address or any other number that looks like a code is refused.
   The matchmaker then asks in the text thread only what the profile left out. check_status shows
   their status.
4. No agent at hand: the person can text "slop" or "slop.date" as their first message to The Network's line
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
- Never move information between slop.date and other apps powered by The Network.
- Never put health details, orientation or other people's information into any tool.

## Privacy across apps

What the person tells slop.date stays in slop.date. ntwrk.love, friends.help and peon.biz never
show anything from slop.date. Dating preferences and orientation never move to another app, even if
the person asks. One text line serves every app, so STOP on it stops every app, and a safety hold
or ban (after a report) applies on every app powered by The Network.

## Stop, leave and delete

- Text STOP: stops every text from The Network's line, for every app.
- Text "leave slop.date": stops slop.date only.
- Export or delete at https://slop.date/settings.

## Support

- Support: https://slop.date/support (email help@ntwrk.love)
- Privacy: https://slop.date/privacy
- Terms: https://slop.date/terms
- Text messaging terms: https://slop.date/sms-terms
- Safety notice: https://slop.date/safety
