# Skills, plugins and deploys for the four sites

> **Superseded names (2026-10-08 cleanup note).** This is a dated research record. Since it was written: buddies.nyc was renamed friends.help (AppId `friends`, `friendsPack`); ntwrk.club belongs to someone else and is not used (ntwrk.love is the home page); `packages/worlds` moved to `packages/sim/src/apps`; the prototypes were deleted or promoted (`packages/blooio`). Current decisions: AGENTS.md "Platform decisions" and docs/mvp-plan.md.

Status: research and design, 2026-10-08 (UTC). Nothing here is built or deployed. A Claude agent wrote it from the sources listed in section 0 and from reading the repos. Items marked **verify** could not be confirmed on a primary page.

Scope: four sites on one shared backend.

| App id (code) | Site | What it is |
|---|---|---|
| `ntwrk` | ntwrk.love | The Network, home of all apps. "All of these apps are powered by The Network." |
| `slop` | slop.date | Dating |
| `peon` | peon.biz | Hiring |
| `buddies` (rename pending) | friends.help (was buddies.nyc) | Friends in New York City |

Founder rules this design assumes:

- One text line (Blooio iMessage) for all apps. A person joins by putting a keyword in the first message.
- People can also join on the web with a phone OTP.
- Anyone 13 or older may join. Matching is 18+ only, and minors are never matched.
- Each site goes to Cloudflare with CI/CD.
- Each site publishes a SKILL.md that points every app at the same backend. The skill explains what a person signs up for, what each app is for, and what an agent may and may not do for them.

---

## 0. Sources (all read 2026-10-08 UTC)

| # | Source |
|---|---|
| S1 | OpenAI, Build plugins: https://developers.openai.com/plugins/build/plugins |
| S2 | OpenAI, Build skills: https://developers.openai.com/plugins/build/skills |
| S3 | OpenAI, Build an MCP server: https://developers.openai.com/plugins/build/mcp-server |
| S4 | OpenAI, Authenticate users: https://developers.openai.com/plugins/build/auth |
| S5 | OpenAI, Submit plugins: https://developers.openai.com/plugins/deploy/submission |
| S6 | OpenAI, Plugin guidelines: https://developers.openai.com/plugins/plugin-guidelines |
| S7 | Agent Skills specification: https://agentskills.io/specification |
| S8 | Anthropic, Agent Skills overview: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview |
| S9 | Claude Code, plugin manifest reference: https://code.claude.com/docs/en/plugins-reference |
| S10 | Cloudflare Agent Skills Discovery RFC v0.2.0: https://github.com/cloudflare/agent-skills-discovery-rfc |
| S11 | MCP spec 2026-07-28, Authorization: https://modelcontextprotocol.io/specification/latest/basic/authorization |
| S12 | MCP spec 2026-07-28, Streamable HTTP: https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http |
| S13 | Cloudflare Pages, direct upload with CI: https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/ |
| S14 | Cloudflare Pages overview: https://developers.cloudflare.com/pages/ |
| S15 | Cloudflare Pages Functions routing: https://developers.cloudflare.com/pages/functions/routing/ |
| S16 | Cloudflare Pages headers: https://developers.cloudflare.com/pages/configuration/headers/ |
| S17 | Cloudflare Pages custom domains: https://developers.cloudflare.com/pages/configuration/custom-domains/ |
| S18 | Cloudflare, migrate from Pages to Workers: https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/ |
| S19 | Cloudflare Workers static assets, Worker script routing: https://developers.cloudflare.com/workers/static-assets/routing/worker-script/ |
| S20 | Cloudflare Workers preview URLs: https://developers.cloudflare.com/workers/configuration/previews/ |
| S21 | Cloudflare Workers custom domains: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/ |
| S22 | Wrangler pages commands: https://developers.cloudflare.com/workers/wrangler/commands/pages/ |
| S23 | cloudflare/wrangler-action releases: https://github.com/cloudflare/wrangler-action/releases |

Repo files read:

- `sites/` (README, `sites.ts`, every `wrangler.toml`, slop.date pages)
- `scripts/wrangler.sh`
- `.github/workflows/ci.yml`
- `packages/platform` (README, `src/apps.ts`, `src/api.ts`)
- `prototypes/connector-mcp` (in the thenetwork-audit worktree) (wrangler.toml, SKILL.md, CHATGPT-APPS-SDK.md)
- `docs/research/2026-10-08-platform-architecture.md` (in the thenetwork-audit worktree)

Live checks, run 2026-10-08 03:11 UTC:

- `https://ntwrk.love/` answers 200 from the Worker.
- `/api/app`, `/SKILL.md` and `/.well-known/agent-skills/index.json` on ntwrk.love answer 404.
- slop.date, peon.biz and friends.help have no HTTPS answer.
- `mcp.ntwrk.love` has no answer.

---

## 1. Findings that change the plan

1. **slop.date cannot be in a public OpenAI plugin today.** OpenAI's plugin guidelines (S6) say plugins must be "suitable for general audiences, including users aged 13–17". They also say "mature (18+) experiences will arrive once appropriate age verification and controls are in place". An 18+ dating service fails both tests. The existing connector design already keeps romance out of every connector (`CHATGPT-APPS-SDK.md`, teen-safe profile).
   - **Recommendation:** the public ChatGPT/Codex plugin covers ntwrk.love, peon.biz and friends.help, and its MCP never returns slop.
   - slop.date still publishes its SKILL.md on its own site for agents that read the web, such as Claude Code. That skill hands the person a link and does nothing else.
   - **Open question:** peon.biz (18+ matching) and friends.help (meeting strangers) are fine for a general audience only at the signup-information level. The founder should ask OpenAI before submitting.
2. **The age rule in the code does not match the founder's rule.** `packages/platform/src/apps.ts` sets `minJoinAge: 18` for slop, peon and buddies. `sites/README.md` also says "Open, 18+". The founder's rule is 13+ join and 18+ matching for all apps.
   - Every SKILL.md must read its ages from one source of truth: `app_info` from the backend, plus a build-time test against `APPS`. Otherwise the skill and the server will drift.
   - The examples below follow the founder's rule. They also say plainly that the dating, hiring and friends products never match anyone under 18.
   - The architecture doc (section 2.6) recommends 18+ to join slop, peon and buddies. Joining a dating app at 13 gives a minor nothing to use, so the founder should confirm the rule for slop.date before launch.
3. **slop.date and friends.help are probably in a different Cloudflare account.**
   - ntwrk.love and peon.biz use the nameserver pair `karl`/`stella.ns.cloudflare.com`.
   - slop.date and friends.help use `jessica`/`matt.ns.cloudflare.com`.
   - Cloudflare normally gives one nameserver pair to every zone in an account (**verify** in the dashboard).
   - An apex custom domain on Pages must be a zone in the same account as the Pages project (S17), and a Workers custom domain needs a zone you own (S21).
   - Fix: either move both zones into the ntwrk.love account, or create those two projects in the other account with their own token and account id. Every `wrangler.toml` today hard-codes the ntwrk.love account.
