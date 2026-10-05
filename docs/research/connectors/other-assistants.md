# Shipping The Network connector to other assistants

**Research date:** 2026-10-05

**Scope:** Google Gemini, Meta AI, Microsoft Copilot, Perplexity, Mistral Le Chat, and Apple Intelligence/Siri. For each one, this doc answers four questions about PRD §11's four-tool remote MCP server with OAuth:

- Can it be connected?
- Can it be *listed* in a directory?
- How is it submitted?
- What policy risks apply to a people-matching / social-introductions product?

ChatGPT, Claude, and Grok are covered in teammates' docs. They appear here only in the final rollout order. Meta Muse is covered in `muse.md`.

**Citations:** every claim has a source ID, and the URL and date for each ID are in the source list at the end. **(secondary)** marks claims that rest only on third-party write-ups. Effort and risk ratings are this author's assessment, not sourced facts.

---

## 0. Shared core: build it once

Every host below that accepts MCP accepts the same thing: a public HTTPS remote MCP server using streamable HTTP, behind OAuth. Build the core once, to this spec:

1. **Transport.** Streamable HTTP over TLS 1.2+.
   - Gemini Enterprise rejects SSE [G4] **(secondary)**.
   - Mistral expects streamable HTTP with valid TLS [MI2].
   - Microsoft requires TLS 1.2+, no redirects, and the same domain as the verified publisher domain [MS3].
2. **OAuth 2.1, authorization code + PKCE.**
   - Publish AS metadata (`/.well-known/oauth-authorization-server`) and protected-resource metadata.
   - Support **Dynamic Client Registration (DCR)**. Gemini consumer custom apps need it, or the user has to paste client credentials [G1]. Mistral uses OAuth 2.1 with DCR [MI2].
   - Also support **pre-registered confidential clients** for hosts that configure a fixed client: Gemini Enterprise [G3], Microsoft [MS1], and Meta.
   - Be tolerant about the `resource` parameter, with and without a trailing slash. Perplexity's OAuth breaks against servers that are strict about it [P3].
3. **Tool annotations.** Set `readOnlyHint` and `destructiveHint` honestly.
   - Microsoft requires `readOnlyHint: false` on consequential tools to force a confirmation [MS3].
   - Gemini asks for manual confirmation on write actions [G1].
   - Mistral splits tools into read and write functions with per-function approval [MI2].

   Classify the four tools as follows:

   | Tool | Class |
   |---|---|
   | `get_updates` | read |
   | `share_context` | write |
   | `talk` | write. It never executes consequential actions itself; it returns pending items. |
   | `respond` | write / consequential. The arguments carry the human-readable details of what will happen. |

4. **Idempotent writes with durable action IDs (GW-003).** Return text-first results with deep links. Rich UI is optional per host (GW-007).
5. **No instruction-like text in tool descriptions.** Microsoft fails "if the user says X", "ignore", URLs, or emojis in descriptions [MS3]. Put the "skill" guidance in plain capability descriptions.
6. **Reviewer test account** with synthetic members and pending items. Microsoft and Meta reviewers both exercise every tool [MS3][M1].

---

## 1. Google Gemini

### Surfaces

| Surface | Third-party MCP? | Listing? |
|---|---|---|
| **Gemini app: Connected Apps → Custom apps.** Part of Gemini Spark, the agent announced at I/O 2026. | **Yes.** The user pastes an MCP server URL at gemini.google.com under Settings > Connected Apps > Custom apps. It then works on web and mobile [G1][G2]. | **No public directory.** Named partners such as Canva, Dropbox, Instacart, OpenTable, and Zillow Rentals were added through Google deals [G2][G5]. A BD contact is required [G4] **(secondary)**. |
| **Gemini Enterprise** (formerly Agentspace) | **Yes.** An admin adds a custom MCP server under Manage team → Connected apps → Add MCP Server. The server must be public, use HTTPS, and use OAuth [G3]. | Per-tenant only. No public directory [G4] **(secondary)**. |
| **Gemini in Workspace side panel** (Docs, Sheets, Slides, Chat) | Third-party MCP connectors exist for Asana, HubSpot, Salesforce, and others [G6]. | Partner-only, aimed at enterprise. |
| **Gems** | Custom instructions and knowledge only. Gems are available in the Workspace side panel [G7]. We found no evidence of third-party tool calling from Gems. | N/A |
| **Gemini API / Gemini CLI** | MCP client support in developer tooling. The CLI was replaced by Antigravity CLI for consumer tiers on 2026-06-18 [G4] **(secondary)**. | Not an end-user channel. |
| **Android MCP** | Android apps can expose an on-device MCP server to system agents. Announced at I/O 2026 [G8]. | Requires a native Android app. |

