# App sites

Four public sites share one backend, one admin panel and one database
(plan: `docs/research/2026-10-08-platform-architecture.md`). Nothing here is deployed.
Local dev for the sites and the backend together: [docs/runbook-platform.md](../docs/runbook-platform.md).

**Caution: three founder decisions are not in the sites yet** (PRD 40, AGENTS.md):

- buddies.nyc is renamed friends.help (folder `sites/friends.help`, app id `friends`);
- people aged 13 and up may join every app (the slop, peon and buddies pages say 18+);
- compliance is a backlog, not a gate (PRD 40.7). The slop safety step before the phone step and the peon bias-audit note are still on the pages. Founders decide whether to keep them as text.

| App | Site | Dev port | Join |
|---|---|---|---|
| `ntwrk` | ntwrk.love | 5101 | Invite-only. `/join` explains the invite text and links to settings. |
| `slop` | slop.date | 5102 | Open, 18+. Safety notice first. Introductions not live yet. |
| `peon` | peon.biz | 5103 | Open, 18+. Waitlist. Bias-audit note. |
| `buddies` | buddies.nyc | 5104 | Open, 18+. |

## Layout

- `<site>/public/*.html`: one file per page (landing, join, settings, privacy, terms, SMS terms,
  guidelines, 404; slop also has `safety`). Each site has its own `styles.css`.
  ntwrk.love keeps its SMS terms in `terms.html#sms`.
- `shared/`: the only JavaScript. `join.ts`, `settings.ts` and `demo.ts` find elements by
  `data-*` attributes, so each site writes its own markup and copy. The comments at the top of
  each file list the attributes.
- `sites.ts`: the site list and the build (Bun's HTML bundler, `public/` to `dist/`).
- `PRODUCT.md`: who the sites are for and the design principles.

The landing pages work without JavaScript. Join and settings need it and say so in `<noscript>`.

## Commands

```bash
bun run sites:dev                 # all four sites, /api/* proxied to PLATFORM_API_ORIGIN (default http://127.0.0.1:8790)
bun run sites:dev slop            # one site
bun run sites/sites.ts            # build every site into sites/<domain>/dist
bun test sites                    # build checks and dev proxy checks (offline)
tsc -p sites/tsconfig.json        # typecheck (the root tsconfig does not include sites/)
```

The dev proxy sends `X-Forwarded-Host: <site domain>` so the backend picks the app. It removes
`Domain=` from cookies so they bind to `127.0.0.1`. Cookies do not separate by port, so the
backend must use a different cookie name per app (for example `sid_slop`) for local testing.
When the API is down, `/api/*` answers `502 {ok:false, error:"api_unreachable"}`, and the pages
show an inline error.

## API the pages call

Same origin only, per the platform PUBLIC API CONTRACT: `GET /api/app`, `GET /api/me`,
`POST /api/auth/otp/start`, `POST /api/auth/otp/verify`, `POST /api/auth/logout`, `POST /api/join`,
`GET /api/me/export`, `POST /api/me/stop`, `POST /api/me/delete {scope}`, `GET /api/demo`.

`POST /api/join` sends `consent.wording` as the exact text of the `[data-consent-wording]`
element, with whitespace collapsed. The SMS terms page quotes the same text, and a test checks
that they match.

peon.biz sends the "Looking for work" or "Hiring for a team" choice as the first item of
`interests` (`looking-for-work` or `hiring`), because the contract has no field for it.

`GET /api/demo` is optional, and the backend does not serve it yet (404), so the demo section stays hidden. The landing page shows the demo only when the answer has this shape:

```json
{ "synthetic": true, "title": "optional", "messages": [{ "from": "agent", "text": "..." }, { "from": "member", "name": "Robin", "text": "..." }] }
```

At most 10 messages show. Text goes in with `textContent`. Any other answer keeps the section hidden.

## Deploy

Each site has a `wrangler.toml` (assets only, `[build]` runs `bun run ../sites.ts <app>`).
Deploys need founder approval and go through `scripts/wrangler.sh`. `/api/*` on each domain must
be routed to the shared API before join and settings can work; see the route note in each file.
