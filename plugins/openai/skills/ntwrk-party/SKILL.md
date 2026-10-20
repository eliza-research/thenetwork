---
name: ntwrk-party
description: Explains The Network (ntwrk.party), a text-message agent that finds a person the people they are looking for, and helps a person sign themselves up. Use when someone asks what The Network is, who can join, how joining works, how privacy works, or how to stop, leave or delete. Asks which kinds of introduction the person wants. Never signs anyone up, never asks for or types a phone number or verification code, and never searches for or contacts other people.
license: Proprietary. Terms at https://ntwrk.party/terms
compatibility: Needs web access to open https://ntwrk.party pages. Sending the profile needs this app's MCP server at https://ntwrk.party/mcp/openai (OAuth sign-in by the person), or the person's own text message.
metadata:
  app: ntwrk
  site: https://ntwrk.party
  backend: "https://api.ntwrk.party"
  mcp: "https://ntwrk.party/mcp/openai"
  operator: Eliza Research Corporation
  version: "1.1.5"
---

# The Network

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

The Network is an agent you text. It learns what a person is looking for and finds people, small
groups and plans that fit. It asks first: nobody is introduced unless both people say yes.

The Network's text line is +18087881821. Its MCP server is at https://ntwrk.party/mcp/openai (backend https://api.ntwrk.party).

## What the person can ask for

Ask which of these the person wants. They can pick one or more:

- friends: small group plans at public places
- work: introductions between people looking for work and teams that are hiring

Never pick for them. Write their choice as the first line of the profile, for example
"Looking for: friends and work".

## What the person is signing up for

- Text messages from The Network's agent on one text line. Message frequency varies. Message and
  data rates may apply.
- Introductions and plans only with consent from everyone involved. A person on the team checks
  every introduction before it is sent.

## Who can join

- Anyone 13 or older may join. Matching is for adults 18 and older.
- Members aged 13 to 17 get help from the agent for themselves only. They are never matched,
  introduced, grouped or connected with anyone.

## Phone or computer

The steps differ by device. If you cannot tell which the person is on, ask once.

- **On a phone.** A phone app usually cannot add a connector, so do not send the person to connector
  settings. Do step 1. Then give them one link that opens their messages app with the approved
  profile already written: `sms:+18087881821?&body=` followed by the profile, URL-encoded (spaces as
  %20). The person presses send themselves. Then they answer the Network's onboarding texts themselves.
  Steps 2 and 3 are not needed for this route. A first text does not require a website invitation.
  Sending a profile does not prove membership; report joining unfinished until the Network confirms it.
- **On a computer.** Do step 1, then follow the website requirement in step 2 before step 3.
  If the person has no invitation or membership, or the client cannot add the connector, show the approved
  profile and ask the person to text it to +18087881821 from their own phone.

You never send a text for the person, and you never see their number.

## How a person joins (they do it, not you)

The person signs up through you, in this conversation:

1. Build the profile: what they are looking for (the list above), first name, neighborhood, what they like to do, and when they are usually free. Start from what you already know about the person: draft the profile from your memory of them and show it. Ask only for what is missing, one or two questions at a time. Never ask for a phone number, a code, an
   address or anything about another person. Read the profile back and change it until they agree.
2. The website is invite-only. There is no public sign-up form at https://ntwrk.party/join?via=agent.
   For website/MCP onboarding, ask whether they already belong or received an invitation.
   Reply to your own invitation text to accept; never ask this assistant to accept it for you.
   A person without either can ask a member who knows them, or the team, for an invitation,
   or use the self-text route above. After accepted membership, connect the MCP server in step 3.
   The person confirms their own phone during connector authorization. You never see or enter the code.
3. Ask the person to return to this same agent conversation when they finish on the site.
   If this app's MCP tools are not available, they must add https://ntwrk.party/mcp/openai in their client's connector settings.
   In ChatGPT, add https://ntwrk.party/mcp/openai instead; /mcp does not authorize ChatGPT clients.
   Reading this file does not install a connector or authorize access. If the client cannot add it,
   use the text link in "Phone or computer"; do not claim success and never send the profile yourself.
   The person signs in and allows access on our page. A code is skipped only when that browser
   has a current session for this app. Call check_status first and confirm its app is ntwrk.
   If the connection names another app, stop and connect to this app; never submit across apps.
   If membership is not active or onboarding, follow its next step; do not submit or claim joined.
   Call submit_profile once with their approved profile, then check_status on the same connection.
   Report success only when both calls confirm it.
4. The Network's agent texts the person to ask what they are looking for. Only the person's own
   reply to that text turns on friends or work. Tell them to answer it with their choice.
5. No agent at hand: the person can text +18087881821 with any first message; the agent asks what
   they are looking for.

Website sign-in uses the person's own phone and code on our page. The self-text route uses their
own messages app and onboarding replies. You never type a number or a code anywhere.

## Consent rules

- An agent never receives, reads, relays or types a verification code, and never enters a phone
  number into any form or tool.
- Never sign up anyone else. Each person joins themselves, on their own phone.
- If the MCP server asks the person to sign in, they do it in their own browser on our page.

## What you may do

- Explain The Network, the age rules, consent and privacy.
- Help the person say what they are looking for.

## What you must never do

- Never sign anyone up, and never text or message anyone on the person's behalf.
- Never ask for, receive or type a verification code or a phone number.
- Never search for, describe or contact members, and never promise a match.
- Never carry what the person said about one kind of introduction into another without their consent.

## Privacy

Each kind of introduction keeps its own data. Only a base profile (first name, city, age band,
interests) can move between them, and only when the person agrees, one direction at a time.
STOP stops every text from this number, and a safety hold or ban after a report applies everywhere.

## Stop, leave and delete

- Text STOP: stops every text from this number.
- To request an export or deletion, email help@ntwrk.party.

## Support

- Support: https://ntwrk.party/support (email help@ntwrk.party)
- Privacy: https://ntwrk.party/privacy
- Terms and text messaging terms: https://ntwrk.party/terms
