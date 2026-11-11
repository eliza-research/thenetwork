# Audit: quint/console_privacy.qnt (2026-11-11)

Scope read: quint/console_privacy.qnt (343 lines), its drift.json entry (files only, no "drift" list),
formal-coverage rows (people.ts:328, shape.ts:336, apps.tsx:347), the drift review entry
(docs/results/2026-11-09-quint-drift.md:91-98, verdict fixed_in_model), and the code in full:
packages/observatory/src/privacy-core.ts, shape.ts, people.ts, web/apps.tsx, plus the callers in
server.ts (broadcast 206-225, recheck 351-360, /api/state 481-484, /api/member 495-510,
/api/opportunity 557-570, /api/control lens 629-631, /api/person* 770-808, /ws 815-831) and
sources/game.ts member/opportunity views (466-511). No findings file exists for this module.
`bun run quint:check quint/console_privacy.qnt`: typecheck, test, safety, 6 witnesses ok (19 s).

## Suspected defects (new)

D1 (P2) Oracle verdict leaks through /api/member/:id in game mode.
  sources/game.ts:479 puts `[...this.store.opps.values()]` (raw store objects, oracle included) in
  MemberDetail.opportunities. server.ts:501-510 returns it unchanged. stripOracle (shape.ts:19) runs only
  in shapeState/shapeDelta; game.ts:506 strips only the single-opportunity view.
  Trigger: game mode; staff with engineer@ntwrk only (full class, no lens role: CONTROL_ROLES.lens is
  ["safety"]). Engine proposes opp O (state PROPOSED, oracle {compatible:false}). GET
  /api/member/<participant>?app=ntwrk -> body.opportunities[i].oracle is present. Same for a reviewer on a
  member in open review. Breaks the stripOracle rule (oracleOnlyWhenShown) and makes the -25 peek free.
  Fix: map detail.opportunities through stripOracle(o, lens) in game.ts:479 (or in the server route).

D2 (P1, plausible) Reviewer note text reaches the counts (analyst) class.
  ObsOpportunity.review (types.ts:163-174) has free text `note` (real.ts:722 runs scrubText, which masks
  phones/emails/canaries but not names, scrub.ts:46-52) and `reviewer`; ObsOpportunity.reason is also
  free text (real.ts:405). oppFieldLevel (privacy-core.ts:41-45) lists only feedback/explanations/
  objective, so every other key defaults to "counts" and countsOpp keeps it (shape.ts:48-50). Path: /api/state,
  every WS delta, and /api/opportunity/:id counts branch (server.ts:564).
  Trigger: reviewer rejects with note "Dana and Sam are exes" -> analyst@ntwrk GET /api/state ->
  opportunities[k].review.note = "Dana and Sam are exes". Admin-console 4.1: an analyst never sees a person.
  Feed lines get the namePattern scrub, review notes do not. Fix: make "review" (or review.note) and
  "reason" full-level in oppFieldLevel (mask note to ""), extend the lemma ensures, add an e2e case.

D3 (P2) Hidden-truth `community` reaches every class without the lens (game mode with dataDir).
  game.ts:155 reads hidden_truth.jsonl community into this.communities; game.ts:183 writes it to
  ObsMember.community. memberFieldLevel has no "community", so counts and no-lens full callers get it.
  truthOnlyFullLens covers only ObsState.truth. Fix: take community from the public profile, or make it a
  truth-lens field.

D4 (P2, design question) "*" names the private app by elimination.
  PRIVATE_APPS = {"slop"} (apps.ts:86). people.ts:72-78 turns a slop block origin into "*", and holdLines
  turns a slop hold into one "*" restricted line. With one private app "*" == slop, so the summary (no
  reason; read_person audit only) shows that the person is or was a dating member, before any typed
  reason on the slop panel. Trigger: B blocks A in slop -> GET /api/person/<A> ->
  blocks.received = [{originApp:"*"}]; A has no visible memberships -> A is on slop. types.ts:722-725
  says privateApps "reveals nothing", but "*" lines do. Needs a founder/maintainer decision (hold must
  stay visible per plan 2.4 rule 5; block origin could drop the line entirely or show only counts).

## Model gaps

G1 (P1) Stale socket class. The model's memberDelta/oppDelta use `cls = classOf(roles)` at send time
  (qnt:147,185,196). Code shapes with w.cls (server.ts:220-222), refreshed only by recheck every
  socketCheckMs=15 s (server.ts:842), on mode switch (264) and on lens/reset (631, truth only). A role
  removed from admin->analyst keeps full deltas for up to 15 s. Adding a `sockCls` var set by a
  `recheck` action would NOT break noFieldAboveClass as written (it compares against the class
  recorded at send) - see E2 - but would break a correct "no full field after the role change is
  committed" invariant. Decide the accepted window and state it as an invariant with a bound.
