// Photo masks: a mask from 0 to 63 is the sum of its six slot bits times
// their weights 1, 2, 4, 8, 16 and 32. The lemmas below turn each mask
// operation (bothMasks, withoutMask) into one statement per slot bit, so that
// the laws about the photo pick need no division or modulo.

lemma PhotoQuotient(a: int, d: int)
  requires a >= 0 && d >= 1
  ensures quotient_photoRelayItem(a, d) == a / d
  ensures remainder_photoRelayItem(a, 2) == a % 2
{
  assert MathAbs(a) == a;
  assert MathAbs(d) == d;
  assert MathAbs(2) == 2;
  assert JSFloorDiv(a, d) == a / d;
  assert JSFloorDiv(a, 2) == a / 2;
}

lemma PhotoSlotBit(m: int, d: int)
  requires d >= 1
  ensures 0 <= cleanMask(m) <= 63
  ensures slotBit(m, d) == (cleanMask(m) / d) % 2
{
  assert maskAll == 63;
  var c := cleanMask(m);
  PhotoQuotient(c, d);
  PhotoQuotient(c / d, 2);
}

lemma PhotoBits(m: int)
  ensures 0 <= slotBit(m, 1) <= 1 && 0 <= slotBit(m, 2) <= 1 && 0 <= slotBit(m, 4) <= 1
  ensures 0 <= slotBit(m, 8) <= 1 && 0 <= slotBit(m, 16) <= 1 && 0 <= slotBit(m, 32) <= 1
  ensures cleanMask(m) == slotBit(m, 1) + 2 * slotBit(m, 2) + 4 * slotBit(m, 4) + 8 * slotBit(m, 8) + 16 * slotBit(m, 16) + 32 * slotBit(m, 32)
{
  PhotoSlotBit(m, 1);
  PhotoSlotBit(m, 2);
  PhotoSlotBit(m, 4);
  PhotoSlotBit(m, 8);
  PhotoSlotBit(m, 16);
  PhotoSlotBit(m, 32);
  var c := cleanMask(m);
  var q1 := c / 2;
  var q2 := q1 / 2;
  var q3 := q2 / 2;
  var q4 := q3 / 2;
  var q5 := q4 / 2;
  assert c == 2 * q1 + c % 2;
  assert q1 == 2 * q2 + q1 % 2;
  assert q2 == 2 * q3 + q2 % 2;
  assert q3 == 2 * q4 + q3 % 2;
  assert q4 == 2 * q5 + q4 % 2;
  assert c / 4 == q2;
  assert c / 8 == q3;
  assert c / 16 == q4;
  assert c / 32 == q5;
  assert q5 == q5 % 2;
}

lemma PhotoFromBits(v: int, b1: int, b2: int, b4: int, b8: int, b16: int, b32: int)
  requires 0 <= b1 <= 1 && 0 <= b2 <= 1 && 0 <= b4 <= 1
  requires 0 <= b8 <= 1 && 0 <= b16 <= 1 && 0 <= b32 <= 1
  requires v == b1 + 2 * b2 + 4 * b4 + 8 * b8 + 16 * b16 + 32 * b32
  ensures cleanMask(v) == v
  ensures slotBit(v, 1) == b1 && slotBit(v, 2) == b2 && slotBit(v, 4) == b4
  ensures slotBit(v, 8) == b8 && slotBit(v, 16) == b16 && slotBit(v, 32) == b32
{
  assert maskAll == 63;
  assert cleanMask(v) == v;
  PhotoSlotBit(v, 1);
  PhotoSlotBit(v, 2);
  PhotoSlotBit(v, 4);
  PhotoSlotBit(v, 8);
  PhotoSlotBit(v, 16);
  PhotoSlotBit(v, 32);
  var r1 := b2 + 2 * b4 + 4 * b8 + 8 * b16 + 16 * b32;
  var r2 := b4 + 2 * b8 + 4 * b16 + 8 * b32;
  var r3 := b8 + 2 * b16 + 4 * b32;
  var r4 := b16 + 2 * b32;
  assert v == 2 * r1 + b1;
  assert v / 2 == r1;
  assert v == 4 * r2 + (b1 + 2 * b2);
  assert v / 4 == r2;
  assert v == 8 * r3 + (b1 + 2 * b2 + 4 * b4);
  assert v / 8 == r3;
  assert v == 16 * r4 + (b1 + 2 * b2 + 4 * b4 + 8 * b8);
  assert v / 16 == r4;
  assert v == 32 * b32 + (b1 + 2 * b2 + 4 * b4 + 8 * b8 + 16 * b16);
  assert v / 32 == b32;
  assert r1 == 2 * (b4 + 2 * b8 + 4 * b16 + 8 * b32) + b2;
  assert r2 == 2 * (b8 + 2 * b16 + 4 * b32) + b4;
  assert r3 == 2 * (b16 + 2 * b32) + b8;
  assert r4 == 2 * b32 + b16;
}

