# Muse as a host for The Network connector

Research date: 2026-10-05. Scope: PRD Section 11 (four-tool connector: `network.talk`, `network.share_context`, `network.get_updates`, `network.respond`, served from a remote MCP server with OAuth). Every claim is tagged with a source ID; the source list at the end gives the URL, the publication date where known, and the access date. Muse is three to four weeks old and much of the coverage is secondary. Claims that rest only on third-party blogs are marked **(secondary)**.

---

## 1. Which "Muse"?

| Candidate | What it is | Can it host third-party connectors? |
|---|---|---|
| **Meta Muse (personal AI agent)** | Meta's consumer personal agent. Announced 2026-09-08. Runs on iOS, Android, and the web at muse.ai, and works inside WhatsApp. US-only at launch [S1][S2]. Each user gets a cloud VM ("Muse Secure VM") with its own browser [S1][S5]. Pricing is a free tier plus $20 and $100 per month plans [S1][S3]. | **Yes.** A developer Connector Platform opened 2026-09-18 at muse.ai/platform [S4][S6][S7]. |
| Meta Muse Spark (model family) | The LLM family from Meta Superintelligence Labs. The first model shipped 2026-04-08 and powers the Meta AI app and meta.ai [S8][S9]. Muse the agent runs on Muse models [S3]. | No. It is a model, not a host. The Meta AI app has a separate connector preview, covered in other-assistants.md. |
| Meta Muse Code | Meta's coding agent. It supports MCP servers through stdio and streamable HTTP config [S10] **(secondary)**. | Developer tool only. Not a consumer channel. |
| Microsoft Muse (WHAM) | A Microsoft Research generative model of gameplay (World and Human Action Model), built with Ninja Theory [S11]. | No. |
| Sudowrite Muse | A fiction-writing LLM available only inside Sudowrite [S12]. | No. |

**Recommendation: the team almost certainly means Meta Muse, the personal AI agent.** The evidence:

1. The PRD lists Muse beside ChatGPT, Claude, and Grok as an assistant "a member already uses" (prd-snapshot.md §11). Only Meta Muse is a general consumer assistant.
2. Meta Muse is the only Muse with a third-party connector program. It has a public submission form [S4][S6].
3. It is a mass-market product. It took the #1 free app spot on Apple's App Store from ChatGPT around 2026-09-22 [S13]. Meta received more than 1,500 connector applications in its first week [S14] **(secondary)**; another report says more than 2,000 [S6] **(secondary)**.

---

## 2. Integration surfaces

Meta Muse has three ways in for a third-party service [S14][S15] **(secondary, but they agree with the Meta help-center text quoted there)**.

| Surface | Review | Fit for The Network |
|---|---|---|
| **Directory connector.** Submitted through muse.ai/platform. After approval it appears in **Settings > Connectors** and the Muse agent can find it [S7]. Editors may feature some connectors [S4]. | Meta reviews functional, security, and legal requirements, with end-to-end testing [S4][S7]. | **Primary target.** |
| **Custom connector.** Muse builds a connector for one user from a service's API, CLI, or (reportedly) MCP URL. Meta's consent dialog says Meta "doesn't review custom connectors or how they use your information" [S15][S16]. | None. | Use it for **alpha testing now** with no review. Sources disagree on whether an MCP URL works directly: [S16] says yes, [S10] says custom connectors are built against REST or CLI. Plan for both. |
| **Browser fallback.** With no connector, Muse drives the website in its VM browser [S14]. | None. | Avoid. The web app would need to tolerate an agent, and that path skips our consent UX. |

Runtime architecture that matters for design [S5]:

- Connector logic runs **outside** the agent's runtime cell.
- Each action is approved or denied by **Sentinel**, a host-side policy process the agent cannot override.
- The model never holds real credentials. Surrogate tokens are swapped for real ones at the network boundary.
- In practice, our OAuth tokens are held by Meta's infrastructure and not exposed to the model. That is good for GW-001 and GW-002.

**What we found about UI:** The docs do not describe any rich UI, cards, or widgets for connectors [S7]. Plan for text-only results with links. Each pending item should include a deep link back to The Network for anything visual. This is GW-007 degradation.

**Other user-facing behavior:**

