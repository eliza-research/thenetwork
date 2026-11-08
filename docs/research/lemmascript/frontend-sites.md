# LemmaScript survey: public sites (`sites/`)

Hand-written by a research agent, at commit a0ed7bc, then checked by a second, skeptical agent. No maintainer reviewed it.
Nothing in `sites/` was changed. This report is the only repo file from this work.

Trials are in `/private/tmp/claude-501/-Users-nubs-thenetwork/0b7e16cc-5a52-420a-9076-9f674ab17544/scratchpad/trials/sites/`.
The first pass is in `/private/tmp/claude-501/-Users-nubs-thenetwork/0b7e16cc-5a52-420a-9076-9f674ab17544/scratchpad/trials/frontend-sites/`.
Every trial used `lsc check --backend=dafny <file>` through the throttled wrapper, one run at a time.
The trials are copies or extractions. No proof below applies to the shipped file until the extraction lands.

**Result in short.** The sites hold little pure logic, and most of it sits in DOM handlers.
After review, 3 of 9 candidates stay. Candidate 1 (client and server phone parity) has the most value and the least cost.
Each of the 3 failed on shipped logic and proved on a fixed copy. Candidates 2 and 3 have lower value than a plain e2e case.
The other 6 are rejected. Four of those proved, but their contracts only restate the code or guard nothing of value.
Bug reproduction: 8 of 11 bugs ran on shipped code. B3 and B4 are confirmed in part. B11 is latent and read only.
No bug was refuted. Two bug rows changed: B1 is now Medium, and the effect of B4 was too strong.

Overlap note: another session handles non-UI join and routing logic in `sites/shared` and `deploy/`.
Items marked **[overlap]** belong to both slices. Agree an owner before anyone changes them.

## 1. File and function inventory

Verdicts: **VIP** = verify in place. **EXT** = extract, then verify. **N/A** = not applicable, with the reason.

### sites/shared/api.ts

| Location | Purpose | Verdict |
|---|---|---|
| `api.ts:8` `ApiError` | Union of error keys | VIP as a type. It becomes a Dafny enum. |
| `api.ts:30` `PLATFORM_ERRORS` | Platform code to message key | N/A. Data. The model reads a `Record` as a map with no prototype chain, so it cannot see bug B5. |
| `api.ts:66-113` `Result`, `AppInfo`, `Membership`, `Participation`, `Me`, `JoinBody` | Wire types | N/A. Types only. |
| `api.ts:115` `call` | fetch wrapper and error mapping | EXT. `await`, fetch and JSON are out of the subset. The status mapping is pure, but its contract only restates it (rejected, R2). **[overlap]** |
| `api.ts:146` `api` | One-line endpoint wrappers | N/A. Plumbing. Most of them have no caller on any page (section 4, dead code). |
| `api.ts:167` `toE164` | US phone normalizer | EXT. Regex blocks it in place. Candidate 1. **[overlap]** |
| `api.ts:176` `MESSAGES` | Error text | N/A. Copy. A key check is already a type check. |

### sites/shared/agent.ts

| Location | Purpose | Verdict |
|---|---|---|
| `agent.ts:7` `copy` | Clipboard write, with select fallback | N/A. Clipboard and DOM. |
| `agent.ts:22` `Device` | Type | N/A. Type only. |
| `agent.ts:29` `device` | UA and touch points to device class | N/A. Only regex tests plus a two-term boolean. `sites/test/sites.test.ts:333` covers the four real cases. |
| `agent.ts:36` `mountAgents` | Wires landing clicks, timeout and toasts | N/A. DOM, events and timers. |
| `agent.ts:88` module call | Mounts on load | N/A. Glue. |

### sites/shared/auth.ts

| Location | Purpose | Verdict |
|---|---|---|
| `auth.ts:13` `maskPhone` | Shows last four digits | N/A. It would verify in place, but the property has no value (rejected, R3). |
| `auth.ts:17` `mountAuth` | Finds auth mode, then OTP or cloud UI | N/A. One boolean choice, and the retry loop has `await`. See bug B11 for the cloud branch. |
| `auth.ts:26` `lookup` (closure) | Mode lookup with backoff | N/A. Real `await` and timers. |
| `auth.ts:63` `mountOtpAuth` | Phone, code, resend, change number | EXT. The step changes join the reducer in candidate 2. |
| `auth.ts:128` resend handler | New code, or back to phone with Turnstile on | EXT into the same reducer. |

### sites/shared/demo.ts

| Location | Purpose | Verdict |
|---|---|---|
| `demo.ts:14` `readDemo` | Validates an `unknown` demo payload | N/A. `unknown` input is out of model, and no page loads the module. Delete it rather than verify it. |
| `demo.ts:25` `mountDemo` | Renders the replay | N/A. DOM. Dead code. |
| `demo.ts:49` module call | Mount on load | N/A. Dead code. |

### sites/shared/join.ts

| Location | Purpose | Verdict |
|---|---|---|
| `join.ts:12` `start` | Shows the phone step | N/A. One DOM call. |
| `join.ts:16` `flowError` | Page-level error | N/A. DOM. See bug B8. |
| `join.ts:23` `block` | Reason to blocked screen | N/A. Rejected (R1). |
| `join.ts:31` `route` | `Me` to step | N/A. Rejected (R1). Candidate 2 has it as a helper. **[overlap]** |
| `join.ts:43` `mountJoin` | The whole Join flow | EXT. Candidates 2 and 3. The shell stays unverified. |
| `join.ts:54` `resetAccount` (closure) | Clears form and account marker | EXT. The clear rule is in candidate 2. |
| `join.ts:57` `prefill` (closure) | Claims the server draft | N/A. Real `await` and fetch. It cannot run in production (section 4, dead code). |
| `join.ts:118` submit handler | Validates, posts, branches on result | EXT. Validation is candidate 3, branching is candidate 2. Regex and FormData stay in the shell. |
| `join.ts:189` module call | Mount on load | N/A. Glue. |

