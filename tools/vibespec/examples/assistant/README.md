# Assistant

An illustrative agent turn driving a bill payment, in one spec:
[spec/assistant.md](spec/assistant.md). `npm run check` simulates it, proves
it and runs [the trust-boundary test](test/assistant.test.ts).

| Behaviour | Rule |
|---|---|
| Every model choice spends a bounded budget | `stepChoicesSpendBudget`, `alwaysBudgetBounded` |
| The sender comes from the session, never the message | `by`; `step(s, e, by)` |
| A late reply is refused, before or after a restart | `stepReplyAnswersWaiting` |
| A bill is reviewed, then paid once, after the person's confirmation | `alwaysPaidOnlyReviewed`, `alwaysChargedOnce`, `stepChargedOnlyOnConfirm` |
| Card details and payment go only to the biller's own page | `alwaysFilledOnlyGenuine`, `stepPaidOnlyOnGenuine` |
| The model cannot have the card read aloud | `alwaysNothingSecretSaid` |
| The program carries out effects from an outbox | `outbox`, `drain` |

Written by hand here, with no help from the tools yet:

| Need | How |
|---|---|
| Termination | a budget every choice spends |
| Requests in flight | a request number, saved |
| Crash and restart | `restart` resets what is not saved |
| The model and the world as adversaries | their choices are event parameters; the simulator tries every sender |
| Secrets | effects tagged `secret` |
| Effects | an outbox in the state |

This example models a trusted sender and a durable outbox. It does not
implement authentication, a browser, payment execution or durable storage.
