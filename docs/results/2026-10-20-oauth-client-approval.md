# OAuth client approval regression

Historical record. The [original revision](https://github.com/eliza-research/thenetwork/blob/1e2caa5028ade43ec7cb6a90de16466584f7ead0/docs/results/2026-10-20-oauth-client-approval.md) retains the commands and toolchain used for the observations. Updated command spellings here describe the current project where the same entrypoints exist.

Automated implementation and diagnostics by Codex under Nubs's project preapproval.

## Reproduced problem

At main `4b718bb112d1e9ed7e97c47ae9a44ae0c250f586`, a registered client could use a signed-in browser's authorization GET to obtain a code and grant without a client/scope approval. A valid phone code also issued access directly. PKCE did not establish the person's permission for that client. Existing grants cannot justify silent reuse because legacy automatic issuance produced the same consent audit shape.

The repair requires an explicit bound browser POST for every fresh authorization. It shows the requesting name, callback host and scope meanings, rechecks the current account and eligibility, and consumes the pending approval atomically before issuance. PostgreSQL uses conditional DELETE RETURNING; no schema change is needed. Existing grants, access tokens and refresh tokens remain unchanged. This is an ephemeral OAuth screen, not a public account portal.

## Evidence and limits

Reserved fictional phone numbers and the fake delivery provider exercise the real handler, platform accounts and session code. No model, genuine OTP, live signup, provider delivery, production database or hosted ChatGPT was used. No seed or statistical estimate applies to these deterministic security scenarios.

Before the product repair, seven new cases failed on exact main. A subsequent concurrent-approval case reproduced two successful redirects; the repaired handler permits one success and one rejection. Additional coverage checks expiry after storage consumption, account switching, scope tampering, denial preserving old tokens, HTML escaping and request origin/cookie binding. Cases live in the existing OAuth security suite.

Local diagnostics used the former runtime **1.3.14**, not the required **1.4.2** qualification runtime:

```sh
pnpm exec vitest run packages/mcp/test/oauth.test.ts packages/mcp/test/mcp.test.ts packages/mcp/test/signup-draft.test.ts packages/mcp/test/updates.test.ts
pnpm exec vitest run packages/mcp/test/output-schemas.integration.test.ts
node --max-old-space-size=512 node_modules/typescript/bin/tsc --noEmit -p tsconfig.consent-check.json
```

Results: 67 passed / 0 failed (495 assertions), then 2 passed / 0 failed (318 assertions). The affected-source TypeScript 5.9.3 check passed, including the PostgreSQL test source. The local check config is an untracked diagnostic file, not a repository build change. An earlier output-schema load failed for a missing cached Ajv dependency; after linking the retained exact dependency the explicit file passed.

A PostgreSQL integration scenario is added for two independent store connections racing to consume one request and refusing expired/unverified requests. It has **not** been executed here. Normal the former runtime 1.4.2, actual isolated PostgreSQL qualification, CI and release review remain required. The older qualified `003f89f` runtime evidence does not qualify this main-based source; its Cloud continuation and authority safeguards must be reconciled before any integrated image/release. Real GPT signup/readback and real iMessage-to-website same-account/agent/history acceptance remain open.

## Required runtime CI and fixture follow-up

[CI run 39428517988](https://github.com/eliza-research/thenetwork/actions/runs/39428517988) is bound to commit `5c497325340e6d1cf2bbee15e4e31c668eb38067` (tree `6a42a927650801775451bc057441de776be0051c`). Its integration log identifies the former runtime 1.4.2 (`744846f84`), `REQUIRE_PG=1`, all nine client approval cases passing, and the new actual PostgreSQL cross-connection consumption case passing. Overall: 587 passed, one failed. The offline job, including normal package and site typechecks, passed. This carries real runtime/PG case proof, not an all-CI-green claim.

The sole integration failure was the staging-authority test's shared e2e helper stopping at the correct permission page. The follow-up makes that helper approve the bound request after phone verification or an existing session; the configured-origin test now also asserts the permission page and ChatGPT callback host. Product consent behavior and all existing origin/isolation assertions are preserved. The changed fixture source passed the affected local TypeScript diagnostic. Successor CI must qualify the full fixture flow. A prepared duplicate Linux qualifier was superseded before dispatch; no additional remote job ran.

## Remaining direct e2e authorization flows

[Successor CI 39434393681](https://github.com/eliza-research/thenetwork/actions/runs/39434393681), bound to `d80a73af987eb4923c73b9613fe00ae9c3a97ac8`, passed offline and integration stages, then reached the full e2e suite under the former runtime 1.4.2. E2E reported 38 passed, three skipped and four failed. All four failures were direct authorization GET-to-code assumptions in the custom/private Slop fixtures, outside the shared helper. These flows now assert the consent page is non-redirecting and submit explicit approval with the same browser and request before extracting a code. Adult, allowlist, account ownership, age/hold/ban, revocation, resource and app isolation assertions remain unchanged. A repository search found no other direct successful GET-to-code assumptions; negative authorization and CSRF fixtures remain intact. The changed source passed affected local TypeScript diagnostics. The next full CI run remains the execution gate; no duplicate PostgreSQL qualification ran.

## Registered callback CSP

Independent composition review also found that a same-origin approval POST followed by a redirect needs the registered callback origin in the permission page's form-action policy. The permission page now permits only self plus that exact validated origin, for both existing-session and phone-code paths. The form action itself remains the site's consent endpoint; posted client/scope/resource overrides remain ignored. The source-level header regression failed before this repair and all nine boundary cases passed afterward on local the original runtime version 1.3.14; affected TypeScript diagnostics passed. This is a policy/header proof, not a hosted-browser acceptance claim. See the [CSP form-action navigation check](https://www.w3.org/TR/CSP/#directive-form-action).

## Identity at atomic consent consumption

The final consumed request must still have the same verified phone and person as the request just validated. A race regression changes either field during the awaited consume operation and requires no grant, code or consent audit. It failed before the comparison; the repaired boundary suite passed all ten cases (74 assertions) on local the original runtime version 1.3.14, and affected TypeScript diagnostics passed. Both mismatches fail closed after consuming the stale request. Normal successor CI remains required.
