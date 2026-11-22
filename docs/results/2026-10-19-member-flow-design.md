# Member flow simplification

Historical record. The [original revision](https://github.com/eliza-research/thenetwork/blob/1e2caa5028ade43ec7cb6a90de16466584f7ead0/docs/results/2026-10-19-member-flow-design.md) retains the commands and toolchain used for the observations. Updated command spellings here describe the current project where the same entrypoints exist.

Scope: the founder requested a review and simplification of every page except the homepages.
This request authorizes UI and copy changes for this local design review. PRD 28.3 and 40 cover onboarding.

## Changes

- Join pages retain phone, code, name, age and explicit messaging consent.
- The agent collects interests, location, biography and app preferences in conversation.
- Approved name and age can arrive in a URL fragment. The browser removes it immediately.
- A tab-scoped draft expires after 15 minutes. It survives external phone sign-in and clears on completion.
- Phone, code and consent never come from agent prefill. Browser autofill remains enabled.
- Mobile skills use the person's own prepared SMS without a duplicate web verification trip.
- Signed-in visitors reuse the existing session. No backend verification or consent gate was removed.
- Settings, number change, assistant permissions, support, error and completion states have shorter copy.
- Legal, safety and guidelines remain available. Their substantive policy text is unchanged.
- The studio exposes every secondary page and the important dynamic states, including error and deletion screens.
- Copy and layout edits save to source. The homepage files are unchanged.

## Before and after

Counts cover every HTML text node in the join source, including hidden states, rather than one visible screen.
Input counts include the phone, code and consent checkbox. They are not measures of conversion or usability.

| Site | Words before | Words after | Inputs before | Inputs after |
| --- | ---: | ---: | ---: | ---: |
| slop.date | 470 | 182 | 18 | 5 |
| peon.biz | 409 | 183 | 18 | 5 |
| friends.help | 356 | 181 | 20 | 5 |

Counts use `git show HEAD:sites/<domain>/public/join.html` and the changed file, strip tags, then split whitespace.
All copy and layout changes are hand-authored. There is no model-generated evaluation dataset.

## Browser evidence

Codex in-app browser, October 19, 2026. Local dev backend with Postgres and a console OTP provider.
A fictional 555-01xx number completed phone → code → prefilled Alex / 28 → consent → membership.
Submitting without consent failed. The fragment disappeared from the visible URL.
The studio saved changed copy to source and reloaded it. Shared OAuth copy also saved and reloaded.
Desktop and 390 px mobile views were inspected. These are local observations, not live-provider acceptance.

## Alternatives

1. Put the whole profile in a URL. Rejected: unnecessary sensitive data in a handoff and duplicate profile submission.
2. Add a server-side onboarding draft and combine OAuth with signup. Deferred: requires a new expiring-draft contract and wider auth changes.

This change uses the existing join and authorization APIs. It leaves the person in control of phone verification and consent.

## Limits

No production deployment, live SMS, real member signup or external assistant-client acceptance was performed.
No real LLM call was made. The isolated checkout has no model-provider keys. Model behavior was not measured.
The studio uses sample states; the separate platform runtime and e2e suite exercise real local endpoints.

## Validation

- `pnpm run typecheck`: pass, including the design server.
- `pnpm run sites:build`: all four sites build.
- `node --import tsx --env-file-if-exists=.env plugins/build.ts --check`: plugin snapshots match the skills.
- `pnpm exec vitest run --conditions eliza-source sites`: 81 pass, 0 fail.
- `pnpm run test:e2e`: 37 pass, 0 fail, Postgres-backed.
- `pnpm run test:integration`: 526 pass, 1 fail.
- The failing Observatory scorecard parity test reports completion 0.313 versus 0.5.
  The same failure reproduces on unchanged base `b9a6c20` in the primary checkout.
  It is outside this UI change.
- `git diff --check`: pass. Homepages have no diff.

The unchanged-backend suites use their existing fictional data and seeded clocks.
They do not prove live SMS, external OAuth redirects or external client behavior.

Studio write checks: cross-origin save returns 403; stale source returns 409; an unlisted screen state cannot inject HTML.
Layout controls were saved through the browser and confirmed in the shared stylesheet.

Full simulation: `pnpm run sim` passed **326/326 blocking gates**, with 14 tracked metrics off target (324.2 seconds).
This is the pinned offline simulation: no real model calls; simulated automatic review where configured.

## Founder copy pass

Removed join/settings page labels, verification helper paragraphs and phone-rate hints across all apps.
Phone screens show only the confirmation heading, field and action. Labels remain available to screen readers.
All secondary footers contain Privacy and Terms only. Each header uses its homepage logo and wordmark.
Assistant sign-in has the same minimal structure. The consent screen retains a short client name/host and requested permissions.
Validation: 111 site/OAuth checks pass; typecheck and four-site build pass.

## Founder page removal pass

Deleted support and guidelines pages across all four apps, plus the slop safety page.
Removed their navigation, skill URLs, app-info links and studio entries. Privacy and Terms remain.
The OAuth permission screen and approval endpoint are removed. A valid existing session or successful
phone verification now issues the requested scoped grant and returns to the assistant. Cancel remains
available before verification. Connected assistants still supports revocation. The existing PKCE,
redirect, app, eligibility, hold and ban checks remain in place.

The changed flow uses the same grant issuer for session and phone sign-in. Alternatives considered:
a hidden auto-submit permission form would retain an unnecessary browser round trip; merging the
permission button into verification would retain the step the founder asked to remove.

Validation: typecheck, plugin snapshot check and site build pass; 130 MCP/site checks, 37 end-to-end
checks and 153 security checks pass. The final OAuth run also verifies that the removed approval
endpoint returns 404 and cannot bypass phone verification. End-to-end coverage verifies that changing
the browser account does not transfer an already-issued code to the new account.
All 12 removed site paths and all four removed studio screens return 404 on the running local servers.
The browser shows the updated gallery at http://127.0.0.1:5190. No deployment or live sends.
Full integration rerun: 526 pass, one existing Observatory scorecard parity failure
(completion 0.313 versus 0.5), matching the unchanged-base reproduction above.

## Integration with current main

Kept the newer removal of standalone settings pages and updated the studio to omit that screen.
Kept account-bound server drafts and account-change resets. Fragment prefill now uses only the
current link; it does not retain profile fields in session storage. Kept the newer privacy and
agent-only account guidance. Updated the app-info output schema to remove the deleted safety URL.
The historical preview images and test counts above describe the earlier iteration.

Current validation: typecheck and all four builds pass; 152 focused site/MCP checks pass;
42 end-to-end checks pass, with three optional browser checks skipped.
