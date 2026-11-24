# Browser photo upload link

## Story: Upload private photos once from a link

The [upload token](../photoUploadLink.md) connects the adult Slop member's text request with the browser's status and upload requests. A link authorizes a bounded upload batch to its own app. It grants no read access. This model represents an accepted batch by one image and an expiry by two ticks. [Photo storage](photos_rating.md) covers private images, the person lock, and erasure after eligibility changes.

```quint
// quint-check: max-steps=20 max-samples=4000 verify-steps=8
// quint-witness: witness_stored singleUseTest
module photo_upload_entry {
  type State = {
    now: int, expires: int, phase: str, adult: bool, identityCurrent: bool,
    liveMembership: bool, held: bool, consent: bool, pending: bool,
    stores: int, storedWithAuthority: bool,
  }
  var s: State

  pure def holderAllowed(x: State): bool =
    x.adult and x.identityCurrent and x.liveMembership and not(x.held)

  pure def usable(x: State, ownApp: bool): bool =
    x.phase == "open" and ownApp and x.now < x.expires and holderAllowed(x)

  action init = s' = { now: 0, expires: -1, phase: "none", adult: true, identityCurrent: true,
    liveMembership: true, held: false, consent: false, pending: false, stores: 0, storedWithAuthority: true }
  action issue = all {
    s.phase == "none", holderAllowed(s),
    s' = { ...s, phase: "open", expires: s.now + 2 },
  }
  action status(ownApp: bool): bool = all { usable(s, ownApp), s' = s }
  action redeem(ownApp: bool, validBatch: bool, newConsent: bool): bool = all {
    s.phase == "open",
    s' = if (not(validBatch) or s.now >= s.expires) s
      else if (not(usable(s, ownApp))) { ...s, phase: "refused" }
      else if (s.consent or newConsent) { ...s, phase: "spent", consent: true, pending: true }
      else s,
  }
  action publish = all {
    s.pending,
    val allowed = holderAllowed(s) and s.consent
    s' = { ...s, pending: false, stores: s.stores + (if (allowed) 1 else 0),
      storedWithAuthority: if (allowed) s.phase == "spent" else s.storedWithAuthority },
  }
  action tick = s' = { ...s, now: s.now + 1 }
  action lowerAge = s' = { ...s, adult: false }
  action identityHold = s' = { ...s, identityCurrent: false }
  action leave = s' = { ...s, liveMembership: false, consent: false, phase: if (s.phase == "open") "refused" else s.phase }
  action safetyHold = s' = { ...s, held: true }

  action step = any {
    issue, status(true), redeem(true, true, true), redeem(true, true, false),
    redeem(true, false, true), redeem(false, true, true), publish, tick,
    lowerAge, identityHold, leave, safetyHold,
  }
  val safety = s.stores <= 1 and s.storedWithAuthority and
    (s.pending implies s.phase == "spent") and (s.stores > 0 implies s.phase == "spent")
  val witness_stored = s.stores == 0

  run singleUseTest = init.then(issue).then(status(true)).then(redeem(true, true, false))
    .expect(s.phase == "open").then(redeem(true, true, true)).then(publish)
    .expect(s.stores == 1 and not(usable(s, true))).expect(not(witness_stored))
  run lowerAgeBeforePublishTest = init.then(issue).then(redeem(true, true, true)).then(lowerAge)
    .then(publish).expect(s.stores == 0)
  run identityHoldBeforePublishTest = init.then(issue).then(redeem(true, true, true)).then(identityHold)
    .then(publish).expect(s.stores == 0)
  run wrongAppClosesTest = init.then(issue).then(redeem(false, true, false)).expect(s.phase == "refused" and s.stores == 0)
  run expiredCannotUploadTest = init.then(issue).then(tick).then(tick)
    .then(redeem(true, true, true)).expect(not(usable(s, true)) and s.stores == 0)
  run leaveClosesOpenLinkTest = init.then(issue).then(leave).expect(s.phase == "refused" and not(usable(s, true)))
}
```
