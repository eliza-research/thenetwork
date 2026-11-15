// General lemmas for proof files (spec/<name>.proof.dfy, src/<path>.proof.dfy).
// The tools add this module to every proof unit that has a proof file and
// verify it there; call its lemmas as ProofLib.<Name>(...).
//
// Two facts about Dafny 4.11 shape it:
// - Std.Collections.Seq.Filter is opaque and reads the heap. Inside a `->`
//   lambda (such as the body of an All in a generated rule) it is evaluated in
//   a different heap than in a lemma, so a fact proved about it in a lemma never
//   meets the term in the rule. ProofLib.Filter has no reads clause: state facts
//   about it, and bridge to the generated term with an `assert` that unfolds
//   the generated function (see AGENTS.md, "Proof files").
// - Dafny has no function extensionality. A lambda copied verbatim from
//   gen/proof/<unit>/<unit>.dfy is the same term as the generated one; a lambda
//   that says the same thing in other words, or captures other variables, is not.
//
// Dafny makes the module's import visible as ProofLib.Seq; proof files may not
// use it (tools/prove.ts refuses any ProofLib.<name> this file does not declare),
// since the standard library holds axioms.
module ProofLib {
  import Std.Collections.Seq

  /** Std.Collections.Seq.Filter without a reads clause. */
  ghost function Filter<T>(p: T -> bool, xs: seq<T>): seq<T> { Seq.Filter(p, xs) }

  /** No two positions hold the same value. */
  ghost predicate Distinct<T>(xs: seq<T>) { forall i, j :: 0 <= i < j < |xs| ==> xs[i] != xs[j] }

  /** No two positions hold the same key. */
  ghost predicate DistinctBy<T, K>(xs: seq<T>, key: T -> K) {
    forall i, j :: 0 <= i < |xs| && 0 <= j < |xs| && i != j ==> key(xs[i]) != key(xs[j])
  }

  // --- Filter ---------------------------------------------------------------

  lemma FilterNil<T>(p: T -> bool, xs: seq<T>)
    requires |xs| == 0
    ensures Filter(p, xs) == []
  {
    reveal Seq.Filter();
  }

  lemma FilterCons<T>(p: T -> bool, xs: seq<T>)
    requires |xs| > 0
    ensures Filter(p, xs) == (if p(xs[0]) then [xs[0]] else []) + Filter(p, xs[1..])
  {
    reveal Seq.Filter();
  }

  /** Filtering a list with one more element at the end. */
  lemma FilterAppend<T>(p: T -> bool, xs: seq<T>, x: T)
    ensures Filter(p, xs + [x]) == Filter(p, xs) + (if p(x) then [x] else [])
    decreases |xs|
  {
    if |xs| == 0 {
      assert xs + [x] == [x];
      FilterCons(p, [x]);
      FilterNil(p, [x][1..]);
      FilterNil(p, xs);
    } else {
      FilterCons(p, xs + [x]);
      FilterCons(p, xs);
      assert (xs + [x])[1..] == xs[1..] + [x];
      FilterAppend(p, xs[1..], x);
    }
  }

  /** What a filter keeps is exactly what is in the list and passes. */
  lemma FilterMember<T>(p: T -> bool, xs: seq<T>, x: T)
    ensures x in Filter(p, xs) <==> x in xs && p(x)
    decreases |xs|
  {
    if |xs| == 0 {
      FilterNil(p, xs);
    } else {
      FilterCons(p, xs);
      FilterMember(p, xs[1..], x);
      assert xs == [xs[0]] + xs[1..];
    }
  }

  /** Every element of a filter came from the list. */
  lemma FilterSubset<T>(p: T -> bool, xs: seq<T>)
    ensures forall i :: 0 <= i < |Filter(p, xs)| ==> Filter(p, xs)[i] in xs
    decreases |xs|
  {
    if |xs| == 0 {
      FilterNil(p, xs);
    } else {
      FilterCons(p, xs);
      FilterSubset(p, xs[1..]);
    }
  }

