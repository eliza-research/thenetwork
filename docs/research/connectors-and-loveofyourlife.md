# Marketplace connector for The Network, and a review of lalalune/loveofyourlife

Prepared 2026-10-05. Inputs: PRD snapshot sections 11, 13.3, 17, 28.4, 29, 30; repository `lalalune/loveofyourlife` (private; `main` at `218062e`, 2026-09-18, plus a scan of all 38 branches); host documentation fetched 2026-10-05. The prototype lives in [`prototypes/connector-mcp/`](../../prototypes/connector-mcp/).

Labels: **[primary]** official docs fetched today; **[secondary]** blogs or news; **[uncertain]** not confirmed. Host policies change often. Re-check every **[uncertain]** item before submitting anything.

---

## 0. Summary

**loveofyourlife ("LoveGPT" / blackmirror.love)** is the closest prior art to the L1 connector flow, and it is well engineered:

- One Cloudflare Worker serves REST `/v1/*`, a remote MCP endpoint (`/mcp`, 40 tools) and its own OAuth 2.1 authorization server (PKCE S256, DCR, rotating refresh tokens, device flow, passkeys).
- D1 is the source of truth, and Vectorize/Workers AI handle retrieval.
- A long `SKILL.md` makes the user's own assistant do the onboarding and reasoning. The server makes no generative LLM calls and enforces reciprocal eligibility and mutual likes.
- 201/201 unit tests pass locally (Node 24, run 2026-10-05).

What we can reuse:

- The OAuth/MCP plumbing patterns.
- Revision-bound, idempotent writes.
- The "unknown never satisfies a hard filter" rule.
- Durable onboarding state with `nextQuestions`.
- The "failed write may have landed; read back" skill rules.
- Its host-capability evidence (ChatGPT, Claude, Grok).

What we should not reuse:

- Its 40-tool granular surface. That is the opposite of PRD 11.2's four opaque tools.
- The model-asserted `authorized: true` consent.
- All dating-specific ontology and ranking.

**No real people's data is in the repo, on any branch.** Profiles are synthetic fixtures (`Synthetic 0001…`, bios starting "SYNTHETIC TEST PROFILE — not a real person"). The pilot CSVs are header-only and the SF/NYC cohort is "prepared, not executed". Production accounts may exist in its live D1. I did not access them, and they could not be used anyway (section 5.3).

**Marketplace status (Oct 2026):**

| Host | Integration surface | Directory path | Blocker for The Network |
|---|---|---|---|
| **Claude** | Remote MCP custom connector; Connectors Directory; MCP Apps UI; skills only via plugins | Self-serve submission at claude.ai/directory/manage; automated scan gives "Community" listing, some escalated to "Verified" | None explicit. Check the Usage Policy for adults-only social/romance **[uncertain]**. Needs a real OAuth server. |
| **ChatGPT** | Remote MCP "app" inside a **plugin** (renamed from "apps" 2026-07-09 **[secondary]**); MCP Apps UI | Plugin Directory submission; verified developer; one review at a time | **Hard blocker:** plugins must be suitable for ages 13–17; 18+ "will arrive once age verification … in place" **[primary]**. The Network is 18+. |
| **Grok** | xAI API `mcp` tool; consumer grok.com custom connectors (paste URL) | No public submission process found; catalog looks partnership-only **[uncertain]** | No host-side approval gate (`require_approval` unsupported), so the server must gate everything. Distribution is "paste our URL". |
| **Muse (Meta)** | Meta's Muse agent (Muse Spark model); connector program at muse.ai/platform | Describe → Meta review (functional, security, legal, E2E QA) → directory | Unconfirmed whether connectors are MCP **[uncertain]**. Business verification. "Sensitive write" (sending communications) needs approval every time. |

**Cross-cutting blocker:** Eliza Cloud has no OAuth authorization-server metadata for MCP clients (PRD 30.2). Every host requires it except Grok-via-API, where we supply the bearer ourselves. Section 4.2 lays out three ways to close the gap.

**Prototype** (`prototypes/connector-mcp`, Bun + `@modelcontextprotocol/sdk` 1.32.1):

- The four tools with exact Zod/JSON schemas, backed by an in-memory fake Network.
- Risk-based confirmation gating (host / elicitation / Network channel), idempotency, rate limits and audit receipts.
- An outbound privacy guard, a stubbed OAuth discovery surface, an MCP Apps widget, `SKILL.md` and ChatGPT notes.
- `bun test`: 24 tests, 0 failures.

---

## 1. loveofyourlife review

### 1.1 What it is and its status

- An "agent-operated dating experiment": a portable skill plus an HTTP API and remote MCP. The user's own assistant (ChatGPT, Claude, Codex, Grok) interviews the user, drafts the profile, evaluates candidates and proposes likes. The server stores opt-in adult profiles, enforces eligibility, forms mutual matches and coordinates introductions.
- Two brands share one backend: `lovegpt.dev` and `blackmirror.love`. API and MCP are at `https://api.blackmirror.love/mcp`; dev is `dev.blackmirror.love`.
- The repo was created 2026-09-07 and last pushed 2026-10-05. It has about 512 files on main:
  - 66 dated design and acceptance docs and 94 JSON evidence artifacts
  - 43 test files (201 tests)
  - 25 D1 migrations (up to `0025_passkeys`)
  - a Next/Vinext-styled static landing site
- Pilot cities are SF and NYC. The canonical catalog has 8 cities: NYC, SF, LA, Austin, Chicago, Miami, London and Jersey City.

### 1.2 Architecture

| Layer | Implementation | Notes |
|---|---|---|
| Front door | Cloudflare Pages landing, copied starter prompt, `/SKILL.txt`, `/SKILL.md`, `/chatgpt-skill.md`, references, `love-match.zip` | The prompt installs the instructions. The skill picks a transport: reuse an existing connection, then direct HTTPS, then MCP, then the hosted recovery page. |
| API | One Worker (`src/index.ts`): `/v1/<operation>` POST, `/mcp`, OAuth routes, `/health`, `/device`, `/join`, `/account` (passkeys), admin `review`, Twilio relay webhook, dev `lab` | 32 KB request cap, Origin allowlist (`chatgpt.com`, `chat.openai.com`, `claude.ai`, `grok.com`, own origin). |
| MCP | `McpServer` + `WebStandardStreamableHTTPServerTransport`, stateless (`sessionIdGenerator: undefined`, `enableJsonResponse: true`); a new server per request | Tools are generated from the same Zod `schemas` as REST, so REST and MCP can't drift. |
| Data | D1: accounts (hashed capability key, profile JSON, revision, state), drafts, onboarding_state, likes (revision-bound), matches (unique ordered pair + `active_match_members` slot PK), passes, blocks, reports, events (cursor + ack), outbox, oauth_* tables, counters, search snapshots, phone shares (AES-GCM), passkeys | `ended_pairs` permanently excludes a former pair. |
| Retrieval | Workers AI BGE-base 768-d embeddings → Vectorize, namespaced by city, IDs `account:revision`. A revisioned outbox is processed on write and by the hourly cron, with retry backoff. | D1 stays authoritative. Vector hits are re-checked against current eligibility, and degraded retrieval is reported explicitly. |
| Background | Cron only repairs indexing and expires auth, rate-limit and snapshot rows. "Hourly checks" run on the host's own scheduler (ChatGPT tasks, Grok automations), using the user's agent. | The server cannot wake chat apps. |

### 1.3 MCP and skill design