lemma PhotoProduct(x: int, y: int)
  requires 0 <= x <= 1 && 0 <= y <= 1
  ensures 0 <= x * y <= 1
  ensures x * y == 1 <==> (x == 1 && y == 1)
{
  if x == 0 {
    assert x * y == 0;
  } else {
    assert x * y == y;
  }
}

lemma PhotoBoth(a: int, b: int)
  ensures cleanMask(bothMasks(a, b)) == bothMasks(a, b)
  ensures slotBit(bothMasks(a, b), 1) == slotBit(a, 1) * slotBit(b, 1)
  ensures slotBit(bothMasks(a, b), 2) == slotBit(a, 2) * slotBit(b, 2)
  ensures slotBit(bothMasks(a, b), 4) == slotBit(a, 4) * slotBit(b, 4)
  ensures slotBit(bothMasks(a, b), 8) == slotBit(a, 8) * slotBit(b, 8)
  ensures slotBit(bothMasks(a, b), 16) == slotBit(a, 16) * slotBit(b, 16)
  ensures slotBit(bothMasks(a, b), 32) == slotBit(a, 32) * slotBit(b, 32)
{
  PhotoBits(a);
  PhotoBits(b);
  PhotoProduct(slotBit(a, 1), slotBit(b, 1));
  PhotoProduct(slotBit(a, 2), slotBit(b, 2));
  PhotoProduct(slotBit(a, 4), slotBit(b, 4));
  PhotoProduct(slotBit(a, 8), slotBit(b, 8));
  PhotoProduct(slotBit(a, 16), slotBit(b, 16));
  PhotoProduct(slotBit(a, 32), slotBit(b, 32));
  PhotoFromBits(bothMasks(a, b), slotBit(a, 1) * slotBit(b, 1), slotBit(a, 2) * slotBit(b, 2), slotBit(a, 4) * slotBit(b, 4), slotBit(a, 8) * slotBit(b, 8), slotBit(a, 16) * slotBit(b, 16), slotBit(a, 32) * slotBit(b, 32));
}

lemma PhotoWithout(m: int, x: int)
  ensures cleanMask(withoutMask(m, x)) == withoutMask(m, x)
  ensures slotBit(withoutMask(m, x), 1) == slotBit(m, 1) - slotBit(m, 1) * slotBit(x, 1)
  ensures slotBit(withoutMask(m, x), 2) == slotBit(m, 2) - slotBit(m, 2) * slotBit(x, 2)
  ensures slotBit(withoutMask(m, x), 4) == slotBit(m, 4) - slotBit(m, 4) * slotBit(x, 4)
  ensures slotBit(withoutMask(m, x), 8) == slotBit(m, 8) - slotBit(m, 8) * slotBit(x, 8)
  ensures slotBit(withoutMask(m, x), 16) == slotBit(m, 16) - slotBit(m, 16) * slotBit(x, 16)
  ensures slotBit(withoutMask(m, x), 32) == slotBit(m, 32) - slotBit(m, 32) * slotBit(x, 32)
{
  PhotoBits(m);
  PhotoBits(x);
  PhotoProduct(slotBit(m, 1), slotBit(x, 1));
  PhotoProduct(slotBit(m, 2), slotBit(x, 2));
  PhotoProduct(slotBit(m, 4), slotBit(x, 4));
  PhotoProduct(slotBit(m, 8), slotBit(x, 8));
  PhotoProduct(slotBit(m, 16), slotBit(x, 16));
  PhotoProduct(slotBit(m, 32), slotBit(x, 32));
  PhotoFromBits(withoutMask(m, x), slotBit(m, 1) - slotBit(m, 1) * slotBit(x, 1), slotBit(m, 2) - slotBit(m, 2) * slotBit(x, 2), slotBit(m, 4) - slotBit(m, 4) * slotBit(x, 4), slotBit(m, 8) - slotBit(m, 8) * slotBit(x, 8), slotBit(m, 16) - slotBit(m, 16) * slotBit(x, 16), slotBit(m, 32) - slotBit(m, 32) * slotBit(x, 32));
}