### sites/shared/prefill.ts, turnstile.ts, ui.ts

| Location | Purpose | Verdict |
|---|---|---|
| `prefill.ts:2` `prefillJoin` | Fragment to name and age fields | EXT for the age rule only. `URLSearchParams` and DOM are out. Low value. The bug is in the caller (B2). |
| `turnstile.ts:26` `siteKey` | Reads the meta key | N/A. DOM read. |
| `turnstile.ts:32` `load` | Loads the script once | N/A. Promise, DOM and a module-level mutable. |
| `turnstile.ts:45` `mountTurnstile` | Widget and token state | N/A. Rejected (R4). |
| `ui.ts:10` `$` | querySelector | N/A. DOM. |
| `ui.ts:14` `showStep` | Shows one panel and moves focus | N/A. DOM. A step with no panel gives a blank page. A build check fits this better (see 3.2). |
| `ui.ts:32` `ready` | Marks the first paint | N/A. DOM. |
| `ui.ts:36` `when`, `ui.ts:40` `fill` | Attribute-driven updates | N/A. DOM. `fill` writes `textContent` only, which is the XSS guard. |
| `ui.ts:46` `message` | Site text or default text | N/A. DOM read. |
| `ui.ts:51` `setError` | Inline error | N/A. DOM. |
| `ui.ts:60` `busy` | Disables controls during a request | N/A. `await` and DOM. |
| `ui.ts:76` `formatDate` | ISO to a local date | N/A. `Date` is out of the subset. |
| `ui.ts:83` `plainText` | Consent text whitespace fold | N/A. Regex. `sites/test/sites.test.ts:84` pins the exact result. |

### sites/sites.ts

| Location | Purpose | Verdict |
|---|---|---|
| `sites.ts:15` `Site`, `sites.ts:48` `SITES` | Site records | N/A. Data. |
| `sites.ts:39` `SECURITY_HEADERS` | CSP and other headers | N/A. Constant strings. Tests pin them. |
| `sites.ts:55` `site` | Lookup that throws | N/A. No property of value. |
| `sites.ts:61` `pages`, `sites.ts:69` `walk` | Directory reads | N/A. Filesystem. |
| `sites.ts:81` `skillText` | Fills one SKILL.md | N/A. Filesystem. |
| `sites.ts:89` `skillDescription` | Frontmatter read | N/A. Regex and YAML. |
| `sites.ts:99` `fill` | Placeholders and staging URL rewrite | EXT in theory. The rewrite is regex-heavy. A real rewrite for proof is effort L. Not recommended (R6). |
| `sites.ts:127` `write` | File write | N/A. I/O. |
| `sites.ts:133` `headersFile` | `_headers` text | N/A. String assembly. A test pins it. |
| `sites.ts:149` `writeSkills` | Skill files and digests | N/A. I/O and sha256. |
| `sites.ts:163` `routesFile` | `_routes.json` | N/A. One line. |
| `sites.ts:166` `DRAFT_MARKERS` | Words banned from production | N/A. Regex data. |
| `sites.ts:173` `buildSite` | The build | N/A. I/O, and it is real async. See bug B9. |
| `sites.ts:247` main block | CLI | N/A. I/O. |

### sites/agents.ts, skill-responses.ts, skills.config.ts

| Location | Purpose | Verdict |
|---|---|---|
| `agents.ts:12` `Agent`, `agents.ts:26` `AGENTS` | Agent table | N/A. Data. |
| `agents.ts:41` `skillUrlFor`, `agents.ts:43` `promptFor` | Prompt text | N/A. String concat. The property is only "it says what it says". |
| `agents.ts:46` `keywordFor`, `agents.ts:49` `joinMessageFor` | Keyword per app | N/A in LemmaScript. Four finite cases. `sites/test/sites.test.ts:303` already checks the round trip through `keywordApp`. `keywordApp` uses NFKC and regex. |
| `agents.ts:52` `messagesHref` | `sms:` link | N/A. String concat. |
| `agents.ts:55` `logo`, `agents.ts:56` `esc` | File read and HTML escape | `logo` N/A (I/O). `esc` N/A (regex; build-time data only). |
| `agents.ts:63` `agentRow` | Logo row markup | N/A. Markup. Tests pin it. |
| `skill-responses.ts:3` `RESPONSE_STYLE` | Agent prose | N/A. Text. |
| `skills.config.ts:24` `origin` | URL check | N/A. `new URL` is out of model. |
| `skills.config.ts:35` `skillsConfig` | Build config and staging guard | N/A. Rejected (R5). A plain fix and a test row fit. **[overlap]** |
| `skills.config.ts:58` `mcpUrlFor` | MCP URL per site | N/A. Glue. |
| `skills.config.ts:65` module export | Reads env at import | N/A. Glue. |

### Added by the verification pass

`git ls-files sites` gives 52 non-font, non-image files. The first pass covered each of them. It missed these functions and branches.

