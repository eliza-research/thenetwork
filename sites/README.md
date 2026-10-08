# App sites

Four public sites share one backend, one admin panel and one database (PRD 40, AGENTS.md
"Platform decisions"). ntwrk.love is the home page for the whole concept and links to the apps:
"All of these apps are powered by The Network."
Local dev for the sites and the backend together: [docs/runbook-platform.md](../docs/runbook-platform.md).

| App | Site | Dev port | Join |
|---|---|---|---|
| `ntwrk` | ntwrk.love | 5101 | Invite-only. `/join` explains the invite text and links to settings. |
| `slop` | slop.date | 5102 | Open. 13+ join; matching and photos 18+ only. The safety notice is information, not a step. |
| `peon` | peon.biz | 5103 | Open waitlist. 13+ join; matching 18+ only. |
| `friends` | friends.help | 5104 | Open. 13+ join; matching and group plans 18+ only. |

Ages on the pages equal the platform registry (`packages/platform/src/apps.ts` `minJoinAge`,
`minMatchAge`); a test checks it. Members aged 13 to 17 are never matched or introduced.

## Layout

- `<site>/public/*.html`: one file per page (landing, join, settings, privacy, terms, SMS terms,
  guidelines, support, 404; slop also has `safety`). Each site has its own `styles.css`.
  ntwrk.love keeps its SMS terms in `terms.html#sms`.
- `<site>/static/`: files copied into `dist/` as they are (`robots.txt`; add `_redirects` or
  `.well-known/*` files here).
- `skills/<name>/SKILL.md`: the Agent Skills file per site (`ntwrk-love`, `slop-date`, `peon-biz`,
  `friends-help`). The build serves it at `/SKILL.md` and `/.well-known/agent-skills/<name>/SKILL.md`
  with `/.well-known/agent-skills/index.json` (sha256 digests). ntwrk.love's index lists all four.
- `skills.config.ts`: the one backend origin and the MCP URL template (`BACKEND_ORIGIN`, `MCP_URL`;
  defaults `https://api.ntwrk.love` and `https://{domain}/mcp`). Each site is its own MCP endpoint
  (the router forwards `/mcp` with the site's signed host); the backend origin's `/mcp` names no app. The build fills `{{BACKEND_ORIGIN}}`,
  `{{MCP_URL}}` and `{{TURNSTILE_SITE_KEY}}` in pages and skills, and fails on a leftover `{{`.
- `shared/`: the only JavaScript. `join.ts`, `settings.ts`, `auth.ts`, `turnstile.ts` and `demo.ts`
  find elements by `data-*` attributes, so each site writes its own markup and copy.
- `sites.ts`: the site list and the build (Bun's HTML bundler, then `static/`, `_headers` and the
  skill files into `dist/`).
- `PRODUCT.md`: who the sites are for and the design principles.

The landing pages are agent-first (founder decision 10): the name, one line, "Copy this into your
agent." with the prompt `Read https://<domain>/SKILL.md and follow it to sign me up for <app>.`, a Copy
button (`shared/agent.ts`) and "Open in <agent>" links (ChatGPT, Claude, Grok, Perplexity; Muse waits
for its link). No safety notice or explanations on them; legal pages are in the footer. They work
without JavaScript (the prompt stays selectable). Join and settings need it and say so in `<noscript>`.

## Commands

```bash
bun run sites:dev                 # all four sites; backend paths proxied to PLATFORM_API_ORIGIN (default http://127.0.0.1:8790)
bun run sites:dev slop            # one site
bun run sites/sites.ts            # build every site into sites/<domain>/dist
DEPLOY_TARGET=production TURNSTILE_SITE_KEY=... bun run sites/sites.ts   # production build: refuses draft legal text
bun test sites deploy scripts     # build, copy, skills, contract, router and guard checks (offline)
bunx tsc --noEmit -p sites/tsconfig.json   # typecheck (the root tsconfig does not include sites/)
```

The dev proxy forwards the same paths as the production router (`/api/*`, `/mcp`, `/oauth/*`,
`/.well-known/oauth-*`). It sends `X-Forwarded-Host: <site domain>` so the dev backend picks the app,
and, with `PLATFORM_PROXY_SECRET` set, the router's signed headers. It removes `Domain=` from
cookies so they bind to `127.0.0.1`. When the API is down, those paths answer
`502 {ok:false, error:"api_unreachable"}`, and the pages show an inline error.

## API the pages call

Same origin only: `GET /api/app`, `GET /api/me`, `POST /api/auth/otp/start {phone, turnstileToken?}`,
`POST /api/auth/otp/verify`, `POST /api/auth/logout`, `POST /api/join`, `GET /api/me/export`,
`POST /api/me/stop`, `POST /api/me/delete {scope}`, `GET /api/demo`. Every POST sends
`content-type: application/json` and a JSON body (`{}` when it has no fields); the API refuses any
other POST with 415. `sites/test/contract.test.ts` runs the client against `createPublicApi`.

`POST /api/join` sends `consent.wording` as the exact text of the `[data-consent-wording]`
element. A test checks that it equals the platform's canonical text for the app.

peon.biz sends the "Looking for work" or "Hiring for a team" choice as the first item of
`interests` (`looking-for-work` or `hiring`), because the contract has no field for it.

`GET /api/demo` is optional (`shared/demo.ts`): no landing page shows it since the agent-first pages.

## Turnstile

The phone step on join and settings mounts Cloudflare Turnstile when the build has
`TURNSTILE_SITE_KEY` (a public site key). The client sends the token as `turnstileToken`. Without a
key (local dev) there is no widget and no token. The CSP allows `https://challenges.cloudflare.com`
for scripts and frames only.

## Deploy

Each site is a Cloudflare Pages project (founder decision 8): `ntwrk-love`, `slop-date`, `peon-biz`,
`friends-help` (`<site>/wrangler.toml`, `pages_build_output_dir = "./dist"`). The build writes the
router `../deploy/router.ts` into `dist/_worker.js` (Pages advanced mode) and `dist/_routes.json`, so
only `/api`, `/api/*`, `/mcp`, `/mcp/*`, `/oauth/*` and `/.well-known/oauth-*` run it. The router
forwards those paths to `BACKEND_ORIGIN` with signed `x-network-proxy-*` headers (secret
`PLATFORM_PROXY_SECRET`, set once per project) and every other path is a static file. CI deploys
from `main` behind the `production` GitHub environment (`.github/workflows/deploy-sites.yml`,
`wrangler pages deploy <dist> --project-name <name> --branch main`); there are no PR previews. By
hand, deploys need founder approval and go through `scripts/wrangler.sh` with `NTWRK_ALLOW_DEPLOY=1`.
All four projects are in account `50ad2052bbc6ca528d6993a689b419a4` (`CLOUDFLARE_ACCOUNT_ID` changes
it). Each answers on `<project>.pages.dev`, which the backend accepts as that app's host; slop.date
and friends.help DNS (another account) point there. Details: [docs/deploy.md](../docs/deploy.md).