**Consumer custom-app eligibility** [G1]:

- age 18+
- in the **US**
- a **personal** Google account (work and school accounts are excluded)
- Keep Activity turned on
- English only

Plan gating is reported inconsistently:

- [G2] says Spark is available to AI Ultra subscribers.
- [G9] **(secondary)** says AI Pro in the US plus Ultra.
- Google does **not review** custom MCP servers and warns users about this [G1].

### Build guide

1. Deploy the shared core (§0). DCR is effectively required for a smooth consumer flow [G1].
2. For Gemini Enterprise, also create a fixed OAuth client. Its redirect URI is `https://vertexaisearch.cloud.google.com/oauth-redirect` [G10] **(secondary)**. Gemini Enterprise also accepts a GCP service-account token as of 2026-06-15 [G10] **(secondary)**, but we would not use that.
3. Publish a "Use The Network in Gemini" help page: the URL to paste and the eligibility caveats.

### Auth

OAuth with DCR. Without DCR, users paste a client ID and secret [G1]. Write actions require manual confirmation [G1].

### Submission and listing

There is no self-serve listing path. To be a featured Connected App, go through Google partnerships. Until then, distribution is "paste this URL".

### Policy risks

- The Generative AI Prohibited Use Policy bans:
  - tracking or monitoring people without consent
  - using personal data without legally required consent
  - harassment
  - impersonation [G11]

  Our consent model already addresses these. Never let a host-initiated request disclose another member.
- Consumer users carry the risk of custom apps. Google states custom apps may request "data beyond what is strictly needed" [G1]. Keep scopes minimal so a partner review later goes smoothly.
- Partner listing is at Google's discretion. A social-matching product sitting next to Google's own products is an unknown.

### Testing

- Use a US personal account on a qualifying plan.
- Paste the server URL, complete OAuth, and confirm the write-confirmation prompts on `share_context`, `talk`, and `respond`.
- Test revoke via "Unlink MCP server" [G1].
- For Enterprise, use a test Gemini Enterprise tenant.

### Checklist

- [ ] DCR + AS metadata
- [ ] Honest read/write annotations
- [ ] Public help page with eligibility caveats
- [ ] Enterprise OAuth client with the Vertex redirect URI (optional)
- [ ] Open a Google partnerships conversation for Connected Apps listing

---

## 2. Meta AI (meta.ai, Meta AI app, AI glasses)

This is separate from Muse. Meta runs two programs: the Muse Connector Platform and **Meta AI Connectors** [M2].

### Surfaces

- **Meta AI Connectors.** They "turn your existing API into tools Meta AI can call".
  - They run on **AI glasses and the Meta AI app and web** today [M3].
  - Onboarding is by REST (OpenAPI), GraphQL, or **MCP onboarding**, with **OAuth account linking** [M3].
  - Status is a **developer preview**. Developers are admitted in waves. "Publishing is coming in a later phase" [M3].
  - Announced at Meta Connect, 2026-09 [M2].
- **WebMCP** (developer preview). It exposes chosen functions of a web app to Meta AI on Meta Ray-Ban Display [M2].
- **Not relevant:** Meta Ads AI Connectors, an official Meta MCP server for advertisers [M4].

### Build guide

