---
name: friends-help
description: Explains friends.help, a service by text message that helps people make friends through small group plans at public places, and helps a person sign themselves up. Use when someone asks what friends.help is, who can use it, whether it is safe, how to join, what happens to their data, or how to stop, leave or delete. Gives the join link or the text keyword. Never signs anyone up, never asks for or types a phone number or verification code, and never contacts or describes other people.
license: Proprietary. Terms at https://friends.help/terms
compatibility: Needs web access to open https://friends.help pages. Sending the profile needs this app's MCP server at https://ntwrk.party/mcp/openai (OAuth sign-in by the person).
metadata:
  app: friends
  site: https://friends.help
  mcp: "https://ntwrk.party/mcp/openai"
  operator: Eliza Research Corporation
  version: "1.1.1"
---

# friends.help

If the person asked you to read this file and follow it, they want to join. Start now with
"How a person joins" below.

friends.help helps people make friends, by text. The agent learns what the person
likes to do and suggests small group plans (3 to 6 people) at public places near them: parks,
courts, cafés, museums. The person says yes or skips. Friends, not dates.

friends.help's text line is +18087881821. Its MCP server is at https://ntwrk.party/mcp/openai.

## What the person is signing up for

- Text messages from the friends.help agent on friends.help's text line: questions about what they
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

The person signs up through you, in this conversation:

1. Build the profile: first name, neighborhood, what they like to do (sports, games, food, art), when they are usually free, and small groups or one-on-one. Start from what you already know about the person: draft the profile from your memory of them and show it. Ask only for what is missing, one or two questions at a time. Never ask for a phone number, a code, an
   address or anything about another person. Read the profile back and change it until they agree.
2. Give them one link to confirm their own phone: https://friends.help/join?via=agent. On that page they type
   their own number, the code we text them, their first name and age, and agree to the texts. You
   never see the number or the code.
3. Ask the person to return to this same agent conversation when they finish on the site.
   If this app's MCP tools are not available, they must add https://ntwrk.party/mcp/openai in their client's connector settings.
   In ChatGPT, add https://friends.help/mcp/openai instead; /mcp does not authorize ChatGPT clients.
   Reading this file does not install a connector or authorize access. If the client cannot add it,
   use the text link in "Phone or computer"; do not claim success and never send the profile yourself.
   The person signs in and allows access on our page. A code is skipped only when that browser
   has a current session for this app. Call check_status first and confirm its app is friends.
   If the connection names another app, stop and connect to this app; never submit across apps.
   Call submit_profile once with their approved profile, then check_status on the same connection.
   Report success only when both calls confirm it.
4. No agent at hand: the person can text "friends" or "friends.help" as their first message to +18087881821
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
- Never move information between friends.help and any other service.

## Privacy

What the person tells friends.help stays in friends.help. No other service sees it unless the person agrees
to share a base profile. Nobody can learn whether a phone number uses friends.help.

## Stop, leave and delete

- Text STOP: stops every text from this number.
- Text "leave friends.help": stops friends.help only.
- Export or delete at https://friends.help/settings.

## Support

- Support: https://friends.help/support (email help@ntwrk.party)
- Privacy: https://friends.help/privacy
- Terms and text messaging terms: https://friends.help/terms