  /** A filter is empty exactly when nothing passes. */
  lemma FilterNone<T>(p: T -> bool, xs: seq<T>)
    ensures |Filter(p, xs)| == 0 <==> forall i :: 0 <= i < |xs| ==> !p(xs[i])
    decreases |xs|
  {
    if |xs| == 0 {
      FilterNil(p, xs);
    } else {
      FilterCons(p, xs);
      FilterNone(p, xs[1..]);
      assert forall i :: 1 <= i < |xs| ==> xs[i] == xs[1..][i - 1];
    }
  }

  /** Only position i passes: the filter has one element. */
  lemma FilterOne<T>(p: T -> bool, xs: seq<T>, i: int)
    requires 0 <= i < |xs| && p(xs[i])
    requires forall j :: 0 <= j < |xs| && j != i ==> !p(xs[j])
    ensures |Filter(p, xs)| == 1
    decreases |xs|
  {
    FilterCons(p, xs);
    if i == 0 {
      assert forall j :: 0 <= j < |xs[1..]| ==> xs[1..][j] == xs[j + 1];
      FilterNone(p, xs[1..]);
    } else {
      assert forall j :: 0 <= j < |xs[1..]| ==> xs[1..][j] == xs[j + 1];
      FilterOne(p, xs[1..], i - 1);
    }
  }

  /** Two positions pass: the filter has at least two elements. */
  lemma FilterTwo<T>(p: T -> bool, xs: seq<T>, i: int, j: int)
    requires 0 <= i < |xs| && 0 <= j < |xs| && i != j && p(xs[i]) && p(xs[j])
    ensures |Filter(p, xs)| >= 2
    decreases |xs|
  {
    FilterCons(p, xs);
    if i == 0 || j == 0 {
      var k := if i == 0 then j else i;
      assert xs[k] == xs[1..][k - 1];
      FilterMember(p, xs[1..], xs[k]);
    } else {
      FilterTwo(p, xs[1..], i - 1, j - 1);
    }
  }

  /** When p means "has the key of xs[i]", one match means no other element has that key. */
  lemma FilterCountOneIffUnique<T, K>(p: T -> bool, xs: seq<T>, key: T -> K, i: int)
    requires 0 <= i < |xs|
    requires forall j :: 0 <= j < |xs| ==> p(xs[j]) == (key(xs[j]) == key(xs[i]))
    ensures |Filter(p, xs)| == 1 <==> forall j :: 0 <= j < |xs| && j != i ==> key(xs[j]) != key(xs[i])
  {
    if forall j :: 0 <= j < |xs| && j != i ==> key(xs[j]) != key(xs[i]) {
      FilterOne(p, xs, i);
    } else {
      var j :| 0 <= j < |xs| && j != i && key(xs[j]) == key(xs[i]);
      FilterTwo(p, xs, i, j);
    }
  }

  /** In a list without repeats, the filter for one of its values has one element. */
  lemma FilterDistinctCountOne<T>(p: T -> bool, xs: seq<T>, o: T)
    requires forall x :: p(x) == (x == o)
    requires Distinct(xs) && o in xs
    ensures |Filter(p, xs)| == 1
    decreases |xs|
  {
    FilterCons(p, xs);
    if xs[0] == o {
      assert forall i :: 0 <= i < |xs[1..]| ==> xs[1..][i] != o;
      FilterNone(p, xs[1..]);
    } else {
      assert Distinct(xs[1..]);
      FilterDistinctCountOne(p, xs[1..], o);
    }
  }

  /** Filtering keeps keys distinct. */
  lemma FilterKeepsDistinctBy<T, K>(p: T -> bool, xs: seq<T>, key: T -> K)
    requires DistinctBy(xs, key)
    ensures DistinctBy(Filter(p, xs), key)
    decreases |xs|
  {
    if |xs| == 0 {
      FilterNil(p, xs);
    } else {
      FilterCons(p, xs);
      var rest := Filter(p, xs[1..]);
      assert DistinctBy(xs[1..], key) by {
        forall i, j | 0 <= i < |xs[1..]| && 0 <= j < |xs[1..]| && i != j ensures key(xs[1..][i]) != key(xs[1..][j]) {
          assert xs[1..][i] == xs[i + 1] && xs[1..][j] == xs[j + 1];
        }
      }
      FilterKeepsDistinctBy(p, xs[1..], key);
      forall m | 0 <= m < |rest| ensures key(rest[m]) != key(xs[0]) {
        FilterMember(p, xs[1..], rest[m]);
        var n :| 0 <= n < |xs[1..]| && xs[1..][n] == rest[m];
        assert xs[n + 1] == rest[m];
      }
    }
  }