| Location | Purpose | Verdict |
|---|---|---|
| `auth.ts:44-59` cloud branch | Replaces the phone form with "Continue with your phone", then leaves the site | N/A. DOM and `await`. It is a separate journey (section 2.2, bug B11). |
| `auth.ts:107-117` code submit handler | Digits only, 4 to 8 long | N/A. Regex, and the rule is one range test. |
| `join.ts:50-52` `edited` listeners | Tracks fields that the person changed | N/A. DOM. It only serves the dead draft path. |
| `join.ts:121` `str` (closure) | Reads and trims one form value | N/A. FormData. |
| `agent.ts:47-70` text link handler | Copies the join text, then shows a fallback | N/A. DOM and timers. |
| `agent.ts:76`, `:81` click handlers | Copy button and agent tiles | N/A. DOM. |
| `sites.ts:29`, `:32`, `:96`, `:125`, `:161` | `SKILLS_DIR`, `TURNSTILE_ORIGIN`, `TEXT`, `sha256`, `ROUTER` | N/A. Constants and glue. |
| `turnstile.ts:7-8` | Script origin and URL | N/A. Constants. |
| `skills.config.ts:13`, `:53`, `:55` | Default origin, MCP URL and text line | N/A. Constants. |
| `sites/shared/logos/*.svg` | Excluded from the slice as images | Checked: no `$` (so no replacement patterns in `agentRow`) and no `style` (so the CSP refuses nothing). |

### Static files, skills and tests

| Location | Purpose | Verdict |
|---|---|---|
| `sites/README.md`, `sites/PRODUCT.md` | Docs | N/A. Prose. Parts are stale (section 4). |
| `sites/shared/landing.css`, `sites/shared/member.css` | Shared styles | N/A. CSS. |
| `sites/{ntwrk.party,slop.date,peon.biz,friends.help}/public/styles.css` | Site styles | N/A. CSS. |
| `sites/{ntwrk.party,slop.date,peon.biz,friends.help}/public/index.html` | Landing. No inline script (the CSP refuses it). Loads `agent.ts`. | N/A. Markup. |
| `sites/peon.biz/public/join.html` | The only Join page. No inline script. Loads `join.ts`. | N/A. Markup. It has no `invite` panel (see 3.2). |
| `sites/{ntwrk.party,slop.date,peon.biz,friends.help}/public/404.html` | Not found. No script. | N/A. Markup. |
| `sites/{ntwrk.party,slop.date,peon.biz,friends.help}/public/privacy.html` | Legal text. No script. | N/A. Prose. |
| `sites/{ntwrk.party,slop.date,peon.biz,friends.help}/public/terms.html` | Legal and SMS text. No script. | N/A. Prose. See bug B3. |
| `sites/{ntwrk.party,slop.date,peon.biz,friends.help}/static/robots.txt` | Crawl rules | N/A. Data. |
| `sites/{ntwrk.party,slop.date,peon.biz,friends.help}/wrangler.toml` | Pages project config | N/A. Config. |
| `sites/tsconfig.json` | Typecheck config | N/A. Config. |
| `sites/skills/ntwrk-party/SKILL.md` | Agent signup steps | N/A. Prose read by a model. |
| `sites/skills/slop-date/SKILL.md` | Agent signup steps | N/A. Prose. |
| `sites/skills/friends-help/SKILL.md` | Agent signup steps | N/A. Prose. |
| `sites/skills/peon-biz/SKILL.md` | Agent steps, with a web and an SMS path | N/A. Prose. See bug B4. |
| `sites/test/contract.test.ts:17` `FakeOtp`, `:46` fetch stub | Client against the real API | N/A. Test code. |
| `sites/test/contract.test.ts:67-118` client describe block | Sign in, join, export, stop, logout, delete | N/A. Test code. Runs through `await`. |
| `sites/test/contract.test.ts:120-165` error parity | Code table and Turnstile body | N/A. Test code. The grep at `:123` misses a ternary code (bug B10). |
| `sites/test/sites.test.ts:31` `consentWording` | Extracts consent text | N/A. Test helper. |
| `sites/test/sites.test.ts:44-208` per-site describe block | Build, legal, ages, brand, headers, Turnstile slot | N/A. Test code over built files. `:53` scans only `index.html` for "Sign in". |
| `sites/test/sites.test.ts:210-272` staging test | Staging build and router | N/A. Test code. Covers one forbidden backend (bug B6). |
| `sites/test/sites.test.ts:274-319` landing test | Prompt and tiles. Its title still says "phone sign-in link". | N/A. Test code. |
| `sites/test/sites.test.ts:321-401` focused tests | Muse, device, slop safety, peon review, draft text, rename, ntwrk invite | N/A. Test code. |
| `sites/test/sites.test.ts:403` `toE164` test | Five inputs | N/A, but a proof replaces most of it. It tried `+44`, and bug B1 needs a 10-digit total. |
| `sites/test/sites.test.ts:411`, `:540` retired URL tests | `/settings` and `/join` | N/A. Test code. They run the dev server only. |
| `sites/test/sites.test.ts:430-537` dev server tests | Proxy, skill bytes, path safety | N/A. Test code. |

## 2. Journeys as state machines

Founder rule check: no page has a Sign in link, a settings page or a dashboard. A case-insensitive search of every
`sites/*/public/*.html` for sign in, log in, dashboard and settings found nothing. `/settings` answers 404 from `retiredSitePage` in `deploy/router.ts`. On peon.biz, `sites/shared/api.ts` still ships "Please log in again" and
`sites/shared/auth.ts:24` ships "Loading sign-in…". These words appear during Join, so they are not a portal.

### 2.1 Land, copy, open in agent (all four sites)

| State | Event | Next state |
|---|---|---|
| Idle | Press Copy | CopyOk, or Selected when the clipboard refuses |
| Idle | Press an agent link | Copied and AgentTabOpen. The link works with no script. |
| Idle | Press a Muse tile | Copied, with a paste toast |
| Idle | Press "Use in iMessage", `messages` true | MessagesOpening. After 1500 ms with no page hide, show the fallback text. |
| Idle | Press "Use in iMessage", `messages` false | Fallback text. The default action is stopped. |