// One slot: o is the slot of a mask, s and x the slots of two others,
// f the slot of withoutMask(o, s) and t the slot of bothMasks(o, x).
lemma PhotoSlot(o: int, s: int, x: int, f: int, t: int)
  requires 0 <= o <= 1 && 0 <= s <= 1 && 0 <= x <= 1
  requires f == o - o * s
  requires t == o * x
  ensures 0 <= f <= o && 0 <= t <= o && o <= 1
  ensures f * s == 0 && o * s == o - f
  ensures 0 <= f * x <= t && t * s == t - f * x
{
  if o == 0 {
    assert o * s == 0;
    assert f == 0;
    assert t == 0;
    assert f * s == 0;
    assert f * x == 0;
    assert t * s == 0;
  } else {
    assert o * s == s;
    assert t == x;
    assert t * s == x * s;
    if s == 1 {
      assert f == 0;
      assert f * s == 0;
      assert f * x == 0;
    } else {
      assert f == 1;
      assert f * s == 0;
      assert f * x == x;
      assert x * s == 0;
    }
  }
}

// A mask without x holds no slot of x.
lemma PhotoWithoutHasNone(m: int, x: int)
  ensures bothMasks(withoutMask(m, x), x) == 0
{
  PhotoBits(m);
  PhotoBits(x);
  PhotoProduct(slotBit(m, 1), slotBit(x, 1));
  PhotoProduct(slotBit(m, 2), slotBit(x, 2));
  PhotoProduct(slotBit(m, 4), slotBit(x, 4));
  PhotoProduct(slotBit(m, 8), slotBit(x, 8));
  PhotoProduct(slotBit(m, 16), slotBit(x, 16));
  PhotoProduct(slotBit(m, 32), slotBit(x, 32));
  PhotoWithout(m, x);
  PhotoBoth(m, x);
  PhotoSlot(slotBit(m, 1), slotBit(x, 1), slotBit(x, 1), slotBit(withoutMask(m, x), 1), slotBit(bothMasks(m, x), 1));
  PhotoSlot(slotBit(m, 2), slotBit(x, 2), slotBit(x, 2), slotBit(withoutMask(m, x), 2), slotBit(bothMasks(m, x), 2));
  PhotoSlot(slotBit(m, 4), slotBit(x, 4), slotBit(x, 4), slotBit(withoutMask(m, x), 4), slotBit(bothMasks(m, x), 4));
  PhotoSlot(slotBit(m, 8), slotBit(x, 8), slotBit(x, 8), slotBit(withoutMask(m, x), 8), slotBit(bothMasks(m, x), 8));
  PhotoSlot(slotBit(m, 16), slotBit(x, 16), slotBit(x, 16), slotBit(withoutMask(m, x), 16), slotBit(bothMasks(m, x), 16));
  PhotoSlot(slotBit(m, 32), slotBit(x, 32), slotBit(x, 32), slotBit(withoutMask(m, x), 32), slotBit(bothMasks(m, x), 32));
}

