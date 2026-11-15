// sameTodos walks the first list with a counter and compares each element
// with the element of the second list at that position. Comparing a list with
// itself, the walk stays true from any position to the end.

lemma SameFrom(rest: seq<Todo>, xs: seq<Todo>, k: int)
  requires 0 <= k <= |xs| && rest == xs[k..]
  ensures Std.Collections.Seq.FoldLeft((acc: Walk, t: Todo) => Walk((acc.ok && sameAt(xs, acc.i, t)), (acc.i + 1)), Walk(true, k), rest).ok
  decreases |rest|
{
  if |rest| > 0 {
    var f := (acc: Walk, t: Todo) => Walk((acc.ok && sameAt(xs, acc.i, t)), (acc.i + 1));
    assert rest[0] == xs[k];
    assert rest[1..] == xs[k + 1..];
    assert f(Walk(true, k), rest[0]) == Walk(true, k + 1);
    SameFrom(rest[1..], xs, k + 1);
  }
}

lemma lawAListIsTheSameAsItself_ensures(xs: seq<Todo>)
  ensures (lawAListIsTheSameAsItself(xs) == true)
{
  assert xs[0..] == xs;
  SameFrom(xs, xs, 0);
}
