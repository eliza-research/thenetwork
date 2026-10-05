# ChatGPT: build, test, submit and list The Network connector

Research date: 2026-10-05. Scope: OpenAI's MCP-based app platform (formerly "Apps SDK apps", now **plugins**). It covers the four-tool connector in PRD Section 11 (`network.talk`, `network.share_context`, `network.get_updates`, `network.respond`).

Each claim carries a source tag such as [O3]. Section 10 maps every tag to its URL and date. "Accessed" means the date I read the page. OpenAI's developer docs don't show per-page dates, so their changelog [O9] is the dating reference. Claims from third-party sources are marked *(secondary)*.

---

## 0. TL;DR for the team

1. **Naming changed.** On 2026-07-09 OpenAI renamed ChatGPT "apps" to **plugins** and replaced the App Directory with a **Plugin Directory** that ChatGPT and Codex share [O13 *(secondary)*, O2]. The docs moved from `/apps-sdk` to `/plugins` [O1]. Under the hood it's still a remote MCP server plus optional UI and optional skills [O2]. A submission is now a **ZIP package** (`plugin.json` plus an optional MCP server reference and skills) uploaded at `platform.openai.com/plugins` [O4, O7].
2. **Auth is OAuth 2.1 per the MCP authorization spec.** ChatGPT prefers **CIMD** (Client ID Metadata Documents) and falls back to DCR. It requires PKCE S256 advertised in metadata, the RFC 8707 `resource` parameter echoed into the token audience, and RFC 9207 `iss` for stable callbacks [O5]. It doesn't support machine-to-machine grants or API keys [O5].
3. **UI is the open MCP Apps standard** (`ui://` resources, `text/html;profile=mcp-app`), plus optional `window.openai` extensions. ChatGPT has been fully MCP Apps compatible since 2026-02-22 [O6, O9]. One UI codebase can serve ChatGPT and Claude.
4. **Our tool design has three review risks.**
   - (a) `network.talk` is a free-text "do anything" tool. The guidelines say "Expose each model-callable operation as a separate tool" and ban "generic executors" [O3].
   - (b) `network.share_context` must not take "full conversation history, raw chat transcripts, or broad contextual fields" [O3].
   - (c) Responses must exclude internal IDs and timestamps that aren't needed [O3], which pulls against GW-003's durable action IDs.

   See Section 6.
5. **Reviewer access conflicts with our login.** Reviewers need a fully populated demo account that works "without MFA, email codes, or magic links" [O4]. Our login is invite plus phone OTP (PRD 9.1). We need a reviewer-only password (or equivalent) login path on the authorization server.
6. **No monetization through ChatGPT applies to us.** Physical goods only. No digital goods, subscriptions, upsells or ads [O3, O8]. Labeled sponsored opportunities (PRD 6.1 and 18) are an advertising risk inside the connector.
7. **Recommendation:** run the pilot through **developer mode / workspace custom plugins**, not a public listing. Submit to the Plugin Directory only once (a) the tool surface passes the checks in Section 6 and (b) invite-only sign-up isn't a dead end for directory users.

---

## 1. Platform model (Oct 2026)

| Concept | What it is | Source |
|---|---|---|
| Plugin | "the packages people discover, install, share, and publish in ChatGPT and Codex." It can combine skills, one MCP server and UI resources. | [O2] |
| Directory | "ChatGPT and Codex share one universal plugin directory." It covers ChatGPT, Codex and ChatGPT Work. | [O2] |
| MCP server | The tool surface. Streamable HTTP, usually at `/mcp`. | [O10] |
| Skill | `skills/<name>/SKILL.md` with `name`/`description` frontmatter. It guides the model through workflows. | [O7] |
| UI | An MCP Apps resource rendered in a sandboxed iframe and bridged to the host by JSON-RPC over `postMessage`. | [O6] |
| Constraint | "Only one MCP server can connect per plugin." | [O4] |
| Constraint | Changing the MCP server **origin** requires an entirely new plugin submission. | [O11] |

