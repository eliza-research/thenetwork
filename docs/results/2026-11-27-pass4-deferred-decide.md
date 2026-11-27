# Pass 4: Deferred `[DECIDE-1]`–`[DECIDE-4]` Implementation and Validation

Date: 2026-11-27
Branch: `feat/meetup-setup-external-matchmaking`
Prior report: [2026-11-27-pass3-journeys-and-llm.md](2026-11-27-pass3-journeys-and-llm.md)

## Scope and Environment

Pass 4 implements all four items deferred from Pass 3 (`[DECIDE-1]` through `[DECIDE-4]`):

- **`[DECIDE-1]` Step-up `finish_signup_url`:** `prepare_signup`, `check_status`, and `get_context` mint a single-use, app-bound `GET /oauth/finish-signup?t=<token>` URL (10-minute TTL) for `not_joined` and `invited` users on browser-signup apps. Finishing signup attaches the new `personId` to the live grant without disconnect/reconnect.
- **`[DECIDE-2]` Auth UI updates:** `AuthSignupView` updates the Birthday hint to match owner decision 2026-11-22 (no dates or work under 18; friendship introductions on `friends.help` and `ntwrk` Friend lane only with ages 13–18 within 2 calendar years; no promise of an intro). `AuthCodeView` adds **Resend code** (`POST /oauth/authorize/resend`) and **Use a different number** (`POST /oauth/authorize/change-phone`) with calm `role="status"` resend feedback.
- **`[DECIDE-3]` Expanded inbox projection and 3 new MCP tools:** `networkTextCanProduceInboxItem` admits `reveal`, `pre_brief`, `venue_pivot`, `checkin`, and `relay` (while keeping `system: true` excluded). MCP adds `get_context` (`membership:read`, gating `profile`/`looking_for` on `profile:read`), `set_availability` (`profile:write`, live-member and daily-cap gated), and `set_red_lines` (`profile:write`, 12 canonical tags, `merge`/`replace`, live-member and daily-cap gated).
- **`[DECIDE-4]` Scheduling and calendar links:** 1-slot `friends` partner plans accept a bare affirmative reply (`"yes"`, `"sounds good"`); symmetric non-requester 1:1 intros on `slop` and `friends` probe in parallel (`slopPack.consent.default.order = "parallel"`); `friendsWeekPlans` enables `openTable: true`; booked reveals support signed first-party RFC 5545 `.ics` calendar links served at `GET /cal/:token.ics` (gated by `LeakGuard` and Clock-parameterized HMAC expiry).

**Validation settings:** All checks ran inside `/Users/nubs/thenetwork-eliza-meetup` with local dev Postgres on `:54339`. No provider API keys (`SURPLUS_API_KEY`, `OPENAI_API_KEY`) were set; `pnpm run sim` clears provider keys before execution and uses deterministic offline actors and the deterministic stand-in review judge (`simulatedReviewJudge`). Zero live LLM calls were made or claimed.

**MCP payload metrics:**
- `INSTRUCTIONS.length`: `421` characters (`<= 512` OpenAI limit).
- 4-server `toolDefs` payload (52 tools): `45,714` bytes (`ntwrk`: `11,579`, `slop`: `11,891`, `peon`: `10,612`, `friends`: `11,632`; `< 48 KB` and `34.7%` below the original `70,006`-byte baseline).

## Sync Summary (Specs, Proofs, Tests, and Generated vs. Hand-Written)

### 1. Rules Added or Changed Across 6 Specs

