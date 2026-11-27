---
name: friends-help
description: "Helps a person join friends.help: draft and approve a profile in their own agent, verify their phone and choose connector access in their browser, then record the approved profile through the app's connector."
license: Proprietary. Terms at https://friends.help/terms
compatibility: The client must support this app's native connector OAuth handoff. Public app facts come from https://friends.help/api/app.
metadata:
  app: friends
  site: https://friends.help
  operator: Eliza Research Corporation
  version: "1.5.1"
---

# friends.help

If the person asks you to read this file and follow it, start signup. If they ask
only for an explanation, explain without starting signup.

## Talk like a person

Keep replies short, usually one to three sentences. No tool names, HTTP details,
JSON, headings, setup instructions or status tables unless the person asks for them
or a step below needs them.
Start from confirmed facts you already know; ask only for missing information.
Never invent age, profile facts, consent, verification, saved data or introductions.
A draft is not saved until the site confirms it. A saved profile is not a match.

friends.help helps people make friends through small group plans at public places.
Anyone 13 or older may join. Matching is for adults 18 or older, except friendship
introductions between people aged 13 to 18 born at most 2 years apart, after an
automatic check approves each one. People aged 13–17 also get their own help: answers,
public events and plans for themselves. They are never matched on dates or for work. Groups usually
have 3–6 people. Other members see only the first name and neighbourhood, not the
phone number.

## Join with your agent and browser

1. Check that this app's connector tools (`check_status` and `submit_profile`) are <!-- agentSignup: checkConnectorSetup resumeAfterConnector chooseTransport -->
   available in this conversation. If they are not, say “Connect friends.help” and give
   this app's own connector endpoint, `https://ntwrk.party/mcp/friends`
   (in ChatGPT, `https://ntwrk.party/mcp/friends/openai`). This path is for friends.help only.
   Ask the person to add it as a connector in this
   client's connector or integration settings, then come back to this conversation.
   Give this setup step one time only. When the tools are available, continue with
   step 2. Reading this file does not give you tools or access.
   Only if this client cannot add a remote connector at all, or the person cannot
   add it, say “Signup isn't supported in this agent yet.” Stop before asking for a
   profile. Use the client's supported authorization flow.
2. Read the public app facts at `https://friends.help/api/app` without credentials <!-- agentSignup: readAppFacts -->
   (or call `app_info` with `app: "friends"`, which returns the same `cities`, `ages`,
   and exact current `consent.text` and `consent.version`). Confirm `id` is `friends`.
   Use this app's `joinMode`, `minJoinAge`, `minMatchAge`, and exact current
   `consent.text` and `consent.version`. Stop if you cannot confirm these facts.
3. Ask for their birthday first, not only their age. Use it in this conversation only, <!-- agentSignup: draftProfile -->
   to explain what they get. Use the lowest age that any statement gives. Never send a
   birthday or an age through a tool; the person types their birthday on the app's
   signup page. Explain and stop below 13. Tell people aged 13–17 that friends.help
   introduces people under 18 only for friendship, to people aged 13 to 18 born at most
   2 years apart, after an automatic check approves each one. They also get their own
   help, with answers, public events and plans for themselves. They are never matched
   on dates or for work. Never promise them an introduction.
   Draft their confirmed first name and home region.
   Confirm their home city — New York City (`nyc`), San Francisco / Bay Area (`sf`),
   Los Angeles (`la`), Chicago (`chicago`), or Miami (`miami`) — and keep their
   neighborhood separate. Ask if the region is ambiguous. Do not guess it from a
   neighborhood or ZIP code or pick an incorrect region.
   Draft a friendship profile with interests, availability, any venue red lines
   (dietary, alcohol-free/sober, severe allergies, wheelchair accessibility, or
   low-noise/daytime preferences), and whether they prefer
   groups or one-on-one. Leave out private information intended for other apps.
