# Private signup age eligibility

## Story: A signup birthday can end a minor restriction when the person turns 18

The browser confirms ownership before signup. The platform keeps the date only for an accepted signup by a minor. The Clock can advance the age that this signup supplies. An independent youth observation can still prevent matching.

### Safety rules and reachability

The model covers one verified person and their shared floor. `enroll` is the private write in the same database transaction as enrollment. The date is represented as a future tick. `recordIndependent` is the phone or person age floor. `erase` removes the private row and preserves the minimum numeric age, as account deletion does before release of a recycled number. The separate matching and staff reads return only numbers. The signed learning routes also use the effective age, with their existing independent adult evidence requirement. Accepting a minor signup applies the existing cross-app photo and rating erasure. The date calculation and cached minor check use the generated rules in [member age](../memberAge.md) and [connector authorization pages](../authorizationPages.md).

An additional app checks the effective age for admission. Its durable member age comes from independent evidence. The separate age projection keeps a browser-only minor restriction while the member is under 18 and can release it on time in both apps. A signed test covers browser signup followed by enrollment in another app.

Acceptance means the transaction committed the current verified membership and Network member. A failed attempt leaves any earlier eligibility date and initial age unchanged. The media cleanup occurs before the transaction commits. Welcome and profile projection use the accepted membership after commit.

```quint
// quint-check: max-steps=14 max-samples=4000 verify-steps=8
// quint-witness: witness_birthdayAdvances birthdayAdvancesTest
// quint-witness: witness_independentAgeRemains independentAgeRemainsTest
// quint-witness: witness_additionalAppAgeAdvances additionalAppAgeAdvancesTest
module signup_age_eligibility {
  type State = { now: int, eligibleAt: int, signupAge: int, phoneFloor: int, appRecordedAge: int, otherYouth: bool }
  var s: State

  pure def lower(first: int, second: int): int =
    if (first < 0) second else if (second < 0 or first <= second) first else second

  pure def age(a: State): int = lower(a.phoneFloor,
    if (a.eligibleAt < 0) -1 else if (a.now >= a.eligibleAt) 18 else a.signupAge)

  pure def matchingAge(a: State): int = lower(age(a), a.appRecordedAge)
  pure def matchingAllowed(a: State): bool = matchingAge(a) >= 18 and not(a.otherYouth)

  action init = s' = { now: 0, eligibleAt: -1, signupAge: -1, phoneFloor: -1, appRecordedAge: -1, otherYouth: false }

  action enroll(verified: bool, accepted: bool, initialAge: int, date: int): bool =
    s' = if (verified and accepted and initialAge >= 13 and initialAge < 18 and date > s.now)
      s.with("eligibleAt", if (date > s.eligibleAt) date else s.eligibleAt).with("signupAge", lower(s.signupAge, initialAge))
    else s

  action recordIndependent(observation: int): bool = s' = s.with("phoneFloor", lower(s.phoneFloor, observation))
  action enrollAdditionalApp(observation: int): bool = {
    val independent = lower(s.phoneFloor, observation)
    s' = s.with("phoneFloor", independent).with("appRecordedAge", independent)
  }
  action markOtherYouth: bool = s' = s.with("otherYouth", true)
  action advance: bool = all { s.now < 4, s' = s.with("now", s.now + 1) }
  action erase: bool = s' = s.with("phoneFloor", age(s)).with("eligibleAt", -1).with("signupAge", -1).with("appRecordedAge", -1)

  action step = any {
    enroll(true, true, 17, 2), enroll(true, true, 16, 3), enroll(true, true, 12, 2),
    enroll(false, true, 17, 2), enroll(true, false, 17, 2),
    recordIndependent(16), recordIndependent(20), enrollAdditionalApp(-1), enrollAdditionalApp(16), enrollAdditionalApp(25),
    markOtherYouth, advance, erase,
  }

  val safety = all {
    (s.eligibleAt >= 0 and s.now < s.eligibleAt) implies not(matchingAllowed(s)),
    (s.phoneFloor >= 0 and s.phoneFloor < 18) implies not(matchingAllowed(s)),
    s.otherYouth implies not(matchingAllowed(s)),
    (s.eligibleAt < 0) == (s.signupAge < 0),
    matchingAge(s) == age(s),
  }
  val witness_birthdayAdvances = not(s.eligibleAt == 2 and s.now == 2 and matchingAllowed(s))
  val witness_independentAgeRemains = not(s.eligibleAt == 2 and s.now == 2 and age(s) == 16)
  val witness_additionalAppAgeAdvances = not(s.appRecordedAge == 25 and s.eligibleAt == 2 and s.now == 2 and matchingAllowed(s))

  run birthdayAdvancesTest = init.then(enroll(true, true, 17, 2)).then(advance).expect(not(matchingAllowed(s)))
    .then(advance).expect(not(witness_birthdayAdvances)).then(erase).expect(s.eligibleAt < 0)

  run independentAgeRemainsTest = init.then(recordIndependent(16)).then(enroll(true, true, 17, 2)).then(advance)
    .then(advance).expect(not(witness_independentAgeRemains))

  run additionalAppAgeAdvancesTest = init.then(enroll(true, true, 17, 2)).then(enrollAdditionalApp(25))
    .expect(matchingAge(s) == 17 and s.appRecordedAge == 25).then(advance).then(advance)
    .expect(not(witness_additionalAppAgeAdvances))

  run failedSignupLeavesPrivateAgeUnchangedTest = init.then(enroll(true, false, 17, 2))
    .expect(s.eligibleAt == -1 and s.signupAge == -1).then(enroll(true, true, 17, 2))
    .then(enroll(true, false, 16, 3)).expect(s.eligibleAt == 2 and s.signupAge == 17)

  run onlyAcceptedLaterSignupDelaysEligibilityTest = init.then(enroll(true, true, 17, 2))
    .then(enroll(true, true, 16, 3)).then(enroll(true, true, 17, 1))
    .expect(s.eligibleAt == 3 and s.signupAge == 16)
}
```
