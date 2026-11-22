# Relay consent on Vibestack

The signed turn and relay action exercise Story F16 with two synthetic adults in a mutually accepted match. The fixture uses a fixed clock, network seed 1, local PostgreSQL and the dry-run adapter. The request and withdrawal readers are deterministic and make zero model calls. The dry run records which phone shares the service would send.

| Request sequence | Base `f662eda0` | With this change |
|---|---|---|
| Ari asks to swap. Bo says “I will not give Ari my number.” | The relay action returns `pass`. | The relay action returns `none`. The service records no number share. |
| Bo has a pending swap and says “actually please don't send it.” Ari then asks to swap. | Ari's request returns `pass`. | Ari's request returns `hold`. The service records no number share. |
| Ari has a pending swap and says “Don't hesitate, send my number.” Bo then asks to swap. | Bo's request returns `hold`. | Bo's request returns `pass`. The service records both shares. |

Run the same cases before and after the parser change with `REQUIRE_PG=1 pnpm exec vitest run --project integration packages/network/test/relay.test.ts`. On the base, apply the regression assertions and run each case with `-t` in a separate invocation to isolate its fixture. All five cases in the relay test file pass with the change.

The three input changes come from [#523](https://github.com/eliza-research/thenetwork/pull/523), [#525](https://github.com/eliza-research/thenetwork/pull/525) and [#518](https://github.com/eliza-research/thenetwork/pull/518). The application uses generated [relay request and consent rules](../../spec/relayDecision.md) for the decisions. The signed HTTP cases exercise the text reading left in the engine and network packages. Direct pronoun refusals can cancel a pending swap. Phrases such as “don't send them a reminder” keep the swap because they name a different action.

## Withdrawal at final dispatch

Two signed HTTP cases stop the dispatch worker between its preliminary checks and final database admission. The sender then withdraws on the signed turn path. The cases confirm that the withdrawal has committed before resuming dispatch. On `844d9b90`, the Cloud fixture received a waiting swap question in the first case and acknowledged a number share in the second. After the fix, the fixture received zero relay posts in either case and no delivery was reported. The receiver and sender both retain their control over the pending exchange until final admission.

Run `REQUIRE_PG=1 pnpm exec vitest run --project integration packages/network/test/shared-relay.integration.test.ts -t 'a withdrawal that commits'`. Both cases fail before the fix and pass after it. The two relay test files pass 18 cases together. The Quint relay model passes type checking, traces, safety simulation and seven reachability checks. The provider is a local fixture with synthetic records and no live sends or model calls.