  /** Two lists of the same length whose elements pass alike, position by position, keep as many. */
  lemma FilterLengthPointwise<T, U>(p: T -> bool, q: U -> bool, xs: seq<T>, ys: seq<U>)
    requires |xs| == |ys|
    requires forall i :: 0 <= i < |xs| ==> p(xs[i]) == q(ys[i])
    ensures |Filter(p, xs)| == |Filter(q, ys)|
    decreases |xs|
  {
    if |xs| == 0 {
      FilterNil(p, xs);
      FilterNil(q, ys);
    } else {
      FilterCons(p, xs);
      FilterCons(q, ys);
      assert forall i :: 0 <= i < |xs[1..]| ==> xs[1..][i] == xs[i + 1] && ys[1..][i] == ys[i + 1];
      FilterLengthPointwise(p, q, xs[1..], ys[1..]);
    }
  }

  /** As FilterLengthPointwise, and what is kept stays related by r, position by position. */
  lemma FilterPointwise<T, U>(p: T -> bool, q: U -> bool, r: (T, U) -> bool, xs: seq<T>, ys: seq<U>)
    requires |xs| == |ys|
    requires forall i :: 0 <= i < |xs| ==> p(xs[i]) == q(ys[i]) && r(xs[i], ys[i])
    ensures |Filter(p, xs)| == |Filter(q, ys)|
    ensures forall i :: 0 <= i < |Filter(p, xs)| ==> r(Filter(p, xs)[i], Filter(q, ys)[i])
    decreases |xs|
  {
    if |xs| == 0 {
      FilterNil(p, xs);
      FilterNil(q, ys);
    } else {
      FilterCons(p, xs);
      FilterCons(q, ys);
      assert forall i :: 0 <= i < |xs[1..]| ==> xs[1..][i] == xs[i + 1] && ys[1..][i] == ys[i + 1];
      FilterPointwise(p, q, r, xs[1..], ys[1..]);
    }
  }

  /** Two predicates that agree on every element filter alike. */
  lemma FilterSamePredicate<T>(p: T -> bool, q: T -> bool, xs: seq<T>)
    requires forall i :: 0 <= i < |xs| ==> p(xs[i]) == q(xs[i])
    ensures Filter(p, xs) == Filter(q, xs)
    decreases |xs|
  {
    if |xs| == 0 {
      FilterNil(p, xs);
      FilterNil(q, xs);
    } else {
      FilterCons(p, xs);
      FilterCons(q, xs);
      assert forall i :: 0 <= i < |xs[1..]| ==> xs[1..][i] == xs[i + 1];
      FilterSamePredicate(p, q, xs[1..]);
    }
  }

  /** Filtering first can only lower a count. */
  lemma FilterOfFilterShorter<T>(p: T -> bool, q: T -> bool, xs: seq<T>)
    ensures |Filter(q, Filter(p, xs))| <= |Filter(q, xs)|
    decreases |xs|
  {
    if |xs| == 0 {
      FilterNil(p, xs);
      FilterNil(q, xs);
      FilterNil(q, Filter(p, xs));
    } else {
      FilterCons(p, xs);
      FilterCons(q, xs);
      FilterOfFilterShorter(p, q, xs[1..]);
      var r := Filter(p, xs[1..]);
      if p(xs[0]) {
        FilterCons(q, [xs[0]] + r);
        assert ([xs[0]] + r)[1..] == r;
      } else {
        assert Filter(p, xs) == r;
      }
    }
  }

  // --- FoldLeft -------------------------------------------------------------

