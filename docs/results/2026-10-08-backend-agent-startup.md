# Private agent reader startup (2026-10-08)

## Scope and source

The backend review branch now includes main at `d19db14` and the private reader guard at `9080295`.
The merge commit is `6b87e69`. Main adds Slop onboarding extraction and Clef fitting in 28 files.
The merge had no conflicts. Git combined the TypeScript path mapping with the new Clef script inclusion.
The Cloud phone sign-in branch stays separate at `ce2d1ec`. This branch has none of its auth changes.

The service accepted `ServiceOptions.agentToken`, but both startup programs omitted it.
They now pass the optional `NETWORK_SERVICE_AGENT_TOKEN`. An unset value keeps the endpoints disabled.
The credential also needs an app admin grant in `NETWORK_SERVICE_TOKENS`.
It remains a reader: staff routes and matching changes refuse it. The console credential cannot designate a reader.
No environment secret was set. No deployment, provider send, or model call ran.

## Reproduction and result

The existing backend boot test now uses one synthetic adult fixture.
The fixture has a canonical phone, person, active Slop membership, consent, and a network member.
It also has one shareable facet and one private facet.
The backend runs as a non-owner login with `network_service`, without superuser or RLS bypass rights.
The owner applies migrations and creates the fixture before startup.

Before the startup mapping, the extended boot check failed: the private route returned 503 for the human token, instead of 403.
After the mapping, actual HTTP requests give these results:

| Request | Result |
|---|---|
| Reader: canonical app route, explicit Slop keyword or existing membership | 200; app, person ID, member ID only |
| Reader: private Slop membership | 200; app, person ID, member ID only |
| Reader: private Slop context | 200; first name, city, state, safe facet; no private facet |
| Reader: either endpoint on the public listener | 404 |
| Human admin: either private agent endpoint | 403 |
| Reader: either endpoint for Friends | 403 |
| Reader: matching change or staff health | 403 |
| Independent human admin: staff health | 200 |
| SIGTERM | Exit 0, clean shutdown |

The boot check also verifies no-store responses and logs without credentials, raw fixture phone, or private canaries.

## Validation

Tools: Bun 1.4.2 and Node 24.15.0. Tests use the existing local Postgres on port 54339.
Provider keys were cleared. Seeds do not apply to the HTTP fixture. All fixture data is hand-written and synthetic.

```bash
bun test --conditions eliza-source --timeout 120000 deploy/backend/backend.test.ts
node node_modules/typescript/bin/tsc --noEmit -p .
node node_modules/typescript/bin/tsc --noEmit -p sites/tsconfig.json
(cd packages/plugin-network && ./node_modules/.bin/tsc --noEmit -p tsconfig.json)
bun run sim --only onboard --quick
git diff --check
```

- Backend: 30 pass, 0 fail, 398 assertions. The boot check also covers explicit and implicit canonical app routing.
- Root, sites, and plugin TypeScript checks: pass.
- Onboarding quick run: 18/18 blocking gates pass, five tracked gates pass.
- Onboarding sample: corpus 444 rows; seed 13; 117 adults and three minors in the persona run.
- Onboarding hard fields: 296/296 correct; held-out corpus: 70/70 correct.
- No wrong gender or seeking values after confirmation. No simulated minor was matchable.
- Full simulation, Clef fitting, live providers, and Cloud integration were not run in this bounded check.

The worktree reuses installed dependency artifacts. Its workspace package links resolve to this worktree's source.
Its Eliza source links reuse the existing submodule at the tracked `a6b2ed93` revision.
No dependency installation or broad build ran. A helper initialized an unused, ignored 39 MiB local cluster directory.
Later checks used `OBSERVATORY_PG_DIR=/Users/nubs/Git/thenetwork/runs/pg` and the existing server.

## Design choices

1. Use an existing staff or console token automatically. This would enable reads without explicit designation and mix staff and reader authority.
2. Add a separate startup token registry. This would duplicate the existing app grants and risk different authorization decisions.

The optional designation uses the existing service option and grant checks. It adds no default authority or new registry.
PRD 28.3 and 32.14 require app privacy and audited reads. This check does not decide who owns the member conversation.

## Remaining integration

The new Slop extractor remains an engine module. Its conversation loop integration is described in the onboarding report.
This change does not wire that loop, enable the LLM reader, configure a Cloud credential, or qualify a deployment.
Full simulation and release checks remain separate from this local result.

## Review follow-up: phone-only membership preflight

Cloud formerly sent a complete Personal message to the private routing endpoint before it learned that the person was not a member.
`POST /agent/membership-status` now checks the existing canonical membership owner with only the verified phone.
A false result prevents the text-bearing routing request. A true result grants no permission to read another app; routing and context still recheck their own app grants and current membership.

The existing backend HTTP suite failed before this endpoint existed (403 instead of the expected eligible response).
After the change: 30 tests pass, with 441 assertions. Root, sites, and plugin TypeScript checks pass.
The same synthetic PostgreSQL fixtures verify reader grants, exact request bodies, public-port refusal, no membership/message/state changes, hashed audit records, and STOP revocation.

An additional local component check uses the actual current Cloud client, private Network handler, and a fresh migrated PostgreSQL database.
All 13 checks pass, including phone-only preflight, no text forwarding for a non-member, and no text forwarding after global STOP.
Cloud account projections are controlled fixtures. These checks do not prove hosted login, model inference, or iMessage delivery.
No model or messaging provider ran. The fixture database was closed and dropped.

Alternatives: probing the existing app route with empty text could choose an inactive fallback app; caching eligibility could retain revoked membership.
The canonical phone-only read avoids both problems and adds no membership owner or cache.