History, for context:
- 2025-10-06: Apps SDK launched in preview. Apps were available to logged-in Free, Go, Plus and Pro users outside the EEA, Switzerland and the UK [O14 *(secondary summary of OpenAI post)*].
- 2025-12-17: app submissions opened and the App Directory launched at chatgpt.com/apps [O15 *(secondary)*].
- 2026-02-22: full MCP Apps compatibility [O9].
- 2026-03-25: approved Apps SDK integrations distributed as Codex plugins [O9].
- 2026-07-09: renamed to plugins and the Plugin Directory introduced [O13 *(secondary)*].
- 2026-08-21: stable OAuth callbacks and CIMD client IDs [O9].

**Implication: choose the production MCP origin once**, for example `https://mcp.<our-domain>/mcp`. An origin change means a new listing [O11]. The MCP Apps sandbox domain is derived from it too (see the Claude doc).

---

## 2. Build guide (step by step)

### 2.1 Plan the tools
- Map each use case to tools. Keep **reads and writes separate**: "Separate read and write behavior so the model and user can distinguish information retrieval from actions that change state." [O12]
- Tool names should be "Human-readable, specific, and descriptive… ideally as a verb", with no internal jargon or opaque identifiers [O3].
- "Each public tool must operate independently. Do not instruct the model to invoke another plugin." [O3]

### 2.2 Build the MCP server
1. SDK: TypeScript `npm install @modelcontextprotocol/sdk zod`, or Python `pip install mcp` [O10].
2. Create `new McpServer({ name, version })` with a stable name and version [O10].
3. Add **server `instructions`**. ChatGPT reads server instructions for workflow guidance (since 2026-05-26 [O9]). Put "the most important details in the first 512 characters." [O10] This is the natural home for the PRD 11.1 behavior contract: search first, treat data as private, confirm consequential actions.
4. Register each tool with `registerTool()` [O10]:
   - name and human `title`
   - description: when to use it and its limits
   - `inputSchema`
   - `outputSchema` (docs show it since 2026-05-06 [O9])
   - `annotations` with **explicit booleans** for `readOnlyHint`, `destructiveHint` and `openWorldHint` (all required for review [O3, O11])
   - optional `idempotentHint` [O16]
5. Return three parts [O10]:
   - `structuredContent`: concise data the model reads
   - `content`: text
   - `_meta`: data the model doesn't see, for UI or client use

   Use stable identifiers so later tools can reference records [O10].
6. Expose a Streamable HTTP endpoint at `/mcp` [O10]. Deploy at a stable public HTTPS endpoint with logging and metrics [O10].
7. Optional ChatGPT tool `_meta` [O16]:
   - `openai/toolInvocation/invoking` and `openai/toolInvocation/invoked`: status strings of 64 characters or fewer
   - `ui.visibility`: `model`, `app` or both. The legacy `openai/visibility` was deprecated on 2026-07-21 [O9].
   - `openai/fileParams`

### 2.3 Package as a plugin (needed for directory submission)
Layout [O7]:
```
plugin-root/
  plugin.json        (required; Agent Plugins schema)
  mcp.json           (optional; "mcpServers": { type: "streamable-http", url })
  skills/<name>/SKILL.md
  assets/
  hooks/
  .codex-plugin/     (optional compatibility fallback)
```
Key `plugin.json` fields [O7]:
- `name` (kebab-case), `version` (semver), `description`, `author`
- under `extensions.com.openai`, the `interface.*` fields: `displayName`, `shortDescription`, `longDescription`, `category`, `capabilities`, `defaultPrompt`, `developerName`, `brandColor`, `logo`, `composerIcon`, `screenshots`, `websiteURL`, `privacyPolicyURL`, `termsOfServiceURL`

Listing limits in the dashboard [O4]:
- plugin name: 64 characters or fewer
- display name: 30 or fewer
- subtitle: 30 or fewer
- long description: 4000 or fewer
- up to 3 default prompts, each 128 characters or fewer

Country targeting uses `publication.countries` with uppercase ISO codes [O4].

