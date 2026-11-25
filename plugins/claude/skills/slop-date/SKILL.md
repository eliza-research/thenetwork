---
name: slop-date
description: "Helps a person join slop.date: draft and approve a profile in their own agent, verify their phone and choose connector access in their browser, then record the approved profile through the app's connector."
license: Proprietary. Terms at https://slop.date/terms
compatibility: The client must support this app's native connector OAuth handoff. Public app facts come from https://slop.date/api/app.
metadata:
  app: slop
  site: https://slop.date
  operator: Eliza Research Corporation
  version: "1.5.1"
---

# slop.date

If the person asks you to read this file and follow it, start signup. If they ask
only for an explanation, explain without starting signup.

## Talk like a person

Keep replies short, usually one to three sentences. No tool names, HTTP details,
JSON, headings, setup instructions or status tables unless the person asks for them
or a step below needs them.
Start from confirmed facts you already know; ask only for missing information.
Never invent age, profile facts, consent, verification, saved data or introductions.
A draft is not saved until the site confirms it. A saved profile is not a match.

slop.date is dating by text message, with no feed, swiping or profile browsing.
Anyone 13 or older may join. slop.date doesn't match anyone under 18 for dates.
Friendship introductions for people under 18 happen on friends.help and ntwrk.party.
People aged 13–17 get their own help: answers, public events and plans for themselves.
Introductions require both people to agree. Joining now saves a profile for later;
it does not mean introductions have started.

## Join with your agent and browser

1. Check that this app's connector tools (`check_status` and `submit_profile`) are <!-- agentSignup: checkConnectorSetup resumeAfterConnector chooseTransport -->
   available in this conversation. If they are not, check whether this client supports
   this app's full connector. ChatGPT and Codex have no public connector for slop.date.
   If they do not already have tools through approved access, say “Signup isn't
   supported in this agent yet.” Stop before asking for a profile.
   For a client that supports the full connector, say “Connect slop.date” and give
   this app's own connector endpoint, `https://ntwrk.party/mcp/slop`. This path is for slop.date only.
   Ask the person to add it as a connector in this
   client's connector or integration settings, then come back to this conversation.
   Give this setup step one time only. When the tools are available, continue with
   step 2. Reading this file does not give you tools or access.
   Only if this client cannot add a remote connector at all, or the person cannot
   add it, say “Signup isn't supported in this agent yet.” Stop before asking for a
   profile. Use the client's supported authorization flow.
2. Read the public app facts at `https://slop.date/api/app` without credentials. <!-- agentSignup: readAppFacts -->
   Confirm `id` is `slop`. Use this app's `joinMode`, `minJoinAge`, `minMatchAge`,
   and exact current `consent.text` and `consent.version`. Stop if you cannot confirm
   these facts.
3. Ask for their birthday first, not only their age. Use it in this conversation only, <!-- agentSignup: draftProfile -->
   to explain what they get. Use the lowest age that any statement gives. Never send a
   birthday or an age through a tool; the person types their birthday on the app's
   signup page. Explain and stop below 13. Tell people aged 13–17 plainly that
   slop.date will not match them on dates. Tell them what they get: their own help,
   with answers, public events and plans for themselves. Friendship introductions for
   people under 18 happen on friends.help and ntwrk.party. Never promise them an introduction.
   Draft their confirmed first name and home region.
   Confirm the Bay Area (`sf`) or New York City (`nyc`) and keep their neighborhood
   separate. Ask if the region is ambiguous. Do not guess it from a neighborhood
   or ZIP code or pick an incorrect region.
   For adults, draft the profile with interests, availability, the relationship they
   want and preferences they explicitly choose to share. Adult age ranges and travel
   distance are optional. For ages 13–17, draft only a basic personal profile.
   Collect no dating preferences and no photos.
4. Show the exact draft and the app's current text consent wording. Explain <!-- agentSignup: decideApproval -->
   recurring texts, variable frequency, possible message and data rates, STOP
   and HELP. Link the [text terms](https://slop.date/terms#sms),
   [Terms](https://slop.date/terms) and [Privacy Policy](https://slop.date/privacy).
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
7. Use the authorized connector's `check_status` and confirm its app is slop. <!-- agentSignup: checkSiteStatus -->
   If the browser recognized an existing membership, report its current status.
   Do not enroll them again or replace their profile. Stop for
   `not_joined`, `invited`, `stopped`, `on_hold` or the wrong app, and tell the
   person the returned `next_step`: for `not_joined` it is to disconnect the connector, connect
   it again and choose **Finish signup** on the connection page. For a new
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
10. To show what slop.date is looking for for the person, call `list_looking_for`.
   Sending a profile only adds; leaving something out never removes it. If the
   person asks to pause one thing, call `pause_looking_for` with its ref; to
   turn a paused thing back on, call `resume_looking_for` with its ref; to
   close it for good they reply CLOSE to the text they get. Never pause or
   resume anything the person did not ask about.

## Photos with a match

This is for adult members with a match only. Use the person's own words, and
never choose a photo for them.

1. To show which photos slop.date has and who has each, call `my_photos`. It
   gives each photo's number, name and day, and the first name of each match who
   was offered it. It never gives the photos. If it says that the person must
   allow access, tell them that they can connect again and allow the photo list,
   or text MY PHOTOS to +18087881821.
2. To send a photo to a match, name a photo or take one back, call
   `photo_request` with the person's own words, such as "send Maya the beach
   one", "call photo 2 beach" or "take back photo 2". Never pass a photo id, a
   code or a link. Never choose a photo by looks, and never say what a photo
   shows or how anyone looks.
3. You cannot confirm a send. slop.date texts the person the photos to check,
   with a private link. Only their YES to that text sends. The match is asked
   first, and an automatic check screens each photo. Tell the person to
   check their texts. Do not report that a photo was sent.

## Safety, privacy and account controls

Only the person who controls the number may sign in or approve their profile.
Do not sign up someone else, contact other members, request their information,
send invitations, or change another app. The lowest stated age applies. Members
13–17 are never matched on dates or introduced on slop.date. slop.date does not run criminal background checks. Members aged 13–17
receive no dating matches or photo requests. Do not upload or rate photos during signup.
After signup, an adult member who wants to add photos texts ADD PHOTOS to
+18087881821. slop.date asks for the photo consent, then texts a private link
that works once, for 15 minutes. Do not ask for the photos or the link here.

Text STOP stops every text from the shared line; "leave slop.date" leaves this
app only. Export/deletion support is help@ntwrk.party. To see or remove the access of an agent, the person opens https://ntwrk.party/oauth/consents in the browser where they connected. Do not invoke destructive
account controls during signup. The text keyword is `slop` or `slop.date`
on +18087881821; sending a text is the person's separate choice, never an automatic
fallback or an extra signup step.

Dating preferences and orientation stay in this app. Never copy them to another
app, look up another member, rate anyone, or promise a date. Introductions have
not started yet; joining saves the profile for future introductions. For a person aged
13–17, do not say that the profile is for future introductions.

Email: help@ntwrk.party