1. Apply at dev.meta.ai/products/connectors. Requirements are a live REST API or one in development, plus a clear use case [M3].
2. Onboard the MCP server, or the REST API underneath it (PRD §11.1 already plans both).
3. Implement OAuth account linking (the shared core).
4. Design for **voice and glasses**: short spoken summaries for `get_updates`, and explicit verbal confirmation for `respond`.

### Submission and listing

Preview only. Public listing ("publishing") is not open yet [M3].

### Policy risks

These are probably similar to Muse (see muse.md §5). The Muse rules prohibit:

- secondary use and profiling
- sensitive-attribute inference

Meta's discretion to remove connectors applies [M1].

Glasses add a further concern: never surface information about bystanders or nearby people. Meta's Muse policy also forbids identifying individuals via biometrics without authorization [M1].

### Testing

- Use the preview's testing access inside Meta AI [M3].
- Glasses voice-flow tests.

### Checklist

- [ ] Apply to the preview now. It is cheap and keeps us in a wave
- [ ] REST/OpenAPI spec alongside MCP
- [ ] Voice-length response variants
- [ ] Same data-use statement as the Muse submission

---

## 3. Microsoft Copilot

### Surfaces

| Surface | Third-party MCP? | Listing? |
|---|---|---|
| **Consumer Copilot** (copilot.com, mobile) | **No.** Connectors are limited to OneDrive, Outlook.com, and Google Drive, Gmail, Calendar, and Contacts [MS4]. | None. |
| **Microsoft 365 Copilot: declarative agents** | **Yes.** Agents Toolkit → "Add an Action" → "Start with an MCP Server". Auth is OAuth 2.1, Entra SSO, or anonymous. **MCP Apps** render sandboxed iframe UI in Copilot chat. Generally available since 2026-04-07 [MS1]. | **Microsoft 365 Agent Store**, via Partner Center and the commercial marketplace [MS1][MS2]. |
| **Copilot Studio** | MCP is GA. Makers add MCP servers to their org's agents [MS5]. | Org-internal, or a custom engine agent in the store [MS3]. |
| Federated Copilot connectors | MCP-based, real-time third-party data for M365 Copilot. Admin-governed [MS6]. | Enterprise. |

### Build guide (M365 declarative agent)

1. Get a Microsoft 365 Copilot developer environment. That means a licensed tenant or a sandbox through the TAP program [MS3].
2. Scaffold the agent with the Microsoft 365 Agents Toolkit. Add the MCP server as an action [MS1].
3. Configure OAuth 2.1. Register the client in the Teams Developer Portal / Entra as the toolkit directs [MS1].
4. Meet the validation spec [MS3]:
   - `readOnlyHint: false` on consequential tools
   - confirmation text that names the action
   - completion confirmation as a card
   - at least 3 working prompt starters
   - citations
   - p50 under 2 s, p75 under 5 s, p99 under 9 s
   - 99.9% availability
   - the same domain as the publisher-verified domain
   - must work in Teams, copilot.microsoft.com, and Copilot in Word
5. Publish through Partner Center. The listing is validated against marketplace policy 1140.9 [MS2][MS3].

### Auth

- OAuth 2.1, or Entra SSO for enterprise identity [MS1].
- For SSO, the Entra app must authorize the Office/Teams/Outlook Copilot client IDs [MS3].

### Policy risks

These are high for our use case.

- **Value bar is enterprise.** Agents must "complete enterprise workflows" and deliver differentiated value [MS3].
- **Workplace suitability.** The Teams store requires apps to "enable group collaboration, improve an individual's productivity, or both". Socializing apps must be collaborative and designed for multiple participants [MS7].
- A consumer social-introductions connector would probably fail the value-proposition check unless we reframe it, for example as "professional introductions and help inside a company network".
- Marketplace policy 100.10 bans content that might "pose a risk of harm to the safety… of any person" [MS8]. Real-world meetups need a documented safety flow (PRD `report_safety`).

### Testing

- Sideload the agent in a dev tenant.
- Run the store's compatibility matrix: Teams, copilot.microsoft.com, Word [MS3].
- Load-test the latency SLOs.

