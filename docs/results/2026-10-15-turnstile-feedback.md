# Failed security-check feedback

Historical record. The [original revision](https://github.com/eliza-research/thenetwork/blob/1e2caa5028ade43ec7cb6a90de16466584f7ead0/docs/results/2026-10-15-turnstile-feedback.md) retains the commands and toolchain used for the observations. Updated command spellings here describe the current project where the same entrypoints exist.

Attribution: Automated. Codex made this change under the user's project approval.

Base: `4e6a67e7d0273e170250de1bf54c1a17fa8e7442`.
Scope: PRD 28.3, membership phone verification and agent-first onboarding.

## Problem

The Turnstile error callback removed the token without recording failure.
The phone form then told the visitor to wait for a check that had failed.
An SDK script-load failure also stayed pending.

Cloudflare error `300030` is a vendor challenge failure, not proof of an application authentication bug.
This patch does not make a rejected challenge pass.

## Change

The widget reports pending, failed or ready state to the phone form.
A failed check shows recovery guidance.
A successful callback clears only security-check feedback.
Widget failure and recovery preserve unrelated phone-validation messages.

Mandatory token verification and the SDK's automatic retry remain unchanged.
There is no automatic reset, new verification mode or provider change.

Other implementations considered:

1. Change only the pending message. This still loses the actual failure state.
2. Reset the widget after every error. This changes the SDK retry behavior and cannot fix vendor rejection.

## Evidence

These are **UI-only simulated SDK failure** recordings from an isolated local browser.
They use a fictional 555 number, an in-memory API and controlled SDK callbacks.
The SDK response token is inert and is never submitted.
No personal profile, real challenge, provider or database is used.
These recordings do not prove real phone verification or signup.

- [Before: failed check still says to wait](assets/2026-10-15-turnstile-feedback/before.webm).
- [After: failure feedback and recovery](assets/2026-10-15-turnstile-feedback/after.webm).

Playwright recorded both videos directly. They were not constructed from screenshots.
The private source-audit receipt has SHA-256 `1b8b54a22c74e7102f2a1f3dfd26ca72efe4f571c3a03b45fd639ad5afa211c0`.
No private browser evidence or personal phone image is included.

The same browser integration case fails on the base and passes after the patch.
It checks pending, failure, recovery, unrelated validation feedback, script-load failure and zero OTP requests.

| Check | Result |
|---|---|
| Base browser case | Expected failure: pending feedback remains after the SDK error |
| Patched browser case | 1 pass, 16 assertions |
| Existing sites tests | 81 pass, 1,419 assertions |
| Root TypeScript | Pass |
| Sites TypeScript | Pass |
| Whitespace | Pass |

Local runtime: the former runtime 1.3.14, Playwright 1.62.1, Chromium 151.0.7922.34.
The maintained project runtime is the former runtime 1.4.2; its normal CI remains a separate check.
Existing cached dependencies were linked into the isolated checkout. No dependency was installed or added.

Real LLM evidence: not applicable. This change has no model path. Calls: zero. Cost: zero.
Agent-client signup acceptance: not performed by this patch.
Full simulations, Postgres integration and the full e2e suite were not rerun locally.
The browser case skips unless an existing Playwright module is provided.
No live realm, Cloudflare resource or user browser was changed.

## Reproduce

Use an existing Playwright installation and its browser binaries.
Set `PLAYWRIGHT_MODULE` to its module path or resolvable package name.

```sh
PLAYWRIGHT_MODULE=playwright pnpm exec vitest run --conditions eliza-source tests/e2e/auth-feedback.e2e.test.ts
pnpm exec vitest run --conditions eliza-source sites
pnpm run typecheck
```

The browser case starts an isolated local HTTP server and closes it after the test.
It blocks external traffic and supplies only the simulated SDK callbacks.
The failed SDK callback must show failure guidance, and no OTP request may occur.
The successful callback must clear security-check feedback without clearing unrelated errors.

## Limits

The real browser challenge remains a human acceptance gate.
This patch is not deployed and must not interrupt the current signup attempt.
The draft PR needs normal CI and maintainer review before merge.