// A slot that a mask leaves out stays out after another difference or intersection.
lemma PhotoNarrowHasNone(m: int, e: int, s: int, x: int)
  requires bothMasks(m, e) == 0
  ensures bothMasks(withoutMask(m, s), e) == 0
  ensures bothMasks(bothMasks(m, x), e) == 0
{
  PhotoBits(m);
  PhotoBits(e);
  PhotoBits(s);
  PhotoBits(x);
  PhotoProduct(slotBit(m, 1), slotBit(e, 1));
  PhotoProduct(slotBit(m, 2), slotBit(e, 2));
  PhotoProduct(slotBit(m, 4), slotBit(e, 4));
  PhotoProduct(slotBit(m, 8), slotBit(e, 8));
  PhotoProduct(slotBit(m, 16), slotBit(e, 16));
  PhotoProduct(slotBit(m, 32), slotBit(e, 32));
  PhotoProduct(slotBit(m, 1), slotBit(s, 1));
  PhotoProduct(slotBit(m, 2), slotBit(s, 2));
  PhotoProduct(slotBit(m, 4), slotBit(s, 4));
  PhotoProduct(slotBit(m, 8), slotBit(s, 8));
  PhotoProduct(slotBit(m, 16), slotBit(s, 16));
  PhotoProduct(slotBit(m, 32), slotBit(s, 32));
  PhotoProduct(slotBit(m, 1), slotBit(x, 1));
  PhotoProduct(slotBit(m, 2), slotBit(x, 2));
  PhotoProduct(slotBit(m, 4), slotBit(x, 4));
  PhotoProduct(slotBit(m, 8), slotBit(x, 8));
  PhotoProduct(slotBit(m, 16), slotBit(x, 16));
  PhotoProduct(slotBit(m, 32), slotBit(x, 32));
  PhotoWithout(m, s);
  PhotoBoth(m, x);
  PhotoSlot(slotBit(m, 1), slotBit(s, 1), slotBit(x, 1), slotBit(withoutMask(m, s), 1), slotBit(bothMasks(m, x), 1));
  PhotoSlot(slotBit(m, 2), slotBit(s, 2), slotBit(x, 2), slotBit(withoutMask(m, s), 2), slotBit(bothMasks(m, x), 2));
  PhotoSlot(slotBit(m, 4), slotBit(s, 4), slotBit(x, 4), slotBit(withoutMask(m, s), 4), slotBit(bothMasks(m, x), 4));
  PhotoSlot(slotBit(m, 8), slotBit(s, 8), slotBit(x, 8), slotBit(withoutMask(m, s), 8), slotBit(bothMasks(m, x), 8));
  PhotoSlot(slotBit(m, 16), slotBit(s, 16), slotBit(x, 16), slotBit(withoutMask(m, s), 16), slotBit(bothMasks(m, x), 16));
  PhotoSlot(slotBit(m, 32), slotBit(s, 32), slotBit(x, 32), slotBit(withoutMask(m, s), 32), slotBit(bothMasks(m, x), 32));
  PhotoProduct(slotBit(withoutMask(m, s), 1), slotBit(e, 1));
  PhotoProduct(slotBit(withoutMask(m, s), 2), slotBit(e, 2));
  PhotoProduct(slotBit(withoutMask(m, s), 4), slotBit(e, 4));
  PhotoProduct(slotBit(withoutMask(m, s), 8), slotBit(e, 8));
  PhotoProduct(slotBit(withoutMask(m, s), 16), slotBit(e, 16));
  PhotoProduct(slotBit(withoutMask(m, s), 32), slotBit(e, 32));
  PhotoProduct(slotBit(bothMasks(m, x), 1), slotBit(e, 1));
  PhotoProduct(slotBit(bothMasks(m, x), 2), slotBit(e, 2));
  PhotoProduct(slotBit(bothMasks(m, x), 4), slotBit(e, 4));
  PhotoProduct(slotBit(bothMasks(m, x), 8), slotBit(e, 8));
  PhotoProduct(slotBit(bothMasks(m, x), 16), slotBit(e, 16));
  PhotoProduct(slotBit(bothMasks(m, x), 32), slotBit(e, 32));
}

