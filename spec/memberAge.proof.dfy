lemma MemberAgeYears(birthKey: int, dayKey: int)
  requires dayKey >= birthKey
  ensures 0 <= ageOnDay(birthKey, dayKey)
  ensures ageOnDay(birthKey, dayKey) * 10000 <= dayKey - birthKey
  ensures dayKey - birthKey < ageOnDay(birthKey, dayKey) * 10000 + 10000
{
  var gap := dayKey - birthKey;
  assert dayKeyYear == 10000;
  assert ageOnDay(birthKey, dayKey) == gap / 10000;
  assert gap == (gap / 10000) * 10000 + gap % 10000;
}

lemma MemberAgeIs(birthKey: int, dayKey: int, age: int)
  requires dayKey >= birthKey
  requires age * 10000 <= dayKey - birthKey
  requires dayKey - birthKey < age * 10000 + 10000
  ensures ageOnDay(birthKey, dayKey) == age
{
  MemberAgeYears(birthKey, dayKey);
  var years := ageOnDay(birthKey, dayKey);
  if years < age {
    assert years * 10000 + 10000 <= age * 10000;
    assert false;
  }
  if years > age {
    assert age * 10000 + 10000 <= years * 10000;
    assert false;
  }
}

lemma MemberAgeAntitone(firstKey: int, secondKey: int, dayKey: int)
  requires firstKey <= secondKey
  ensures ageOnDay(secondKey, dayKey) <= ageOnDay(firstKey, dayKey)
{
  if dayKey >= secondKey {
    MemberAgeYears(firstKey, dayKey);
    MemberAgeYears(secondKey, dayKey);
    var older := ageOnDay(firstKey, dayKey);
    var younger := ageOnDay(secondKey, dayKey);
    if younger > older {
      assert older * 10000 + 10000 <= younger * 10000;
      assert false;
    }
  } else if dayKey >= firstKey {
    MemberAgeYears(firstKey, dayKey);
  }
}

lemma lawBirthdayAddsOneYear_ensures(birthKey: int, dayKey: int)
  ensures (lawBirthdayAddsOneYear(birthKey, dayKey) == true)
{
  if dayKey >= birthKey {
    assert dayKeyYear == 10000;
    MemberAgeYears(birthKey, dayKey);
    MemberAgeIs(birthKey, dayKey + 10000, ageOnDay(birthKey, dayKey) + 1);
  }
}

lemma lawLeapDayBirthdayCountsFromMarchFirst_ensures(birthYear: int, year: int)
  ensures (lawLeapDayBirthdayCountsFromMarchFirst(birthYear, year) == true)
{
  if year > birthYear {
    assert dayKeyYear == 10000;
    assert birthYear * dayKeyYear == birthYear * 10000;
    assert year * dayKeyYear == year * 10000;
    MemberAgeIs(birthYear * 10000 + 229, year * 10000 + 228, year - birthYear - 1);
    MemberAgeIs(birthYear * 10000 + 229, year * 10000 + 301, year - birthYear);
  }
}

lemma lawStatedAgeReadsBack_ensures(age: int, dayKey: int)
  ensures (lawStatedAgeReadsBack(age, dayKey) == true)
{
  if age >= 0 {
    assert dayKeyYear == 10000;
    assert age * dayKeyYear == age * 10000;
    assert (age + 1) * dayKeyYear == age * 10000 + 10000;
    var upper := statedAgeUpper(age, dayKey);
    var lower := statedAgeLower(age, dayKey);
    assert upper == dayKey - age * 10000;
    assert lower == dayKey - age * 10000 - 10000;
    MemberAgeIs(upper, dayKey, age);
    MemberAgeIs(lower + 1, dayKey, age);
    MemberAgeIs(lower, dayKey, age + 1);
  }
}

