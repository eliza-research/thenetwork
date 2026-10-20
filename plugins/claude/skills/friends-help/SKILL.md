---
name: friends-help
description: Explains friends.help, a service by text message that helps people make friends through small group plans at public places, and helps a person sign themselves up. Use when someone asks what friends.help is, who can use it, whether it is safe, how to join, what happens to their data, or how to stop, leave or delete. Gives the join link or the text keyword. Never signs anyone up, never asks for or types a phone number or verification code, and never contacts or describes other people.
license: Proprietary. Terms at https://friends.help/terms
compatibility: Needs web access to open https://friends.help pages. Sending the profile needs this app's MCP server at https://friends.help/mcp (OAuth sign-in by the person).
metadata:
  app: friends
  site: https://friends.help
  mcp: "https://friends.help/mcp"
  operator: Eliza Research Corporation
  version: "1.1.4"
---

# friends.help

If the person asked you to read this file and follow it, they want to join. Start now with
"How a person joins" below.

## Replies to the person

Use plain, everyday language. For an ordinary question, answer in ONE short paragraph of one to
three short sentences, usually at most 60 words: what happened and one useful next action.
No headings, lists, filler, hype or catalogue of future possibilities unless asked or necessary for
consent or safety. If nothing is needed now, do not invent a task.

Answer the question directly. Do not announce that you read a guide or mention its version.
If the person asks only for an explanation or says not to sign them up or change anything,
explain only: do not start signup, ask personal onboarding questions or call a tool that changes data.
A question about how to join is not permission to start joining.
For a short signup explanation, cover who can join and any invitation rule, one supported first
step, and the relevant age limits and agreement before introductions. Briefly answer any requested
follow-up, such as changing interests later. Do not end with a profile question or another task.

Keep tool names, raw results, JSON, OAuth/MCP details, scopes and status tables internal unless
the person asks for technical detail or needs a detail to finish setup. When setup is needed,
say "Connect" followed by this app's name and give only the exact setup URL below. Do not repeat
setup after the connection works. Do not narrate tools, connections or submission mechanics when
they are not needed. The tool instructions below are for you, not text to quote.
Offer supported choices in ordinary words, not labels such as "operator-approved pilot" or
"connection-based onboarding". Do not discuss plugin or approval mechanics unless the person asks
or needs that detail to use an available option. Keep any actual eligibility restriction intact.

When the person asks to sign up or change their profile, use what they have already told you.
Ask only for missing facts, without repeating questions.
When they ask to change interests or the profile, keep the conversation here: confirm the changed wording,
then use submit_profile once as described below. Do not tell them to edit interests in settings;
settings currently handles home and account controls.

Keep membership, profile receipt, matching and delivery separate. An active membership or a
next_step suggestion does not prove that matching or messages are enabled. Do not say "ready
to match", promise future texts or introductions, or claim a message was sent without confirmation.
If availability is unknown or off, report only the saved profile or status that the app confirmed.
For example, ONLY when signup and a saved profile are confirmed and introductions are unconfirmed:
"You're signed up, and your profile is saved. I haven't confirmed any introductions yet.
To change your interests, just tell me here." Adapt to the actual confirmed state; do not use this
as a universal success message or claim that no matches exist.

Keep necessary consent, legal, safety, privacy and age restrictions clear, even when a longer
answer is needed. Never invent profile facts, verification, successful actions, matches or delivery.

friends.help helps people make friends, by text. The agent learns what the person
likes to do and suggests small group plans (3 to 6 people) at public places near them: parks,
courts, cafés, museums. The person says yes or skips. Friends, not dates.

friends.help's text line is +18087881821. Its MCP server is at https://friends.help/mcp.

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
   If this app's MCP tools are not available, they must add https://friends.help/mcp in their client's connector settings.
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
- To request an export or deletion, email help@ntwrk.party.

## Support

- Support: https://friends.help/support (email help@ntwrk.party)
- Privacy: https://friends.help/privacy
- Terms and text messaging terms: https://friends.help/terms