Claude Code plugin conversion: the portal converts `.claude-plugin/plugin.json` into `.codex-plugin/plugin.json`. Skills can be reused if Claude-specific wording is replaced with "the model". An MCP server must be deployed and submitted separately; you "can't submit an existing MCP server integration by reference" [O17]. **We can keep one skill source of truth across both ecosystems.**

---

## 3. Auth (OAuth 2.1) — exact requirements

ChatGPT follows MCP authorization spec 2025-11-25 [O5]. The spec's normative details are summarized in the Claude doc. ChatGPT-specific points follow.

**Protected resource metadata (RFC 9728)** at `https://<mcp>/.well-known/oauth-protected-resource` [O5]:
- `resource` is the canonical HTTPS server identifier. "ChatGPT sends this exact value as the `resource` query parameter during OAuth."
- `authorization_servers` lists issuer URLs.
- `scopes_supported` is optional.
- Unauthenticated requests get `WWW-Authenticate: Bearer resource_metadata="…", scope="…"`.

**Authorization server metadata (RFC 8414 / OIDC discovery)** [O5]:
- `issuer` must exactly match the value in `authorization_servers`.
- `code_challenge_methods_supported` must include `"S256"`. "MCP servers are unsupported when their authorization server metadata omits this field."
- `authorization_endpoint` and `token_endpoint` are required.
- For CIMD: `client_id_metadata_document_supported: true` and `token_endpoint_auth_methods_supported: ["none", "private_key_jwt"]`.
- `registration_endpoint` is only needed for DCR.
- `authorization_response_iss_parameter_supported: true` only if `iss` is returned on **every** authorization response (RFC 9207).

**Client registration** [O5]:
- **CIMD (preferred).** ChatGPT's `client_id` is an HTTPS URL: `https://chatgpt.com/oauth/client.json`, or `https://chatgpt.com/oauth/{callback_id}/client.json`. Auth method is `none` (public client plus PKCE) or `private_key_jwt`, verified against ChatGPT's JWKS at `/oauth/jwks.json`.
- **DCR.** "ChatGPT runs DCR once per MCP server connection, then keeps and reuses the registered OAuth client." Don't expire those clients, or users get `invalid_client`.

**Redirect URIs** [O5]:
- With issuer identification (recommended): `https://chatgpt.com/connector_platform_oauth_redirect`
- Without it: `https://chatgpt.com/connector/oauth/{callback_id}`
- Allowlist the exact value shown on the server's management page.

**Token validation on every request** [O5]:
- Check JWKS signature, `iss`, `exp`/`nbf`, and `aud` or `resource` against our server, plus required scopes.
- On failure, return 401 with `WWW-Authenticate`.
- The authorization server must copy the `resource` parameter into the token (usually `aud`).

**Per-tool auth and the sign-in trigger** [O5]:
- Declare `securitySchemes` per tool: `{type:"noauth"}` or `{type:"oauth2", scopes:[…]}`.
- On an auth failure inside a tool, return `isError: true` plus `_meta["mcp/www_authenticate"]` with a Bearer challenge that includes `error` and `error_description`.
- All three pieces (resource metadata, `securitySchemes`, the runtime challenge) must exist for the sign-in UI to appear.

**OIDC scopes.** If discovery advertises `openid`/`email`/`profile`, "ChatGPT requests those scopes by default". Enable them on the client or the flow fails [O5].

**Multi-account.** An optional read-only profile tool with `_meta["openai/profile"]: true` returns a stable opaque `id`, `name`, `email` and `nickname` [O5]. This is useful later for members with multiple personas, but it isn't needed for MVP.

**Identifying ChatGPT traffic** [O5]:
- mTLS client certificate with SAN `mtls.prod.connectors.openai.com`
- published egress IPs
- or CIMD `private_key_jwt`

**Recommended identity providers.** Auth0 and Stytch support CIMD, DCR, PKCE and metadata [O5].