// One open photo that the match does not have: the match has none of open.
lemma PhotoOneOpen(o: int, s: int)
  ensures (slotCount(o) == 1 && withoutMask(o, s) != 0) ==> bothMasks(o, s) == 0
{
  PhotoBits(o);
  PhotoBits(s);
  PhotoProduct(slotBit(o, 1), slotBit(s, 1));
  PhotoProduct(slotBit(o, 2), slotBit(s, 2));
  PhotoProduct(slotBit(o, 4), slotBit(s, 4));
  PhotoProduct(slotBit(o, 8), slotBit(s, 8));
  PhotoProduct(slotBit(o, 16), slotBit(s, 16));
  PhotoProduct(slotBit(o, 32), slotBit(s, 32));
  PhotoWithout(o, s);
  PhotoBoth(o, s);
  PhotoSlot(slotBit(o, 1), slotBit(s, 1), slotBit(s, 1), slotBit(withoutMask(o, s), 1), slotBit(bothMasks(o, s), 1));
  PhotoSlot(slotBit(o, 2), slotBit(s, 2), slotBit(s, 2), slotBit(withoutMask(o, s), 2), slotBit(bothMasks(o, s), 2));
  PhotoSlot(slotBit(o, 4), slotBit(s, 4), slotBit(s, 4), slotBit(withoutMask(o, s), 4), slotBit(bothMasks(o, s), 4));
  PhotoSlot(slotBit(o, 8), slotBit(s, 8), slotBit(s, 8), slotBit(withoutMask(o, s), 8), slotBit(bothMasks(o, s), 8));
  PhotoSlot(slotBit(o, 16), slotBit(s, 16), slotBit(s, 16), slotBit(withoutMask(o, s), 16), slotBit(bothMasks(o, s), 16));
  PhotoSlot(slotBit(o, 32), slotBit(s, 32), slotBit(s, 32), slotBit(withoutMask(o, s), 32), slotBit(bothMasks(o, s), 32));
  if slotCount(o) == 1 && withoutMask(o, s) != 0 {
    assert slotBit(withoutMask(o, s), 1) + slotBit(withoutMask(o, s), 2) + slotBit(withoutMask(o, s), 4) + slotBit(withoutMask(o, s), 8) + slotBit(withoutMask(o, s), 16) + slotBit(withoutMask(o, s), 32) >= 1;
  }
}

// One open photo with the exact name that the match does not have.
lemma PhotoOneExact(o: int, s: int, x: int)
  ensures (slotCount(bothMasks(o, x)) == 1 && bothMasks(withoutMask(o, s), x) != 0) ==> bothMasks(bothMasks(o, x), s) == 0
{
  PhotoBits(o);
  PhotoBits(s);
  PhotoBits(x);
  PhotoProduct(slotBit(o, 1), slotBit(s, 1));
  PhotoProduct(slotBit(o, 2), slotBit(s, 2));
  PhotoProduct(slotBit(o, 4), slotBit(s, 4));
  PhotoProduct(slotBit(o, 8), slotBit(s, 8));
  PhotoProduct(slotBit(o, 16), slotBit(s, 16));
  PhotoProduct(slotBit(o, 32), slotBit(s, 32));
  PhotoProduct(slotBit(o, 1), slotBit(x, 1));
  PhotoProduct(slotBit(o, 2), slotBit(x, 2));
  PhotoProduct(slotBit(o, 4), slotBit(x, 4));
  PhotoProduct(slotBit(o, 8), slotBit(x, 8));
  PhotoProduct(slotBit(o, 16), slotBit(x, 16));
  PhotoProduct(slotBit(o, 32), slotBit(x, 32));
  PhotoWithout(o, s);
  PhotoBoth(o, x);
  PhotoSlot(slotBit(o, 1), slotBit(s, 1), slotBit(x, 1), slotBit(withoutMask(o, s), 1), slotBit(bothMasks(o, x), 1));
  PhotoSlot(slotBit(o, 2), slotBit(s, 2), slotBit(x, 2), slotBit(withoutMask(o, s), 2), slotBit(bothMasks(o, x), 2));
  PhotoSlot(slotBit(o, 4), slotBit(s, 4), slotBit(x, 4), slotBit(withoutMask(o, s), 4), slotBit(bothMasks(o, x), 4));
  PhotoSlot(slotBit(o, 8), slotBit(s, 8), slotBit(x, 8), slotBit(withoutMask(o, s), 8), slotBit(bothMasks(o, x), 8));
  PhotoSlot(slotBit(o, 16), slotBit(s, 16), slotBit(x, 16), slotBit(withoutMask(o, s), 16), slotBit(bothMasks(o, x), 16));
  PhotoSlot(slotBit(o, 32), slotBit(s, 32), slotBit(x, 32), slotBit(withoutMask(o, s), 32), slotBit(bothMasks(o, x), 32));
  if slotCount(bothMasks(o, x)) == 1 && bothMasks(withoutMask(o, s), x) != 0 {
    assert slotBit(withoutMask(o, s), 1) * slotBit(x, 1) + slotBit(withoutMask(o, s), 2) * slotBit(x, 2) + slotBit(withoutMask(o, s), 4) * slotBit(x, 4) + slotBit(withoutMask(o, s), 8) * slotBit(x, 8) + slotBit(withoutMask(o, s), 16) * slotBit(x, 16) + slotBit(withoutMask(o, s), 32) * slotBit(x, 32) >= 1;
  }
}

