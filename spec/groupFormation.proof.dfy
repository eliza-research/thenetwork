lemma GroupFormationDivMonotone(low: int, high: int, size: int)
  requires 0 <= low <= high && size > 0
  ensures low / size <= high / size
{
  var lowQuotient := low / size;
  var highQuotient := high / size;
  if lowQuotient > highQuotient {
    var lowRemainder := low % size;
    var highRemainder := high % size;
    assert 0 <= lowRemainder < size;
    assert 0 <= highRemainder < size;
    assert lowQuotient * size >= (highQuotient + 1) * size by {
      assert lowQuotient - (highQuotient + 1) >= 0;
      assert (lowQuotient - (highQuotient + 1)) * size >= 0;
    }
    calc {
      high;
      == highQuotient * size + highRemainder;
      < highQuotient * size + size;
      == (highQuotient + 1) * size;
      <= lowQuotient * size;
      <= lowQuotient * size + lowRemainder;
      == low;
    }
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
