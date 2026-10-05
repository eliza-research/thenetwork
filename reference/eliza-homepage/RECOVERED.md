# Recovered: elizaOS `packages/homepage`

Read-only reference copy of the eliza.app public homepage / onboarding source module. It is not built, tested or deployed from this repo.

| Field | Value |
|---|---|
| Source repo | github.com/elizaOS/eliza (local clone `/Users/shawwalters/v3`, partial clone `blob:none`) |
| Source path | `packages/homepage/` |
| Source commit | `79a3b55c2d5652362f4218178508e6a3d61a18a3` ("fix(deps): align React renderers and group coupled updates", Shaw, 2026-09-23T22:41:33-07:00) |
| Why this commit | It is the newest commit in any ref that touches `packages/homepage`. Its `packages/homepage` tree matches the newest refs that still contain the package (for example `origin/dependabot/bun/youtube-dl-exec-3.1.15`, 2026-09-24T06:08Z). |
| Deleted in | `fa9d46be538d` ("refactor bigtime", Shaw, 2026-09-23 17:08 -0700) on the mainline. The parent `fa9d46be538d^` has the same package, apart from a `CLAUDE.md` that is 177 lines shorter and five changed `package.json` lines. |
| Package name / version | `@elizaos/homepage-source` 2.0.0-beta.2 (private) |
| Recovered | 2026-10-05 via `git archive 79a3b55c2d56 packages/homepage` |
| License | MIT. Copyright (c) 2026 Shaw Walters and elizaOS Contributors (root `LICENSE` of the monorepo at that commit; the package has no license file of its own). |

## What was included and excluded

- All 214 tracked files (about 12 MB, mostly `public/brand` images and Playwright screenshot baselines). No file was larger than 2 MB, so nothing was dropped for size.
- The tree contained no `node_modules`, `dist` or other build output. `src/generated/release-data.ts` was not tracked, so it is absent.
- The package does not build here. It depends on `@elizaos/ui` and `@elizaos/shared` workspace sources (`src/index.css` imports `../../ui/src/styles/*`), and its scripts call `../app-core/scripts/*`.

## Where this code lives now

When the package was deleted, the homepage had already been changed into an embedded source module for `packages/app`, which is the one Cloudflare Pages artifact for `eliza.app` and `cloud.eliza.app`. Auth and Cloud pages live in `packages/ui/src/cloud/**` in current `develop`/`shaw/mega-refactor`. That includes `public-pages/pages/login/steward-login-section.tsx` (phone OTP, email magic link, passkey and OAuth), `join/GetStartedPage.tsx` and `admin/AdminGate.tsx`.
