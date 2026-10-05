# Claude: build, test, submit and list The Network connector

Research date: 2026-10-05. Scope: Claude custom connectors (remote MCP), the Anthropic directory (connectors and plugins), the MCP authorization spec, Agent Skills and plugins, desktop extensions (MCPB), MCP Apps, policy and testing. It applies to the four-tool connector in PRD Section 11.

Each claim carries a source tag such as [A3]. Section 10 maps every tag to its URL and date. Anthropic's `claude.com/docs` pages show no per-page dates, so they are dated by access date (2026-10-05). Claims from third-party sources are marked *(secondary)*.

---

## 0. TL;DR for the team

1. **Two things to submit, one portal.** Since 2026-09-25, anyone on a paid Claude plan can submit through the developer portal at **claude.ai/directory/manage** [A1, A16 *(secondary)*]. We should make **two submissions** [A3]:
   - our remote MCP server as an **MCP connector**
   - a **plugin bundle** from a public GitHub repo, containing the Network skill plus a `.mcp.json` that points at the same server URL

   Pair the two in the portal.
2. **Most connector submissions go live automatically.** They are auto-scanned and **listed as "Community" by default**. Anthropic may escalate a connector to **Verified** review, which is human, slower and includes a functional test of each tool. There's no application for Verified [A1, A2, A5].
3. **Claude's OAuth client is stricter than the spec in a few places** [A6]:
   - sign-in starts only on an HTTP **401**
   - only the **first** `authorization_servers` entry is used
   - CIMD is used only if metadata has `client_id_metadata_document_supported: true` **and** `none` in `token_endpoint_auth_methods_supported`
   - 10 s timeout on discovery, registration and token endpoints; 30 s on refresh
   - the token endpoint must accept form-urlencoded bodies
   - callback is `https://claude.ai/api/mcp/auth_callback`, plus port-agnostic loopback for Claude Code
4. **Lazy auth differs from ChatGPT.** Claude starts sign-in only on a transport-level `401` with `WWW-Authenticate`. A `200` with `isError` never triggers auth [A7]. ChatGPT uses `_meta["mcp/www_authenticate"]` in a tool error instead (see chatgpt.md). **Our server should do both.**
5. **Tool rules that touch our design** [A2, A8]:
   - every tool needs a `title` and `readOnlyHint` or `destructiveHint`
   - names of 64 characters or fewer
   - no catch-all read/write tool
   - no querying "Claude's memory, chat history, conversation summaries, or user files"
   - no descriptions that tell Claude to call tools the user didn't ask for

   This affects `network.talk`, `network.share_context` and the proactive-suggestion idea in PRD 11.3 (Section 6).
6. **Tool names.** The Claude API requires `^[a-zA-Z0-9_-]{1,128}$`, with no dots [A21], and the directory caps names at 64 characters [A2]. **Rename the `network.*` tools** to `talk_to_network_agent` and similar.
7. **Desktop extensions (.mcpb) aren't a directory path any more.** "The directory no longer accepts local servers packaged as MCP Bundles" [A1, A12]. They aren't relevant to us: our server is remote.
8. **Skills aren't a standalone submission.** They ship inside a plugin [A1, A3]. The PRD 11.1 "Network skill/instruction package" therefore becomes a plugin.
9. **Testing:** add the server as a custom connector in our own Claude account (Free allows 1), tunnel local servers, and validate with MCP Inspector. "There is no separate staging environment, so you test in production." [A9]

---

## 1. Platform model (Oct 2026)

| Concept | What it is | Source |
|---|---|---|
| Custom connector | Any remote MCP server URL a user adds under **Customize > Connectors**. Available on Free (limited to one), Pro, Max, Team and Enterprise. Works across claude.ai, Desktop, Cowork and mobile. | [A10, A11] |
| Directory connector | The same runtime, but discoverable, with a label (Verified, Community, or Custom for self-added). "what works as a custom connector will work after publication." | [A5, A9] |
| Plugin | A folder with `.claude-plugin/plugin.json` plus skills, commands, agents, hooks and MCP server references. Installs on claude.ai chat, Cowork and Claude Code, each loading a different subset. | [A13, A14] |
| Skill | `skills/<name>/SKILL.md` following the open **Agent Skills** spec (agentskills.io). Frontmatter `name`: lowercase, hyphens, 64 characters or fewer, must match the folder name. `description`: 1,024 characters or fewer. | [A15, A17] |
| MCP App | Interactive UI from the MCP server rendered inline (the official `io.modelcontextprotocol/ui` extension). Claude launched support on 2026-01-26. | [A18, A19 *(secondary)*] |
| MCPB | A zipped local stdio server plus `manifest.json`, installed by double-click in Claude Desktop. Renamed from `.dxt` on 2025-09-11. No longer accepted in the directory. | [A12, A20 *(secondary)*] |