Invariant: the page never sends the person's data. The prompt is fixed text. Only a person sends it.
Not LemmaScript: all of this is DOM and timers.

### 2.2 Phone confirm and Join (peon.biz only)

The table shows the OTP mode. See the cloud rows at its end for `mode: "cloud"`.

States: `loading, phone, code, profile, member, blocked, done`. `invite` exists in code but has no panel.

| From | Event | To |
|---|---|---|
| loading | me failed, not invite | phone |
| loading | me failed, invite | invite (blank page, see 3.2) |
| loading | me ok, canJoin | profile |
| loading | me ok, not canJoin, member | member |
| loading | me ok, not canJoin, no member | blocked |
| phone | bad number | phone, inline error |
| phone | Turnstile on, no token | phone, inline error |
| phone | otp/start ok | code |
| phone | otp/start error | phone, inline error |
| code | verify ok, me ok | profile, member or blocked |
| code | verify ok, me failed | phone, page error |
| code | verify refused | code, inline error |
| code | resend, Turnstile on | phone |
| code | resend, Turnstile off | code, new text |
| code | change number | phone |
| profile | join ok | done |
| profile | under_age, invite_only, review | blocked |
| profile | unauthorized | phone, page error |
| profile | account_changed | route again (cannot occur on peon.biz: no marker) |
| profile | other error | profile, inline error |
| phone (cloud mode) | Continue with your phone | Leaves for the Cloud login. The return is a new page load on `/join`, then `loading`. |
| phone (cloud mode) | cloud start failed | phone, inline error |

Invariants:

1. `code` holds only when a number is set, and the number shown is the number that verify uses.
2. `profile` and `member` hold only with a session.
3. `done` holds only after a join with the consent box ticked.
4. The profile fields survive the step from no session to a first session. **This fails today (bug B2).**
5. The fields clear when one session replaces another.

Trial: candidate 2 holds invariants 1 to 5 in one reducer. Shipped logic fails invariant 4. Invariant 4 also fails in cloud mode (bug B11).

### 2.3 Turnstile (peon.biz phone step)

| From | Event | To |
|---|---|---|
| pending | solved(token) | ready |
| pending, ready | expired | pending |
| any | widget error, or script missing | failed |
| any | reset after a request | pending |

Invariant: a token exists exactly in `ready`, and one token serves one request. The trial proved, but the contract is rejected (R4).
Note: `failed` can move to `ready` when the widget retries. The reducer allows it.

### 2.4 Errors

Each `call()` ends in one of three outcomes: `ok`, a named key, or `api_unreachable`. A 401 is always `unauthorized`.
A 429 is always `rate_limited`. A 2xx with a non-object body is never `ok`. The trial proved, but the contract is rejected (R2).
The only real bug here (B5) is outside the model.

### 2.5 Leave and delete (no site UI)

| State | Text event | Next state |
|---|---|---|
| Member, all apps | STOP | All apps stopped |
| Member, one app | `leave <domain>` | That app stopped |
| Member | Email help@ntwrk.party | Staff handle export or delete |

Sites hold copy only. `terms.html` and `privacy.html` carry these words, and `sites/test/sites.test.ts:105` checks them.
Logic is in `packages/platform` and `packages/core`, outside this slice.

### 2.6 Agent signup

ntwrk, slop and friends: the agent runs `/api/app`, draft, consent, `/api/auth/mode`, otp/start, otp/verify, `/api/me`, `/api/join`,
export readback. peon: the agent drafts, the person uses `/join`, then the agent uses MCP. On a phone, peon uses a prepared text (bug B4).
Invariant: an agent never submits across apps, and never infers consent. This is prose read by a model. LemmaScript cannot check it.

**Open policy conflict, not a code bug.** Founder decision 10 in AGENTS.md says the agent never sees the code. The ntwrk, slop and
friends skills tell the agent to collect the code in chat. `sites/shared/auth.ts:1-2` still says no agent can enter it. Commit 47666a4 suggests
that this was a later choice. A maintainer should confirm which rule holds.
The same applies to the prompt: decision 10 ends with "to sign me up for <app>", and `sites/agents.ts:43` ends with "and follow it."

### 2.7 Staff journey

No staff surface exists in `sites/`. Staff tools are in `packages/observatory`.

## 3. Ranked candidates

Status labels: **proved** means `lsc check` passed. **failed on shipped** means that the contract found the bug.
A real contract must fail if a real bug appears. So I kept a candidate only when its contract relates two independent things, or holds across all events.

### Candidate 1. Client and server phone parity (`sites/shared/api.ts:167`, `packages/platform/src/phone.ts:5`) [overlap]

The first pass stated facts about one output. This form is stronger. It compares the two real rule sets, so it does not restate either body.

```ts
// serverCore: normalizePhone. clientCore: toE164. usArea stands for the area and N11 checks that only the server runs.
export function clientNeverWidens(plus: boolean, digits: string): boolean {
  //@ verify
  //@ requires forall(k: nat, k < digits.length ==> digits.charCodeAt(k) >= 48 && digits.charCodeAt(k) <= 57)
  //@ ensures \result === true
  const c = clientCore(plus, digits);
  const s = serverCore(plus, digits, true);
  return c === null || c === s;
}
export function clientNeverNarrows(plus: boolean, digits: string, usArea: boolean): boolean {
  //@ verify (same requires, same ensures)
  const s = serverCore(plus, digits, usArea);
  return s === null || clientCore(plus, digits) === s;
}
```

