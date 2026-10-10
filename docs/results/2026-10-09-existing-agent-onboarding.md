# Existing-agent onboarding: acceptance report (2026-10-09)

Status: hosted ChatGPT registration blocked; reconciled local integration, e2e, typecheck, and production static builds pass.
ChatGPT is the first client acceptance target requested by the user.
Other clients are deferred beyond completed entry checks. No client has passed live Slop onboarding end to end.

## Scope and contract

- Base: Network main `7348e94ee9f851b815f4dd35f2c97f6b9bf52ff9`.
- Branch: `codex/network-existing-agents-20261009`.
- Reconciliation preserves parent fixture commits `253728c8` and `578445c` ancestry (PR #15).
- Separate commit `553ca34` fixes a demonstrated Lab snapshot/persistence race; before/after real-process regression passes.
- PRD 28.3 requires onboarding through the person's existing agent and MCP.
- PRD 40.3 requires phone identity, separate app memberships, consent, and app isolation.
- The person's agent uses its own model. Reading SKILL.md neither removes inference nor installs an MCP connector.
- This lane does not route onboarding to Eliza Shared or Eliza Cloud inference.
- Friends and Peon matching stay local. No deployment, real-member matching, or production activation occurred.
- Current AGENTS.md and docs/tests-policy.md supersede older simulation-only statements in the PRD snapshot.

## Client acceptance matrix

“Entry passed” means a link or application opened correctly. It does not mean connector authorization or membership succeeded.
Live observations below were reported by the browser operator. Account details and conversation identifiers are omitted.

| Client | Desktop entry / discovery | Connector and consent | Profile / same-person readback | Phone | Result |
|---|---|---|---|---|---|
| ChatGPT | Signed-in user-selected Chrome profile; `?q=` prefilled, then operator manually sent. Live Slop SKILL fetch failed (`rawMarkdown`). OAuth discovery passed. | User approved connector registration. Create failed: “Some app settings were rejected.” Direct registration confirmed server rejection. No membership grant. | No live submission or membership readback. | Not run. | **Skill fetch failed; connector blocked; unfinished. Priority.** |
| Claude | Slop SKILL fetched. Synthetic profile collected, read back, and handed off to the join page. | Free account's custom connector slot occupied; Add custom connector disabled. Existing connector preserved. | Conversation readback passed; no MCP submission or membership readback. | Not run. | **Partial; blocked. Deferred.** |
| Grok chat (grok.com) | Slop SKILL fetched. | No connector grant tested. | No submission or membership readback. | Not run. | **Discovery passed only. Deferred.** |
| Grok Bot | Native app opened existing account; new conversation selected. Prompt not yet sent at this checkpoint. | Not tested. Grok chat success does not qualify Grok Bot. | Not tested. | Not run. | **Entry only; unfinished. Deferred.** |
| Muse | Entry reached logged-out client. | Not tested. | Not tested. | Not run. | **Blocked by sign-in; unfinished. Deferred.** |
| Cursor | Official web prompt preview passed; native accessibility request timed out. Source adds the documented web prompt link. | Not tested. | Not tested. | Not run. | **Web entry only; native unfinished. Deferred.** |
| OpenClaw | CLI unavailable. No invented URL scheme added. | Not tested. | Not tested. | Not run. | **Unavailable; unfinished. Deferred.** |
| Hermes | Native accessibility request timed out. CLI help ran with isolated `HERMES_HOME`. | No connector setup tested. | Not tested. | Not run. | **CLI availability only; unfinished. Deferred.** |

On this signed-in account, ChatGPT prefilled the prompt and the operator sent it manually. Phone behavior remains unverified.

### Hosted ChatGPT connector diagnostic

The custom-MCP drawer discovered Slop OAuth endpoints and scopes: `apps:read membership:read profile:write`.
Dynamic client registration (DCR) was selected by default; client metadata documents (CIMD) were unavailable in this flow.
The Slop MCP endpoint was `https://slop.date/mcp`; authorization, registration, and token endpoints remained on the Slop origin.
The user approved connector creation. ChatGPT rejected Create with the generic settings error above.
An owned direct diagnostic to the same registration destination returned HTTP 400, `invalid_client_metadata`, `registered:false`:
“This app is not available for this client.” This proves the backend refused registration; it does not prove all ChatGPT settings were correct.
Unauthenticated `initialize` and `tools/list` returned HTTP 200. These reveal public server instructions and tool schemas only.
They do not prove protected tool access, OAuth completion, OTP delivery, or membership acceptance.
Receipts: `hosted-chatgpt-dcr.json`, `hosted-initialize.json`, and `hosted-tools-list.json` in the private evidence directory.

Official sources reviewed in this lane distinguish public review from private testing:

- [Plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines): public review requires general-audience suitability; no explicit universal dating prohibition was identified.
- [App review](https://developers.openai.com/plugins/deploy/app-review): private/workspace custom-MCP guidance differs from public directory review.
- [Custom MCP server](https://developers.openai.com/api/docs/guides/custom-mcp-server): the custom connector setup mechanism used for the live attempt.
- [Authentication](https://developers.openai.com/plugins/build/auth): DCR is supported; CIMD is optional.

The Slop rejection is verified implementation behavior. These sources do not establish that every private dating connector must be refused.
The local source now includes a default-off, development-only `privateOpenAiApps` pilot after scope coordination.
For an owned dev runtime only, set `PLATFORM_ENV=dev` and `MCP_PRIVATE_OPENAI_APPS=slop`; the service also accepts `privateOpenAiApps:["slop"]`.
Production, staging, unknown environments, and `NODE_ENV=production` refuse the opt-in. Default behavior and public listings remain unchanged.
The option ran only in owned local tests. No external flag, tunnel, activation, deployment, or successful live connection is claimed.

## Demonstrated gaps and source changes

1. Skills assumed connector availability after phone confirmation. They omitted explicit installation and return instructions.
   Updated skills request return to the same conversation and separate connector setup, access approval, submission, and status readback.
   Non-Slop skills name their own ChatGPT `/mcp/openai` endpoint. Every skill checks `check_status.app` before profile submission.
   An unexpected app stops submission until the person connects the correct app.
   An unavailable connector now leaves onboarding explicitly unfinished.
2. Slop skills promised agent submission even for ChatGPT. The server rejects that client before authorization.
   Updated Slop skills disclose this restriction before profile collection. Web signup does not qualify as existing-agent acceptance.
   Source restriction: `packages/mcp/src/handler.ts` client classification and registration; `packages/mcp/src/apps.ts` has `slop.openai=false`.
   The private local pilot tests the narrower alternative; it does not remove the hosted restriction or claim production approval.
3. Landing pages omitted Cursor's supported web prompt link. The source adds it to all four sites.
   The existing built-site integration assertion failed before the addition (`cursor-before.log`). Native execution remains unproven.
4. Added one Postgres-backed e2e scenario for two assistants on one verified phone and a separate account.
   This adds acceptance coverage; it does not demonstrate a previously broken identity implementation.

Generated Claude/OpenAI skill mirrors follow the canonical site skills. The OpenAI plugin continues to exclude Slop.
The Network repository does not restore the upstream Eliza plugin.

## Local service acceptance

The e2e harness runs real site routers, backend, Network service, MCP, OAuth, migrations, and Postgres.
It uses fictional phones, fake OTP, dry-run sends, and a simulated clock. It makes no provider calls.
The owned run used Postgres port 54349 and random site ports, separate from other chats.

| Check | Result | Limit |
|---|---|---|
| Reconciled full e2e suite | **29 pass, 0 fail**, 254 assertions, two files, 3.15 seconds; `reconciled-e2e.log`. | Local service acceptance only. Initial pre-pilot receipt: 28 pass. |
| Two assistants, same phone | Both connections resolve to the existing Slop member; second connection reads active status. | Synthetic OAuth clients, not live ChatGPT/Claude. |
| Approved profile submission | Stored as inbound content for the original member; member ID remains unchanged. | Does not verify live model extraction or match quality. |
| Different account | Separate member receives none of the submitted profile content. | Does not establish arbitrary account-switch behavior in a hosted client. |
| App isolation | Slop token is refused on Friends. | Local service path. |
| Revoke one assistant | Revoked token fails; other assistant, other account, and browser session still work. | Hosted-client disconnect UI not exercised. |
| OAuth return | Registered local callback and issuer readback pass. | No live phone app-to-browser-to-agent return. |
| Private ChatGPT pilot | Actual ChatGPT callback DCR, PKCE, approved profile SQL readback, and status pass with explicit dev opt-in. | Synthetic user and token exchange; not a hosted ChatGPT connection. |
| Pilot boundaries | Default registration rejects; non-dev opt-ins refuse; Slop `/mcp/openai` and its resource metadata return 404; public Network omits Slop. | Local service checks. |
| Private pilot lifecycle | Same-store restart with opt-in off blocks authorization, pending consent, token issuance, and MCP. Explicit revoke still works. Re-enable restores only unrevoked grants. | Suspension is not deletion; CIMD remains excluded. |
| Final targeted MCP integration | **49 pass, 0 fail**, 328 assertions; `mcp-final.log`. | Public and private handler checks; no hosted client acceptance. |
| Database ownership | Each stack gets a unique database; outside database survives teardown. | Local test-cluster isolation. |
| Reconciled typecheck | **Pass, exit 0**; `reconciled-typecheck.log`. | Static validation only. |
| Built-site integration | **70 pass, 0 fail**, 1105 assertions; `sites-final.log`. | Includes Cursor link contract; not native-client acceptance. |
| Initial full integration suite | **393 pass, 10 fail**, 403 cases across 29 files; `integration.log`. | Before private handler change. Review attributed failures to untouched paths; no independent pre-change full run proves attribution. |
| Reconciled full integration suite | **403 pass, 0 fail**, 8942 assertions, 96.14 seconds; `reconciled-integration.log`. | Includes exact parent fixture ancestry; not hosted-client acceptance. |
| Production static build | **Four sites pass**; `reconciled-production-build.log`. | Build only; no deployment. |
| Initial full simulations | **275/275 blocking gates pass**, 11 tracked off target, 335.5 seconds; `sim.log`. | Before private handler change. Final targeted audit: 16/16 blocking gates pass; no live matchmaking acceptance. |

The initial ten integration failures concerned outdated Observatory, queue, consent, live-send, and photo-rating fixtures.
Exact parent fixture reconciliation resolves them in the latest full run. The initial full simulation predates the private handler change.

Seed: 1 for the local e2e Network service. Sample: 29 e2e cases; the identity case uses two fictional people and three connections.
Model: none for the local service acceptance run. Client model selection was not recorded; no model comparison claim is made.
Local fixtures and real signed-in client sessions remain separate.

## Reproduce the local checks

Use Bun 1.4.2. Use an unoccupied Postgres port and a new cluster directory.
Do not point these commands at a production or shared database.

```sh
cd /Users/nubs/Git/thenetwork-existing-agents-20261009
bun --version
bun install --frozen-lockfile
export OBSERVATORY_PG_PORT=54359
export OBSERVATORY_PG_DIR="$PWD/runs/pg-existing-agent-review"
bun run packages/observatory/db/dev-pg.ts up
REQUIRE_PG=1 bun run test:e2e
REQUIRE_PG=1 bun run test:integration
bun run typecheck
bun run sim
bun run plugins/build.ts --check
```

Run the new identity journey alone with:
`REQUIRE_PG=1 bun run test:e2e --test-name-pattern 'Slop: two assistants share one phone owner'`.
The harness creates process-owned databases and drops them afterward. It selects random site ports.

For a visible local demo, use the lane-owned runtime receipt in `test-results/existing-agents-20261009/local-runtime.json`.
Open its Slop origin and `/join?via=agent`. Treat that runtime as temporary; use the e2e harness for repeatable acceptance.

## Phone plan and remaining user actions

1. Review the validated private local pilot before proposing a hosted test runtime. A live fake journey is preparing locally only.
2. Repeat the Slop skill fetch and confirm the exact approved prompt in the user's existing ChatGPT conversation.
3. Connector registration was approved and attempted. Obtain any additional access grant at the actual authorization action.
4. At real signup, coordinate one phone/OTP request with the user and parent. The user enters their code only on the site.
5. Obtain Terms/text consent at the actual site action. Do not copy the phone or code into an agent conversation.
6. Return to the same conversation. Approve the user's own profile, call `submit_profile`, then `check_status` on that connection. Keep synthetic profiles on owned test endpoints.
7. Verify the same membership in site settings. Verify a second account remains separate and revocation preserves other authorized connections.
8. On the user's accessible phone, repeat link entry, prompt-send confirmation, browser OTP, OAuth consent, and return to the original conversation.
9. Repeat with the assistant app absent to verify web fallback. Record where app/browser context changes or return fails.

The hosted ChatGPT blockers remain Slop registration refusal and failed live SKILL discovery. The local private pilot does not change hosted behavior.
Phone acceptance is blocked on coordinated device access and the user completing the real consent/OTP steps.
Do not request another OTP until the shared request owner agrees. No real signup, OTP, profile submission, or mobile acceptance occurred here.

## Hosting and access checkpoint

The user resumed the remaining work. Other-client acceptance remains deferred while ChatGPT stays first.
The correct Brave session exposes the Eliza Labs account and Slop/Friends zones. A Network-domain search returned no results.
GitHub's repository `MCP_URL` is corrected to `https://{domain}/mcp`, with readback. This is configuration, not a site deployment.
Issue #5 remains open, with no assignee or comments. Its old HTTP 526 outage description is stale.
Current direct checks show valid TLS: health HTTP 200 (`env=production`, `build=dev`), Slop/Friends app APIs and OAuth metadata HTTP 200.
These checks establish endpoint reachability, not hosted private Slop authorization or launch readiness.
The isolated Cloudflare CLI is logged out. A Chrome work-identity check showed one account and no domains.
The user clarified that Eliza Cloudflare is in Brave. The Chrome result is not evidence about Eliza Labs access.
Existing Network zone access belongs to another account. The owner is handling a new domain; its purchased name and backend origin remain unconfirmed.
An isolated fixture journey does not require Network zone access. It remains local only.
The latest domain instruction is verified from user-provided messages and an authorized native Messages read.
New endpoint/domain changes await the owner's confirmed purchased name. No duplicate purchase or old-zone move is planned.
No Cloudflare, DNS, deployment, main merge, or live-private flag change occurred.

## Evidence and publication limits

Private evidence directory: `test-results/existing-agents-20261009/`.
It contains browser captures, local before/after images, runtime receipts, and validation logs.
Raw browser captures may expose account information. Do not commit or attach them publicly.
Show sanitized screenshots and the required walkthrough/before-after video to the user before public attachment.
The 24-second captured-frame walkthrough was shown to the user before public attachment. Raw account captures remain private.
[Walkthrough and before/after video](https://github.com/user-attachments/assets/cbd64c04-a151-40f9-8bf4-ac6343dbc77b). Captions also remain in the private evidence directory.
[Draft PR #13](https://github.com/eliza-research/thenetwork/pull/13) contains the source, walkthrough, and review steps.
Reconciled integration and onboarding E2E passed in hosted PR CI on `e095820`; duplicate push CI exposed the separate Lab race.
After its fix and parent cleanup: local integration 403/403 (8945 assertions, 115.26 seconds), e2e 29/29 and typecheck pass.
Final-head hosted checks are pending. Hosted-client acceptance remains unfinished.
