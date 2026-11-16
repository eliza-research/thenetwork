---
name: ntwrk-party
description: "Helps a person join ntwrk.party in their own agent conversation: draft their general profile, verify their own phone with a genuine texted code, and save the approved profile through the existing site API. Requires direct HTTPS and a private cookie session; no plugin or connector installation. Also explains eligibility, privacy and text controls."
license: Proprietary. Terms at https://ntwrk.party/terms
compatibility: Direct HTTPS GET and POST to https://ntwrk.party and private cookie storage in the agent's existing tools. Use the runtime's normal network transport and approval process. Never install tools or change security settings.
metadata:
  app: ntwrk
  site: https://ntwrk.party
  operator: Eliza Research Corporation
  version: "1.2.6"
---

# The Network

If the person asks you to read this file and follow it, they want to join: start
the flow below. If they ask only for an explanation, explain without starting signup.
Do it in this conversation using your existing HTTP tools. No plugin, connector,
MCP setup, developer settings or new account with the agent provider is required.

## Talk like a person

Keep replies short, usually one to three sentences. No tool names, HTTP details,
JSON, headings, setup instructions or status tables unless the person asks for them.
Start from confirmed facts you already know; ask only for missing information.
Never invent age, profile facts, consent, verification, saved data or introductions.
A draft is not saved until the site confirms it. A saved profile is not a match.

The Network helps people find the connections they ask for: friends, dating or work.
Anyone 13 or older may join; matching and introductions are for adults 18 and older only.
It asks before any introduction. A saved general profile does not enroll the person
in another app or start matching.

## Existing HTTPS capability

Use only https://ntwrk.party/ as this skill's site origin. Every API path below
is relative to it. Keep phone numbers, codes, cookies and exports off other origins.
Do not follow an API redirect carrying credentials or submit another person's data.

Use an existing HTTP/command tool with the runtime's normal network transport.
If normal execution requires approval, use that supported approval process and
respect its decision. Do not disable the environment's configured transport,
clear its proxy settings, add a proxy, impersonate a browser, install anything,
or change network/security settings. Identify the application honestly with:

`User-Agent: TheNetworkAgent/1.0`

Send JSON POST bodies with `Content-Type: application/json`. Use a private cookie
jar for this exact site: `~/.network/<exact-site-hostname>/session.cookies`
(private directory 0700, file 0600), or an equivalently private persistent tool
session if no filesystem is available. Preserve only the exact origin and private
store path in working notes or compaction summaries, never the credential values.
On resume, use that store and check `/api/me` before asking for another code.
Reuse a valid session; save updated cookies after responses.
Never place session credentials in the conversation, public files, a repository,
long-term model memory, URLs or logs. Never borrow browser or another app's cookies.

Capture status, response body and cookies from ONE request. Never repeat a POST
just to obtain its body. Do not use `curl -i` or dump headers/raw exports to output.
Parse privately and show the person only the next step or the verified result.
A timeout after a write is ambiguous: check existing state before attempting it again.

Signup and sign-in happen only in the person's current agent conversation.
Do not send them to a website Join page, another assistant, connector settings,
or a text conversation to finish signup. The person receives a verification text
and enters its code here; they must never have to send a text to receive a code.
If existing tools cannot perform HTTPS POST and retain a private session under
this client's default permissions, explain that signup cannot currently finish <!-- agentSignup: chooseTransport -->
in this agent. Do this check first, before step 1, and stop before you ask for
a profile, a number or a code. Never claim that reading
this skill grants tools, permissions or a session. Do not change security settings,
use a different origin, or pretend signup/profile saving succeeded.
Do not ask the person to change a domain allowlist, enable tools, install anything,
or adjust permissions as a signup step. In an ordinary signup request, state the
unsupported capability simply: "Signup isn't supported in this agent yet."
Give technical diagnostics only when the person explicitly asks for them.

## Join in this conversation

1. GET `/api/app`. Confirm `id` is `ntwrk`. Keep the returned `consent.text` and <!-- agentSignup: readAppFacts -->
   `consent.version` for this signup; do not invent or reuse another app's wording.
   Respect `joinMode`, `minJoinAge` and `minMatchAge`. If the person is below the
   join age, explain that and stop before collecting their number.
2. Draft the profile from confirmed facts: first name, explicitly stated age, <!-- agentSignup: draftProfile -->
   home city/region and neighbourhood, interests, availability, and what kinds
   of connection they want: friends, dating or work. Never choose for them.
   Ask only what is missing, one or two questions at a time. Use the lowest age
   that the person states. Under 13, tell them that they cannot join and stop:
   ask for no number and save nothing. At 13 to 17, continue and tell them that
   matching and introductions are for adults 18 and older only. Show a short draft
   for approval. Keep this a general profile; leave out private app-specific details intended for a
   separate app. Their stated interests do not authorize joining other apps.