### Checklist

- [ ] Decide whether there is an enterprise framing at all. If not, skip the store
- [ ] Dev tenant with Copilot
- [ ] Agents Toolkit project with an MCP action
- [ ] OAuth 2.1 client
- [ ] Confirmation text, cards, citations, 3+ prompt starters
- [ ] Latency and availability SLOs
- [ ] Partner Center account, publisher domain verification

---

## 4. Perplexity

### Surfaces

- **Custom remote connectors.**
  - Who: Pro, Max, and Enterprise subscribers [P1].
  - Where: Account settings → Connectors → "+ Custom connector" → Remote. You enter a name and an HTTPS MCP URL [P1].
  - Auth: **OAuth, API Key, or None** [P1].
  - Launched around 2026-03-13 [P4] **(secondary)**.
- **Managed connectors** such as GitHub, Slack, Google Drive, and Notion are curated by Perplexity [P4] **(secondary)**.
- **Agent API MCP tools** are developer-side, not a distribution channel [P2].

### Submission and listing

There is **no public submission form**. A partner asked on Perplexity's community forum on 2026-09-08 how to get listed, and the thread shows no official answer [P5]. One secondary source suggests emailing api@perplexity.ai [P4]. That is unverified.

### Build guide

1. Shared core.
2. Make sure OAuth accepts the `resource` parameter with or without a trailing slash [P3].
3. Publish a setup page: "Settings → Connectors → Custom connector → Remote → paste URL".

### Policy risks

- Low platform-review risk, because there is no review.
- Product risk: Perplexity is search- and answer-oriented. Our "AI/search first, people last" philosophy fits, but `talk` usage may stay low.

### Testing

- Use a Pro account. Run OAuth, then enable the connector in a thread and invoke each tool [P6].

### Checklist

- [ ] Lenient `resource` handling
- [ ] Setup doc
- [ ] Ask Perplexity partnerships about managed-connector listing

---

## 5. Mistral Le Chat

### Surfaces

- **Custom MCP connectors.**
  - Available on all plans, including Free, since 2025-09-02 [MI1].
  - Adding one is **administrator-only**. On Free, Pro, and Student plans, the account owner is the admin [MI2].
  - Steps: Connectors → "+ Add Connector" → "Custom MCP Connector" → name and URL → Connect. Auth is auto-detected [MI2].
  - Auth: none, Bearer/Basic, or **OAuth 2.1 with DCR** [MI2].
  - Users choose per function whether to pre-authorize or approve each use, with tools split into read and write [MI2].
- **Directory.** A curated catalog of partner MCP servers that admins can add [MI2]. It started with 20+ connectors at launch [MI1] and reportedly had 64 by 2026-07-02 [MI3] **(secondary)**.

### Submission and listing

We found no public submission process. The directory is announcement-driven [MI2][MI3]. Contact Mistral partnerships.

### Build guide

The shared core works as is. Make sure the OAuth 2.1 DCR flow is in place [MI2].

### Policy risks

- Mistral is an EU company with a strong EU user base. Expect GDPR scrutiny if listed; matching data counts as personal data.
- The Network is US-first, so the European audience is a mismatch for now.
- Low review risk on the custom path.

### Testing

- Use a Free account (the owner is the admin). Add the connector, then test read and write approval settings [MI2].

### Checklist

- [ ] DCR verified against Le Chat auto-detection
- [ ] Setup doc
- [ ] Partnership inquiry (low priority)

---

## 6. Apple Intelligence / Siri

### Surfaces

- **App Intents** is the **only** way Siri and Apple Intelligence act on a third-party app. SiriKit was deprecated at WWDC 2026 [A1] **(secondary)**.
  - App Schemas describe content and actions in terms Siri understands [A2][A3].
  - Apple did **not** adopt MCP as the Siri bridge [A4].
  - Early iOS 27 adoption is "uneven" and requires supported hardware, language, and region [A4].