// Each slot of a difference is at most the slot of the first mask.
lemma PhotoBelowWithout(m: int, x: int)
  ensures slotBit(withoutMask(m, x), 1) <= slotBit(m, 1)
  ensures slotBit(withoutMask(m, x), 2) <= slotBit(m, 2)
  ensures slotBit(withoutMask(m, x), 4) <= slotBit(m, 4)
  ensures slotBit(withoutMask(m, x), 8) <= slotBit(m, 8)
  ensures slotBit(withoutMask(m, x), 16) <= slotBit(m, 16)
  ensures slotBit(withoutMask(m, x), 32) <= slotBit(m, 32)
{
  PhotoBits(m);
  PhotoBits(x);
  PhotoProduct(slotBit(m, 1), slotBit(x, 1));
  PhotoProduct(slotBit(m, 2), slotBit(x, 2));
  PhotoProduct(slotBit(m, 4), slotBit(x, 4));
  PhotoProduct(slotBit(m, 8), slotBit(x, 8));
  PhotoProduct(slotBit(m, 16), slotBit(x, 16));
  PhotoProduct(slotBit(m, 32), slotBit(x, 32));
  PhotoWithout(m, x);
}

// Each slot of an intersection is at most the slot of either mask.
lemma PhotoBelowBoth(a: int, b: int)
  ensures slotBit(bothMasks(a, b), 1) <= slotBit(a, 1)
  ensures slotBit(bothMasks(a, b), 2) <= slotBit(a, 2)
  ensures slotBit(bothMasks(a, b), 4) <= slotBit(a, 4)
  ensures slotBit(bothMasks(a, b), 8) <= slotBit(a, 8)
  ensures slotBit(bothMasks(a, b), 16) <= slotBit(a, 16)
  ensures slotBit(bothMasks(a, b), 32) <= slotBit(a, 32)
  ensures slotBit(bothMasks(a, b), 1) <= slotBit(b, 1)
  ensures slotBit(bothMasks(a, b), 2) <= slotBit(b, 2)
  ensures slotBit(bothMasks(a, b), 4) <= slotBit(b, 4)
  ensures slotBit(bothMasks(a, b), 8) <= slotBit(b, 8)
  ensures slotBit(bothMasks(a, b), 16) <= slotBit(b, 16)
  ensures slotBit(bothMasks(a, b), 32) <= slotBit(b, 32)
{
  PhotoBits(a);
  PhotoBits(b);
  PhotoProduct(slotBit(a, 1), slotBit(b, 1));
  PhotoProduct(slotBit(a, 2), slotBit(b, 2));
  PhotoProduct(slotBit(a, 4), slotBit(b, 4));
  PhotoProduct(slotBit(a, 8), slotBit(b, 8));
  PhotoProduct(slotBit(a, 16), slotBit(b, 16));
  PhotoProduct(slotBit(a, 32), slotBit(b, 32));
  PhotoBoth(a, b);
}

