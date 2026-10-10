---
name: friends-help
description: Explains friends.help, a service by text message powered by The Network that helps people in New York City make friends through small group plans at public places, and helps a person sign themselves up. Use when someone asks what friends.help is, who can use it, whether it is safe, how to join, what happens to their data, or how to stop, leave or delete. Gives the join link or the text keyword. Never signs anyone up, never asks for or types a phone number or verification code, and never contacts or describes other people.
license: Proprietary. Terms at https://friends.help/terms
compatibility: Needs web access to open https://friends.help pages. Sending the profile needs this app's MCP server at https://ntwrk.party/mcp/openai (OAuth sign-in by the person).
metadata:
  app: friends
  site: https://friends.help
  backend: "https://api.ntwrk.party"
  mcp: "https://ntwrk.party/mcp/openai"
  operator: Eliza Research Corporation
  version: "1.0.1"
---

# friends.help

friends.help helps people in New York City make friends, by text. The agent learns what the person
likes to do and suggests small group plans (3 to 6 people) at public places near them: parks,
courts, cafés, museums. The person says yes or skips. Friends, not dates.

All of these apps are powered by The Network: ntwrk.party, friends.help and peon.biz
share one backend at https://api.ntwrk.party, and one text line. This app's MCP server is at https://ntwrk.party/mcp/openai.

## What the person is signing up for

- Text messages from the friends.help agent on The Network's text line: questions about what they
  like to do, invitations to plans, plan details and reminders. Message frequency varies. Message
  and data rates may apply.
- Plans only with people who also said yes. A person on the team checks every plan first.
  Other people see their first name and neighbourhood, never their phone number.
- friends.help does not run background checks. Plans are always at public places.

## Who can use it

- Anyone 13 or older may join. Matching and group plans are for adults 18 and older only.
- Members aged 13 to 17 can get ideas for things to do, but friends.help never matches them,
  never puts them in a group and never introduces them to anyone.
- One person, one phone number. The person must use their own number.

## How a person joins (they do it, not you)

The person signs up through you, in this conversation:

1. Ask, one or two questions at a time: first name, neighborhood, what they like to do (sports, games, food, art), when they are usually free, and small groups or one-on-one. Never ask for a phone number, a code, an
   address or anything about another person. Read the profile back and change it until they agree.
2. Give them one link to confirm their own phone: https://friends.help/join?via=agent. On that page they type
   their own number, the code we text them, their first name and age, and agree to the texts. You
   never see the number or the code.
3. Ask the person to return to this same agent conversation when they finish on the site.
   If this app's MCP tools are not available, they must add https://ntwrk.party/mcp/openai in their client's connector settings.
   In ChatGPT, add https://friends.help/mcp/openai instead; /mcp does not authorize ChatGPT clients.
   Reading this file does not install a connector or authorize access. If the client cannot add it,
   explain that profile submission is unfinished; do not claim success or send the profile elsewhere.
   The person signs in and allows access on our page. A code is skipped only when that browser
   has a current session for this app. Call check_status first and confirm its app is friends.
   If the connection names another app, stop and connect to this app; never submit across apps.
   Call submit_profile once with their approved profile, then check_status on the same connection.
   Report success only when both calls confirm it.
4. No agent at hand: the person can text "friends" or "friends.help" as their first message to The Network's line
   and answer the agent there.

The person verifies their own phone on our page. You never type a number or a code anywhere.

## Consent rules

- An agent never receives, reads, relays or types a verification code, and never enters a phone
  number into any form or tool.
- Never sign up anyone else. Each person joins themselves, on their own phone.
- If the MCP server asks the person to sign in, they do it in their own browser on our page.

## What you may do

- Explain friends.help, how plans work, safety, the age rules and privacy.
- Give the join link https://friends.help/join or the keyword "friends".
- Help the person think about what they like to do, if they ask.

## What you must never do

- Never sign anyone up, and never text or message anyone on the person's behalf.
- Never ask for, receive or type a verification code or a phone number.
- Never describe or contact other members, and never promise a plan or a friend.
- Never move information between friends.help and other apps powered by The Network.

## Privacy across apps

What the person tells friends.help stays in friends.help. Other apps powered by The Network see
nothing from it unless the person agrees to share a base profile. Nobody learns from any app
whether a phone number uses friends.help.

## Stop, leave and delete

- Text STOP: stops every text from The Network's line, for every app.
- Text "leave friends.help": stops friends.help only.
- Export or delete at https://friends.help/settings.

## Support

- Support: https://friends.help/support (email help@ntwrk.party)
- Privacy: https://friends.help/privacy
- Terms: https://friends.help/terms
- Text messaging terms: https://friends.help/sms-terms
