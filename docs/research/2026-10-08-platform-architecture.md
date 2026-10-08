# One platform, four apps: architecture plan

> **Superseded names (2026-10-08 cleanup note).** This is a dated research record. Since it was written: buddies.nyc was renamed friends.help (AppId `friends`, `friendsPack`); ntwrk.club belongs to someone else and is not used (ntwrk.love is the home page); `packages/worlds` moved to `packages/sim/src/apps`; the prototypes were deleted or promoted (`packages/blooio`). Current decisions: AGENTS.md "Platform decisions" and docs/mvp-plan.md.

Status: research and plan, 2026-10-08. Nothing in this document is built or deployed. A Claude agent wrote it by hand from code reading and web research. Web prices and rules were fetched on 2026-10-07 and 2026-10-08 (UTC); each one names its source. Items marked **unverified** could not be confirmed on a primary page.

**Scope warning.** A multi-app platform is not in PRD Section 28.3, and AGENTS.md says not to build anything outside 28.3 without founder approval. This document is a plan for the founders to decide on. No code is to be written from it until the founders approve it and add it to the PRD.

Code read:

- `packages/network` (ConsentNetwork, `PgStore`, `service/`): the worktree the `thenetwork-console` worktree (branch `obs/network-console`, read-only).
- `packages/observatory` (`db/schema.sql`, `db/dev-pg.ts`, `db/seed.ts`, `db/writer.ts`, `src/staff.ts`, `src/types.ts`).
- `packages/plugin-network`.
- `packages/core/src/policy.ts` and `types.ts`.
- `packages/sim` (README, generator, taxonomy).
- `sites/ntwrk.love`.
- `packages/blooio` and `prototypes/connector-mcp`.
- `scripts/wrangler.sh`.

Documents read:

- `docs/admin-console.md`, `docs/observatory.md`, `docs/network.md` and `docs/runbook-real.md`.
- `docs/research/eliza-integration.md` and `docs/research/blooio.md`.
- PRD sections 28 and 31-32 in `docs/prd-snapshot.md` on `origin/main`.
- The Steward auth code in the elizaOS monorepo at `packages/auth` in the elizaOS monorepo.

Names used here:

| App id | Domain | Product |
|---|---|---|
| `ntwrk` | ntwrk.club (ntwrk.love is live today) | The Network |
| `slop` | slop.date | Dating |
| `peon` | peon.biz | Hiring |
| `buddies` | buddies.nyc | Friend-finding in New York City |

Other terms:

- **Person:** one human, identified by one verified phone number.
- **Member:** a person's account in one app. One person can be a member of up to four apps.
- **App pack:** the per-app configuration that the shared engine loads: ontology, onboarding, copy, persona, filters and simulation.

---

## 0. Findings that change the plan

1. **ntwrk.club belongs to someone else.** RDAP shows it registered at GoDaddy since 2025-02-03, with all changes locked, expiring 2027-02-03. If the founder does not own it, keep ntwrk.love as The Network's domain, or buy ntwrk.club through a broker. Nothing was bought.
2. **slop.date and peon.biz are registered at Cloudflare** (created 2026-10-08 and 2026-10-06), on Cloudflare nameservers, and are probably the founder's. Confirm that they are in the same Cloudflare account as ntwrk.love.
3. **buddies.nyc is probably available** (RDAP 404). The `.nyc` nexus rule needs a registrant whose home or business street address is in NYC. Privacy proxies are not allowed, so the registrant address is public.
4. **Dating and 10DLC may not mix.** Twilio's rejection code 30953 lists a website with "dating" content as a SHAFT (sex/adult) violation. A campaign rejected under it cannot be resubmitted. slop.date may not get A2P SMS. It would then depend on Blooio iMessage only, or on a different sender type. Ask Twilio or the aggregator before anyone submits a slop campaign.
5. **peon.biz is probably an AEDT under NYC Local Law 144.** A matching engine that ranks candidates for NYC jobs needs an independent bias audit, a public summary and a candidate notice 10 business days before use. NYC enforcement increases in 2026. Illinois HB 3773 has applied since 2026-01-01. The Colorado replacement law (SB 26-189) starts 2027-01-01.
6. **The Eliza auth code already has Twilio Verify.** `packages/auth/src/server/auth/src/sms-provider.ts` in the elizaOS monorepo has a `TwilioVerifyProvider` (SMS and WhatsApp) next to the plain `TwilioSmsProvider`. Phone OTP through Steward is the path with the least new code.
7. **Most of today's Network code is already keyed by a network id.** `PgStore` stores one state document per id (`network.network_state.id`, default `"nyc"`). Its advisory lock is `hashtext('network-tick-<id>')`. An id such as `slop:nyc` gives each app and city its own state and its own lock with no change to the lock logic. The problem is elsewhere. The snapshot loader, the members table, the copy and the STOP/HELP texts all assume one product.
8. **Blooio bans spread inside an org.** Blooio's `sibling_ban` slows every line in an org for 72 hours when one line in it is banned. An Apple ban on the dating line could slow the hiring line. Put each app's lines in its own Blooio org, or get Blooio to confirm in writing that keys isolate this.

---

## 1. What exists today

| Part | What it does now | What blocks four apps |
|---|---|---|
| `network` Postgres schema (`packages/observatory/db/schema.sql`) | Members, channel identities, facets, intents, presence, edges, opportunities, participations, review items, messages, feedback, events, matching runs, requests, staff audit; read-only and audit roles | No `app_id` column anywhere. `members.home_city` allows only `sf` and `nyc`. Phones are in `channel_identities`, keyed by member, so one phone cannot have two members (primary key `(channel, address)`). |
| `network-state.sql` and `PgStore` | One JSON state document per network id, normalized console rows, an advisory lock per id | Works per id. The console rows (`opportunities`, `requests`) have no app column. `city: "nyc"` is hard-coded in `consoleRows`. |
| `packages/network/service` | One `ConsentNetwork` per process. A tick every minute; the Blooio webhook; the staff API with role tokens and `network.staff_audit` | One network per process (`id` option). `loadSnapshot` reads every member. An unknown sender is dropped. STOP sets `members.opted_out`, which is one flag for everything. 11 hard-coded `"nyc"` strings. |
| `packages/network/src/copy.ts`, `packages/sim/src/channel.ts` | All member-facing text, STOP and HELP confirmations | Brand text ("the Network's agent", "unsubscribed from The Network") |
| `packages/core/src/policy.ts` | One age policy: under 13 declined, 13-17 single-player, 18+ full | It has no app argument. Dating and hiring need 18+ to join. |
| `packages/core/src/types.ts` | `City = "sf" \| "nyc"`, `Category` includes `romance` and `professional`, 12 edge types, 9 opportunity kinds | One ontology. Hiring needs roles and companies. Dating needs reciprocal preferences. |
| Observatory (`packages/observatory`) | Game mode, real mode (read-only), staff roles `admin/reviewer/safety/analyst`, Cloudflare Access JWT, PII reveal, audit, simulation lab | No app dimension in any route, role or view |
| `packages/plugin-network` | Eliza plugin with no state of its own: member context, `SET_STATE`, signals. The host injects the store and the authority (`memberId`) | No app in `NetworkTurnAuthority`. One character in Eliza Cloud (eliza-integration 3a). |
| `packages/blooio` | Signed webhook, keyword ledger (E.164), `FileConsentStore`, outbound queue with pre-send checks, one line (`BLOOIO_FROM`) | One line. The consent ledger is keyed by address only, so a STOP on one app would stop all apps. |
| `prototypes/connector-mcp` | OAuth discovery, surface profiles (`teen_safe_directory`, `general_assistant`, `enterprise_professional`) with category lists | Not in MVP. Its surface-profile idea is the right shape for app packs. |
| `sites/ntwrk.love` | Static Worker (assets only): landing page, privacy, terms with the SMS program | One site. No onboarding form; joining is invite-only by text. |
| `scripts/wrangler.sh` | Refuses changing commands without `NTWRK_ALLOW_DEPLOY=1` | Generic logic. The messages name only ntwrk.love. The account id is fixed. |