- If violated: the client sends a different number from the one that the person typed (bug B1), or it refuses a number that the server accepts.
- Effort: S.
- Blockers: `.replace(/\D/g, "")`, `/^[01]/` and the area-code table. Workaround: the shell computes `digits` and `plus`, the core compares char codes, and `usArea` is a parameter.
- Trial: shipped logic failed on `clientNeverWidens` and held on `clientNeverNarrows` (7 verified, 1 error). The fixed copy proved (8 verified). A mutant with no exchange check failed (7 verified, 1 error).
- The failure is a real one, not a prover limit: `+65 9234 5678` is the counterexample.
- Limit: the model does not cover `replace` or `usOrCanadaArea`. The `requires` and `usArea` state those assumptions.
- Best shape: one shared core for both sides, not two copies. Then parity holds by construction, and a proof adds less. Prefer that if the owner agrees.

### Candidate 2. Join flow reducer with form fields (`sites/shared/join.ts:31-186`, `sites/shared/auth.ts:63-143`)

This merges the first pass's candidate 3 with the `fieldsAfterSignIn` half of its candidate 2. Alone, `fieldsAfterSignIn` only restated a two-way branch. Inside the reducer, the rule must hold across all events.

```ts
export function flowOk(s: Flow): boolean {
  //@ verify
  return (s.step !== "code" || (s.phone.length > 0 && s.shown === s.phone))
    && ((s.step !== "profile" && s.step !== "member") || s.account !== "")
    && (s.step !== "done" || (s.account !== "" && s.consented))
    && (s.account === "" || s.owner === s.account || isEmpty(s.fields));
}

export function flowNext(s: Flow, e: Ev): Flow {
  //@ verify
  //@ ensures flowOk(s) ==> flowOk(\result)
  //@ ensures s.step === "code" && s.account === "" && s.owner === "" && e.tag === "verified" ==> \result.fields === s.fields
  //@ ensures s.step === "code" && s.account === "" && s.owner !== "" && s.owner !== s.phone && e.tag === "verified" ==> isEmpty(\result.fields)
```

- If violated: a person loses the details that they approved (bug B2), one account inherits the fields of another, or a person reaches Done with no consent.
- Effort: M. The handlers must dispatch events, and the reducer must own the step.
- Blockers: closures, `await`, DOM. Workaround: handlers stay async and call one pure `flowNext`.
- Trial: the shipped clear-always rule failed on the prefill `ensures` (0 verified, 1 error). The fixed copy proved (1 verified).
- Mutants: the naive fix that keeps all fields failed on the cross-account `ensures`. So the contract refuses both the bug and its easy fix. Removing the consent guard failed `flowOk`.
- **This proves a model, not the shipped code.** The model and the handlers can drift until the refactor lands. The refactor touches a UI flow, so it needs written scope confirmation. It could count as a preference refactor.
- Recommendation: fix B2 with a small change and an e2e case first. Adopt the reducer only if a maintainer wants it. The real consent gate is on the server.

### Candidate 3. Join field parity (`sites/shared/join.ts:127-137`, `packages/platform/src/accounts.ts:82-88`)

The first pass's `joinProblems` contract restated the checks. This form compares client with server.

```ts
export function noFormDeadEnd(firstName: string, age: number, consentBox: boolean, wording: string): boolean {
  //@ verify
  //@ requires wording.length > 0 && wording.length <= 2000
  //@ ensures \result === true
  return !clientAccepts(firstName, age, consentBox) || serverAccepts(firstName, age, true, wording);
}
```

- If violated: a form that looks valid meets a generic server error (bug B7).
- Effort: S.
- Blockers: FormData and the ZIP regex stay in the shell. `number` is an integer here, so `18.5` stays a runtime check at `join.ts:135`. `length` counts Unicode scalars by default and UTF-16 units on the server, so set `"string-semantics": "javascript-utf16"`.
- Trial: shipped logic failed (1 verified, 1 error). The fixed copy proved (2 verified).
- Value: low. The rule is one inequality, and `maxlength="50"` on the input with an e2e row is cheaper. Do it only if candidate 1 lands.

### 3.1 Rejected candidates

| Id | First-pass candidate | Trial | Why rejected |
|---|---|---|---|
| R1 | `routeScreen`, `blockKey` (`join.ts:23`, `:31`) | Proved (2 verified) | The `ensures` lines repeat the `if` chain line by line. "A held number never sees Join" depends on the server's `canJoin`, which the function only reads. |
| R2 | `classify` (`api.ts:134-143`) | Proved (3 verified) | Same reason. Worse, the proof looks like cover for bug B5, but the model has no prototype chain. Fix B5 with `Object.hasOwn` or a `Map`. |
| R3 | `maskPhone` (`auth.ts:13`) | Proved (3 verified) | It restates a template string. The page shows a person their own number, so a failure leaks nothing to anyone else. |
| R4 | `tsNext`, `takeToken` (`turnstile.ts:51`) | Proved (6 verified) | Each `ensures` repeats a `switch` arm. `takeToken` does not exist in shipped code. A union type `{state: "ready", token} | {state: "pending"} | {state: "failed"}` removes the bad state with no proof. The server rejects a spent token anyway. |
| R5 | `backendIsolated` (`skills.config.ts:39`) | Not run | The body would be the contract. Fix B6 and add a test row. |
| R6 | `rewriteAuthority` (`sites.ts:99`) | Not run | Not trivial, but effort L. The code uses regex lookahead, so a proof needs a new scanner. `sites/test/sites.test.ts:210` covers the real case. |