// A mask whose every slot is in m leaves nothing outside m.
lemma PhotoSubset(c: int, m: int)
  requires slotBit(c, 1) <= slotBit(m, 1)
  requires slotBit(c, 2) <= slotBit(m, 2)
  requires slotBit(c, 4) <= slotBit(m, 4)
  requires slotBit(c, 8) <= slotBit(m, 8)
  requires slotBit(c, 16) <= slotBit(m, 16)
  requires slotBit(c, 32) <= slotBit(m, 32)
  ensures withoutMask(c, m) == 0
{
  PhotoBits(c);
  PhotoBits(m);
  PhotoProduct(slotBit(c, 1), slotBit(m, 1));
  PhotoProduct(slotBit(c, 2), slotBit(m, 2));
  PhotoProduct(slotBit(c, 4), slotBit(m, 4));
  PhotoProduct(slotBit(c, 8), slotBit(m, 8));
  PhotoProduct(slotBit(c, 16), slotBit(m, 16));
  PhotoProduct(slotBit(c, 32), slotBit(m, 32));
}

lemma PhotoNonzeroCount(m: int)
  requires cleanMask(m) == m && m != 0
  ensures slotCount(m) >= 1
{
  PhotoBits(m);
}

// The pick follows the definition: what each branch chooses.
lemma PhotoPickChosen(available: bool, otherOwner: bool, codeTyped: bool, byLooks: bool, recipients: int, count: int, hadFeature: bool, wantsSet: bool, candidates: int, exact: int, excluded: int, shared: int)
  ensures var own := ownSlots(count);
    var mOpen := withoutMask(bothMasks(candidates, own), excluded);
    var mFresh := withoutMask(mOpen, shared);
    var mExact := bothMasks(mOpen, exact);
    var r := photoPickFor(available, otherOwner, codeTyped, byLooks, recipients, count, hadFeature, wantsSet, candidates, exact, excluded, shared);
    r.pick.ProposePhotos? ==> ((r.chosen == mFresh && slotCount(mFresh) <= photoSetMax && mFresh != 0) ||
      (!wantsSet && r.chosen == mOpen && slotCount(mOpen) == 1 && mFresh != 0) ||
      (!wantsSet && r.chosen == mExact && slotCount(mExact) == 1 && bothMasks(mFresh, exact) != 0))
  ensures var own := ownSlots(count);
    var mOpen := withoutMask(bothMasks(candidates, own), excluded);
    var mFresh := withoutMask(mOpen, shared);
    var mExact := bothMasks(mOpen, exact);
    var r := photoPickFor(available, otherOwner, codeTyped, byLooks, recipients, count, hadFeature, wantsSet, candidates, exact, excluded, shared);
    r.chosen == 0 || r.chosen == withoutMask(own, excluded) || r.chosen == mOpen || r.chosen == mFresh || r.chosen == mExact
{
}

// Every mask the pick can choose holds only the sender's own photos.
lemma PhotoWithinOwn(count: int, candidates: int, exact: int, excluded: int, shared: int)
  ensures var own := ownSlots(count);
    var mOpen := withoutMask(bothMasks(candidates, own), excluded);
    withoutMask(0, own) == 0 && withoutMask(withoutMask(own, excluded), own) == 0 &&
    withoutMask(mOpen, own) == 0 && withoutMask(withoutMask(mOpen, shared), own) == 0 &&
    withoutMask(bothMasks(mOpen, exact), own) == 0
{
  var own := ownSlots(count);
  var named := bothMasks(candidates, own);
  var mOpen := withoutMask(named, excluded);
  PhotoFromBits(0, 0, 0, 0, 0, 0, 0);
  PhotoBits(own);
  PhotoSubset(0, own);
  PhotoBelowWithout(own, excluded);
  PhotoSubset(withoutMask(own, excluded), own);
  PhotoBelowBoth(candidates, own);
  PhotoBelowWithout(named, excluded);
  PhotoSubset(mOpen, own);
  PhotoBelowWithout(mOpen, shared);
  PhotoSubset(withoutMask(mOpen, shared), own);
  PhotoBelowBoth(mOpen, exact);
  PhotoSubset(bothMasks(mOpen, exact), own);
}