- Muse works in the Muse app and in WhatsApp [S1].
- It has memory, can be asked to "forget", and keeps an audit trail of actions [S2].
- It adds macOS control, smart glasses, and a "Muse Charm" device. These were announced 2026-09-23 [S3].

---

## 3. Developer program and submission

**Entry point:** muse.ai/platform, with docs at muse.ai/platform/docs and terms at muse.ai/platform/terms [S4][S7][S17]. The flow has three steps: describe the product, submit for review, appear in the directory [S4].

**Form fields** [S6] **(secondary; the Stacktree submission write-up, 2026-09-19)**:

- **Step 1, Overview:** connector name, company, website, example prompts, 512×512 PNG/SVG icon, whether it takes payments, contact name, work email, support email or URL, privacy policy URL, terms of service URL.
- **Step 2, Technical:** connection type, either "Raw API" or "Existing MCP". For MCP you give a hosted MCP endpoint and documentation. Authentication checkboxes are "API keys", "OAuth with PKCE", and "Other", plus an access-requirements field.
- **Step 3, Review:** an acknowledgement that submission "does not guarantee approval" and that promotion depends on usage and editorial discretion.

**Required artifacts** (Meta guidelines §5) [S7]:

- connector overview and use cases
- business verification evidence
- data processing questionnaire
- integration credentials (OAuth client or API key), with test and production environments kept separate
- a **dedicated test account with representative data**
- per-tool classification: Read, Write, or Sensitive write

**Review stages** [S7]:

1. Risk assessment: security, privacy, integrity.
2. Tool review: classification and policy per tool.
3. End-to-end QA: workflows, manual review, permission validation.

Reviews run "in waves" [S6]. No SLA or fee is published [S14].

**Payments:** Muse has a Stripe Link partnership [S4]. The Network should declare "does not accept payments".

---

## 4. Auth

- **Supported:** OAuth with PKCE, or API keys [S6]. The guidelines ask for "the endpoint, authentication setup, requested scopes, and credentials", so Meta expects a **pre-registered OAuth client** that we issue to them. They also recommend read-only scopes where possible [S7].
- **Credential custody:** tokens are held by Meta's credential service and inserted after Sentinel approves each request [S5][S14].
- **Recommended setup for The Network:**
  - OAuth 2.1 authorization code with PKCE.
  - A confidential client issued to Meta, with separate test and production clients.
  - Dynamic Client Registration and `/.well-known/oauth-authorization-server` metadata as well. Other hosts need them, and at least one Muse submitter shipped DCR [S6]. The custom-connector path also needs them.
  - Minimal scopes that match the four tools, for example `updates:read`, `context:write`, `respond:write`, `talk`.
  - Revocation that keeps Network history intact (GW-005).
  - Phone OTP lives inside our own OAuth login page and is never collected by Muse.

---

## 5. Policy risks for a people-matching product

Ranked by severity.

1. **"No secondary uses … profiling".** The data rules say connector data may be used "only as necessary to fulfill their requests" and prohibit secondary uses including "profiling" and model training [S7].
   - `network.share_context` sends Muse-known profile data to us so we can match. A reviewer could read that as profiling.
   - *Mitigation:* make matching the explicit, user-requested purpose. The tool description and consent copy should say "share this so The Network can suggest people and opportunities for you". Store it as member-editable profile data. Exclude it from model training. Delete it on revoke.
2. **Sensitive attributes.** The policies forbid connectors that "infer or act on sensitive attributes" without explicit disclosure [S17].
   - Interest-based matching can easily touch sensitive inferences such as religion, health, or orientation.
   - *Mitigation:* do no sensitive-attribute inference on data from Muse. Disclose matching logic in the privacy policy.
3. **Opaque catch-all tool versus per-action approval.**
   - A tool that "combines reads and writes must be classified as a write" [S7].
   - Sensitive writes need approval on every use. "Allow once" covers only the action and details shown. Changed details need fresh approval [S7].
   - `network.talk` can accept or decline and change preferences. Reviewers may flag it as hiding actions.
   - *Mitigation:* see the tool mapping in §6. `talk` never executes a consequential action. It only returns a pending item that must be confirmed through `network.respond`.
