# Private reviewed profile suggestions — source and local qualification

Historical record. The [original revision](https://github.com/eliza-research/thenetwork/blob/1e2caa5028ade43ec7cb6a90de16466584f7ead0/docs/results/2026-10-17-reviewed-profile-suggestions.md) retains the commands and toolchain used for the observations. Updated command spellings here describe the current project where the same entrypoints exist.

This separately approved intake work adds private pending suggestions and an authenticated internal review boundary. It does not fetch Google data, create a Google connector, enable matching, send a message, or deploy a migration. The source is stacked on the inferred-facet fix in PR #97; that PR remains independently reviewable.

Pending and rejected suggestions never enter the canonical snapshot. An exact human decision promotes only the reviewed value and scope to the existing facet table, preserving provider, observation time, confidence and inferred provenance. Edits and scope changes return a new revision for review. Expiry, rejection and disconnect erase pending content. Explicit disconnect retention applies only to already accepted facts. App leave, account deletion and batch deletion remove linked derived facts without deleting unrelated facts.

Collection requires an explicit source window, timezone, allowed fields, expiry and disconnect-retention choice. Import and acceptance recheck the source-consent callback inside the database transaction. No authorizer is installed by default. The real connector owner still needs to implement current connection/consent verification; personal Google assistant consent is not Network learning consent.

## Internal route contract

`POST /internal/profile-suggestions/preview`, `/decide` and `/delete` reuse the existing service HMAC. The signature covers the exact path and raw body; the signed request ID is `<messageId>:suggestions:<action>`. Query parameters are refused. Bodies are capped at 16 KiB and decoded as strict UTF-8. Responses are not cached.

The common body is `{channel, messageId, batchId, networkAuthority?}`. Decisions and deletion additionally require `text`. Caller-supplied user, organization, person, app or chat fields are refused. The Network derives the person/app/member from the completed open turn and canonical phone/member relationship. Decisions and deletion must exactly match that turn's stored inbound human text. A delete command is `delete <batchId>`.

`ServiceOptions.profileSuggestionIdentity` must resolve the existing trusted Cloud user/organization/private chat for that canonical turn. It is called again inside each store transaction. The resolver must verify current binding and revocation using the supplied transaction; an absent resolver returns 503. Phone/member identity alone is insufficient. `profileSuggestionAuthorization` separately rechecks source consent before promotion.

Successful responses have `kind` and `reviewText`; a preview also carries the canonical batch, while a save carries accepted/rejected suggestion IDs. Stale, replayed, wrong-owner and invalid-command decisions do not save. Database failures return a generic unavailable response, with no source content or SQL details.

## Validation boundary

Local fixtures use synthetic adults, a fake source-consent callback, a fake trusted Cloud binding resolver, real HTTP, and an isolated real PostgreSQL database on port 54428. No Google, LLM, OTP or delivery provider calls run. These tests prove the Network request/store boundary; they do not prove the deployed Cloud resolver, real iMessage dispatch or real Google extraction.

Focused command, the former runtime 1.4.2:

```sh
OBSERVATORY_PG_PORT=54428 OBSERVATORY_PG_DIR=<owned-local-cluster> REQUIRE_PG=1 \
  pnpm exec vitest run --conditions eliza-source packages/network/test/profile-suggestions.integration.test.ts \
  packages/network/test/profile-suggestion-review.test.ts
```

The initial focused run passed 31 tests and 184 assertions. The final broader run includes the additional resolved-preview assertion. Cases cover pending isolation, exact acceptance, edits and scope revisions, wrong owner/org/person/app/chat, signature mismatch, fabricated human commands, replay, expiry, source revocation, identity revocation during a request, atomic rollback, deletion, app leave, row-level isolation, and cleanup after authorization is disabled. Independent source review found no actionable HTTP-boundary defect. Broader qualification is recorded separately after terminal results.

Final pinned integration command: `pnpm exec vitest run --testTimeout 120000 ./deploy ./packages ./sites` with the same isolated cluster. Result: **593 passed, zero failed, 11,822 assertions across 61 files**. TypeScript checking passed. Earlier intermediate runs used an unintended shell-resolved the former runtime 1.3.14; they are not qualification results. The final command directly invokes the former runtime 1.4.2.

The normal backend forwards only the three exact internal review paths, with a 16 KiB declared-body cap. Its regression assertions pass in the integration suite.

An additional private joined fixture imports the actual Cloud `NetworkServiceClient.profileSuggestion` and real bounded-fetch implementation from the paired source worktree, then calls the actual Network HTTP service and PostgreSQL. It passed one test and 14 assertions, including source/binding revocation, acceptance, replay refusal and linked deletion. The local source resolver/connector remains a fixture. The explicit tsconfig alias invocation emits a nonfatal the former runtime directory-mismatch warning; exit status and test assertions passed. No deployed or live acceptance is inferred.

Final end-to-end command: `pnpm exec vitest run --testTimeout 180000 ./tests/e2e`, same the pinned former runtime and isolated PostgreSQL. Result: **42 passed, three existing browser skips, zero failed, 609 assertions**. No browser-native or provider acceptance is claimed for the skipped cases.