---

## 2. Multi-tenant data model

### 2.1 Design rule

**A member id belongs to one app.** Every app-scoped row hangs off a member id. When each app has its own member ids, facets, intents, presence, edges, opportunities, messages and feedback are separated by construction. The engine, the ConsentNetwork and the judges keep working on member ids with no change. Only the person layer knows that two member ids are the same human.

Other options considered:

| Option | Why not |
|---|---|
| One global member id with `app_id` on every facet, intent and edge | Every engine query and every judge must filter by app. One missed filter leaks dating data to hiring. Too easy to get wrong. |
| A database per app | Breaks "same database", same admin panel and one engine. Cross-app safety (a ban on one app) needs a second system. |
| A Postgres schema per app (`slop.*`, `peon.*`) | Better isolation, but four copies of every migration and of every console query. Keep this option for simulation worlds (section 6.4), not for production apps. |

### 2.2 New `platform` schema (cross-app)

The `network` schema keeps the engine tables. A new `platform` schema holds what is shared. Sketch (column lists are a minimum):

```sql
create schema if not exists platform;

-- The four apps and their policy switches.
create table platform.apps (
  id            text primary key check (id in ('ntwrk','slop','peon','buddies')),
  name          text not null,
  domain        text not null,
  min_join_age  int  not null,          -- ntwrk 13, the others 18 (section 2.6)
  min_match_age int  not null default 18,
  join_mode     text not null check (join_mode in ('invite','open','waitlist')),
  status        text not null default 'dev' check (status in ('dev','staging','live','paused'))
);

-- One human. No PII here.
create table platform.people (
  id              uuid primary key,
  lowest_age      int,                  -- lowest age the person ever stated or the record held (fail closed)
  age_verified_at timestamptz,          -- ID check, later
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz           -- tombstone after global delete (section 2.5)
);

-- The verified phone. The only place a phone number lives.
create table platform.phone_identities (
  e164         text primary key,
  person_id    uuid not null references platform.people(id),
  verified_at  timestamptz not null,
  method       text not null check (method in ('otp_sms','otp_whatsapp','inbound_message','staff')),
  line_type    text,                    -- from a carrier lookup: mobile, voip, landline
  last_seen_at timestamptz
);

-- A person's account in one app. member_id is the id in network.members.
create table platform.memberships (
  app_id     text not null references platform.apps(id),
  person_id  uuid not null references platform.people(id),
  member_id  text not null unique,
  state      text not null,             -- invited, onboarding, active, paused, restricted, removed
  joined_at  timestamptz,
  left_at    timestamptz,
  primary key (app_id, person_id)
);

-- Opt-in and opt-out per app and per line (section 4.3). app_id null = every app.
create table platform.consent_events (
  id        bigserial primary key,
  e164      text not null,
  app_id    text references platform.apps(id),
  line      text,                       -- the Blooio or Twilio sender that received the keyword
  state     text not null check (state in ('opted_in','opted_out')),
  source    text not null,              -- keyword, web_form, staff, reply
  wording   text,                       -- the opt-in text the person agreed to (10DLC proof)
  at        timestamptz not null
);

-- Explicit sharing of the base profile from one app to another (section 2.4).
create table platform.share_grants (
  person_id   uuid not null references platform.people(id),
  from_app    text not null references platform.apps(id),
  to_app      text not null references platform.apps(id),
  fields      text[] not null,          -- e.g. {first_name, city, interests}
  granted_at  timestamptz not null,
  revoked_at  timestamptz,
  primary key (person_id, from_app, to_app)
);

-- Blocks between people, across apps (safety, section 2.4).
create table platform.person_blocks (
  from_person uuid not null references platform.people(id),
  to_person   uuid not null references platform.people(id),
  origin_app  text not null,
  at          timestamptz not null,
  primary key (from_person, to_person)
);

-- Staff and their roles per app (section 5). app_id null = all apps.
create table platform.staff_roles (
  email      text not null,
  role       text not null check (role in ('admin','reviewer','safety','analyst','engineer','cross_app_safety')),
  app_id     text references platform.apps(id),
  granted_by text not null,
  granted_at timestamptz not null default now(),
  unique (email, role, app_id)
);

-- One audit log for staff and system actions on every app (section 8).
-- Append-only triggers, as on network.staff_audit.
create table platform.audit (like network.staff_audit including all);
alter table platform.audit add column app_id text;
```

### 2.3 Changes to the `network` schema

- Add `app_id text not null` to `members`, `opportunities`, `requests`, `matching_runs`, `events`, `messages` and `review_items`. Set the default to `'ntwrk'` only during the migration, then drop the default.
- Add `person_id uuid` to `members`, with a foreign key to `platform.people`.
- Add a composite unique key `(app_id, id)` on `members`. Change the foreign keys on facets, intents, presence, edges and participations to `(app_id, member_id)`, and add `app_id` to those tables. Then an edge from a `slop` member to a `peon` member is a constraint error, not a code review item.
- Change `members.home_city` from a check list to a reference table `platform.cities` (buddies is NYC only; ntwrk is SF and NYC).
- Keep `channel_identities` only as a mapping from a member to a line and a channel. The phone moves to `platform.phone_identities`. The read-only console role keeps no `select` on either table.
- `network_state.id` becomes `<app>:<city>` (`ntwrk:nyc`, `slop:nyc`, `buddies:nyc`, `peon:nyc`). `PgStore` needs no logic change; the lock key changes with the id.
- Facets: keep `privacy_scope`. Add `sensitive_class` for app-specific sensitive data: dating orientation and preferences, and the voluntary demographic data collected for a hiring bias audit. A sensitive class is never `shareable` and never leaves its app.
- App-specific objects get app-scoped tables in the `network` schema, keyed by `(app_id, ...)`:
  - `peon`: `orgs`, `roles` (job openings), `applications`.
  - `slop`: `dating_prefs` (who they want to meet, age range, dealbreakers). These are hard filters in both directions.
  - Do not create a schema per app for these. Each table names its app in a check constraint.