- The skill (`skills/love-match/SKILL.md`, about 1,500 words, terminated by `LOVE_SKILL_END`) has 11 reference files (execution, onboarding, matching, scheduling, browser, connections, photos, hourly, API, ontology.json, contracts.json) and per-operation JSON contracts.
- `love_guide` is a read-only tool that serves the same skill, references and contracts in chunks (`offset`/`limit`/`nextOffset`). It exists because hosts truncate fetched files. This matters for us: we can't assume the host loaded our skill, so the MCP server `instructions` and tool descriptions must carry the critical rules on their own. Our prototype does this.
- The skill handles host realities explicitly:
  - Never claim "saved" before a write result arrives.
  - A failed write may have landed, so read back before retrying.
  - Ask at most 3 questions per turn.
  - Don't loop through setup paths after a denial.
  - Candidate text is untrusted data.
  - Photos stay in the chat.
- Its `ARCHITECTURE-REVIEW-2026-09-16.md` concludes that "universal zero-setup paste-and-go is not achievable by changing skill text alone". A prompt can't grant network, storage or scheduling capabilities. The remote MCP connector plus OAuth is the most portable path, and a small hosted page is needed for login and recovery.

### 1.4 Tools and schemas

There are 39 operations, each exposed as `love_<op>` over MCP and `/v1/<op>` over REST, plus `love_guide` (40 MCP tools). All inputs are strict Zod objects (`src/service.ts`).

| Group | Operations (input highlights) |
|---|---|
| Session/state | `status`, `resume` (status + profile + draft + checklist + ontology + `nextAction` + `offerPhoto`), `onboarding`, `ontology`, `cities{query?}`, `sessions`, `session_revoke{sessionId, authorized:true}` |
| Profile | `profile_get`, `draft_save{profile(partial), expectedDraftRevision, fieldStates?, clearFields?}`, `profile_save{profile, expectedRevision, expectedDraftRevision?}`, `facts_confirm{expectedRevision, fields:[age\|location], authorized:true}`, `settings{autoLikes, dailyLimit 1–20}`, `pause{paused}` |
| Discovery | `search{cursor?, sort?: alignment\|distance}`, `candidate{id}`, `inbox{after?, afterId?}`, `like{id, targetRevision, ownRevision, category, confidence, evidence[3–8], automatic, authorized:true}`, `like_status`, `like_withdraw{…, authorized:true}`, `pass{id, targetRevision}` |
| Events | `events{after}`, `ack{ids[]}` |
| Introduction | `matches`, `phone_share{matchId, phoneNumber E.164, confirmed:true, authorized:true}`, `phone_status`, `phone_revoke`, `messages`, `message_send{matchId, body, requestId uuid, authorized:true}`, `meeting_propose{matchId, place, at, publicPlace:true, authorized:true, requestId}`, `meetings`, `meeting_respond{id, decision, authorized:true}`, legacy `relay_prepare`/`relay_status` (disabled in prod) |
| Safety/lifecycle | `unmatch`, `block{id}`, `report{id, reason}` (also blocks), `export`, `delete{confirm:"DELETE"}`, `rotate` |

- **Annotations:** `readOnlyHint` for 18 read operations. `destructiveHint` for delete, rotate, session_revoke, like_withdraw, block and unmatch. `openWorldHint` is set on every non-read tool.
- **Error contract:** `{error, details}` with `isError`. A 401 carries `WWW-Authenticate: Bearer resource_metadata=…`.

### 1.5 Auth model (`src/oauth.ts`, `oauth-session.ts`, `storage.ts`, `device.ts`, `passkeys.ts`, `browser-session.ts`)

- **Account credential:** an anonymous 256-bit bearer "capability key" from `POST /v1/register` or the `/join` page, stored as a SHA-256 hash. No email or phone identity. Recovery uses a saved key, a remembered-browser cookie (`love_browser`), or an optional passkey.
- **OAuth 2.1 AS on the same origin:**
  - PRM at `/.well-known/oauth-protected-resource` (`resource: …/mcp`, one scope `love`). AS metadata includes `registration_endpoint`, `device_authorization_endpoint`, `S256` and auth method `none`.
  - DCR accepts https or loopback redirect URIs and is rate-limited 30/h/IP.
  - `/authorize` is a CSRF-protected consent page. Login is by remembered browser, passkey or pasted recovery credential, with a CSP restricting `form-action` to the callback origin.
  - Codes last 5 minutes.
  - Access tokens last 1 h. Sessions last 90 days with rotating refresh tokens; replaying a refresh token revokes the session. `resource` must equal `…/mcp` when supplied.
  - Device grant (RFC 8628) lets another HTTP-capable host pair without copying credentials.
- **Gaps:**
  - No CIMD (`client_id_metadata_document_supported`), which both ChatGPT and Claude now prefer.
  - No RFC 9207 `iss`.
  - A single all-powerful scope.
  - The raw capability key is also accepted on `/mcp` and `/v1`, so the master secret works as an MCP bearer.
  - Legacy session-less OAuth tokens bypass the resource check.
  - Tokens are opaque DB rows, not JWTs. That's fine for one Worker but not for a split AS/RS.

### 1.6 Onboarding loop and ontology

- `resume` returns `onboarding: {fields[{field, state, required}], completed/required counts, nextQuestions (≤3), readyToPublish}`.
- Field review states: `missing`, `extracted`, `needs_confirmation`, `conflicting`, `confirmed`, `skipped`, `offered`. Required fields can't be skipped.
- The host loop:
  1. Search authorized memory, messages and email for unresolved fields, keeping evidence local.
  2. Save one merged patch per batch with `draft_save` and optimistic `expectedDraftRevision`. A conflict means re-read and reconcile.
  3. Ask up to 3 unresolved questions.
  4. Repeat until `readyToPublish`.
  5. Show the exact shared profile plus the private preferences, then `profile_save` with both revisions.
- Freshness: age is re-confirmed after 365 days and location after 90, via `facts_confirm` without republishing.
- `ontology.json` v4:
  - Required fields: firstName (alias, no surname), age 18–100, gender, gendersSought, intents (long-term, casual, friendship), commitment, cityId, lat/lon inside the city envelope, ageMin/ageMax, interests, values, bio ≥ 30 characters.
  - Optional fields: lifestyle (smoking, hasChildren, wantsChildren, legacy children, drinking, pets; default unknown), dealbreakers, appearance text, physicalTraits, appearanceAssessment (1–10, confirmed), exercise, physicalPreferences, personality (Big Five 0–1), and a `publicationConsent: true` literal.

### 1.7 Eligibility logic (`domain.ts eligible()`)

The check is symmetric and fails closed. Each failure adds a reason:

- `self` or `inactive`.
- `city`, if either side has `sameCity`.
- `distance`: Haversine distance greater than *min(both radii)*.
- `age`: both directions.
- `gender`: both directions.
- `intent`: no overlap.
- `commitment`: monogamous vs non-monogamous, unless one side is "either".
- `dealbreaker:<key>`: both directions; **`unknown` never satisfies a dealbreaker**.
- `physical:*`: optional reviewed body-type, exercise and attractiveness-gap filters, both directions; a missing assessment fails a gap filter.

Rejection reasons are never returned on production endpoints, because they would leak private preferences.

### 1.8 Matching

- **Base alignment (0–100):** 40% exact-normalized value overlap, 25% interest overlap, 25% proximity, 10% clamped embedding similarity. When both people report exercise, those weights are scaled to 90% and exercise similarity gets 10%.
- **Retrieval:** a bounded city scan with keyset cursor and search snapshots, plus up to 50 Vectorize hits in the city namespace and adjacent-city partitions (NYC↔Jersey City). Everything is re-checked against current D1 state and revisions.
- **Liking:**
  - The host model writes the rationale: 3–8 evidence strings and a self-declared confidence.
  - Auto-likes need a persisted opt-in, `confidence ≥ 0.85` and a daily budget.
  - Likes are capped at 40/day.
  - Likes are bound to both profile revisions, so editing a profile invalidates outstanding likes.
