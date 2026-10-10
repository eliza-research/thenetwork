# Claude and Grok/X entry points: delta research

Research date: 2026-10-07/08. Scope: answers the questions in the brief that the existing docs don't cover, and corrects them where needed. The existing docs are `docs/research/connectors/claude.md` (2026-10-05), `docs/research/connectors/grok.md` (2026-10-05), and `connectors-and-loveofyourlife.md` §2.3–2.4 (git history, 16cde70). Everything already covered there is left out.

Confidence: **H** = official doc or first-party artifact read directly; **M** = official doc that is ambiguous, or an inference from official artifacts; **L** = secondary source or untested.
"Tested" means I observed the behaviour myself in a browser on 2026-10-07.

---

## 0. Corrections to existing docs

| # | Doc / claim | Correction | Conf. |
|---|---|---|---|
| C1 | PRD 11.5: "OAuth only if a host requires it"; loveofyourlife §2.3 lists `none` among Claude auth types | **Claude's directory requires OAuth for any authenticated remote server.** Software Directory Policy §5D (2026-04-15): "Remote MCP servers that connect to a remote service and require authentication must use secure OAuth 2.0 with certificates from recognized authorities." `none` is fine for an *unlisted custom connector*. A directory listing whose tools authenticate in-band (phone + code in chat, then a key passed as a tool argument) would very likely be judged non-compliant. The PRD's fallback already fits: an OAuth authorization page whose only login step is phone + SMS code. For Claude, that fallback is required, not optional. | H (rule) / M (how reviewers apply it) |
| C2 | grok.md §1: custom MCP connectors "require a paid tier" (3p) | Official docs.x.ai/grok/connectors now opens with: "Connectors are available to all Grok users." The page covers built-in, catalog and custom MCP connectors. It doesn't state custom-MCP plan gating separately. The built-in list now includes **Microsoft Teams** and **Salesforce**. | M |
| C3 | grok.md §3: grok.com OAuth redirect is `/connectors-oauth-exchange-code/` or `/connectors/oauth/callback` | grok.com's live `apple-app-site-association` file excludes `/connectors-oauth-exchange-code*`, `/connectors-oauth-success`, `/connectors-oauth-error` and `/connectors-oauth-retry` from app links. This confirms that `https://grok.com/connectors-oauth-exchange-code` is the real connector OAuth callback path. No `/connectors/oauth/callback` path appears. | M–H |
| C4 | grok.md §5: "X publishes a DM cap of 500/day per account" (3p) | Official X rate limits: `POST /2/dm_conversations/with/:participant_id/messages` is **1,440/24h per app** and **15/15min plus 1,440/24h per user**. DM lookup is 15/15min per user. | H |
| C5 | grok.md "Grok Bot / Grok consumer has no skills" (implicit) | **Grok Skills** launched on grok.com, iOS and Android on 2026-05-18 (x.ai/news/grok-skills). See §5. | H |
| C6 | grok.md: no re-engagement mechanism noted | **Grok Automations** (2026-07-16) are scheduled runs that can @-mention a connector and notify by email or app push. Available to everyone. See §5. | H |
| C7 | claude.md: Skills on "Free" are implied by the support article | The docs conflict. support.claude.com/12512180 says skills are on Free, Pro, Max, Team and Enterprise. claude.com/docs/skills/overview says "Pro, Max, Team, and Enterprise". Assume **paid plans only**. | M |
| C8 | (new) X API data use for profiling | X Developer Guidelines forbid deriving or inferring **sex life / sexual orientation**, health, politics, religion and other sensitive categories from X data, even with consent. This directly limits using X data for *dating* matching. See §6.4. | H |

---

## 1. Claude: Skills, plugins, directory

### 1.1 Can a user install a skill or plugin we distribute? (H)
- **Skill (single):** upload a ZIP at **Customize > Skills > + > Create skill > Upload a skill**. The ZIP must contain `<skill-name>/SKILL.md` as its top level. No install-from-link exists for a bare skill. Custom uploaded skills are private to the user. On Team/Enterprise they can be shared or published to the org library.
  Sources: https://claude.com/docs/skills/how-to (accessed 2026-10-07); https://support.claude.com/en/articles/12512180 (accessed 2026-10-07, "updated over 2 weeks ago").
