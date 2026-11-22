# Network consumer of Cloud's private review-owner proof

Historical record. The [original revision](https://github.com/eliza-research/thenetwork/blob/1e2caa5028ade43ec7cb6a90de16466584f7ead0/docs/results/2026-10-17-profile-review-owner-consumer.md) retains the commands and toolchain used for the observations. Updated command spellings here describe the current project where the same entrypoints exist.

Source/local scope only. This consumes an existing, currently admitted conversation turn; it does not establish a new account link, fetch Google data, enable a connector, deploy a migration, or activate production. The existing native iMessage → original Cloud account/agent/history requirement remains open.

## Contract and authority

`packages/core/src/svc/profile-review-owner.ts` is copied byte-for-byte from the paired Cloud plugin's `plugins/plugin-network/src/backend/profile-review-owner.ts`. SHA-256: `13b43afa50b8efe1c0b10de4a76fb21a27f82c4e12120cc372ea44d5786904ec`. The existing turn contract and its mirror pins are unchanged.

`cloudProfileReviewOwner` uses the fixed `/api/internal/network/profile-review-owner` path on an exact configured HTTPS origin. Loopback HTTP requires explicit development configuration. Each request gets a fresh UUID nonce and the existing service HMAC over its path, ID and raw JSON. The response must also be signed over its exact bytes, with the request ID plus `:proof`. The canonical parser binds nonce, selector hash, channel/message, app/member, batch/action, exact command digest and route authority. Proofs last at most 30 seconds and cannot outlive current route admission.

Before lookup the consumer rechecks the actual PostgreSQL signed-turn request hash, completed OPEN response, person/member/app association, membership, stored inbound human command and route authority. A missing or unsigned turn, different person, command, batch or action, stale/future arrival, expired route, wrong response signature, nonce or selector, redirect, malformed/oversized proof, or timeout denies. There is one attempt, no owner cache and no phone, UUID or batch-only fallback. The three-second deadline covers the HTTP request and response body.

The consumer passes an internal `validUntil` to the route/store boundary. Fresh proof, route and batch deadlines are checked after asynchronous authorization, before mutations, and after the final database work. Expiry causes the transaction to roll back. Edits also recheck after their final preview read; a stale proof cannot commit an edited preview. The actual canonical review parser still owns exact accept/reject/edit decisions.

## Remaining Cloud and consent boundary

Cloud owns the real parent-proof lookup and its primary owner/organization lifecycle, verified-phone, dedicated-cutover and route checks. The consumer has no authority to manufacture those facts. Source consent is a separate callback: the existing `personal_google_context_v1` grant does not authorize Network learning. A new explicit named-app/person/window/fields/retention consent must be genuinely confirmed and checked by its Cloud grant owner. Missing identity resolution returns 503; missing source authorization denies promotion. Neither production startup path installs this consumer automatically.

## Local verification

Use the pinned former runtime 1.4.2 and the isolated owned PostgreSQL cluster on port 54428. The consumer tests use a synthetic signed Cloud proof server, not a production account or real Google consent. They verify actual Network SQL, HTTP signatures, nonce correlation and canonical store behavior. A separate paired test against Cloud's actual DO implementation is tracked with its owner; this report does not claim it passed.

Commands:

```sh
pnpm exec vitest run --conditions eliza-source packages/network/test/profile-suggestions.integration.test.ts packages/network/test/profile-suggestion-review.test.ts
pnpm exec vitest run --testTimeout 120000 packages/network/test/shared-agent.integration.test.ts deploy/backend/backend.test.ts
pnpm run typecheck
```

The focused run passed 38 tests and 297 assertions; the normal signed Shared-turn/backend regression passed 42 tests and 554 assertions. The final fence-only regression additionally passed eight assertions covering rollback of both acceptance and edit-preview changes after database writes. TypeScript checking passed. Independent review found a proof-expiry timing gap; the fresh transaction fences and post-preview-read checks above close it. No full-pipeline rerun is used to imply deployed acceptance; the earlier 593 integration and 42 end-to-end pass belong to the preceding source qualification.