lemma lawLowerStatedAgeWins_ensures(birthKey: int, age: int, dayKey: int)
  ensures (lawLowerStatedAgeWins(birthKey, age, dayKey) == true)
{
  if dayKey >= birthKey && age >= 0 && age < ageOnDay(birthKey, dayKey) {
    MemberAgeYears(birthKey, dayKey);
    assert dayKeyYear == 10000;
    assert age * dayKeyYear == age * 10000;
    assert (age + 1) * dayKeyYear == age * 10000 + 10000;
    var years := ageOnDay(birthKey, dayKey);
    assert age * 10000 + 10000 <= years * 10000;
    var lower := statedAgeLower(age, dayKey);
    var upper := statedAgeUpper(age, dayKey);
    assert lower == dayKey - age * 10000 - 10000;
    assert upper == dayKey - age * 10000;
    assert birthKey <= lower;
    var merged := mergeReading(true, BirthReadings(birthDateLower(birthKey), birthKey, birthKey), lower, upper);
    assert merged.lower == lower;
    assert merged.upper == birthKey;
    assert merged.youngest == upper;
    assert readingsConflict(merged);
    assert effectiveBirthKey(merged) == upper;
    MemberAgeIs(upper, dayKey, age);
  }
}

lemma lawAgreeingAgeKeepsTheBirthDateExact_ensures(birthKey: int, dayKey: int)
  ensures (lawAgreeingAgeKeepsTheBirthDateExact(birthKey, dayKey) == true)
{
  if dayKey >= birthKey {
    MemberAgeYears(birthKey, dayKey);
    assert dayKeyYear == 10000;
    var years := ageOnDay(birthKey, dayKey);
    assert years * dayKeyYear == years * 10000;
    assert (years + 1) * dayKeyYear == years * 10000 + 10000;
    var lower := statedAgeLower(years, dayKey);
    var upper := statedAgeUpper(years, dayKey);
    assert lower == dayKey - years * 10000 - 10000;
    assert upper == dayKey - years * 10000;
    assert lower < birthKey <= upper;
    var merged := mergeReading(true, BirthReadings(birthDateLower(birthKey), birthKey, birthKey), lower, upper);
    assert merged.lower == birthKey - 1;
    assert merged.upper == birthKey;
    assert !readingsConflict(merged);
    assert birthDateExact(true, birthKey, merged);
  }
}

lemma lawOlderClaimNeverUnlocksAdult_ensures(earlier: BirthReadings, lower: int, upper: int, dayKey: int)
  ensures (lawOlderClaimNeverUnlocksAdult(earlier, lower, upper, dayKey) == true)
{
  if earlier.youngest > earlier.lower && lower < upper {
    var merged := mergeReading(true, earlier, lower, upper);
    assert merged.lower >= earlier.lower;
    assert merged.youngest >= earlier.youngest;
    assert effectiveBirthKey(merged) >= earlier.lower + 1;
    MemberAgeAntitone(earlier.lower + 1, effectiveBirthKey(merged), dayKey);
  }
}

lemma lawLegacyMinorKeepsMinorAge_ensures(adultBirthKey: int)
  ensures (lawLegacyMinorKeepsMinorAge(adultBirthKey) == true)
{
  assert dayKeyYear == 10000;
  var legacy := legacyReading(15, 20260101, 20261122);
  assert legacy.lower == 20100101;
  assert legacy.upper == 20111122;
  assert legacy.youngest == 20111122;
  if adultBirthKey <= legacy.lower {
    var merged := mergeReading(true, legacy, birthDateLower(adultBirthKey), adultBirthKey);
    assert merged.lower == 20100101;
    assert merged.upper == adultBirthKey;
    assert merged.youngest == 20111122;
    assert readingsConflict(merged);
    assert effectiveBirthKey(merged) == 20111122;
    MemberAgeIs(20111122, 20261122, 15);
  }
}

lemma lawFloorTwelveRefusesAdultBirthDate_ensures(adultBirthKey: int)
  ensures (lawFloorTwelveRefusesAdultBirthDate(adultBirthKey) == true)
{
  assert dayKeyYear == 10000;
  var phoneFloor := BirthReadings(statedAgeLower(12, 20260601), statedAgeUpper(12, 20260601), statedAgeUpper(12, 20260601));
  assert phoneFloor.lower == 20130601;
  assert phoneFloor.upper == 20140601;
  assert phoneFloor.youngest == 20140601;
  if adultBirthKey <= phoneFloor.lower {
    var merged := mergeReading(true, phoneFloor, birthDateLower(adultBirthKey), adultBirthKey);
    assert merged.lower == 20130601;
    assert merged.upper == adultBirthKey;
    assert merged.youngest == 20140601;
    assert readingsConflict(merged);
    assert effectiveBirthKey(merged) == 20140601;
    MemberAgeIs(20140601, 20261122, 12);
    assert !joinableAge(12);
  }
}