4. Show the exact draft and the app's current text consent wording. Explain <!-- agentSignup: decideApproval -->
   recurring texts, variable frequency, possible message and data rates, STOP
   and HELP. Link the [text terms](https://friends.help/terms#sms),
   [Terms](https://friends.help/terms) and [Privacy Policy](https://friends.help/privacy).
   Get explicit approval of this exact draft and consent before continuing.
   If they change a detail, read back the updated version and ask again.
5. Use the client's native connector authorization and show the one link it <!-- agentSignup: offerHandoff -->
   supplies. Send it unchanged. Do not construct an authorization or signup URL,
   start a phone check, or ask for a phone number, verification code, token or
   browser cookie. The person handles all credentials in their own browser.
6. The app's browser confirms their own phone, or uses its current verified <!-- agentSignup: observeBrowser -->
   session. For an eligible new membership, choose **Finish signup** there,
   check or enter the same first name and home region, type their own birthday and
   tick the current text consent. Joining is
   open. A forwarded invitation is optional.
   If they want to use a forwarded invitation, they keep the original link
   private and enter the invitation in the app's browser if asked. Do not copy
   its secret into the conversation, an authorization link, or a tool call.
   After enrollment, the person separately chooses whether to **Allow** the
   requested connector access. Get their confirmation that they completed
   signup for the exact approved details and returned to the current same-app
   connector. An existing membership goes to the status check below. If the
   person changed the approved details, cannot confirm signup or authorization,
   or sees a refusal, stop and report the actual result.
7. Use the authorized connector's `check_status` and confirm its app is friends. <!-- agentSignup: checkSiteStatus -->
   If the browser recognized an existing membership, report its current status.
   Do not enroll them again or replace their profile. Stop for
   `not_joined`, `invited`, `stopped`, `on_hold` or the wrong app, and tell the
   person the returned `next_step`: for `not_joined` it is to disconnect the connector, connect
   it again and choose **Finish signup** on the connection page. Before that, for
   `not_joined` or `invited`, you may call `prepare_signup` once with the approved
   first name and home city. The server keeps them for 10 minutes. The person
   still enters their details on the Finish signup page. It never joins anyone. For a new
   signup confirmed in the browser, only `onboarding` or `active` allows the
   approved draft to be submitted. Never submit across apps.
8. Call `submit_profile` once on this exact connection with the approved <!-- agentSignup: submitProfile -->
   profile as `about` (10–1200 characters). Do not include credentials, invitation
   secrets, a birthday, an age or details from another app. If there is a refusal, a timeout or
   an uncertain result, say the profile could not be confirmed. Do not resend it.
9. With `submitted: true` for this app and this call, confirm that the same <!-- agentSignup: confirmProfile -->
   connector still returns this app and an `onboarding` or `active` status.
   Then report that the approved profile was recorded. Otherwise report an
   unconfirmed save. Do not claim matching, an introduction or a profile update
   in another app.
10. To show what friends.help is looking for for the person, call `list_looking_for`.
   Sending a profile only adds; leaving something out never removes it. If the
   person asks to pause one thing, call `pause_looking_for` with its ref; to
   turn a paused thing back on, call `resume_looking_for` with its ref; to
   close it for good they reply CLOSE to the text they get. Never pause or
   resume anything the person did not ask about.

## Safety, privacy and account controls

Only the person who controls the number may sign in or approve their profile.
Do not sign up someone else, contact other members, request their information,
send invitations, or change another app. The lowest stated age applies. Members
13–17 are never matched on dates or for work, and are introduced only for friendship as above. No background checks are run.

Text STOP stops every text from the shared line; "leave friends.help" leaves this
app only. Export/deletion support is help@ntwrk.party. To see or remove the access of an agent, the person opens https://ntwrk.party/oauth/consents in the browser where they connected. Do not invoke destructive
account controls during signup. The text keyword is `friends` or `friends.help`
on {{TEXT_LINE}}; sending a text is the person's separate choice, never an automatic
fallback or an extra signup step.
