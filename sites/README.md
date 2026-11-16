# App sites

For isolated staging builds, set `PLATFORM_ENV=staging`, an explicit staging `BACKEND_ORIGIN`,
and `STAGING_SITE_ORIGINS` as JSON mapping all four app IDs to distinct HTTPS origins.
For example: `{"ntwrk":"https://hub-stage.example.test","slop":"https://slop-stage.example.test","peon":"https://peon-stage.example.test","friends":"https://friends-stage.example.test"}`.
The full map keeps hub navigation and published skills from linking back to production.
Leave `MCP_URL` unset or at its default template; each staging MCP URL is its configured origin plus `/mcp`.
Do not set `DEPLOY_TARGET=production` with staging origins. Canonical app names, source paths,
Pages project identities and official plugin snapshots stay unchanged. A staging build does not deploy anything.

Four public sites share one backend, one admin panel and one database (PRD 40, AGENTS.md
"Platform decisions"). Each site is its own brand (founder direction, 2026-10-10): no app site names The Network or another
app, and the ntwrk.party landing page names no app. The no-keyword text entry asks a person what they want (friends, dating, work).
Local dev for the sites and the backend together: [docs/runbook-platform.md](../docs/runbook-platform.md).

The specs own what the sites show and do. Read them before you change a page:
[brand identity](../spec/brandIdentity.md), [landing entry](../spec/landingEntry.md),
[site pages and retired paths](../spec/sitePages.md), [browser join on peon.biz](../spec/browserJoin.md),
and [agent entry](../spec/agentEntry.md). The product stories are F37–F42 and F51 in
[spec/product/stories.md](../spec/product/stories.md). The rebuild uses one design system for all four
brands: the tokens are in `packages/design-system` and the React components are in `packages/ui`.

| App | Site | Dev port | Join |
|---|---|---|---|
| `ntwrk` | ntwrk.party | 5101 | Invite-only. Join through the agent skill with an invitation, or by text. No `/join` page. |
| `slop` | slop.date | 5102 | Open. 13+ join; matching and photos 18+ only. Join through the agent skill or by text. No `/join` page. |
| `peon` | peon.biz | 5103 | Open. 13+ join; matching 18+ only. The only site with a browser join page (`/join`). |
| `friends` | friends.help | 5104 | Open. 13+ join; matching and group plans 18+ only. Join through the agent skill or by text. No `/join` page. |

Ages on the pages equal the platform registry (`packages/platform/src/apps.ts` `minJoinAge`,
`minMatchAge`); a test checks it. Members aged 13 to 17 are never matched or introduced.

## Layout

- The pages: `apps/site` prerenders each page of each site from the shared components in `packages/ui`
  with the brand record of the site. Each site has the landing page (`index.html`), `privacy.html`,
  `terms.html` and `404.html`. Only peon.biz also has `join.html`. There is no guidelines, support or
  safety page. No site has its own HTML, CSS or logo file: the favicon is the brand mark (`BrandMark`)
  in the brand tokens of `packages/design-system`.
  The SMS terms are a section of the terms page (`terms.html#sms`). The footer of each page links Privacy, then Terms.
  There is no standalone account portal, settings page or Sign in link.
- Retired paths (spec/sitePages.md): a settings path answers 404 on every site. On a site without a
  browser join, a GET or HEAD to a join path answers 302 to the landing page and another method answers 405.
  Each retired answer is `no-store` and never reaches the backend. An unknown path shows `404.html`.
  The router (`deploy/router.ts`) gets each of these answers from the generated `routeFor` and `answerFor`
  (`packages/core/src/generated/sitePages.ts`), so the edge and the spec cannot disagree.
- `<site>/static/`: files copied into `dist/` as they are (`robots.txt`; add `_redirects` or
  `.well-known/*` files here).
- `skills/<name>/SKILL.md`: the Agent Skills file per site (`ntwrk-party`, `slop-date`, `peon-biz`,
  `friends-help`). The build serves it at `/SKILL.md` and `/.well-known/agent-skills/<name>/SKILL.md`
  with `/.well-known/agent-skills/index.json` (sha256 digests). An app site lists and serves only its own
  skill; ntwrk.party's index lists all four. Skill files are `text/plain; charset=utf-8`, readable from any origin, cached 300 s.