`device`, `keywordFor`, `promptFor`, `esc`, `siteKey`, `plainText` and the OTP code-length check have no property beyond their text, or tests pin their finite cases.
`prefillJoin` age handling accepts `0`, and then the form refuses it. That has no effect on a person. `readDemo` is dead. The landing page, `busy` and `showStep` are DOM.
`prefill` (`join.ts:57`) has a real cross-account property, but it is dead code and it needs real `await`.

### 3.2 Better handled without LemmaScript

- Step closure: every name that `join.ts` passes to `showStep` must have a panel in `join.html`. A test over built files does this at far lower cost.
- Founder rule: a test can scan every built page, not only `index.html`, for sign-in links.
- Link integrity: a test can fail on a `href="/join"` in a site with no join page.

## 4. Confirmed bugs

"Reproduced" means that a script ran the shipped code and showed the failing step. "Traced" means that I read the path through the source, and only a part of it ran. The second agent reran or newly ran every script.

| Id | Severity | Where | Failing input | Effect | Evidence |
|---|---|---|---|---|---|
| B1 [overlap] | Medium (was High) | `sites/shared/api.ts:167-174` | `+65 9234 5678` on peon.biz Join. Any country code plus national number with 10 digits in total, such as `+47 42 34 56 78` and `+45 3212 3456`. | Client returns `+16592345678`. Server accepts that value. A text goes to a US number that may belong to someone else, and the visitor reaches a dead end. The stranger gets no access, and the visitor never gets a code. So this is a stray text, not an account risk. | Reproduced. `normalizePhone` refuses the raw input and accepts the client output. |
| B2 | Medium | `sites/shared/join.ts:55`, `:107`, `:104` | Fresh browser opens `/join?via=agent#firstName=Alex&age=28`, then phone, then code. "Change number" also clears them. | Name and age are erased on the profile step. The fragment is already gone, so they cannot return. `sites/skills/peon-biz/SKILL.md:59`, `:121` promise this prefill. | Reproduced with a DOM stub: `step=profile firstName="" age=""`. A merge likely caused it: `docs/results/2026-10-19-member-flow-design.md:110` says session storage left and account-change resets stayed. |
| B3 [overlap] | Medium | `sites/slop.date/public/terms.html:24`, `sites/friends.help/public/terms.html:24`; `packages/mcp/src/apps.ts:41`, `packages/mcp/src/tools.ts:203`, `:267`, `:290` | Press "join page" in the terms. Or call MCP `start_signup` or `prepare_signup` on slop, friends or ntwrk. | `/join` answers 302 to `/` (`retiredSitePage` in `deploy/router.ts`). The SMS terms describe a form and tick box that these sites do not have. The MCP link gives no way to finish. A prepared draft has no page to claim it. | Reproduced for the router and the link. MCP path traced. |
| B4 | Medium | `sites/skills/peon-biz/SKILL.md:44-47`; `packages/network/service/service.ts:966-980`, `:1459` | Phone user sends the prepared profile text as a first message | Only a whole-message keyword routes to an app. The text falls through to `{app: "ntwrk"}`. If the text states an age, the person joins The Network, and the agent asks what they are looking for. Otherwise the agent asks for name and age. They reach peon only after a later answer. The prepared profile never becomes a peon profile, so "step 3 is not needed" in the skill is false. | Traced. `keywordApp` ran: `undefined` on the profile, `peon` on the keyword. `route()` needs Postgres and did not run. Correction: the first pass said that the person does not reach peon. A later answer does enroll them. |
| B5 [overlap] | Low | `sites/shared/api.ts:139`, `sites/shared/ui.ts:47` | A 400 with JSON `{"error":"constructor"}` | `PLATFORM_ERRORS["constructor"]` finds `Object`. `result.error` is a function, so `message()` throws at `.replace`. The person sees no text. `toString` and `__proto__` do the same. Our API does not send this. An edge or proxy could. | Reproduced for `call` and for `message`. |
| B6 [overlap] | Low | `sites/skills.config.ts:39` | Staging env with `BACKEND_ORIGIN=https://slop.date` or `https://ntwrk.party` | The guard accepts it. It refuses only `https://api.ntwrk.party`. The error text says "isolated". | Reproduced. |
| B7 | Low | `sites/shared/join.ts:127`, `sites/peon.biz/public/join.html:50`; `packages/platform/src/accounts.ts:86` | First name of 51 letters | Client passes it. Server answers `invalid`. The person sees a generic error that names no field. | Reproduced: `parseJoin` takes 50 and refuses 51. Candidate 3 failed on shipped logic. |
| B8 | Low | `sites/shared/join.ts:92`, `:158-170` | Signed-in person. `/api/app` fails on load. Join then succeeds. | Done shows "We can't reach our server… Nothing was sent" after a successful Join. Only `onSignedIn` clears that banner. | Reproduced with a DOM stub: `step=done bannerHidden=false`. |
| B9 | Low | `sites/sites.ts:101`, `:239` | `DEPLOY_TARGET=production TURNSTILE_SITE_KEY="   "` | `fill` trims to an empty key. The warning tests the raw value, so it stays silent. Join ships with no widget. | Reproduced for `fill` and the warning test. No build ran. |
| B10 | Low (test gap) | `packages/platform/src/api.ts:540`, `sites/test/contract.test.ts:123` | `POST /api/me/resume` as a non-member | The server sends `not_member`. `PLATFORM_ERRORS` has no entry. The parity grep misses it because the code sits in a ternary. No page calls resume, so no person sees it. | Reproduced for the mapping (`unknown`). |
| B11 (new) | Low, latent [overlap] | `sites/shared/auth.ts:56`, `packages/platform/src/api.ts:404` | Cloud auth on for peon. A person opens `/join?via=agent#firstName=Alex&age=28`, then presses Continue. | The return path is always the bare `/join`, and the server refuses any other. So the prefill and `via=agent` are lost, the same effect as B2. Fixing B2 does not fix this. | Traced. Whether cloud mode is on in production is not known here: `docs/results/2026-10-18-production-cloud-network-handoff.md` calls that work source and local only. |