Where plugin components load [A14]:
- **Skills** load in chat, Cowork and Claude Code.
- A **remote `http` MCP server** in `.mcp.json` appears on the plugin's Connectors tab in chat and Cowork. The user connects and signs in there. Claude Code connects directly.
- **Hooks and agents** are ignored in chat.
- **MCP URLs** that use `${user_config.*}` are ignored in chat. Don't use them.

---

## 2. Build guide (step by step)

### 2.1 Remote MCP server
1. Build with the official TypeScript or Python SDK. Use **Streamable HTTP**: the directory requires it and "SSE is no longer accepted" [A4 *(secondary)*, A8].
2. Serve on a **public HTTPS** URL [A1]. The domain should match our service ("API ownership": the server must call our own first-party APIs) [A2].
3. For every tool, set:
   - `name`: 64 characters or fewer, no dots (see TL;DR item 6)
   - `title`
   - `readOnlyHint: true` **or** `destructiveHint: true` as applicable. These drive Claude's permissions: "Read-only tools can run without per-call confirmation, and destructive tools always prompt." [A2]
   - a narrow, accurate description [A2]
4. Return useful, actionable errors. "Internal Server Error" or "Bad Request" with no detail fails review [A2].
5. Keep responses small. Token use should be "roughly commensurate with" the task [A8, A2].
6. Don't gate behavior on `clientInfo.name`. It varies (`claude-ai`, `Anthropic`, `claude-code`) and is unauthenticated [A9].
7. Allowlist Anthropic egress `160.79.104.0/21` at the WAF or CDN for **both** the MCP server and the authorization server [A6].

**Spec version.** MCP **2026-07-28** was released on 2026-07-28. It adds a stateless core (no `initialize`, no `Mcp-Session-Id`), required RFC 9207 `iss`, CIMD as the standard path, deprecated DCR, and SSE transport deprecated with a one-year window [A22]. Claude support is "rolling out across Claude products soon" with no timetable [A23]. **Build against 2025-11-25 now, with a stateless-friendly design.** Keep no server-side session dependency, so the 2026-07-28 upgrade is cheap.

### 2.2 Plugin bundle (skill plus connector reference)
Layout [A13]:
```
the-network/
  .claude-plugin/plugin.json      # only the manifest lives here
  skills/the-network/SKILL.md     # PRD 11.1 behavior contract
  .mcp.json                       # {"mcpServers": {"the-network": {"type": "http", "url": "https://mcp.<domain>/mcp"}}}
  README.md
  LICENSE
```
- Validate locally with `claude plugin validate ./the-network`, which should print "✔ Validation passed". Then use **Validate** in the portal [A13].
- Directory checks [A24]:
  - The name can't be a reserved word (`claude`, `anthropic`, `official`, `plugin`, `mcp`, `test`) or look like another brand.
  - Non-image files must be 256 KiB or smaller, with 512 files or fewer.
  - No secrets anywhere.
  - Don't reference `.mcpb`/`.dxt` bundles.
  - A lockfile or pinned `npx` package gets held for a reviewer.

  A remote-only plugin avoids almost all of these.
- Skill content must follow the policy: no "hidden, obfuscated, or encoded instructions", and it can't tell Claude to "dynamically pull behavioral instructions from external sources" [A8]. Keep the skill static and descriptive.

**Cross-ecosystem note.** OpenAI's portal can convert a `.claude-plugin/plugin.json` skills plugin into its format, so one skill source can serve both (see chatgpt.md [O17]).

### 2.3 Desktop extension (MCPB), for reference only
`npm install -g @anthropic-ai/mcpb`, then `mcpb init`, then `mcpb pack`. Double-click the result to install. It runs locally over stdio with no OAuth, on macOS and Windows [A12]. It's not recommended for The Network: our server is remote, multi-tenant and OAuth-based. MCPB fits behind-firewall or local-file use cases [A12].

