// -*- mode: Bluespec; -*-
// quint-check: max-steps=12 max-samples=4000
//
// phone_identity: one phone number is one identity key on every path that reads a number.
//
// WHAT THIS MODELS
//   The paths that turn a written phone number into a key, and the ban that keys on it:
//   - web OTP start and verify (packages/platform/src/api.ts:464-499, normalizePhone) and the web join
//     (api.ts:550-571, accounts.ts:355-422 joinPlan with the ban),
//   - MCP OTP start and login (packages/mcp/src/hooks.ts:136-150, normalizePhone, accounts.banned),
//   - staff ban by phone or person (packages/network/service/service.ts:2010-2042: the hashes of the
//     person's stored phone identities),
//   - the inbound turn (service.ts:2343 turn guard; service.ts:1194 memberOf, 1214 the hold check and
//     1268 the ban check of a member; service.ts:1308-1330 and 1612-1631 text join of a non-member).
//   Two normalizers make keys. P is phoneE164 (packages/core/src/phone-core.ts, through
//   packages/platform/src/phone.ts normalizePhone): +1 only, no NFKC. Q is anyE164 (the same file,
//   through packages/blooio/src/phone.ts toE164 and normalizeAddress): any country, after NFKC. The
//   runtime address book (runtime.ts:427-444 memberOf) and platform.member_apps key on Q.
//   P and Q are oracles here with their proved contracts (lsc check, phone-core.ts):
//   phoneE164 accepts only US or Canadian numbers, and anyE164 gives the same key as phoneE164 on every
//   input that phoneE164 accepts. The table FORMS is a small set of written forms with these contracts.
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
//   - A ban holds every member of the person (README "Reports, holds, bans"), so ban removes the key
//     from the address book. In the code the restricted member stays in the address book
//     (runtime.ts:430-431 skips only invited and removed) and the ban check (service.ts:1268) refuses
//     the turn; the outcome is the same, because the model checks the ban first.
//   - Age, invites, consent and rate limits are outside the model (join_age, auth_edge, turn_consent).
//   - The keyed hash (phoneKey) is the identity function: it is injective for these keys.
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

  // api.ts:464-499 and the web join (api.ts:550-571, accounts.ts:365-372): normalizePhone, then the ban
  // check, then the identity.
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

  // hooks.ts:136-142 (MCP OTP start) and api.ts:474 (web OTP start): a banned number gets { ok: true }
  // and no code (otp.ts:189; the rate limits still count, auth_edge models them).
  action otpStart(w: str): bool = {
    val e = P(w)
    all {
      e != "",
      if (banned.contains(e)) all { refusedBan' = refusedBan.union(Set(("otp", w))), served' = served }
      else all { served' = served.union(Set(("otp", w, banned.contains(owner(w))))), refusedBan' = refusedBan },
      identities' = identities, members' = members, banned' = banned, unchangedGhost,
    }
  }

  // service.ts:2010-2042: a ban takes the person's stored phone hashes and holds every member.
  action ban(k: str): bool = all {
    identities.contains(k),
    banned' = banned.union(Set(k)), members' = members.exclude(Set(k)),
    identities' = identities, served' = served, refusedBan' = refusedBan, unchangedGhost,
  }

  // One signed turn. service.ts:2343: `from` must be its own normalizePhone, else 400. Then memberOf
  // reads the Q key (service.ts:1194) and the hold and ban checks read the P key (service.ts:1197, 1214,
  // 1268). A non-member with a number goes to the text join (service.ts:1308-1330, join at 1612-1631),
  // which checks the ban.
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
  // AGENTS.md founder decision 3 (2026-10-09): "a banned number is refused at join (web, text, MCP),
  // OTP and inbound, on every app". Whatever the human writes, no code, join or member turn is served
  // to the human whose number is banned. Code: api.ts:474 and 488, hooks.ts:141 and 149, service.ts:1268
  // and 1631.
  val bannedNeverServed = served.forall(s => not(s._3))

  // platform plan 3.2 (packages/platform/src/phone.ts header): the platform stores only +1 numbers.
  // phoneE164 is the only way into platform.phone_identities.
  val identitiesAreUsNumbers = identities.forall(k => k == "A" or k == "B")

  // The ban key and the address book key are the same number (phone-core.ts header: anyE164 agrees with
  // phoneE164; service.ts:1194-1197 reads both for one turn). A member turn checks the ban on the
  // number it found the member by.
  val turnKeysAgree = turnKeys.forall(t => t._1 == t._2)

  // An identity key belongs to one human: no written form of one human reaches the key of another.
  // Proved for P and Q in phone-core.ts (digitsOf: the key is the digits of the input).
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