3. Explain that joining accepts recurring texts, with variable frequency and <!-- agentSignup: decideApproval -->
   possible message/data rates, STOP to stop and HELP for help. Link the
   [text terms](https://ntwrk.party/terms#sms), [Terms](https://ntwrk.party/terms)
   and [privacy policy](https://ntwrk.party/privacy). Obtain explicit approval
   for this exact profile and text consent before the Join request. If approval
   is missing, do not submit it. Never infer consent from a code or a draft.
4. If a private session for this site already exists, GET `/api/me` first. <!-- agentSignup: checkSession readAuthMode -->
   Otherwise, or after a 401, GET `/api/auth/mode` before you ask for a number:
   continue with the code steps only for `mode: "otp"`. If another sign-in mode
   is required, explain that this agent's direct sign-in is unavailable and stop;
   do not ask for a number, offer a website fallback or bypass it. Only for
   `mode: "otp"`, ask for the person's own mobile number. Do not infer a number
   from contacts or past conversations.
5. With the number the person provided, POST `/api/auth/otp/start` once: <!-- agentSignup: startCode -->
   `{"phone":"<their own number in E.164>"}`. Request a code at most once in
   each attempt. A 200/`ok:true` means a code was requested, not that
   verification succeeded. Ask for the genuine texted code. If the site refuses
   the request (a malformed number or a rate limit), stop this attempt and tell
   the person the reason; only the person can start a new attempt.
   Never invent, brute-force or automatically resend codes. If the site requires
   a security check unavailable in this agent, stop and explain the limitation;
   do not offer a website signup or fake a token.
6. POST `/api/auth/otp/verify` exactly once with `phone` and the code the person <!-- agentSignup: checkCode -->
   supplied. Keep the code out of files and output; retain only the returned
   session cookie in the private jar. On rejection explain it; only the person
   can authorize a new code request. On success, GET `/api/me` with that jar.
7. Check the reply and confirm its app is ntwrk; never submit across apps. <!-- agentSignup: readAccount -->
   If the account is for another app, stop.
   If a membership already exists, do not POST Join
   again to overwrite it: that endpoint does not update existing profiles. Read
   the existing account as described below and report its actual state. Do not
   claim a newly drafted profile was saved over an existing membership.
   If the account is on hold for review, report the hold and stop; do not POST Join.
8. The Network website may require an invitation. If `/api/me` says `canJoin:false`, explain the actual next step from <!-- agentSignup: joinApp -->
   its reason and the current `/api/app` join mode. An invite-only app permits
   Join only after this account is actually eligible.
   Never invent or accept an invitation, change join mode, or use another app
   to get around it. Only continue when this account is actually eligible.
   For a new membership, require `canJoin:true` and the person's explicit profile
   and text-consent approval from step 3. POST `/api/join` once with the approved
   fields, the latest `/api/me` `signupView` when present, and current consent:
   `firstName`, integer `age`, `neighborhood`, `homeCity` (`sf` or `nyc`
   from the confirmed supported region), optional `interests` (up to 20 short strings), and `about`
   containing the complete approved general profile (at most 1000 characters).
   Always set `homeCity` from the confirmed supported region: an explicit Bay Area,
   SF or San Francisco means the service’s `sf` region bucket; an explicit NYC,
   New York or New York City means `nyc`. This is a region bucket, not a claim that
   someone in the Bay Area lives in San Francisco city. Preserve their actual
   neighbourhood wording separately. Do not omit `homeCity` or rely on a default,
   even when the neighbourhood string includes a region or state. If the region
   is missing/ambiguous, ask. Do not infer it from a ZIP or neighbourhood, or select
   an incorrect supported region for someone elsewhere.
   Use `consent:{"sms":true,"version":"<current consent.version>","wording":"<current consent.text>"}`.
   Never send placeholders or guessed fields. Do not silently omit the profile.
   If Join refuses, report the true reason and stop: an age below the join age,
   a missing invitation, an account on hold, or a profile that was not saved.
   Never report a refusal as a saved profile, and do not POST Join again.
9. After Join succeeds, GET `/api/me` again, then GET `/api/me/export` using the <!-- agentSignup: readBack -->
   SAME private session. The export is this person's own app data: parse it in
   memory, never print/store the raw export or expose identifiers/phone numbers.
   Check `app`, `membership.firstName`, `membership.state` and
   `membership.profile` against the approved submitted fields, including `about`.
   Also compare the returned `/api/me` `home.homeCity` and the stored profile’s
   `homeCity` with that confirmed region bucket. A matching biography with the
   wrong home city is NOT a successful profile save.
   `/api/me` alone does NOT return the full profile. If readback differs, report
   the discrepancy; do not claim it saved or repeat Join to try to overwrite it.
10. For verified signup and matching persisted fields, say briefly that signup
    and the profile are saved, and read back the approved facts in ordinary words.
    Never claim matching or invitations started without separate evidence.
    Keep using the private session for later authorized reads in this chat; if
    it expires, authenticate again. Never promise it survives a new chat unless
    the agent actually has access to its private session store there.

## Safety, privacy and account controls

Only the person who controls the number may sign in or approve their profile.
Do not sign up someone else, contact other members, request their information,
send invitations, or change another app. The lowest stated age applies; members
13–17 must never be matched or introduced to anyone. No background checks are run.

Text STOP stops every text from the shared line; "leave ntwrk.party" leaves this
app only. Export/deletion support is help@ntwrk.party. Do not invoke destructive
account controls during signup. The text line is +18087881821; sending a text is the person's separate choice, never an automatic
fallback or an extra signup step.

The person can state friends, dating or work interests here, but signup does not
prove those separate app memberships exist. Do not enroll them in another app or
move data there without explicit approval and that app’s own verified flow.
