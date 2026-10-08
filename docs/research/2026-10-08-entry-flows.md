# Entry flows: iMessage, ChatGPT, Claude, Grok

Status: adopted 2026-10-08 (founder: "do everything"; see section 9 for how each decision was resolved). The detailed source notes, with links, dates and confidence levels, are in `docs/research/entry-flows/`:
- `research-chatgpt.md`
- `research-claude-grok.md`
- `research-data-sources.md`
- `research-notify-deeplinks.md`

This doc builds on:
- PRD 11 (Gateway) and 11.5 (phone verification and agent keys);
- `connectors/*.md`, `mcp-server-design.md` and `blooio.md`;
- the multi-app decisions: one Blooio line with keyword routing; slop.date first; minors join every app but are never matched.

Items that have not been tested on a real phone are marked **(unverified)**.

## 0. Findings that change the plan

1. **The phone code can't be typed into the chat in the public ChatGPT or Claude listings.**
   - OpenAI's plugin rules list one-time codes among the data a plugin must not "collect, solicit, or process". Tool results must not contain secrets, so we can't return an agent key from a tool either.
   - Claude's Directory Policy (§5D, 2026-04-15) requires OAuth 2.0 for any server that needs authentication.
   - **The fix:** OAuth 2.1, where our own sign-in page asks for the phone number and SMS code. It's the same identity and the same kind of key; only where the code is typed changes.
   - Code-in-chat stays for local agents (Claude Code, Codex, Eliza/Milady) and for unlisted custom connectors.
   - **PRD 11.5 must be updated.**
2. **No assistant can notify the user on our behalf in a reliable way.** iMessage/SMS is the only push channel we control. Assistants are where people go after a nudge, not where nudges come from. Two new hooks are worth testing later (Section 5.5):
   - ChatGPT MCP Events: new, limited, with a reported bug.
   - Grok Automations: scheduled, and can notify the user.
3. **Prefilled-prompt deeplinks work, but the user taps Send.**
   - On iOS, `chatgpt.com/?prompt=`, `claude.ai/new?q=` and `grok.com/?q=` open the native apps.
   - Use links that only fill the text box. ChatGPT's `?q=` auto-sends on the web, which is a prompt-injection risk.
   - A redirect through our own domain usually keeps iOS in Safari instead of the app, because iOS only opens apps on a direct user tap. So put the assistant link itself in the iMessage when we know which assistant the person uses, and use a button page otherwise.