- **Siri Extensions** (iOS 27) let users pick an AI chatbot provider, such as ChatGPT, Gemini, or Claude [A5] **(secondary)**. That seat is for model providers, not for services like ours.
- **Indirect reach.** If Siri routes to ChatGPT, Gemini, or Claude, our connector in those hosts may be reachable, depending on each host's extension behavior. This is unverified.

### Remote MCP + OAuth?

**No.** This path requires a **native iOS app** that implements App Intents and App Schemas. Auth lives in the app's own sign-in.

### Build guide (when an iOS app exists)

1. Define App Intents and App Entities that mirror the four tools:
   - `GetUpdates`
   - `RespondToItem`, with the system confirmation dialog
   - `TalkToNetwork`
   - skip `ShareContext`, which is replaced by in-app onboarding
2. Adopt the relevant App Schemas [A2].
3. Index pending items as entities so Siri can find them.
4. Validate with AppIntentsTesting [A3].

### Submission and listing

Normal App Store review.

### Policy risks

- **Guideline 1.2:** social apps need content filtering, reporting, blocking, and published contact info. Apps used primarily for "random or anonymous chat" do not belong [A6].
- **Guideline 1.1.4:** hookup apps are banned [A6]. Our framing must clearly be non-romantic, or properly age-rated if not.
- **Guideline 5.1.2(i):** we must "clearly disclose where personal data will be shared with third parties, including with third-party AI, and obtain explicit permission" [A6]. This applies to every host connector, not just Apple.

### Checklist

Deferred until The Network has an iOS app. Then:

- [ ] App Intents + App Schemas
- [ ] Confirmation dialogs on respond
- [ ] Guideline 1.2 safety features
- [ ] Third-party AI disclosure

---

## 7. Cross-host policy themes for a people-matching product

1. **Consent before sharing about others.** Every host's rules or its user-facing warnings (Google [G11], Meta [M1], Apple [A6]) assume we never reveal another person's data without consent. GW-001 and GW-002 are the compliance story. Document them in every submission.
2. **Confirmation for actions that touch other humans.** Hosts enforce this differently:

   | Host | Mechanism |
   |---|---|
   | Microsoft | `readOnlyHint: false` plus explicit confirmation copy [MS3] |
   | Gemini | manual confirmation of writes [G1] |
   | Muse | Sensitive write, approved on every use [M1] |
   | Mistral | per-function approval [MI2] |

   Keep `respond` as the single consequential tool so each host's mechanism applies cleanly.
3. **No profiling or secondary use** of host-supplied data beyond the member's request [M1]. Write one data-use statement and reuse it everywhere.
4. **No sensitive-attribute inference** [M1][G11].
5. **Safety.** Real-world meetups trip "risk of harm" clauses [MS8]. Ship reporting and blocking (`report_safety`) before any listing.

---

## 8. Prioritized rollout order across all assistants

### Assumptions

- ChatGPT, Claude, and Grok details come from PRD §11, which says all three support remote MCP connectors as of 2026-10, and from teammates' docs.
- Reach figures are approximate monthly actives (MAU) from secondary aggregators [R1][R2] and should be read as orders of magnitude.
- Effort assumes the shared core (§0) is already built.

