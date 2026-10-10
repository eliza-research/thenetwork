# Private ChatGPT Slop onboarding preparation

## Problem and scope

Main `b53bd86` excludes Slop from the public OpenAI plugin and rejects ChatGPT
custom connections too. Its existing exception is development-only. It cannot
serve as a real-account staging or production configuration.

This change prepares a separate, default-off custom connector at
`https://slop.date/mcp`. It retains the public exclusion and the development-only
exception. It adds no account store, model service, OTP provider or schema.
No activation, deployment, real signup or hosted ChatGPT acceptance occurred.

## Implementation

`MCP_CUSTOM_CHATGPT_SLOP=on` requires explicit staging/production configuration
and `MCP_CUSTOM_CHATGPT_SLOP_PERSON_IDS`, an allowlist of existing person IDs.
Unknown values, dev/unknown environments, empty allowlists and mixed pilots fail
startup. Existing deployed provider, database and Turnstile checks remain.

Only DCR clients with HTTPS redirects on the exact supported ChatGPT hosts can
use the exception. The account must retain its verified phone identity, an
active/onboarding Slop membership without review, no hold or ban, and a known
stored age floor of at least 18. These checks apply at consent, code exchange,
refresh and each authenticated request. Consent checks the current browser
session; a different account cannot inherit an earlier person's permission.

The pilot offers only `app_info`, `start_signup`, `check_status` and
`submit_profile`. It refuses updates on both discovery and calls. The full Slop
resource is required; the public OpenAI surface and CIMD stay excluded.

Two alternatives were considered. Removing Slop's public exclusion would change
directory behavior. Extending the existing development exception into deployed
environments would mix fictional and real-account operation. The separate
default-off mode preserves those boundaries and reuses the existing OAuth owner.

## Validation

Use Bun 1.4.2, `REQUIRE_PG=1`, owned Postgres port 54349 and this checkout's
`runs/pg`. Providers are fictional and sends are dry-run. No model runs.

The initial four new Postgres E2E scenarios pass with 89 assertions. They cover
configuration and public boundaries, HTTP DCR/PKCE and same-person SQL readback,
ineligible accounts and account switching, persistent-store suspension and
revocation, changed age/hold/ban/phone ownership, and tool/resource isolation.
The test harness configures the handler directly; it does not enable fictional
providers in a real deployed runtime. Final results on this source:

- Focused OAuth/MCP/E2E compatibility: 83 pass, zero failures, 701 assertions.
- Full `bun run test:integration`: 468 pass, zero failures, 9984 assertions,
  181.70 seconds.
- Full `bun run test:e2e`: 34 pass, zero failures, 373 assertions, 9.22 seconds.
- `bun run typecheck` and `bun run plugins/build.ts --check`: exit zero.
- Full `bun run sim`: 296/296 blocking gates pass, 13 tracked targets off target,
  322.8 seconds. The official script uses its pinned seeds and clears model keys.
- Retired-domain source guard and `git diff --check`: no matches/errors.

The initial four-case count above is an earlier focused checkpoint. The full
suite results qualify the final source. These are deterministic acceptance cases;
statistical confidence intervals do not apply.

## Activation and rollback

Review the private connector policy and named adult accounts, then verify
staging and obtain approval for the concrete deployment/configuration. The
person enters their own real phone/code and accepts real Terms and connector
consent in the site flow, then approves their profile in ChatGPT.

Disable the mode or remove the account from its allowlist to suspend access
after restart/reload. Existing revocation remains usable. Re-enabling can resume
eligible unrevoked grants; permanent withdrawal uses normal disconnect/revoke.

## Separate live-site finding

Read-only browser diagnostics found that `https://slop.date/join` returns 200,
but its `/api/app` and `/api/me` requests return 530. The public `/api/app`
response reports Cloudflare error 1016 for the retired API origin. The current
API health response does not establish that the deployed Pages proxy uses it.
The platform lane owns the fresh site build and deployment review. No real
phone was entered and no OTP was requested during diagnosis.
