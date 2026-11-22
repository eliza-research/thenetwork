# Return to the original chat after Join

Historical record. The [original revision](https://github.com/eliza-research/thenetwork/blob/1e2caa5028ade43ec7cb6a90de16466584f7ead0/docs/results/2026-10-15-agent-return.md) retains the commands and toolchain used for the observations. Updated command spellings here describe the current project where the same entrypoints exist.

Attribution: Automated. Codex made this fix under the user's project approval.
Base: `4ecfd9aa76efbde011da01826669661bbcd02e1a`.
Scope: PRD 28.3 agent-first onboarding; the broken-flow exception in CONTRIBUTING section 9.

## Problem and fix

The skill asks the person to return to the same conversation after joining.
The Join completion page showed a welcome message and site links without that next step.

After a successful Join with `?via=agent`, the shared page code adds one sentence:

> Go back to the same chat to finish setting up your profile.

Direct Join stays unchanged. The message contains no link or automatic action.
The page does not guess the person's client or conversation URL.
No profile data, credential, phone verification or consent flow changes.

Other implementations considered:

1. Add the message to every completion page. This also changes direct signups that did not start with an agent.
2. Guess an agent link or accept a return URL. Neither identifies the original conversation safely.

## Before and after

- [Before recording](assets/2026-10-15-agent-return/before.webm).
- [After recording](assets/2026-10-15-agent-return/after.webm).

These are **UI-only browser recordings**, not genuine phone verification or signup proof.
Both use the real built Friends Join page and the same profile-submit steps.
Only post-verification API replies are controlled to start at the profile step.
No OTP code, provider, person, database or personal browser profile is used.
Playwright recorded both videos directly. They were not constructed from screenshots.

The private live Join screenshot stays with the acceptance owner and is not uploaded.
Its SHA-256 is `2869a3ce856a428b73c61054561e3243c1f108c4cc9a341d40007dca94270445`.

## Checks

| Check | Result |
|---|---|
| Same browser case on base | Expected failure: no return message after agent-origin Join |
| Browser case after patch | 1 pass, 13 assertions |
| Existing sites checks | 81 pass, 1,419 assertions |
| Root and sites TypeScript | Pass |
| Whitespace | Pass |

The browser case checks one message after agent-origin Join, no message after direct Join, and unchanged URLs.
It checks that no unexpected API request occurs.
The recordings include a short pause so a reviewer can read each completion page.

Local versions: the former runtime 1.3.14, Playwright 1.62.1 and Chromium 151.0.7922.34.
Normal the former runtime 1.4.2 CI remains separate. No dependency was installed or added.
Full simulations, Postgres integration and full e2e were not rerun for this page-only fix.
Real LLM and agent-client testing: not applicable to the sentence-rendering path; zero model calls or cost.
The active genuine GPT acceptance flow is separate and was not repeated.

## Reproduce

Use an existing Playwright installation and browser binaries.

```sh
PLAYWRIGHT_MODULE=playwright pnpm exec vitest run --conditions eliza-source tests/e2e/agent-return.e2e.test.ts
pnpm exec vitest run --conditions eliza-source sites
pnpm run typecheck
```

The browser case skips without `PLAYWRIGHT_MODULE`.
Set `AGENT_RETURN_VIDEO_DIR` to record the isolated browser flow.
The test blocks external requests and does not call an OTP endpoint.

## Release limits

This change is not merged or deployed by this work.
The live signup realm, user browser, OAuth connections and current acceptance evidence remain untouched.
Normal CI and maintainer review remain required before merge and release.