---

## 3. Auth — MCP authorization spec plus Claude specifics

### 3.1 Spec (MCP 2025-11-25), normative points [A25]
- **Standards:** OAuth 2.1 (draft-13), RFC 8414, RFC 7591, RFC 9728, and the CIMD draft (draft-ietf-oauth-client-id-metadata-document-00).
- **RFC 9728:** MCP servers **MUST** publish protected resource metadata with at least one `authorization_servers` entry. Discovery is via `WWW-Authenticate: Bearer resource_metadata="…"` on 401, or well-known URIs: path-inserted `/.well-known/oauth-protected-resource/<mcp-path>` first, then root. Servers **SHOULD** include `scope` in the challenge.
- **AS discovery:** RFC 8414 or OIDC Discovery. Clients try `/.well-known/oauth-authorization-server[/path]`, then `openid-configuration` variants.
- **Client registration priority:**
  1. pre-registered client
  2. **CIMD** (**SHOULD** support)
  3. **DCR** (**MAY** support, "for backwards compatibility")
  4. manual entry

  CIMD details:
  - The `client_id` is an HTTPS URL with a path. The document needs `client_id`, `client_name` and `redirect_uris`.
  - The AS **MUST** validate that `client_id` equals the document URL, and validate redirect URIs against it.
  - The AS **SHOULD** cache the document and guard against SSRF.
- **PKCE:** clients **MUST** use S256 and **MUST** refuse to proceed if `code_challenge_methods_supported` is absent.
- **RFC 8707 `resource`:** **MUST** be in both authorization and token requests, set to the canonical server URI.
- **Tokens:**
  - Servers **MUST** validate the audience and only accept tokens issued for themselves.
  - Token passthrough is forbidden.
  - Invalid or expired tokens get 401. Insufficient scope gets 403 with `error="insufficient_scope"`, `scope` and `resource_metadata`, for step-up.
  - The AS **MUST** rotate refresh tokens for public clients and **SHOULD** issue short-lived access tokens.
- **HTTPS and redirects:** all AS endpoints use HTTPS. Redirect URIs must be `localhost` or HTTPS. Exact redirect matching. The consent screen **MUST** clearly show the redirect URI hostname.
- **2026-07-28 changes:** `iss` (RFC 9207) is required, DCR is deprecated, and client credentials are bound to their issuer [A22].

### 3.2 Claude-specific requirements [A6, A7]

| Item | Requirement |
|---|---|
| Supported auth types | `oauth_dcr` and `oauth_cimd` by default. `oauth_anthropic_creds` and `custom_connection` via mcp-review@anthropic.com. `static_headers` is beta. `none` is supported. Machine-to-machine `client_credentials` isn't supported. |
| Starting sign-in | Must be an HTTP **401** with `WWW-Authenticate: Bearer resource_metadata="…"`. Claude ignores `WWW-Authenticate` on a 200. The metadata URL can be on any HTTPS host, which suits edge or serverless deploys. |
| `resource` | Must equal the server URL exactly as the user enters it, including the path. |
| Authorization servers | Only the **first** `authorization_servers` entry is used. |
| CIMD selection | Requires `client_id_metadata_document_supported: true` **and** `"none"` in `token_endpoint_auth_methods_supported`. Otherwise Claude falls back to DCR. |
| DCR at scale | "DCR causes Claude to register a new client on every fresh connection". Prefer CIMD or Anthropic-held credentials for high-traffic directory servers. |
| PKCE | S256 on every request. Advertise `code_challenge_methods_supported: ["S256"]`. |
| Scopes | Taken from `scope` in the 401 challenge, otherwise from `scopes_supported`. Claude adds `offline_access` if it's listed. |
| Redirect URIs | Hosted apps (web, Desktop, mobile, Cowork): `https://claude.ai/api/mcp/auth_callback`. Claude Code: loopback `http://localhost:<any>/callback` **and** `http://127.0.0.1:<any>/callback`, matched port-agnostically. Claude Code has its own CIMD. |
| Token endpoint | Accept `application/x-www-form-urlencoded`. DCR uses JSON. Return `invalid_grant` for dead refresh tokens. Rotate refresh tokens. Claude refreshes on 401 and up to 5 minutes before expiry. |
| Latency | Discovery, registration and token endpoints have **10 s**; refresh has **30 s**. Otherwise the flow fails. |
| Lazy auth | Public tools work before sign-in. Protected tools get an HTTP-level 401 **before the MCP SDK runs**. "A `200` with `isError: true`… there is no auth prompt." |
| Enterprise | Enterprise Managed Auth (IdP assertion, no consent screen) is available, but not needed for us. |

