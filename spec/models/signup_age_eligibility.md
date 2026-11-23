# Private signup age eligibility

## Story: A signup birthday can end a minor restriction when the person turns 18

The browser confirms ownership before signup. The platform keeps the date only for an accepted signup by a minor. The Clock can advance the age that this signup supplies. An independent youth observation can still prevent matching.

### Safety rules and reachability

The model covers one verified person and their shared floor. `enroll` is the private write in the same database transaction as enrollment. The date is represented as a future tick. `recordIndependent` is the phone or person age floor. `erase` removes the private row and preserves the minimum numeric age, as account deletion does before release of a recycled number. The separate matching and staff reads return only numbers. The signed learning routes also use the effective age, with their existing independent adult evidence requirement. Accepting a minor signup applies the existing cross-app photo and rating erasure. The date calculation and cached minor check use the generated rules in [member age](../memberAge.md) and [connector authorization pages](../authorizationPages.md).

```quint
// quint-check: max-steps=14 max-samples=4000 verify-steps=8
// quint-witness: witness_birthdayAdvances birthdayAdvancesTest
// quint-witness: witness_independentAgeRemains independentAgeRemainsTest
module signup_age_eligibility {
  type State = { now: int, eligibleAt: int, signupAge: int, phoneFloor: int, otherYouth: bool }
  var s: State

  pure def lower(first: int, second: int): int =
    if (first < 0) second else if (second < 0 or first <= second) first else second

  pure def age(a: State): int = lower(a.phoneFloor,
    if (a.eligibleAt < 0) -1 else if (a.now >= a.eligibleAt) 18 else a.signupAge)

  pure def matchingAllowed(a: State): bool = age(a) >= 18 and not(a.otherYouth)

  action init = s' = { now: 0, eligibleAt: -1, signupAge: -1, phoneFloor: -1, otherYouth: false }

  action enroll(verified: bool, accepted: bool, initialAge: int, date: int): bool =
    s' = if (verified and accepted and initialAge >= 13 and initialAge < 18 and date > s.now)
      s.with("eligibleAt", if (date > s.eligibleAt) date else s.eligibleAt).with("signupAge", lower(s.signupAge, initialAge))
    else s

  action recordIndependent(observation: int): bool = s' = s.with("phoneFloor", lower(s.phoneFloor, observation))
  action markOtherYouth: bool = s' = s.with("otherYouth", true)
  action advance: bool = all { s.now < 4, s' = s.with("now", s.now + 1) }
  action erase: bool = s' = s.with("phoneFloor", age(s)).with("eligibleAt", -1).with("signupAge", -1)

  action step = any {
    enroll(true, true, 17, 2), enroll(true, true, 16, 3), enroll(true, true, 12, 2),
    enroll(false, true, 17, 2), enroll(true, false, 17, 2),
    recordIndependent(16), recordIndependent(20), markOtherYouth, advance, erase,
  }

  val safety = all {
    (s.eligibleAt >= 0 and s.now < s.eligibleAt) implies not(matchingAllowed(s)),
    (s.phoneFloor >= 0 and s.phoneFloor < 18) implies not(matchingAllowed(s)),
    s.otherYouth implies not(matchingAllowed(s)),
    (s.eligibleAt < 0) == (s.signupAge < 0),
  }
  val witness_birthdayAdvances = not(s.eligibleAt == 2 and s.now == 2 and matchingAllowed(s))
  val witness_independentAgeRemains = not(s.eligibleAt == 2 and s.now == 2 and age(s) == 16)

  run birthdayAdvancesTest = init.then(enroll(true, true, 17, 2)).then(advance).expect(not(matchingAllowed(s)))
    .then(advance).expect(not(witness_birthdayAdvances)).then(erase).expect(s.eligibleAt < 0)

  run independentAgeRemainsTest = init.then(recordIndependent(16)).then(enroll(true, true, 17, 2)).then(advance)
    .then(advance).expect(not(witness_independentAgeRemains))
}
```
