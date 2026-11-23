# Keep a safety question after an unrelated reply

When a member answered another prompt, the earlier implementation cleared the stored safety question before deciding where the reply belonged. The member could still answer the other prompt, but a later exact name filed no report. A long reply with no allowed name also cleared the question. The original fix and two fixtures came from [#594](https://github.com/eliza-research/thenetwork/pull/594).

The revised decision preserves the current question when an unrelated reply continues through ordinary dispatch. A bare yes or no can answer a competing probe. An explicit cancellation ends the question. An expired question cannot intercept a later reply or prevent an otherwise eligible invitation survey. A current question still prevents that survey. The member must supply an allowed target before a report can be filed.

The first alternative was to consume every reply while a safety question is open. That would intercept valid answers to other prompts. The second was to renew the question whenever unrelated text arrives. That would extend its original one-day window. The selected decision preserves the original question and expiry without intercepting the other reply.

## Paired results

The same 13 native cases ran on `6664f931` and the revision under review with Node 26.13.0. The baseline failed the competing yes, competing no, long unrelated reply, and expired-question survey cases. The revision passed all 13, including explicit cancellation and a current question preventing an invitation survey. Run the same command after copying the revised test file to the baseline.

```sh
node node_modules/vitest/vitest.mjs run --project integration \
  packages/network/test/block-target-plan.test.ts
pnpm run quint:check safety_trust
```

The exact focused run with the signed-gateway integration file passed 33 cases. The standalone whole-flow model passed all 18 jobs, including the new scenario that preserves a question across both kinds of unrelated reply and files the report after the member names the original subject. The generated safety model passed 12,000 traces, 403 TypeScript replays, and 22 Dafny obligations. The report uses hand-written fixtures and generated formal traces. There were no inference calls or external messages.