### 3.3 Recommended auth design for The Network (both hosts)
- **One authorization server** (ours or a managed IdP) advertising:
  - `issuer`
  - `authorization_endpoint`, `token_endpoint`
  - `code_challenge_methods_supported: ["S256"]`
  - `client_id_metadata_document_supported: true`
  - `token_endpoint_auth_methods_supported: ["none", "private_key_jwt"]` (covers Claude's public CIMD client and ChatGPT's `private_key_jwt`)
  - `registration_endpoint` (DCR fallback until 2026-07-28 adoption)
  - `authorization_response_iss_parameter_supported: true`, with `iss` always returned (ChatGPT stable callbacks plus 2026-07-28)
  - `scopes_supported` including `offline_access`
- **Redirect allowlist:**
  - `https://claude.ai/api/mcp/auth_callback`
  - Claude Code loopbacks (port-agnostic)
  - `https://chatgpt.com/connector_platform_oauth_redirect` (see chatgpt.md)
- **Login UX:** invite plus phone OTP for members. The consent page shows the client name and redirect hostname (spec **MUST**) and the PRD 11.1 scopes. A **reviewer path** gives a seeded, fully populated demo member a password login with no OTP. Anthropic requires "credentials for a fully populated account" [A1, A9].
- **Auth on unauthenticated calls:** return HTTP 401 with `WWW-Authenticate` for Claude. On ChatGPT, also include `_meta["mcp/www_authenticate"]` on tool errors.
- **Revocation (GW-005):** revoking server-side makes Claude's next refresh return `invalid_grant`, and the user sees **Reconnect**.

---

## 4. UI options (MCP Apps)

| Option | Notes |
|---|---|
| No UI | Text plus `structuredContent`. Works in Claude Code and every host. Recommended for v1. |
| MCP App | Register with `registerAppTool()` and `registerAppResource()` from the MCP Apps SDK (`@modelcontextprotocol/ext-apps`). The same code runs in Claude and other MCP Apps hosts, including ChatGPT [A18]. Display modes: **inline card**, **inline carousel**, **full screen** [A26]. Mobile renders in a native WebView (WKWebView or Android WebView) and must respect `hostContext.safeAreaInsets`. Tap targets must be at least 44pt [A26]. Avoid nested scrolling and dropdown menus [A26]. |
| `ui.domain` for Claude | The first 32 hex characters of SHA-256(server URL) followed by `.claudemcpcontent.com` [A18]. **It's tied to the exact server URL**, another reason to fix the production URL early. |
| External links | `ui/open-link` prompts the user unless the origin is in the submission's **allowed link URIs**. Only domains we own qualify [A1]. |
| User consent | Claude asks permission to display an app (**Allow** or **Always allow**) [A18]. |
| Listing assets | 3 to 5 PNG carousel screenshots, at least 1000 px wide, cropped to the app response, each with a paired prompt. No video or GIF [A1]. A Figma template is available [A1]. |
| Migration | There's an official guide and a skill for migrating an OpenAI Apps SDK app to MCP Apps [A18]. |

Opportunity card (PRD 10.3) as an inline card: keep four actions only if they render as visible segmented buttons, not menus. Avoid nested scrolling [A26]. Each button's tool call should go through `respond_to_network_item`, which is a write that Claude will prompt for.

---

## 5. Submission and review checklist