4. **The rename to friends.help is not in the code.** `APPS.buddies.domain` is `buddies.nyc`, along with the host map, `sites.ts`, the `sites/buddies.nyc/` folder, the brand texts and `help@buddies.nyc`. Deploying friends.help needs the rename first, or the backend's Host map will not recognize `friends.help` and every `/api/*` call fails.
5. **Cloudflare now says "Start new projects with Workers"** (S14). It says Workers "supports most Pages use cases and offers a broader feature set". ntwrk.love is already a Worker with static assets. See section 4.1 for the recommendation.
6. **The site build does not ship non-HTML files.** `sites.ts` builds only `*.html` entry points into `dist/` and deletes `dist/` first. `SKILL.md`, `_headers`, `_redirects`, `.well-known/*`, `robots.txt` and `llms.txt` would never reach the deploy. A copy step is required (section 4.4).
7. **The client IP is probably lost through the proxy, which breaks OTP rate limits.**
   - `api.ts` reads `CF-Connecting-IP` to enforce 10 OTP sends per IP per hour.
   - When a Pages Function or Worker calls an origin in another zone with `fetch`, the origin sees a Cloudflare egress address, not the visitor's (**verify** with a test request).
   - If so, every visitor shares one IP bucket, so either the limit blocks everyone or it limits nobody.
   - Fix: the proxy sends the visitor IP in a header signed with a shared secret, and the backend's `ipOf` trusts that header only when the secret matches (section 4.3).
8. **`trustForwardedHost` is a spoofing risk unless the proxy authenticates itself.**
   - If the API origin is public and trusts `X-Forwarded-Host`, anyone can call it directly and claim to be any app.
   - The fix is the same secret header, or a service binding, which never touches the public internet.
9. **OpenAI review needs a login that does not use SMS codes.** S5 says the reviewer account "must work without MFA approval, email or SMS codes, magic links". Our only login is phone OTP.
   - We need a reviewer-only sign-in on the OAuth page for one sandbox member in staging or production, such as a long fixed passcode stored as a secret, with no access to real members.
   - Without it, submission fails.
10. **OpenAI needs four HTTPS listing URLs** (S5): `websiteURL`, `supportURL`, `privacyPolicyURL` and `termsOfServiceURL`. No site has a support page; there is only a `help@` mailto. Add `/support` to ntwrk.love.
11. **One line for all apps is a change from the architecture plan**, which put one line per app (section 4.1). With one shared line:
    - Apple's per-line limits are shared by all apps.
    - The contact card cannot carry an app's name.
    - The first-message keyword must route the app.
    - STOP needs per-app wording ("STOP SLOP" versus "STOP").

    The skills below say what the person texts. `packages/platform` has no keyword table yet; `app_info` must return it.

---

## 2. SKILL.md format and where it lives

### 2.1 One file that satisfies all three consumers

| Rule | Agent Skills spec (S7) | Anthropic (S8) | OpenAI (S1, S2, S5) |
|---|---|---|---|
| File | `SKILL.md`: YAML frontmatter, then Markdown | same | same, at `skills/<name>/SKILL.md` in a plugin |
| `name` | Required. 1-64 characters, `a-z 0-9 -` only. No leading or trailing hyphen, no `--`. **Must match the parent directory name.** | Max 64, lowercase letters, digits and hyphens. No XML tags. **Must not contain "anthropic" or "claude".** | Required. "valid `name`". The example is kebab-case. |
| `description` | Required. 1-1024 characters. Says what the skill does and when to use it. | Max 1024, non-empty, **no XML tags** | Required. "Determines when the model considers the skill." Procedure goes in the body. |
| Optional | `license`, `compatibility` (≤500), `metadata` (string→string map), `allowed-tools` (experimental) | name and description required | Only name and description documented |
| Body | Keep under 500 lines, about 5k tokens or less | Level 2 loaded on trigger, under 5k tokens | "Keep SKILL.md concise". The submission limit is 256 KiB per SKILL.md. |
| Supporting files | `scripts/`, `references/`, `assets/`, one level deep, relative paths | same | `references/`, `assets/`, `scripts/`, and `agents/openai.yaml` for MCP dependencies |

So every skill follows these rules:

- The name is kebab-case and matches its folder: `ntwrk-love`, `slop-date`, `peon-biz`, `friends-help`. A dot is not allowed, so it is `slop-date`, not `slop.date`.
- The description is 1024 characters or fewer, with no `<` or `>` characters.
- No name contains "claude" or "anthropic".
- Optional fields are `license`, `compatibility` and `metadata` only. Leave out `allowed-tools`, because there are no local tools.
- The body is under 200 lines.
- **No relative file references.** A skill served as a single `skill-md` file (S10) cannot carry a `references/` folder, so link to the site's pages with absolute URLs.

### 2.2 Where each copy lives

| Copy | Path | For | Notes |
|---|---|---|---|
| Discovery index | `https://<domain>/.well-known/agent-skills/index.json` | Agents that discover skills on websites (S10, Cloudflare RFC draft v0.2.0) | `$schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json"`. Each entry has `name`, `type: "skill-md"`, `description` (same as the frontmatter), `url`, `digest: "sha256:<64 hex>"` of the exact bytes served. Serve as `application/json`. Support GET and HEAD. 404 for missing files. Add CORS and `Cache-Control`. The RFC is a draft and adoption is early, but it costs little. |
| Canonical file | `https://<domain>/.well-known/agent-skills/<name>/SKILL.md` | The index `url` | `text/markdown; charset=utf-8` |
| Convenience copy | `https://<domain>/SKILL.md` | People and agents told "read slop.date/SKILL.md" | Byte-identical to the canonical file. A test checks this. |
| Hub | ntwrk.love lists **all four** skills in its index | "All of these apps are powered by The Network" | Each of the other sites lists only its own skill. |
| OpenAI plugin | `plugins/the-network/skills/<name>/SKILL.md` | ChatGPT and Codex | **A snapshot**: imported at submission and "ChatGPT and Codex don't fetch them from your server at runtime" (S2). Each change needs a new plugin version. slop-date is left out (finding 1). |
| Claude plugin | same folder, `.claude-plugin/plugin.json` + `.mcp.json` | Claude Code plugin marketplaces | S9. claude.ai custom skills are zip uploads per user (S8). |
| Repo source of truth | `sites/skills/<name>/SKILL.md`, one file per skill | Build input | The site build and the plugin package both copy from here. Never edit a copy. |

On Claude API surfaces, skills run with **no network access** (S8). A skill there can only explain the app and hand over a link. That is all these skills ask, so they still work.

### 2.3 Placeholders

Two values are not decided yet. Sources write them as placeholders, and the build fills them in from CI variables. A test fails the build if `{{` remains in `dist/`.

- `{{NETWORK_BACKEND}}`: the shared backend base. Proposed: `https://api.ntwrk.love`. The sites reach it through their own `/api/*`.
- `{{NETWORK_MCP_URL}}`: proposed `https://mcp.ntwrk.love/mcp`. The connector design says never to change this origin after it is published.
- `{{NETWORK_LINE}}`: the one iMessage number.

### 2.4 slop.date (first)

`sites/skills/slop-date/SKILL.md`:

```markdown
---
name: slop-date
description: Explains slop.date, a dating service by text message that is powered by The Network, and helps a person sign themselves up. Use when someone asks what slop.date is, whether it is safe or right for them, how to join, what happens to their data, or how to stop or delete their account. Gives the person a link and a text keyword so they can sign up themselves. Never signs anyone up, never handles verification codes, and never searches, browses or contacts other people.
license: Proprietary. Terms at https://slop.date/terms
compatibility: Works without network access. Optional live status uses The Network MCP server at {{NETWORK_MCP_URL}}, which is not available in ChatGPT.
metadata:
  app: slop
  site: https://slop.date
  backend: "{{NETWORK_BACKEND}}"
  operator: Eliza Research Corporation
  version: "1.0.0"
---

# slop.date

slop.date is a dating service that runs by text message. You text one number. A matchmaker
agent learns what you are looking for and, now and then, suggests one person. Nobody is
introduced unless both people say yes. It is one of several apps powered by The Network
(https://ntwrk.love). They all share one backend at {{NETWORK_BACKEND}} and one text line.

## What the person is signing up for

- Text messages from slop.date's matchmaker on {{NETWORK_LINE}}. Frequency varies. Message and
  data rates may apply. Reply STOP SLOP to stop slop.date only, STOP ALL to stop every app, HELP for help.
- Dating introductions only with mutual opt-in. No browsing of profiles, no swiping, no feed.
- What they tell the matchmaker (preferences, availability, the kind of person they hope to meet) is
  used to suggest introductions on slop.date. Orientation and sexual preferences are treated as
  sensitive and are never shown to anyone without the person's say-so.
- Safety first: read https://slop.date/safety before the first date. slop.date's safety notice
  says whether it runs background checks. Do not tell the person it does unless that page says so.

## Who can use it

- Matching on slop.date is for adults 18 or older only. Nobody under 18 is ever matched,
  introduced or shown to anyone, on slop.date or any other app powered by The Network.
- If the person says or suggests they are under 18, tell them kindly that slop.date is for adults
  and stop. Do not suggest workarounds and do not ask for proof of age.
- The person must use their own phone number. One person, one account.

## How a person joins (they do it, not you)

1. Text: send the word SLOP as the first message to {{NETWORK_LINE}} from their own phone. Or
2. Web: open https://slop.date/join, enter their own phone number, and type the code that arrives
   by text into that page.

Give them the link or the keyword and stop there. The person verifies their own phone.

## What you may do

- Explain slop.date, how matching works, the age rule, privacy and safety, using this file and
  the pages linked here.
- Give the join link https://slop.date/join or the keyword SLOP and the number {{NETWORK_LINE}}.
- Help them think about what to say to the matchmaker, if they ask.
- Point to settings (https://slop.date/settings), export, STOP and delete.

## What you must never do

- Never ask for, receive, read, relay or type a verification code. If the person pastes one,
  tell them not to share it and that you did not use it.
- Never enter a phone number into any form or tool, and never sign up, text or message anyone,
  including the person, on their behalf.
- Never sign up someone else ("sign up my friend", "make one for my brother"). Each person joins
  themselves.
- Never search for, describe, rate or contact other members, and never promise a match.
- Never move information to or from another app powered by The Network. Nothing crosses apps
  unless the person shares it themselves in that app.
- Never put sensitive details (health, orientation, other people's information) into any tool.

## Privacy in one paragraph

slop.date keeps what the person tells it inside slop.date. Other apps powered by The Network
(ntwrk.love, peon.biz, friends.help) see nothing from slop.date unless the person explicitly
shares it. Staff see sensitive details only through an audited reveal. The person can export or
delete their slop.date data at https://slop.date/settings or by texting the line. Full policy:
https://slop.date/privacy. Terms: https://slop.date/terms. SMS terms: https://slop.date/sms-terms.

## If the MCP server is connected (not ChatGPT)

- `app_info` with `app: "slop"` returns the current rules and links. Prefer it over this file
  if they differ.
- `start_signup` returns the same link and keyword for the person to use.
- `check_status` works only after the person signs in themselves in the browser window the
  client opens. It reports their own slop.date status only.
```

### 2.5 peon.biz

`sites/skills/peon-biz/SKILL.md`. The frontmatter pattern is the same; only the differences are shown in full here.

```markdown
---
name: peon-biz
description: Explains peon.biz, a hiring service by text message powered by The Network, for people looking for work and for people hiring, and helps a person sign themselves up. Use when someone asks what peon.biz is, how it matches candidates and roles, how to join, what happens to their data, or how to stop or delete their account. Gives a link and a text keyword. Never signs anyone up, never handles verification codes, never applies to jobs or contacts candidates or employers.
license: Proprietary. Terms at https://peon.biz/terms
compatibility: Works without network access. Optional live status uses The Network MCP server at {{NETWORK_MCP_URL}}.
metadata:
  app: peon
  site: https://peon.biz
  backend: "{{NETWORK_BACKEND}}"
  operator: Eliza Research Corporation
  version: "1.0.0"
---

# peon.biz

peon.biz introduces people looking for work to people hiring, by text message. It is powered by
The Network (https://ntwrk.love) and shares its backend at {{NETWORK_BACKEND}} and its text line.

## What the person is signing up for

- Texts from peon.biz's recruiter agent on {{NETWORK_LINE}}. Reply STOP PEON to stop peon.biz only,
  STOP ALL to stop every app, HELP for help.
- They choose one: looking for work, or hiring for a team.
- Automated matching ranks candidates and roles. Before peon.biz is used for New York City roles it
  must have an independent bias audit and give candidates notice; candidates can ask for a
  human-only process. Say so if asked; do not promise outcomes.
- peon.biz will never ask a candidate for money, a Social Security number or bank details.
  If anyone does in its name, it is a scam: tell the person to report it.

## Who can use it

- Anyone 13 or older may join The Network, but peon.biz matches adults 18 or older only. Nobody
  under 18 is matched or introduced.
- Employers are verified before their roles go live.

## How a person joins (they do it, not you)

1. Text PEON as the first message to {{NETWORK_LINE}} from their own phone, or
2. Open https://peon.biz/join, enter their own number, and type the code into that page.

## What you may do
- Explain the service, the age rule, the audit and notice rules, and privacy.
- Give the link or the keyword. Help them draft what they want the recruiter to know, if asked.

## What you must never do
- Never handle verification codes, enter phone numbers, or sign anyone up, including colleagues
  or candidates "on their behalf".
- Never apply to roles, message employers or candidates, or describe other members.
- Never collect or pass on demographic data, salary history, SSNs or bank details.
- Never move information between peon.biz and other apps powered by The Network.

## Privacy
Nothing crosses apps without the person's consent. Export or delete at https://peon.biz/settings.
Policy: https://peon.biz/privacy. Terms: https://peon.biz/terms. SMS terms: https://peon.biz/sms-terms.

## If the MCP server is connected
`app_info` (app "peon"), `start_signup`, and, after the person signs in themselves, `check_status`.
```

### 2.6 friends.help

`sites/skills/friends-help/SKILL.md`:

```markdown
---
name: friends-help
description: Explains friends.help, a service by text message powered by The Network that helps adults in New York City make friends and plans, and helps a person sign themselves up. Use when someone asks what friends.help is, whether it is safe, how to join, what happens to their data, or how to stop or delete their account. Gives a link and a text keyword. Never signs anyone up, never handles verification codes, never contacts or describes other people.
license: Proprietary. Terms at https://friends.help/terms
compatibility: Works without network access. Optional live status uses The Network MCP server at {{NETWORK_MCP_URL}}.
metadata:
  app: buddies
  site: https://friends.help
  backend: "{{NETWORK_BACKEND}}"
  operator: Eliza Research Corporation
  version: "1.0.0"
---

# friends.help

friends.help helps people in New York City find friends and things to do together, by text.
Plans are in public places and start in small groups. It is powered by The Network
(https://ntwrk.love), with one backend at {{NETWORK_BACKEND}} and one text line.

## What the person is signing up for
- Texts from friends.help on {{NETWORK_LINE}}. Reply STOP FRIENDS to stop friends.help only,
  STOP ALL to stop every app, HELP for help.
- Suggestions of people and plans they asked for, only with mutual opt-in. Report and block by
  text at any time. A check-in after each plan.

## Who can use it
- Anyone 13 or older may join The Network. friends.help introduces adults 18 or older only;
  nobody under 18 is matched, introduced or shown to anyone.

## How a person joins (they do it, not you)
1. Text FRIENDS as the first message to {{NETWORK_LINE}} from their own phone, or
2. Open https://friends.help/join, enter their own number, and type the code into that page.

## What you may do / must never do
- May: explain the service, safety, the age rule and privacy; give the link or keyword.
- Never: handle verification codes, enter phone numbers, sign anyone else up, contact or describe
  other members, promise introductions, or move information between apps.

## Privacy
Nothing crosses apps without the person's consent. Export or delete at https://friends.help/settings.
Policy: https://friends.help/privacy. Terms: https://friends.help/terms. SMS terms: https://friends.help/sms-terms.

## If the MCP server is connected
`app_info` (app "buddies"), `start_signup`, and, after the person signs in themselves, `check_status`.
```

### 2.7 ntwrk.love (the hub)

`sites/skills/ntwrk-love/SKILL.md`:

```markdown
---
name: ntwrk-love
description: Explains The Network (ntwrk.love), the private text-message network that powers slop.date (dating), peon.biz (hiring) and friends.help (friends in New York City), and points a person to the right app to sign themselves up. Use when someone asks what The Network or any of its apps is, which app fits what they want, how joining works, who can join, how privacy works across apps, or how to stop or delete. Never signs anyone up and never handles verification codes.
license: Proprietary. Terms at https://ntwrk.love/terms
compatibility: Works without network access. Optional live status uses The Network MCP server at {{NETWORK_MCP_URL}}.
metadata:
  app: ntwrk
  site: https://ntwrk.love
  backend: "{{NETWORK_BACKEND}}"
  operator: Eliza Research Corporation
  version: "1.0.0"
---

# The Network

The Network is an agent you text. It helps with people, plans and events you ask for, and it
powers several apps. All of them share one backend ({{NETWORK_BACKEND}}), one text line
({{NETWORK_LINE}}) and one rule: nothing crosses apps without the person's consent.

| App | For | Join keyword | Site |
|---|---|---|---|
| The Network | Introductions, help, things to do (invite-only) | NETWORK | https://ntwrk.love |
| slop.date | Dating, adults only | SLOP | https://slop.date |
| peon.biz | Work and hiring | PEON | https://peon.biz |
| friends.help | Friends and plans in New York City | FRIENDS | https://friends.help |

## Who can join
- Anyone 13 or older may join. Matching and introductions to other people are 18+ only, in every
  app. People under 18 are never matched or introduced to anyone.
- The Network itself is invite-only right now; the other apps are open.

## How joining works (the person does it)
- Text the app's keyword as the first message to {{NETWORK_LINE}}, or use that app's /join page and
  verify their own phone with the code sent to them.
- One phone number is one person. Joining a second app with the same number does not share
  anything from the first unless the person agrees when asked.

## You may
- Explain each app, the age rule, consent and privacy. Help pick the right app. Give links and keywords.

## You must never
- Ask for, receive or enter verification codes; enter phone numbers; sign up or message anyone,
  including the person, on their behalf; sign up anyone else; search for, describe or contact
  members; promise matches; or carry information from one app to another.

## Privacy and control
STOP stops one app, STOP ALL stops all. Export and delete at each site's /settings.
Policy: https://ntwrk.love/privacy. Terms: https://ntwrk.love/terms. Support: https://ntwrk.love/support.
```

Before publishing: check every description with `wc -c` (≤1024) and the build test. Every keyword (`SLOP`, `PEON`, `FRIENDS`, `NETWORK`) must come from the keyword table the backend uses. That table does not exist yet (finding 11). The keywords above are proposals.

### 2.8 Skill tests (offline, in `bun test sites`)

1. Frontmatter parses. `name` matches `^[a-z0-9]+(-[a-z0-9]+)*$`, is 64 characters or fewer, equals its folder, and has no `claude` or `anthropic`. `description` is 1-1024 characters with no `<` or `>`. `compatibility` is 500 characters or fewer. `metadata` values are strings.
2. The body is under 500 lines. It has these headings: who can use it, how a person joins, what you may do, what you must never do, privacy.
3. **Policy drift test:** the ages, keywords and domains in each skill equal `APPS[app]` in `packages/platform/src/apps.ts`, once those fields exist. This test fails today for the ages (finding 2), and it should.
4. The same `{{NETWORK_BACKEND}}` value appears in all four built skills. No `{{` remains in `dist/`.
5. `dist/SKILL.md` is byte-identical to `dist/.well-known/agent-skills/<name>/SKILL.md`. The `digest` in `index.json` equals the sha256 of that file.
6. Every absolute URL in a skill points to a page that exists in some site's `dist/`.
7. A phrase guard: each skill contains "verification code" in the "never" section and does not contain "I will sign you up" or similar.
8. In CI, also run the reference validator: `skills-ref validate sites/skills/<name>` (S7). Pin the tool version.

---

## 3. Does a plugin need an MCP server? A minimal one on the shared backend

### 3.1 Answer

- **No, for a skills-only plugin.** S1 says the plugin bundles skills "and when needed an MCP server". S5 says "Skills-only plugins don't need MCP review cases or a demo recording".
- **Yes, for live status.** To let ChatGPT or Claude check whether the person has finished signing up, the plugin needs a remote MCP server. Public submission requires "remote HTTPS MCP endpoints" (S1) and allows "only one MCP server" per plugin (S5).

**Recommendation:**

- **Phase A:** ship the skills on the sites now, plus a skills-only OpenAI and Claude plugin for ntwrk.love, peon.biz and friends.help.
- **Phase B:** add the minimal MCP server below, as a shard of the shared backend at `https://mcp.ntwrk.love/mcp`, and submit a new plugin version.

The existing prototype at `thenetwork-audit/prototypes/connector-mcp` already has the OAuth discovery and host checks this needs. Reuse them.

### 3.2 Tools

All three tools are scoped to the person's own data and never touch other members. Annotations must be explicit `true`/`false` values (S6).

| Tool | Auth (`securitySchemes`) | readOnly | destructive | openWorld | Input | Output |
|---|---|---|---|---|---|---|
| `app_info` | `noauth` | true | false | false | `{ app?: "ntwrk"\|"peon"\|"buddies"\|"slop" }`, `additionalProperties: false` | name, domain, one-line intent, `join: { keyword, line, url }`, `ages: { join, match }`, links (privacy, terms, sms-terms, safety, support), `consent_rules` (array of short strings). Without `app`: the list of apps for this client profile. |
| `start_signup` | `noauth` | true (it changes nothing; it only builds a link) | false | false | `{ app: enum, city?: enum }`, `additionalProperties: false`. **No phone, name or age field.** | `{ url: "https://<domain>/join?via=agent", keyword, line, instructions_for_person: "Open this link yourself and enter your own number. Never share the code with anyone, including this assistant." }` |
| `check_status` | `oauth2`, scope `membership:read` | true | false | false | `{ app?: enum }`, limited to apps the grant covers | `{ app, status: "not_joined"\|"pending_verification"\|"active"\|"waitlisted"\|"stopped", next_step }` for the signed-in person only |

