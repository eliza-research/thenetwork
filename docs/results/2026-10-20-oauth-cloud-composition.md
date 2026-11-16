# Cloud OAuth safeguards on the current consent boundary

Historical record. The [original revision](https://github.com/eliza-research/thenetwork/blob/1e2caa5028ade43ec7cb6a90de16466584f7ead0/docs/results/2026-10-20-oauth-cloud-composition.md) retains the commands and toolchain used for the observations. Updated command spellings here describe the current project where the same entrypoints exist.

Automated composition by Codex under Nubs's project preapproval. This candidate is based on PR111 follow-up `2931377`; it is separate from the minimal consent repair. The feature delta from qualified source `003f89f` is applied relative to its common ancestor, preserving current-main public agent/text entry flows and all PR111 consent tests.

## Composed behavior

- Server-owned Cloud sign-in resumes only the same pending browser request, then requires explicit client/scope approval. Public callers cannot choose the callback destination.
- Cloud transport failures return retryable 503 responses without consuming pending consent, authorization codes or refresh tokens.
- Each Cloud grant persists sealed app/resource/phone authority and its expiry. Issuance, bearer use and refresh validate the current delegation; revoked or mismatched identity fails closed.
- Code exchange validates without consuming, then takes the code atomically and rechecks code/grant expiry after awaited work.
- Current consent remains single-use across concurrent approvals. Cloud authority validation precedes consumption; request and grant expiry are checked again before grant persistence. The current account check applies to every client, not only Slop.
- The ephemeral permission page retains plain scope meanings, the same-origin form action plus only the registered callback origin and the existing public site shell. It adds a retry message without restoring a public sign-in/settings/dashboard.

Storage changes are additive: nullable sealed Cloud authority metadata, an immutability guard and the corresponding store methods. Existing legacy phone grants keep their behavior. The source does not enable a deployment mode or change any running service.

## Diagnostics and remaining qualification

Pure in-process synthetic HTTP/Cloud-producer tests used fictional 555 identities and no provider/model/live network. Local the former runtime is 1.3.14 and TypeScript is 5.9.3, so these results are diagnostics, not normal-runtime or hosted acceptance.

The initial affected run executed 51 cases: 47 passed; four failed only because the composed unavailable page omitted the previously required agent/text fallback phrase. After restoring that fallback, the four affected retry cases passed (164 assertions). A new Cloud-authority concurrent-approval case passed (30 assertions), proving one grant/code after two independently validated approvals. The existing nine PR111 security cases passed in the initial run. Final affected TypeScript diagnostics passed, including PostgreSQL authority test source. No local PostgreSQL cluster was started.

Commands:

```sh
pnpm exec vitest run packages/mcp/test/oauth.test.ts packages/mcp/test/cloud-oauth-continuation.integration.test.ts
pnpm exec vitest run packages/mcp/test/cloud-oauth-continuation.integration.test.ts --test-name-pattern 'before return and consent'
pnpm exec vitest run packages/mcp/test/cloud-oauth-continuation.integration.test.ts --test-name-pattern 'concurrent validated'
```

Normal the original runtime version 1.4.2, actual PostgreSQL qualification and independent review must bind to this exact successor. PR111's CI proves its own unchanged boundary and store cases; old003f receipts prove their own old source, not this composition. No image build, release, private capture, genuine OTP or real account/history acceptance occurred. The real GPT signup/readback and real Shared iMessage-to-website same-account/agent/history flows remain open.

## Composition review follow-up

Review found two merge omissions: callback CSP permission and binding the consumed phone/person to the validated identity. The current P1 fix/regression for both is carried unchanged; the composition checks identity again after atomic consume and retains only the validated callback origin on normal and unavailable consent pages. The changed-request negative and callback header case passed; affected TypeScript passed again. The exact source remains unqualified for release until normal CI/PG and independent review bind to it.

## Hosted qualification and staged fixture composition

[Hosted run 39442276383](https://github.com/eliza-research/thenetwork/actions/runs/39442276383) is bound to combined source `ccf4f7a`. Under the original runtime version 1.4.2 and actual PostgreSQL it passed the ten consent boundary cases, the pending-consent cross-connection case, all four Cloud PostgreSQL authority cases and all thirteen synthetic Cloud continuation/outage/concurrency cases. Integration reported 606 passed and one failed; e2e did not run because the integration stage failed. Normal package/site typechecks passed. This is case-level runtime/PG evidence, not full CI acceptance.

The sole failure exposed a fixture composition mismatch: the staging-origin test mounted a staging public API but constructed MCP with the original dev public API. The new authority-aware session hook therefore looked for the dev cookie while the browser held the staging __Host-sid cookie. The fixture now mounts that same staging API as the service's public API before constructing MCP. All original proxy/origin, OTP, membership/profile and cross-app rejection assertions are preserved. Product source is unchanged. The fixture passed affected local TypeScript diagnostics; successor hosted CI remains the full-flow gate. The independent Auth review at ccf4f7a is carried only because all production source leaves are unchanged.
