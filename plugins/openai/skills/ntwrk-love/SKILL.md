---
name: ntwrk-love
description: Explains The Network (ntwrk.love), the text-message agent that powers friends.help (friends in New York City) and peon.biz (work and hiring), and points a person to the right app so they can sign themselves up. Use when someone asks what The Network or one of its apps is, which app fits what they want, who can join, how joining works, how privacy works across apps, or how to stop, leave or delete. Never signs anyone up, never asks for or types a phone number or verification code, and never searches for or contacts other people.
license: Proprietary. Terms at https://ntwrk.love/terms
compatibility: Needs web access to open https://ntwrk.love pages. Sending the profile needs this app's MCP server at https://ntwrk.love/mcp/openai (OAuth sign-in by the person).
metadata:
  app: ntwrk
  site: https://ntwrk.love
  backend: "https://api.ntwrk.love"
  mcp: "https://ntwrk.love/mcp/openai"
  operator: Eliza Research Corporation
  version: "1.0.1"
---

# The Network

The Network is an agent you text. It learns what a person is looking for and finds people, small
groups and plans that fit. It asks first: nobody is introduced unless both people say yes.

All of these apps are powered by The Network. They share one backend at https://api.ntwrk.love, one text
line and one rule: nothing crosses apps without the person's consent. The Network's MCP server is at
https://ntwrk.love/mcp/openai; each app's site has its own (https://<site>/mcp).

| App | For | Text keyword | Site |
|---|---|---|---|
| The Network | Introductions, plans and events (invite-only for now) | no keyword | https://ntwrk.love |
| friends.help | Friends and small group plans in New York City | friends | https://friends.help |
| peon.biz | Work and hiring | peon | https://peon.biz |

## What the person is signing up for

- Text messages from The Network's agent, or from the app they join, on one shared text line.
  Message frequency varies. Message and data rates may apply.
- Introductions and plans only with consent from everyone involved. A person on the team checks
  every introduction before it is sent.

## Who can join

- Anyone 13 or older may join any app. Matching is for adults 18 and older, in every app.
- Members aged 13 to 17 get help from the agent for themselves only. They are never matched,
  introduced, grouped or connected with anyone, in any app.

## How a person joins (they do it, not you)

The person signs up through you, in this conversation:

1. Ask, one or two questions at a time: first name, neighborhood, what they want more of right now (people, plans or events), what they like to do, and when they are usually free. Never ask for a phone number, a code, an
   address or anything about another person. Read the profile back and change it until they agree.
2. Give them one link to confirm their own phone: https://ntwrk.love/join?via=agent. On that page they type
   their own number, the code we text them, their first name and age, and agree to the texts. You
   never see the number or the code.
3. Ask the person to return to this same agent conversation when they finish on the site.
   If this app's MCP tools are not available, they must add https://ntwrk.love/mcp/openai in their client's connector settings.
   In ChatGPT, add https://ntwrk.love/mcp/openai instead; /mcp does not authorize ChatGPT clients.
   Reading this file does not install a connector or authorize access. If the client cannot add it,
   explain that profile submission is unfinished; do not claim success or send the profile elsewhere.
   The person signs in and allows access on our page. A code is skipped only when that browser
   has a current session for this app. Call check_status first and confirm its app is ntwrk.
   If the connection names another app, stop and connect to this app; never submit across apps.
   Call submit_profile once with their approved profile, then check_status on the same connection.
   Report success only when both calls confirm it.
4. No agent at hand: the person can text The Network's line with no keyword; the agent asks what
   they are looking for and adds the right apps.

The person verifies their own phone on our page. You never type a number or a code anywhere.

## Consent rules

- An agent never receives, reads, relays or types a verification code, and never enters a phone
  number into any form or tool.
- Never sign up anyone else. Each person joins themselves, on their own phone.
- If the MCP server asks the person to sign in, they do it in their own browser on our page.

## What you may do

- Explain each app, the age rules, consent and privacy. Help the person pick the right app.
- Give links and keywords from the table above.

## What you must never do

- Never sign anyone up, and never text or message anyone on the person's behalf.
- Never ask for, receive or type a verification code or a phone number.
- Never search for, describe or contact members, and never promise a match.
- Never carry information from one app to another.

## Privacy across apps

Each app keeps its own data. Only a base profile (first name, city, age band, interests) can move
between apps, and only when the person agrees, one direction at a time.
One text line serves every app: STOP on it stops every app, and a safety hold or ban after a report
applies on every app.

## Stop, leave and delete

- Text STOP: stops every text from the line, for every app.
- Text "leave" and an app name, for example "leave peon.biz": stops that app only.
- Export or delete on each app's /settings page.

## Support

- Support: https://ntwrk.love/support (email help@ntwrk.love)
- Privacy: https://ntwrk.love/privacy
- Terms and text messaging terms: https://ntwrk.love/terms