  /** A fold whose step never lowers the accumulator ends at or above where it started. */
  lemma FoldLeftInflationary<T>(f: (int, T) -> int, init: int, xs: seq<T>)
    requires forall a, x :: f(a, x) >= a
    ensures Seq.FoldLeft(f, init, xs) >= init
    decreases |xs|
  {
    if |xs| > 0 {
      FoldLeftInflationary(f, f(init, xs[0]), xs[1..]);
    }
  }

  /** A fold whose step never lowers the accumulator and never ends below key(x) ends at or above every key. */
  lemma FoldLeftAboveEach<T>(f: (int, T) -> int, key: T -> int, init: int, xs: seq<T>)
    requires forall a, x :: f(a, x) >= a && f(a, x) >= key(x)
    ensures forall i :: 0 <= i < |xs| ==> Seq.FoldLeft(f, init, xs) >= key(xs[i])
    decreases |xs|
  {
    if |xs| > 0 {
      FoldLeftAboveEach(f, key, f(init, xs[0]), xs[1..]);
      FoldLeftInflationary(f, f(init, xs[0]), xs[1..]);
      assert forall i :: 1 <= i < |xs| ==> xs[i] == xs[1..][i - 1];
    }
  }

  /** A running maximum is at least its start and every element. */
  lemma FoldLeftMax(f: (int, int) -> int, init: int, xs: seq<int>)
    requires forall a, x :: f(a, x) == (if x > a then x else a)
    ensures Seq.FoldLeft(f, init, xs) >= init
    ensures forall i :: 0 <= i < |xs| ==> Seq.FoldLeft(f, init, xs) >= xs[i]
    decreases |xs|
  {
    if |xs| > 0 {
      FoldLeftMax(f, f(init, xs[0]), xs[1..]);
      assert forall i :: 1 <= i < |xs| ==> xs[i] == xs[1..][i - 1];
    }
  }

  /** Two folds whose steps agree position by position give the same result. */
  lemma FoldLeftPointwise<A, T, U>(f: (A, T) -> A, g: (A, U) -> A, init: A, xs: seq<T>, ys: seq<U>)
    requires |xs| == |ys|
    requires forall a, i :: 0 <= i < |xs| ==> f(a, xs[i]) == g(a, ys[i])
    ensures Seq.FoldLeft(f, init, xs) == Seq.FoldLeft(g, init, ys)
    decreases |xs|
  {
    if |xs| > 0 {
      assert forall i :: 0 <= i < |xs[1..]| ==> xs[1..][i] == xs[i + 1] && ys[1..][i] == ys[i + 1];
      FoldLeftPointwise(f, g, f(init, xs[0]), xs[1..], ys[1..]);
    }
  }

  /** A fold that appends h(x) for each x is empty exactly when the start and every piece are. */
  lemma FoldLeftConcatEmpty<A, T>(f: (seq<A>, T) -> seq<A>, h: T -> seq<A>, init: seq<A>, xs: seq<T>)
    requires forall a, x :: f(a, x) == a + h(x)
    ensures |Seq.FoldLeft(f, init, xs)| == 0 <==> (|init| == 0 && forall i :: 0 <= i < |xs| ==> |h(xs[i])| == 0)
    decreases |xs|
  {
    if |xs| > 0 {
      assert forall i :: 1 <= i < |xs| ==> xs[i] == xs[1..][i - 1];
      FoldLeftConcatEmpty(f, h, f(init, xs[0]), xs[1..]);
    }
  }

  /** A fold that adds each element only if it is not there yet builds a list without repeats. */
  lemma FoldLeftDedupDistinct<T>(f: (seq<T>, T) -> seq<T>, acc: seq<T>, xs: seq<T>)
    requires forall a, x :: f(a, x) == (if x in a then a else a + [x])
    requires Distinct(acc)
    ensures Distinct(Seq.FoldLeft(f, acc, xs))
    decreases |xs|
  {
    if |xs| > 0 {
      FoldLeftDedupDistinct(f, f(acc, xs[0]), xs[1..]);
    }
  }
}