1. `spec/authorizationPages.md`: Added `ReplyCodeResent`, `ReplyCodeResendRateLimited`, and `ReplyCodeResendFailed` replies; added `CodeResent`, `CodeResendRateLimited`, and `CodeResendFailed` field errors on `CodeView`; added `phoneChanged` to `AuthPage`; added `offers.resendCode` and `offers.changeNumber` on `CodeView`; added `canResendCode`/`resendCode` and `canChangePhone`/`changePhone` transitions and reachability properties; updated Birthday copy rule for owner decision 2026-11-22.
2. `spec/oauthBrowserAuthorization.md`: Added `ResendCodeForm` (`"resend"`) and `ChangePhoneForm` (`"change_phone"`) to `BrowserForm` and `readBrowserForm` (`CodePage` + `hasPhone` -> `StartingOtp`, `CodePage` -> `ShowingPhone`, otherwise `BrowserExpired`).
3. `spec/connectorTools.md`: Added `GetContextTool`, `SetAvailabilityTool`, and `SetRedLinesTool` (`ContextShown`, `PreferencesSaved`, `PreferencesNotForStatus`); wired `scopeFor`, `toolAllowedFor`, `resultShowsContextProfile`, `canCallGetContext`/`callGetContext`, `canCallPreferenceTool`/`callPreferenceTool`, daily cap step invariant, and laws `lawContextProfileNeedsProfileRead`, `lawPreferenceToolsNeedWrite`, and `lawPreferenceToolsOnlyForLiveMembers`.
4. `spec/mcpSignupDraft.md`: Updated prose rules for `[DECIDE-1]` step-up `finish_signup_url` while keeping Quint transitions and invariants intact.
5. `spec/notificationAcknowledgement.md`: Expanded `networkTextCanProduceInboxItem` to include `reveal`, `pre_brief`, `venue_pivot`, `checkin`, and `relay` while keeping `system === true` excluded.
6. `spec/friendsPlanTimeChoice.md`: Added `singleOfferedSlot: boolean` parameter to `friendPlanReplyChoice`, permitting bare affirmative acceptance only when 1 slot is offered; added `lawMultiOptionBareYesCannotPick` and `lawSingleOptionBareYesAccepts`.

### 2. Formal Proof Counts (`pnpm run check`)

All **622/622** Dafny proof obligations across the 6 changed specs are proved (`0` unproved):

| Spec | Model | Always | Sometimes | Replay | Dafny Proof |
|---|---|---|---|---|---|
| `spec/authorizationPages.md` | 14 transitions, 6 always, 6 step, 27 sometimes, 34 laws | PASS (12k traces) | PASS (27/27) | PASS (429) | **204/204** |
| `spec/oauthBrowserAuthorization.md` | 9 transitions, 1 always, 1 step, 3 sometimes, 6 laws | PASS (12k traces) | PASS (3/3) | PASS (404) | **26/26** |
| `spec/connectorTools.md` | 18 transitions, 9 always, 8 step, 22 sometimes, 45 laws | PASS (12k traces) | PASS (22/22) | PASS (429) | **353/353** |
| `spec/mcpSignupDraft.md` | 6 transitions, 1 step, 1 sometimes, 8 laws | PASS (12k traces) | PASS (1/1) | PASS (401) | **16/16** |
| `spec/notificationAcknowledgement.md` | 4 transitions, 1 step, 2 sometimes, 13 laws | PASS (12k traces) | PASS (2/2) | PASS (402) | **19/19** |
| `spec/friendsPlanTimeChoice.md` | 4 laws | PASS (12k traces) | — | PASS (400) | **4/4** |
| **Total (6 changed specs)** | — | **PASS** | **PASS** | **PASS** | **622/622** |

Across all 198 specs in the repository, 100% of `model`, `always`, `sometimes`, `replay`, `types`, `proof`, and `tests` stages pass.

### 3. Review Ledger Status (`spec/lock.json`)

`spec/lock.json` is intentionally untouched (`git diff --stat spec/lock.json` is empty) and `pnpm run accept` was not run. The 6 edited specs report pending `review` items (`authorizationPages.md`: 18, `connectorTools.md`: 17, `mcpSignupDraft.md`: 3, `oauthBrowserAuthorization.md`: 2, `notificationAcknowledgement.md`: 1, `friendsPlanTimeChoice.md`: 1, plus 7 pre-existing review specs from Passes 1–3) so the product owner can review the diff and run `pnpm run accept`.

### 4. Tests and E2E Suites Added or Updated