lemma lawChosenAreOwnPhotos_ensures(available: bool, otherOwner: bool, codeTyped: bool, byLooks: bool, recipients: int, count: int, hadFeature: bool, wantsSet: bool, candidates: int, exact: int, excluded: int, shared: int)
  ensures (lawChosenAreOwnPhotos(available, otherOwner, codeTyped, byLooks, recipients, count, hadFeature, wantsSet, candidates, exact, excluded, shared) == true)
{
  var own := ownSlots(count);
  var mOpen := withoutMask(bothMasks(candidates, own), excluded);
  var mFresh := withoutMask(mOpen, shared);
  var mExact := bothMasks(mOpen, exact);
  PhotoPickChosen(available, otherOwner, codeTyped, byLooks, recipients, count, hadFeature, wantsSet, candidates, exact, excluded, shared);
  PhotoWithinOwn(count, candidates, exact, excluded, shared);
}

lemma lawExcludedNeverProposed_ensures(available: bool, otherOwner: bool, codeTyped: bool, byLooks: bool, recipients: int, count: int, hadFeature: bool, wantsSet: bool, candidates: int, exact: int, excluded: int, shared: int)
  ensures (lawExcludedNeverProposed(available, otherOwner, codeTyped, byLooks, recipients, count, hadFeature, wantsSet, candidates, exact, excluded, shared) == true)
{
  var own := ownSlots(count);
  var mOpen := withoutMask(bothMasks(candidates, own), excluded);
  var mFresh := withoutMask(mOpen, shared);
  var mExact := bothMasks(mOpen, exact);
  PhotoPickChosen(available, otherOwner, codeTyped, byLooks, recipients, count, hadFeature, wantsSet, candidates, exact, excluded, shared);
  PhotoWithoutHasNone(bothMasks(candidates, own), excluded);
  PhotoNarrowHasNone(mOpen, excluded, shared, exact);
}

lemma lawProposalHoldsOneToThree_ensures(available: bool, otherOwner: bool, codeTyped: bool, byLooks: bool, recipients: int, count: int, hadFeature: bool, wantsSet: bool, candidates: int, exact: int, excluded: int, shared: int)
  ensures (lawProposalHoldsOneToThree(available, otherOwner, codeTyped, byLooks, recipients, count, hadFeature, wantsSet, candidates, exact, excluded, shared) == true)
{
  var own := ownSlots(count);
  var mOpen := withoutMask(bothMasks(candidates, own), excluded);
  var mFresh := withoutMask(mOpen, shared);
  var mExact := bothMasks(mOpen, exact);
  PhotoPickChosen(available, otherOwner, codeTyped, byLooks, recipients, count, hadFeature, wantsSet, candidates, exact, excluded, shared);
  PhotoWithout(mOpen, shared);
  if mFresh != 0 {
    PhotoNonzeroCount(mFresh);
  }
}

lemma lawSharedNeverProposedAgain_ensures(available: bool, otherOwner: bool, codeTyped: bool, byLooks: bool, recipients: int, count: int, hadFeature: bool, wantsSet: bool, candidates: int, exact: int, excluded: int, shared: int)
  ensures (lawSharedNeverProposedAgain(available, otherOwner, codeTyped, byLooks, recipients, count, hadFeature, wantsSet, candidates, exact, excluded, shared) == true)
{
  var own := ownSlots(count);
  var mOpen := withoutMask(bothMasks(candidates, own), excluded);
  var mFresh := withoutMask(mOpen, shared);
  var mExact := bothMasks(mOpen, exact);
  PhotoPickChosen(available, otherOwner, codeTyped, byLooks, recipients, count, hadFeature, wantsSet, candidates, exact, excluded, shared);
  PhotoWithoutHasNone(mOpen, shared);
  PhotoOneOpen(mOpen, shared);
  PhotoOneExact(mOpen, shared, exact);
}
