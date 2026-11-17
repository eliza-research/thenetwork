lemma GroupFormationDivMonotone(low: int, high: int, size: int)
  requires 0 <= low <= high && size > 0
  ensures low / size <= high / size
{
  var lowQuotient := low / size;
  var highQuotient := high / size;
  assert low == lowQuotient * size + low % size;
  assert high == highQuotient * size + high % size;
  if lowQuotient > highQuotient {
    assert lowQuotient * size >= (highQuotient + 1) * size by {
      assert lowQuotient - (highQuotient + 1) >= 0;
      assert (lowQuotient - (highQuotient + 1)) * size >= 0;
    }
    assert (highQuotient + 1) * size == highQuotient * size + size;
    assert false;
  }
}

lemma lawCliqueShareIsHighest_ensures(neighbours: int, circleSize: int)
  ensures (lawCliqueShareIsHighest(neighbours, circleSize) == true)
{
  if circleSize > 0 {
    var counted := if neighbours < 0 then 0 else if neighbours > circleSize - 1 then circleSize - 1 else neighbours;
    assert 0 <= counted <= circleSize - 1;
    var share := circleShareScale * counted;
    var cliqueShare := circleShareScale * (circleSize - 1);
    assert 0 <= share <= cliqueShare;
    GroupFormationDivMonotone(share, cliqueShare, circleSize);
    assert circleMemberShare(neighbours, circleSize) == share / circleSize;
    assert circleMemberShare(circleSize - 1, circleSize) == cliqueShare / circleSize;
  }
}
