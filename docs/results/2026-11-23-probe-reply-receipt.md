# Probe refusal receipt replay, 2026-11-23

The first booking clarification draft reported one `decliner_exposed` violation on the first Network seed. The simulator recorded the persona's decision when it saw the probe. The intended refusal was due about 20 minutes after the service sent the named booking. Before the booking, the simulator delivered no refusal from that member.

The judge now counts a simulated probe decline when it observes the linked received reply. A plain delivered refusal remains a separate check. When its originating message has an opportunity ID, the judge uses that ID. The receipt stays in the simulator run log. It does not change the member's inbound payload.

## Method

The report is hand-written from simulated run records. The simulated reviewer approved proposals in the consent arm. Node was 26.13.0. The provider, model, request settings and cost were absent. The run used seed 1, 16 simulated days, and the default synthetic NYC consent arm. The original candidate also reproduced the failure at 21 days. The 16-day replay ends after the affected booking.

Run from the repository root after installing the pinned dependencies.

```sh
env -u SURPLUS_API_KEY -u OPENAI_API_KEY node --conditions eliza-source --import tsx --input-type=module - <<'JS'
import { runArm } from "./packages/network/harness/experiment.ts";
const result = await runArm("consent", { days: 16, seed: 1 });
console.log(JSON.stringify(result.judge));
JS
```

| Seed 1 replay | Decliner exposures | Canary leaks | Minor contacts |
| --- | ---: | ---: | ---: |
| Original draft `264ae5d6` | 1 | 0 | 0 |
| Same draft with only the receipt and judge changes from `e07efb7a` | 0 | 0 | 0 |

The single deterministic replay measures a specific failure and its repair. It does not estimate a population rate.

The regression gate also delivers a structured refusal, drops an intended refusal, delivers an unlinked plain refusal, and delivers a plain refusal tied to the first probe after a newer invitation. The old judge flagged the early reveal and the later reveal. The corrected judge flags only the reveal after receipt. The original judge used the decision time. Using the planned reply time would still count messages that never reached the channel. Using text alone would miss a delivered refusal that the offline phrase reader could not classify.

The production booking rule and its signed application cases are tracked in [PR #621](https://github.com/eliza-research/thenetwork/pull/621).