- `skills.config.ts`: the one backend origin and the MCP URL template (`BACKEND_ORIGIN`, `MCP_URL`;
  defaults `https://api.ntwrk.party` and `https://{domain}/mcp`). Each site is its own MCP endpoint
  (the router forwards `/mcp` with the site's signed host); the backend origin's `/mcp` names no app. The build fills `{{BACKEND_ORIGIN}}`,
  `{{MCP_URL}}`, `{{TEXT_LINE}}`, `{{MESSAGES_HREF}}` and `{{TURNSTILE_SITE_KEY}}` in pages and skills, and fails on a leftover `{{`.
- The pages use the shared React components and the typed client in `packages/ui/src/api`, and only
  the brand record (name, logo, accent and text) differs between the sites (spec/brandIdentity.md).
- `sites.ts`: the site list and the build (the `apps/site` client and prerender, the favicon, then
  `static/`, `_headers` and the skill files into `dist/`).
- `PRODUCT.md`: who the sites are for and the design principles.

The landing pages are agent-first (founder decision 10). [spec/landingEntry.md](../spec/landingEntry.md)
owns them. In this order, a landing page shows the brand mark, the headline, the prompt, the Copy button,
the agent row, the Messages entry, the status line, and the Privacy and Terms links, in fewer than 45 words.
The prompt is `Read https://<domain>/SKILL.md?version=<version> and follow it.`; the slop.date prompt
has no version query. The Copy button shows only when the page script runs. The generated `agentOrder`
(spec/landingEntry.md) is the agent list (ChatGPT, Claude, Grok, Muse, Gemini, Perplexity, Cursor, OpenClaw,
Hermes), and the `AgentRow` component draws it. The row shows logos only; the name is the accessible name and the hover label.
A tile with a link opens the agent; Muse has no link, copies the prompt and says where to paste it, and
shows only with the page script. `packages/ui/src/hooks/useLanding.ts` tells a phone from a desktop: Cursor shows on a
desktop only. The Messages entry ("Use in iMessage") is not in the agent row. It opens Messages to the shared line
(`TEXT_LINE`, default in `skills.config.ts`) with the body `join <keyword>`. On a phone or a Mac the page
waits 1.5 s for Messages and then shows the number and the message; on another desktop it shows them at once.
The page is black and white with one accent per site (spec/brandIdentity.md); the components in `packages/ui` have the layout, and the font (Host Grotesk, OFL)
is `apps/site/public/fonts/`. The agent logos are in `packages/ui/src/brand/agentLogos.ts` (from
@lobehub/icons-static-svg, MIT; the Messages logo from simple-icons). Link behaviour: [docs/research/2026-10-10-agent-deep-links.md](../docs/research/2026-10-10-agent-deep-links.md).
The pages work without JavaScript (links open the agent; the prompt stays selectable). The peon.biz
join page needs it and says so in `<noscript>`.

## Commands

```bash
bun run sites:dev                 # all four sites; backend paths proxied to PLATFORM_API_ORIGIN (default http://127.0.0.1:8790)
bun run sites:dev slop            # one site
bun run sites/sites.ts            # build every site into sites/<domain>/dist
DEPLOY_TARGET=production TURNSTILE_SITE_KEY=... bun run sites/sites.ts   # production build: refuses draft legal text
bunx tsc --noEmit -p sites/tsconfig.json   # typecheck (the root tsconfig does not include sites/)
```

The dev proxy forwards the same paths as the production router (`/api/*`, `/mcp`, `/oauth/*`,
`/.well-known/oauth-*`). It sends `X-Forwarded-Host: <site domain>` so the dev backend picks the app,
and, with `PLATFORM_PROXY_SECRET` set, the router's signed headers. It removes `Domain=` from
cookies so they bind to `127.0.0.1`. When the API is down, those paths answer
`502 {ok:false, error:"api_unreachable"}`, and the pages show an inline error.

## API the pages call

Only the peon.biz join page calls the API, same origin only: `GET /api/app`, `GET /api/me`,
`GET /api/auth/mode`, `POST /api/auth/cloud/start`, `POST /api/auth/otp/start {phone, turnstileToken?}`,
`POST /api/auth/otp/verify` and `POST /api/join`. The landing pages call no API.
No page has a control for the member endpoints (`POST /api/auth/logout`, `GET /api/me/export`,
`POST /api/me/stop`, `POST /api/me/delete {scope}` and the others). Every POST from the typed client
(`call` in `packages/ui/src/api/client.ts`) sends `content-type: application/json` and a JSON body
(`{}` when it has no fields); the API refuses any other POST with 415. `sites/test/contract.test.ts`
runs the client, with the join calls and the member endpoints, against `createPublicApi`.

`POST /api/join` sends `consent.wording` as the exact text of the `[data-consent-wording]`
element. A test checks that it equals the platform's canonical text for the app.

Members continue in their agent or text conversation. STOP and leave remain text commands.
Export and deletion requests use help@ntwrk.party. The authenticated backend APIs remain available
for service integrations; the sites do not expose a member dashboard.

peon.biz sends the "Looking for work" or "Hiring for a team" choice as the first item of
`interests` (`looking-for-work` or `hiring`), because the contract has no field for it.

## Turnstile

The phone step on the peon.biz join page mounts Cloudflare Turnstile when the build has
`TURNSTILE_SITE_KEY` (a public site key) and the sign-in mode uses text codes. The client sends the
token as `turnstileToken`, and each server answer uses up the token (spec/browserJoin.md). Without a
key (local dev) there is no widget and no token. The CSP allows `https://challenges.cloudflare.com`
for scripts and frames only.

## Deploy

Each site is a Cloudflare Pages project (founder decision 8): `ntwrk-party`, `slop-date`, `peon-biz`,
`friends-help` (`<site>/wrangler.toml`, `pages_build_output_dir = "./dist"`). The build writes the
router `../deploy/router.ts` into `dist/_worker.js` (Pages advanced mode) and `dist/_routes.json`, so
only the retired settings and join paths and `/api`, `/api/*`, `/mcp`, `/mcp/*`, `/oauth/*` and
`/.well-known/oauth-*` run it. The router answers the retired paths itself, forwards the backend paths to `BACKEND_ORIGIN` with signed `x-network-proxy-*` headers (secret
`PLATFORM_PROXY_SECRET`, set once per project) and every other path is a static file. CI deploys
from `main` behind the `production` GitHub environment (`.github/workflows/deploy-sites.yml`,
`wrangler pages deploy <dist> --project-name <name> --branch main`); there are no PR previews. By
hand, deploys need founder approval and go through `scripts/wrangler.sh` with `NTWRK_ALLOW_DEPLOY=1`.
All four projects are in the ntwrk.party Cloudflare account (its id is `CLOUDFLARE_ACCOUNT_ID`, from
the environment or the CI variable). Each answers on `<project>.pages.dev`, which the backend accepts as that app's host; slop.date
and friends.help DNS (another account) point there. Details: [docs/deploy.md](../docs/deploy.md).

### Authenticated Join drafts

The connector tool `prepare_signup` saves a Join draft on ntwrk.party and friends.help only
(spec/connectorTools.md). These two sites have no Join page now, so no page claims a draft. The rest
of this section describes the claim rules for a Join page on those sites. Network and Friends may claim an approved assistant draft after normal phone sign-in through a same-origin `POST /oauth/signup-draft` (the existing signed OAuth router). Only first name and home city fill existing editable controls. The draft is optional and recoverable until completion or expiry; missing, expired or revoked drafts leave the ordinary form usable. Human edits win over delayed responses. An opaque marker returned by the normal authenticated account API binds form state to the account; authentication transitions clear prior values and reject old in-flight responses. No browser storage caches these facts across accounts. Updated forms also send their reviewed account marker with Join; the server rejects a changed account before any age, person, membership or consent write. The page clears the old fields and loads the current account for review without another phone code. Older clients may omit the marker; it never authorizes a request. Age and the app text-consent checkbox remain for the person. No personal fields or credentials are carried in a URL. Slop and Peon do not use this path.
