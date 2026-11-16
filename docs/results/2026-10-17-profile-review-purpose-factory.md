# Network factory for explicit learning-purpose authorization

Historical record. The [original revision](https://github.com/eliza-research/thenetwork/blob/1e2caa5028ade43ec7cb6a90de16466584f7ead0/docs/results/2026-10-17-profile-review-purpose-factory.md) retains the commands and toolchain used for the observations. Updated command spellings here describe the current project where the same entrypoints exist.

Source/local qualification only. No flag was enabled in a running service, no new consent or OAuth grant was created, no Google data was collected, and nothing was deployed. The original GPT/native iMessage account-and-history acceptance remains a separate open requirement.

## Wiring

`NetworkService` registers the reviewed callbacks through `profileReviewFromEnv`. Both normal startup paths construct that service. The feature defaults off: `NETWORK_PROFILE_REVIEW_ENABLED` absent or `0` supplies no automatic identity resolver. An explicit `1` requires the existing isolated staging route policy, exact trusted `NETWORK_CLOUD_DELIVERY_ORIGIN` and existing service key. It creates callbacks without making a network call. Invalid or incomplete configuration fails closed; no route dates, secrets or actors are created.

The factory obtains a fresh owner proof from the current stored turn. A transaction-local WeakMap then binds source authorization to that exact transaction, owner/person/app/chat, command and batch. A different transaction or owner cannot reuse it. It neither caches a grant across requests nor infers identity from a batch, UUID or phone pair.

`profile-review-source.ts` is copied byte-for-byte from the Cloud-owned canonical contract, SHA-256 `6d26162fd440a33da04f7526749e77b0a13ea52d972630447da611475d7e0c9c`. The owner contract remains unchanged at `13b43afa50b8efe1c0b10de4a76fb21a27f82c4e12120cc372ea44d5786904ec`.

The source lookup uses `/api/internal/network/profile-review-source` with the existing service HMAC. Its signed request includes the current review selector, canonical Network person and exact source connection, provider, time window, timezone, fields and retention choice. It contains no caller-selected Cloud user, organization or chat. A signed success reply binds the entire raw request hash and nonce and lasts at most five seconds. The factory also compares its returned Cloud identity with the same transaction's owner proof. The shortest owner/source/route deadline remains live through the store's final transaction fence; expiration rolls changes back.

Owner and source lookups share the existing bounded transport: exact origin/path, strict UTF-8, signed response, 16 KiB cap, three-second total deadline, no redirects, retries or credential cache.

## Consent and cleanup boundary

Cloud alone owns reading the real primary grant, owner preferences and new `network_profile_learning_v1` consent. Its adapter must match the stored person/app/chat, fields/window/retention and current connection/read scope. Existing personal Google context consent cannot substitute. The Network neither creates such consent nor calls Google.

Preview, reject, delete and connector-owned revoke cleanup do not invoke collection authorization. Missing new learning consent therefore does not disable those existing operations. Conversely, `propose()` without an admitted owner/decision context is denied: this bootstrap does **not** wire or authorize a new extraction/collection entry path. That path and the genuine consent flow remain separate work.

## Verification

Pinned the former runtime 1.4.2, isolated synthetic PostgreSQL on port 54428:

```sh
pnpm exec vitest run --conditions eliza-source packages/network/test/profile-suggestions.integration.test.ts packages/network/test/profile-suggestion-review.test.ts
pnpm run typecheck
```

Result: **44 passed, zero failed, 586 assertions**. TypeScript passed. Cases cover normal constructor opt-in registration, default-off/incomplete configuration, same-transaction ownership, wrong owner and source scope, missing purpose, legacy purpose, nonce/hash mismatch, expired/future/overlong proof, positive synthetic proof, post-authorization expiry rollback, and cleanup without new collection permission. The normal bootstrap test redirects only a reserved synthetic Cloud origin inside its own test process; HMAC bytes and the real Network/fixture HTTP handlers are exercised. This is not live TLS/provider acceptance.

Independent Network source review found no actionable defect in the factory/transport delta. The actual Cloud primary-consent/grant adapter is separately owned and its paired joined fixture is tracked separately; a synthetic proof-server pass is not a claim that real learning consent exists. The already-qualified full pipelines were not repeated for this focused change.
