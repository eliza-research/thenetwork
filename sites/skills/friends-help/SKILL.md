---
name: friends-help
description: "Helps a person join friends.help in their own agent conversation: draft their friendship profile, verify their own phone with a genuine texted code, and save the approved profile through the existing site API. Requires direct HTTPS and a private cookie session; no plugin or connector installation. Also explains eligibility, privacy and text controls."
license: Proprietary. Terms at https://friends.help/terms
compatibility: Direct HTTPS GET and POST to https://friends.help and private cookie storage in the agent's existing tools. Use the runtime's normal network transport and approval process. Never install tools or change security settings.
metadata:
  app: friends
  site: https://friends.help
  operator: Eliza Research Corporation
  version: "1.2.6"
---

# friends.help

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

friends.help helps people make friends through small group plans at public places.
Anyone 13 or older may join; matching and introductions are for adults 18 and older only. Groups usually
have 3–6 people. Other members see only the first name and neighbourhood, not the
phone number.

## Existing HTTPS capability

Use only https://friends.help/ as this skill's site origin. Every API path below
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
this client's default permissions, explain that signup cannot currently finish
in this agent. Stop before requesting a number or code. Never claim that reading
this skill grants tools, permissions or a session. Do not change security settings,
use a different origin, or pretend signup/profile saving succeeded.
Do not ask the person to change a domain allowlist, enable tools, install anything,
or adjust permissions as a signup step. In an ordinary signup request, state the
unsupported capability simply: "Signup isn't supported in this agent yet."
Give technical diagnostics only when the person explicitly asks for them.

## A forwarded invitation

If the person supplies a link starting with `https://friends.help/SKILL.md#invite=`,
it can attribute their new membership to the member who forwarded it. Fetch only
the `/SKILL.md` path. Keep the 43-character invitation value from the fragment
private and only for this signup. Ask if the person wants to use the invitation
when you ask for their approval of the profile and text consent. Never repeat the
link or value in your reply, logs or stored notes. Never ask for a link after the
site shows an existing membership. The invitation does not replace phone
verification, age eligibility or consent.

## Join in this conversation

1. GET `/api/app`. Confirm `id` is `friends`. Keep the returned `consent.text` and
   `consent.version` for this signup; do not invent or reuse another app's wording.
   Respect `joinMode`, `minJoinAge` and `minMatchAge`. If the person is below the
   join age, explain that and stop before collecting their number.
2. Draft the profile from confirmed facts: first name, explicitly stated age,
   home city/region and neighbourhood, interests, availability, and groups or one-on-one.
   Ask only what is missing, one or two questions at a time. Show a short draft
   for approval. Keep this a friendship profile; leave out information intended for other apps.
3. Explain that joining accepts recurring texts, with variable frequency and
   possible message/data rates, STOP to stop and HELP for help. Link the
   [text terms](https://friends.help/terms#sms), [Terms](https://friends.help/terms)
   and [privacy policy](https://friends.help/privacy). Obtain explicit approval
   for this exact profile and text consent before the Join request. If approval
   is missing, do not submit it. Never infer consent from a code or a draft.
4. If a private session for this site already exists, GET `/api/me` first.
   Otherwise, or after a 401, ask for the person's own mobile number. Do not
   infer a number from contacts or past conversations. GET `/api/auth/mode`:
   continue with the code steps only for `mode: "otp"`. If another sign-in mode
   is required, explain that this agent's direct sign-in is unavailable and stop;
   do not offer a website fallback or bypass it.
5. With the number the person provided, POST `/api/auth/otp/start` once:
   `{"phone":"<their own number in E.164>"}`. A 200/`ok:true` means a code was
   requested, not that verification succeeded. Ask for the genuine texted code.
   Never invent, brute-force or automatically resend codes. If the site requires
   a security check unavailable in this agent, stop and explain the limitation;
   do not offer a website signup or fake a token.
6. POST `/api/auth/otp/verify` exactly once with `phone` and the code the person
   supplied. Keep the code out of files and output; retain only the returned
   session cookie in the private jar. On rejection explain it; only the person
   can authorize a new code request. On success, GET `/api/me` with that jar.
7. Check the reply and confirm its app is friends; never submit across apps.
   If a membership already exists in a state other than `invited`, use the
   existing account. The Join request does not update existing profiles. Read
   the existing account as described below and report its actual state. Do not
   claim a newly drafted profile was saved over an existing membership.
8. For a new membership, require `canJoin:true` and the person's explicit profile
   and text-consent approval from step 3. POST `/api/join` once with the approved
   fields, the latest `/api/me` `signupView` when present, and current consent:
   `firstName`, integer `age`, `neighborhood`, `homeCity` (`sf` or `nyc`
   from the confirmed supported region), optional `interests` (up to 20 short strings), and `about`
   containing the complete approved friendship profile (at most 1000 characters).
   Always set `homeCity` from the confirmed supported region: an explicit Bay Area,
   SF or San Francisco means the service’s `sf` region bucket; an explicit NYC,
   New York or New York City means `nyc`. This is a region bucket, not a claim that
   someone in the Bay Area lives in San Francisco city. Preserve their actual
   neighbourhood wording separately. Do not omit `homeCity` or rely on a default,
   even when the neighbourhood string includes a region or state. If the region
   is missing/ambiguous, ask. Do not infer it from a ZIP or neighbourhood, or select
   an incorrect supported region for someone elsewhere.
   Use `consent:{"sms":true,"version":"<current consent.version>","wording":"<current consent.text>"}`.
   Include `inviteToken` in that JSON body only when the person supplied and
   approved the exact app's invitation. If the site returns `invalid_invitation`,
   say the invitation is unavailable. Do not submit again without the person's
   approval for a new link or, where joining is open, an ordinary join.
   Never send placeholders or guessed fields. Do not silently omit the profile.
9. After Join succeeds, GET `/api/me` again, then GET `/api/me/export` using the
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

Text STOP stops every text from the shared line; "leave friends.help" leaves this
app only. Export/deletion support is help@ntwrk.party. Do not invoke destructive
account controls during signup. The text keyword is `friends` or `friends.help`
on {{TEXT_LINE}}; sending a text is the person's separate choice, never an automatic
fallback or an extra signup step.