4. **Contacting other humans counts as irreversible.** Emails and purchases are Meta's examples of sensitive writes [S7]. Accepting an introduction that notifies another member belongs in the same class. Classify `network.respond` as **Sensitive write**.
5. **Deception and integrity rules.** No fabricated urgency [S7]. Copy like "Only 2 spots left, reply now" for opportunities is out. This fits the PRD's attention-protection principle anyway.
6. **Platform discretion and competition.**
   - Meta may "decline, suspend, disable, or remove any Connector at any time for any reason" [S17].
   - Meta runs adjacent social and people products, so treat Muse as a channel we do not control. GW-006 server-side state already makes this survivable.
   - Liability is capped at $1,000 for Meta, while we indemnify them [S17].
7. **Operational duties.**
   - Notify `vendor-incident@meta.com` within 48 hours of any security incident involving user data [S7][S17].
   - Encrypt in transit, and encrypt sensitive data at rest [S7].
8. **Geography and age.**
   - Muse is US-only at launch, with Canada mentioned in [S14], and adults only [S1][S16].
   - Muse is not available in the EU [S14]. That matches a US-first MVP.

No source lists dating, social, or people-matching as a **prohibited** category [S6][S7]. The risk comes from the data-use and sensitive-attribute rules above, not from a category ban.

---

## 6. Step-by-step build guide

1. **Reuse the vendor-neutral remote MCP server** from PRD §11.1. Use streamable HTTP and serve it over HTTPS from our own domain.
2. **Classify the tools for Muse.** These classifications go in the submission:

   | Tool | Muse class | Notes |
   |---|---|---|
   | `network.get_updates` | Read | Returns only items cleared for this member. |
   | `network.share_context` | Write | The consent copy must name the fields being shared. |
   | `network.talk` | Write | It mixes reads and writes. Consequential outcomes come back as `pending_action_id` items and are never executed inside `talk`. |
   | `network.respond` | **Sensitive write** | Accept, decline, or tell-me-more on a specific item. Its arguments must contain the full human-readable details (who, what, when) so Muse's per-use approval prompt shows exactly what will happen. |

3. **Write MCP tool annotations** (`readOnlyHint`, `destructiveHint`, `idempotentHint`) that match the classes above. Other hosts use these annotations, and Muse reviewers will compare them.
4. **Make every write idempotent** with durable action IDs (GW-003). Agents retry.
5. **Build the OAuth layer** described in §4. Issue Meta a dedicated client and a test client.
6. **Format results as text first.** Short plain-text summaries plus a deep link to the item. Keep it WhatsApp-friendly, since Muse also runs there [S1].
7. **Ship the skill or instruction content inside the tool descriptions.** Tell the host to search and plan first, to treat Network data as private, and to never invent urgency.
   - Do **not** embed instructions aimed at manipulating the host. Hidden actions inside tool descriptions are prohibited [S7].
8. **Seed a reviewer test account.** Give it synthetic members, pending opportunities, and questions so reviewers can exercise every tool [S7].
9. **Prepare the submission package:** icon, example prompts, privacy policy, terms, support URL, business verification, data processing questionnaire answers [S6][S7].
10. **Submit at muse.ai/platform** [S4]. Track the review waves.

---

## 7. Testing approach

- **Before review:** connect the test server as a **custom connector** in a personal Muse account. Muse builds it on request and Meta does not review it [S15][S16]. Check the following:
  - the OAuth round-trip
  - that Sentinel approval prompts render with the right detail for `respond`
  - retries hitting idempotency keys
  - revocation from Muse settings
- Test inside **WhatsApp** as well as the Muse app [S1].
- **Run adversarial prompts.** Ask Muse to list other members, extract the graph, or skip confirmation. The server must refuse every one (GW-001, GW-002, GW-004).
- Use the MCP Inspector or a similar tool for schema conformance before each submission.
- **Check behavior with no memory** (GW-006): start a fresh Muse session and confirm updates still make sense.

---

## 8. Checklist

