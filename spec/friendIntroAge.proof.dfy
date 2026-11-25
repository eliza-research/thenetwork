lemma lawGroupWithMinorHoldsOnlyTeenAges_ensures(teenIntros: bool, friendshipLane: bool, minDay: int, maxDay: int, roster: seq<AgeSide>)
  ensures (lawGroupWithMinorHoldsOnlyTeenAges(teenIntros, friendshipLane, minDay, maxDay, roster) == true)
{
  if groupAgeAllowed(teenIntros, friendshipLane, minDay, maxDay, roster) && rosterHasMinor(roster) {
    var minor :| minor in roster && !minor.adult;
    forall side | side in roster
      ensures side.ready && teenPartnerAge(side.birthKey, minDay, maxDay)
    {
      assert sideAllowedWithAll(teenIntros, friendshipLane, minDay, maxDay, side, roster);
      assert sidesAllowed(teenIntros, friendshipLane, minDay, maxDay, side, minor);
      assert !(side.adult && minor.adult);
      assert teenPairAllowed(teenIntros, friendshipLane, minDay, maxDay, side.ready, side.birthKey, minor.ready, minor.birthKey);
    }
  }
}

lemma lawGroupStoppedAdultsOnly_ensures(friendshipLane: bool, minDay: int, maxDay: int, roster: seq<AgeSide>)
  ensures (lawGroupStoppedAdultsOnly(friendshipLane, minDay, maxDay, roster) == true)
{
  if groupAgeAllowed(false, friendshipLane, minDay, maxDay, roster) {
    forall side | side in roster
      ensures side.adult
    {
      assert sideAllowedWithAll(false, friendshipLane, minDay, maxDay, side, roster);
      assert sidesAllowed(false, friendshipLane, minDay, maxDay, side, side);
      assert !teenPairAllowed(false, friendshipLane, minDay, maxDay, side.ready, side.birthKey, side.ready, side.birthKey);
    }
  } else {
    var first :| first in roster && !sideAllowedWithAll(false, friendshipLane, minDay, maxDay, first, roster);
    var second :| second in roster && !sidesAllowed(false, friendshipLane, minDay, maxDay, first, second);
    assert !teenPairAllowed(false, friendshipLane, minDay, maxDay, first.ready, first.birthKey, second.ready, second.birthKey);
    if !first.adult {
      assert first in roster && !first.adult;
    } else {
      assert second in roster && !second.adult;
    }
  }
}

lemma lawGroupNineteenNeverWithAMinor_ensures(teenIntros: bool, friendshipLane: bool, minDay: int, maxDay: int, roster: seq<AgeSide>)
  ensures (lawGroupNineteenNeverWithAMinor(teenIntros, friendshipLane, minDay, maxDay, roster) == true)
{
  if groupAgeAllowed(teenIntros, friendshipLane, minDay, maxDay, roster) && rosterHasMinor(roster) {
    var minor :| minor in roster && !minor.adult;
    forall side | side in roster
      ensures teenPartnerAge(side.birthKey, minDay, maxDay)
    {
      assert sideAllowedWithAll(teenIntros, friendshipLane, minDay, maxDay, side, roster);
      assert sidesAllowed(teenIntros, friendshipLane, minDay, maxDay, side, minor);
      assert !(side.adult && minor.adult);
      assert teenPairAllowed(teenIntros, friendshipLane, minDay, maxDay, side.ready, side.birthKey, minor.ready, minor.birthKey);
    }
  }
}

lemma lawGroupMinorWithinTwoYearsOfEveryone_ensures(teenIntros: bool, friendshipLane: bool, minDay: int, maxDay: int, roster: seq<AgeSide>)
  ensures (lawGroupMinorWithinTwoYearsOfEveryone(teenIntros, friendshipLane, minDay, maxDay, roster) == true)
{
  if groupAgeAllowed(teenIntros, friendshipLane, minDay, maxDay, roster) && rosterHasMinor(roster) {
    forall first, second | first in roster && second in roster && !first.adult
      ensures birthKeysWithinTwoYears(first.birthKey, second.birthKey)
    {
      assert sideAllowedWithAll(teenIntros, friendshipLane, minDay, maxDay, first, roster);
      assert sidesAllowed(teenIntros, friendshipLane, minDay, maxDay, first, second);
      assert !(first.adult && second.adult);
      assert teenPairAllowed(teenIntros, friendshipLane, minDay, maxDay, first.ready, first.birthKey, second.ready, second.birthKey);
    }
  }
}

lemma lawGroupWithMinorEverySideFits_ensures(teenIntros: bool, friendshipLane: bool, minDay: int, maxDay: int, roster: seq<AgeSide>)
  ensures (lawGroupWithMinorEverySideFits(teenIntros, friendshipLane, minDay, maxDay, roster) == true)
{
  if groupAgeAllowed(teenIntros, friendshipLane, minDay, maxDay, roster) && rosterHasMinor(roster) {
    var minor :| minor in roster && !minor.adult;
    forall side | side in roster
      ensures teenSideFits(side, minDay, maxDay)
    {
      assert sideAllowedWithAll(teenIntros, friendshipLane, minDay, maxDay, side, roster);
      assert sidesAllowed(teenIntros, friendshipLane, minDay, maxDay, side, minor);
      assert !(side.adult && minor.adult);
      assert teenPairAllowed(teenIntros, friendshipLane, minDay, maxDay, side.ready, side.birthKey, minor.ready, minor.birthKey);
    }
  }
}