Latent, not reachable at a0ed7bc: `sites/shared/join.ts:98` shows step `invite`, and `sites/peon.biz/public/join.html` has no such panel.
If `joinMode` for peon becomes `invite`, a signed-out visitor sees a blank page. Peon is `open` today.

Security gap, by design: `signupView` exists only for ntwrk and friends (`packages/platform/src/api.ts:513`), and neither has a Join page.
The account guard in `sites/shared/join.ts:145` therefore never runs on peon.biz. A Join from a tab can land on an account that changed in another tab.

### Dead code and stale docs (not user-visible bugs)

- `sites/shared/demo.ts`: no page loads it. `sites/README.md:94` says so. Delete it with `api.demo`.
- `sites/shared/join.ts:57-87` and the draft fetches: the guard at `:58` needs `friends` or `ntwrk`, and only peon.biz ships Join. `sites/README.md:120` describes a path no page can reach.
- `api.logout`, `exportData`, `stop` and `remove`: no page calls them. Only tests do. `api.resume`, `home`, `phoneStart` and `phoneConfirm`: nothing in `sites/` calls them, not even a test. Their messages are dead too. (Correction: the first pass said that tests called all of these.)
- `{{TEXT_MESSAGE}}` at `sites/sites.ts:232`: no source file uses it.
- `sites/README.md:18` and `:29` name pages that are gone. `:53` says the text tile hides on other devices, but no page sets `data-only="messages"`. `:91` describes peon choice fields that `join.html` does not have. `sites/README.md:13` says ntwrk.party names no app, but `sites/test/sites.test.ts:107` requires its terms to name slop.date.

### Checked and refuted

The first pass refuted these. The second agent rechecked those it could. No bug in the table above was refuted.

- Digest mismatch from the second `fill` pass: refuted. No skill uses `{{TEXT_MESSAGE}}` or `{{MESSAGES_HREF}}`. It stays a latent risk if one ever does.
- Staging rewrite misses a URL before punctuation: refuted. No source has a site URL followed by a character outside the lookahead.
- `$` patterns in `agentRow` replace: refuted. `encodeURIComponent` escapes `$`, and no logo holds a `$`.
- 401 hides `invalid_code`: refuted. Verify answers 400.
- Member screen for a `review` number: refuted. `canJoin` returns no membership there.
- `member` step for an `invite_only` person with a removed membership: refuted. `publicMembership` returns null for `removed`.
- An unknown `me.reason` gives a false error: refuted. `canJoin` sends only `invite_only` or `review` to the page.
- Inline scripts or inline styles in pages: none. The CSP would refuse them.

## 5. Trial results

All under `/private/tmp/claude-501/-Users-nubs-thenetwork/0b7e16cc-5a52-420a-9076-9f674ab17544/scratchpad/trials/sites/`.

| Trial | Candidate | Status | Output |
|---|---|---|---|
| `e164-shipped/` | 1 | Failed on shipped logic | 7 verified, 1 error |
| `e164-fixed/` | 1 | Proved | 8 verified, 0 errors |
| `e164-mut/` | 1 | Mutant failed, as wanted | 7 verified, 1 error |
| `flow-shipped/` | 2 | Failed on shipped logic | 0 verified, 1 error |
| `flow-fixed/` | 2 | Proved | 1 verified, 0 errors |
| `flow-mut/` (keep all fields) | 2 | Mutant failed, as wanted | 0 verified, 2 errors |
| `flow-mut2/` (no consent guard) | 2 | Mutant failed, as wanted | 0 verified, 1 error |
| `form-shipped/` | 3 | Failed on shipped logic | 1 verified, 1 error |
| `form-fixed/` | 3 | Proved | 2 verified, 0 errors |
| `route/` | R1 | Proved, rejected | 2 verified, 0 errors |
| `errmap/` | R2 | Proved, rejected | 3 verified, 0 errors |
| `mask/` | R3 | Proved, rejected | 3 verified, 0 errors |
| `turnstile/` | R4 | Proved, rejected | 6 verified, 0 errors |

## Verification

The second agent did this work at a0ed7bc. It ran no build, no `bun run sim` and no full test suite. It did not change the code under test.

Toolchain, one run at a time, in each trial folder:

```sh
/private/tmp/claude-501/-Users-nubs-thenetwork/0b7e16cc-5a52-420a-9076-9f674ab17544/scratchpad/bin/lsc check --backend=dafny <name>.verify.ts
```

Bug scripts, each with `bun <script>` under `nice`:

| Script | Covers | Key output |
|---|---|---|
| `trials/frontend-sites/run-pure.ts` | B1, B5, B6, B10 | `"+65 9234 5678" client +16592345678 \| server raw undefined \| server after client +16592345678`; `constructor function`; `https://slop.date -> https://slop.date`; `not_member string unknown` |
| `trials/frontend-sites/run-prefill.ts` | B2 | `after otp verify  step=profile firstName="" age=""` |
| `trials/sites/verify-bugs.ts` | B3, B4, B7, B9 | `B3 slop 302 /`; `B4 keywordApp undefined`; `B7 50 true 51 false`; `B9 filled "content=\"\"" warnWouldFire false` |
| `trials/sites/verify-b8.ts` | B8 | `B8 step=done bannerHidden=false` |
| `trials/sites/verify-b5.ts` | B5 | `B5 message throws: error.replace is not a function` |

