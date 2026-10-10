# Isolated staging onboarding authority

## Problem

At `f4e6797`, an extra staging backend host reaches the public API.
The MCP service still uses canonical hosts and issuers.
The generated staging prompt and application links also name production.
Turnstile checks use production hostnames.
The new signed HTTP/Postgres case fails at OAuth discovery: expected 200, received 404.
The built-site case fails because the staging prompt names `https://slop.date`.

A separate reproduction finds a signed-host routing error.
A valid signature for an unknown host can inherit an allowed transport host.
The request is incorrectly treated as a trusted edge request: expected 421, received 200.

## Correction

One staging-only JSON mapping supplies exact HTTPS site origins by app ID.
The backend, public API, MCP registry and site build use that mapping.
Configured apps use only their staging host, issuer, resource and authentication links.
Turnstile checks use that app's staging hostname.
The existing real-provider, phone, age, consent and custom-pilot requirements remain.

Production rejects nonempty staging mappings. Development cannot enable them.
A staging deployment can still use `NODE_ENV=production`.
Canonical production authorities, DNS aliases, encoded authorities and duplicate hostnames are refused.
The build requires an isolated backend and mappings for linked applications.
A backend equal to a site origin is refused because it would forward requests recursively.

The edge flag now requires an app resolved from the verified signed host.
A transport host cannot supply that missing authority.
Existing unsigned development routing remains unchanged.

The four landing agent links encode the same staging prompt.
Displayed application branding and canonical plugin snapshots remain unchanged.
No dependency, account store, provider, deploy workflow or production setting is added.

## Validation

Use Bun 1.4.2 and the owned Postgres on port 54349.
Set `REQUIRE_PG=1`, `OBSERVATORY_PG_PORT=54349` and the checkout's `OBSERVATORY_PG_DIR=runs/pg`.
Keep live-provider keys and `LIVE_TESTS` unset.

- New HTTP/Postgres case: 1 pass, 42 assertions on the final parser.
- Existing backend plus initial new case: 29 pass, 289 assertions.
- Site integration: 71 pass, 1188 assertions, including all four agent link payloads.
- Package and site typechecks, plugin snapshot checks and whitespace checks pass.
- Official full simulation: exit 0, 320 blocking gates pass, 13 tracked targets miss, 304.3 seconds.

The full simulation started before the final DNS-alias and recursive-backend guards.
Focused integration cases qualify those changes. Exact final-source hosted CI remains required.
Full combined integration passes: 521 tests, zero failures, 10872 assertions, 250.65 seconds.
Full E2E passes: 35 tests, zero failures, 400 assertions, 8.10 seconds.

Before and after site artifacts use the same staging configuration.
The before build uses isolated `f4e6797` source.
Browser captures show the prompt and links. No vendor link was submitted.
The silent video shows the before capture for five seconds, then the after capture for five seconds.
All local preview backend paths return 503; no provider can be reached through the walkthrough.

These results prove controlled HTTP, database and generated-link behavior.
They do not prove vendor-side prefill, hosted ChatGPT signup, Cloud SSO or native delivery.
No staging resources were created or deployed. Production approval remains separate.