Server `instructions`: the key rules must fit in the first 512 characters (S3). Proposed text:

> Helps a person learn about apps powered by The Network and sign themselves up. Never ask for or accept verification codes or phone numbers. Never sign anyone up. start_signup returns a link the person opens themselves. check_status works only after the person signs in. No tool returns information about other people.

Client profiles (prototype's `surface profile`):

- For ChatGPT clients (CIMD URLs on `chatgpt.com`, per the prototype's `teen_safe_directory`), `app_info` without `app` omits `slop`.
- `app_info`, `start_signup` and `check_status` with `app: "slop"` return `not_available_here`.
- The profile is never derived from `clientInfo.name`.

### 3.3 Auth model

- **Resource:** `https://mcp.ntwrk.love/mcp`, canonical, with no trailing slash (S11). Publish RFC 9728 metadata at `/.well-known/oauth-protected-resource` (and at `/.well-known/oauth-protected-resource/mcp`) with `resource` and `authorization_servers`.
- **Authorization server:** the shared backend at `https://ntwrk.love` or `https://auth.ntwrk.love`.
  - Serve `/.well-known/oauth-authorization-server` with:
    - `issuer` (exact match)
    - `authorization_endpoint`
    - `token_endpoint`
    - `code_challenge_methods_supported: ["S256"]`
    - `client_id_metadata_document_supported: true` (CIMD preferred; DCR is deprecated in MCP 2026-07-28, S11)
    - optional `registration_endpoint`
    - `authorization_response_iss_parameter_supported: true`, and include `iss` in every response
  - Redirect URI allowlist: copy it exactly from the ChatGPT management page (S4). Use `https://chatgpt.com/connector_platform_oauth_redirect` when RFC 9207 is met, and add Claude's documented callback.
- **Login on the authorize page:** the person types their own phone number and the code on **our** page, in **their** browser. The agent and the AI client never see either. This is the only place a code is entered.
  - Add Turnstile.
  - Reuse the `OtpService` limits.
- **Consent screen:** names the client, the app(s) and the single scope (`membership:read`), and says "This lets the assistant see whether you've joined. It can't see your messages, matches, or anything about other people."
  - One grant covers one app by default. Cross-app status needs a separate checkbox per app.
- **Tokens:** short-lived JWTs whose audience is the resource (RFC 8707). Verify signature, `iss`, `aud`, `exp` and scope on every request. Return 401 with `WWW-Authenticate: Bearer resource_metadata="https://mcp.ntwrk.love/.well-known/oauth-protected-resource", scope="membership:read"`.
  - For the ChatGPT linking UI, a tool error result carries `_meta["mcp/www_authenticate"]` with `error` and `error_description` (S4).
  - Never accept or pass through other tokens (S11).
  - No `offline_access` in `scopes_supported`.
- **Transport:** Streamable HTTP, POST only, JSON responses (S12, 2026-07-28).
  - Validate `Origin` and answer 403 when it is present and not allowed. The prototype's `ALLOWED_BROWSER_ORIGINS` does this.
  - Require `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name`, and reject mismatches with 400/-32020.
  - Answer GET and DELETE with 405, and ignore `Mcp-Session-Id`.
  - Keep the 2025-06-18/2025-11-25 `initialize` fallback for older clients, because ChatGPT's current client version is not documented here (**verify** with MCP Inspector against ChatGPT developer mode).
- **Reviewer access:** see finding 9.

### 3.4 What must never be exposed

- OTP codes, code hashes, or any field that accepts a code or a phone number in any tool.
- Whether a phone number is registered, in any app. No enumeration, matching the rule `/api/auth/otp/start` already keeps.
- Membership in apps the grant does not cover. Above all, never reveal slop membership to a peon or friends grant.
- Age, date of birth, `lowest_age`, or "under 18" flags. `check_status` for a minor just says `active`, with matching simply never happening.
- Other members, candidates, matches, introductions, messages, facets, sensitive classes, staff notes, safety cases.
- Internal ids, session tokens, access tokens, keyed hashes, staff API routes, debug output, stack traces (S3).
- Secrets or personal data in `_meta`. `_meta` is hidden from the model, not secure (S3).
- Logs must not hold tokens, phone numbers or codes. Log grant id, tool and result status only.
- Rate-limit `start_signup` and `app_info` per client and IP, even though they are cheap.

### 3.5 Plugin package files

`plugins/the-network/` in the repo. This one folder serves both OpenAI (portable layout) and Claude Code:

```text
plugins/the-network/
├── plugin.json                 # portable manifest + extensions.com.openai (OpenAI)
├── mcp.json                    # portable MCP servers (OpenAI)            [phase B]
├── .claude-plugin/plugin.json  # Claude Code manifest
├── .mcp.json                   # Claude Code MCP servers                  [phase B]
├── skills/
│   ├── ntwrk-love/SKILL.md     (+ agents/openai.yaml in phase B)
│   ├── peon-biz/SKILL.md
│   └── friends-help/SKILL.md   # slop-date NOT included in the OpenAI package
└── assets/icon.png, logo.png   # square, ≥48x48, ≤5 MiB
```

`plugin.json` (S1):

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "the-network",
  "version": "1.0.0",
  "description": "Learn about apps powered by The Network and sign yourself up.",
  "author": { "name": "Eliza Research Corporation", "url": "https://ntwrk.love" },
  "homepage": "https://ntwrk.love",
  "license": "Proprietary",
  "keywords": ["friends", "jobs", "introductions", "new york"],
  "extensions": {
    "com.openai": {
      "interface": {
        "displayName": "The Network",
        "shortDescription": "Find out what The Network's apps do and how to join",
        "longDescription": "Explains The Network, peon.biz and friends.help, who can join, and how privacy works, and gives you a link to sign yourself up. It never asks for your verification code.",
        "developerName": "Eliza Research Corporation",
        "category": "Lifestyle",
        "capabilities": ["Read"],
        "websiteURL": "https://ntwrk.love",
        "privacyPolicyURL": "https://ntwrk.love/privacy",
        "termsOfServiceURL": "https://ntwrk.love/terms",
        "defaultPrompt": ["What is The Network and how do I join?"],
        "composerIcon": "./assets/icon.png",
        "logo": "./assets/logo.png"
      }
    }
  }
}
```

`supportURL` is required at review (S5). Its place in the manifest is not shown on S1, so it is set in the submission form (**verify**).

`mcp.json` (phase B):

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  "mcpServers": { "the-network": { "type": "streamable-http", "url": "https://mcp.ntwrk.love/mcp" } }
}
```

`skills/<name>/agents/openai.yaml` (phase B, S2): `dependencies.tools` holds one entry with `type: mcp`, `value: the-network`, `transport: streamable_http`, `url: https://mcp.ntwrk.love/mcp` and a description.

`.claude-plugin/plugin.json` (S9) has `name: "the-network"` (allowed: no `claude-` prefix), `displayName`, `version`, `description`, `author`, `homepage`, `privacyPolicyUrl`, `termsOfServiceUrl` and `supportUrl`. `.mcp.json` holds `{"mcpServers":{"the-network":{"type":"http","url":"https://mcp.ntwrk.love/mcp"}}}`. Validate with `claude plugin validate --strict plugins/the-network`.

Do **not** include `.app.json` or hooks: ZIPs with app references or hooks cannot be submitted (S5).

**OpenAI domain verification:** serve the challenge token as plain text, exactly, at `https://ntwrk.love/.well-known/openai-apps-challenge` (parent of `mcp.ntwrk.love`) or on `mcp.ntwrk.love` itself (S5). This is a static file in the ntwrk.love build, added only when OpenAI issues the token.

Local marketplace for testing: `.agents/plugins/marketplace.json` with `source: { source: "local", path: "./plugins/the-network" }`, `policy.installation: "AVAILABLE"`, `policy.authentication: "ON_INSTALL"` (S1). Then run `codex plugin marketplace add`.

---

## 4. Cloudflare CI/CD

### 4.1 Pages or Workers static assets

Cloudflare's Pages overview says "Start new projects with Workers" (S14). The migration guide (S18) lists these differences:

- Workers-only features: gradual deployments, version URLs with aliases, and non-root routes.
- Pages-only feature: custom domains on zones outside Cloudflare.
- Shared features: `_headers` and `_redirects` (both work with Workers static assets) and preview URLs.

All four zones are on Cloudflare nameservers, so the one Pages-only feature does not matter here.

**Recommendation: keep Workers static assets for all four sites.** ntwrk.love already runs this way; the other three `wrangler.toml` files already follow the same pattern. Add CI/CD around it. Reasons:

1. It is Cloudflare's stated direction for new projects (S14).
2. ntwrk.love needs no cut-over, which is the riskiest step in a Pages plan: a moment with no privacy page while 10DLC review may check it.
3. The `/api/*` proxy is a few lines with `run_worker_first = ["/api/*"]` (S19). With a service binding, if the API runs as a Worker, it never crosses the public internet. That solves findings 7 and 8 more cleanly than a Pages Function fetch.
4. Version URLs with `--preview-alias <branch>` give per-PR previews (S20).

**Workers caveats:**

- Version URLs exist only on `workers.dev`, are public unless Cloudflare Access protects them, and cannot be tailed.
- Today `preview_urls` follows `workers_dev`. The site configs do not set either, so check them.

**If the founder still wants Pages** (the request said "Cloudflare Pages"), section 4.2 is the full Pages plan and works as written. Every other part of this document (skills, headers, checks) applies to both.

### 4.2 Pages plan (if chosen)

**Projects:** one per site, created once by the founder, because a project create is a mutating command and `scripts/wrangler.sh` refuses it without approval.

```bash
NTWRK_ALLOW_DEPLOY=1 ./scripts/wrangler.sh pages project create ntwrk-love   --production-branch main
NTWRK_ALLOW_DEPLOY=1 ./scripts/wrangler.sh pages project create slop-date    --production-branch main
NTWRK_ALLOW_DEPLOY=1 ./scripts/wrangler.sh pages project create peon-biz     --production-branch main
NTWRK_ALLOW_DEPLOY=1 ./scripts/wrangler.sh pages project create friends-help --production-branch main
```

The project name becomes `<name>.pages.dev`; pick another name if one is taken. slop-date and friends-help go in whichever account holds their zones (finding 3).

**Build:**

- `bun run sites/sites.ts <app>`, then the new `sites/publish.ts <app>` step (section 4.4).
- The output is `sites/<domain>/dist`.
- Functions live in `sites/<domain>/functions/`. Wrangler compiles them when `pages deploy` runs from the site folder; how it resolves the `functions/` path is not documented (S22), so **verify** with `--dry-run` or a preview deploy.

**Functions proxy:** `sites/<domain>/functions/api/[[path]].ts`, with the same code shared from `sites/shared/proxy.ts`.

```ts
interface Env { API_ORIGIN: string; PROXY_SECRET: string }
const HOP = ["connection", "keep-alive", "transfer-encoding", "upgrade", "host", "cf-connecting-ip",
             "x-forwarded-host", "x-network-client-ip", "x-network-proxy-auth"];
export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const target = new URL(url.pathname + url.search, env.API_ORIGIN);   // path stays /api/...
  const headers = new Headers(request.headers);
  for (const h of HOP) headers.delete(h);                               // never trust client copies
  headers.set("x-forwarded-host", url.hostname);                         // backend picks the app
  headers.set("x-network-client-ip", request.headers.get("cf-connecting-ip") ?? "");
  headers.set("x-network-proxy-auth", env.PROXY_SECRET);                 // backend trusts the two above only with this
  const res = await fetch(target, { method: request.method, headers, body: request.body, redirect: "manual" });
  const out = new Response(res.body, res);                               // keeps every Set-Cookie
  out.headers.set("cache-control", "no-store");
  out.headers.set("x-content-type-options", "nosniff");                  // _headers does not apply to Functions (S16)
  out.headers.set("referrer-policy", "no-referrer");
  return out;
};
```

Backend changes this needs in `packages/platform/src/api.ts`:

- `trustForwardedHost` and `ipOf` honor `x-forwarded-host` and `x-network-client-ip` **only** when `x-network-proxy-auth` matches `PLATFORM_PROXY_SECRET`, compared in constant time. Otherwise they use `Host` and `CF-Connecting-IP`.
- Cookies must not set `Domain=`.
- The secret is set with `wrangler pages secret put PROXY_SECRET --project-name <p>`. `API_ORIGIN` is a per-environment variable: production points to the production API, preview to staging.

**`_routes.json`:** `{"version":1,"include":["/api/*"],"exclude":[]}` so that only `/api/*` invokes Functions. Static pages then stay free and unlimited (S15).

**`/mcp` on each site:** do **not** proxy it. The MCP resource must be one canonical URL (S11). Four proxied copies would be four OAuth resources and four plugins. Add `/mcp  https://mcp.ntwrk.love/mcp  308` to each site's `_redirects` so that people who guess a URL land in the right place. The skills name the canonical URL.

**`_headers`** (each site; max 100 rules, 2,000 characters per line; S16):

```text
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  X-Frame-Options: DENY
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  Content-Security-Policy: default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self'; img-src 'self' data:; style-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'

/SKILL.md
  Content-Type: text/markdown; charset=utf-8
  Access-Control-Allow-Origin: *
  Cache-Control: public, max-age=300

/.well-known/agent-skills/*
  Access-Control-Allow-Origin: *
  Cache-Control: public, max-age=300

/.well-known/agent-skills/index.json
  Content-Type: application/json

/.well-known/agent-skills/*/SKILL.md
  Content-Type: text/markdown; charset=utf-8

https://:project.pages.dev/*
  X-Robots-Tag: noindex

https://:version.:project.pages.dev/*
  X-Robots-Tag: noindex
```

- Check that the CSP allows whatever the pages load. `sites/shared` uses Turnstile; the test opens each page with the CSP applied.
- Whether `_headers` may override `Content-Type` is not stated on S16, so the curl checks below confirm it.

**Preview and production:**

- A push to `main` deploys to production.
- Every other branch and PR deploys with `--branch <branch>`, which makes a preview at `<branch>.<project>.pages.dev` (S13, S22).
- Previews use the staging `API_ORIGIN` and must be `noindex`. Protect them with Cloudflare Access if staging data is sensitive.
- PRs from forks get no secrets in `pull_request`. Never use `pull_request_target` here.

**Custom domains:**

- Add each domain in the dashboard: Pages project → Custom domains → Set up a domain. The page documents only the dashboard steps; Wrangler has no command for it (S17, S22).
- Apex domains require the zone to be in the same account.
- Do not create the CNAME first, or the domain shows 522 (S17).
- Check CAA records.
- After launch, redirect `<project>.pages.dev` to the custom domain with Bulk Redirects (S17).

**Safe cut-over of ntwrk.love from the Worker to Pages** (needed only if Pages is chosen):

1. Deploy the Pages project. Check everything in section 5 against `ntwrk-love.pages.dev`.
2. Do it at a quiet hour, and not while a 10DLC campaign review is pending, because carriers check the privacy and terms pages.
3. Move `www.ntwrk.love` first, as the canary:
   - Remove it from the Worker. Edit `routes` in `sites/ntwrk.love/wrangler.toml`, then run `NTWRK_ALLOW_DEPLOY=1 ./scripts/wrangler.sh deploy`, or remove it in the dashboard.
   - Add it in Pages and wait for "Active" and its certificate.
   - Run the curl checks.
4. Repeat for the apex `ntwrk.love`. Expect a short gap (seconds to minutes) while Pages provisions the record and certificate.
5. Keep the Worker (with no routes) for a week as the rollback. Rollback means removing the Pages domain and re-adding the Worker custom domain.
6. Delete the Worker only after a week with no errors.

How a Workers custom domain hands a hostname to Pages is not documented on S17 or S21 (**verify** in a test zone first). This step alone is a good reason to stay on Workers.

### 4.3 Workers plan (recommended)

For each site's `wrangler.toml`, add to the current config:

```toml
main = "../shared/site-worker.ts"     # tiny router: /api/* -> API, everything else -> ASSETS
workers_dev = true                     # needed for version URLs; production still on custom domains
preview_urls = true

[assets]
directory = "./dist"
binding = "ASSETS"
html_handling = "drop-trailing-slash"
not_found_handling = "404-page"
run_worker_first = ["/api/*"]

# If the platform API is a Worker in the same account:
[[services]]
binding = "API"
service = "network-platform-api"
# Otherwise: vars API_ORIGIN + secret PROXY_SECRET, and the same header rules as the Pages proxy.
```

`site-worker.ts` does the same work as the Pages proxy: strip client copies of the trusted headers, set them, and call `env.API.fetch(req)` (or `fetch(API_ORIGIN)`). Any path not under `/api/` falls through to `env.ASSETS.fetch(req)`. `_headers` and `_redirects` in `dist/` work as they do on Pages (S18).

**CI:**

- A push to `main` runs `wrangler deploy` for each site. This is the production job, gated (below).
- A PR runs `wrangler versions upload --preview-alias pr-<number>`, which gives `pr-<n>-<worker>.<subdomain>.workers.dev` (S20).
  - Aliases must start with a letter and be ≤63 characters with the Worker name.
  - Use a staging `API_ORIGIN` via `[env.staging]`.
- **Token:** an account-owned token with Account → Workers Scripts → Edit, and Zone → Workers Routes → Edit on the four zones.
  - Custom domains (`custom_domain = true`) may also need zone DNS edit rights (**verify** with a dry run, then a real deploy, before handing the token to CI).
  - Granular tokens work with Wrangler only when the token is account-owned.

### 4.4 Build changes (both plans)

New `sites/publish.ts <app>`, run after `sites.ts`:

1. Copy `sites/<domain>/static/` into `dist/`: `_headers`, `_redirects`, `_routes.json` (Pages only), `robots.txt`, `llms.txt`, and `.well-known/` (with `openai-apps-challenge` on ntwrk.love when issued).
2. Copy `sites/skills/<name>/SKILL.md` to `dist/SKILL.md` and `dist/.well-known/agent-skills/<name>/SKILL.md`. On ntwrk.love, copy all four into `.well-known/agent-skills/`.
3. Substitute `{{NETWORK_BACKEND}}`, `{{NETWORK_MCP_URL}}` and `{{NETWORK_LINE}}` from env vars. Fail if any is empty in a production build.
4. Write `index.json` with each entry's `sha256` over the final bytes.
5. Fail on any leftover `{{`.

Dot-folders: check that `.well-known/` is uploaded by `pages deploy` and by Workers assets. Workers assets skip only what `.assetsignore` lists, but **verify** with the curl check after the first preview deploy.

### 4.5 GitHub Actions: `.github/workflows/deploy-sites.yml`

Rules:

- **Founder approval stays.** The production job uses a GitHub Environment named `production` with the founder as required reviewer. This replaces `NTWRK_ALLOW_DEPLOY=1` for CI, because CI calls Wrangler directly, not through `scripts/wrangler.sh`.
- `ci.yml` stays secret-free. Deploys run only after it passes, through `needs:` in the same workflow or `workflow_run`.
- **Pin every action by full SHA.** For example `cloudflare/wrangler-action@953926a2e2182532811c01a25e53647d93bf07c0  # v4.1.3` (S23, latest on 2026-09-24). Avoid v4.1.0 and v4.1.1, which the releases page marks broken.
  - Resolve the SHAs for `actions/checkout` and `oven-sh/setup-bun` with `gh api repos/<owner>/<repo>/git/ref/tags/<tag>` when you write the file. Don't copy them from memory.
  - Pin Wrangler with the action's `wranglerVersion` input.

Pages variant:

```yaml
name: deploy-sites
on:
  push: { branches: [main] }
  pull_request:
permissions: { contents: read }
concurrency: { group: deploy-sites-${{ github.ref }}, cancel-in-progress: true }
jobs:
  build:
    runs-on: ubuntu-latest
    strategy: { matrix: { site: [ntwrk, slop, peon, buddies] } }   # buddies -> friends.help after rename
    steps:
      - uses: actions/checkout@<sha> # v4
      - uses: oven-sh/setup-bun@<sha> # v2
        with: { bun-version: 1.4.2 }
      - run: bun install --frozen-lockfile
      - run: bun run sites/sites.ts ${{ matrix.site }} && bun run sites/publish.ts ${{ matrix.site }}
        env:
          NETWORK_BACKEND: ${{ vars.NETWORK_BACKEND }}
          NETWORK_MCP_URL: ${{ vars.NETWORK_MCP_URL }}
          NETWORK_LINE: ${{ vars.NETWORK_LINE }}
      - run: bun test sites
      - uses: actions/upload-artifact@<sha> # v4
        with: { name: dist-${{ matrix.site }}, path: sites/*/dist, include-hidden-files: true }  # keeps .well-known
  preview:
    if: github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository
    needs: build
    runs-on: ubuntu-latest
    environment: preview
    permissions: { contents: read, deployments: write }
    strategy: { matrix: { include: [ {site: ntwrk, dir: ntwrk.love, project: ntwrk-love}, ... ] } }
    steps:
      - uses: actions/download-artifact@<sha>
      - uses: cloudflare/wrangler-action@953926a2e2182532811c01a25e53647d93bf07c0 # v4.1.3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          wranglerVersion: "<pinned>"
          workingDirectory: sites/${{ matrix.dir }}
          command: pages deploy dist --project-name=${{ matrix.project }} --branch=${{ github.head_ref }} --commit-hash=${{ github.sha }}
  production:
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    needs: build
    environment: production          # founder approves here
    # same steps as preview with --branch=main
```

- `actions/upload-artifact` skips dot-files unless `include-hidden-files: true`, which matters for `.well-known/`. Alternatively, rebuild in the deploy job.
- The `--branch` value goes through Wrangler, not a shell. Still, quote `github.head_ref` through an env var instead of inline `${{ }}` in `run:` steps, to avoid script injection from branch names.

**Secrets and variables:**

| Name | Kind | Value |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Environment secret (preview and production) | Pages: Custom Token with **Account → Cloudflare Pages → Edit** only (S13), limited to the one account, with a TTL of 90 days or less and an IP filter if wanted. Workers: see 4.3. |
| `CLOUDFLARE_ACCOUNT_ID` | Secret | the ntwrk.love account id, from the environment (and a second pair if finding 3 holds) |
| `NETWORK_BACKEND`, `NETWORK_MCP_URL`, `NETWORK_LINE` | Variables per environment | Placeholders above |

How the founder creates the token:

1. Go to dash.cloudflare.com → Manage account → Account API Tokens (account-owned) → Create Token → Custom token.
2. Name it `gh-actions-pages-deploy`. Set permissions to Account / Cloudflare Pages / Edit. Set account resources to Include → the ntwrk.love account.
3. Set a TTL. Create it, then paste it into GitHub → Settings → Environments → production and preview → Secrets.
4. The token is never written to the repo, `.env`, or a log.

---

## 5. Verification checklist

Run each item against the preview URL first, then production. `$S` is the site origin.

**Static and headers**

```bash
for S in https://ntwrk.love https://slop.date https://peon.biz https://friends.help; do
  curl -sI $S/ | grep -iE '^(http|content-security-policy|x-content-type-options|strict-transport)'
  curl -sI $S/SKILL.md | grep -iE '^(http|content-type|access-control-allow-origin)'   # 200, text/markdown, *
  curl -s  $S/.well-known/agent-skills/index.json | jq -e '."$schema" and (.skills|length>0)'
  curl -sI $S/privacy | head -1; curl -sI $S/terms | head -1; curl -sI $S/sms-terms | head -1
  curl -sI $S/nope | head -1                                                             # 404 page
done
curl -sI https://ntwrk-love.pages.dev/ | grep -i x-robots-tag                            # noindex (Pages)
```

**Digest and identity of skills**

```bash
S=https://slop.date; N=slop-date
want=$(curl -s $S/.well-known/agent-skills/index.json | jq -r ".skills[]|select(.name==\"$N\").digest")
got="sha256:$(curl -s $S/.well-known/agent-skills/$N/SKILL.md | shasum -a 256 | cut -d' ' -f1)"
[ "$want" = "$got" ] && cmp <(curl -s $S/SKILL.md) <(curl -s $S/.well-known/agent-skills/$N/SKILL.md)
curl -s $S/SKILL.md | grep -c '{{'                                                       # 0
```

**SKILL.md validation**

- `skills-ref validate sites/skills/*`
- `bun test sites` (the tests in 2.8)
- `claude plugin validate --strict plugins/the-network`
- Behaviour test (S2), done by hand in Claude Code and ChatGPT developer mode. Use the five request types with these slop/peon/friends prompts:
  1. "how do I join slop.date": the skill triggers and gives the link and keyword.
  2. "is there a dating app by text": it triggers.
  3. "sign me up": it asks nothing personal and gives the link.
  4. "what's the weather": no trigger.
  5. "here's my code 123456", "sign up my 16-year-old", "find me someone on slop": it refuses, with the reasons from the skill.

**API proxy**

```bash
curl -s $S/api/app | jq .                       # names THIS app only
curl -s -H 'X-Forwarded-Host: slop.date' https://peon.biz/api/app | jq .id   # must say peon (client header stripped)
curl -s -o /dev/null -w '%{http_code}\n' "$API_ORIGIN/api/app" -H 'X-Forwarded-Host: slop.date'   # direct origin without secret: must not resolve to slop
```

- OTP limits by IP: send 11 `otp/start` requests from one test machine. The 11th is limited. Then confirm that a second machine is **not** limited, which proves the visitor IP is passed through, not Cloudflare's egress address.
- Cookies: after verify, the `Set-Cookie` has no `Domain=`, has `HttpOnly; Secure; SameSite=Lax`, and its name is per app.
- Run the same-origin join and settings flow on a preview with a staff test phone.

**Links**

- `bunx linkinator https://<preview>/ --recurse --skip 'mailto:'`, with a pinned version.
- Every URL inside each SKILL.md answers 200.

**MCP (phase B)**

- `npx @modelcontextprotocol/inspector`, pinned. Use Streamable HTTP and `https://mcp-staging.ntwrk.love/mcp`, then check:
  - The instructions are present, and the first 512 characters carry the rules.
  - `tools/list` shows three tools, explicit annotations, `securitySchemes`, and `additionalProperties:false`.
  - No tool has a phone or code field.
- `curl -si -X POST .../mcp` with no token on `check_status` returns 401 and `WWW-Authenticate: Bearer resource_metadata=...`.
- `curl -s .../.well-known/oauth-protected-resource` returns a `resource` equal to the canonical URL.
- AS metadata includes `S256` and `issuer` matches exactly.
- `Origin: https://evil.example` returns 403. GET and DELETE return 405. A mismatched `Mcp-Name` returns 400/-32020.
- With a ChatGPT-profile client, `app_info` lists no slop, and `start_signup {app:"slop"}` returns `not_available_here`.
- `check_status` with a peon-only grant never reveals slop membership. For a minor's account it reveals no age.
- Grep the logs during these runs: no phone numbers, codes or tokens.

**Cut-over (Pages only)**

- Before and after each hostname move, run the static checks. Watch `curl -sI https://ntwrk.love/privacy` every 10 s until it returns 200 with the new deploy's headers.

---

## 6. Order of work

1. **Founder decisions:**
   - Workers or Pages (recommended: Workers).
   - The age rule per app (finding 2).
   - Which account holds slop.date and friends.help (finding 3).
   - The keywords and the line number.
2. Rename buddies to friends.help in `packages/platform`, `sites/` and the copy.
3. Write `sites/skills/*`, `sites/publish.ts` and the skill tests. Add `/support` to ntwrk.love.
4. Backend: the proxy-secret header rules in `api.ts`, and a keyword table in `apps.ts` exposed by `GET /api/app`.
5. Add the proxy (Worker router or Pages Function), `_headers` and `_redirects`.
6. Add `deploy-sites.yml` with pinned SHAs and the `preview`/`production` environments. The founder creates the token and approves the first production run.
7. Run section 5 against previews, then production.
8. Build the skills-only plugin `plugins/the-network` (without slop) and test it locally in Codex and Claude Code.
9. Phase B: build the MCP server (section 3) on staging, add the reviewer login, verify the domain, and submit.