**Network-specific auth plan** (for the teammate's design):
- Our own authorization server issues tokens bound to `resource=https://mcp.<domain>/mcp`.
- The login page runs invite plus phone OTP for real members.
- A separate **reviewer login** (password, no OTP) is tied to a seeded demo member, for the "works immediately without MFA" requirement [O4].
- Scopes map to PRD minimal scopes, e.g. `network:talk`, `network:context.write`, `network:updates.read`, `network:respond`. Return 403 `insufficient_scope` for step-up.
- Revocation (GW-005) is handled server-side. ChatGPT handles revocation and refresh "gracefully" if we return 401 [O5].

---

## 4. UI options

| Option | What it gives us | Notes |
|---|---|---|
| **No UI** (text plus `structuredContent`) | Works everywhere, including Codex. Smallest review surface. | Recommended for v1 of the connector. |
| **MCP Apps resource** | Inline card, inline carousel, fullscreen or PiP rendered in a sandboxed iframe [O6] | Tool `_meta.ui.resourceUri` points to a `ui://…` resource served as `text/html;profile=mcp-app`. The bridge uses `ui/initialize`, `ui/notifications/tool-input`, `ui/notifications/tool-result` and `tools/call` [O6]. |
| `window.openai` extensions | `toolInput`/`toolOutput`, `callTool`, `sendFollowUpMessage`, `widgetState`/`setWidgetState`, `requestDisplayMode`, `requestModal`, `requestClose`, `uploadFile`, `selectFiles`, `getFileDownloadUrl`, `requestCheckout` [O6, O16] | Feature-detect: "Avoid branching on a host or product name. Test for the capability your UI needs." [O6] |

UI rules that matter for an opportunity card (PRD 10.3) [O18]:
- Inline card: at most two actions at the bottom, no nested scrolling, no deep navigation.
- Carousel: 3 to 8 items, metadata of three lines at most, one optional CTA per item.
- Inherit system fonts.
- Brand color only on accents.
- WCAG AA contrast.

So **Interested / Maybe later / Not for me / Why did you ask me?** (four actions) breaks the two-action rule as-is. Show two primary actions and move the rest to a follow-up message or a fullscreen view.

Resource `_meta` [O16]:
- `ui.csp`: `connectDomains`, `resourceDomains`, and `frameDomains` (restricted, needs justification [O3])
- `ui.domain`: dedicated origin, **required for plugins with UI**
- `ui.prefersBorder`
- `openai/widgetDescription`

Architecture advice from OpenAI: keep data tools (return `structuredContent`) separate from **render tools** (own the `resourceUri`) [O6]. That fits our opaque design. `get_updates` returns data, and an optional `show_opportunity_card` render tool renders it.

---

## 5. Submission and review checklist

### 5.1 Prerequisites
- [ ] Organization has completed **individual or business verification** in platform settings [O3, O4].
- [ ] Submitter is an org Owner or has the **Apps Management Write** permission [O4].
- [ ] Customer support contact is published and kept current [O3].
- [ ] Public **privacy policy** covers the data categories collected, purposes, recipient categories, retention and user controls [O3]. Also a website URL, a support/help URL and terms of service [O4].

### 5.2 Technical
- [ ] Remote MCP server on a public HTTPS URL, Streamable HTTP [O10].
- [ ] **Domain verification**: host the challenge token as plain text at `https://<host>/.well-known/openai-apps-challenge` [O4].
- [ ] Automated **tool scan** completes with no connection failures [O4].
- [ ] Every tool has explicit `readOnlyHint`, `destructiveHint` and `openWorldHint` that match its behavior [O3, O11].
- [ ] CSP is declared for any UI, with no fetches to undeclared domains [O11, O19 *(secondary)*].
- [ ] Works on ChatGPT **desktop and mobile** [O3]. Test consistency in Codex too [O11].
- [ ] Error messages are clear, including for unexpected errors [O3].

### 5.3 Review materials [O4]
- [ ] **5 positive test cases**: scenario, prompt, expected tools, expected result.
- [ ] **3 negative test cases**: when the plugin should *not* act or should refuse.
- [ ] Dedicated **test account with sample data**. It must work immediately with no MFA, email codes or magic links. Enter credentials in the dashboard's secure form, not the package.
- [ ] **Video walkthrough** of the test cases.
- [ ] Release notes.
- [ ] Logo (required). Optional dark-theme variants and screenshots.
- [ ] Policy attestations at submit time.

### 5.4 Process [O4, O11]
1. Upload the ZIP at `platform.openai.com/plugins` and fix any package validation errors.
2. Resolve metadata, skills and MCP checks in the Issues panel. Use "Copy issues" to export findings.
3. Submit for review. Only one active review per plugin is allowed.
4. Feedback arrives by email. To appeal, reply to that email "with a clear rationale and any new information" [O11].
5. After approval, **you choose when to publish**.
6. After publishing:
   - Package changes (metadata, skills) need a new ZIP and a new review.
   - **Tool changes** are picked up by daily scans. New tools go live after automated checks. Modified tools keep the old definition until checks pass. Deleted tools are removed immediately. You can request a rescan [O4, O11].

### 5.5 Common rejection reasons
Official [O11]:
- connectivity or credential failures, including MFA
- test-case mismatches
- unreported user data or PII in responses
- annotation mismatches

Secondary [O19, O20]:
- generic names
- missing mobile in the demo video
- privacy policy gaps
- dark-mode and contrast UI bugs
- digital-goods selling
- demo or incomplete apps

---

## 6. Policy risks specific to The Network

| # | Risk | Guideline | Severity | Mitigation for the connector design |
|---|---|---|---|---|
| R1 | **`network.talk` is a generic free-text executor** that reads, writes, changes preferences and accepts or declines | "Expose each model-callable operation as a separate tool"; no "generic executors with operation selection" [O3]. "Separate read and write behavior" [O12]. "Side effects should never be hidden or implicit" [O3] | **High** | (a) Annotate `talk` honestly as a write tool (`readOnlyHint:false`, `destructiveHint:false`, `openWorldHint:false`). (b) Describe it narrowly: "Send the member's message to their Network agent. May update the member's own preferences; never contacts other people without a separate confirmation." (c) Consider splitting it into `ask_network_agent` (read-only Q&A) and `tell_network_agent` (writes preferences or state). Keep accept/decline exclusively in `respond`. (d) The Network server must never perform a contact-other-people action from `talk` alone. Return a pending item that needs `respond` plus server-side confirmation (GW-004). |
| R2 | **`network.share_context`** could take "everything the assistant knows" | No "full conversation history, raw chat transcripts, or broad contextual fields"; no "accumulated conversation context"; "Gather only the minimum data"; no "just in case" fields [O3]. "Must not pull, reconstruct, or infer the full chat log" [O3] | **High** | Typed, narrow fields with per-field descriptions, e.g. `interests[]`, `goals[]`, `city` (coarse), `availability_note`. No `conversation_summary` or free-form `profile_blob`. The description should say it is used only with explicit member approval. |
| R3 | **Location** | Coarse location only; no GPS or precise addresses in inputs; get location "through the client's controlled side channel" [O3] | Medium | City or neighborhood only. Exact addresses stay inside The Network's mutual opt-in flow (PRD 10.3) and are never in tool I/O. |
| R4 | **Response minimization vs GW-003 action IDs** | Exclude "session IDs, trace IDs, request IDs, timestamps" that aren't needed [O3]. Reviewers reject unnecessary PII and telemetry IDs [O11] | Medium | Put durable action and receipt IDs in `_meta` (not model-visible) or return a short opaque `item_id` that the model needs for `respond`. Leave out internal trace IDs. |
| R5 | **Other members' data in responses** (opportunity cards mention people) | Privacy policy must cover data returned. "Unreported user data returned" is a rejection reason [O11] | Medium | Return only cleared, minimized descriptors, such as first name or pseudonym and the shared context, per GW-001. Disclose this category in the privacy policy. |
| R6 | **Romance opt-in** (PRD 6.1 and 8) and "relationship formation" | Plugins must be suitable for ages 13 to 17. No mature 18+ content until age verification exists [O3]. Prohibited goods include adult content and sexual services [O3] | Medium | Don't position the listing as dating. Keep connector copy and cards non-sexual. Consider excluding the romantic category from the connector surface until OpenAI ships age verification. The Network itself is 18+ (PRD Section 17), which our auth enforces, but the *listing* still needs to be all-ages appropriate. |
| R7 | **Sponsored or underwritten opportunities** (PRD 6.1, 18) | "Plugins must not serve advertisements" or exist "primarily as an advertising vehicle" [O3] | Medium | Exclude sponsored items from `get_updates` in ChatGPT, or ensure they are member-requested, labeled and incidental. Get a policy read before listing. |
| R8 | **Paid member services** (PRD 18) | Commerce only for physical goods. No digital products, subscriptions, upsells, or checkout links that start a purchase [O3, O8] | Low (not MVP) | The connector never initiates payment and never links to checkout. |
| R9 | **Proactive suggestions** ("The Network has an opportunity relevant…", PRD 11.3) | "Respect user intent… No unrelated content insertion"; no metadata that tries to "manipulate how the model selects" tools [O3] | Medium | Don't put "always call get_updates" wording in tool descriptions or instructions. Phrase it as "use when the member asks what's new from The Network, or agreed to check in". |
| R10 | **Invite-only product in a public directory** | Must "serve a clear purpose" and be complete; demo or trial apps are rejected [O3]. Signup isn't required for reviewers (they get the test account) [O4] | Medium | Listing is permitted, but directory users without an invite hit a dead end. Show a clear "invite required" state on the authorization server, or delay the listing (see recommendation). |
| R11 | **Tool name format** `network.talk` | Names must be plain-language verbs without jargon [O3]. Dots are legal in MCP [C-spec, see Claude doc] but unusual | Low | Use `ask_network_agent` and `tell_network_agent` (or a single `talk_to_network_agent`), plus `share_profile_with_network`, `get_network_updates` and `respond_to_network_item` (also required for the Claude API regex; see the Claude doc). |
| R12 | **Data residency and regions** | Apps launched outside the EEA, CH and UK [O14 *(secondary)*]. Per-plugin `publication.countries` [O4] | Low (MVP is SF and NYC) | Set `publication.countries: ["US"]` at first. |

Annotation proposal (each value to be confirmed against final behavior):

| Tool | readOnlyHint | destructiveHint | openWorldHint | Rationale |
|---|---|---|---|---|
| get_network_updates | true | false | false | Retrieval from a bounded private account [O3] |
| talk_to_network_agent | false | false | false | Can change state (preferences or queued requests). Additive, and not irreversible on its own [O3] |
| share_profile_with_network | false | false | false | Persists data [O3]. If it *overwrites* profile fields, OpenAI says set `destructiveHint:true` ("overwriting… Being able to undo… does not justify false") [O3] |
| respond_to_network_item | false | **true** if a "decline" or "not for me" is irreversible or cancels; otherwise false | false | Cancellation counts as destructive [O3] |

---

## 7. Testing approach

1. **Local protocol tests**: `npx @modelcontextprotocol/inspector@latest`, transport **Streamable HTTP**, URL `http://localhost:3000/mcp`. Verify initialization, the tool list, schemas, annotations and auth enforcement [O10, O21]. Use the Inspector's Auth settings to debug OAuth [O5].
2. **Raw request and response logs**: in the API Playground at platform.openai.com, go to **Tools → Add → MCP Server** and run prompts [O21].
3. **Tunnel a local server**: ngrok or Cloudflare Tunnel, or ChatGPT's **Secure MCP Tunnel** (`tunnel_id`) option in the create dialog [O21].
4. **In ChatGPT (developer mode)**:
   - In **ChatGPT Plugins**, choose **+ → Create custom MCP server**, then enter the name, description and URL with `/mcp`, or choose **Tunnel**. Configure auth and accept the risk warning, then choose **Create as a plugin** and review the discovered tools [O21].
   - After a deploy, use **Refresh** on the connection and start a new conversation [O21].
   - Plan eligibility for developer mode: OpenAI's help article says apps with full MCP (write) support and developer mode are for **Business and Enterprise/Edu** on web [O22]. Third-party guides say Plus and Pro can enable developer mode under Settings → Apps & Connectors → Advanced, but get read/fetch-only custom connectors [O23 *(secondary)*]. **Verify against a live account before relying on Plus for write-tool tests.** Use a Business workspace for testing.
5. **Mobile**: required for review [O3]. Test the published or workspace plugin on iOS and Android, since developer-mode creation is web-only [O23 *(secondary)*].
6. **Codex**: plugins also surface in Codex, and reviewers check consistency [O11]. Install locally with `codex plugin marketplace add …` [O7].
7. **Dogfood**: gate tools to trusted testers before broad rollout. Test token rotation, revocation and scope changes [O5].
8. **Pre-submission dry run**: run the 5 positive and 3 negative cases verbatim on the demo account on desktop and mobile, and record the video.

---

## 8. Timelines (expectations)

| Phase | Estimate | Basis |
|---|---|---|
| OAuth AS with CIMD/DCR, PKCE, `iss` and `resource` audience | 1–2 weeks with a managed IdP (Auth0 or Stytch); longer if custom | Engineering estimate; IdP support per [O5] |
| MCP server, 4 tools, no UI | ~1 week | Engineering estimate |
| MCP Apps card (optional) | 1–2 weeks | Engineering estimate |
| Org verification | Days | Required before submission [O3, O4]; no official SLA |
| Review | **Not published.** "Review timelines may vary"; no expedited reviews [O11]. Developers report days to weeks [O19, O20], and some report over a month [O24] | Plan for 2–6 weeks, including one rejection cycle |
| Post-publish tool changes | Daily scan, or an on-demand rescan [O4] | No re-review for tool changes that pass automated checks |

---

## 9. Comparable approved listings (precedent)

From a community-maintained index of the directory (unofficial; snapshot 2026-07-02) [O25 *(secondary)*]:
- **LinkedIn**: look up professionals and link to profiles [O25, O26]
- **Happenstance**: "network search across LinkedIn, Twitter, and contacts" for warm-intro paths [O25]
- **4Degrees**: "Find the warmest path to a target contact through your professional network" [O25]
- **Super Carl**: "relationship intelligence for contacts" [O25]
- **OK幹事**: group event scheduling with friends [O25]
- **italki**: tutor matching [O25]

None of these is a consumer dating or matching product. The closest precedents are **professional warm-intro and relationship-intelligence apps**. That suggests a listing framed as "your personal network agent: introductions, help, things to do" fits accepted categories, and a dating framing has no precedent. I found no official statement on dating apps (searched 2026-10-05).

---

## 10. Sources

All accessed 2026-10-05 unless noted.

| Tag | Source | URL | Date info |
|---|---|---|---|
| O1 | OpenAI Plugins docs (landing; `/apps-sdk` now serves `/plugins` nav) | https://developers.openai.com/apps-sdk → https://developers.openai.com/plugins | accessed 2026-10-05 |
| O2 | Plugins concept page | https://developers.openai.com/plugins/concepts/plugins | accessed 2026-10-05 |
| O3 | Plugin submission guidelines | https://developers.openai.com/plugins/plugin-guidelines (fetched via /apps-sdk/app-submission-guidelines) | accessed 2026-10-05 |
| O4 | Submit your plugin | https://developers.openai.com/plugins/deploy/submission | accessed 2026-10-05 |
| O5 | Authentication | https://developers.openai.com/plugins/build/auth | accessed 2026-10-05; CIMD/stable callbacks dated 2026-08-21 in [O9] |
| O6 | Build ChatGPT UI | https://developers.openai.com/plugins/build/chatgpt-ui | accessed 2026-10-05 |
| O7 | Build plugins (package format) | https://developers.openai.com/plugins/build/plugins | accessed 2026-10-05 |
| O8 | Monetization | https://developers.openai.com/plugins/build/monetization | accessed 2026-10-05 |
| O9 | Plugins changelog | https://developers.openai.com/plugins/changelog | entries 2025-11-04 … 2026-08-21; accessed 2026-10-05 |
| O10 | Build an MCP server | https://developers.openai.com/plugins/build/mcp-server | accessed 2026-10-05 |
| O11 | App review (remote MCP review requirements) | https://developers.openai.com/plugins/deploy/app-review | accessed 2026-10-05 |
| O12 | Plan tools | https://developers.openai.com/plugins/plan/tools | accessed 2026-10-05 |
| O13 | Third-party summaries of the 2026-07-09 rename (search result synthesis; OpenAI help article 403'd to fetch) | https://help.openai.com/en/articles/20001256-plugins-in-codex ; https://www.taskade.com/blog/chatgpt-plugins | rename dated 2026-07-09; accessed 2026-10-05 |
| O14 | "Introducing apps in ChatGPT and the new Apps SDK" (fetch blocked; summarized via search) | https://openai.com/index/introducing-apps-in-chatgpt/ | 2025-10-06 |
| O15 | "Developers can now submit apps to ChatGPT" (fetch blocked; via Skift, etc.) | https://openai.com/index/developers-can-now-submit-apps-to-chatgpt/ ; https://skift.com/2025/12/18/chatgpt-openai-opens-apps-developers/ | 2025-12-17/18 |
| O16 | Reference (`_meta` keys, `window.openai`) | https://developers.openai.com/plugins/reference | accessed 2026-10-05 |
| O17 | Submit a Claude plugin to OpenAI | https://developers.openai.com/plugins/guides/submit-claude-plugin | accessed 2026-10-05 |
| O18 | UI guidelines | https://developers.openai.com/plugins/concepts/ui-guidelines | accessed 2026-10-05 |
| O19 | Alpic, "Why your ChatGPT App is getting rejected" *(secondary)* | https://alpic.ai/blog/why-your-chatgpt-app-is-getting-rejected-and-what-you-can-do-about-it | published 2026-10-02 |
| O20 | ChatAds, "9 Reasons Your ChatGPT App Gets Rejected" *(secondary)* | https://www.getchatads.com/blog/chatgpt-app-rejected/ | Dec 2025 |
| O21 | Connect and test your plugin | https://developers.openai.com/plugins/deploy/connect-chatgpt | accessed 2026-10-05 |
| O22 | OpenAI Help: Developer mode and MCP apps in ChatGPT (fetch 403; search snippet) | https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt | accessed 2026-10-05 |
| O23 | Third-party developer-mode plan guides *(secondary)* | https://peliqan.io/blog/chatgpt-mcp/ ; https://hjarni.com/docs/connect-chatgpt-mcp | 2026; accessed 2026-10-05 |
| O24 | OpenAI Developer Community, "App rejected after a month with no explanation" *(anecdotal)* | https://community.openai.com/t/app-rejected-after-a-month-with-no-explanation-where-can-i-find-the-reason/1386788 | 2026; accessed 2026-10-05 |
| O25 | awesome-chatgpt-apps (community index) *(secondary)* | https://github.com/rdmgator12/awesome-chatgpt-apps | "Last updated July 2, 2026" |
| O26 | LinkedIn plugin listing | https://chatgpt.com/plugins/plugin_asdk_app_69949aa62bf48191be5e57a01202beca | accessed 2026-10-05 |
| C-spec | MCP spec 2025-11-25, Tools (tool-name characters) | https://modelcontextprotocol.io/specification/2025-11-25/server/tools | spec version 2025-11-25 |

**Open items to verify by hand**, because the official pages blocked automated fetch:
- (1) exact developer-mode plan eligibility [O22]
- (2) current regional availability of plugins [O14]
- (3) any explicit OpenAI policy on dating or matchmaking categories (none found)