- **Matching:** reciprocal same-category likes create one match atomically through a SQL trigger. Each person has one active match slot. A match removes both people from discovery and clears their other pending likes.

The authors' own review is candid: synonyms score as unrelated, generic profiles score high, and personality and appearance preferences don't affect deterministic ranking.

### 1.9 Introduction protocol

1. Mutual like → match → `phone_status` returns a grounded introduction built only from the public projection (`introduction.ts`): shared interests and values, matched category, same city, conversation starters, and public-place ideas.
2. Messages require `authorized: true` and a `requestId` for idempotency.
3. Meetings need a public place and a future time; the other person accepts, declines or cancels.
4. Direct phone exchange happens only after **both** independently call `phone_share`. Numbers are encrypted with AES-GCM, and revocation is possible but can't recall a revealed number.
5. A Twilio relay (LINK codes, signature validation, delivery callbacks) is built but disabled in production pending A2P registration.
6. Unmatch, block and report close contact. Report also blocks immediately and queues for operator review.

### 1.10 Tests, backtests and validation

- **Unit and integration:** `npm test` with `tsx --test` gives **201 pass / 0 fail** on my run, 2026-10-05, Node 24.15. Coverage includes adversarial matching, geography, OAuth (rotation, replay), passkeys, device pairing, relay, inbox boundaries, draft revisions, restore, storage invariants, prompt and skill content.
- **Backtest** (`scripts/backtest.ts`): 280 seeded personas across 8 cities, 78,400 pairs, 1,248 eligible, 0 geographic leaks and 0 reciprocal leaks. **Limitation:** it checks `eligible()` against invariants derived from the same rules, so it's a contract test, not a quality or fairness measure. The authors say so themselves.
- **Synthetic world:** `scripts/synthetic.ts` generates 1–1,000 clearly synthetic profiles. Dev fixtures use AI-generated fictional portraits, which are git-ignored. A 1,000-portrait audit measured how unstable model "attractiveness" scores are. One finding: model scores changed eligibility for 1,336 pairs.
- **Host evaluations:** evidence JSON for ChatGPT web, mobile and Work, Claude baseline and pre-final, Codex, MCP SDK client, OAuth live, backup restore and worker rollback.
- **Pilot kit** (`docs/pilot/`): consent, first-attempt vs eventual completion, honest denominators, and "synthetic profiles must never fill production supply". Not executed.
- **CI:** package skill, typecheck, test, backtest, dense search at 10k and 100k, build, verify generated contracts, reproducible build.

### 1.11 Ops docs

`OPERATIONS.md` covers:

- Build and deploy commands.
- Isolated Wrangler login.
- Dev vs prod D1 and Vectorize.
- Acceptance scripts against dev only, with production limited to read-only checks.
- Backup and restore into a separate target, with dated restore drills.
- Rollback, maintenance mode and a legacy proxy.
- Phone sharing and moderation (report queue at `/review`, password plus session secret).

Many dated runbooks cover specific incidents and features.

### 1.12 Reusable for The Network vs dating-specific

| Reuse (pattern or code idea) | Dating-specific (do not carry over) |
|---|---|
| Single Worker serving REST + MCP from one schema table, with stateless Streamable HTTP | 40 granular tools; PRD 11.2 wants 4 opaque tools |
| OAuth AS details: PKCE S256, exact redirect match, CSRF consent page, CSP `form-action` = callback origin, rotating refresh with replay revocation, resource binding, device grant, DCR rate limits | Anonymous capability-key accounts. The Network has phone-verified, invite-only identities (F3). |
| 401 `WWW-Authenticate resource_metadata` on every error path | Single `love` scope; we need per-capability scopes |
| Revision-bound writes, `requestId` idempotency, read-back after uncertain writes | Gender, orientation, attractiveness, body-type and Big Five fields; attractiveness-gap filter (explicitly out of scope in PRD 30.4) |
| "Unknown never satisfies a hard filter"; never return rejection reasons | One active match slot and permanent ended-pair exclusion (PRD 30.4 lists these as pitfalls) |
| Durable onboarding checklist with `nextQuestions` and field review states (maps onto facet provenance and confidence) | Host model as the matcher. The Network's engine decides; the host only relays. |
| `resume` as one read-all call (our `get_updates` + `talk` cover it) | Host-scheduled background likes |
| Skill rules: no "done" without a result; untrusted candidate text; ≤3 questions; no setup loops; photos stay in chat | Exact Haversine radius; The Network uses travel time (PRD 16.2) |
| Host capability matrix and acceptance evidence method; pilot denominators | Phone exchange as the end state. The Network relays until a bilateral swap (17.3). |
| Vector index as advisory with D1 authoritative, plus a revisioned outbox | |

### 1.13 Bugs and gaps found

These are from my reading of the code, in addition to the authors' own A01–A18 list in `ARCHITECTURE-REVIEW-2026-09-16.md`. Severity is my estimate.

