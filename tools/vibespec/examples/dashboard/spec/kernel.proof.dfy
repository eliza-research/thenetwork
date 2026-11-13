// Proofs of the kernel's laws about nextNumber. nextNumber is one more than a
// running maximum over `seen` that starts at `stored`; ProofLib.FoldLeftMax
// states that such a maximum is at least its start and every element. The
// lambda is the one the generated nextNumber folds with, copied verbatim.

lemma lawNextIsAboveTheCounter_ensures(seen: seq<int>, stored: int)
  ensures (lawNextIsAboveTheCounter(seen, stored) == true)
{
  ProofLib.FoldLeftMax((top: int, x: int) => (if (x > top) then x else top), stored, seen);
}

lemma lawNextIsAboveEverythingSeen_ensures(seen: seq<int>, stored: int)
  ensures (lawNextIsAboveEverythingSeen(seen, stored) == true)
{
  ProofLib.FoldLeftMax((top: int, x: int) => (if (x > top) then x else top), stored, seen);
}