### 2.4 Cross-app privacy

Rules (proposed defaults; founders decide):

1. **Nothing crosses apps by default.** The engine snapshot for `peon:nyc` loads only `app_id = 'peon'` rows. The snapshot builder (`service/snapshot.ts`) takes the app as a required argument and filters every query.
2. **Base profile by explicit grant only.** At join, the person can share a base profile from an existing membership: first name, city, age band, and optionally interests. The person sees the list of fields and confirms each grant. A grant copies nothing. The snapshot builder reads granted fields through a view that joins `share_grants`. Revoking the grant removes the fields from the next snapshot.
3. **Sensitive classes never cross,** even with a grant (dating preferences, orientation, hiring demographics, safety notes).
4. **Blocks cross apps.** A block is person to person, so a person blocked on slop is never matched with the blocker on buddies or peon. This reveals nothing to the blocked person.
5. **Safety is partly global.** A safety case stays in its app. A safety hold at `removed` level (for example harassment or a minor contact attempt) also holds the person on every app. Only the `cross_app_safety` role can see the origin app. App staff see only "hold from another app". Founder decision: hiring may need a narrower rule (a dating complaint should not cost someone a job introduction without review).
6. **No enumeration.** The OTP flow, the join flow and the agent never tell anyone that a phone number is a member of another app. Same responses, same timing.
7. **New judge invariant: `cross_app_leak = 0`.** The simulator plants canary facts in one app (for example a dating preference) for a person who is in two apps. A canary that reaches the other app's messages, reviewer views or engine explanations fails the run, like today's canary leaks.

**Row-level security.** Use three layers:

- Composite foreign keys (section 2.3).
- An app argument that is required in every query builder.
- Postgres RLS on the console read roles: `network_observatory_<app>` gets a policy `using (app_id = '<app>')`. Use `force row level security`, and never let the table owner be the console login.

The engine service sets `set local app.app_id = '<app>'` in each unit of work. RLS policies on its write role check that setting, so one bad query in one network's unit of work cannot write another app's rows. RLS alone is not enough, because the owner and superusers bypass it.

### 2.5 Delete and export

| Action | Effect |
|---|---|
| Leave one app | The generalized `forget(member_id)` path runs. Today it exists only for an under-13 decline in `service.ts writeUnit`. It deletes the member's messages, feedback, events, facets, intents, presence, edges and app-specific rows. The membership row is set to `removed`. Other memberships and the phone stay. |
| Delete everything | Leave every app, then delete `phone_identities`, `share_grants` and the person's blocks as blocker. Keep a tombstone: `people.deleted_at`, plus a hash of the phone in a suppression list, so a STOP is never forgotten (the ntwrk.love privacy page already says that a minimal deletion record is kept). Backups expire within 30 days, as the current privacy page says. |
| Export one app | A JSON file with the member's own facets, intents, presence, opportunities, messages and consent events for that app. It never includes other members' private data. |
| Export everything | The union of the per-app exports, plus the person row and grants. |
| Hiring records | An employment agency may have to keep records for a set time. Ask counsel before deleting `peon` application and decision records on request. Keep the AEDT audit log (section 8) apart from member data. |

The text interface ("delete my data") must ask which app or all apps. The web settings page shows each membership.

### 2.6 Age policy per app