1. **Consent is model-asserted (high).** `authorized: z.literal(true)` and `confirmed: true` are set by the host model. They prove nothing about the human (the authors' A08). Our design moves high-risk confirmation to a Network-owned channel and medium-risk to MCP elicitation where available.
2. **`settings` can enable auto-likes with no `authorized` literal (medium).** `settings{autoLikes:true, dailyLimit:20}` is not marked destructive and needs no explicit authorization, yet it unlocks automatic outbound likes.
3. **Master credential accepted as an MCP bearer (medium).** `auth()` accepts the raw account key on `/mcp`, so a leaked key bypasses OAuth session revocation and resource binding. `rotate` mitigates this.
4. **Legacy session-less OAuth tokens skip the resource check (low).** This affects `session_id IS NULL` rows.
5. **Strict Origin allowlist blocks new hosts (product gap).** The allowlist is `chatgpt.com`, `chat.openai.com`, `claude.ai` and `grok.com`. Browser-based clients such as Muse web, MCP Inspector or `claude.com` would get 403. It needs to be configurable.
6. **One scope (`love`) grants everything (medium).** That includes delete, rotate and message. There's no least-privilege grant for a read-only assistant.
7. **No CIMD and no RFC 9207 `iss` (compatibility).** ChatGPT, Claude and MCP 2026-07-28 all prefer CIMD.
8. **Friendship intent is still gated by `gendersSought` (product).** That's arguably wrong for friendship; the authors list related ontology issues in A16.
9. **Page-local ranking (known A07).** Search ranks within a 100-row ID-ordered page, so the global best can be missed unless the host reads every page.
10. **Block of an arbitrary ID returns 404 for unknown accounts (low).** Account IDs are random UUIDs, so the existence oracle is low risk.
11. **The backtest is tautological.** It doesn't measure match quality, and the authors acknowledge this.
12. **Operations depend on ignored local assets.** `dev/portraits` and synthetic credentials mean a clean checkout can't rebuild dev.

### 1.14 Seed data check (SF/NYC)

| Where | What | Real people? |
|---|---|---|
| `scripts/synthetic.ts` + `seed-development.ts` | 1–1,000 generated profiles: `id synthetic-0001…`, `firstName "Synthetic 0001"`, city by index (first 10 NYC, next 10 SF), templated interests and values. Bio starts "SYNTHETIC TEST PROFILE — not a real person"; `appearancePreferences: "PRIVATE_TEST_PREFERENCE"` canary. Inserted into **dev** D1 only. Tokens stay in ignored `artifacts/private/`. | No |
| `scripts/backtest.ts`, `tests/fixtures.ts` | 280 seeded personas ("Synthetic 0…279") across 8 cities; fixture "Synthetic Alex" | No |
| `dev/portraits/*.jpg` (git-ignored) | AI-generated fictional adult portraits for the dev lab | No (not in repo) |
| `docs/pilot/*.csv` | Header-only templates (`participant_id, city, …`) | No. "No participant has been recruited." |
| Phone numbers across all 38 branches | Only fictional `555-01xx` and Twilio magic `+1500555000x` test numbers, plus the operator's own Twilio relay number | No |
| Emails | Operator account and `developer@elizalabs.ai` only | No |

Conclusion: the repo has **no real SF or NYC profiles to bootstrap from**. Real LoveGPT users may exist in production D1. They consented to a dating service, not The Network, so their data cannot be imported (section 5.3). **No personal data from the repo was copied into this repo.**

---

## 2. Marketplace requirements (Oct 2026)

### 2.1 MCP specification baseline

**Latest spec is 2026-07-28 [primary].** It is stateless (no `initialize`, no `Mcp-Session-Id`), adds `server/discover`, `Mcp-Method`/`Mcp-Name` headers and "input_required" multi-round-trip requests, and deprecates HTTP+SSE, Roots, Sampling and Logging. Source: https://blog.modelcontextprotocol.io/posts/2026-07-28/. Our SDK (1.32.1) speaks 2025-11-25 and older, so we must stay backward-compatible.

**Authorization: what the resource server (our MCP endpoint) must do.** Source: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization

- Serve RFC 9728 PRM.
- Return 401 with `WWW-Authenticate: Bearer resource_metadata="…"`; adding `scope` is a SHOULD.
- Return 403 `insufficient_scope` naming the required scope.
- Validate the audience per RFC 8707.
- Accept only its own tokens (no passthrough).
- Not list `offline_access`.

**Authorization: what the authorization server must do.**

- Implement OAuth 2.1 and serve RFC 8414 or OIDC discovery.
- Support CIMD (SHOULD).
- DCR is optional and now deprecated.
- Return RFC 9207 `iss` (SHOULD, expected to become MUST).

**Clients** send `resource` in both the authorization and token requests.

**MCP Apps (SEP-1865)** is final at spec version 2026-01-26:

- Extension `io.modelcontextprotocol/ui`.
- `ui://` resources with MIME `text/html;profile=mcp-app`.
- Linked from a tool via `_meta.ui.resourceUri`.
- Shipped by ChatGPT, Claude, Goose and VS Code.

Sources: https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp, https://github.com/modelcontextprotocol/ext-apps

### 2.2 ChatGPT (OpenAI Apps SDK → "plugins")

**Surface.** A remote MCP server packaged as a plugin. A plugin can bundle apps (MCP + UI), skills and templates. "Apps" were renamed "plugins" and the App Directory became the Plugin Directory on 2026-07-09 **[secondary]**:

- https://helloskip.com/b/illco-ai/blog/openai-just-replaced-apps-with-plugins-and-chatgpt-now-runs-your-entire-workflow-mrf35te3
- guidelines: https://developers.openai.com/plugins/plugin-guidelines

**Auth [primary]** (https://developers.openai.com/apps-sdk/build/auth):

- OAuth 2.1 with PKCE S256 advertised.
- DCR and CIMD both supported; **CIMD preferred**, via `client_id_metadata_document_supported: true`.
- RFC 9728 PRM.
- Token `aud` must equal `resource`.
- 401 + `WWW-Authenticate` with `resource_metadata` and `scope`.
- The server validates signature (JWKS), iss, aud, exp/nbf and scopes.
- Per-tool `securitySchemes` (`noauth`/`oauth2` + scopes). The linking UI appears only when a tool error also carries `_meta["mcp/www_authenticate"]`.
- Redirect is `https://chatgpt.com/connector_platform_oauth_redirect` when the AS advertises RFC 9207 `iss`; otherwise `https://chatgpt.com/connector/oauth/{callback_id}`.

**UI [primary]** (https://developers.openai.com/apps-sdk/build/chatgpt-ui):

- MCP Apps is the standard.
- `_meta["openai/outputTemplate"]` and `window.openai.*` remain aliases.
- CSP `connectDomains` and `resourceDomains` must be declared.
- Nested frames need justification.

**Annotations and confirmation [primary]:**

- `readOnlyHint`, `destructiveHint` and `openWorldHint` are required booleans.
- Destructive covers deletion, overwrite, cancellation, access revocation, and irreversible sends or transactions.
- Irreversible operations need human confirmation.

**Policy [primary]:**

- Developer identity verification.
- A privacy policy covering categories, purposes, recipients and retention.
- Data minimization.
- Restricted data: payment cards, health, government IDs, auth secrets.
- **General audiences incl. 13–17; 18+ later.**
- Prohibited categories include adult/sexual content (dating not listed).
- No selling digital goods, subscriptions or credits.

**Submission [primary]** (https://developers.openai.com/apps-sdk/deploy/submission):

- Org owner or Apps Management Write role.
- Listing fields: name (30), subtitle (30), description (4,000), developer name, category, website, support, privacy and terms URLs, icon.
- Reviewer demo account with no MFA/OTP.
- Country targeting.
- One active review at a time; email feedback; publishing is optional after approval.
- No published SLA.
- EEA/UK/CH availability has been limited **[secondary, possibly outdated]**.

### 2.3 Claude (Anthropic)

**Surface [primary]** (https://claude.com/docs/connectors/building/submission):

- Remote MCP (Streamable HTTP, HTTPS) as a custom connector (user pastes the URL) or as a Connectors Directory listing.
- MCP Apps UI.
- Skills can be submitted only inside a plugin.
- Local MCPB listings are deprecated.

**Auth [primary]** (https://claude.com/docs/connectors/building/authentication):

- Supported by default: `oauth_dcr`, `oauth_cimd` and `none`.
- `oauth_anthropic_creds` and `custom_connection` by arrangement; `static_headers` in beta; no `client_credentials`.
- CIMD is used only if AS metadata has `client_id_metadata_document_supported: true` **and** `"none"` in `token_endpoint_auth_methods_supported`. DCR creates a client per connection, so prefer CIMD at scale.
- PKCE S256.
- 401 + `resource_metadata` is required.
- `resource` must equal the URL users enter, including the path.
- Only the **first** `authorization_servers` entry is used.
- The AS must be reachable from Anthropic egress `160.79.104.0/21`.
- Callbacks:
  - `https://claude.ai/api/mcp/auth_callback`
  - Claude Code loopback `http://localhost:*/callback` and `http://127.0.0.1:*/callback`
- Token endpoint: form-encoded, `invalid_grant` for dead refresh tokens, refresh rotation for public clients. Timeouts are 10 s for discovery, registration and token, and 30 s for refresh.

**UI [primary]:**

- MCP Apps via `@modelcontextprotocol/ext-apps` (`registerAppTool` / `registerAppResource`).
- `_meta.ui.domain` = first 32 hex characters of sha256(server URL) + `.claudemcpcontent.com`.
- Users see an Allow / Always-allow prompt.
- Link targets need declared allowed URIs.

**Review criteria [primary]** (https://claude.com/docs/connectors/building/review-criteria):

- Every tool has a `title` and `readOnlyHint: true` or `destructiveHint: true`.
- **Destructive tools always prompt.**
- Read and write are separate tools; no catch-all `api_request`.
- Names are 64 characters or fewer.
- No prompt-injection patterns in descriptions.
- Actionable errors.

**Policy [primary]** (https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy):

- No financial transfers, no generative image, video or audio, no ads.
- Minimal conversation-data collection; never read Claude memory or history.
- At least 3 use-case examples.
- Verified domain ownership.
- Privacy URL required.
- Dating and adult services are not addressed here. The Usage Policy applies **[uncertain]**.

**Submission checklist [primary]:**

1. claude.ai/directory/manage → Submit new → MCP connector (any paid plan).
2. Test as a custom connector first.
3. Listing fields: name (100), one-liner (200), description (2,000), 1–5 categories, docs, privacy and support links, icon, slug (permanent).
4. For an MCP App, 3–5 PNG screenshots at least 1000 px wide, each paired with its prompt.
5. A fully populated test account.
6. Data-handling answers and 7 compliance acknowledgments.

The automated scan lists you as "Community", and some listings escalate to "Verified". Contact is mcp-review@anthropic.com.

**Skills [primary]** (https://code.claude.com/docs/en/skills):

- `SKILL.md` with YAML frontmatter on line 1.
- Portable fields: `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`.
- Plugins use `.claude-plugin/plugin.json` and `marketplace.json`.

### 2.4 Grok (xAI)

**API [primary]** (https://docs.x.ai/developers/tools/remote-mcp):

- Tool type `mcp` (xAI SDK, OpenAI-compatible Responses API, Speech-to-Speech).
- `server_url` and `server_label` required.
- Optional `server_description`, `allowed_tools`, `authorization` (a bearer we supply) and headers.
- Streamable HTTP or SSE.
- **No `require_approval`**, so there's no host approval gate.

**Consumer [primary]** (https://docs.x.ai/grok/connectors):

- grok.com/connectors → New Connector → Custom → paste a public MCP URL → "complete any required authentication".
- OAuth specifics (DCR, CIMD) are undocumented **[uncertain]**.
- Business and Enterprise plans need admin provisioning.
- The catalog launched 2026-05-06 with about 31 integrations **[secondary]**.
- No public submission process found **[uncertain]**.
- No documented MCP Apps support or annotation handling **[uncertain]**.

Earlier LoveGPT testing reached Grok's terms gate but never confirmed native execution.

### 2.5 Muse (Meta)

**Identification.** The most likely meaning is **Meta's Muse**: a consumer personal AI agent powered by **Muse Spark**.

- Muse Spark 1.1 and the Meta Model API were announced 2026-07-09 [primary]. The model "zero-shot generalizes to … MCP servers, and custom skills". https://ai.meta.com/blog/introducing-muse-spark-meta-model-api/
- The Muse agent launched in early September 2026, with Mac computer use and glasses support coming [secondary]: https://techcrunch.com/2026/09/23/everything-new-coming-to-metas-ai-agent-muse/
- "Muse for Small Business" connectors launched 2026-09-29 [secondary].

**Connector program [primary]** (https://muse.ai/platform, https://muse.ai/platform/docs):

- Steps: describe → Meta review (functional, security, legal, E2E QA) → directory listing (with editorial featuring).
- Requires business verification, data-processing details, API credentials, tool docs and reviewer test accounts.
- Tool classes are Read, Write and **Sensitive write**. Sensitive writes are irreversible and include "sending communications"; they need approval every time, with no "Always allow".
- Connectors must complete the tasks they start.
- No secondary use, data sale or training.

**Open questions:**

- Whether connectors are MCP-based **[uncertain]**. One secondary source says Meta AI Connectors and Muse Code speak MCP, but the consumer app has no custom-MCP setting.
- Other candidates are unlikely: Microsoft's "Muse" is a gaming world model, not an assistant.

**Action:** confirm with Meta which assistant the founders mean and whether the connector program accepts remote MCP plus OAuth.

---

## 3. Connector design

### 3.1 Shape

```
Host (ChatGPT plugin / Claude connector / Grok custom connector or xAI API / Muse connector / any MCP client)
   │  Streamable HTTP, OAuth 2.1 bearer (audience = https://connect.<network-domain>/mcp)
   ▼
Network Connector Worker (Cloudflare Workers, Eliza Cloud account; route on the Network domain)
   ├─ /.well-known/oauth-protected-resource[/mcp]   (RFC 9728)
   ├─ /mcp  ── auth (JWT verify: iss, aud, exp, scope) ── per-tool scope check ── MCP server (4 tools + 1 UI resource)
   │            └─ every result → outbound privacy guard (leak checker, same as SMS path, PRD 28.5)
   └─ calls Network service API (internal, signed): agent turn, enrichment, member items, consent workflow
Authorization server (Eliza Cloud Steward, or interim Network AS Worker, §3.2)
Network service (Postgres via Hyperdrive; audit log; outreach control; review queue) — unchanged by the connector
```

**Thin and opaque (11.4).** The connector holds no graph, no scoring and no candidate data. `network_talk` *is* a Network agent turn with `channel = "connector:<client_id>"`, so policy, budgets and the leak checker apply exactly as on SMS (PRD 28.4: "network.talk = the same agent turn; share_context = enrichment pipeline").

**Sessions.** Stateless by default, which matches MCP 2026-07-28 and how LoveGPT shipped. Elicitation (the server asking the human mid-call) needs either a stateful session (a Durable Object per `Mcp-Session-Id`) or the 2026-07-28 `input_required` flow. Until then, medium-risk confirmations degrade to `host_respond` (GW-007).

**Tool names** use underscores (`network_talk`, …) and keep the PRD names as `title`. MCP permits dots, but OpenAI and Anthropic function-name rules (`^[a-zA-Z0-9_-]{1,64}$`) don't, and hosts prefix the server label.

### 3.2 OAuth 2.1

**Resource server (connector):**

- PRM: `{resource: "<origin>/mcp", authorization_servers: [<issuer>], scopes_supported, bearer_methods_supported: ["header"]}`.
- 401 challenge with `resource_metadata` and `scope`.
- 403 `insufficient_scope` per tool.
- JWT validation of iss, aud (= resource, RFC 8707), exp/nbf and scope. No token passthrough.
- Origin allowlist only when an `Origin` header is present (DNS-rebinding defense), and configurable. LoveGPT's hard-coded list would block new hosts.

**Authorization server requirements:**

- RFC 8414 metadata.
- `code_challenge_methods_supported: ["S256"]`.
- `token_endpoint_auth_methods_supported: ["none"]`: public clients; Claude needs `none` to use CIMD.
- `client_id_metadata_document_supported: true` (CIMD), plus DCR as a fallback with a redirect allowlist and per-IP rate limits.
- `authorization_response_iss_parameter_supported: true` (RFC 9207).
- `resource` parameter honored and bound into `aud`.
- Short-lived access tokens (≤1 h). Refresh tokens rotate, with replay revoking the session (copy LoveGPT's `oauth-session.ts` pattern).
- Revocation endpoint.
- Reachable from Anthropic egress `160.79.104.0/21`; token endpoint fast (under 10 s).
- Redirect allowlist:
  - `https://claude.ai/api/mcp/auth_callback`
  - `https://chatgpt.com/connector_platform_oauth_redirect`
  - `https://chatgpt.com/connector/oauth/*`
  - loopback `/callback` on any port
  - Grok and Muse callbacks once documented

**Scopes** (least privilege, revocable per client, GW-005):

| Scope | Grants |
|---|---|
| `network:updates.read` | `network_get_updates` |
| `network:talk` | `network_talk` |
| `network:context.write` | `network_share_context` |
| `network:respond` | `network_respond` |

**Consent screen:**

- Login is with the member's existing identity: phone OTP over the Network SMS/iMessage channel, or an existing eliza.app web session. **Never** with credentials typed into the host.
- The screen shows the requesting host (from CIMD/DCR metadata, labelled "unverified" unless on an allowlist), the scopes in plain words, and "you can disconnect any time at <url>".
- **Only existing members can link.** The connector is not a sign-up path around invites (PRD 7, F3). A non-member gets "The Network is invite-only; ask a member for an invite."
- Each linked client appears on the member's "Connected assistants" page with last use and revoke (GW-005). Revocation kills refresh tokens; history stays.

**Eliza Cloud gap (PRD 30.2: "Platform MCP endpoint (API key auth); no OAuth authorization-server metadata").** Options, in recommended order:

1. **Add an OAuth 2.1 AS to Eliza Cloud (Steward)**, issuing JWTs with `aud` per resource. This benefits every Eliza MCP surface but depends on the Cloud team.
2. **Interim Network AS Worker** on the same Cloudflare account. It delegates *authentication* to Eliza Cloud (phone OTP and identity links via an internal API) and only handles OAuth. LoveGPT's `oauth.ts` and `oauth-session.ts` are a proven template, minus capability keys and plus CIMD and `iss`. Cloudflare's `workers-oauth-provider` library is another starting point; its CIMD support is **[uncertain]**.
3. **Grok via xAI API only**: we mint a member-scoped bearer and pass it as `authorization` from our own backend. This doesn't help consumer hosts.

Prefer option 2 for the connector milestone if Steward won't ship in time. Keep the issuer swappable, because hosts use only the first `authorization_servers` entry and the AS URL is effectively part of the listing.

### 3.3 The four tools: exact input schemas

These are generated from `prototypes/connector-mcp/src/schemas.ts` (Zod 4 → JSON Schema 2020-12). All inputs are `additionalProperties: false`. **No tool accepts a member ID**: identity comes only from the token (GW-002). Every write takes `client_request_id` (`^[A-Za-z0-9_-]{8,64}$`) for idempotency (GW-003).

**`network_talk`** (title `network.talk`)

```json
{"type":"object","additionalProperties":false,"required":["message","client_request_id"],
 "properties":{
  "message":{"type":"string","minLength":1,"maxLength":4000},
  "conversation_id":{"type":"string","maxLength":64},
  "client_request_id":{"type":"string","pattern":"^[A-Za-z0-9_-]{8,64}$"}}}
```

Output: `{reply, conversation_id, pending_confirmation|null, related_item_ids[], receipt}`.

**`network_share_context`** (title `network.share_context`)

```json
{"type":"object","additionalProperties":false,"required":["facts","member_reviewed","client_request_id"],
 "properties":{
  "facts":{"type":"array","minItems":1,"maxItems":25,"items":{"type":"object","additionalProperties":false,
    "required":["kind","text","source"],"properties":{
      "kind":{"enum":["interest","skill","offer","desire","goal","boundary","trait","fact","preference","availability_pattern"]},
      "text":{"type":"string","minLength":2,"maxLength":500},
      "source":{"enum":["member_said_in_host","host_memory","host_connected_source"]}}}},
  "member_reviewed":{"const":true},
  "client_request_id":{"type":"string","pattern":"^[A-Za-z0-9_-]{8,64}$"}}}
```

Output: `{status:"proposed_pending_member_review", accepted[{index, proposal_id, kind}], rejected[{index, reason}], note, receipt}`.

Rejection reasons:

- `contact_details_not_accepted`
- `credential_like_text`
- `sensitive_topic_tell_network_directly`
- `duplicate`

Accepted facts become **agent-private, unconfirmed facet proposals** with provenance `connected_source`. The Network confirms them and their scope with the member later (F5, F7). The host never sets privacy scope.

**`network_get_updates`** (title `network.get_updates`, read-only)

```json
{"type":"object","additionalProperties":false,
 "properties":{
  "cursor":{"type":"string","maxLength":200},
  "kinds":{"type":"array","minItems":1,"maxItems":4,"items":{"enum":["opportunity","question","reminder","notice"]}},
  "limit":{"type":"integer","minimum":1,"maximum":20,"default":10}}}
```

Output: `{items[{item_id, kind, title≤120, body≤1000, created_at, expires_at|null, allowed_decisions[]}], next_cursor|null, member_state}`.

- `item_id` is a per-member participation ID, never the shared opportunity ID, so two members' hosts can't correlate.
- `body` is produced by the explanation generator from shareable evidence only (17.2).

**`network_respond`** (title `network.respond`)

```json
{"type":"object","additionalProperties":false,"required":["item_id","decision","client_request_id"],
 "properties":{
  "item_id":{"type":"string","maxLength":100},
  "decision":{"enum":["accept","decline","tell_me_more","confirm","cancel"]},
  "note":{"type":"string","maxLength":500},
  "client_request_id":{"type":"string","pattern":"^[A-Za-z0-9_-]{8,64}$"}}}
```

Output: `{status: done|needs_confirmation|awaiting_network_channel|not_available|details, message, item_id, pending_confirmation|null, receipt}`.

**Shared objects:**

- `pending_confirmation = {confirmation_id, summary, risk: medium|high, confirm_via: host_respond|host_elicitation|network_channel, expires_at}`
- `receipt = {receipt_id, action_id, tool, client_id, at, summary, replayed}`

**Annotations:**

| Tool | readOnly | destructive | openWorld | Why |
|---|---|---|---|---|
| `network_talk` | false | false | false | Side effects are limited to conversation and drafts; anything involving people returns `pending_confirmation` |
| `network_share_context` | false | false | false | Additive private proposals about the member |
| `network_get_updates` | **true** | false | false | Read |
| `network_respond` | false | **true** | **true** | Accept or confirm can make The Network contact another person (irreversible send) |

Claude and ChatGPT therefore prompt on every `network_respond`, which is intended. Muse would classify it as "sensitive write". Grok has no gate, so the server-side rules below carry the load.

### 3.4 Consent and confirmation semantics (GW-004)

The principle (lesson from LoveGPT's A08): **a boolean the model sets is not consent.** Confirmation strength scales with risk, and the Network, not the host, decides the channel.

| Risk | Capabilities (PRD 11.2 internal list) | How it's confirmed |
|---|---|---|
| Low | get_me, search_world, find_possibilities | No confirmation |
| Medium | ask_for_help, offer_capacity, respond_to_opportunity, propose_introduction, ask_my_network, relay_message, set_state, block | `network_talk` returns `pending_confirmation`. With form elicitation, `confirm_via = host_elicitation`: the server sends `elicitation/create` and the host renders it to the human. Otherwise `confirm_via = host_respond`: the host asks, then calls `respond{decision:"confirm"}`, under the host's destructive-tool prompt. |
| High | invite, share_contact, report_safety | `confirm_via = network_channel`, always. `respond{confirm}` only returns `awaiting_network_channel`. The member confirms by replying in their Network SMS/iMessage thread or on a Network web page (URL-mode elicitation can open it). The host can't complete it. |

**Accepting an item** (`respond{accept}` on a cleared opportunity) is the member's decision itself. It executes, then follows the normal double-opt-in (F11): the other side is asked independently and never learns of a decline.

**Other rules:**

- Confirmations expire after 24 h.
- Expired, foreign and nonexistent IDs all return the same `not_available` message, so there's no enumeration oracle.
- Cancel is always allowed.
- Report and block are safety paths. Block stays medium so it's easy (F23). Report's evidence capture and safety queue are high, but the member is *not* blocked from reporting: the high-risk channel confirmation is "is this the person and incident you mean?". Emergencies always get "contact emergency services first".

### 3.5 Rate limits

These are fixed windows per member, enforced in the Network. Hosts can't raise them. The prototype values are starting points to tune with telemetry.

| Tool | Limit |
|---|---|
| `network_talk` | 30 / 10 min |
| `network_share_context` | 10 / h, and at most 25 facts per call |
| `network_get_updates` | 60 / h |
| `network_respond` | 30 / h |
| All tools | 150 / h per member |

- Per-client-ID and per-IP limits sit on the AS (registration, token).
- Proactive-message budgets (12.3) are separate. The connector never *pushes*; members pull. Host-initiated suggestions are allowed only when the host supports them, and they don't consume the interruption budget because the member opened the conversation.
- The error is `{error:"rate_limited", retry_after_seconds}`.

### 3.6 Audit receipts

- Every call writes an audit event: member, client_id, tool, at, summary, action_id. Reads are logged without content.
- Every write returns `receipt`.
- Receipts are visible to the member in the Network ("Activity from connected assistants"), regardless of which client acted (11.1).
- An idempotent replay returns the original receipt with `replayed: true`.
- Executed high-risk actions are audited with `client_id = network_channel`, so the trail shows where consent happened.
- Retention follows the event log (13.4). Deleting the account deletes receipts except minimal safety records (F24).

### 3.7 Privacy rules (the host never sees the graph)

1. No tool returns other members' IDs, contact details, last names, non-shareable facets, scores, candidate lists, or membership existence ("is X a member?" is refused).
2. Item text is produced only by the explanation generator from shareable evidence. Inference privacy (17.2) applies before an item exists.
3. Per-member opaque item IDs; no shared opportunity IDs.
4. **Outbound guard** on every result (defense in depth). It blocks output containing any forbidden string for this viewer (other members' IDs, phones, emails, non-shareable facet text, internal IDs) or any phone or email pattern. The prototype tests prove it catches an injected bug. In production this is the same leak checker used for SMS (28.5).
5. The member's own agent-private facts are not exported to the host either. "What do you know about me" returns matchable and shareable items and links to the Network page for the rest. Hosts may log, train on or remember tool output, so minimize.
6. Inbound `share_context` refuses contact details, secrets and sensitive categories. Health, pregnancy and similar facts should be told to the Network directly, where they're stored agent-private (17.1).
7. All host-supplied text is untrusted. Server instructions tell the host that item text is data, not instructions.
8. No Network content appears in tool *descriptions* (prompt-injection review on Claude).

### 3.8 Per-host adaptations

| Host | Adaptation |
|---|---|
| **Claude** | `SKILL.md` (prototype) shipped inside a Claude plugin with `.claude-plugin/plugin.json`, because skills are only accepted in plugins. MCP Apps widget for updates, with `_meta.ui.domain` set to the sha256-derived `claudemcpcontent.com` subdomain. Titles plus explicit read-only and destructive hints. CIMD with `none`. Callback `claude.ai/api/mcp/auth_callback`. Directory listing needs 3+ use cases and 3–5 screenshots. |
| **ChatGPT** | A plugin wrapping the same MCP server. `_meta.ui.resourceUri` plus the `openai/outputTemplate` alias, `openai/toolInvocation/*` strings, per-tool `securitySchemes`, `_meta["mcp/www_authenticate"]` on auth errors. Skill content goes into the plugin's skill. No commerce. See `prototypes/connector-mcp/CHATGPT-APPS-SDK.md`. **Blocked on the 13–17 audience rule.** |
| **Grok** | Paste-URL custom connector; MCP Apps not assumed. There's no approval gate, so rely on `pending_confirmation` plus Network-channel confirmation for anything that touches people. Recommend that Grok users get *no* `network:respond` scope by default, so their consent prompt only offers read, talk and context, with respond as an opt-in. xAI API integrations pass our bearer in `authorization`. |
| **Muse** | Map `network_get_updates` to Read, `network_talk` and `share_context` to Write, and `network_respond` to Sensitive write (approval every time). Connector packaging and MCP support to be confirmed with Meta. Business verification and reviewer accounts are required. |
| **Generic / future** | Plain MCP plus REST twin (`/v1/talk`, …) from the same schemas (LoveGPT pattern). Capability negotiation: no elicitation means `host_respond`; no UI means text-only `content` with the same facts as `structuredContent`. |

### 3.9 Submission checklists

**Common prerequisites (all hosts):**

1. Production AS (§3.2) with CIMD, DCR fallback, S256, `iss`, rotation and revocation.
2. Public HTTPS connector domain with verified ownership.
3. Privacy policy, terms and community guidelines covering connector data (PRD 28.5, 36.2). They must state:
   - What the host sends (`share_context`, messages).
   - What the host receives (cleared items, replies).
   - Retention.
   - That we never read host memory.
4. Support URL and contact.
5. Reviewer demo member: phone-free login (a test OTP bypass scoped to one synthetic account), no MFA, in a **synthetic** world populated with clearly fictional members and items. Never real people.
6. Icon, descriptions, 3+ worked examples (§SKILL examples).
7. Revocation page; data export and delete.
8. Monitoring for the connector: auth failures, guard trips, rate-limit hits.

**Claude Connectors Directory:**

- Pass as a custom connector on web, desktop and mobile.
- Every tool has a title and an explicit read-only or destructive hint.
- Read and write tools are separate.
- No injection-like text in descriptions.
- Actionable errors.
- Listing fields: name, one-liner, description, categories, docs, privacy, support, icon, permanent slug.
- MCP App screenshots.
- Test credentials.
- Data-handling answers and 7 acknowledgments.
- Skill packaged as a plugin.
- Confirm Usage Policy fit for an 18+ social service with optional romance **[open]**.

**ChatGPT Plugin Directory:**

- Verified developer and org role.
- Listing fields (30/30/4,000 limits), category, URLs, icon.
- Annotations on every tool.
- CSP declared for the widget.
- Demo account with no MFA.
- Country targeting.
- **Resolve the 13–17 audience rule with OpenAI before submitting** (§0).
- No digital sales.

**Grok:**

- No directory submission path is known. Publish setup instructions (grok.com/connectors → Custom → URL).
- Test OAuth discovery from Grok.
- Ask xAI about catalog partnership.

**Muse:**

- Apply at muse.ai/platform with business verification, data-processing details, tool docs, test accounts and the Read/Write/Sensitive classification.
- Confirm MCP support.

### 3.10 Before the connector ships (PRD 28.4 dependencies)

The connector is post-MVP. It inherits the MVP's agent turn, leak checker, outreach control, consent workflow, review queue and audit log. Don't start marketplace submissions until:

- MVP launch gates pass (28.5).
- The AS exists.
- A connector-specific privacy canary suite runs in the simulated world. Reuse `tests/leak.test.ts` probes against the real agent.

---

## 4. The prototype (`prototypes/connector-mcp/`)

```
cd prototypes/connector-mcp && bun install && bun test     # 24 pass, 0 fail
bun run start                                              # http://localhost:8787/mcp, Bearer dev-ava
```

| File | Purpose |
|---|---|
| `src/schemas.ts` | Exact Zod schemas for the 4 tools (input + output), scopes, per-tool scope map, JSON Schema export |
| `src/policy.ts` | Risk table, `confirmVia()`, rate limiter (Clock-driven), contact/secret/sensitive detectors, `findLeaks()` |
| `src/fake-network.ts` | In-memory Network: members with canary facets, per-member items, confirmations, idempotency, receipts, effects log, `confirmOnNetworkChannel()`, `seedWorld()` (3 fictional members) |
| `src/server.ts` | `McpServer` with the 4 tools, annotations, `_meta` (securitySchemes, MCP Apps + OpenAI aliases), elicitation for medium-risk, outbound guard |
| `src/http.ts` | PRM + AS metadata (stub), DCR with redirect allowlist, 501 stubs for authorize/token, `/mcp` with bearer, audience and per-tool scope checks, Origin allowlist, stateless Streamable HTTP |
| `src/widget.ts` | MCP Apps HTML widget (text-only DOM, no `innerHTML`) |
| `SKILL.md` | Claude skill (portable frontmatter) |
| `CHATGPT-APPS-SDK.md` | ChatGPT build notes and submission gaps |
| `tests/*.test.ts` | Schemas and annotations; confirmation gating (high-risk host confirm doesn't execute, elicitation accept/decline, cancel, expiry, foreign IDs, idempotency, rate limits); leak tests (11 adversarial prompts, canaries, cross-member item access, share_context filters, guard catches an injected leak); HTTP (PRM, AS metadata, DCR allowlist, 401/403 challenges, wrong audience, Origin, end-to-end JSON-RPC) |

It imports `Clock`/`SimClock`, `PrivacyScope`, `ParticipationState` and `City` from `@thenetwork/core`.

**Stubbed or simplified:**

- `network_talk` routing is regex, standing in for the real agent turn.
- `/oauth/authorize` and `/oauth/token` return 501.
- Tokens come from a static verifier, not JWT/JWKS.
- No `_meta["mcp/www_authenticate"]` yet.
- No stateful sessions, so elicitation over HTTP is untested (it is tested in-memory).
- The widget hasn't been tested in a real host.

---

## 5. Seed and bootstrap profiles for SF and NYC

The request was "preliminary profiles for people in SF and NYC we could bootstrap off of". PRD 13.3 forbids scraped or third-party profiles of non-members, including public ones and other agents' profiles from X. The reason is practical as well as ethical: matching people who never signed up produces unanswered outreach and erodes trust. These three compliant pieces give the same bootstrap effect.

### 5.1 (a) Consented seed invite list (founders fill in; F2)

Each row is an **invitation**, not a profile. It's stored in the invites table as non-matchable invite data. Vouch notes seed the invitee's profile **only with the invitee's consent at acceptance** and are deleted if the invite is declined or expires after 30 days (F1 v0.2).

| Field | Type | Rule |
|---|---|---|
| `invite_ref` | string | Founder-chosen, unique |
| `seeded_by` | enum founder | Attribution (F2) |
| `city` | `sf` \| `nyc` | Home city; `both` allowed via two presences |
| `first_name` | string ≤ 40 | What the founder calls them; the invitee can change it |
| `phone_e164` | string | Needed to deliver the invite. Never matchable, never shown to anyone. |
| `expects_invite` | boolean | **Required true** for the agent to send the one message itself. Otherwise the founder forwards the link personally (F1 v0.2). |
| `how_known` | enum: friend, colleague, community, family, met_once, other | Vouch evidence (edge `vouched_for`) |
| `years_known` | number | Vouch strength |
| `closeness` | 1–5 | Vouch strength |
| `why_good_for_network` | text ≤ 300 | Founder's words. Shown to the invitee at onboarding as "Shaw said…", with an edit or delete option. |
| `might_want` | text ≤ 300 | Starting guesses for intents, to **confirm** with the invitee, never assumed |
| `might_offer` | text ≤ 300 | Same |
| `neighborhoods` | list (optional) | Only if the founder knows the invitee is fine with it |
| `agreed_to_share` | list of the fields above | **Only info the person agreed to.** Founders must have asked ("can I tell The Network you're into X?"). Everything else stays blank. |
| `do_not_include` | — | No health, sexuality, religion, politics, finances, relationship status, photos, social handles, employer details, or anything from screenshots, chats or scraping |

**Process:**

1. Founder asks the person informally.
2. Founder fills the row (admin console CSV import with validation).
3. Invite goes out (one message, opt-out language) or the founder forwards the link.
4. At F3/F4 the invitee sees what was said and confirms or edits it. Confirmed items become facets with provenance `vouched` → `said`.
5. Decline or no answer within 30 days: the row and notes are deleted. No follow-up.

**Pre-launch "preliminary profiles" that are actually compliant.** Let invitees onboard *before* matching turns on in their city (waitlist onboarding). They complete the F4 conversation now; proactive matching starts at the 40-committed-members-per-city gate (28.5). That gives real, consented SF and NYC profiles to bootstrap the engine and simulations.

### 5.2 (b) Synthetic persona set (for tests; the harness agent generates)

This is structure only. Generation belongs to the simulator (`packages/sim`, other agent). Every persona is clearly fictional and never written to production stores.

```ts
interface SyntheticPersona {
  id: `syn_${"sf"|"nyc"}_${string}`;     // never collides with real IDs
  synthetic: true;                          // asserted by every writer; prod writers reject it
  member: Omit<Member, "id">;               // @thenetwork/core Member (name from a fictional-name list, age 21–75)
  presence: Presence[];                     // home + routines + optional cross-city trips (F26)
  facets: (Omit<Facet, "id" | "memberId"> & { canary?: string })[]; // ≥1 agent_private + ≥1 matchable fact carry a unique CANARY_<id>_<n>
  intents: Omit<Intent, "id" | "memberId">[];
  invitedBy?: string;                       // synthetic vouch chain (invite tree, 2–4 deep)
  behavior: {                               // hidden; drives the LLM-simulated member
    responsiveness: number; flakeRate: number; acceptThreshold: number;
    preferredFormats: Preferences["formats"]; quietHours: [number, number];
    persona: string;                        // 2–4 sentence voice/backstory for the simulated user
  };
  oracle: { idealPartners: string[]; avoid: string[] }; // ground truth for engine evaluation, never visible to the engine
}
```

**Targets:**

- 40–60 personas per city, matching the launch gate size, with a 10% two-city share.
- Coverage of every Category, every ParticipationState, all formats, the romance opt-in on a minority, and sparse vs rich profiles.
- Edge cases: a new member with only a vouch, someone paused, a heavy helper (load balancing), a member with a block, someone with no good match (tests F21).
- Canaries make the connector leak tests and the 28.5 privacy-canary gate mechanical.

The connector prototype's `seedWorld()` follows this convention at small scale.

### 5.3 (c) Using loveofyourlife's data compliantly

- **The repo has no real seed data** (§1.14), so there's nothing to import.
- **Its synthetic generator and backtest** are usable as structure ideas only: deterministic seeded personas, canary private fields, symmetric invariants. Its dating ontology (gender sought, attractiveness and body type) doesn't belong in The Network's facet model.
- **Real LoveGPT users in production D1** consented to a dating service. Importing them would create exactly the non-member shadow profiles PRD 13.3 forbids, and would break LoveGPT's own consent scope. The only compliant path:
  1. LoveGPT, through its own channel and consent basis, tells its SF and NYC users The Network exists, with an opt-in link.
  2. Those who opt in join through F3 with a normal invite (attributed to a founder vouch, or a "partner referral" invite type).
  3. If they want, they bring their own data with LoveGPT's `export` (data portability) or via `network_share_context` from the same assistant. Each fact is reviewed and confirmed by them, and romance facets are only used if they opt into romance.

---

## 6. Blockers and open questions

1. **ChatGPT audience rule.** An adults-only service versus "suitable for 13–17". Get a written answer from OpenAI, or ship ChatGPT last.
2. **Eliza Cloud OAuth AS.** Steward work, or an interim Network AS Worker (§3.2). Without one, no consumer host can link.
3. **Muse identity and integration format.** Confirm it's Meta's Muse and that connectors accept remote MCP plus OAuth.
4. **Grok OAuth details and catalog access.** Undocumented; test with a real custom connector.
5. **Claude Usage Policy** fit for optional romance. Consider excluding the romance category from connector surfaces at launch, which also helps with ChatGPT.
6. **Elicitation needs stateful MCP sessions** (Durable Objects) or MCP 2026-07-28 `input_required`. Until then medium-risk confirmation relies on host prompts.
7. **Real agent integration.** `network_talk` must run the same agent turn and leak checker as SMS (`channel: connector`). Connector-originated actions must count in outreach and audit like any other channel.
8. **Spec churn.** MCP 2026-07-28 is stateless and our SDK targets 2025-11-25. Support both, and track the SDK release that adds 2026-07-28.