- Added `packages/mcp/test/mcp-pass4-decide.test.ts` (8 tests, including real Postgres `:54339` verification of `finish_signup_url`, `resend`/`change-phone`, `get_context`, `set_availability`, and `set_red_lines`).
- Added `packages/network/test/pass4-deferred-decide.test.ts` (11 tests, including real Postgres `:54339` end-to-end verification of `setMemberAvailability`, `setMemberRedLines`, `GET /cal/:token.ics`, 1-slot friends yes, symmetric parallel probing, `openTable`, and expanded inbox projection).
- Updated `packages/ui/src/components/AuthCodeView.meta.tsx` and `packages/ui/src/components/AuthSignupView.meta.tsx` (11 stories on `AuthCodeView`, 12 stories on `AuthSignupView`, all verified in Node and Chromium with axe a11y).
- Updated `packages/mcp/test/harness.ts`, `packages/mcp/test/mcp.test.ts`, `packages/mcp/test/mcp-pass3-hardening.test.ts`, and `packages/mcp/test/output-schemas.integration.test.ts` for the 3 new MCP tools and `finish_signup_url`.
- Updated `tests/e2e/connector-signup.e2e.test.ts` for intentional `[DECIDE-1]` changes (`check_status` returns `finish_signup_url` with `"no need to reconnect"` instead of disconnect-reconnect copy; the link-crawl test matches local e2e site origins and verifies short-lived 10-minute `finish_signup_url` tokens immediately before the test's 15-minute simulated clock advance).

### 5. Generated vs. Hand-Written Breakdown

- **Generated (zero manual edits; verified by `pnpm run spec:check-generated` and `plugins/build.ts --check`):**
  - `packages/core/src/generated/{authorizationPages,browserJoin,connectorTools,friendsPlanTimeChoice,notificationAcknowledgement,oauthBrowserAuthorization}.ts` (`282/282` published spec artifacts verified).
  - `packages/ui/generated/*` (gitignored Storybook/test outputs rebuilt via `pnpm run ui:gen`).
  - `plugins/claude/skills/{friends-help,ntwrk-party,peon-biz,slop-date}/SKILL.md` and `plugins/openai/skills/{friends-help,ntwrk-party,peon-biz}/SKILL.md` (rebuilt via `plugins/build.ts` from `sites/skills/*/SKILL.md`).
- **Hand-written:**
  - Specs: `spec/{authorizationPages,oauthBrowserAuthorization,connectorTools,mcpSignupDraft,notificationAcknowledgement,friendsPlanTimeChoice}.md`.
  - Core ICS and token signing: `packages/core/src/ics.ts` (browser-safe RFC 5545 + `LeakGuard`), `packages/core/src/runtime/calendar-token.ts` (Node-only HMAC-SHA256 `signCalendarToken`/`verifyCalendarToken`), `packages/core/src/index.ts`.
  - UI components and stories: `packages/ui/src/components/{AuthPhoneView.tsx,AuthSignupView.tsx,AuthSignupView.meta.tsx,AuthCodeView.tsx,AuthCodeView.meta.tsx}`.
  - MCP OAuth, tools, hooks, stores, pages, skills, and README: `packages/mcp/src/{handler,hooks,pages,pg-store,store,tools}.ts`, `packages/mcp/README.md`, `sites/skills/{friends-help,ntwrk-party,peon-biz,slop-date}/SKILL.md`.
  - Engine and Network service: `packages/engine/src/packs/slop/index.ts`, `packages/network/src/{friends-plan-time-choice,network}.ts`, `packages/network/service/{serve,service}.ts`.
  - Tests and docs: `packages/mcp/test/*`, `packages/network/test/pass4-deferred-decide.test.ts`, `tests/e2e/connector-signup.e2e.test.ts`, `docs/results/2026-11-27-pass4-deferred-decide.md`, `docs/results/SUMMARY.md`.
- **Database migrations:** Zero new migrations (`git diff --stat packages/db/migrations/` is empty).

## Chosen UI Direction (`design` Skill)

- **`AuthCodeView`:** Keep **Continue** as the single full-width primary CTA (`size="lg"`). Place **Resend code** (`/oauth/authorize/resend`) and **Use a different number** (`/oauth/authorize/change-phone`) immediately beneath it in one compact inline `variant="ghost"` row, each inside its own POST form so `required` on the code input never blocks them. Show calm `role="status"` resend confirmation (`"We sent a new code."`) directly under `"Sent to ••• {last4}."` without setting `aria-invalid`, and keep **Cancel** (`variant="outline" size="lg"`) below to match `AuthPhoneView`.
- **`AuthSignupView`:** Keep the existing vertical form layout unchanged and update only the Birthday field helper text to reflect owner decision 2026-11-22 accurately without promising an introduction.

## Verifier Fixes Resolved During Final Validation

Independent verification caught and resolved four real issues before commit:

1. **Browser-bundle `node:crypto` build failure (`apps/observatory/test/staff.test.ts`):** Exporting `signCalendarToken`/`verifyCalendarToken` from `packages/core/src/ics.ts` pulled `node:crypto` into `@thenetwork/core`, breaking Observatory's browser esbuild bundle. Moved token signing to `packages/core/src/runtime/calendar-token.ts` (matching the `packages/core/src/runtime/` convention) and replaced `Buffer.byteLength` in `ics.ts` with `TextEncoder`. Restored `pnpm run security` to `12/12` files (`298/298` tests).
2. **Minor own-reminder visibility on `peon` (`packages/network/service/service.ts`):** `inboxUpdateOutcomes` withheld all unbound updates on non-`teenFriendApp` apps for minors, blocking a minor's own reminder (`"Your resume workshop is on Saturday."`) in `tests/e2e/connector-updates.e2e.test.ts`. Narrowed the app-wide withhold to `app === "slop"` (preserving `notify-inbox.integration.test.ts` where minors read zero `slop` updates until age 18) while keeping all opportunity-bound intros and `unsafeUnboundForMinor` items retired.
3. **Shared-line `ntwrk` join registration and child-app welcome streak (`packages/network/src/network.ts`, `packages/network/service/service.ts`):** A prior merge (`f500f0551`) skipped `memberMessage` on `JoinedWithLookingFor` without registering the member in `ConsentNetwork.members` (causing `unknown_member` suppression on `sim:fay:before`) and emitted separate `welcomeJoined` texts for each child app in `enroll` (hitting Apple's 3-unanswered cap). Added `ConsentNetwork.registerJoined(id)` and called it in `JoinedWithLookingFor` and child-app `enroll`. Restored `pipeline` to `15/15` blocking gates.
4. **E2E expectations for `[DECIDE-1]` (`tests/e2e/connector-signup.e2e.test.ts`):** Updated `check_status` assertions from legacy disconnect-reconnect text to `finish_signup_url` and updated the link-crawl test to resolve local e2e origins and verify each 10-minute `finish_signup_url` immediately before the test's 15-minute simulated clock advance.

## Full Validation Matrix

| Check / Command | Result | Counts / Notes | Duration |
|---|---|---|---|
| Hygiene audit (`origin`, `spec/lock.json`, `migrations`, `AGENTS.md`/`CLAUDE.md`, Clock/RNG purity) | **PASS** | `eliza-research/thenetwork.git`, empty diffs, 0 Clock/RNG violations | `0.2s` |
| `pnpm run spec:check-generated` | **PASS** | `282/282` generated TS and VibeLang artifacts match | `1.7s` |
| `pnpm run check` | **PASS** | 100% `model`/`always`/`sometimes`/`replay`/`types`/`proof`/`tests` across 198 specs; `622/622` Dafny proofs on 6 edited specs; only expected `review` items await `pnpm accept` | `71.1s` |
| `pnpm run typecheck` | **PASS** | `0` errors across all 15 workspace projects | `21.5s` |
| `node --import tsx --env-file-if-exists=.env plugins/build.ts --check` | **PASS** | Plugin skill snapshots up to date | `0.1s` |
| `pnpm run design:check` | **PASS** | Design tokens verified | `0.3s` |
| `pnpm run ui:test` | **PASS** | `778/778` stories (`AuthCodeView` 11, `AuthPhoneView` 9, `AuthSignupView` 12) | `4.2s` |
| `pnpm --filter @thenetwork/ui run test:browser` | **PASS** | `778/778` stories in Chromium (axe a11y + play assertions) | `29.8s` |
| `pnpm exec eslint packages/ui --max-warnings 0` | **PASS** | `0` errors, `0` warnings | `4.9s` |
| `pnpm run security` | **PASS** | `12/12` files, `298/298` tests | `52.0s` |
| `pnpm run marketing:test` | **PASS** | `4/4` files, `39/39` tests | `2.9s` |
| Targeted Pass 3/4 Vitest (7 files) | **PASS** | `7/7` files, `48/48` tests (`mcp-pass4-decide` 8, `pass4-deferred-decide` 11, `mcp-pass3-hardening` 12, `output-schemas` 2, `signup-draft` 3, `pass3-journeys-coordination` 9, `notify-inbox` 3) | `3.9s` |
| `packages/network/test/pass4-journeys.integration.test.ts` + `pass4-deferred-decide.test.ts` | **PASS** | `2/2` files, `15/15` tests | `1.9s` |
| E2E (`connector-signup`, `connector-updates`, `notify`) | **PASS** | `3/3` files, `33/33` tests (`connector-signup` 21, `connector-updates` 5, `notify` 7) | `43.2s` |
| `sim`: `evals` | **PASS** | `51/51` blocking gates | `1.2s` |
| `sim`: `onboard` | **PASS** | `23/23` blocking gates | `0.7s` |
| `sim`: `relay` | **PASS** | `75/75` blocking gates | `0.8s` |
| `sim`: `clef` | **PASS** | `10/10` blocking gates | `0.8s` |
| `sim`: `meetup` (seeds `13-16`) | **PASS** | `14/14` blocking gates | `0.1s` |
| `sim`: `five-city` (seed `42`) | **PASS** | `31/31` blocking gates | `2.0s` |
| `sim`: `marketing` | **PASS** | `15/15` blocking gates | `0.1s` |
| `sim`: `journeys` (seeds `42, 43`, digest `b40a6411ce806c14`) | **PASS** | `26/26` blocking gates | `0.2s` |
| `sim`: `peon` (seeds `13-16`) | **PASS** | `30/30` blocking gates | `15.2s` |
| `sim`: `slop` (seeds `13-16` + `slop-live` parallel probing, fingerprint `aecababab36ce622`) | **PASS** | `57/57` blocking gates (`488` probes, `0/488` style violations, `37` dates booked, `26` held) | `104.0s` |
| `sim`: `friends` (seeds `5-8`, `openTable: true`, fingerprint `c8b5e3e8466f37bf`) | **PASS** | `67/67` blocking gates (repeat rate `32.7%`, V14 `33.9%`, 0 minor/adversary/openness violations) | `172.0s` |
| `sim`: `safety` (PG `:54339`) | **PASS** | `21/21` blocking gates | `7.7s` |
| `sim`: `ops` (PG `:54339`) | **PASS** | `12/12` blocking gates | `2.6s` |
| `sim`: `pipeline` (PG `:54339`) | **PASS** | `15/15` blocking gates | `5.6s` |
| `sim`: `pipeline-slop` (PG `:54339`) | **PASS** | `14/14` blocking gates | `55.0s` |
| `sim`: `audit` (PG `:54339`) | **PASS** | `18/18` blocking gates | `16.3s` |
| `sim`: `network --quick` (seed `3` invariants/exception, seed `1` teen/stopped teen) | **PASS** | `109/109` blocking gates, `0` tracked off target (all 9 teen gates = `0`, 0 canary leaks, 0 invariant violations) | `224.9s` |
| **Combined simulation layer (17 blocks)** | **PASS** | **`588/588` blocking gates pass** | — |
