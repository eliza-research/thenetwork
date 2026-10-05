# Grok / SpaceXAI connector research (The Network)

Research date: 2026-10-05. Scope: how to build and ship The Network's four-tool remote MCP connector (`network.talk`, `network.share_context`, `network.get_updates`, `network.respond`; PRD Section 11) to every Grok surface, plus X bot constraints.

Source quality: claims marked **[official]** come from docs.x.ai, x.ai, docs.x.com, cursor.com, or forum replies from Cursor staff. Claims marked **[3p]** come from third-party guides, GitHub issues, or press, and should be re-verified in-product before relying on them. Access dates for all sources are 2026-10-05; publication dates are given where the page showed one. Several official pages (x.ai/pricing, x.ai/legal/*, help.x.com) returned HTTP 403 to automated fetches, so a few plan and policy details rely on secondary reporting. Those are flagged.

---

## 1. Surfaces overview

### Corporate context (affects where things live)
- xAI was acquired by SpaceX in February 2026 and rebranded **SpaceXAI** in July 2026. SpaceX completed its acquisition of **Cursor** on 2026-08-14. [3p: Wikipedia, SpaceXAI]
- So "Grok" now covers three separate products with three separate extension mechanisms: **Grok** (consumer chat), **Grok Bot** (agent product built with Cursor), and **Grok Build** (coding CLI). The xAI API is a fourth, developer-only surface. X (Twitter) is a separate platform with its own API and rules.

### Surface matrix

| Surface | What it is | Extension mechanism | How a user gets The Network | Directory / listing | Auth to our server |
|---|---|---|---|---|---|
| **Grok consumer** (grok.com, iOS, Android, Tesla in-car) | Chat assistant | **Connectors**: a curated catalog plus **Custom (Bring Your Own MCP)** connectors | grok.com/connectors, then New Connector, then Custom, then paste MCP URL and complete auth. On iOS/Android: Settings, then Connectors. [official: docs.x.ai/grok/connectors; x.ai/news/grok-connectors, 2026-05-06] | Curated catalog. **No public submission form found.** [3p] | OAuth (PKCE). DCR or a pasted static Client ID. See Section 3. |
| **Grok Business / Enterprise** | Team workspace | The same connectors, but **a team admin must provision** each connector in console.x.ai (needs "Team Read-Write") before members can use it. Custom MCP is added under "Other". [official: docs.x.ai/grok/connector-management] | The admin adds it, then members connect it | n/a (per-org) | Same as consumer |
| **Grok Bot** (launched in beta 2026-08-11; macOS, Windows, Linux, iOS, Android, Tesla since 2026-09-22) | Persistent cloud-VM agents ("teammates") that run on Cursor infrastructure | **Plugins from the Cursor Marketplace** (skills plus MCP), plus custom MCP connectors added in-app | Marketplace in the sidebar, then Add, then browser auth. Or Settings, then Plugins, then Add custom connector. [official: docs.x.ai/grok-bot/computer-and-apps; 3p: poster.ly, scrapeless] | **Cursor Marketplace**: submit at cursor.com/marketplace/publish, with manual review. [official: cursor.com/docs/reference/plugins] | OAuth (static CLIENT_ID plus PKCE is supported; redirect `https://www.cursor.com/agents/mcp/oauth/callback`) or headers/secrets |
| **Grok Build** (coding CLI) | Terminal coding agent | Plugins from **github.com/xai-org/plugin-marketplace** (PR-based) | `/marketplace` in the CLI | Open PR to the catalog repo. Requires a SHA-pinned remote source and code-owner review. [official: github.com/xai-org/plugin-marketplace] | Browser OAuth flow; tokens stored locally [3p: ismcpgoodyet.com] |
| **xAI API** (Responses API / xAI SDK / Speech-to-Speech) | Developer API | **Remote MCP tools**: `server_url`, `server_label`, `allowed_tools`, `authorization`, `headers` | Not end-user-facing. Only relevant if we build our own Grok-powered client. | None | A bearer token we supply per request (no OAuth dance) [official: docs.x.ai remote-mcp-tools] |
| **@grok on X** | Grok replying to mentions on X | **No third-party extension point found.** Users cannot attach connectors to @grok replies on X. | n/a | n/a | n/a |
| **Our own X bot account** (e.g. @TheNetwork) | An automated account on X | X API v2 (pay-per-use) | Mentions or DMs to our account | n/a | X OAuth 2.0 for our app |

### What "Grok bot" in the PRD most likely means
In Oct 2026, "Grok Bot" is a named product: the SpaceXAI and Cursor persistent agent ([VentureBeat, 2026-08-11](https://venturebeat.com/orchestration/spacexais-grok-bot-turns-agents-into-persistent-digital-coworkers-that-can-operate-your-apps-for-120-per-month); [docs.x.ai/grok-bot/overview](https://docs.x.ai/grok-bot/overview)). It does not mean "a bot on X." We should treat Grok Bot as a first-class target, and it ships through the **Cursor Marketplace**. A bot on X is a separate and much weaker option (Section 5).

### Key facts per surface

**Grok consumer connectors** [official unless noted]
- Launched 2026-05-06 on Web, iOS and Android. First-party connectors at launch were SharePoint, Outlook, OneDrive, Google Workspace, Notion, GitHub and Linear, plus "Bring Your Own MCP". ([x.ai/news/grok-connectors](https://x.ai/news/grok-connectors))
- The server must be "reachable over the public internet". Localhost and private addresses are rejected, so use ngrok or Cloudflare Tunnel for dev. Cloudflare quick tunnels don't support SSE, so use Streamable HTTP. "If your MCP server requires OAuth or API keys, you will still complete that flow in Grok after providing the tunnel URL." ([custom-mcp-tunneling](https://docs.x.ai/grok/connectors/custom-mcp-tunneling))
- First-party connectors use incremental OAuth scopes. For example, Gmail goes `gmail.readonly`, then `gmail.modify`, then `gmail.send`. Users can disconnect in Grok or revoke at the provider. SpaceXAI states it does not train on connector data. ([gmail-google-calendar](https://docs.x.ai/grok/connectors/gmail-google-calendar))
- Plan gating: the official docs don't state a tier for custom connectors. Several third-party guides say **custom MCP connectors require a paid tier (SuperGrok, ~$30/mo, or higher)**, while catalog connectors work on Free. [3p: [context-link.ai](https://www.context-link.ai/blog/grok-custom-connector), [segmentstream](https://segmentstream.com/blog/articles/best-mcp-servers-for-grok)] x.ai/pricing returned 403. **Verify.**
- Catalog: ~31 integrations as of 2026-08-12. Third-party tiles are hosted MCP servers that SpaceXAI "surfaces but does not build or maintain". Later additions included Vercel, Canva, Gamma, S&P Global, DoorDash, Uber Eats, OpenTable and Starbucks (the last four via Tesla). [3p: [awesome-grok-connectors](https://github.com/rdmgator12/awesome-grok-connectors); [driveteslacanada](https://driveteslacanada.ca/news/tesla-grok-bot-hands-free-ai-tasks/)]
- UI capabilities: no official documentation that grok.com renders **MCP Apps** (interactive HTML UI) or supports **elicitation**. The MCP Apps host list doesn't include Grok. [3p: [MCP Apps blog 2026-01-26](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/)] The ismcpgoodyet.com tracker (data through 2026-08-22) reports elicitation and partial MCP-Apps recognition for the **Grok Build CLI**, not grok.com. **Assume text-only tool results on grok.com.**
- Write confirmation: there is no documented per-call confirmation UI for custom connector writes on grok.com [3p: [explainx.ai on Outlook](https://explainx.ai/blog/xai-grok-outlook-mail-read-write-connectors-2026)]. **The Network must enforce confirmation server-side**, which GW-004 already requires.

**Grok Bot** [official unless noted]
- Each Bot runs on its own cloud VM (Firecracker microVM) with a browser, filesystem and terminal. Bots ask for approval for consequential actions, and installed connectors are account-wide across all of a user's Bots. ([computer-and-apps](https://docs.x.ai/grok-bot/computer-and-apps); [teams-and-enterprises](https://docs.x.ai/grok-bot/teams-and-enterprises))
- "Grok Bot inherits your team's existing Cursor connector policy". Connectors appear as plugins and are managed from the Team Marketplace "Plugins & MCPs" page. OAuth tokens stay on Cursor's connector backend: "Bots invoke tools without receiving them". Enterprise has an MCP allowlist. ([teams-and-enterprises](https://docs.x.ai/grok-bot/teams-and-enterprises))
- Plans: included with paid Cursor plans (Pro, Pro+, Ultra, Teams, Enterprise), or a linked SuperGrok, SuperGrok Plus, SuperGrok Heavy or X Premium+. Not included with SuperGrok Lite or SuperGrok Team/Enterprise. Weekly usage allowance. ([cursor.com/help/grok-bot/plans](https://cursor.com/help/grok-bot/plans)) Launch pricing was reported as Cursor Ultra $200/mo, Premium Teams $120/seat, and SuperGrok Heavy $300/mo. [3p: VentureBeat 2026-08-11]
- Grok Bot has a built-in **read-only X connector** (shipped 2026-08-29: search, timeline, mentions, bookmarks; no posting). [3p: [opentweet.io](https://opentweet.io/how-to/give-grok-bot-the-ability-to-post-to-x); [grokbot.dev](https://grokbot.dev/plugins/x-for-grok-bot/)]
- Example of a marketplace plugin reaching both Cursor and Grok Bot: Dropbox, 2026-09-24. Users "authorize the connection and approve the required scopes". ([Dropbox blog](https://blog.dropbox.com/topics/company/dropbox-spacexai-project-context-cursor-marketplace-grok-bot))

**xAI API remote MCP** [official: [docs.x.ai remote-mcp-tools](https://docs.x.ai/docs/guides/tools/remote-mcp-tools)]
- Parameters: `server_url` (required; Streamable HTTP or SSE only, no WebSocket), `server_label` (required; used to prefix tool names), `server_description`, `allowed_tools` (empty means all tools), `authorization` (sent as the Authorization header), and `headers`. Multiple servers can be used per conversation. `require_approval` and `connector_id` are not supported in the OpenAI-compatible Responses API. Listed model: grok-4.7.
- Pricing: remote MCP tool calls are "token-based" with no per-invocation fee. grok-4.7 costs $2.00 input, $0.50 cached and $6.00 output per 1M tokens (<200k context). ([docs.x.ai/developers/pricing](https://docs.x.ai/developers/pricing))
- Rate limits are spend-tiered (Tier 0 to Tier 4: $0 / $50 / $250 / $1k / $5k). grok-4.7 runs 150 to 500 RPS and 50M to 100M TPM. ([docs.x.ai/developers/rate-limits](https://docs.x.ai/developers/rate-limits))
- Use: (a) automated regression tests of our MCP server against a Grok model, and (b) any future first-party Network experience powered by Grok. It is not a distribution channel.

---

## 2. Step-by-step build guide

One remote MCP server serves every surface. The differences are packaging and OAuth client registration.

### 2.1 The server (shared with the ChatGPT and Claude connectors)
1. Expose `https://mcp.thenetwork.<tld>/mcp` over **Streamable HTTP**. Optionally also serve SSE. Streamable HTTP is required for Cloudflare tunnels and preferred by all hosts.
2. Expose exactly four tools: `network.talk`, `network.share_context`, `network.get_updates`, `network.respond`. Give each a tight JSON schema and a description that tells the model when to use it, and set MCP tool annotations (`readOnlyHint` on get_updates; `destructiveHint=false` and `idempotentHint` on respond with an idempotency key, per GW-003).
   - Note: the xAI API prefixes tool names with `server_label`. Keep tool names short. Check whether the dotted names (`network.talk`) survive every host's name sanitization, and fall back to `network_talk` if any host rejects dots. **Test this.**
3. Return **plain-text and structured-text results**. Do not depend on MCP Apps or elicitation for Grok. For confirmation (GW-004), use a two-step text protocol: `network.respond` returns `{status: "needs_confirmation", confirm_token, summary}`, then the model asks the user and calls again with `confirm_token`.
4. Require auth on all methods. `initialize` and `tools/list` unauthenticated should return 401 with a `WWW-Authenticate: Bearer resource_metadata=...` header (standard MCP auth). [3p pattern: [robowrite issue #4](https://github.com/RoboAdApp/robowrite-plugin/issues/4)]
5. Log every call with the client identity (`grok-web`, `grok-bot`, `grok-build`, `xai-api`). Per-client capability negotiation is GW-007.

### 2.2 OAuth authorization server (see Section 3 for detail)
6. Publish `/.well-known/oauth-protected-resource` (and the `/mcp` path variant) plus `/.well-known/oauth-authorization-server`.
7. Support Authorization Code with **PKCE S256**, public clients (`token_endpoint_auth_method: none`), and refresh tokens.
8. Support **DCR** (`/register`) with a redirect-URI allowlist that includes the Grok and Cursor callbacks. Also pre-register **static public client IDs** for hosts that ask for a pasted Client ID. Support **CIMD** if our auth stack allows it.

### 2.3 Grok consumer (grok.com / iOS / Android / Tesla)
9. Deploy the server publicly, then add it at grok.com/connectors as New Connector, Custom. Enter the name "The Network", the URL, and auth (Client ID if prompted).
10. Write user-facing setup docs ("Add The Network to Grok") with screenshots. Include the Client ID to paste, if Grok's form requires one, and note that a paid Grok plan may be required.
11. For catalog listing, pursue business development (Section 4).

### 2.4 Grok Bot (via Cursor Marketplace)
12. Create a public Git repo, for example `thenetwork/grok-bot-plugin`, containing:
    - `.cursor-plugin/plugin.json` (Cursor Plugin) **or** a root `plugin.json` (open Agent Plugin format). Required: `name` (lowercase kebab-case, unique). Recommended: `description`, `version`, `author`, `homepage`, `repository`, `license`, `logo` (a relative path, committed to the repo), `skills`, and `mcpServers`. ([cursor.com/docs/reference/plugins](https://cursor.com/docs/reference/plugins))
    - `mcp.json` with a **url-only** remote server entry (no secrets in the repo; OAuth handles auth).
    - `skills/the-network/SKILL.md`. This is the PRD 11.1 "skill/instruction package": search and plan first, treat Network data as private, confirm consequential actions, and don't imply social entitlement.
    - `README.md` documenting configuration.
    - A `.grok-plugin/plugin.json` variant is reported for Grok-specific manifests [3p: awesome-grok-bot]. This is optional; the Cursor formats are the documented path.
13. Test locally in Cursor by putting the plugin in `~/.cursor/plugins/local/the-network`, then restart or run Developer: Reload Window. ([cursor.com/docs/plugins](https://cursor.com/docs/plugins))
14. Test in Grok Bot by adding the custom connector in-app before marketplace approval (Section 6).
15. Submit at **cursor.com/marketplace/publish** (Section 4).

### 2.5 Grok Build (optional, low priority)
16. Add an entry under `external_plugins/` in `github.com/xai-org/plugin-marketplace`, edit `.grok-plugin/marketplace.json` with a remote source pinned to a 40-char commit SHA, regenerate the index, validate, and open a PR. ([xai-org/plugin-marketplace](https://github.com/xai-org/plugin-marketplace)) Grok Build is a coding CLI with a developer audience, so it's a poor fit for Network members. Only do this if it's cheap.

### 2.6 xAI API (test harness / own client)
17. Call the Responses API with `tools: [{type: "mcp", server_url, server_label: "network", allowed_tools: [...], authorization: "<test member token>"}]` to run scripted conversations against the server.

---

## 3. Auth

### Requirements by surface

| Surface | Flow | Client registration | Redirect URI(s) to allowlist | Notes |
|---|---|---|---|---|
| grok.com custom connector | OAuth 2.x Authorization Code + PKCE | Reports conflict. One says Grok does **DCR** (POSTs `/register` with `client_name: "Grok"`, `token_endpoint_auth_method: "none"`) [3p: [unraid #390, 2026-09-06](https://github.com/dinglebear-ai/unraid/issues/390)]. Others say the form takes a **pasted Client ID / (optional) Secret / Authorization / Token endpoints / Scopes** [3p: [OpenMSP PR #15, 2026-09-21](https://github.com/tavbuilds/OpenMSP/pull/15); pearmcp]. Likely both are supported (metadata discovery with DCR, plus manual entry). | Reported as both `https://grok.com/connectors-oauth-exchange-code/` [3p: [pearmcp](https://pearmcp.com/guides/grok)] and `https://grok.com/connectors/oauth/callback` [3p: unraid #390]. Allowlist **both**, plus the `www.grok.com` variants. Confirm by observing the real request. | Static bearer tokens are reported **not** usable in the grok.com form [3p: OpenMSP PR]. The official docs only say "complete any required authentication". |
| Grok Business/Enterprise | Same, but provisioned by admin in console.x.ai | Same | Same | Microsoft-style admin-consent flows exist for some catalog connectors |
| Grok Bot / Cursor | OAuth + PKCE (static `CLIENT_ID` + `scopes` supported since 2026-08-18) or headers | DCR, **or** static client (CLIENT_ID; CLIENT_SECRET optional), with scopes from `/.well-known/oauth-authorization-server` | `https://www.cursor.com/agents/mcp/oauth/callback` (web/agent); `http://localhost:8787/callback` (Cursor desktop) [official: [cursor.com/docs/mcp](https://cursor.com/docs/mcp)] | Fixed by Cursor staff on 2026-08-18 ([forum](https://forum.cursor.com/t/grok-bot-custom-mcp-needs-static-oauth-client-id-blocks-oracle-netsuite/168121)). Tokens stay in Cursor's backend, not on the Bot VM. The marketplace guidance (3p) says to advertise DCR, CIMD and PKCE S256 so installs need no API key. |
| Grok Build | Browser OAuth from the CLI | DCR / metadata discovery | Loopback | [3p: ismcpgoodyet] |
| xAI API | Bearer token we mint (`authorization` field) | n/a | n/a | Use only for tests and our own clients |

### Recommendations for The Network
- Identity linking (PRD 11.1): the member signs in on **our** authorize page using phone OTP or a passkey. The host never sees the OTP.
- Scopes, minimal by default:
  - `network.read` (get_updates)
  - `network.converse` (talk)
  - `network.respond`
  - `network.profile.write` (share_context)

  Show them on our consent screen. Let members revoke per client (GW-005), and show "Connected assistants: Grok (web), Grok Bot..." in Network settings.
- Issue short-lived access tokens (≤1h) with rotating refresh tokens, bound to `client_id`. This lets us apply per-host policy, for example stricter limits for Grok Bot, which acts autonomously.
- **Grok Bot is autonomous.** A Bot may call `network.respond` without a human present. Use a token claim `client=grok-bot` and require Network-side confirmation (SMS or Network-app push) for medium- and high-risk actions from that client. Don't rely on Bot approval settings.
- Allowlist redirects exactly. Don't allow wildcard DCR redirects.

---

## 4. Submission, review and listing

| Channel | Process | Review | Timeline | Cost |
|---|---|---|---|---|
| **Grok consumer catalog** (grok.com/connectors tiles) | **No public submission form found.** Tiles are hosted MCP servers that SpaceXAI chooses to surface. [3p: [awesome-grok-connectors](https://github.com/rdmgator12/awesome-grok-connectors), updated 2026-08-12] Reported routes are an x.ai contact-sales or partnership pitch, a public X demo tagging @xai, and community lists. [3p] | Unknown, at SpaceXAI's discretion | Unknown | Unknown |
| **Grok custom connector** (unlisted) | No review. Any user on an eligible plan pastes our URL. | None | Immediate | Free to us |
| **Cursor Marketplace, which Grok Bot reads** | Submit a public repo at cursor.com/marketplace/publish. Checklist: valid manifest, unique kebab-case name, description, valid skill frontmatter, relative paths, committed logo, README, local testing done. ([cursor.com/docs/reference/plugins](https://cursor.com/docs/reference/plugins)) | Manual. Anysphere/Cursor verifies **publisher identity and business legitimacy** and reviews code. It "may approve or reject any application for any reason" and gives no reasons. Plugins must be open source. **Every update is re-reviewed.** ([Publisher Terms](https://cursor.com/marketplace-publisher-terms); [marketplace security](https://cursor.com/help/security-and-privacy/marketplace-security)) | About 1 week typical; no SLA; no status page; decision by email [3p: [Cursor forum](https://forum.cursor.com/t/how-long-does-it-take-to-review-a-plugin-for-the-marketplace/158887)] | Free |
| **Cursor Team Marketplace** (private) | Org admins add plugins for their org (Teams: 1 marketplace; Enterprise: unlimited). Install modes are Default Off, Default On or Required. ([cursor.com/docs/plugins](https://cursor.com/docs/plugins)) | Org admin | Immediate | n/a |
| **Grok Build marketplace** | PR to github.com/xai-org/plugin-marketplace (`external_plugins/`), SHA-pinned | CI plus code-owner review | Unknown | Free |
| **Grok Business/Enterprise** | Customer admin adds a custom MCP in console.x.ai | Customer | Immediate | n/a |

How users discover and enable The Network:
- grok.com: grok.com/connectors (or the + button in the composer, then Connectors, then + Add connector). On mobile: Settings, then Connectors. Once connected, Grok discovers the tools and offers them in the next chat. [official: [x.ai/news/grok-connectors](https://x.ai/news/grok-connectors)]
- Grok Bot: Marketplace in the sidebar, then Add, then auth. Type `@` in a conversation to attach a connector and `/` for skills. ([computer-and-apps](https://docs.x.ai/grok-bot/computer-and-apps))
- Without a catalog listing, discovery depends on us. Put an "Add to Grok" deep-link and how-to on our site, in onboarding SMS and in the web app, and on the Network's own X account.

---

## 5. Policy risks for a people-matching product

### SpaceXAI / Grok
- **Acceptable Use Policy (effective 2026-06-26 per secondary reporting; x.ai/legal returned 403).** It prohibits privacy violations, using others' personal information without permission, sexualization of real people, non-consensual intimate imagery and anything involving minors. [3p summaries: [jlellis.net](https://jlellis.net/blog/privacy-and-content-safety-in-grok-what-lawyers-need-to-know/), [academy.techpresso.co](https://academy.techpresso.co/prompts/grok-nsfw-prompts)]
  - Risk: `network.share_context` sends host-known profile data to us. Make it **member-initiated and member-approved**. Never send third-party personal data, such as the member's contacts, without that person's consent.
  - Risk: tool results must never return other members' PII (GW-001). Opportunity cards should carry only cleared, minimal attributes.
- **Dating, romance or adult framing.** Grok has adult "spicy" modes and companions, but SpaceXAI is under global scrutiny for sexual deepfakes:
  - Indonesia and Malaysia blocked Grok in January 2026, and the Philippines followed; all lifted within weeks. ([CNN 2026-01-12](https://www.cnn.com/2026/01/12/business/indonesia-malaysia-grok-elon-musk-intl-hnk); [eastasiaforum 2026-05-19](https://eastasiaforum.org/2026/05/19/southeast-asias-grok-bans-were-too-little-too-late/))
  - The EU opened a DSA investigation into X/Grok in January 2026. ([The Register 2026-01-26](https://www.theregister.com/2026/01/26/ec_open_new_investigation_into/))

  Implication: keep The Network's Grok-facing copy firmly in "help, introductions, shared interests, local opportunities" language. **Do not position the connector as dating or hookup matching.** Block or neutralize romantic or sexual requests in `network.talk` server-side. Never pass photos of members through the connector.
- **Minors.** The Grok consumer minimum age is **13**, with parental permission for 13 to 17, and age is self-reported. [3p: [Common Sense Media](https://www.commonsensemedia.org/ai-reviews/grok-by-xai)] The Network must enforce its own age gate (presumably 18+) at OAuth sign-in. Never infer adulthood from the Grok account.
- **Sensitive data.** Grok may forward conversation context containing health, sexuality, religion, politics and similar. `share_context` should drop or flag special-category data unless the member explicitly opts in (GDPR Art. 9 posture).
- **No platform-side write confirmation on grok.com** for custom connectors, and Grok Bot acts autonomously. All consent-sensitive actions need Network-side confirmation (GW-004).
- **Cursor Marketplace.** Requires an open-source plugin repo (the manifest and skill, not our server), verified business identity, and re-review of every update. Discretionary rejection with no reasons. A social or people-matching plugin in a developer-centric marketplace may draw scrutiny. Pitch it as a "personal network assistant".

### X (if we run an X bot or touch X data)
- **AI-generated automated replies need prior written approval from X.** Mention-triggered replies are limited to one reply per interaction, only when the user summons the account. Keyword-triggered auto-replies are forbidden. Auto-DMs to new followers are prohibited, and bots may DM only after the user DMs first. Opt-outs must be honored immediately. Accounts need the "Automated" label linked to a human-managed account. Non-API automation (scraping, browser automation) leads to permanent suspension. ([docs.x.com/developer-guidelines](https://docs.x.com/developer-guidelines); [X Developer Policy](https://docs.x.com/developer-terms/policy))
- **Off-X matching** (linking an X handle to a Network member) requires **express opt-in consent** before the association. Sensitive categories must not be inferred, and profiling, tracking or surveillance without consent is prohibited. X content must be deleted or modified within 24h of changes on X. ([docs.x.com/developer-terms/policy](https://docs.x.com/developer-terms/policy); [restricted use cases](https://docs.x.com/developer-terms/restricted-use-cases))
  - This directly constrains any "find people from X for The Network" idea. **Don't do it.**
- **Cost** ([docs.x.com pricing](https://docs.x.com/x-api/getting-started/pricing)):

  | Action | Price |
  |---|---|
  | Create post | $0.015 |
  | Create post with URL | $0.20 |
  | Create summoned reply | $0.010 |
  | Create DM | $0.015 |
  | Read post | $0.005 |
  | Read user | $0.010 |
  | Read DM event | $0.010 |

  Reads are capped at 3M posts per month before Enterprise. The free tier ended for new developers on 2026-02-06. [3p: [medianama](https://www.medianama.com/2026/02/223-x-developer-api-pricing-pay-per-use-model/)] X publishes a DM cap of 500/day per account. [3p: opentweet.io]
- **@grok on X has no third-party hook.** A Network presence on X would be our own labeled bot account. It could answer summoned mentions (pending AI-reply approval) and user-initiated DMs, pointing people to onboarding. **Recommendation: defer.** It's low value, has high policy surface, and posts with links cost $0.20.

### Regional availability
- No official country list exists for Grok Bot or connectors. [3p: [tryagentsonic](https://www.tryagentsonic.com/articles/grok-bot-availability-countries)]
- Grok rolled out across Europe, including in Tesla vehicles in July 2026. Tesla in-car connectors and Grok Bot were announced 2026-09-22 with no EU statement. [3p: [teslant](https://teslant.com/en/news/tesla-grok-bot-connectors-launch-2026-09); [dataconomy 2026-09-23](https://dataconomy.com/2026/09/23/tesla-grok-bot-voice-errands-email-management/)]
- Ongoing EU DSA exposure is a risk for EU members, and country blocks have happened before. Since The Network is US-first, this is acceptable, but gate our own availability server-side.

---

## 6. Testing approach

1. **Local protocol tests:** run the server locally and use MCP Inspector or the MCP conformance tests for `initialize`, `tools/list`, `tools/call` and the 401 plus `WWW-Authenticate` discovery. Unit-test the OAuth endpoints (DCR, PKCE S256, refresh rotation, redirect allowlist rejects unknown URIs).
2. **Public tunnel for Grok:** expose localhost with **ngrok** (supports SSE and gives a stable URL plus an inspector) or **Cloudflare Tunnel** (Streamable HTTP only). Grok rejects localhost and private IPs. ([custom-mcp-tunneling](https://docs.x.ai/grok/connectors/custom-mcp-tunneling)) Prefer a stable staging hostname (`mcp.staging.thenetwork...`) because tunnel URLs change and break connectors.
3. **Observe real OAuth:** with ngrok's inspector, capture exactly what grok.com sends (DCR body, redirect URI, scopes, PKCE). Use this to resolve the open questions in Sections 3 and 8.
4. **Automated model-in-the-loop tests via the xAI API:** a scripted suite calls the Responses API with `type: "mcp"` pointing at staging, using `allowed_tools` and a test-member bearer token. Assertions:
   - Grok picks `get_updates` for "anything new from The Network?"
   - It routes free-form requests to `talk`.
   - It never fabricates opportunities.
   - It handles `needs_confirmation`.
   - It handles 401 and expired tokens gracefully.

   Run against grok-4.7 (and grok-4.3 for cost). Cost is token-only.
5. **In-product grok.com:** use a test Grok account on the eligible plan. Add a Custom connector pointing at staging, sign in as a seeded test member, and run the scripted conversation set on web, iOS, and Android. Then verify disconnect and revoke, and confirm revocation on our side removes access (GW-005).
6. **Grok Business:** use a test org, provision the connector as admin in console.x.ai, and confirm members see it.
7. **Grok Bot:**
   - Install the plugin locally in Cursor (`~/.cursor/plugins/local/the-network`) to validate the manifest and skill.
   - In Grok Bot, add a custom connector (Settings, then Plugins, then Add custom connector, or ask a Bot to add it and confirm the approval card). Run the OAuth flow via `https://www.cursor.com/agents/mcp/oauth/callback`.
   - Test autonomous behavior: give a Bot a standing task ("check The Network every morning and summarize") and confirm high-risk actions are blocked pending Network-side confirmation.
   - Before submitting, test with the connector **disconnected** to verify the error messaging.
8. **Grok Build (optional):** add the plugin from a local marketplace path and run `/marketplace`.
9. **Tool-name compatibility:** confirm the dotted tool names work on grok.com, Grok Bot and the xAI API (`server_label` prefixing).
10. **Abuse and policy red-team:**
    - Prompts asking for other members' details, romantic matching, or sharing third-party contacts.
    - Prompt injection inside opportunity text.
    - Verify server-side refusals.

---

## 7. Concrete checklist

**Server and auth**
- [ ] Public Streamable HTTP endpoint (SSE optional), TLS, stable hostname for staging and prod
- [ ] Four tools with schemas, descriptions and annotations; idempotency keys; durable action IDs
- [ ] Text-only results; two-step `needs_confirmation` protocol; no reliance on MCP Apps or elicitation for Grok
- [ ] Protected-resource and AS metadata; 401 + `WWW-Authenticate` on unauthenticated calls
- [ ] OAuth: Auth Code + PKCE S256, public clients, refresh rotation, minimal scopes, consent screen, 18+ gate
- [ ] DCR with exact redirect allowlist: `https://grok.com/connectors-oauth-exchange-code/`, `https://grok.com/connectors/oauth/callback`, the `www.grok.com` variants (confirm the real ones), `https://www.cursor.com/agents/mcp/oauth/callback`, `http://localhost:8787/callback`
- [ ] Pre-registered static public client IDs for Grok and Cursor (for paste-a-Client-ID forms); CIMD if feasible
- [ ] Per-client token claim and policy (stricter for `grok-bot`); out-of-band confirmation for medium/high-risk actions
- [ ] Revocation UI in The Network; audit receipts per call (PRD 11.1)

**Grok consumer**
- [ ] Verify which plan tiers can add custom connectors
- [ ] Publish an "Add The Network to Grok" help page (URL, Client ID if needed, screenshots, plan note)
- [ ] Test on web, iOS, Android (and Tesla if relevant)
- [ ] Business development outreach to SpaceXAI for catalog listing (partnerships or sales contact)

**Grok Bot (Cursor Marketplace)**
- [ ] Public repo: `.cursor-plugin/plugin.json` (or root `plugin.json`), url-only `mcp.json`, `skills/the-network/SKILL.md`, committed logo, README, license
- [ ] Local test in Cursor; in-app custom-connector test in Grok Bot; disconnected-state test
- [ ] Submit at cursor.com/marketplace/publish as a company (business verification ready)
- [ ] Plan for re-review on every update; keep the plugin thin so server changes don't need re-submission

**X**
- [ ] Decide on an X presence: defer recommended. If pursued: "Automated" label, human-managed link, written approval for AI replies, summoned-only replies, DM only after the user DMs, opt-out handling, budget for pay-per-use
- [ ] Never match X identities to members without express opt-in

**Policy**
- [ ] Non-dating positioning in all Grok and Cursor listing copy
- [ ] Server-side filters for sexual or romantic requests, third-party PII, and special-category data in `share_context`
- [ ] Region gating server-side; monitor EU DSA developments

---

## 8. Open questions

1. **grok.com custom connector auth form:** does it auto-run DCR from metadata, require a pasted Client ID/Secret, or both? Which is the exact redirect URI (`/connectors-oauth-exchange-code/` vs `/connectors/oauth/callback`)? Does it support CIMD? Can it use static header or API-key auth? Official docs only say "complete any required authentication". Resolve by observing via a tunnel.
2. **Plan gating:** is BYO-MCP restricted to SuperGrok or higher? Is it available on X Premium/Premium+ and in Tesla? (x.ai/pricing was not fetchable.)
3. **Does grok.com render MCP Apps UI, support elicitation, or show per-call write confirmations?** Nothing official found.
4. **Is there any formal SpaceXAI partner program or catalog submission for third-party connectors?** None found. Is a Cursor Marketplace listing automatically surfaced in grok.com's catalog? Evidence suggests no: these are separate catalogs.
5. **Grok Bot non-Cursor users:** for SuperGrok-linked users, is the Marketplace identical to Cursor's public marketplace? (Docs imply yes.)
6. Do the dotted tool names (`network.talk`) pass name validation on each surface?
7. **Can connectors be invoked from @grok on X or Grok inside the X app?** Not documented. Assume no.
8. **Data retention:** for custom connectors, does SpaceXAI store tool results in chat history, and does its "we do not train on your data" statement (made for Gmail/Calendar) extend to custom MCP results? This matters for our privacy disclosures.
9. **Tool count and size limits, timeouts, and per-user rate limits on Grok's MCP client side:** none documented. Measure them.
10. **SpaceXAI AUP text:** fetch the canonical text (x.ai/legal/acceptable-use-policy, reported effective 2026-06-26) manually and have counsel review the people-matching use case.

---

## 9. Sources

Official (SpaceXAI / xAI)
- Grok Connectors docs: https://docs.x.ai/grok/connectors (accessed 2026-10-05)
- Connector Management (Business/Enterprise): https://docs.x.ai/grok/connector-management (accessed 2026-10-05)
- Custom MCP tunneling: https://docs.x.ai/grok/connectors/custom-mcp-tunneling (accessed 2026-10-05)
- Gmail & Google Calendar connector: https://docs.x.ai/grok/connectors/gmail-google-calendar (accessed 2026-10-05)
- Connectors launch announcement: https://x.ai/news/grok-connectors (published 2026-05-06)
- Remote MCP Tools (xAI API): https://docs.x.ai/docs/guides/tools/remote-mcp-tools (accessed 2026-10-05)
- API pricing: https://docs.x.ai/developers/pricing (accessed 2026-10-05)
- API rate limits: https://docs.x.ai/developers/rate-limits (accessed 2026-10-05)
- Grok Bot overview: https://docs.x.ai/grok-bot/overview (accessed 2026-10-05)
- Grok Bot computer and apps (connectors): https://docs.x.ai/grok-bot/computer-and-apps (accessed 2026-10-05)
- Grok Bot for teams and enterprises: https://docs.x.ai/grok-bot/teams-and-enterprises (accessed 2026-10-05)
- Grok Bot approvals, security and privacy: https://docs.x.ai/grok-bot/approvals-security-and-privacy (accessed 2026-10-05)
- Grok Build plugin marketplace repo: https://github.com/xai-org/plugin-marketplace (accessed 2026-10-05)

Official (Cursor, which distributes Grok Bot plugins)
- Plugins: https://cursor.com/docs/plugins (accessed 2026-10-05)
- Plugins reference and submission checklist: https://cursor.com/docs/reference/plugins (accessed 2026-10-05)
- MCP (transports, static OAuth, redirect URIs): https://cursor.com/docs/mcp (accessed 2026-10-05)
- Grok Bot plans: https://cursor.com/help/grok-bot/plans (accessed 2026-10-05)
- Marketplace Publisher Terms: https://cursor.com/marketplace-publisher-terms (accessed via search 2026-10-05)
- Marketplace security: https://cursor.com/help/security-and-privacy/marketplace-security (accessed via search 2026-10-05)
- Static CLIENT_ID fix for Grok Bot (staff reply 2026-08-18): https://forum.cursor.com/t/grok-bot-custom-mcp-needs-static-oauth-client-id-blocks-oracle-netsuite/168121
- Review timing: https://forum.cursor.com/t/how-long-does-it-take-to-review-a-plugin-for-the-marketplace/158887

Official (X)
- X API pricing: https://docs.x.com/x-api/getting-started/pricing (accessed 2026-10-05)
- Developer Guidelines (automation, AI replies, DMs): https://docs.x.com/developer-guidelines (accessed 2026-10-05)
- Developer Policy (off-X matching, consent, deletion): https://docs.x.com/developer-terms/policy (accessed 2026-10-05)
- Restricted use cases: https://docs.x.com/developer-terms/restricted-use-cases (accessed via search 2026-10-05)
- Automated account labels: https://help.x.com/en/using-x/automated-account-labels (403 to fetch; content via search 2026-10-05)
- Automation rules: https://help.x.com/en/rules-and-policies/x-automation (403 to fetch)

Third-party / press (verify before relying)
- SpaceXAI (Wikipedia): https://en.wikipedia.org/wiki/SpaceXAI (accessed 2026-10-05)
- VentureBeat, Grok Bot launch (2026-08-11): https://venturebeat.com/orchestration/spacexais-grok-bot-turns-agents-into-persistent-digital-coworkers-that-can-operate-your-apps-for-120-per-month
- Dropbox and SpaceXAI, Cursor Marketplace + Grok Bot (2026-09-24): https://blog.dropbox.com/topics/company/dropbox-spacexai-project-context-cursor-marketplace-grok-bot
- awesome-grok-connectors (updated 2026-08-12): https://github.com/rdmgator12/awesome-grok-connectors
- awesome-grok-bot (verified 2026-10-04): https://github.com/ZeroPointRepo/awesome-grok-bot
- How to create a Grok Bot plugin, Notra (2026-09-09): https://www.usenotra.com/blog/how-to-create-a-grok-bot-plugin
- PearMCP Grok setup (Grok Web OAuth/PKCE, redirect URI): https://pearmcp.com/guides/grok
- Posterly Grok Bot guide (2026-09-22): https://www.poster.ly/guides/grokbot-guide
- Scrapeless Grok Bot custom connector (2026-09-14): https://www.scrapeless.com/en/blog/grok-bot-scrapeless-connector
- unraid issue #390, Grok DCR redirect (2026-09-06): https://github.com/dinglebear-ai/unraid/issues/390
- OpenMSP PR #15, Grok requires OAuth PKCE (2026-09-21): https://github.com/tavbuilds/OpenMSP/pull/15
- robowrite issue #4, CIMD/DCR per host (2026-09-18): https://github.com/RoboAdApp/robowrite-plugin/issues/4
- Context Link, Grok custom connector paid tier: https://www.context-link.ai/blog/grok-custom-connector
- Carly, Grok MCP (2026-08-27): https://www.usecarly.com/blog/grok-mcp/
- ismcpgoodyet tracker (data through 2026-08-22): https://ismcpgoodyet.com/
- MCP Apps host list (2026-01-26): https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/
- OpenTweet, Grok Bot X connector read-only (2026-08-29 ship date): https://opentweet.io/how-to/give-grok-bot-the-ability-to-post-to-x
- Tesla Grok Bot and Connectors (2026-09-22/23): https://driveteslacanada.ca/news/tesla-grok-bot-hands-free-ai-tasks/ ; https://dataconomy.com/2026/09/23/tesla-grok-bot-voice-errands-email-management/ ; https://teslant.com/en/news/tesla-grok-bot-connectors-launch-2026-09
- Grok Bot availability by country: https://www.tryagentsonic.com/articles/grok-bot-availability-countries
- Grok Build marketplace launch (2026-06-11): https://tesorb.com/grok-build-plugin-marketplace-xai-developer-platform/
- Grok Outlook write permissions without per-message confirm: https://explainx.ai/blog/xai-grok-outlook-mail-read-write-connectors-2026
- Common Sense Media, Grok age 13+: https://www.commonsensemedia.org/ai-reviews/grok-by-xai
- xAI AUP summaries: https://jlellis.net/blog/privacy-and-content-safety-in-grok-what-lawyers-need-to-know/ ; https://academy.techpresso.co/prompts/grok-nsfw-prompts
- Indonesia/Malaysia Grok blocks (2026-01-12): https://www.cnn.com/2026/01/12/business/indonesia-malaysia-grok-elon-musk-intl-hnk ; https://eastasiaforum.org/2026/05/19/southeast-asias-grok-bans-were-too-little-too-late/
- EU DSA investigation (2026-01-26): https://www.theregister.com/2026/01/26/ec_open_new_investigation_into/
- X pay-per-use, free tier end (2026-02): https://www.medianama.com/2026/02/223-x-developer-api-pricing-pay-per-use-model/
- X AI reply bot approval (summary): https://vorplabs.com/agent-tools/x-api ; https://devcommunity.x.com/t/how-do-i-get-ai-bot-account-approval/264768