- **Plugin:** **Customize > Plugins** offers three ways in:
  1. **Discover** (the directory, on paid plans)
  2. **Add > Add marketplace** with a GitHub/GitLab/Bitbucket repo URL or `owner/repo`
  3. **Add > Upload plugin** with a `.zip` or `.plugin` file, up to 200 MB

  We can therefore distribute either a GitHub marketplace repo that users add by URL, or a zip. Anthropic doesn't review either of these paths. Installs attach to the account and appear on chat (web, desktop, **mobile**), Cowork, and Claude Code as a synced plugin.
  Sources: https://claude.com/docs/plugins/overview ; https://claude.com/docs/plugins/platform-support (accessed 2026-10-07).
- **Mobile:** there's no upload UI on mobile, as far as the docs say. Skills and plugins installed on the account work in mobile chat ("Chat on the web, desktop, and mobile: its skills, commands, and connectors are available"). Uploading happens on web or desktop. (M)
- **Code execution prerequisite:** skills on claude.ai run in the code sandbox, so "Code execution and file creation" must be on. It is on by default for Free, Pro and Max.
- **Claude Code:** copy the skill to `~/.claude/skills/`, install it as a plugin (`/plugin`, `claude plugin install`, `/plugin directory` in v2.1.287+), or let it sync from the claude.ai account.
- **API:** upload via `/v1/skills`. Skills are workspace-wide and **don't sync** with claude.ai or Claude Code.
  Source: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview (accessed 2026-10-07).

### 1.2 Can a skill alone (no connector) call our API? (H)

| Surface | Network from skill scripts | Implication |
|---|---|---|
| claude.ai / desktop / mobile chat, **Free/Pro/Max** | Egress is on by default but limited to an **approved list**: api.anthropic.com, statsig.anthropic.com, github.com, npm, PyPI, crates.io, Ubuntu archives, Yarn. Individual plans have **no documented way to add a domain**. | **No.** A skill can't reach `api.thenetwork…`. |
| claude.ai **Team** | Default "package managers only". An Owner can add specific domains or allow "All domains". | Only if the org's Owner allowlists us. Not viable for consumers. |
| claude.ai **Enterprise** | Egress off by default. The Owner configures it. | Same as Team. |
| **Claude API** | "Skills cannot make external API calls or access the internet." | No. |
| **Claude Code** | "Full network access", the same as any program on the user's computer. Bash calls need permission. | **Yes.** PRD 11.5 "stored keys on computers" works here. |
| Cowork (cloud) | Not documented. Users have filed bug reports in 2026 that Cowork egress allowlists are ignored. | Treat as no. |

Anthropic states it plainly: "A skill can tell Claude how to use a connector, but it can't reach the service itself", and "When a script needs to reach an outside service, have Claude use a connector." MCP traffic bypasses the egress setting entirely ("network communication remains possible through those connections regardless of the network egress setting").
Sources:
- https://support.claude.com/en/articles/12111783 (updated 2026-08-06)
- https://claude.com/docs/skills/how-to
- https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview
- Cowork egress bugs: https://claudeissues.com/issue/93651-bug-cowork-sandbox-egress-proxy-blocks-all-custom-domains-regardless-of-org-allo (L)

**Implication:** on claude.ai the Network skill is instructions only. Every Network call, including `start_phone_verification` and `verify_phone_code`, has to be a **connector tool**.

### 1.3 Directory policy points not in claude.md (H)
Source: Software Directory Policy, dated **2026-04-15**, https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy (fetched 2026-10-07).
- **Dating, people-matching, romance, adult content and minors are not mentioned** anywhere in the directory policy. Only the Usage Policy applies.
- **§1C** requires protecting "the privacy interests of third parties", which matters for other members' data. **§1D** limits collection to "data from the user's context that is necessary to perform their function", with no extraneous conversation data "even for logging".
- **§1F**: "Software must not query or extract data from Claude's memory, chat history, conversation summaries, or user-generated or uploaded files."
- **§2D/2F** apply to skills too: no coercing tool calls the user didn't ask for, and no pulling behavioural instructions from external sources.
- **§3D** requires a test account with sample data. **§3E** requires at least 3 working example prompts.
- **§3F**: plugins may reference any directory-approved connector. Otherwise you must own the endpoint.
- **§5D** requires OAuth 2.0 (see C1).
- Plugin review: a person reviews each new listing. Connectors are auto-scanned and listed as "Community" (already in claude.md).

