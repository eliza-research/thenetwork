# ChatGPT: delta research for The Network (friends.help / slop.date / peon.biz)

Research date: 2026-10-07/08. Baseline docs read first:
- `~/thenetwork/docs/research/connectors/chatgpt.md` (2026-10-05)
- `~/thenetwork/docs/research/connectors-and-loveofyourlife.md` Sec 2.2
- PRD 11.5 in `~/thenetwork/docs/prd-snapshot.md`

This file covers only what is new, changed, or answers the six questions. Source tags [S#] map to Section 9. Confidence: **H** = read on an official OpenAI page or tested directly. **M** = official but indirect, or several consistent secondary sources. **L** = a single secondary source or inference.

How I read sources: official developer docs via WebFetch and `llms-full.txt`. help.openai.com and openai.com block WebFetch (403), so I read them in a real browser pane. I tested the deeplinks in that browser while **logged out**.

---

## 0. Headlines (what changes our plan)

1. **The PRD 11.5 phone-code-in-chat flow breaks the published plugin guidelines** (H). The guidelines list "Access credentials and authentication secrets (such as API keys, MFA/OTP codes, or passwords)" as Restricted Data. Plugins must "not collect, solicit, or process" it [S1].
   - The tool docs add that elicitation must not "collect secrets or bypass normal authentication" [S2]. Tool results must not contain "secrets, access tokens" [S2]. A `verify_phone_code` that returns an agent key violates that.
   - ChatGPT "cannot present custom API keys" [S3]. The key would therefore have to travel as a model-visible tool argument.
   - **Conclusion:** a public Plugin Directory listing needs OAuth 2.1. Our authorization server's login page can still be phone + SMS code, which PRD 11.5's last bullet already allows. Reviewers additionally need a no-OTP demo login.
   - The chat-based flow can only run in unlisted or developer-mode use, which today means Business/Enterprise/Edu web (Pro is read-only). That makes it effectively unusable for consumers in ChatGPT.
2. **Re-engagement got real on 2026-09-29 (DevDay)** (H/M). **MCP Events** let a plugin push signed webhooks into a subscribed ChatGPT chat or task. The user must ask ChatGPT to subscribe [S4, S5].
   - The docs say Events run in **Work chats (web, desktop Cloud) and dots**. The DevDay recap says "Available to all plans."
   - An open bug (2026-09-30) reports that subscriptions don't appear even when events are discovered [S6].
   - Separately, **scheduled tasks** can carry push or email notifications and can be **shared by link** (`chatgpt.com/s/task_*`). That gives us a cheap "check The Network every morning" re-entry path [S7].
3. **Memory: the documented behavior matches our hope** (H). Apps can't read memory or history directly. But OpenAI's own help page and install sheet say that when an app is used, "ChatGPT may share relevant chats and memories with this app" [S8, S9]. So "build my profile from what you know about me" is a sanctioned pattern, as long as the tool schema stays narrow (no transcript or "just in case" fields) [S1].
4. **Custom GPTs are being retired** (H). Retirement is 2026-12-11, and Enterprise creation ends 2026-10-26. Custom Actions don't migrate [S10]. Scheduled tasks don't support GPTs [S7]. **Don't build on GPTs.**
5. **Deeplinks were verified** (H). On the web, `chatgpt.com/?q=` auto-sends and `?prompt=` only prefills. On iOS, `/?q=`, `/?prompt=`, `/?hints=`, `/plugins/*`, `/g/*` and `/s/task_*` are universal links into the ChatGPT app [S11, test].
6. **Dating/matchmaking:** no explicit ban, but no precedent either (H). No dating plugins appear in the directory, and the 13–17 "general audiences" rule is unchanged [S1, test].
   - Usage policies prohibit profiling or inferring sensitive attributes "without their authorization" and "automation of high-stakes decisions… employment… without human review" [S12]. That second clause matters for peon.biz.
   - Adult mode is reported paused indefinitely (M), so the "18+ later" carve-out isn't coming soon.
7. **Demand signal:** 16 forum threads requested opt-in AI matchmaking, 13 of them between May and Sep 2026. Engagement is tiny: about 1,040 total views and 0–2 likes each. Staff replies are canned ("we'll pass it along… no timeline") [S13].
   - I found no OpenAI matchmaking announcement or rumor.
   - **The Sherlock risk is low-to-medium.** OpenAI retired group chats on 2026-07-09 [S14], but it keeps signaling collaboration and social features (DM code in 2025, "Shareable profiles" for creations, Teams).

---

## 1. Plugins, directory review, and policies for dating/people apps

### 1.1 New since the 2026-10-05 doc
| Item | Detail | Conf | Src |
|---|---|---|---|
| Plugin extensions (DevDay 2026-09-29) | Sidebar apps (global entrypoint), conversation panels, **structured plugin settings** (native settings UI on the plugin page, backed by `readTool`/`updateTool`), display modes, **deep links into sidebar apps**, model-app context, composer @-mentions (desktop only), **rich forms** (OpenAI form elicitation; desktop + Work web only, not iOS/Android), **plugin onboarding skill** | H | [S2, S15, S5] |
| Extensions platform scope | The spec says "Web refers to the Work browser; **classic ChatGPT is excluded**." Many extensions are Work-first. | H | [S15] |
| Onboarding skill | `extensions.com.openai.onboardingSkill: "./skills/setup/SKILL.md"`. Setup runs it in a new conversation, or in the current one if the user installed mid-conversation. **This is the native home for our profile-interview flow.** | H | [S2] |
| Directory placement | "Plugins appear on the directory's main pages only if OpenAI selects them for enhanced distribution." Strong utility "may be eligible for… directory placement or **proactive suggestions**." | H | [S2] |
| Screenshots | "Screenshots are no longer shown in the Directory." Supply example prompts instead. *The existing doc lists screenshots as optional assets, which is now moot.* | H | [S1] |
| Install disclosure (shown to users) | "When connected to [app], ChatGPT may share relevant chats and memories with this app… If you have Memory enabled, data from the app may be used to proactively provide helpful information or suggestions." | H | [S9] |
| Request `_meta` from ChatGPT | `openai/subject` (anonymized stable user id "for rate limiting and identification"), `openai/session`, `openai/locale`, `openai/userLocation` (coarse city/region/country/tz/lat/long), `openai/userAgent` | H | [S2] |
| "Sign in with ChatGPT" | DevDay: "sign in to a range of tools with your ChatGPT account to connect plugins faster." Identity is global. **Not investigated further.** It could serve as an optional IdP, but it doesn't give a phone number. | M | [S5] |
| ChatGPT has Chat and Work tabs | Quickstart has developers test in "Work". Work rolled out by plan around DevDay. | M | [S2, S16] |

### 1.2 Dating, matchmaking and people-search policy
- **No explicit rule on dating or matchmaking** in the plugin guidelines or the usage policies (effective 2025-10-29) (H) [S1, S12]. The prohibited-goods list covers "Adult content & sexual services" (pornography, live-cam, adult subscriptions, sex products), not dating.
- **Teens** (H) [S1]: "Plugins must be suitable for general audiences, including users aged 13–17… Support for mature (18+) experiences will arrive once appropriate age verification and controls are in place." Accounts identified as under 18 automatically get "ChatGPT for Teens" [S17]. **Apps receive no age signal** in `_meta` (H; none listed in [S2]). Our own server must age-gate, which our phone/invite/age flow already does.
  - A slop.date listing visible to 13–17-year-olds is the main review risk.
  - On adult mode: FT/TechCrunch-level reporting says it was "paused indefinitely" (around 2026-03); a Sept 2026 explainer shows no change (M) [S18]. Don't wait for the 18+ carve-out.
- **Usage policies, privacy section** (H) [S12]. The policy disallows attempts to "aggregate, monitor, profile, or distribute individuals' private or sensitive information without their authorization." It also bans "evaluation or classification of individuals based on their social behavior, personal traits… (including social scoring, profiling, or inferring sensitive attributes)."
  - Opt-in, self-authorized matching is the defensible reading. Ranking strangers by inferred traits isn't.
  - **Don't let the ChatGPT surface infer sensitive attributes** (orientation, religion, health) from memory. Ask the user for them explicitly.
- **Hiring (peon.biz)** (H) [S12]: usage policies bar "automation of high-stakes decisions in sensitive areas without human review: … employment." Hiring matches must stay recommendations, with a human deciding. Many hiring plugins are listed (Ashby, Dover, Workable…), so the category is accepted.
- **Plugin data rules** (H) [S1]:
  - "Collection minimization… Avoid 'just in case' fields or broad profile data."
  - **Regulated Sensitive Data**: allowed only if "strictly necessary," with "legally adequate consent," and "explicitly and prominently disclosed at or before the point of collection." A dating profile with orientation or religion needs exactly that disclosure.
  - **Behavioral profiling** (including metadata such as timestamps, IPs and query patterns) is barred "unless explicitly disclosed, narrowly scoped, subject to meaningful user control."
- **Correction to the existing doc (R3, location).** The guidelines say "Avoid requesting raw location fields (for example, **city** or coordinates) in your input schema." Location should come from the client side channel (`openai/userLocation`) [S1, S2]. The existing doc says "City or neighborhood only" is fine as input, which is partly wrong.
  - A home city that the user states as a profile attribute is arguably task data. It still carries risk, so prefer the side-channel hint plus a user confirmation.
- **Directory precedent (tested 2026-10-07, logged out, US)** (H):
  - No results for `dating`, `romance`, `introductions`, `meet people`.
  - `relationship` → Super Carl, Levitate, Rings AI, SigParser, Village (all relationship CRMs), and "Astera Bond – Analyze relationship episodes".
  - `love` → two tarot apps ("Love Match"), so romantic-themed *entertainment* exists.
  - `friends` → trip planning and games.
  - `match` → many marketplace matchers (tutors, crew, realtors, events).
  - **Framing as "introductions / matching for friends, work, events" has precedent. "Dating" has none.**

### 1.3 Developer mode (resolves open item 1 in the existing doc) (H) [S19]
- Full MCP (write) and developer mode: **Business and Enterprise/Edu, web only**. "Are MCP apps available on mobile? **No – web only.**"
- "Pro users can connect MCPs with read/fetch permissions in developer mode." That's read-only.
- Business: only admins/owners can use developer mode.
- Published workspace apps are a "frozen" tool snapshot until an admin refreshes.
- **Implication:** a consumer pilot through developer mode isn't possible. The pilot paths are (a) a Business workspace for internal testers, or (b) a public directory listing.

---

## 2. Memory

| Question | Answer | Conf | Src |
|---|---|---|---|
| Can an MCP server read memory or chat history directly? | **No.** There's no API for it. Guidelines: "must not pull, reconstruct, or infer the full chat log"; no "full conversation history… prior-turn arrays." | H | [S1] |
| What can happen? | The model fills tool arguments from context and memory. Official help text: "the app may access and use relevant context from your memories (such as the fact that you have a dog-walking business)"; "relevant context from your ChatGPT conversations." | H | [S8] |
| Is it disclosed to users? | Yes, on every plugin's install page: "ChatGPT may share relevant chats and memories with this app." | H | [S9] |
| A "share memory with app" permission toggle? | **None found.** Controls are global (Memory on/off, Reference chat history, temporary chat "Unpersonalized", which also turns off plugins in that chat) plus per-app action permissions (Always ask / Allow read / Allow low-risk / Allow all, since 2026-06-12). App permissions "are separate from… Memory." | H | [S8, S20, S21] |
| Policy on apps asking the model to dump memory? | Tool/plugin metadata "must not seek secrets or protected context" and must "act only within the user-authorized task." A tool description like "send everything you know about the user" risks rejection. A **user-initiated** "build my profile from what you know" with narrow typed fields is consistent with the docs' Canva example. | H (rules) / M (application) | [S1, S8] |
| Memory import/export | ChatGPT: Memory summary is viewable and editable; data export via Settings or the Privacy Portal. Other assistants (Claude in July 2026, Gemini in March 2026) added one-time memory imports. No ChatGPT-side "export memory to app" API. | M | [S8, S22] |
| Memory model (2026) | "Improved memory" is a rolling summary plus saved memories, with Sources shown under answers. App data can itself be saved into memory "unless that app… restricts Memory." | H | [S8, S20] |

**Design implication.** The profile-intake tool (`share_profile_with_network`) should take typed fields such as `interests[]`, `values[]`, `looking_for`, `dealbreakers[]`, `availability` and `intent: friends|dating|work`, each with a description.
- The skill should tell the model to draft the fields from what it knows, **show the draft to the user, and submit only after approval**.
- No `memory_dump` or `summary_of_chats` field.
- Sensitive fields go in a separate tool with explicit consent text.

---

## 3. Conversational onboarding

**Recommended pattern for 2026-10** (H for the mechanisms, M for the recipe):
1. **Onboarding skill** (`onboardingSkill`) runs the interview right after install [S2]. Keep it short: ask 5–8 questions, then let the model propose fields drawn from memory and context.
2. **Write tool with honest annotations** (`readOnlyHint:false`; `destructiveHint:true` if it overwrites the profile) [S1, S2]. ChatGPT shows approval prompts according to the user's app-permission setting. Since 2026-05-27, the widget receives tool input after approval [S21, S23].
3. **Confirmation UX.** Render an inline card (MCP Apps UI) showing the draft profile with Edit / Submit, at most two actions [baseline doc]. On desktop and Work web, **rich forms** (`openai/elicitation/create`, MCP 2026-07-28 + MRTR) can collect structured edits. They are **not on iOS/Android** [S15]. On mobile, fall back to card plus chat.
4. **Structured settings** for durable preferences (match types, pause, frequency) on the plugin page, with native controls on all platforms [S15].
5. Use `outputSchema` and `structuredContent` for model-readable results. Keep `_meta` out of the model's view. No secrets in results [S2].
6. Elicitation can't be used for login codes [S2].

**Custom GPTs with Actions: no longer viable** (H) [S10]:
- Scheduled retirement on **2026-12-11** (Enterprise deferral to 2027-02-11). Enterprise creation ends **2026-10-26** (planned). Secondary sources say personal accounts can no longer create new GPTs (M).
- "GPT custom actions do not transfer through the migration workflow."
- Scheduled tasks "do not support… GPTs" [S7].

**Share links that land a user in the app:**
- **Plugin page:** `https://chatgpt.com/plugins/<plugin_id>`. It shows Install and the example prompts. Tested logged out with LinkedIn's `plugin_asdk_app_69949aa…`. OpenAI's own docs append `?open_in_app` [S2]. iOS universal link: `/plugins/*` [S11].
- **Deep link into a plugin's sidebar app:** `https://chatgpt.com/plugins/<plugin-id>/app/<tool-name>?path=<encoded>`, or `chatgpt://plugins/<pluginId>/app/<tool>?path=…` on mobile. Supported on desktop, web and iOS; **not Android** [S15]. Requires a sidebar (global) entrypoint.
- **Personal (unlisted) plugins** can be shared only inside Business/Enterprise workspaces. A migrated or personal plugin "starts private. Making it public requires a separate plugin submission process" [S10, S24]. **No public unlisted-link distribution exists for consumers.**
- **GPT links** `chatgpt.com/g/g-…` still resolve and are iOS universal links [S11], but they die on 2026-12-11.

---

## 4. Proactive re-engagement and deeplinks

### 4.1 What can reach the user without them opening ChatGPT
| Mechanism | Can our plugin trigger it? | Notes | Conf | Src |
|---|---|---|---|---|
| **MCP Events** (new 2026-09-29) | **Yes, after the user subscribes.** "The user tells ChatGPT what to monitor and how to respond." Our server implements `events/list`, `events/subscribe`, `events/unsubscribe` (MCP 2.0, protocol `2026-07-28`), then POSTs signed Standard Webhooks to ChatGPT's callback. ChatGPT "receives the event in the subscribed chat and follows the user's instructions." | Surfaces per docs: Work chats (web, desktop Cloud) and dots. The recap says "all plans." **The docs don't say whether a push notification fires.** Body ≤256 KiB. Events can arrive out of order or more than once. One open bug: discovered events but no subscribe action (2026-09-30). | H (spec) / L (consumer reach) | [S4, S5, S6] |
| **Scheduled tasks** | Indirectly. The user (or our shared task link) creates "Every morning, check The Network for new introductions." Tasks "can use supported apps," and notifications go by **push and/or email**. | Limits: Free/Go 3 active (≤1/day, flexible windows); Plus 5; Pro 15; hourly needs a paid plan. **Shareable task links** (`chatgpt.com/s/task_*`, iOS universal link) include title, instructions and schedule but no creator data. Whether third-party plugins (vs Gmail/Slack/GitHub) work inside tasks: "supported apps" (unverified for ours). | H (feature) / M (our plugin) | [S7, S11] |
| Event-triggered tasks | No. Only Gmail, Slack and GitHub, in Work, on Plus+ | Not usable for us | H | [S7] |
| Pulse | No public developer API. I found no 2026 help article (searching "pulse" on help.openai.com returned nothing). Launch-era Pulse used only Gmail/Calendar. | Treat as unavailable | M | [S25] |
| Dots | Pro/Business Premium/Enterprise agents that "reach out." Can use plugins. | Niche audience | M | [S26] |
| "Proactive suggestions" of plugins | OpenAI-controlled, for high-quality plugins | Not controllable | H | [S2] |
| Push API for apps | **None.** | — | H | [S2] |

**Implication:** SMS/iMessage stays our primary push channel. In ChatGPT the best re-entry is (1) an SMS from us containing a ChatGPT deeplink, (2) an opt-in shared scheduled task, and (3) MCP Events for Work and dots users.

### 4.2 Deeplink formats (tested 2026-10-07, web, logged out)
| URL | Behavior (web) | iOS universal link? | Conf |
|---|---|---|---|
| `https://chatgpt.com/?q=<urlencoded>` | **Auto-sends** the prompt. The first attempt on a cold session landed on a blank home; the retry sent immediately and opened `/uc/<id>`. | Yes (`"/" ? q=?*`) | H |
| `https://chatgpt.com/?prompt=<urlencoded>` | **Prefills the composer, doesn't send** | Yes (`? prompt=?*`) | H |
| `&hints=search` (also seen: `hints=research`) | Selects a tool mode (community-documented). I didn't test it. | Yes (`? hints=?*`) | M |
| `?mode=…` | Not tested | Yes (`? mode=?*`) | M |
| `&temporary-chat=true` | Community-reported. Not tested. | — | L |
| `https://chatgpt.com/plugins/<id>` | Plugin detail page with Install button and example prompts | Yes (`/plugins/*`) | H |
| `https://chatgpt.com/plugins/<id>/app/<tool>?path=…` | Opens the sidebar app at a page | iOS yes; Android **not supported** per spec | H |
| `https://chatgpt.com/#settings/Connectors?connector=<id>` | Connector settings | Yes | H (AASA) |
| `https://chatgpt.com/g/<gpt-id>` | GPT page (retiring) | Yes | H |
| `https://chatgpt.com/s/task_*` | Shared scheduled task | Yes | H |
| `https://chatgpt.com/s/p_*` | "Shared prompt permalinks" (secondary report: a "Share prompt" feature loads a prompt into the composer) | Yes | M |
| Escape hatch | `?no_universal_links=1` or `#no_universal_links` forces the browser | — | H |

- **Android:** `assetlinks.json` grants `handle_all_urls` to `com.openai.chatgpt`. Actual path coverage depends on the app manifest, which I didn't verify, so Android behavior is unknown. The spec says plugin deep links aren't supported on Android.
- **Auto-send when logged in, on iOS/Android:** not verified. This browser profile is logged out.
- Encoding an `@PluginName` mention in `?q=` to force-invoke our plugin is **unverified**. It's plausible because users @-mention plugins.
- **Recommended SMS re-entry link:** `https://chatgpt.com/?prompt=<"@The Network show my new introductions">`. Use prefill, not auto-send, so the user stays in control. Test on a logged-in iPhone and Android before relying on it.

---

## 5. Forum demand and Sherlock risk

### 5.1 The six requested threads (all in the Feature requests category) [S13]
| Thread | Created | Views/likes | Gist | OpenAI reply |
|---|---|---|---|---|
| 1395161 "ChatGPT Dating: …Useless Data" | 2026-09-06 | 96/0 | Use years of chat data, with explicit consent, for a private compatibility profile. Users never see each other's chats. ChatGPT says "you have a 91% compatibility…" | none |
| 1390372 "Husband Acquisition Algorithm™" | 2026-08-14 | 89/0 | Marriage-minded 35+ users and Christians. Compatibility on values, faith, conflict style. | OpenAI_Support 2026-09-08: will "pass along… opt-in matchmaking… privacy and mutual-consent controls. We don't have a rollout or beta timeline" |
| 1398968 "Opt-In… Conversational Compatibility" | 2026-09-18 | 37/0 | For people who hate apps and bars. Learn through conversation, ask about gaps. "I would not want ChatGPT silently analyzing private conversations." | none |
| 1395249 "Matchmaker That Knows the Person" | 2026-09-06 | 28/0 | Two-sided matchmaker. Photos optional. Intro only with mutual consent. | none |
| 1391630 "Matchmaking with Emotional Intelligence" | 2026-08-21 | 68/1 | Separates prefers / important / indispensable / compromisable / offers | OpenAI_Support 2026-09-08: canned "pass along… no timeline" |
| 1392099 "Opt-In AI Matchmaker for ChatGPT" | 2026-08-23 | 63/0 | "I found someone I think you might genuinely enjoy meeting. Would you like to know more?" | OpenAI_Support 2026-09-08: "pass it to the product team… no timeline" |

Wider search (forum search API, titles containing "matchmak*"/"dating"): **16 threads** in total. 13 date from 2026-05-13 to 2026-09-18, with a burst in Aug–Sep 2026. Others: 1397298 (goal matchmaking), 1396199, 1396232, 1394237, 1392331, 1395245, 1390055, 1380789, plus 1369506 (2025-12) and 1064470 (2024-12). Total about 1,040 views, at most 2 likes each, almost no third-party replies. Staff replies are uniform templates (2026-08-12, 2026-09-08, 2026-09-10).

**Demand signals:**
- Users want the matchmaker to use the context the assistant *already has*.
- Strong recurring requirements: opt-in, mutual consent, no exposure of chats, "introduce, don't decide," deep-compatibility dimensions (values, communication and conflict style, family plans), and asking rather than silently inferring.
- Segments named: 35+ marriage-minded, faith-based, people who hate dating apps.
- **Breadth is real but intensity is low.** These are mostly one-off posts, and some may be AI-written.

### 5.2 Is OpenAI building this? (Sherlock risk)
- **No announcement or credible rumor of OpenAI matchmaking or dating** found (searched 2026-10-07) (M).
- Related moves:
  - Group chats piloted 2025-11 and **retired from 2026-07-09** [S14] (H).
  - DM and user-profile code was found in the Android beta in late 2025 (M, secondary).
  - A secondary source claims a "DM-style Messages tab" accompanied the retirement (L, unverified).
  - DevDay 2026 "Shareable profiles" showcase *creations* (Sites, plugins), not people [S5] (H).
  - Teams and Spaces are work collaboration.
- OpenAI's stated direction is "collaborative," and it has the data moat (memory). **Risk: low near-term, medium long-term.** The safety and teen posture plus the adult-mode pause make OpenAI-run romantic matching unlikely soon. Friends and professional intros are the more plausible overlap.

---

## 6. Phone-code-in-chat auth vs app review

| Question | Finding | Conf | Src |
|---|---|---|---|
| Does review accept phone number + SMS code typed into chat? | **No, in practice.** OTP codes are listed Restricted Data that plugins must not "collect, solicit, or process." Elicitation must not "collect secrets or bypass normal authentication." | H | [S1, S2] |
| Phone numbers themselves | Not restricted. They're ordinary personal data under the minimization and privacy-policy rules. | H | [S1] |
| Returning the agent key in a tool result | Violates "Do not put secrets, access tokens… in tool results." | H | [S2] |
| Sending the key in an Authorization header | ChatGPT can't: it can't "present custom API keys." Only OAuth tokens. | H | [S3] |
| Auth requirement for review | "If your MCP server requires authentication, the flow must be transparent and explicit." Supported: OAuth 2.1 (CIMD/DCR, PKCE) or noauth. Reviewers need a demo account working "without MFA, email codes, or magic links." | H | [S1, baseline] |
| Custom MCP / dev mode | Auth options: OAuth, none, mixed. A noauth server could run our in-chat OTP flow privately, but only for Business/Enterprise/Edu (writes) or Pro (read-only), on web only. That still breaks the spirit of the restricted-data rule. | H | [S19, S27] |

**Recommendation.** For ChatGPT, keep PRD 11.5's fallback as the primary path. OAuth 2.1 authorization server; its login page asks for the phone number and SMS code (the code is typed on *our* page, never in chat); it issues a token bound to the member (our "agent key" equivalent). Add a reviewer password login.

Optional idea (M): ChatGPT sends a stable anonymized `openai/subject` on every call [S2]. Combined with mTLS proof that the call came from ChatGPT, that could bind sessions server-side. Treat it as a hint, not as auth.

**PRD 11.5 text to fix:** "Phone verification works in every host" doesn't hold for public ChatGPT plugins. Also, "Session keys in chat assistants… keeps the key in the conversation" would put a secret in model context, which conflicts with the rules above.

---

## 7. Where existing docs are wrong or outdated

1. **connectors/chatgpt.md R3, and Sec 3.3 location fields:** the guidelines say to avoid raw `city` in input schemas and use `openai/userLocation` [S1, S2].
2. **connectors/chatgpt.md Sec 5.3:** "Optional… screenshots" are no longer shown in the directory [S1].
3. **connectors/chatgpt.md Sec 7.4 / open item 1:** resolved. Developer mode with write is Business/Enterprise/Edu, web only. Pro is read-only. **No mobile** [S19].
4. **connectors/chatgpt.md "Recommendation: pilot through developer mode":** only workspace members can use it, not consumers.
5. **The baseline is missing:** MCP Events, plugin extensions (onboarding skill, settings, deep links, rich forms), scheduled-task sharing, GPT retirement, the `openai/subject` meta field, the install-page memory disclosure, and "main pages only if selected."
6. **PRD 11.5:** in-chat OTP plus a key in conversation isn't acceptable for a listed ChatGPT plugin (Sec 6).
7. **connectors-and-loveofyourlife.md Sec 2.2:** "EEA/UK/CH availability has been limited [possibly outdated]." The developer-mode FAQ says "Are there geo restrictions? No" [S19]. Consumer plugin regional availability is still unverified, and dots exclude EEA/UK/CH [S26].

## 8. Could not verify
- Whether `?q=` auto-sends for logged-in users and in the iOS/Android apps, and whether `@Plugin` in `?q=` invokes the plugin.
- Android app-link path coverage.
- Whether MCP Events deliveries trigger a push notification, and whether they work in classic Chat on Plus/Free.
- Whether scheduled tasks can call third-party directory plugins (vs Gmail/Slack/GitHub).
- Whether reviewers have rejected dating plugins (no reports found).
- Pulse's status in 2026.
- The Messages/DM tab.
- The usage-policy text on teens' access to third-party plugins.

## 9. Sources (accessed 2026-10-07 unless noted)
| Tag | Source | URL | Date info |
|---|---|---|---|
| S1 | Plugin guidelines | https://developers.openai.com/plugins/plugin-guidelines (also in llms-full.txt) | undated; fetched 2026-10-07 |
| S2 | Plugins docs, combined | https://developers.openai.com/plugins/llms-full.txt (mcp-server, auth, reference, plugins/onboarding, submission) | fetched 2026-10-07 |
| S3 | Authentication | https://developers.openai.com/plugins/build/auth | fetched 2026-10-07 |
| S4 | MCP Events | https://developers.openai.com/plugins/build/mcp-events | DevDay 2026-09-29 |
| S5 | DevDay 2026 recap | https://openai.com/index/devday-2026-recap/ | 2026-09-29 |
| S6 | openai/codex issue #49665 | https://github.com/openai/codex/issues/49665 | opened 2026-09-30, open |
| S7 | Scheduled tasks in ChatGPT | https://help.openai.com/en/articles/10291617-scheduled-tasks-in-chatgpt | "Updated 6 days ago" (~2026-10-01) |
| S8 | Connected apps in ChatGPT (FAQ "What does ChatGPT share with apps?") | https://help.openai.com/en/articles/11487775-connected-apps-in-chatgpt | "Updated 2 days ago" (~2026-10-05) |
| S9 | LinkedIn plugin page (install disclosure) | https://chatgpt.com/plugins/plugin_asdk_app_69949aa62bf48191be5e57a01202beca | viewed 2026-10-07 |
| S10 | Custom GPT retirement and migration FAQ | https://help.openai.com/en/articles/20001519-custom-gpt-retirement-and-migration-faq | "Updated 4 days ago" (~2026-10-03); secondary: https://virtualizationreview.com/articles/2026/09/28/openai-to-retire-custom-gpts-replace-them-with-plugins.aspx |
| S11 | ChatGPT apple-app-site-association | https://chatgpt.com/.well-known/apple-app-site-association ; https://chatgpt.com/.well-known/assetlinks.json | fetched 2026-10-07 |
| S12 | OpenAI Usage Policies | https://openai.com/policies/usage-policies/ | effective 2025-10-29 |
| S13 | OpenAI Developer Community threads (JSON API) | https://community.openai.com/t/{1395161,1390372,1398968,1395249,1391630,1392099,1397298,1396199,1396232,1394237,1392331,1395245,1390055,1380789,1369506,1064470} | 2024-12 … 2026-09 |
| S14 | Retiring group chats in ChatGPT | https://help.openai.com/en/articles/12703475-retiring-group-chats-in-chatgpt | wind-down 2026-07-09 |
| S15 | OpenAI MCP Extensions spec | https://github.com/openai/mcp-extensions/blob/main/docs/spec.md | "DevDay launch" |
| S16 | DevDay coverage (Work rollout) *(secondary)* | https://horadecodar.com.br/plugins-chatgpt-work/ ; https://go9x.com/blog/what-is-chatgpt-work | 2026-09/10 |
| S17 | ChatGPT for Teens | https://help.openai.com/en/articles/20001421-chatgpt-for-teens ; https://openai.com/index/teens-learn-and-plan/ | 2026-10-07 |
| S18 | Adult mode paused *(secondary)* | https://techbriefly.com/2026/03/27/openai-pauses-chatgpt-erotic-mode-plans-indefinitely/ ; https://justainews.com/blog/adult-mode-in-chatgpt-explained-nsfw-erotica-porn-policy/ | 2026-03-27; Sept 2026 |
| S19 | Developer mode and MCP apps in ChatGPT | https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt | "Updated yesterday" (~2026-10-06) |
| S20 | Memory in ChatGPT | https://help.openai.com/en/articles/8590148-memory-in-chatgpt | "Updated 18 days ago" (~2026-09-19) |
| S21 | Plugins changelog | https://developers.openai.com/plugins/changelog | 2026-06-12 app permission controls; 2026-05-27 tool-input-after-approval |
| S22 | Memory imports across assistants *(secondary)* | https://blog.memoryplugin.com/sync-memory-across-chatgpt-claude-gemini-perplexity-grok/ | 2026 |
| S23 | Plugins in ChatGPT | https://help.openai.com/en/articles/20001256-plugins-in-chatgpt | "Updated 2 days ago" |
| S24 | Share and publish workspace plugins (same article as S23) | as S23 | — |
| S25 | Pulse launch *(official 2025)* | https://openai.com/index/introducing-chatgpt-pulse/ | 2025-09-25 |
| S26 | Dots | https://learn.chatgpt.com/docs/dots | 2026-09/10 |
| S27 | Add custom MCP server | https://developers.openai.com/api/docs/guides/custom-mcp-server | fetched 2026-10-07 |
| S28 | Deeplink community references *(secondary)* | https://community.openai.com/t/query-parameters-in-chatgpt/1027747 ; https://trevorfox.com/2025/11/chatgpt-hints-and-modes-exploring-the-growth-opportunities-behind-them/ | 2024–2025 |
| S29 | Social/DM signals *(secondary)* | https://www.androidauthority.com/chatgpt-dm-group-chat-android-3607646/ ; https://cryptobriefing.com/openai-retires-chatgpt-group-chats-messages-tab/ | 2025-10; 2026-07 |