G2 (P1) Open-ended field sets. MEMBER_KEYS/OPP_KEYS (qnt:116-117) are 10 and 6 keys; ObsMember has
  ~20 keys (types.ts:67-87) and ObsOpportunity ~30 (110-143: review, reason, venue, times, booked,
  status, enjoyment, alternates, oracle...). Code iterates Object.entries (shape.ts:33) and defaults
  unknown keys to "counts" (default-allow). The model cannot see D2/D3. Add the real key sets and a
  sensitivity label per key; better, make the core default-deny (unknown -> full).
G3 (P1) Routes not modelled: /api/opportunity/:id counts branch (server.ts:564, messages [], events
  text = type), /api/member/:id, /timeline, /app (canSeeMember gates, server.ts:431-436), and the game
  source's own oracle strip (game.ts:506, a hard-coded copy of oppResolved, not oracleShown). D1 lives here.
G4 (P2) Feed name scrub (shape.ts:54-70) is outside (documented). Names under 2 characters for the first
  name, names not in `known` (members never sent), and names in other kinds of text are not scrubbed.
  Known map is never pruned (server.ts:205-209). Regex table: cannot be LemmaScript; needs a corpus/e2e.
G5 (P2) game.prompts dropped for counts (shape.ts:81,92); requests, network, edges, engineRuns kept for
  counts; none modelled. requests carry memberId + label (types.ts:312-320).
G6 (P2) Truth lens lifecycle: lensOn per staff|app, cleared on reset only (server.ts:629-631); a safety
  role removed keeps w.truth until recheck (<=15 s); lens set survives a mode switch (truthFor gates on
  mode === "game"). Model's lensChange is a free bool, no role link (qnt:178-181).
G7 (P2) Person view server side: canCrossApp role check, real-mode-only peopleView (server.ts:438-443),
  audit-before-read (record() fail-closed: 788, 804), server reason check (803), 404 vs panel answer that
  reveals a private membership, ticket/lookup audit (778). Header lists these as outside; the order
  "audit row before panel read" is a state-machine fact the model could carry (opened only after audited).
G8 (P2) Summary inputs: hold comes from network_state_console_cross_app trust==="hold" (people.ts:40-46,64);
  "watch" is dropped; recycled_number on a private row is dropped entirely (holdLines hidden branch,
  privacy-core.ts:155-160) so a recycled-number warning from slop vanishes from the person view, while
  plan 2.4 treats a recycled number as a person-level fact. Read failures throw (good) - not modelled.
G9 (P2) WS ticket: the user object is captured at ticket issue (server.ts:479, 822-825) and roles read at
  upgrade; the 30 s ticket window plus the 15 s recheck bound the stale-grant window. Not modelled.

## Open carve-outs
C1 Drift list: empty in quint/drift.json; review verdict fixed_in_model (lineOk/namesApp/crossAppShown
  added). No unfixed finding file. Outside list (qnt:28-33): feed regex, SQL/login/audit/role check,
  server reason check, key order. Server reason check and audit order could be added now (G7), in scope.
C2 No invariant is kept out of `safety`; all 7 are in. But the model has no invariant for D1/D2/D3/D4.

## Model errors
E1 Tautological invariants: noFieldAboveClass conjuncts 1-2, truthOnlyFullLens, oracleOnlyWhenShown,
  privateNotListed, panelNeedsReason re-check the def that the action called (e.g. openPanel requires
  reasonOk(len) then panelNeedsReason checks len>=5; stateRead sets sent=truthShown(..)). They cannot
  fail unless a def is edited inconsistently. Only conjunct 3 of noFieldAboveClass (hard-coded key list)
  and hiddenHoldsRestricted's count/iff clauses check something independent.
E2 noFieldAboveClass checks the class recorded with the delta (memberSent.cls), not the caller's current
  roles; it is weaker than "an analyst never receives a person" (G1).
E3 Header claim "server.ts sets w.cls again on each check" is modelled as instant recomputation (too strong).
E4 privateNotListed is weaker than PRD 40.3: it checks only the memberships list; "*" hold/block lines
  disclose the private app by elimination (D4). PRIVATE_CHOICES {slop,friends} hides this because with
  two private apps "*" is ambiguous; production has one.
E5 openPanel draws app from all four ids, but the shell only renders panels for visible memberships plus
  privateApps (apps.tsx:140-143); harmless over-approximation.