| Rank | Assistant | Reach (approx. MAU) | Incremental effort | Listing path | Policy risk | Why here |
|---|---|---|---|---|---|---|
| 1 | **ChatGPT** | ~1B (crossed 2026-06) [R1] | Low to medium. Apps SDK UI is optional. | Public app directory (teammate doc) | Medium | Largest reach, mature MCP app model, public submission. |
| 2 | **Claude** | ~70–245M; estimates vary widely [R1] | Low. Custom connectors work with the same server. | Connector directory (teammate doc) | Low to medium | Least friction. Early-adopter users. Best place to harden OAuth and confirmation UX. Can ship in parallel with #1. |
| 3 | **Meta Muse** | Unknown MAU; #1 free iOS app around 2026-09-22 [M5] | Low. MCP or raw API, OAuth + PKCE, text-only. | **Open now** at muse.ai/platform, reviewed in waves [M1] | **Medium to high** (profiling and sensitive-attribute rules, Meta discretion) | Consumer agent with WhatsApp distribution. Matches our SMS/voice-first members. Early submitters get reviewed in early waves. Submit as soon as the data-use story is written. |
| 4 | **Gemini** | ~1B (2026-08) [R1] | Low for custom URL (DCR). The listing is BD-only. | No self-serve directory [G4] | Medium | Huge reach, but only "paste a URL" for US personal accounts on Spark-eligible plans [G1][G2]. Ship the help page now and pursue a partnership in parallel. |
| 5 | **Grok** | ~117M (2026-03) [R1] | Low (teammate doc) | Per teammate doc | Medium | Moderate reach. Supports remote MCP per PRD §11. |
| 6 | **Meta AI** (app, web, glasses) | ~1.2B, inflated by in-app exposure [R1] | Medium (voice/glasses UX) | Preview; publishing "later phase" [M3] | Medium to high | Apply to the preview now, in parallel with Muse. Publishing is blocked on Meta. |
| 7 | **Perplexity** | ~100M (2026-04) [R1] | Very low (custom connector) | No public directory [P5] | Low | Document the custom-connector setup. Ask about a managed listing. |
| 8 | **Mistral Le Chat** | Small and EU-centric (no reliable figure) | Very low (custom MCP + DCR) | Curated, no public form [MI2] | Low review risk; GDPR exposure | Setup doc only, until The Network expands to the EU. |
| 9 | **Microsoft 365 Copilot** | ~420M across Copilot surfaces [R1]; consumer Copilot has no third-party path [MS4] | Medium to high (toolkit, Partner Center, SLOs) | Agent Store via Partner Center [MS2] | **High** (enterprise value bar, workplace suitability [MS3][MS7]) | Only worth it with an enterprise or professional-network variant. |
| 10 | **Apple Siri / Apple Intelligence** | Very large installed base | High (native iOS app required) | App Store | Medium (guidelines 1.2 and 5.1.2) | Not MCP. Do this when an iOS app exists. Meanwhile, Siri users reach us indirectly through ChatGPT, Gemini, or Claude. |

### Suggested sequencing

- **Wave A, now.**
  - Harden the shared core: DCR, lenient `resource` handling, annotations, idempotency.
  - Self-serve "paste a URL" support for Claude, ChatGPT dev mode, Perplexity, Gemini, Mistral, and a Muse custom connector. This gives a zero-review alpha.
- **Wave B, listings.** Submit, in this order:
  1. ChatGPT app directory
  2. Claude directory
  3. Muse Connector Platform
  4. Grok
- **Wave C, waitlists and BD.** All in parallel:
  - Meta AI Connectors preview application
  - Google Connected Apps partnership
  - Perplexity managed connector
- **Wave D, conditional.**
  - Microsoft Agent Store, only with an enterprise framing.
  - Apple App Intents, only once an iOS app exists.

---

## Sources

Accessed 2026-10-05 unless noted.

### Google