| App | Join | Matched with others | Note |
|---|---|---|---|
| ntwrk | 13+ | 18+ (today's rule) | Unchanged |
| slop | 18+ | 18+, mutual opt-in | Industry norm. No single-player mode for minors. |
| peon | 18+ (founders may choose 16+) | 18+ | Teen jobs add work-permit rules. Keep 18+ for the first version. |
| buddies | 18+ | 18+ | Meeting strangers. Do not copy the 13-17 single-player mode. |

- `policy.ts` gets an app argument: `canJoin(age, app)` reads `platform.apps.min_join_age`; `canBeMatched(age, app)` reads `min_match_age`. AGENTS.md says not to hard-code ages, and this keeps that rule.
- **Age is a person-level fact.** `people.lowest_age` holds the lowest age the person ever stated or that a record held, on any app. A person who says "I'm 15" on ntwrk cannot join slop later by saying 25. The rule is the same as today's "lowest age known" rule in network.md 6.3.
- An under-18 who tries to join slop, peon or buddies gets a kind decline, and nothing is stored for that app. Do not delete their ntwrk membership.
- Age verification (an ID check) stays post-MVP in the PRD. For slop, the founders should decide whether to require it before launch. Several states have age-verification laws for adult sites. Dating is not adult content, but check this with counsel (**not researched**).

### 2.7 Migration from today's schema

1. Add a migration runner first (runbook-real 1.2 says there is none). Use Drizzle with a `__network_migrations` ledger, as eliza-integration (e) proposes, or a 100-line SQL runner with a ledger table and an advisory lock. Today's files use `create table if not exists`, which never changes an existing table.
2. Create the `platform` schema and seed `platform.apps` with the four rows.
3. For each `network.members` row: create a `people` row; move the phone from `channel_identities` to `phone_identities` (method `inbound_message` or `staff`); create a `memberships` row (`app_id = 'ntwrk'`).
4. Add `app_id` columns with default `'ntwrk'`, backfill them, add the composite keys, then drop the defaults.
5. Rename the `network_state` row `nyc` to `ntwrk:nyc`. Change the default id in `PgStore` and the service.
6. Gate: the ntwrk simulation must give the same result before and after, with the same command and seed (`packages/network/harness/experiment.ts --days 21 --seed 1`). The ConsentNetwork must import the old state document with no change. No production database has the schema yet (runbook-real), so the migration runs only on dev and staging data now.

---

## 3. Identity and phone verification

### 3.1 Two ways to prove a phone

1. **Text to join (no OTP).** The person texts the app's line first. A message received from a number is proof of possession for iMessage and P2P SMS. Eliza Cloud already treats the first inbound message this way (eliza-integration 3f). It costs nothing per login. This is the main path, because every app is text-first.
2. **Web OTP.** The person types a phone number on the landing page and gets a code. This is needed for web settings, export and delete, and for people who start on the web.

### 3.2 Providers compared (US, prices as of 2026-10-07)

| Provider | US cost per login | Fraud controls | Fit |
|---|---|---|---|
| Twilio Verify | $0.05 per successful verification + $0.0083 SMS fee, about **$0.058**. WhatsApp +$0.0034. ([pricing](https://www.twilio.com/en-us/verify/pricing)) | Fraud Guard (SMS pumping) and rate limits free and on by default. Geo Permissions. ([Fraud Guard](https://www.twilio.com/docs/verify/preventing-toll-fraud/sms-fraud-guard)) | **Already in Steward** (`TwilioVerifyProvider`). Twilio owns the sender and its registration, so our 10DLC campaigns do not carry OTP traffic. |
| Steward (Eliza auth) | The provider's cost | Steward's code limits sends per phone and per IP and locks out after failed attempts (`phone.ts` comments) | Our own auth stack, and the PRD's default (32.1 "reuse Steward auth"). Steward is the session layer; Twilio Verify is the transport. |
| Prelude | EUR 0.032 per verification + carrier cost (about EUR 0.004 US) ([pricing](https://prelude.so/pricing)) | Basic anti-fraud on pay-as-you-go | Cheaper at volume. A second adapter behind Steward's `ManagedSmsOtpProvider` interface. |
| Clerk | $0.01 per SMS (US). Pro $25/mo. Satellite domains $10/mo each ([pricing](https://clerk.com/pricing)) | Bot protection; less control | A second user store next to `platform.people`. Satellite domains solve cross-domain SSO, but identity would move to a vendor. Not recommended. |
| Supabase Auth | Bring your own SMS provider; Pro $25/mo; Turnstile support | OTP rate limit 1 per 60 s | A second user store. Not recommended. |
| Stytch | Free to 10k MAU; SMS passed through at cost (US rate **unverified**) | Device fingerprinting add-on | Same objection as Clerk. |
| Firebase phone auth | $0.01 per SMS US ([pricing](https://firebase.google.com/pricing)) | reCAPTCHA | A Google user store. Not recommended. |
| Cloudflare | No phone OTP product. **Turnstile is free** ([plans](https://developers.cloudflare.com/turnstile/plans/)) | Turnstile in front of the send endpoint | Use Turnstile with any provider. |
| Blooio | No verification product. Inbound text is the proof (3.1). | Apple line safety | Text to join only |

**Recommendation:**

- Use Steward sessions with Twilio Verify as the web OTP transport, and keep Prelude as the fallback adapter.
- Accept "text to join" as verification. Record `method = 'inbound_message'`.
- Fight SMS pumping on the OTP endpoint:
  - Allow `+1` numbers only (Twilio Geo Permissions).
  - Put Turnstile in front of the send endpoint.
  - Allow at most 3 sends per number per hour and 10 per IP per hour, with backoff.
  - Refuse VoIP and landline numbers that a carrier lookup reports. This also cuts fake dating accounts.

### 3.3 Sessions across four domains

The four apps are on four registrable domains. A cookie set on slop.date is never sent to peon.biz, and browsers block third-party cookies, so a shared login cookie is not possible.

| Option | How | For | Against |
|---|---|---|---|
| **A. Separate login per domain (recommended first)** | Each site serves the auth API on its own domain (`slop.date/api/auth/*` routed to the shared API Worker) and sets a first-party `HttpOnly; Secure; SameSite=Lax` cookie. The same verified phone maps to the same person on the server. | Simple. No cross-site redirects. Visiting one app's site reveals nothing about the others. | The person enters an OTP once per app (rare, because the apps are text-first). |
| B. Central auth origin (OIDC-style) | `auth.<parent-domain>` holds the master session. Each app redirects there and gets a one-time code to exchange for its own first-party cookie. | One OTP for all four apps | The redirect tells the browser and the person that the apps are linked. Needs a neutral parent domain; do not run hiring login through a dating domain. More code. |
| C. Vendor satellite domains (Clerk) | The vendor syncs sessions across domains | Built | Vendor identity store; $10/mo per domain |

Start with A. Add B only if people use more than one app on the web. The SMS magic link ("the agent texts you a link to your settings", eliza-integration 1.4) is a signed, single-use token bound to the person and the app. It is redeemed on that app's domain only.

### 3.4 Linking a person across apps

- **Link key:** the verified E.164 number. The second app the person joins finds the existing `people` row and creates a new membership.
- **Tell the person.** At the second join, the agent says: "You already use [app] with this number. We keep them separate. Do you want to share your first name and city from there?" This is the base-profile grant (2.4). A person can also decline linking, which still uses the same person row (safety needs it), but shares nothing.
- **Recycled numbers.** Carriers give numbers to new owners. Before the server attaches a new membership to an existing person, it checks:
  - the carrier lookup for a recent port or SIM change (Twilio Lookup, priced separately, **not researched**);
  - `last_seen_at` older than 12 months.

  If either check fires, the person confirms a fact only the old owner knows, or staff review it.
- **Eliza Cloud users.** `network.members.cloud_user_id` stays. Join a `platform.people` row to a Cloud user only through a Steward-verified phone, never through `findOrCreateByPhone` alone (eliza-integration 3f: it creates a user for any texter).

---

## 4. Messaging

### 4.1 Lines

| Decision | Recommendation | Why |
|---|---|---|
| One line per app, or shared? | **One dedicated Blooio line per app** (and per city for ntwrk: SF and NYC) | The line's contact card (name and photo) is per line, so each app shows its own name in iMessage. Inbound routing is by line (4.4). STOP is per line (4.3). Apple's per-line safety limits (3 unanswered, 1 re-engagement after 14 days, about 20-50 new conversations a day) apply per app, not shared. |
| One Blooio org, or several? | **A separate org (or at least a separate key and pool) per app** | `sibling_ban` slows every line in the org for 72 hours when one line is banned (blooio.md). Dating lines carry the most ban risk. Ask Blooio whether a separate key in one org avoids `sibling_ban`. |
| The existing line +1 808-788-1821 | Do not use it for any app | It already has real Eliza conversations (blooio.md, 2026-10-07 live check) |
| SMS fallback | Twilio 10DLC numbers per app, where a campaign is approved (4.2) | Blooio's own SMS fallback is P2P from an iPhone and is not registered A2P traffic |

Cost: Commercial Dedicated is $289 per line per month; Enterprise is $195 per line at 6 or more lines ([pricing](https://www.blooio.com/pricing), 2026-10-07). Five lines (ntwrk SF and NYC, slop, peon, buddies) cost $1,445/mo on Commercial, or about $975/mo on Enterprise if Blooio allows Enterprise pricing across orgs. Custom area codes cost $75 each, one time.

Alternatives for a line: Sendblue ($100/mo per line, but outbound-first messaging needs the Enterprise plan) and LoopMessage (from $20/mo; **unverified** on its own site).

### 4.2 10DLC registration

Rules (as of 2026-10-07; [Tychron guide](https://www.tychron.com/guides/10dlc-registration/), updated 2026-08-17; [Twilio FAQ](https://help.twilio.com/articles/14910496447771-Shutdown-of-Unregistered-10DLC-Messaging-FAQ)):

- Carriers have blocked all unregistered 10DLC traffic since 2025-02-01.
- **One brand** per legal entity (Eliza Research Corporation, per the ntwrk.love site): $4.50 one time + $41.50 standard vetting.
- **One campaign per app.** Each campaign costs $15 per vetting attempt (a rejection is billed too) and $10/mo for the Standard or Mixed use case. A brand can have several campaigns, and many numbers can share a campaign.
- Each campaign's brand name, website, sample messages, opt-in flow, privacy policy and terms must match each other. The privacy policy must say that mobile numbers and opt-in data are not shared with third parties or affiliates for marketing ([Twilio 30908](https://www.twilio.com/docs/api/errors/30908)). The ntwrk.love privacy page already has this sentence; copy it to every app.
- Timeline: 24-72 hours for a clean submission; a rejection adds 1-2 weeks.
- **slop.date risk:** Twilio 30953 rejects websites with dating content as SHAFT, with no resubmission. Do not submit slop's campaign until Twilio or the aggregator says in writing how a non-adult dating service is classified. Whether a rejection of one campaign affects the brand's other campaigns is **unverified**. A safe order is: ntwrk, buddies, peon, then slop.
- Separate brands (separate legal entities) per app are an option if slop puts the brand at risk. Founder and counsel decision.
- Alternatives: toll-free verification (number $2.15/mo, about 2-4 weeks; a submission fee is **unverified**); short codes (about $1,000-1,500/mo and 8-12 weeks, secondary sources).

### 4.3 STOP per app or global

Rules today:

- CTIA treats opt-out per program (campaign). Carriers and Twilio enforce it per sender number or Messaging Service.
- Since 2025-04-11 the FCC TCPA rule requires honoring an opt-out sent by "any reasonable means".
- A further FCC rule would apply one opt-out to all of a sender's unrelated messages. It is **reportedly delayed to January 2027 (unverified).** When it applies, a STOP on slop may legally have to stop peon too if both apps are the same sender (the same legal entity).

Proposal:

1. **A STOP on an app line opts out of that app only.** The confirmation says so and gives the global option: "You're unsubscribed from slop.date. Other apps you use with this number are not affected. Reply STOP ALL to stop every app." Ask counsel to approve this wording.
2. **STOP ALL** (already in `STOP_WORDS`) writes `consent_events` with `app_id = null`, which stops every app.
3. The ledger reads the last event per `(e164, app_id)` and per `(e164, null)`. A global opt-out wins over an app opt-in until the person sends START on that line. START on one line opts in to that app only.
4. **Keep a switch for the FCC rule.** `PLATFORM_STOP_SCOPE = app | global`. When counsel says the revoke-all rule applies, set it to `global`. Each app's line then treats STOP as STOP ALL.
5. The consent ledger moves from `FileConsentStore` to `platform.consent_events`, as the prototype comment already plans ("Production should use Postgres").
6. **One owner per inbound message** (service README, rule 1). The founder must decide whether the gateway or the Network service answers STOP/HELP before any live send. With four lines, use the same owner for all four.
7. A bare "CANCEL" is STOP (network.md 11). Dating and hiring texts will invite "cancel" replies (a date, an interview). Each app's copy must avoid asking people to reply "cancel".

### 4.4 Inbound routing by line

- Add a table `platform.app_lines(line_e164, app_id, city, provider, env)`. The Blooio webhook payload names the receiving line, which maps to the app.
- Use one webhook URL per app (`/webhooks/blooio/<app>`), each with its own secret. Eliza's gateway already routes by project (`/webhook/:project/:platform`, env prefix `<PROJECT>_BLOOIO_*`; eliza-integration 0 and 3d). So `slop`, `peon` and `buddies` become gateway projects with no new adapter.
- **Unknown sender on an app line:** today the service drops it and stores nothing. With four apps, an unknown sender is the join funnel:
  - On an `open` app, the message starts that app's onboarding.
  - On an `invite` app (ntwrk), the agent sends a short invite-only reply and stores nothing.
- A known person who texts a new app's line gets a new membership after the age check (2.6) and the link notice (3.4).

### 4.5 Agent character per app

Eliza Cloud has one hard-coded character and plugin list (eliza-integration 0). Per app:

- **Character.** `networkSharedAgent(identity, app)` returns an inline character per app pack (name, voice, bio, rules). Example voices: "the Network's agent" (ntwrk), a dating matchmaker (slop), a recruiter (peon), and a NYC friend (buddies).
- **Agent id namespace per app** (`slop:<uuidv5(org:user)>`), so each app has its own Durable Object room and history. A dating conversation must never be in the hiring agent's context.
- **Plugin.** `NetworkTurnAuthority` gets `appId` next to `memberId`, set by the host from the line, never from model output. `NetworkStore` calls are app-scoped.
- **Copy.** `packages/network/src/copy.ts` and the STOP/HELP texts become per app-pack files. Every new text needs the CONTRIBUTING.md 3.5 videos.

---

## 5. Admin panel

Build on the Observatory (`packages/observatory`) and the service staff API. Do not start a second console.

| Feature | Change |
|---|---|
| App switcher | A top-bar control (`ntwrk / slop / peon / buddies / all`). Every API route takes `app`. Real mode connects with the app's RLS read role (`network_observatory_<app>`). The banner shows the app and the environment ("SLOP · PRODUCTION · read-only"). |
| Per-app views | The current modules (review queue, Member 360, timeline, pipeline, run inspector, safety, requests, metrics, configuration, audit, lab) run per app with no change, because they already work on one network. Each app pack adds its own Member 360 panels: a hiring role and applications for peon, dating preferences (hidden by default) for slop. |
| Cross-app person view | A new page, reachable only with `cross_app_safety` or `admin`. It shows the person's memberships, per-app states, global holds and blocks. Each app's data is a separate, collapsed panel. Opening one needs a typed reason and writes an audit row first (the current PII reveal rule, admin-console 4.4). No reviewer ever sees it. |
| Per-app review queues | One queue per app, each with its own rubric and reason codes (for example `not_qualified` for peon and `preference_mismatch` for slop), and its own SLA. A reviewer holds a role per app. A hiring reviewer never sees dating items. |
| Per-app experiments | The simulation lab runs `experiment.ts` with an app pack and shows that app's judge counts, including `cross_app_leak`. The run diff compares arms within one app. |
| Matching switch | One switch per network id (`slop:nyc`), admin only, logged (today's `POST /matching`). |
| Health | Per app: review backlog, SLA misses, send failures, line safety state (Blooio `safety.*` webhooks), LLM spend. |

### 5.1 RBAC

- Roles become `(role, app)`. `OBSERVATORY_ROLES="email:role"` becomes `email:role@app` or `email:role@*`, read from `platform.staff_roles` in production.
- Every route checks the role for the app in the request. `admin@*` keeps "admin passes every check".
- New roles:
  - `cross_app_safety`: the cross-app person view and global holds.
  - `engineer`: missing today (admin-console 4.1). It gets simulated worlds only.
- Fix the gap that matters most first: the service records its own token as the reviewer, not the person (admin-console gap 1). With four apps and per-app reviewers, the reviewer of record must be the signed-in person.
- Cloudflare Access stays the first gate: one Access application for the console, a policy per staff group, and a second factor.

---

## 6. Engine service

### 6.1 One service, many networks

- **Registry.** Add `platform.networks(id, app_id, city, matching_enabled, run_hour, pack_version)`. Rows: `ntwrk:sf`, `ntwrk:nyc`, `slop:nyc`, `peon:nyc`, `buddies:nyc`.
- **Service.** `NetworkService` holds a map from network id to `ConsentNetwork`, not one network. The one-minute tick loop goes through the networks. Each network ticks under its own advisory lock. A slow network does not block the others: give each network its own tick, so a second process can take another network while one is busy.
- **Snapshot.** `loadSnapshot(sql, now, { app, city })` filters by app (and by city through presence).
- **Inbound.** The receiving line gives the app (4.4). The phone gives the person, then the membership, then the member id. The message is one unit of work on that app's network.
- **Scale.** The current state is one JSON document per network, saved on every unit of work. That is fine for the pilot (hundreds of members per network). Measure the save time at 2,000 members per network before any app launches widely. Move to normalized tables only if the measurement says so.

The second option (one service process per app) gives stronger fault isolation at about $10/mo more per app on Railway. Start with one process. Split when one app's load or incidents affect the others.

### 6.2 App packs

An app pack is a typed module per app, in `packages/apps/<app>/` (new) or as a folder in `packages/engine`. The surface profiles in `prototypes/connector-mcp/src/profiles.ts` are the model: a versioned object with category lists and policy switches.

```ts
interface AppPack {
  id: "ntwrk" | "slop" | "peon" | "buddies";
  version: string;
  ontology: { facetKinds: FacetKind[]; categories: Category[]; taxonomy: InterestDef[]; extraObjects?: string[] };
  onboarding: { questions: OnboardingStep[]; readBack: boolean };
  opportunityKinds: OpportunityKind[];      // slop: "date"; peon: "candidate_intro", "role_match"; buddies: "group", "plan", "crew"
  hardFilters: Filter[];                    // slop: reciprocal preferences, both 18+, mutual opt-in; peon: role location, work authorization
  scoring: Partial<EngineConfigInput>;      // weights per pack
  outreach: { capPerWeek: number; quietHours: [number, number] };
  reviewRubric: { reasons: string[]; slaHours: number };
  copy: CopyPack;                           // every member-facing text, STOP/HELP included
  character: CharacterSpec;                 // the Eliza persona (4.5)
  ageMin: { join: number; match: number };  // mirrors platform.apps (2.6)
  sim: { generator: PersonaGenerator; scenarios: string[]; judges: string[] };
}
```

What each pack needs from the engine:

- **buddies:** closest to today's engine (groups, plans, crews, NYC). Build it second, after ntwrk. It reuses `plans.ts`, the attention budget and the booked-plan flow almost unchanged.
- **slop:**
  - 1:1 dates.
  - Two-way hard filters: each side's gender and orientation preferences and age range must accept the other.
  - Double opt-in. The current consent-first probe and booked plan fit.
  - A safety layer: report, block, and a check-in after the date.
  - The `romance` category and the "romance only between adult mutual opt-ins" filter are already in PRD 33.5.
- **peon:**
  - Two-sided: candidates and orgs with roles.
  - New objects (roles, applications).
  - The engine ranks candidates for a role. That ranking is what makes it an AEDT (section 8).
  - Human review stays on every introduction.

### 6.3 Schedules

- Each network has its own `run_hour` and time zone. Today the engine runs at 09:00 New York inside the tick.
- Send windows, quiet hours and caps are per app pack. A person in three apps can get three apps' messages, so add a **person-level daily cap** across apps in the outbound queue (for example at most 3 proactive messages a day across all apps). It is checked at send time like today's per-member caps.

### 6.4 Simulation, demos and experiments per app

| Need | Where it runs | Data |
|---|---|---|
| Unit and scenario tests | In memory (`MemoryStore`, `SimBus`) | The pack's persona generator and scenarios |
| Experiments (`experiment.ts`, lab runs) | In memory, logs in `runs/` | Per pack, same seeds, same judges plus the pack's judges |
| Observatory real-mode practice on a database | Local dev Postgres (port 54339) or staging, **one Postgres schema per sim world** (`sim_<app>_<seed>`), built from the same migrations with `search_path` | Synthetic people only |
| Public demo on each landing page | **Static replay** of a recorded sim run (JSON in the site's assets) | Synthetic, scrubbed. No live LLM, no database, no real person. |
| Reviewer training | Staging, per app | Sim worlds and test numbers |

- **Separate schemas, not namespaces in shared tables.** A namespace column (`world = 'sim'`) puts synthetic rows next to real ones, and one missed filter mixes them. A schema per world is dropped in one statement and cannot join to real rows by accident.
- **Production never holds sim data.** PRD 31.5 already forbids sim traffic in production. Keep the existing guards (`seed.ts` refuses non-local hosts; the service refuses `review: "auto"`), and add one more: a check constraint that refuses synthetic phone ranges (+1 555 01xx) in production `phone_identities`.
- **Persona generators per app.** `packages/sim/src/taxonomy.ts` holds Network interests and skills. Each pack needs its own hidden truth:
  - slop: attraction, preferences, dealbreakers.
  - peon: skills, seniority, wanted roles, and employer needs.
  - buddies: neighborhoods, routines, social energy.
- The oracle and the judges read the pack's truth. The adversarial personas must include app-specific attacks: romance scams, fake recruiters asking for money or SSNs, and minors who claim to be 18.

---

## 7. Environments

| | Local | Staging | Production |
|---|---|---|---|
| Database | dev-pg on port 54339 (never 54329). Sim worlds as schemas. | Separate Railway Postgres. Sim worlds as schemas. Test numbers. | Railway Postgres with `network` and `platform`. Read replica for the console. No sim schemas. |
| Lines | `SimBus` or dry-run adapter | One test Blooio line per app or dry-run. Twilio test credentials. | One dedicated line per app (4.1) |
| Sends | Dry-run | Dry-run by default. Live only to staff test phones. | Live only with `BLOOIO_ALLOW_SEND=1` and `NTWRK_LIVE_APPROVED=1` (founder). Add a per-app flag: `<APP>_LIVE_APPROVED`. |
| Sites | `wrangler dev` | `staging.<domain>` behind Cloudflare Access | `<domain>` |
| Console | Game mode and local real mode | Real mode, `OBSERVATORY_ENV_LABEL=STAGING` | `OBSERVATORY_REAL_ONLY=1`, Access, per-app RLS roles |
| Review | `auto` allowed in the simulator | `human` | `human` only (the service refuses others) |

The staging and production Cloudflare deploys go through `scripts/wrangler.sh`. Each one needs `NTWRK_ALLOW_DEPLOY=1` and founder approval. Nothing in this plan was deployed.

---

## 8. Security and compliance per app

### 8.1 All apps

- **Audit.** `platform.audit` is append-only (the triggers from `network.staff_audit`) and has `app_id`. It records every staff read, reveal, review, safety action, configuration change, share grant, membership change, delete and export. The audit login can only insert and select.
- **Leak guard per app.** Every outbound message goes through the leak guard (`packages/core/src/guard.ts`). The forbidden lists come from the same app. Cross-app canaries are added in the simulator (2.4 rule 7).
- **Secrets.** Each app's Blooio key, webhook secret and Twilio credentials are separate Railway variables (`SLOP_BLOOIO_API_KEY`, ...). The gateway's `<PROJECT>_KEY` convention already does this.
- **Legal pages per app:** terms, privacy, SMS terms, community guidelines. Each must match its 10DLC campaign.

### 8.2 slop.date (dating)

- **State dating-safety laws.** NY GBL 394-cc, the NJ Internet Dating Safety Act, Illinois 815 ILCS 518, Texas Bus. & Com. Code ch. 106 and the Utah Online Dating Safety Act require a safety-awareness notice. They also require a clear statement of whether the service runs criminal background checks. Texas requires bold capitals in 12-point type or larger. Illinois requires the words "not foolproof" if you screen. ([NJ](https://www.njconsumeraffairs.gov/statutes/internet-dating-safety-act.pdf), [TX](https://tcss.legis.texas.gov/resources/BC/htm/BC.106.htm).) A California equivalent is **unverified**.
- **Safety reports.** Report and block by text in every conversation. A safety case per report, with evidence kept (the current safety console). A check-in after each date. Romance-scam signals (money requests, moving off-platform fast) go to the safety classifier.
- **Sensitive data.** Orientation and sexual preferences are sensitive personal information under CPRA. Store them in `sensitive_class` facets, encrypted at the column level. They never leave the app and are never shown to reviewers without a reveal.
- **Age.** 18+ to join (2.6). Decide on ID verification before launch.

### 8.3 peon.biz (hiring)

- **NYC Local Law 144 (AEDT):**
  - An independent bias audit less than one year old before the tool is used for NYC jobs.
  - A public summary of the audit.
  - Notice to candidates at least 10 business days before use.
  - Penalties up to $1,500 per violation. The 2025-12-02 State Comptroller audit pushed the city agency (DCWP) toward proactive enforcement in 2026 ([DLA Piper](https://knowledge.dlapiper.com/dlapiperknowledge/globalemploymentlatestdevelopments/2026/New-York-Critical-audit-of-New-York-Citys-AI-hiring-law-signals-increased-risk-for-employers)).
- **Illinois** (HB 3773, from 2026-01-01): notice when AI is used in employment decisions, no discriminatory effect, and no zip codes as a proxy. The AI Video Interview Act applies only if peon uses video. **Colorado** SB 26-189 starts 2027-01-01.
- **What to build:**
  - A decision log per candidate-role ranking: the inputs used, the score, the explanation and the reviewer's decision. Make it append-only and keep it apart from member data.
  - Voluntary demographic self-identification for the bias audit, stored apart, used only for the audit, and never given to the engine or to reviewers.
  - A candidate notice and an opt-out to a human-only process.
  - A per-org record of which roles are NYC roles.
  - Leave peon matching off for NYC roles until the audit is done.
- Fake recruiters are the main abuse: verify each org before its roles go live. Never let an org ask a candidate for money or an SSN through the agent (leak-guard patterns).

### 8.4 buddies.nyc

- Meeting strangers: public venues only (the plans planner already uses public venues), groups before 1:1, report and block, and a check-in after a plan.
- 18+ only.

---

## 9. Phased build plan

Owners are packages. "Founder" marks a decision or a credential only the founders hold.

### Phase 0: decisions (week 0, founder)

- Approve the scope and add it to the PRD (AGENTS.md hard rule).
- Domains: ntwrk.club (owned or not), buddies.nyc (nexus address), and a neutral parent domain for the console and option B auth.
- Legal entity per app, or one entity. Counsel on the slop 10DLC classification, the FCC revoke-all date, AEDT for peon and the dating notices.
- STOP scope (4.3) and the STOP/HELP owner (gateway or service).
- Age per app (2.6). Cross-app safety holds (2.4 rule 5).
- Launch order. Proposal: ntwrk, then buddies, slop and peon.

### Phase 1: platform core with no change in behavior (weeks 1-3)

| Work | Owner |
|---|---|
| Migration runner and ledger | `packages/observatory/db` (schema owner), ops |
| `platform` schema; `app_id` and composite keys in `network`; migrate ntwrk | schema |
| `AppId`, `canJoin(age, app)`, `canBeMatched(age, app)`, cities table | `packages/core` |
| Service with many networks, app-filtered snapshot, `<app>:<city>` ids, no hard-coded `"nyc"` | `packages/network` |
| `cross_app_leak` invariant and two-app personas | `packages/sim`, `packages/sim/src/judge` |

Milestone: the ntwrk 21-day run (seed 1) gives the same results, with 0 leaks, 0 violations and 0 minor contacts. A two-app sim world shows 0 cross-app leaks.

### Phase 2: identity, consent, lines (weeks 2-5)

| Work | Owner |
|---|---|
| `platform.consent_events` ledger, STOP per app and STOP ALL, line-to-app routing, per-app webhooks | `packages/blooio` (then `packages/network/service`) |
| Steward phone OTP with Twilio Verify, Turnstile, rate limits, `+1` only, per-domain sessions | Eliza `packages/auth` and Cloud routes (eliza-integration 3b, 3f) |
| Text to join, join by line, link notice, age check per app | `packages/network/service`, `packages/plugin-network` |
| Buy lines; 10DLC brand; campaigns for ntwrk and buddies | Founder (credentials) |

Milestone: in staging, a test phone joins two apps. STOP on one app leaves the other active. Export and delete work per app.

### Phase 3: buddies.nyc (weeks 4-7)

| Work | Owner |
|---|---|
| buddies app pack: copy, character, onboarding, sim generator and scenarios | `packages/engine`, `packages/sim`, `packages/network` |
| `sites/buddies.nyc`, shared site parts, legal pages, a static demo replay | `sites/` |
| App switcher, per-app roles, per-app review queue | `packages/observatory`, `packages/network/service` |

Milestone: 30 simulated days at the launch gates. Shadow mode on staff seeds. Founder approves the launch.

### Phase 4: slop.date (weeks 6-10)

| Work | Owner |
|---|---|
| slop pack: two-way preference filters, date flow, check-ins, safety classifier signals, dating notices | `packages/engine`, `packages/network`, `packages/core` |
| Sensitive-class encryption, cross-app person view, `cross_app_safety` role | schema, `packages/observatory` |
| 10DLC answer from counsel and the aggregator; ID-verification decision | Founder |

Milestone: launch gates plus dating notices published, plus a rehearsed safety on-call.

### Phase 5: peon.biz (weeks 8-14)

| Work | Owner |
|---|---|
| Orgs, roles, applications, candidate-role ranking, decision log, demographic store | schema, `packages/engine`, `packages/network` |
| Bias audit by an independent auditor; candidate notice; NYC roles off until done | Founder, counsel |
| Org verification and fake-recruiter scenarios | `packages/sim`, `packages/network` |

Milestone: the audit summary is published before any NYC role is matched.

### 9.1 Risks

| Risk | Effect | Mitigation |
|---|---|---|
| Scope against the MVP | The ntwrk pilot slips | Phase 1 changes no behavior. Do the ntwrk launch gates first. |
| slop 10DLC rejected (SHAFT) | No A2P SMS for slop. A possible brand effect (**unverified**). | Ask first. Submit slop last, or under a separate brand. Use iMessage first. |
| Apple bans a dating line | Other lines slowed by `sibling_ban` | Separate Blooio orgs. Keep under the 20-50 new conversations per day. |
| Cross-app leak | Trust and legal harm | Member ids per app, composite keys, RLS, the `cross_app_leak` invariant |
| Account enumeration and recycled numbers | Someone learns or takes over another person's accounts | Same responses on every path; a lookup and a challenge on dormant numbers |
| AEDT non-compliance | Fines; a ban on use in NYC | Audit before NYC matching; decision log |
| Human review load times four | Review SLAs missed; items expire unsent | Per-app reviewers; an SLA alert per app; review stays required below 1,000 members per app (founder rule) |
| One JSON state document per network | Slow saves at scale | Measure at 2,000 members before wide launch |
| ntwrk.club not owned | Branding | Keep ntwrk.love |
| FCC revoke-all rule | STOP per app becomes illegal | `PLATFORM_STOP_SCOPE` switch (4.3) |

### 9.2 Monthly cost estimate (pilot: about 500 members per app, 2,000 people)

| Item | Estimate | Basis |
|---|---|---|
| Blooio lines | $975-1,445 | 5 dedicated lines, Enterprise or Commercial (4.1) |
| Web OTP | about $15-60 | $0.058 per Twilio Verify login. Most joins are by text (free). 250-1,000 web logins a month. |
| Twilio A2P SMS fallback | about $40 + usage | 4 campaigns × $10/mo; SMS about $0.0083 + carrier fee about $0.003-0.0045 per segment; setup about $46 + $15 per campaign attempt |
| Inference (gpt-6-luna) | about $20/mo billed, up to about $180 at list price | $3/mo billed (up to $27 worst case) per 300 members, measured in the PoC validation (summary in `docs/results/SUMMARY.md`); scaled linearly to 2,000 |
| Hosting | about $60-150 | Railway Pro $20 + Postgres and 2 Bun services (about $10-30 each); Cloudflare Workers Paid $5; Neon or Fly as alternatives (Fly Postgres from $38) |
| Domains | under $10/mo | Renewals |
| One-time | Bias audit for peon: an outside auditor (cost **not researched**); counsel; $75 per custom area code | — |

Total: about $1,100-1,900 a month. Blooio lines are 75-85% of it. Human reviewers and safety on-call staff are the larger real cost, and they are not in this table.

---

## 10. Open questions

1. Who owns ntwrk.club?
2. Should each app be a separate legal entity (10DLC brand, FCC "sender", liability)?
3. Can Blooio give each app its own org, or confirm that `sibling_ban` stays inside one key?
4. How does Twilio classify a non-adult dating service under the SHAFT rules, and does a rejected campaign affect the brand?
5. Are joins invite-only on every app, or open on slop, peon and buddies?
6. Should a safety removal on one app apply to hiring?
7. Is peon an employment agency for record-keeping purposes?

---

## 11. Summary (20 lines)

1. A four-app platform is outside PRD 28.3. The founders must approve it and add it to the PRD before any code.
2. ntwrk.club is registered to a third party at GoDaddy (locked to 2027-02). Keep ntwrk.love unless the founder owns ntwrk.club.
3. slop.date and peon.biz are registered at Cloudflare (probably ours). buddies.nyc looks free but needs a public NYC street address.
4. Data model: a `platform` schema (apps, people, phone identities, memberships, consent, grants, blocks, staff roles, audit) plus `app_id` in `network`.
5. A member id belongs to one app. Composite keys, an app-filtered snapshot and RLS keep dating data out of hiring by construction.
6. Only a base profile crosses apps, and only by explicit grant. Sensitive classes never cross. Blocks are global.
7. Age is a person-level fact (lowest age known). ntwrk stays 13+ single-player; slop, peon and buddies are 18+ to join.
8. Migration: add a runner first, backfill `app_id = 'ntwrk'`, rename state `nyc` to `ntwrk:nyc`, and prove the same sim result with the same seed.
9. Identity: text to join is the main proof (free). Web OTP is Steward with Twilio Verify (about $0.058 per login), which the Eliza auth code already has.
10. Anti-pumping: `+1` only, Turnstile, 3 sends per number and 10 per IP per hour, and refusal of VoIP numbers.
11. Sessions: a first-party cookie per domain with the auth API on each domain; a central auth origin only later. Same phone, same person on the server.
12. Messaging: one dedicated Blooio line per app ($195-289/mo each), ideally in separate Blooio orgs because of `sibling_ban`.
13. 10DLC: one brand, one campaign per app ($15 vetting + $10/mo). Twilio rejects dating websites as SHAFT, so ask before submitting slop.
14. STOP stops one app, and STOP ALL stops every app. A switch makes STOP global if the FCC revoke-all rule applies (reportedly January 2027).
15. Inbound routes by receiving line. On an open app, an unknown sender starts onboarding. Each app has its own Eliza character and agent-id namespace.
16. Admin: the Observatory gets an app switcher, per-app roles (`role@app`), per-app review queues and a reason-gated, audited cross-app person view.
17. Engine: one service runs a ConsentNetwork per `<app>:<city>` under its own lock. App packs carry ontology, filters, copy, persona and sim.
18. Sims: a Postgres schema per sim world in dev and staging, static demo replays on landing pages, never sim data in production, and a new `cross_app_leak = 0` invariant.
19. Compliance: peon needs an LL144 bias audit before NYC matching. slop needs state dating-safety notices. All apps share an append-only audit.
20. Order: platform core, identity and lines, buddies, slop, then peon (about 14 weeks). About $1,100-1,900/mo, mostly Blooio lines; reviewers cost more.