4. **Most social-network APIs are closed for profile building.** No Gmail (Google's policy bans one-off export use), no Instagram for personal accounts, Spotify is capped at 5 users, LinkedIn only gives name, photo and email, and scraping LinkedIn draws lawsuits. **The best source is the member's own AI:** a "what do you know about me" summary from ChatGPT or Claude. We can send them straight to it with a deeplink.
5. **The public ChatGPT listing must suit teens.** ChatGPT plugins must be appropriate for users aged 13-17, adult mode is paused, and ChatGPT sends apps no age signal.
   - A dating listing is unprecedented in the directory and risky in review.
   - So slop.date's AI entry should be the "paste prompt" pattern (Section 3.2), which needs no plugin and no review.
   - The ChatGPT plugin is The Network (friends, help, work) with a teen-safe profile.
6. **Memory is shared by the host, not read by us.** No host lets a connector read memory directly. ChatGPT's install page says it "may share relevant chats and memories with this app", and Claude can search past chats when the user asks. "Build my profile from what you know about me" is acceptable when:
   - the user asks for it;
   - the tool takes narrow typed fields;
   - the user approves the draft.

   Our tool descriptions must never instruct the model to dump memory (Claude §1F). Sensitive fields (orientation, religion, health) are **asked, not inferred**; X's terms forbid inferring them from X data even with consent.
7. **Custom GPTs are retired on 2026-12-11.** Don't build on them.
8. **WhatsApp has barred AI assistants as the main product since 2026-01-15** (EU numbers excepted). Telegram is free and AI-friendly, and its share-contact button gives a verified phone number in one tap. Telegram is a cheap later channel; WhatsApp is not.

## 1. What each surface can do

| | iMessage / SMS (Blooio, Twilio) | ChatGPT plugin | Claude connector + skill/plugin | Grok connector | Our X bot | Telegram bot (later) |
|---|---|---|---|---|---|---|
| How someone arrives | Texts our number (with a keyword or not) | Directory listing or a plugin link | Directory, or a prefilled "add custom connector" link | Custom connector by URL (all users) | Mentions or DMs @ourbot | t.me link |
| Login | Already proven: the sending number is the identity | OAuth; our page asks for phone + SMS code | OAuth for the directory; code-in-chat only if unlisted | OAuth (callback `/connectors-oauth-exchange-code`) | X OAuth, then link a phone with an SMS code | Share-contact button gives the phone |
| Reads the user's memory? | n/a | Host shares relevant chats and memories when relevant; no direct read | Model can recall or search past chats when asked; no direct read; tools must not ask for it | Undocumented | n/a | n/a |
| Can it build the profile conversationally? | Yes: our own agent | Yes: onboarding skill plus form (form is desktop and web only) | Yes: the skill guides it; tools do the writes | Yes, with Grok Skills (format undocumented) | Poorly: replies limited, one per interaction | Yes |
| Can it push to the user? | **Yes** (budgets and quiet hours apply) | No. MCP Events (Work chats, new, buggy); shared scheduled tasks (`chatgpt.com/s/task_*`) | No. Only a user-made scheduled task in Cowork | Automations notify by email or app push; calling custom connectors from them is unverified | Only replies after the user engages | Yes, after /start |
| Deeplink back in | n/a (the thread) | `chatgpt.com/?prompt=` (fills only) opens the iOS app; `/plugins/<id>` | `claude.ai/new?q=` opens the iOS app (whether the app keeps the prompt is unverified) | `grok.com/?q=` shows a "Send this message?" confirm; opens the iOS app | x.com DM link | t.me link |
| Ages | All apps; minors never matched | Must suit 13-17; we age-gate ourselves | Directory policy says nothing about dating | Unknown | X is 13+ | 13+ |
| Dating (slop.date) | Yes | Risky in review: use the paste-prompt pattern instead | Not addressed in policy: likely OK for an unlisted connector; directory unclear | Unknown | Avoid | Possible |
| Cost | Blooio per line; SMS per segment | Free | Free | Free | ~$0.010 per reply, ~$0.015 per DM; reads billed | Free |
| Main risk | Apple bans a line (all four apps share it) | Review rejection; no push | Little reach without a directory listing | Small user base | Automation rules; AI replies need X's prior approval | Low reach in the US |

## 2. Identity across surfaces (one person, many doors)

- **The phone number is the person.** Every surface ends in the same `platform.person`, keyed by a verified phone (platform-architecture doc §3).
- **Each surface gets its own key:**
  - a channel binding for iMessage, SMS or Telegram;
  - an OAuth grant for ChatGPT, Claude or Grok, which is issued after the same phone + code step;
  - an agent key for local agents.

  Each records the surface label, the device class if known, and when it was last used.
- **The confirmation text** goes to the member's iMessage thread on every new link: "ChatGPT is now connected to your Network. Reply DISCONNECT to remove it." Keep this; it also tells us their preferred thread.
- **Keyword routing** (from the multi-app decision) applies to the first iMessage. For assistants, the OAuth page carries `app=slop|peon|friends|network` from the link that sent the person there, so the right app's onboarding starts.
- **One account per phone across apps.** Cross-app privacy follows the platform-architecture doc §2.4. A dating profile is never visible to peon.biz.

## 3. Onboarding flows

### 3.1 Joining by iMessage (the main door)

1. **The person texts the line**, for example "slop.date", "join peon.biz" or "hi". The keyword sets the app; with no keyword, the agent asks friends, dating or work.
2. **Consent and age.** The agent sends one message with the terms and privacy links. It asks for date of birth or age range, and records STOP/HELP consent. Under-18s join but are flagged never-matched.
3. **The interview.** A short, voice-friendly conversation tuned to the app's pack (dating: what you're looking for, dealbreakers, a typical weekend; friends: your people, what you like doing; work: role, what you're hiring for or seeking).
   - It stays short because step 4 does most of the work.
4. **"Ask your AI about you" (the best enrichment).** The agent offers:
   > "Want to skip the questions? If you use ChatGPT or Claude, tap one of these. It'll ask your AI to write a summary of you. Paste what it says back here."
   - We send the assistant's own link with a prefilled import prompt: `chatgpt.com/?prompt=…` or `claude.ai/new?q=…`. These open the app on iPhone. On SMS/Android, send our button page.
   - The prompt is fixed, published and short (Section 6.2). It asks for interests, values, what the person wants, their style and logistics. It excludes health information, other people's names, and anything sensitive unless the person adds it themselves.
   - The person pastes the result into iMessage. We extract typed facets with provenance "self-reported via AI summary", then show a short "here's what I got, anything wrong?"
   - We delete the raw paste after the person confirms (data-sources notes, "don't keep raw").
   - **Why this wins:** no OAuth, no review, no plugin, and it works for slop.date with no teen-listing problem. It's the lovegpt.dev pattern without needing the assistant to call us.
5. **Optional extras, ranked by value for the friction and risk.** The agent offers at most two, chosen by app:
   1. **Screenshots** (dating and friends). Spotify Wrapped or top artists, Letterboxd, Strava, an Instagram grid, a LinkedIn profile.
      - We extract the member's own facts only, with no face analysis (Illinois biometric law).
      - We discard the image after extraction.
   2. **LinkedIn** (peon.biz). The person pastes their profile text or sends the PDF/export. Use only profile, positions, education and skills; never the connections file. Never scrape.
   3. **Google Calendar free/busy** (all apps, for scheduling). Lighter Google review, no security assessment (unverified from Google's own pages).
   4. **X via OAuth** (friends, work).
      - Follows, likes and bookmarks are interest signals, at about $1-6 per member as a one-time pull.
      - Never use X data to infer dating or sensitive traits (X's terms).
   5. **YouTube subscriptions and likes.** A strong taste signal; same Google review as Calendar (unverified).
   6. **Discord servers.** Free and instant.
   7. **Large exports** (Instagram, Google Takeout, X archive) go through a signed web upload link, never over iMessage. Low priority.
6. **Choosing where updates go.** At the end of onboarding: "Where should I send you things: right here, or would you rather check in from ChatGPT or Claude?" Use an iMessage poll if Blooio supports it. Store the answer as an explicit preference.
7. **Review by text and on the web.** "What I know about you" is always available: text "what do you know about me?" or open the member web page.

**Not doing:**
- Gmail scopes (policy bans one-off export use, plus a yearly security assessment).
- Instagram, Spotify or Reddit APIs.
- Strava data in the LLM (its terms ban use in AI models).
- Any LinkedIn scraping.
- Logged-in, cookie or fake-account scraping.
- Data brokers (People Data Labs, Clay, Apify, Bright Data).
- Importing contact or follower lists as people.
- Scraping non-members (PRD).

**Scraping a consenting member's own public profile:** their consent covers privacy law but not the platform's terms (LinkedIn sues anyway, and Reddit v. SerpApi opened an anti-circumvention line of attack in July 2026). Prefer screenshots. If we ever do it, only logged-out pages, only for the member's own handle, never LinkedIn, and with legal sign-off.

### 3.2 Coming from an AI assistant without installing anything (the "paste prompt")

This is the same import prompt as step 4, reversed. A landing page on slop.date or ntwrk.love says "Paste this into your AI". It works in any assistant and needs no plugin. The prompt has the assistant write a summary, which ends with:
> "To join, text this to +1 (…) or tap sms:+1…&body=…"

- The `sms:` link opens Messages with the summary and the app keyword prefilled. The person taps Send, and that one tap proves their phone with no code needed.
- **This is the recommended AI-native entry for slop.date launch.** It's shareable ("my AI's read on me"), needs no review, and doesn't depend on any assistant's listing rules.
- **Limits** (unverified): iOS `sms:` body length (keep the summary under about 1,000 characters, or send the full one in a second message), and whether each assistant's mobile app renders the `sms:` link as tappable.

### 3.3 ChatGPT plugin

1. **Install** from the directory or the `chatgpt.com/plugins/<id>` link. ChatGPT's install screen tells the user that relevant chats and memories may be shared.
2. **OAuth:** our page asks for the phone number, texts a code, and the person enters it on our page, never in chat. On success we text the confirmation in the iMessage thread. If the phone is new to us, the page also covers consent, age, and app choice.
3. **The onboarding skill** runs right after install and tells ChatGPT to:
   - offer to draft a profile "from what you already know about me, if you want";
   - otherwise ask the interview questions;
   - show the draft (a form on desktop and web, text on mobile) and get the person's approval;
   - then call `share_profile_with_network` with typed fields only.
4. **Never send:** a city field (ChatGPT sends a coarse location hint instead); sensitive categories unless the person states them; chat transcripts.
5. **Everything after** uses the five-tool surface (PRD 11.2). `get_network_updates` marks inbox items seen (Section 5).
6. **Teen-safe profile.** The listing covers friends, help and work. Dating stays out of the ChatGPT listing until adult mode exists or OpenAI clarifies its policy. An adult member asking about dating in ChatGPT gets: "slop.date runs by text. Here's the link."
7. **Reviewer access:** a test account that logs in without SMS (a fixed test phone with a known code, enabled only for the reviewer client).
8. **Later:** MCP Events, so a subscribed chat receives new items (Section 5.5).

### 3.4 Claude

- **Directory connector:** the same OAuth with phone + SMS code, the same five tools, and the same draft-approve-submit flow.
- **The skill** is optional: it teaches tone and flow, but can't call our API by itself on claude.ai (the sandbox can't reach our domain). It is distributed as a plugin repo URL or zip, or in the directory.
- **Before a listing:** a prefilled "add custom connector" link: `claude.ai/customize/connectors?modal=add-custom-connector&connectorName=The%20Network&connectorUrl=https://mcp.ntwrk.love/mcp`. The person confirms, then OAuth runs.
- **Memory:** Claude can search past chats when the person asks. Our tool descriptions describe the fields and never say "use memory". This keeps us inside §1F.
- **Claude Code and local agents:** code-in-chat with a stored agent key, as in PRD 11.5 (kept for these).

### 3.5 Grok and X

- **Grok:** a custom connector with OAuth, available to all users. Same tools and flow. Grok Skills could carry the onboarding guidance once their format is documented. Deeplink: `grok.com/?q=`.
- **"Grok bot":** there's no third-party hook on @grok. The options are our own X account, or a member's Grok with our connector.
  - **Our X bot:** needs the "Automated" label, a linked human-managed account, and X's prior approval for AI-generated replies. It can only reply after the user engages, at most one reply per interaction, and DM only after the user DMs first.
  - **Recommended use:** distribution only. A reply to "@ourbot what's my vibe" gives a one-line read on their public profile plus a link to join by text. Phone verification still happens by iMessage.
  - Cost is about $0.57 per member if we summarize 100 public posts through the Grok API. Do this only with opt-in, and only after the person proves they own the handle via X OAuth.
  - Never use it for dating inferences.

## 4. Choosing the surface for each update

The preferred surface is resolved per person and per app, in this order:

1. **An explicit choice** ("send my updates to Claude", the onboarding poll, or the web setting).
2. **Otherwise a score per surface:**
   - acting on past notifications from it (weighted most);
   - recent use within 14 days;
   - an active grant or key;
   - minus ignored notifications.
3. **If no surface clearly leads,** plain iMessage with replies working in the thread, plus our button page.
4. **Signals we have:**
   - iMessage vs SMS (Blooio reports the service; iMessage means an Apple device);
   - the label of each OAuth grant;
   - the last surface that called our tools;
   - task-token redemption (Section 5.3).

We can't detect whether an app is installed from a web page. Never guess silently: if a deeplink goes unused twice, fall back to plain iMessage and ask once.

## 5. Notifications: one per event, one inbox

### 5.1 One inbox

- Every event creates one `inbox_item` with a dedupe key `(person, app, event_type, subject_id)`.
- Every surface reads the same inbox:
  - the iMessage agent;
  - `get_network_updates` in ChatGPT, Claude and Grok;
  - the member web page.
- Reading it on any surface marks it seen everywhere.

### 5.2 A scheduler that sends one message per person

- **Grouped per phone, across all four apps.** They share one line and its limits.
- **Limits:** quiet hours 21:00-09:00 local; at most 2 proactive messages a week (PRD 32.9).
- **Urgent items** (a time-sensitive plan, a match waiting for an answer) go out after a short delay. Everything else is held for a digest.
- **Re-check just before sending.** If every item was already seen on another surface, cancel (the cancellation-key pattern in Knock, Novu and Courier).
- **Exactly one message per send,** using Blooio's `Idempotency-Key` as the delivery id. Never one message per surface.

### 5.3 What the notification says

- **iMessage-preferred:** the update itself, in the thread. The reply is the action.
- **Assistant-preferred:** one line of our text, then the assistant's own link with a fill-only prompt and a task token. For example:
  > "You have a new intro from The Network."
  > `chatgpt.com/?prompt=Ask%20The%20Network%20for%20update%20T-7F3K`
- **SMS, or an unknown preference:** our branded page `ntwrk.love/t/<token>`, with a button per assistant plus "reply here". Tapping a button does open the app. Never use bit.ly-style public shorteners (carriers filter them); use our own domain.
- **Rules for the prompt in the link:**
  - Keep it under about 80 characters, and the URL under 160 (one SMS segment).
  - No names, no match details, no app brand for dating (use "The Network").
  - Never put a link in the same message as a login code.
  - Never rely on auto-send.

### 5.4 Task tokens

- **What they are:** short and random, bound to one person and one inbox item, and they expire after 7 days. **They are references, not credentials.**
- **How they work:** access always comes from the assistant's OAuth grant. A token presented by the wrong person gets a generic "no update". A token only chooses what to show and never takes an action.
- **What we learn when one is redeemed:**
  - which surface the person used;
  - that the deeplink worked;
  - that the item was seen.

  This feeds the score in Section 4.

### 5.5 Hooks inside the assistants (pilot later)

- **ChatGPT MCP Events:** our server sends signed webhooks into a chat the person subscribed. Today this is limited to Work chats and "dots", and a bug was reported on 2026-09-30.
- **ChatGPT shared scheduled tasks** (`chatgpt.com/s/task_*`): a "check The Network every morning" task the person adds with one tap. Whether a task can call our plugin is unverified.
- **Claude Cowork scheduled tasks** (Pro/Max, set up by the person).
- **Grok Automations** (all plans; can notify by email or app push). Whether they can call a custom connector is unverified.

All four are additions on top of iMessage, never replacements. When one delivers an item, the inbox marks it seen and the scheduler cancels the text.

## 6. Proposed copy

### 6.1 iMessage offer

> Want to skip the questions? Tap one. It'll ask your AI to describe you. Paste what it writes back here and I'll show you what I took from it before I save anything.
> ChatGPT: chatgpt.com/?prompt=…
> Claude: claude.ai/new?q=…

### 6.2 Import prompt (draft; keep under about 600 characters URL-encoded)

> Write a short profile of me for The Network, a service that introduces people. Use only what you know from our past chats. Include: interests, what I do, values, what kind of people I enjoy, how I like to spend free time, and what I'm looking for. Don't include health details, other people's names, or anything about sexuality, religion or politics unless I said I want it shared. Keep it under 200 words, in plain sentences, and end with: "I approve sharing this with The Network."

The last line is the consent marker: we accept a paste only if it is present and the person confirms in the thread.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Apple bans the shared Blooio line, cutting all four apps | Warm spare line; Twilio 10DLC fallback; RCS for Business later; stay well inside rate limits; no cold outbound |
| The import prompt pulls in sensitive data anyway | Extract into typed facets with a sensitive-category filter; show the person before saving; delete the raw paste |
| Someone pastes another person's AI summary | Low harm (it's their own account), but confirm "is this you?"; reliability signals catch fakes later |
| Prompt injection through a pasted summary or screenshot | Treat it as data, extract with a fixed schema, and never let pasted text trigger actions |
| Deeplink behaviour changes | Half a day of device testing before launch, plus a monthly check; button-page fallback |
| ChatGPT or Claude review rejects the listing | The paste-prompt and iMessage flows don't depend on any listing |
| X automation rules | Use the bot for distribution only; get approval before AI replies |
| Sherlock risk (OpenAI builds matchmaking) | Low near-term (16 forum requests, tiny engagement, no announcement). Our moat is the human graph and the iMessage relationship, not the connector |

## 8. Demand signal

- The OpenAI forum has 16 requests for opt-in AI matchmaking. Thirteen were posted between May and September 2026, with about 1,040 views in total.
- What they ask for, again and again: opt-in, mutual consent, no exposure of chats, and "introduce, don't decide". Named segments are marriage-minded people over 35, faith-based daters, and people who hate dating apps.
- Staff replies are form responses.
- It's a weak volume signal, but the asks match slop.date's design exactly. The users who wrote them are a ready audience for the paste-prompt launch.

## 9. Decisions (resolved 2026-10-08)

| # | Decision | Resolution |
|---|---|---|
| 1 | PRD 11.5 | **Adopted.** Listed hosted assistants (ChatGPT, Claude directory, Grok) use OAuth 2.1, and our sign-in page asks for the phone number and SMS code. Code-in-chat stays only for local agents and unlisted custom connectors. PRD 11.5 and the decision log are updated |
| 2 | Dating and the ChatGPT listing | **Adopted.** The ChatGPT plugin is The Network (friends, help, work) with a teen-safe profile. slop.date's AI entry is the paste prompt plus iMessage (3.2) |
| 3 | Enrichment sources | **Adopted** as ranked in 3.1. No Gmail scopes. No scraping of any kind without legal sign-off, and never LinkedIn or non-members |
| 4 | Single inbox and scheduler | **Built and wired** as `packages/notify` (branch `platform/notify`): Postgres store and schema, outbound-queue sink and suppression, `update_token` on `get_network_updates`, and a `GET_UPDATES` plugin action. The platform migration, gateway hook and cron remain for the platform owner (see the package README) |
| 5 | Device test day | **Started.** Desktop web column filled in. The phone columns need real devices: `docs/runbook-deeplink-test.md` |
| 6 | X bot | **Not in MVP.** Revisit after launch as distribution only (3.5). Phone verification always happens by iMessage |
| 7 | Channels | **Telegram** is the first channel added after launch. **WhatsApp is out** while its AI-assistant ban stands |