- [G1] Google Gemini Apps Help, "Connect & manage custom apps for Gemini Apps", accessed 2026-10-05. https://support.google.com/gemini/answer/17209137?hl=en&co=GENIE.Platform%3DDesktop
- [G2] 9to5Google, "Gemini Spark now supports 3rd-party apps, including MCP…", 2026-06-30. https://9to5google.com/2026/06/30/gemini-spark-apps-more/
- [G3] Gemini Enterprise Help, "Set up your custom MCP server connection", accessed 2026-10-05. https://support.google.com/g/answer/17106276?hl=en
- [G4] Tallyfy, "How to get your MCP server into Google Gemini", 2026. https://tallyfy.com/how-to-list-mcp-server-google-gemini/ **(secondary)**
- [G5] Google blog, "The Gemini app becomes more agentic…", 2026-05 (I/O). https://blog.google/innovation-and-ai/products/gemini-app/next-evolution-gemini-app/
- [G6] Google Workspace Updates, "Connect to more tools with Gemini in Google Workspace", 2026-09. https://workspaceupdates.googleblog.com/2026/09/connect-to-more-tools-with-gemini-in-Google-Workspace.html
- [G7] Google Workspace Updates, "Gems are now available in the side panel…", 2025-07. https://workspaceupdates.googleblog.com/2025/07/gems-in-the-side-panel-of-google-workspace-apps.html
- [G8] Android Developers Blog, "Top AI on Android updates… I/O '26", 2026-05. https://android-developers.googleblog.com/2026/05/android-ai-intelligence-system.html
- [G9] Carly, "Gemini MCP: How to Add a Custom Server in 2026", 2026. https://www.usecarly.com/blog/gemini-mcp/ **(secondary)**
- [G10] Google Cloud Community (Medium), "How to Configure Gemini Enterprise to Connect to a Custom MCP Server", updated 2026-06-15. https://medium.com/google-cloud/how-to-configure-gemini-enterprise-to-connect-to-a-custom-mcp-server-2e28adc96420 **(secondary)**
- [G11] Google, Generative AI Prohibited Use Policy, last modified 2024-12-17. https://policies.google.com/terms/generative-ai/use-policy

### Meta

- [M1] Meta, Muse Connector Platform docs and terms, accessed 2026-10-05. https://muse.ai/platform/docs ; https://muse.ai/platform/terms
- [M2] Meta for Developers, "Meta Connect 2026: The end-to-end recap", 2026-09. https://developers.meta.com/blog/meta-connect-recap/
- [M3] Meta, Meta AI Connectors developer preview, accessed 2026-10-05. https://dev.meta.ai/products/connectors
- [M4] Meta for Business, "Introducing Meta Ads AI Connectors", 2026-04-29. https://www.facebook.com/business/news/meta-ads-ai-connectors
- [M5] Fortune, 2026-09-22. https://fortune.com/2026/09/22/metas-muse-ai-is-exploding-in-popularity-and-drawing-heated-backlash/

### Microsoft

- [MS1] Microsoft 365 Developer Blog, "MCP Apps now available in Copilot chat", 2026-04-07. https://devblogs.microsoft.com/microsoft365dev/mcp-apps-now-available-in-copilot-chat/
- [MS2] Microsoft Learn, "Build and Publish Microsoft 365 Copilot Plugins for Customers" (ISV publisher guide), accessed 2026-10-05. https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/isv-publisher-guide
- [MS3] Microsoft Learn, "Guidelines to Validate Agents", ms.date 2026-08-13, updated 2026-09-28. https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/deploy-and-publish/appsource/prepare/review-copilot-validation-guidelines
- [MS4] Microsoft Support, "Connecting Microsoft Copilot to other services", accessed 2026-10-05. https://support.microsoft.com/en-us/topic/connecting-microsoft-copilot-to-other-services-cc06f6ef-a885-4187-9380-712bb4cabac8
- [MS5] Microsoft Copilot blog, "Model Context Protocol (MCP) is now generally available in Microsoft Copilot Studio", accessed 2026-10-05. https://www.microsoft.com/en-us/copilot/blog/copilot-studio/model-context-protocol-mcp-is-now-generally-available-in-microsoft-copilot-studio/
- [MS6] M365 Admin (handsontek), "Federated Copilot Connectors in Microsoft 365 Copilot", 2026. https://m365admin.handsontek.net/microsoft-copilot-microsoft-365-federated-copilot-connectors-microsoft-365-copilot/ **(secondary)**
- [MS7] Microsoft Learn, Teams Store validation guidelines ("Suitable for workplace consumption"), updated 2026-08-05. https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/deploy-and-publish/appsource/prepare/teams-store-validation-guidelines
- [MS8] Microsoft Learn, Marketplace general listing and offer policies (100.10; 1140), accessed 2026-10-05. https://learn.microsoft.com/en-us/legal/marketplace/certification-policies

### Perplexity