Completeness: `git ls-files sites` with fonts and images removed gives 52 files. All are in section 1. Additions are in "Added by the verification pass".

What changed from the first pass:

- Candidates went from 9 to 3. Rejected: `routeScreen`, `classify`, `maskPhone`, the Turnstile reducer, `backendIsolated` and `rewriteAuthority`.
- Candidate 1 now compares client with server. The old contract repeated output facts.
- Candidate 2 now holds the form fields, and it refuses the naive fix.
- Candidate 3 now compares client with server. The old `fieldsAfterSignIn` restated its body.
- B1 went from High to Medium. B4's effect is corrected. B8 and B9 moved from read to reproduced. B7 and B3 are confirmed by running their key step.
- B11 is new. Section 2.2 gained the cloud branch. The dead-code list and one test citation are corrected.

Limits:

- Every proof is about an extraction or a model. `lsc` models `number` as a mathematical integer, so `NaN` and fractions are out.
- The `flow` proofs do not check that the handlers match the reducer.
- `lsc` refused to rerun over a stale `.dfy` after an edit to the `.ts`. It printed a warning and did not verify. I deleted the stale file for `flow-mut` and ran it again. A quiet run is not a pass, so read the last line of output.
- No real LLM or agent client ran. This pass tested no live site.

## Skeptic pass on the shipped cores (2026-11-08)

Hand-written by an independent skeptic agent after the cores landed (`sites/shared/join-core.ts`, `packages/core/src/phone-core.ts`). No maintainer reviewed it.

Verifier lines after this pass, with the throttled `lsc check --backend=dafny`:

- `packages/core/src/phone-core.ts`: `Dafny program verifier finished with 15 verified, 0 errors`
- `sites/shared/join-core.ts`: `Dafny program verifier finished with 6 verified, 0 errors`

Both `.dfy` files are the `.dfy.gen` plus added lines only. There is no `assume`, `havoc`, `extern` or `{:axiom}`.

### Weak contracts found and made strong

Each mutant below verified before this pass. Each one now fails.

| Mutant | Before | Contract added |
|---|---|---|
| `formPasses` returns `false` | verified | `parseJoinTakes(f) && f.ticked && f.age >= 1 ==> \result` |
| `afterAuth` returns `"profile"` when `canJoin` is false | verified | a `loaded`, `verified` or `rerouted` event with `!e.canJoin` gives step `profile` only when nothing changed |
| `refused` keeps step `profile` | verified | `refused` from `profile` gives no `profile` and no `done` |
| `joined` keeps step `profile` | verified | a ticked `joined` from `profile` gives `done` |
| `nationalDigits` returns a fixed valid number | verified (one run failed only by a solver limit) | the result is `""`, the digits, or the digits after a leading `1` |
| `phoneE164` returns `null` | failed only on proof assertions, not on a contract | a plain valid 10-digit input gives `"+1" + input` |
| `phoneE164` without the character check | failed only on the idempotence lemma | `!allPhoneChars(input) ==> \result === null` |

A new contract also ties the result to the input: the digits of the input are the 10 national digits, or `1` and those digits.

### Force: one mutant for each contract

All of these failed `lsc check`, as wanted. Every saved file was restored and compared with `cmp`.

- join-core: `formPasses` without the ZIP check; `formPasses` with age up to 121; `initialFlow` at step `profile`; `otpStarted` with an empty number; `sessionEnded` after `done`; `joined` without the tick; `changeNumber` that clears the fields; `verified` with another account; `typed` that does not set the owner; `fieldsFor` that drops the link prefill; `loaded` that clears the fields; `fieldsFor` that keeps the fields of another account; `sessionEnded` that changes the owner.
- phone-core: `digitsOf` that keeps all characters; no area-code check; the wrong N11 check; the wrong plus check; an exchange that can start with `1`; a 13-character result. The `startsWithPlus` mutant was built by hand (the regen merge refused it). It failed with one error and one solver time-out.

### Wiring

- `phoneE164` is the only exported function of `phone-core.ts`. `packages/platform/src/phone.ts` (`normalizePhone`) and `sites/shared/api.ts` (`toE164`) both call it. The helpers are now private.
- `join.ts` and `auth.ts` get each step from `flowNext`, and each submit from `formProblems` and `formPasses`. `isEmpty` and `flowOk` are now private. `parseJoinTakes` stays exported, because `sites/test/join-flow.test.ts` pins it to the real `parseJoin`.
- `mountAuth(root, callback)` (the old form) builds a sign-in flow with `initialFlow` and `flowNext`. A DOM run showed: phone, then code, then change number, then a new number, then the code calls `otpVerify` with the new number and calls the callback one time.

### Behaviour changes to know (not fixed, by intent or not reachable)

- The link prefill (name and age) now stays through sign-in. This is the fix for B2.
- The same account that signs in again keeps its fields and its tick. The old code cleared them on each sign-in. Another account never keeps them.
- `accountOf` uses `signupView`, or else the masked number. Two accounts with the same last 4 digits have the same masked number. A reroute between two such accounts would keep the fields. Today no path reaches it: a reroute needs `account_changed`, and that needs `signupView`.
- A first name of more than 50 characters now shows "Enter your first name." The new `maxlength="50"` stops the typing first.
- `number` in the proofs is an integer. The shell sends `wholeAge` for `NaN` and fractions. String length in Dafny counts characters, and JavaScript counts UTF-16 units.
