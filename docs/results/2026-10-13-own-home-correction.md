# Correct a signed-in member's home

Historical record. The [original revision](https://github.com/eliza-research/thenetwork/blob/1e2caa5028ade43ec7cb6a90de16466584f7ead0/docs/results/2026-10-13-own-home-correction.md) retains the commands and toolchain used for the observations. Updated command spellings here describe the current project where the same entrypoints exist.

The older join path could retain an explicit Bay Area neighborhood while recording
NYC as the member's physical home. The newer join fix prevents that for new joins,
but existing members had no supported correction path. Repeating join returns the
existing membership; profile submission does not update physical home.

`POST /api/me/home` now accepts only `homeCity` and optional `neighborhood` from the
current app's signed-in member. It uses the existing city normalizer, including
Bay Area → `sf`. The member, membership profile and home-presence row change in one
transaction. History, identities, age, messaging consent, grants and temporary
presence remain intact. Repeated identical corrections do not replace presence.

Settings exposes the current home and a small correction form. A change requiring
a different registered conversation runtime returns `409 home_runtime_conflict`
without changing any row or serialized state. There is no conversation migration,
new network, matching activation, backfill or administrative member selector.

## Observed validation

Base: `d4bc9c70521ba0bf6aec12930c197c7b31725aeb`. The same final E2E file was used
on the base and candidate. All identities and OTP were fictional; the actual
HTTP/router/backend/Postgres path ran on the existing owned local cluster.

```text
the former runtime 1.4.2, --conditions eliza-source
tests/e2e/platform.e2e.test.ts
-t "a signed-in member corrects a legacy home|home correction refuses a move"

Base (first case): expected HTTP 200, received 404 at the home-correction request.
Candidate: 2 pass, 0 fail, 41 expect() calls.
```

The cases inspect atomic rollback after an injected database failure, stable
identity/history/consent and OAuth access, one home-presence row, preserved trips,
unauthenticated/cross-app/cross-origin and foreign-identity rejection, recycled
phone refusal, unchanged NYC matching exclusion, and the two-runtime refusal.

The initial dependency-folder reuse lacked normal workspace links; both resulting
module-loading failures are preserved and excluded from product RED/GREEN.
Workspace links and existing dependency links were then created only in the two
owned checkouts. No dependency was installed or donor files changed.

Sites typecheck passed. Root `tsc --noEmit -p .` passed using existing TypeScript
5.9.3 through Node 24.18.0 with a 640 MiB V8 heap. This is a compiler result, not a
claim that the prescribed the former runtime full gate passed: that earlier invocation
was stopped when observed RSS exceeded the admitted 1 GiB cap. A 512 MiB Node
attempt also exhausted its heap. Earlier missing-observatory-dependency diagnostics
were identical (all 61 lines) on candidate and untouched base with the same Node
26.7.0/TypeScript 5.9.3 and dependency layout; the final candidate compiler pass
used the existing complete observatory dependency links.

All test databases and recorded processes were independently checked absent.
The existing Postgres owner process and shared cluster remained running. Total
elapsed validation was about 110 seconds of the admitted 600-second window;
every failed attempt is retained privately with the passing results.

## Remaining qualification

Independent UI review found a save/readback race and stale success after a failed
readback. The follow-up keeps the form busy through POST, GET and rendering,
rejects overlapping submissions, clears earlier success, and shows success only
when the returned home matches the submitted city and area. Independent source
review is clear. Sites typecheck passed again with Node 24.18.0, TypeScript 5.9.3
and a 256 MiB heap; no additional backend test run is attributed to this UI fix.

Desktop/mobile before-and-after settings captures and interaction review are
pending. Full hosted CI and production deployment have not run for this patch.
No real account, home, phone, provider, consent or deployment was changed.