- [P1] Perplexity Help Center, "Adding Custom Remote Connectors", accessed 2026-10-05. The page returned 403 to our fetcher; details come from its search-indexed text. https://www.perplexity.ai/help-center/en/articles/13915507-adding-custom-remote-connectors
- [P2] Perplexity docs, Agent API MCP tools, accessed 2026-10-05. https://docs.perplexity.ai/docs/agent-api/tools/mcp
- [P3] GitHub issue #785, DesktopCommanderMCP, "Remote MCP: OAuth fails with Perplexity (trailing slash in resource parameter)", 2026. https://github.com/wonderwhy-er/DesktopCommanderMCP/issues/785
- [P4] Perplexity changelog, "What we shipped – March 13, 2026" (returned 403; date taken from the URL and search index). https://www.perplexity.ai/changelog/what-we-shipped---march-13-2026 . Managed-connector list and api@perplexity.ai suggestion are from search-indexed third-party summaries **(secondary, unverified)**.
- [P5] Perplexity community forum, "How do we submit our MCP server so it shows up in the connectors database officially", 2026-09-08. https://community.perplexity.ai/t/how-do-we-submit-our-mcp-server-so-it-shows-up-in-the-connectors-database-officially-not-as-a-custom-connector/6043
- [P6] Hjarni docs, "Connect Perplexity to an MCP server", 2026-05. https://hjarni.com/docs/connect-perplexity-mcp **(secondary)**

### Mistral

- [MI1] Mistral AI, "Le Chat. Custom MCP connectors. Memories.", 2025-09-02. https://mistral.ai/news/le-chat-mcp-connectors-memories/
- [MI2] Mistral docs, "MCP Connectors", accessed 2026-10-05. https://docs.mistral.ai/le-chat/knowledge-integrations/connectors/mcp-connectors
- [MI3] GitHub, awesome-mistral-connectors CHANGELOG, as of 2026-07-02. https://github.com/rdmgator12/awesome-mistral-connectors/blob/main/CHANGELOG.md **(secondary)**

### Apple

- [A1] Lushbinary, "WWDC 2026: iOS 27, New Siri & Dev Tools", 2026-06. https://lushbinary.com/blog/wwdc-2026-announcements-ios-27-siri-developer-guide/ **(secondary)**
- [A2] Apple Developer, WWDC26 session 240 "Build intelligent Siri experiences with App Schemas", 2026-06. https://developer.apple.com/videos/play/wwdc2026/240/
- [A3] Apple Developer, WWDC26 sessions 343 and 344 (advanced App Intents; "Make your app available to Siri"), 2026-06. https://developer.apple.com/videos/play/wwdc2026/343/ ; https://developer.apple.com/videos/play/wwdc2026/344/
- [A4] MacSparky, "Apps Adding Siri AI Support for iOS 27", 2026-10-02. https://www.macsparky.com/blog/2026/10/apps-adding-siri-ai-support-for-ios-27/
- [A5] AppleWorld.Today, "Apple will allow third-party AI chatbots to integrate with a Siri AI in iOS 27", 2026-06. https://appleworld.today/2026/06/apple-will-allow-third-party-ai-chatbots-to-integrate-with-a-siri-ai-in-ios-27/ **(secondary)**
- [A6] Apple, App Store Review Guidelines (1.1.4, 1.2, 5.1.1, 5.1.2), accessed 2026-10-05. https://developer.apple.com/app-store/review/guidelines/

### Reach

- [R1] Momentic, "Top AI Chatbots and Assistants by Market Share August 2026", 2026-08 (and figures echoed by Tech Insider, 2026). https://momenticmarketing.com/blog/top-ai-chatbots ; https://tech-insider.org/copilot-vs-gemini-vs-perplexity-2026/ **(secondary; approximate)**
- [R2] SQ Magazine, "ChatGPT vs Claude vs Gemini vs Perplexity Statistics 2026", 2026. https://sqmagazine.co.uk/chatgpt-claude-gemini-perplexity-statistics/ **(secondary)**