### 1.4 Install links for connectors (H; new vs claude.md)
Source: https://claude.com/docs/connectors/building/directory-vs-custom (accessed 2026-10-07).
- **Unlisted custom connector, prefilled dialog:**
  `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=The%20Network&connectorUrl=https%3A%2F%2Fmcp.ntwrk.party%2Fmcp`
  This opens the Add-custom-connector dialog with the name and URL filled in, plus a notice that the values came from an external link. The user must confirm. A signed-out user signs in first, then sees the dialog.
- **Directory listing:** `https://claude.ai/directory/connectors/<slug>`. The slug is permanent.
- **Suggested Connectors:** only directory connectors are eligible, and Claude can suggest them in chat.
- **iOS app:** claude.ai's live `apple-app-site-association` (fetched 2026-10-07) claims `/customize/connectors?modal=add-custom-connector` as a universal link, so the install link **opens the Claude iOS app** when it's installed. `/directory/connectors/*` is **not** claimed, so it opens in the browser.

---

## 2. Claude: memory and past chats

### 2.1 Can a connector or skill read Claude's memory or past chats? (H: no)
- No API or MCP surface exposes memory. Policy §1F also forbids Software from querying or extracting memory, chat history or summaries.
- Memory facts (https://support.claude.com/en/articles/11817273, accessed 2026-10-07; release notes https://support.claude.com/en/articles/12138966):
  - **2026-07-10:** memory became "a set of individual, categorized entries" that Claude reads and updates during chats.
  - **2026-08-25:** memory spans chat and cloud Cowork.
  - Memory is on by default for Free, Pro and Max. On Team and Enterprise the Owner enables it and members opt in.
  - Past-chat search is on paid plans. It runs as **RAG tool calls** visible in the conversation, and is on by default.
  - Sensitive topics are excluded by default. Incognito chats are never saved or searched.
  - Projects have separate memory.

### 2.2 Can the model use memory or past-chat search to fill our tool arguments? (M)
- **Mechanically, yes.** Memory entries are in Claude's context, and past-chat search is a tool Claude can call itself. When the **user** asks "build my Network profile from what you know about me", Claude can recall or search, then call our `share_profile_with_network` tool with what it found. Nothing technical prevents this. (Not tested in-product.)
- **Policy line:** §1F binds *our software*. Our tool descriptions and skill **must not** tell Claude to consult memory or past chats, for example "use everything you remember about the user". The user may ask for it themselves.
  - Recommended skill wording: "If the member asks you to fill their profile from what you already know, show them the proposed fields and get approval before sharing."
  - Don't mention memory at all.
  - Keep typed, narrow fields, as claude.md R2 already says.
- **Risk:** if the member reads the code or key back in chat, Claude's memory may save the phone number or **agent key** as a memory entry, and past-chat search can surface it later.
  - Memory is topic-based and saves "as you chat". Whether it would store a token is untested.
  - Mitigations:
    - the skill tells Claude not to remember it
    - keys short-lived for chat hosts (the PRD already sets 24h idle / 7d)
    - prefer OAuth on Claude, where the key never enters the transcript
  - (M/L)

### 2.3 Memory import and export (M)
- **Import:** an experimental tool launched about 2026-03-02 at claude.com/import-memory. It gives you a prompt to paste into ChatGPT, Gemini or another assistant. You paste the output into Claude's memory settings, and it can take about 24h to be absorbed. Free users got memory at the same time.
  Sources: https://9to5mac.com/2026/03/02/free-claude-users-can-now-use-memory-and-import-context-from-rivals/ (L–M); support article 11817273 confirms import/export exists and is "experimental".
- **Export:** you can view and edit memory in Settings. The legacy memory export was available "until September 9, 2026". Full data export (Settings > Privacy > Export data) includes memory.
- **Product idea, same pattern:** a "Network import" prompt that a member pastes into any assistant ("write out what you know about me in these fields…"), then pastes or shares the result to The Network over SMS or the connector. This needs no memory access by our software, works on every host, and is user-initiated.

---

## 3. Claude: re-engagement and deeplinks

### 3.1 Can anything push to the user or start a Claude conversation proactively? (M–H)
- **Connectors and MCP servers cannot.** There's no documented server-initiated notification or conversation start, and Claude only calls tools during a user or task turn. (H, absence of any mechanism in docs)
- **User-created scheduled tasks are the only legit path.**
  - Cowork scheduled tasks run in the cloud with "no device online" (2026-07-07). On Pro and Max, new Cowork tasks run in the cloud by default from 2026-10-06.
  - Since 2026-09-16, Cowork features are available from any chat.
  - "When Claude finishes a task or needs your input, you'll get a notification on your phone."
  - Connectors, skills, plugins and scheduled tasks are all marked available on desktop, web and mobile.
  - A member could therefore set up "Every morning at 8, check The Network for updates", and the task calls our connector, then pushes to their phone.
  - Unconfirmed: whether a scheduled task's completion always pushes, and whether remote MCP connectors are guaranteed in scheduled tasks. The page lists connectors generally.
  - Policy: our skill may *offer* to set this up only when the member asks about updates. §2D forbids coercing calls.
  - Sources: https://support.claude.com/en/articles/15520349-use-claude-cowork-on-web-desktop-and-mobile ; https://claude.com/blog/cowork-web-mobile (2026-07-07); release notes.
- Claude (Slack) "Claude Tag" also exists but is out of scope.

### 3.2 Deeplink formats

| Link | Behaviour | Conf. |
|---|---|---|
| `https://claude.ai/new?q=<urlencoded>` | Opens a new chat with the prompt **prefilled, not sent**. Two independent security write-ups (Oasis, 2026) say the web app needed the user to press Enter. Signed out (tested 2026-10-07), it redirects to `/login?...returnTo=/new?q=...`, so the prompt survives login. **iOS: `/new` is a universal link** in claude.ai's AASA, so it opens the app. Whether the app honours `q` is untested. Android: assetlinks lists `com.anthropic.claude` with `handle_all_urls`; the path filters are in the APK and weren't verified. | M |
| `claude://claude.ai/new?q=` (Claude Desktop) | It used to **auto-submit**. That was the "PromptFiction" flaw, published 2026-07-15. Fixed in Desktop ≥1.1.2321, which now prefills and waits for Send. | M (https://www.oasis.security/blog/claude-desktop-vulnerability) |
| `claude-cli://open?q=…&repo=owner/name` (Claude Code) | Official. Prefills up to 5,000 chars and **never auto-sends**. Shows the warning "Prompt from an external link". | H (https://code.claude.com/docs/en/deep-links) |
| `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=…&connectorUrl=…` | Official connector install link. Opens the iOS app (in the AASA). See §1.4. | H |
| `https://claude.ai/directory/connectors/<slug>` | Official directory listing link. Web only (not in the AASA). | H |
| Project link `claude.ai/project/<id>` | Not in the AASA. Projects are shareable only within a Team or Enterprise org (not re-verified this session). Not a consumer distribution path. | L |

There's no officially documented `q` parameter for claude.ai. Treat it as unsupported but working, and expect a confirmation step.

### 3.3 Is phone + SMS code in chat acceptable? (answer to Q4)
- **Directory listing: no.** §5D requires OAuth 2.0 for authenticated remote servers. Build an OAuth 2.1 authorization server where the **authorize page's only login is phone + SMS code**. That issues the same scoped, revocable credential, and claude.md §3.3 already designs it. Reviewers also need a "fully populated test account" (§3D), so plan a reviewer phone number or bypass.
- **Unlisted custom connector (install link):** an `auth: none` server with `start_phone_verification` / `verify_phone_code` tools and a key passed as an argument *technically* works. Claude's model can't set HTTP headers for a custom connector, so the key has to travel as a tool argument. Downsides:
  - the code and key sit in the transcript (and possibly in memory, §2.2)
  - no "Connected" state in Claude's UI
  - can't be listed
- Recommendation: OAuth (phone-OTP login page) as the single Claude path. Keep in-chat verification only for hosts with no OAuth.

---

## 4. Claude: directory and plugin review on people data (summary)
- Same as claude.md, plus §1.3 above. Neither the policy nor the review criteria name dating or people-matching. The binding constraints are §1C (third-party privacy), §1D (minimal data), §1F (memory), §4C (no sponsored content) and §5D (OAuth). (H)

---

## 5. Grok (consumer): connectors, skills, memory, automations, deeplinks

| Topic | Finding | Conf. | Source |
|---|---|---|---|
| Custom MCP | grok.com/connectors > New Connector > Custom > URL > "complete any required authentication". "Connectors are available to all Grok users". The server must be public. Built-ins now include Gmail/Calendar, Drive, OneDrive, Outlook, **Teams**, SharePoint, **Salesforce**, plus a catalog. Still no public catalog submission. | H | https://docs.x.ai/grok/connectors.md (fetched 2026-10-07) |
| OAuth callback | `https://grok.com/connectors-oauth-exchange-code` (see C3) | M–H | grok.com AASA, fetched 2026-10-07 |
| Skills | Launched **2026-05-18** "across grok.com, iOS, and Android" (Grok 4.3). You create a skill by describing it, **uploading a file**, or writing it from scratch, and Grok can save a workflow as a skill. Built-ins can be overridden. Not documented: upload file format (pre-launch reports said .zip/.skill/.md), install from link, sharing, marketplace, whether skills can call connectors or the network. | H (launch) / L (details) | https://x.ai/news/grok-skills ; https://www.testingcatalog.com/xai-prepares-skills-support-for-grok-to-rival-claude-and-chatgpt/ |
| Plugins / directory | Consumer Grok has none. Grok Bot uses the Cursor Marketplace and Grok Build uses xai-org/plugin-marketplace (already in grok.md). | H | grok.md |
| Memory | "Memory across chats" (beta since 2025-04), controlled by "Personalize Grok with your conversation history" under Data Controls. Reported excluded in parts of the EU and UK. **No documentation of tools or connectors reading memory**, and no memory export or import documented. As on Claude, the model can probably fill tool arguments from memory when the user asks. Untested. | L | https://blog.memoryplugin.com/how-grok-memory-works/ ; https://the-decoder.com/xai-adds-memory-feature-to-grok-chatbot-for-personalized-responses/ |
| **Re-engagement: Automations** | Published **2026-07-16** on grok.com, iOS and Android. Schedules: once, daily, weekdays, weekly, monthly, yearly. Email triggers need SuperGrok. "Type @ to mention a connector… Grok uses it on every run". Reports go to "email, app notification, both, or neither". "Scheduled automations are available to everyone." Unconfirmed: whether *custom MCP* connectors can be @-mentioned. | H (feature) / L (custom MCP) | https://x.ai/news/grok-automations |
| Deeplink `https://grok.com/?q=<text>` | **Tested 2026-10-07 (web, signed out): prefill does not auto-send.** A modal reads "Send this message? The link you opened pre-filled this message. Grok will only receive it if you send it." with Cancel / Send. **iOS: grok.com's AASA claims `/*`** for `ai.x.GrokApp`, so the link opens the Grok app when installed. Untested whether the app keeps `q`. Android `ai.x.grok` has `handle_all_urls`. | H (web) / M (app) | Browser test; grok.com/.well-known/apple-app-site-association |
| Deeplink `x.com/i/grok?text=` | `x.com/i/grok` exists. No source documents a `text` parameter, and x.com was unreachable from this sandbox. **Unverified.** | L | https://help.x.com/en/using-x/about-grok |
| Grok Bot X integration | A 3p changelog (2026-08-29) says connecting X in Grok Bot auto-creates a developer account and paid Grok Bot users get free X API credits. Unverified. | L | https://techdevnotes.com/releases/xai-website/20260829-220711Z-d9bb29aa592a |

**Implications for Grok:**
- (a) An "Add to Grok" page plus a `grok.com/?q=` link that prefills "Set up The Network for me" is viable. The user still taps Send.
- (b) Automations are a better re-engagement hook than anything on Claude, because they're on all plans. Test whether custom connectors can be @-mentioned there.
- (c) Grok Skills could carry the Network skill text, but the distribution format is undocumented. Test an upload of our `SKILL.md` zip.

---

## 6. X: "@grok" and our own bot account

### 6.1 Building on @grok (H for absence)
- No third-party extension point for @grok replies on X has been found as of 2026-10-07. That's unchanged from grok.md. Nothing new in docs.x.ai or docs.x.com.

### 6.2 Our own bot (@thenetwork) rules (H)
Source: https://docs.x.com/developer-guidelines.md (fetched 2026-10-07).
- **Required:**
  - "Automated" profile label
  - a bio stating it's a bot and who runs it
  - linked to a human-managed account
  - official API only (scraping or browser automation means permanent suspension)
- **Replies:** only if the user engaged first, at most **1 reply per interaction**, no keyword-triggered auto-replies.
- **"AI-powered app generates and posts replies → Requires prior approval from X."** "Deploying AI-generated replies without approval is a violation, even if the content itself is helpful." No public approval form was found, so the route is X developer support or the automation-rules contact.
- **DMs:** "Only after user DMs you first. Easy opt-out required."
  - Auto-DMs to new followers are banned "even to followers".
  - Bulk DMs are banned.
  - Support-style DM automation needs a privacy policy link in DMs.
- **Prohibited:** "Surveillance: Profiling, tracking, or monitoring users without consent."

### 6.3 X API pricing and limits (2026, H)
Sources: https://docs.x.com/x-api/getting-started/pricing.md ; https://docs.x.com/x-api/fundamentals/rate-limits.md (fetched 2026-10-07).
- **No tiers or subscriptions.** Pay-per-usage credits. The legacy Free, Basic and Pro tiers are gone for new developers. You get $20 free credit when you save a card. Up to 20% back in xAI API credits once spend reaches $200+ per cycle. Usage is capped at **3M Post reads/month** before Enterprise.
- **Reads, per resource:**

  | Resource | Price |
  |---|---|
  | Post | $0.005 |
  | User | $0.010 |
  | Following/Followers | $0.010 |
  | Like | $0.001 |
  | DM event | $0.010 |
  | Profile-update | $0.005 |

  Deduplicated per 24h UTC. "Owned Reads" cost $0.001 but **only when the authenticated user owns the developer app**, so they don't apply to our members.
- **Writes:**

  | Action | Price |
  |---|---|
  | Post | $0.015 |
  | Post with URL | $0.20 |
  | **Summoned reply** | **$0.010** |
  | DM create | $0.015 |

- **Webhooks (X Activity API):**

  | Event | Price |
  |---|---|
  | `dm.received` | $0.010 |
  | `chat.received` | $0.010 |
  | `follow.*` | $0.010 |
  | `post.create` | $0.005 |

- **Rate limits** (per app / per user):

  | Endpoint | Per app | Per user |
  |---|---|---|
  | DM send | 1,440/24h | 15/15min, 1,440/24h |
  | DM lookup | — | 15/15min |
  | `GET /2/users/:id/tweets` | 10,000/15min | 900/15min |
  | `GET /2/users/:id/liked_tweets` | **75/15min** | 75/15min |
  | `GET /2/users/:id/following` | 300/15min | 300/15min |
  | `GET /2/users/:id/followers` | 300/15min | 300/15min |
  | `GET /2/users/me` | — | 75/15min |

  The 75/15min per-app limit on likes is a bottleneck for bulk onboarding.
- **Encrypted DMs (X Chat API):** separate endpoints with client-side encryption through the "Chat XDK". OAuth 2.0 user context with `dm.read` / `dm.write`. If members message our bot through X Chat (encrypted), the bot must implement key management. Which inbox type users' "DMs" land in by default wasn't verified. (M) https://docs.x.com/xchat/introduction.md

### 6.4 Reading a consenting user's posts, bio, likes and follows for profiling (H rules, M interpretation)
- **OAuth 2.0 (PKCE) scopes:**
  - `tweet.read` ("All the Tweets you can view")
  - `users.read`
  - `like.read` ("Tweets you've liked and likes you can view")
  - `follows.read`
  - `bookmark.read`
  - `dm.read`
  - `offline.access` for refresh tokens; access tokens last 2h without it

  Source: https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code.md
- **Allowed with express opt-in.** "Off-X matching" (linking an X account to our member record) is "Allowed with express opt-in consent: User explicitly agrees to link their X account… Clear disclosure of what data will be matched and why." The OAuth link plus a clear consent screen meets this.
- **Hard limits, even with consent:**
  - You "cannot derive, infer, or store information about X users" in health, finances, politics, race or ethnicity, religion, **sex life or sexual orientation**, trade union membership, or criminal history.
  - Using X data for the dating track's orientation or preferences is therefore barred. Those must come from the member directly.
  - Delete within 24h when the user or X asks, or when content is removed. Delete all X data within 10 business days if API access ends.
  - No AI/ML training on X data (Grok excepted). Per-request LLM summarisation isn't training. Keep the derived profile separate, and don't use raw X data for model fine-tuning.
- **Other members' data:** reading a member's *following list* returns third parties' data. Use it only for the member's own matching and never expose it.
- **`dm.read` is not recommended.** It's too invasive and not needed.

### 6.5 xAI API: summarise a user's public X presence (H pricing; M policy)
- The `x_search` tool in the Responses API does keyword, semantic and user search plus thread fetch. Parameters include `allowed_x_handles` (max 20) and date ranges.
- **Pricing:** $5 per 1k posts fetched and $10 per 1k profiles fetched, billed per item returned (parent and quoted posts count), on top of tokens. On grok-4.3 tokens are $1.25 in / $2.50 out per 1M tokens; on grok-4.7, $2/$6.
  Sources: https://docs.x.ai/developers/tools/x-search.md ; https://docs.x.ai/developers/pricing.md (fetched 2026-10-07)
- **Estimated cost per member summary** (1 profile, about 100 posts, about 40k input tokens and 2k output on grok-4.3): about $0.01 + $0.50 + $0.05 + $0.005 ≈ **$0.57**. With 200 posts, about $1.10. The same data via the X API is about $0.51 for posts, plus $0.10 for 100 likes, plus **$2.00 for 200 follows**, plus separate LLM cost. Grok x_search is no cheaper per post. Its advantages are that it needs no member X OAuth for public posts and gives one-call semantic summarisation. It **cannot** see likes (private on X), follows or DMs.
- **Consent:** the X policy rules on profiling, sensitive inference and off-X matching should be treated as applying regardless of the pipe. Get express opt-in in our own flow ("Let The Network read your public X posts to suggest profile details") before calling `x_search` for that handle, and verify handle ownership. One way is X OAuth (`users.read` only, $0.01), which proves the account and returns the bio. Then use `x_search` for posts. Whether xAI's API terms carry X's developer restrictions over x_search output wasn't verified. Have counsel check the xAI API terms. (M/L)

---

## 7. Other assistant-native entry points (brief)

**Meta AI / Muse.** Muse (Meta's consumer agent, launched September 2026) has no custom-MCP setting in the consumer app. Meta curates connectors; partner example: Zapier connector, 2026-09-29. Reports conflict on whether a developer-submitted connector program opened about 2026-09-18 (RuntimeWire) or whether there's "no developer portal" (Parallel, 2026-09-14). The existing loveofyourlife §2.5 already notes the muse.ai/platform review program. Confidence L–M.
Sources: https://zapier.com/blog/zapier-connector-in-muse/ ; https://runtimewire.com/article/meta-opens-muse-connectors-developers ; https://parallel.ai/articles/meta-muse-custom-integrations

**WhatsApp.**
- WhatsApp Business Solution Terms (effective **2026-01-15**) bar "AI Providers" from offering LLMs or general-purpose assistants on the Business API "when such technologies are the primary (rather than incidental or ancillary) functionality". Meta decides what counts.
- The EU Commission issued interim measures (reported about June 2026) forcing restored access for EEA numbers. Meta said it would appeal. Brazil and the EEA are carved out.
- For a **US** WhatsApp line, a Network agent whose primary function is an LLM conversation is at real risk of termination. A narrower "matching service with AI assistance" framing is arguable but at Meta's discretion.
- Confidence M.
- Sources: https://www.medianama.com/2025/10/223-whatsapp-bans-external-ai-providers-business-api/ ; https://engadget.com/2191213/eu-orders-meta-to-stop-blocking-rival-ai-chatbots-on-whatsapp ; https://www.whatsapp.com/legal/business-solution-terms

**Telegram.**
- The Bot API is free and actively AI-oriented:
  - 10.0 (2026-05-08): Guest Mode
  - 10.1 (2026-06-11): Rich Messages, "stream AI-generated replies"
  - 10.2 (2026-07-14): ephemeral messages
  - 10.3 (2026-08-24): stop-generation updates
- A `request_contact` keyboard button lets a user share their verified phone number in one tap. That matches our phone identity without an SMS code. (`request_contact` is from background knowledge; the page section wasn't read. M.)
- No policy against AI bots was found.
- Source: https://core.telegram.org/bots/api (fetched 2026-10-07). Confidence H for versions.

**Gemini.**
- Third-party guides (2026) say the consumer Gemini web app added "Custom apps" (remote MCP URL) under Settings > Connected Apps, reportedly with these restrictions:
  - AI Pro or Ultra
  - personal account, 18+, US, English
  - usable in "Spark" tasks
- Gemini Enterprise supports custom MCP (Streamable HTTP only, admin-enabled). Gems are shareable by link but can't call external APIs.
- I couldn't fetch Google's own help page. Confidence L.
- Sources: https://skillsplayground.com/integrations/gemini/ ; https://docs.cloud.google.com/gemini/enterprise/docs/connectors/custom-mcp-server/set-up-custom-mcp-server

**Perplexity.**
- Custom **remote** MCP connectors have been in Settings > Connectors for Pro, Max and Enterprise since about March 2026, with OAuth, API key or no auth.
- No public directory submission process was found.
- Confidence L–M.
- Sources: https://www.conductor.com/docs/mcp/perplexity/ ; https://agents.ramp.com/docs/connectors/perplexity

---

## 8. Could not verify
1. Whether `claude.ai/new?q=` prefill is honoured by the iOS and Android Claude apps, and the exact web UI (no signed-in test).
2. Whether Grok iOS keeps `?q=`. Whether `x.com/i/grok?text=` works at all (x.com was unreachable).
3. Whether custom MCP connectors can be used in Grok Automations, and in Claude cloud scheduled tasks; and whether Claude scheduled-task completion always pushes to mobile.
4. Grok Skills upload format and sharing; whether Grok skills or code have network egress.
5. Whether Claude memory would store an agent key or phone number read out in chat.
6. Whether Claude's custom-connector auth `none` plus in-chat key is acceptable to Anthropic for an *unlisted* connector. No rule forbids it; §5D binds only directory listings.
7. xAI API terms on downstream use of `x_search` results. The X API AI-reply approval process (no public form found).
8. Which X inbox (legacy DM or encrypted X Chat) user-to-bot messages land in.
9. The canonical Google Gemini consumer custom-MCP help page.

## 9. Sources index (all fetched or accessed 2026-10-07 unless dated)
- Anthropic Software Directory Policy, 2026-04-15: https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy
- Connectors: directory vs custom, install links: https://claude.com/docs/connectors/building/directory-vs-custom
- Connector authentication: https://claude.com/docs/connectors/building/authentication
- Publish to the directory: https://claude.com/docs/directory/publish
- Plugins overview: https://claude.com/docs/plugins/overview
- Plugin platform support: https://claude.com/docs/plugins/platform-support
- Skills overview: https://claude.com/docs/skills/overview
- Create custom skills: https://claude.com/docs/skills/how-to
- Use skills (support): https://support.claude.com/en/articles/12512180
- Create and edit files / network egress (updated 2026-08-06): https://support.claude.com/en/articles/12111783
- Agent Skills (API) runtime constraints: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview
- Memory and chat search: https://support.claude.com/en/articles/11817273
- Release notes: https://support.claude.com/en/articles/12138966-release-notes
- Cowork web/mobile: https://support.claude.com/en/articles/15520349-use-claude-cowork-on-web-desktop-and-mobile ; https://claude.com/blog/cowork-web-mobile (2026-07-07)
- Claude Code deep links: https://code.claude.com/docs/en/deep-links
- Oasis Security, Claude Desktop deeplink auto-submit fix (2026-07-15, updated 2026-07-28): https://www.oasis.security/blog/claude-desktop-vulnerability
- Oasis Security, claude.ai `?q=` injection: https://www.oasis.security/blog/claude-ai-prompt-injection-data-exfiltration-vulnerability
- Hackread on the same issue: https://hackread.com/promptfiction-flaw-auto-prompts-claude-desktop/
- claude.ai AASA: https://claude.ai/.well-known/apple-app-site-association
- claude.ai assetlinks: https://claude.ai/.well-known/assetlinks.json
- 9to5Mac, memory import (2026-03-02): https://9to5mac.com/2026/03/02/free-claude-users-can-now-use-memory-and-import-context-from-rivals/
- Grok connectors: https://docs.x.ai/grok/connectors.md
- Grok FAQ: https://docs.x.ai/grok/faq.md
- Grok Skills (2026-05-18): https://x.ai/news/grok-skills
- Grok Automations (2026-07-16): https://x.ai/news/grok-automations
- grok.com AASA: https://grok.com/.well-known/apple-app-site-association
- xAI X Search: https://docs.x.ai/developers/tools/x-search.md
- xAI pricing: https://docs.x.ai/developers/pricing.md
- X API pricing: https://docs.x.com/x-api/getting-started/pricing.md
- X API rate limits: https://docs.x.com/x-api/fundamentals/rate-limits.md
- X Developer Guidelines: https://docs.x.com/developer-guidelines.md
- X OAuth 2.0 scopes: https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code.md
- X DMs: https://docs.x.com/x-api/direct-messages/manage/introduction.md
- X Chat API: https://docs.x.com/xchat/introduction.md
- Telegram Bot API: https://core.telegram.org/bots/api
- WhatsApp Business Solution Terms: https://www.whatsapp.com/legal/business-solution-terms
- Other secondary sources are cited inline.