### 5.1 Eligibility [A3]
- [ ] Plan is Pro, Max, Team or Enterprise (Free can't submit). On Team or Enterprise, an Owner submits, or a custom role with the **Directory** permission (Enterprise).
- [ ] Submit from the org that should own the listing long term. For plugins, the first org to submit a repo folder owns it.

### 5.2 Connector pre-submission checklist [A1, A2]
- [ ] Remote, `https://` URL.
- [ ] OAuth works for Claude's client (Section 3). No special approval is needed for DCR or CIMD.
- [ ] Every tool has a `title` and `readOnlyHint` or `destructiveHint`. The portal flags missing ones.
- [ ] Tool names are 64 characters or fewer. Read and write tools are separate. No prompt-injection patterns in descriptions.
- [ ] Every tool succeeds with valid input and gives actionable errors.
- [ ] Doesn't collect conversation data beyond its function. Doesn't query Claude memory, chat history or files.
- [ ] Tested every tool in **MCP Inspector** and as a **custom connector in Claude**. The portal asks you to confirm this.
- [ ] Listing materials:
  - documentation URL (a public help page or blog post is enough, needed by the publish date)
  - privacy policy URL
  - support contact
  - icon
  - carousel screenshots if it's an MCP App
- [ ] Test account: a fully populated account with step-by-step setup instructions.
- [ ] Allowed link URIs (optional).

### 5.3 Portal steps (MCP connector) [A1]
1. **Connection**: the URL. Choose Universal, Multiple URLs or URL pattern. We are **Universal**.
2. **Tools**: auto-synced and grouped by read or write.
3. **Listing**:
   - name: 100 characters or fewer
   - one-liner: 200 or fewer
   - description: 2,000 or fewer
   - 1 to 5 categories
   - docs URL, privacy URL, support contact, icon
   - slug (**permanent once published**)
4. **Use cases**: primary uses, prerequisites (accounts or plans; we state "invite required"), and whether it reads, writes or both.
5. **Company**: name, website, primary contact.
6. **Authentication**: OAuth with DCR, CIMD, Anthropic-held credentials, custom connection, or none. Flag lazy auth here if used.
7. **Data handling**: own API, proxied or third-party. Personal health data? **Sponsored content?**
8. **Test & launch**: reviewer instructions and credentials, plus confirmation that every tool was tested.
9. **Compliance**: seven acknowledgments: directory guidelines, first-party API usage, financial transactions, AI media generation, prompt injection, conversation data collection, public documentation.
10. **Review and submit**: quality warnings are shared with reviewers.

### 5.4 Plugin bundle steps [A27]
1. In the portal, choose **Submit new → Plugin bundle**.
2. Enter the repo (`owner/repo`), an optional path and the branch. Connect GitHub first: the connected account must be able to push to the repo.
3. Check the listing details, which come from `plugin.json` and the README. Answer the data handling questions, then the compliance step.
4. Choose how updates arrive: **GitHub push webhook** (default) or scheduled check. Submit for review.
5. A private repo is allowed during review if you agree to the source upload and install the Claude GitHub App. It must be **public to publish** [A27].
6. Every version gets automated validation and a security scan. A **person reviews a new listing** before it goes live [A3].
7. Statuses run Draft → Scanning → Needs changes, In review, or Approved → **Published**. "Approved" isn't installable yet [A28].
8. Publishing defaults to a reviewer publishing each version. Auto-publish options exist [A27].
9. Updates: merge to the tracked branch. Each commit is scanned and published per the setting, and raise `version` each release [A27].

### 5.5 After listing [A3, A28, A29]
- Connector statuses: Draft, In review, Changes requested, Not approved, Approved (then **you** select Publish), Published. Editing before publishing sends the listing back to review.
- Plugins show a Usage tab (installs, versions, skill and MCP runs, error rates). Connectors get a dashboard with server health and usage by tool.
- Escalations: mcp-review@anthropic.com (connectors) and directory@anthropic.com (plugins). Unapproved plugins show **Appeal this decision**.

---

## 6. Policy risks specific to The Network

Governing documents:
- Anthropic Software Directory Policy (last updated 2026-04-15) [A8]
- Software Directory Terms [A1]
- Anthropic Usage Policy (effective 2025-09-15) [A30]
- Connector review criteria [A2]

| # | Risk | Rule | Severity | Mitigation |
|---|---|---|---|---|
| R1 | **`network.talk` reads and writes in one tool** | "A single tool that accepts both safe… and unsafe methods… is rejected… Documenting safe versus unsafe operations within one tool's description doesn't satisfy this requirement." [A2] (written about HTTP catch-alls, but reviewers apply the read/write split broadly) | **High** | Split it into `ask_network_agent` (read-only: questions, status, explanations; `readOnlyHint:true`) and `tell_network_agent` (changes preferences or state, creates requests; write). Keep accept and decline exclusively in `respond_to_network_item`. |
| R2 | **`network.share_context`** | Software may not "query or extract data from Claude's memory, chat history, conversation summaries, or user-generated or uploaded files" [A8]. "Don't collect conversation data beyond what the tool needs" [A2]. A compliance acknowledgment covers "conversation data collection" [A1] | **High** | Narrow typed fields only (interests, goals, coarse city, availability note). No `conversation_summary` or "everything you know" parameter. The description says the member approves what is shared. Never ask Claude to read its memory. |
| R3 | **Proactive suggestions** (PRD 11.3) and skill instructions | Can't "intentionally call or coerce Claude into calling other external software" unless the user asks. No "hidden… instructions", no behavior unrelated to the tool's function, no promoting products [A8, A2] | Medium | The skill can say "when the member asks what's new, call `get_network_updates`". It must not say "check The Network at the start of every conversation". Keep tool descriptions factual. |
| R4 | **Sponsored or underwritten opportunities** (PRD 6.1, 18) | Prohibited: "Advertisement/sponsored content vehicles" [A8]. The portal asks about sponsored content [A1] | Medium | Exclude sponsored items from the connector surface, or answer the data-handling question truthfully and get reviewer guidance first. |
| R5 | **Paid member services or any payments** (PRD 18) | "Financial transactions or asset transfers" are prohibited. Connectors that "transfer money… aren't accepted" [A8, A2] | Low (not MVP) | The connector never moves money. Payment happens only in Network-owned surfaces. |
| R6 | **Private information of other members** | AUP: no collecting or accessing private information (contact details, biometrics) without permission. No facial recognition [A30]. Directory: privacy policy required, collect only what's necessary [A8] | Medium | GW-001 and GW-002 already align. Return only cleared descriptors. Never return phone or email (the PRD contact exchange stays inside The Network). Disclose in the privacy policy. |
| R7 | **Romance opt-in** | AUP bars sexual content and anything involving minors [A30]. No explicit ban on dating products was found in the directory policy [A8] | Low to medium | Keep connector copy non-sexual. The 18+ membership (PRD Section 17) is enforced at our authorization server. Don't position the listing as a dating app. |
| R8 | **Invite-only** | No explicit rule. "Use cases" asks what users need before connecting [A1]. Reviewers need test credentials [A2] | Low | State "Requires an invitation to The Network" in prerequisites. The OAuth page shows a clear "invite required" state. Consider holding off on listing until the product is more open. |
| R9 | **Tool naming** (`network.talk`) | Directory: 64 characters or fewer [A2]. Claude API regex `^[a-zA-Z0-9_-]{1,128}$` has no dots [A21]. MCP allows dots [A31] | Medium | Use underscores: `ask_network_agent`, `tell_network_agent`, `share_profile_with_network`, `get_network_updates`, `respond_to_network_item`. |
| R10 | **Action IDs and audit receipts** (GW-003) | Token frugality: no oversized responses [A2, A8] | Low | Return a compact `item_id` and receipt ID. Unlike OpenAI, Claude doesn't ban IDs in responses. |
| R11 | **Region** | Must "respect country/region support limitations" [A8] | Low | US-only pilot. |

Annotation proposal (Claude requires `title` plus the applicable hint) [A2]:

| Tool | title | readOnlyHint | destructiveHint |
|---|---|---|---|
| get_network_updates | "Get Network updates" | true | — |
| ask_network_agent | "Ask your Network agent" | true | — |
| tell_network_agent | "Tell your Network agent" | false | false (additive) |
| share_profile_with_network | "Share profile details with The Network" | false | true if it overwrites profile fields |
| respond_to_network_item | "Respond to a Network item" | false | true (decline or cancel is consequential; Claude will always prompt) |

Prompting on destructive tools is a feature for us: it gives the host-level confirmation that PRD GW-004 wants, in addition to the server-side policy.

---

## 7. Testing approach

1. **Protocol:** `npx @modelcontextprotocol/inspector --cli http://localhost:3000/mcp --transport http --method tools/list`. Switch to `tools/call` with `--tool-name` and `--tool-arg`. Use the UI mode to exercise OAuth [A9].
2. **Tunnel:** Cloudflare Tunnel or ngrok. If you use `createMcpExpressApp()`, add the tunnel host to `allowedHosts`, or you'll get `403 Invalid Host` [A9]. Keep auth on while tunneling [A9].
3. **Claude as a custom connector** (any plan; Free allows 1) [A9, A11]:
   - Add it at **Customize > Connectors → + Add → Add custom connector**, with the URL and auth settings. Auth options are "Use Claude's published identity (Recommended)" (CIMD), "Register automatically" (DCR), or your own OAuth client [A10].
   - Check that it shows **Connected**, that tools appear under **Tool permissions** with the right names and descriptions, and that a real call works from **+ > Connectors** in a chat [A9].
   - Test on web, Desktop and **mobile**: the same auth infrastructure backs them all [A6].
   - Team and Enterprise: an Owner adds the connector under Organization settings > Connectors, and members connect [A10].
4. **Claude Code:** `claude --plugin-dir ./the-network` tests the plugin, and `/mcp` shows the connector status. This also tests the loopback-redirect OAuth path [A13, A6].
5. **Plugin in chat:** zip the folder, then go to **Customize > Plugins > Add > Upload plugin** [A13].
6. **MCP Apps:** test locally through a tunnel or `mcp-remote` [A9, A18]. Validate `ui.domain` and fix `Invalid ui.domain format` or mismatch errors using the troubleshooting page [A18].
7. **Failure diagnostics:** "Couldn't reach the MCP server" usually means discovery failed: the 401 had no `resource_metadata` and the well-known paths returned 404. Also check WAF 403s and slow token endpoints. Find the `ofid_` reference ID for support [A6, A9].
8. **Skill evaluation:** use `skill-creator` to compare runs with and without the skill [A15].

---

## 8. Timelines

| Phase | Estimate | Basis |
|---|---|---|
| Auth server meeting Claude plus ChatGPT requirements | 1–2 weeks with a managed IdP | Engineering estimate; requirements in [A6, A25] |
| MCP server (5 tools after the split), no UI | ~1 week | Engineering estimate |
| Plugin bundle (skill plus `.mcp.json`) | 1–3 days | [A13] |
| MCP App card | 1–2 weeks | Engineering estimate |
| Connector review | Auto-scan, then **Community listing by default**, "with no action from you". Human reviews vary "with queue volume" [A1]. Verified escalation is "higher touch and slower" [A2] | Plan for days for Community and weeks for a human or Verified review. No official SLA |
| Plugin review | Each version is scanned. A **person reviews a new listing** before go-live. "Review time isn't fixed" [A3, A28] | Plan for 1–4 weeks for the first listing |
| Updates | Connector tool changes are live immediately: same server, but the label reflects review-time state [A5]. Plugins update per commit after scan [A27] | — |

---

## 9. Precedent

- Anthropic reports 950+ servers in Claude's connectors directory [A23].
- I found no first-party list of people-matching connectors on Claude. The ChatGPT-side precedents (Happenstance, 4Degrees, LinkedIn; see chatgpt.md Section 9) are cross-host vendors and are the best analogs.
- Multi-host vendors ship the same MCP server and UI to both platforms, e.g. Square shipped a Claude plugin and a ChatGPT app on 2026-07-01 [A32 *(secondary)*]. That supports a single remote MCP server for both hosts.

---

## 10. Sources

All accessed 2026-10-05 unless noted. The `claude.com/docs` pages were fetched as `.md`, e.g. `https://claude.com/docs/connectors/building/submission.md`.

| Tag | Source | URL | Date info |
|---|---|---|---|
| A1 | Submit a connector to the directory | https://claude.com/docs/connectors/building/submission | accessed 2026-10-05 |
| A2 | Connector pre-submission checklist (review criteria) | https://claude.com/docs/connectors/building/review-criteria | accessed 2026-10-05 |
| A3 | Publish to the directory | https://claude.com/docs/directory/publish | accessed 2026-10-05 |
| A4 | Search synthesis of directory requirements (Streamable HTTP, SSE not accepted) *(secondary)* | https://sunpeak.ai/blogs/claude-connector-directory-submission/ | Aug 2026 |
| A5 | Connector verification | https://claude.com/docs/connectors/verification | accessed 2026-10-05 |
| A6 | Authentication for connectors | https://claude.com/docs/connectors/building/authentication | accessed 2026-10-05 |
| A7 | Lazy authentication | https://claude.com/docs/connectors/building/lazy-authentication | accessed 2026-10-05 |
| A8 | Anthropic Software Directory Policy | https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy | last updated 2026-04-15 |
| A9 | Test your connector | https://claude.com/docs/connectors/building/testing | accessed 2026-10-05 |
| A10 | Getting started with custom connectors using remote MCP | https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp | "updated this week" as of 2026-10-05 |
| A11 | Add a connector that isn't in the directory | https://claude.com/docs/connectors/custom/add-unlisted | accessed 2026-10-05 |
| A12 | Build a desktop extension with MCPB | https://claude.com/docs/connectors/building/mcpb | accessed 2026-10-05 |
| A13 | Plugin structure and testing | https://claude.com/docs/plugins/build | accessed 2026-10-05 |
| A14 | Plugin feature support across platforms | https://claude.com/docs/plugins/platform-support | accessed 2026-10-05 |
| A15 | Create custom skills | https://claude.com/docs/skills/how-to | accessed 2026-10-05 |
| A16 | Coverage of the 2026-09-25 portal launch *(secondary)* | https://www.unite.ai/anthropic-opens-directory-submission-portal-for-claude-plugins/ ; https://ai-watch-blog.vercel.app/en/posts/2026-09-25-claude-plugins-directory-portal/ | 2026-09-25 |
| A17 | Agent Skills specification; open standard announced Dec 18, 2025 *(date via secondary)* | https://agentskills.io/specification ; https://the-decoder.com/anthropic-publishes-agent-skills-as-an-open-standard-for-ai-platforms/ | 2025-12-18 |
| A18 | Get started with MCP Apps | https://claude.com/docs/connectors/building/mcp-apps/getting-started | accessed 2026-10-05 |
| A19 | MCP Apps official/stable 2026-01-26; Claude launch *(secondary)* | https://alpic.ai/blog/mcp-apps-goes-official-claude-chatgpt-support ; https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx | 2026-01-26 |
| A20 | .dxt → .mcpb rename (2025-09-11) *(secondary)*; MCPB repo | https://github.com/modelcontextprotocol/mcpb ; https://x.com/TobinSouth/status/1962993520312222102 | 2025-09-11 |
| A21 | Claude API: define tools (name regex) | https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools | accessed 2026-10-05 |
| A22 | MCP blog: The 2026-07-28 Specification | https://blog.modelcontextprotocol.io/posts/2026-07-28/ | 2026-07-28 |
| A23 | Claude blog: Bringing MCP 2026-07-28 to Claude | https://claude.com/blog/bringing-mcp-2026-07-28-to-claude | ~2026-07-28 |
| A24 | Plugin pre-submission checklist | https://claude.com/docs/plugins/pre-submission-checklist | accessed 2026-10-05 |
| A25 | MCP spec 2025-11-25: Authorization | https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization | spec version 2025-11-25 |
| A26 | MCP Apps design guidelines | https://claude.com/docs/connectors/building/mcp-apps/design-guidelines | accessed 2026-10-05 |
| A27 | Submit your plugin | https://claude.com/docs/plugins/submit | accessed 2026-10-05 |
| A28 | Track your directory submission | https://claude.com/docs/directory/submission-status | accessed 2026-10-05 |
| A29 | Manage your directory listing / After publishing | https://claude.com/docs/connectors/building/managing-your-listing ; https://claude.com/docs/connectors/building/after-publishing | accessed 2026-10-05 |
| A30 | Anthropic Usage Policy | https://www.anthropic.com/legal/aup | effective 2025-09-15 |
| A31 | MCP spec 2025-11-25: Tools (tool names allow `.`) | https://modelcontextprotocol.io/specification/2025-11-25/server/tools | spec version 2025-11-25 |
| A32 | awesome-chatgpt-apps "App of the Week" note citing Square press release *(secondary)* | https://github.com/rdmgator12/awesome-chatgpt-apps ; https://squareup.com/us/en/press/claude-chatgpt-integrations | 2026-07-01/02 |

**Open items to verify by hand:**
- (1) whether claude.ai connectors accept dotted MCP tool names at runtime (the API regex suggests not, so rename regardless)
- (2) when Claude ships 2026-07-28 spec support [A23]
- (3) whether reviewers accept an invite-only product listing without an open sign-up path (not addressed in docs)