- [ ] Remote MCP over HTTPS (streamable HTTP), plus a REST spec as fallback, since the "Raw API" option exists [S6]
- [ ] OAuth 2.1 + PKCE, with test and prod clients for Meta. Add DCR and AS metadata for the custom-connector path
- [ ] Minimal, named scopes. Revocation keeps history
- [ ] Tool classes: get_updates = Read, share_context = Write, talk = Write, respond = Sensitive write
- [ ] `talk` never executes consequential actions directly
- [ ] Data-use statement: used only to fulfil the member's matching request, no training, delete on revoke
- [ ] No sensitive-attribute inference on Muse-supplied data
- [ ] No urgency or scarcity language
- [ ] Reviewer test account with representative synthetic data
- [ ] 512×512 icon, example prompts, privacy policy, terms, support URL, business verification
- [ ] 48-hour incident notification runbook naming vendor-incident@meta.com
- [ ] Text-only rendering with deep links. Check WhatsApp formatting
- [ ] Submitted at muse.ai/platform

---

## 9. Open questions to confirm with Meta or first-hand

- Does the directory version consume **MCP natively**, or does Meta wrap it? The form offers "Existing MCP" [S6], but the guideline doc never mentions MCP [S7][S10].
- Can connectors surface proactive suggestions? This matters for PRD §11.3. Nothing documented.
- Review timeline and whether there is a fee. Neither is published [S14].
- Canada and other regions. Sources differ: US [S1] versus US/Canada [S14].

---

## Sources

Accessed 2026-10-05 unless noted.

- [S1] Meta Newsroom, "Introducing Muse: The World's First Personal AI Agent Built for Everyone", 2026-09 (launch 2026-09-08). https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/ ; Axios, 2026-09-08, https://www.axios.com/2026/09/08/meta-debuts-muse-personal-ai-agent
- [S2] Same Meta Newsroom post: privacy controls, audit trail, memory, US rollout.
- [S3] Wikipedia, "Muse (AI agent)", accessed 2026-10-05. https://en.wikipedia.org/wiki/Muse_(AI_agent)
- [S4] Meta, Muse Connector Platform landing page, accessed 2026-10-05. https://muse.ai/platform
- [S5] Meta AI Research, "How We Built Safety Into Muse", 2026-09-08. https://research.meta.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse
- [S6] Stacktree, "Meta opened Muse to connectors. Here is what the form asks for…", 2026-09 (filed 2026-09-19). https://stacktr.ee/blog/muse-connector-platform **(secondary)**
- [S7] Meta, Muse Connector Platform guidelines/docs, accessed 2026-10-05. https://muse.ai/platform/docs
- [S8] Meta AI blog, "Introducing Muse Spark", 2026-04-08. https://ai.meta.com/blog/introducing-muse-spark-msl/
- [S9] TechCrunch, 2026-04-08. https://techcrunch.com/2026/04/08/meta-debuts-the-muse-spark-model-in-a-ground-up-overhaul-of-its-ai/
- [S10] AI Agents Library, "Does Meta Muse Support MCP?", verified 2026-09-26. https://www.aiagentslibrary.com/blog/meta-muse-mcp/ **(secondary)**
- [S11] Microsoft Research Game Intelligence, Muse/WHAM, accessed 2026-10-05. https://www.microsoft.com/en-us/research/group/game-intelligence/tools/
- [S12] Sudowrite, "Sudowrite Muse", accessed 2026-10-05. https://sudowrite.com/muse
- [S13] Fortune, "Meta's Muse AI is exploding in popularity…", 2026-09-22. https://fortune.com/2026/09/22/metas-muse-ai-is-exploding-in-popularity-and-drawing-heated-backlash/
- [S14] Technspire, "Muse connectors decoded: Meta's directory vs open MCP", 2026-09 (timeline through 2026-09-23). https://technspire.com/en/blog/muse-connectors-decoded-meta-directory-vs-open-mcp **(secondary)**
- [S15] AI Agents Library, "Meta Muse Connectors: Which Apps Work + Permissions", 2026-09. https://www.aiagentslibrary.com/blog/meta-muse-connectors/ **(secondary; quotes the Meta Help Center consent text)**
- [S16] Parallel, "Meta Muse Custom Integrations: Connect Any API or MCP", 2026-09. https://parallel.ai/articles/meta-muse-custom-integrations **(secondary)**
- [S17] Meta, Muse Connector Platform Terms and Connector Policies, accessed 2026-10-05. https://muse.ai/platform/terms
- Also consulted: Zuckerberg announcement post, 2026-09-18, https://x.com/finkd/status/2101084678640066765 ; Meta Connect 2026 recap (links Muse Connector Platform and Meta AI Connectors as separate programs), 2026-09, https://developers.meta.com/blog/meta-connect-recap/
