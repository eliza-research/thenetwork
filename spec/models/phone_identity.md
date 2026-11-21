# Phone number identity

## Story: Phone number identity

A person needs each supported representation of their phone number to resolve to the same identity.

### Safety rules and reachability

Check number normalization, ownership, and bans across entry points. The model defines the checks in `safety`, the reachable states in `witness_*`, and the replay traces in `run` definitions.

The [phone change spec](../phoneChange.md) generates challenge and confirmation decisions for changing the number on an existing account. Number normalization and provider checks still belong to the shell.

Imported from `quint/phone_identity.qnt` at `30d950e`. See [model index](README.md) for scope and commands.

```quint
// -*- mode: Bluespec; -*-
// quint-check: max-steps=12 max-samples=4000
//
// phone_identity: one phone number is one identity key on every path that reads a number.
//
// WHAT THIS MODELS
//   The paths that turn a written phone number into a key, and the ban that keys on it. Compared with
//   the code on branch vibestack-matching (2026-11-18); locations are by function name:
//   - web OTP start and verify (packages/platform/src/api.ts, routes "POST /api/auth/otp/start" and
//     "/verify": normalizePhone, then accounts.banned) and the web join (api.ts "POST /api/join",
//     accounts.ts Accounts.join and joinLocked: the "checkEligibility" step reads accounts.banned).
//     A Cloud sign-in site answers 409 to both OTP routes; its callback refuses a banned number
//     (api.ts phoneAllowed in the Cloud callback, cloud_auth owns that path).
//   - MCP OTP start and login (packages/mcp/src/hooks.ts startOtp and login: accounts.banned).
//   - staff ban by phone or person (packages/network/service/service.ts NetworkService.ban: the keyed
//     hashes of the person's phones, platform.bans rows, suppression, restricted memberships).
//   - the inbound turn (service.ts: the signed turn endpoint refuses `from` that is not its own
//     normalizePhone; inbound() reads accounts.banned and memberOf; checkLineBan; the text join
//     NetworkService.join reads accounts.banned(e164, person) in its "checkJoinBan" step).
//   Two normalizers make keys. P is normalizePhone (packages/platform/src/phone.ts): +1 US and Canadian
//   numbers only, no NFKC. Q is normalizeAddress (packages/blooio/src/phone.ts, through toE164): any
//   country, after NFKC. The runtime address book (runtime.ts NetworkRuntime.identities and memberOf)
//   keys on Q. P and Q are oracles here. The proved phone-core.ts of the source branch does not exist on
//   this branch; the two contracts below were checked by reading the two functions: P accepts only US or
//   Canadian numbers, and Q gives the same key as P on every input that P accepts (a 10-digit number and
//   an 11-digit number that starts with 1 both become +1 and the digits). The table FORMS is a small set
//   of written forms with these contracts.
//
// BOUNDS
//   Two humans with US numbers (A, B), one human with a UK number (F), one text that is no number (J).
//   Written forms: the canonical E.164 of A and B, and "(212) 555-0101", "+1 212 555 0101",
//   "12125550101" and fullwidth digits for A. One ban, any number of joins, OTP starts and turns.
//
// TIME
//   No timer decides here. The 12-month hold (accounts.seen) is the same as a ban for these keys, so
//   the model has one banned set and no clock.
//
// ABSTRACTIONS
//   - A ban holds every member of the person, so ban removes the key from the address book. In the code
//     the restricted member stays in the address book (identities() skips only invited and removed) and
//     inbound() refuses the turn at checkLineBan; the outcome is the same, because the model checks the
//     ban first.
//   - A banned number still gets the compliance answers: STOP is handled before the ban check, HELP gets
//     the help text and "leave <app>" leaves that app (spec/lineRouting.md, "A banned number gets only
//     HELP and app leave"). These answers serve no code, join or member turn, so the model leaves them
//     out (refuse covers them).
//   - Age, invites, consent and rate limits are outside the model (join_age, auth_edge, turn_consent).
//   - Sessions are outside the model. When a number gets a person (a join, an invitation or a number
//     change, pg-store.ts createPerson and movePhone), its person-less sessions end: auth_edge
//     (numberChange, invite) models that.
//     A banned OTP start answers { ok: true } before OtpService.start, so no rate bucket counts it
//     (auth_edge records that as a defect).
//   - The keyed hash (phoneHash) is the identity function: it is injective for these keys.
module phone_identity {

  // ---------------------------------------------------------------- the written forms (oracle table)
  pure val FORMS = Set("A", "A_paren", "A_plus", "A_11", "A_fullwidth", "B", "F_uk", "J_text")

  // The human who holds the number that the form writes ("" for no number). Ghost: the code never reads it.
  pure def owner(w: str): str =
    if (w == "B") "B" else if (w == "F_uk") "F" else if (w == "J_text") "" else "A"

  // P = phoneE164 (proved contract): a +1 number in any punctuation gives its E.164; a fullwidth
  // digit is no phone character (no NFKC), a foreign number and a text give "".
  pure def P(w: str): str =
    if (w == "A" or w == "A_paren" or w == "A_plus" or w == "A_11") "A"
    else if (w == "B") "B"
    else ""

  // Q = anyE164 / normalizeAddress (proved contract): NFKC first, any country. Q(w) == P(w) when P(w) != "".
  pure def Q(w: str): str =
    if (w == "F_uk") "F" else if (w == "J_text") "j_text" else owner(w)

  // ---------------------------------------------------------------- state
  var identities: Set[str]          // platform.phone_identities (P keys)
  var members: Set[str]             // the address book that memberOf reads (keys of joined, not held members)
  var banned: Set[str]              // platform.bans phone hashes
  var served: Set[(str, str, bool)] // ghost: (path, form, the owner was banned then) for each code sent, join or member turn
  var refusedBan: Set[(str, str)]   // ghost: (path, form) refused because the number is banned
  var turnKeys: Set[(str, str)]     // ghost: (memberOf key, ban-check key) of each handled member turn

  action init = all {
    identities' = Set(), members' = Set(), banned' = Set(),
    served' = Set(), refusedBan' = Set(), turnKeys' = Set(),
  }

  action unchangedGhost = all { turnKeys' = turnKeys }

  // api.ts OTP routes and "POST /api/join" (accounts.ts joinLocked, step checkEligibility): normalizePhone,
  // then the ban check, then the identity (createPerson, admitMembership).
  action webJoin(w: str): bool = {
    val e = P(w)
    all {
      e != "",
      if (banned.contains(e)) all {
        refusedBan' = refusedBan.union(Set(("web", w))), served' = served,
        identities' = identities, members' = members,
      } else all {
        served' = served.union(Set(("web", w, banned.contains(owner(w))))), refusedBan' = refusedBan,
        identities' = identities.union(Set(e)), members' = members.union(Set(e)),
      },
      banned' = banned, unchangedGhost,
    }
  }

  // hooks.ts startOtp (MCP) and api.ts "POST /api/auth/otp/start" (web): a banned number gets { ok: true }
  // and no code. The route returns before OtpService.start, so no rate bucket counts it (auth_edge).
  action otpStart(w: str): bool = {
    val e = P(w)
    all {
      e != "",
      if (banned.contains(e)) all { refusedBan' = refusedBan.union(Set(("otp", w))), served' = served }
      else all { served' = served.union(Set(("otp", w, banned.contains(owner(w))))), refusedBan' = refusedBan },
      identities' = identities, members' = members, banned' = banned, unchangedGhost,
    }
  }

  // service.ts NetworkService.ban: a ban takes the person's stored phone hashes and holds every member.
  action ban(k: str): bool = all {
    identities.contains(k),
    banned' = banned.union(Set(k)), members' = members.exclude(Set(k)),
    identities' = identities, served' = served, refusedBan' = refusedBan, unchangedGhost,
  }

  // One signed turn. The turn endpoint: `from` must be its own normalizePhone, else 400. Then inbound()
  // reads the ban and the hold on the P key (accounts.banned, accounts.seen) and memberOf on the Q key
  // (runtime.ts memberOf). A non-member with a number goes to the text join (NetworkService.join), which
  // checks the ban first ("checkJoinBan").
  action inbound(w: str): bool = {
    val e = P(w)
    val m = Q(w)
    all {
      P(w) == w,
      if (e != "" and banned.contains(e)) all {
        refusedBan' = refusedBan.union(Set(("turn", w))), served' = served,
        identities' = identities, members' = members, turnKeys' = turnKeys,
      } else if (members.contains(m)) all {
        served' = served.union(Set(("turn", w, banned.contains(owner(w))))), refusedBan' = refusedBan,
        identities' = identities, members' = members, turnKeys' = turnKeys.union(Set((m, e))),
      } else all {
        e != "",
        served' = served.union(Set(("textjoin", w, banned.contains(owner(w))))), refusedBan' = refusedBan,
        identities' = identities.union(Set(e)), members' = members.union(Set(e)), turnKeys' = turnKeys,
      },
      banned' = banned,
    }
  }

  // A written number that no path accepts: nothing changes (the 400 answers and "invalid_phone").
  action refuse(w: str): bool = all {
    P(w) == "",
    identities' = identities, members' = members, banned' = banned,
    served' = served, refusedBan' = refusedBan, turnKeys' = turnKeys,
  }

  action step = {
    nondet w = FORMS.oneOf()
    nondet k = Set("A", "B").oneOf()
    any { webJoin(w), otpStart(w), ban(k), inbound(w), refuse(w) }
  }

  // ---------------------------------------------------------------- invariants
  // Founder decision (spec/product/source/founder-decisions.md, 2026-10-09): "a banned number is refused
  // at join (web, text, MCP), OTP and inbound, on every app". Whatever the human writes, no code, join or
  // member turn is served to the human whose number is banned. Code: api.ts OTP start and verify,
  // hooks.ts startOtp and login, service.ts inbound() checkLineBan and join() checkJoinBan.
  val bannedNeverServed = served.forall(s => not(s._3))

  // packages/platform/src/phone.ts header: the platform stores only +1 numbers. normalizePhone is the
  // only way into platform.phone_identities.
  val identitiesAreUsNumbers = identities.forall(k => k == "A" or k == "B")

  // The ban key and the address book key are the same number (normalizeAddress agrees with normalizePhone
  // on every number that normalizePhone accepts; inbound() reads both for one turn). A member turn checks
  // the ban on the number it found the member by.
  val turnKeysAgree = turnKeys.forall(t => t._1 == t._2)

  // An identity key belongs to one human: no written form of one human reaches the key of another.
  // For P and Q both keys are the digits of the input (phone.ts normalizePhone, blooio phone.ts toE164).
  val keysNameOwner = FORMS.forall(w => (P(w) == "" or P(w) == owner(w)) and (P(w) == "" or Q(w) == P(w)))

  val safety = and {
    bannedNeverServed,
    identitiesAreUsNumbers,
    turnKeysAgree,
    keysNameOwner,
  }

  // ---------------------------------------------------------------- reachability witnesses (expected VIOLATED)
  // A web join in a formatted spelling, then a ban, then the canonical turn is refused.
  val witness_turnRefusedAfterBan = not(refusedBan.exists(r => r._1 == "turn"))
  // An OTP start in another spelling of a banned number is refused.
  val witness_otpRefusedOtherSpelling = not(refusedBan.contains(("otp", "A_paren")) or refusedBan.contains(("otp", "A_11")))
  // A member turn is handled.
  val witness_memberTurn = not(served.exists(s => s._1 == "turn"))
  // A text join from the canonical number.
  val witness_textJoin = not(served.exists(s => s._1 == "textjoin"))

  // ---------------------------------------------------------------- traces
  // Join on the web as "(212) 555-0101", banned, then every spelling is refused.
  run banEverySpellingTest =
    init
      .then(webJoin("A_paren"))
      .then(ban("A"))
      .then(otpStart("A_plus"))
      .then(webJoin("A_11"))
      .then(inbound("A"))
      .then(all { refuse("A_fullwidth") })
      .then(all { assert(refusedBan.size() == 3), assert(safety), webJoin("B") })
      .then(all { assert(served.contains(("web", "B", false))), assert(safety), refuse("F_uk") })

  // A text join, then a member turn: the ban key and the address key are the same.
  run textJoinThenTurnTest =
    init
      .then(inbound("B"))
      .then(inbound("B"))
      .then(all { assert(turnKeys == Set(("B", "B"))), assert(members == Set("B")), assert(safety), ban("B") })
      .then(inbound("B"))
      .then(all { assert(refusedBan.contains(("turn", "B"))), assert(safety), refuse("J_text") })

  // The turn guard refuses a spelling that is not E.164, and the platform never joins a UK number.
  run guardTest =
    init
      .then(inbound("A_paren"))
      .fail()
      .then(init)
      .then(webJoin("F_uk"))
      .fail()
}
```
