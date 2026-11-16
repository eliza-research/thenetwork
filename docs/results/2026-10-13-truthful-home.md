# Explicit home and conversation ownership

Historical record. The [original revision](https://github.com/eliza-research/thenetwork/blob/1e2caa5028ade43ec7cb6a90de16466584f7ead0/docs/results/2026-10-13-truthful-home.md) retains the commands and toolchain used for the observations. Updated command spellings here describe the current project where the same entrypoints exist.

Date: 2026-10-13. Attribution: Automated. Base: `61d5663`.
Implementation: `948dc6bc809a29c93b04d444a47949e3335076ca`.
Reproduced issue: [#72](https://github.com/eliza-research/thenetwork/issues/72).

A normal invited web join with the existing `neighborhood: "Bay Area"` field
returned HTTP 200 but stored `home_city: "nyc"` and NYC home presence. The service
used the runtime city as the person's home. Changing that column alone would
exclude the person from the runtime snapshot and break profile intake.

The join parser now accepts an optional explicit `homeCity` and exact NYC/SF
region labels, including Bay Area. A whole neighborhood field naming that region
also states home. Conflicting city values are invalid. ZIP codes and other
neighborhood names do not infer a city. Unstated home keeps the legacy default.
The four join forms expose an optional home-city choice.

The member and home presence keep the stated city. The registered app/home
runtime owns the conversation; an unserved home uses the app's existing default
runtime. Snapshot, address-book, MCP, native-message and member-action ownership
agree. Native join turns retain the explicit home in the existing pending-text
store through additive migration 0035. Consented app enrollment carries only the
common home city.

The engine's existing NYC-home filter remains unchanged. Conversation ownership
creates no trip or matching eligibility. The physical NYC predicate requires a
member record and either NYC home or a bounded NYC visit covering the complete
requested window; a conflicting trip elsewhere refuses it. Agent context uses
the same predicate. No network activation or historical data backfill was added.

## Closed source evidence

the former runtime 1.4.2; owned local Postgres port 54349; isolated synthetic test databases.
No live provider, model, personal account or real OTP was used.

- Same-command HTTP/Postgres reproduction, using existing exposed fields:
  `pnpm exec vitest run --conditions eliza-source tests/e2e/platform.e2e.test.ts -t 'explicit home survives'`.
  Base: 0 pass, 1 fail, 3 assertions; expected SF, received NYC. Fixed: 1 pass,
  37 assertions. The case verifies profile learning, real record/age, fresh
  service reload, physical-presence boundaries, invalid input and an NYC control.
- Both new boundary cases: 2 pass, 65 assertions. The second verifies served-home
  ownership without duplicate processing, a native multi-turn join, consented
  child-app home propagation, signed agent context and the lowest-age guard.
- Existing platform E2E plus service-apps, service-platform, shared-agent and
  shared-actions integration files: 81 pass, 0 fail, 1,291 assertions.
- `pnpm exec tsc --noEmit`: exit 0.
- Official `node --import tsx --env-file-if-exists=.env --conditions eliza-source scripts/sim.ts --only network`:
  61/61 blocking gates pass; 0 tracked targets missed; 101.2 seconds. The normal
  runner clears model keys. The whole simulation suite was not rerun locally.

Private receipts are retained under ignored `test-results/truthful-home-20261013/`.
Independent automated source review approved exact implementation `948dc6b`
without a blocking finding; the reviewer did not rerun tests.

## Remaining qualification

Actual Chrome 154.0.8037.98 browser qualification completed with fictional invited adults and fake OTPs.
No model or live provider was used.

- [Before video](media/2026-10-13-truthful-home-before.mp4): actual base `61d5663` UI, shared JavaScript, router and backend.
  The normal form states Theo, age32 and Bay Area. Join succeeds; separate actual SQL receipt shows NYC home with Bay Area text.
- [After video](media/2026-10-13-truthful-home-after.mp4): actual candidate `948dc6b` UI/backend.
  The form selects San Francisco/Bay Area and states Bay Area. Join succeeds; Settings shows Active; actual SQL shows SF home.

The base uses a loopback-only Origin adapter for localhost cookie isolation. The two stacks use different fictional phone identities.
Recorded browser frames retain their capture order and time intervals, capped at eight seconds between frames for review.
An initial base-HTML-only preview was superseded and is not used as the broken-backend video.
The browser blocked the base's separate `/evidence` page. It was not retried or bypassed; SQL evidence remains separate.
The same-command HTTP/PostgreSQL RED/GREEN case additionally uses identical final inputs without the new selector.

### Reproduce the browser flow

For a clean checkout, install the project dependencies and PostgreSQL 16 prerequisites.
Use a fresh, owned local database. Do not reuse another operator's database or occupied ports.
The standard dry-run platform command below uses the documented local dev cluster on54339.

```sh
NETWORK_DATABASE_URL=postgres://$USER@127.0.0.1:54339/truthful_home_demo pnpm run platform:dev
curl -fsS -X POST 'http://127.0.0.1:4848/invite?app=ntwrk' \
  -H 'Authorization: Bearer dev-admin' -H 'Content-Type: application/json' \
  --data '{"phone":"+12125550177"}'
```

Open `http://127.0.0.1:5101/settings`. Use the fictional number above and its `[otp dev]` code from the service log.
Then open `http://127.0.0.1:5101/join` and follow the fields below.
Run base and candidate separately with fresh owned database names; preserve both receipts.
The captured videos instead use the same synthetic E2E harness on dynamically allocated ports.

Use the normal synthetic E2E harness with isolated migrated PostgreSQL and fake OTP delivery.
Serve the exact base and candidate site builds with separate sessions and fictional 555-01xx invitations.
Open each site's `/settings`. Enter its fictional phone, request its fake code, and verify it.
Open `/join`. Enter Theo, age32, and neighborhood Bay Area.
On the candidate, choose San Francisco/Bay Area in the optional home-city selector.
Submit only in the isolated synthetic test environment. Expect the normal joined screen and Active settings.
Read the synthetic member and home-presence rows. The base stores NYC; the candidate stores SF.
Do not use real accounts, real numbers, live adapters, or production endpoints for this reproduction.

Full hosted CI, real agent-client acceptance and legitimate deployment remain separate work.
The browser videos prove the synthetic web flow, not deployed real-user signup or canonical Cloud history.

Two alternatives were rejected: rejecting out-of-market joins would prevent the
authorized personal-profile flow; removing every city filter would duplicate
processing when several runtimes serve one app.
