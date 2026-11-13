// Proofs that every request the server answers keeps its rules. All five
// transitions append one entry to the log; four of them also apply an edit
// through `commit`, so the work is done once, in `CommitKeeps`.

// The rules, with ProofLib.Filter in place of the opaque library filter.
lemma VersionBridge(s: Server)
  ensures alwaysTheVersionCountsTheChanges(s) == (s.version == |ProofLib.Filter((h: Answered) => h.ok, s.log)|)
{ }

lemma OnceBridge(s: Server)
  ensures alwaysNoRequestIsAnsweredTwice(s) == Std.Collections.Seq.All(s.log, (a: Answered) => (|ProofLib.Filter((b: Answered) => ((b.client == a.client) && (b.seq_ == a.seq_)), s.log)| == 1))
{ }

lemma IdsBridge(s: Server)
  ensures alwaysIdsAreUnique(s) == Std.Collections.Seq.All(s.todos, (t: todo_Todo) => (|ProofLib.Filter((u: todo_Todo) => (u.id == t.id), s.todos)| == 1))
{ }

// A log entry for a request the log does not hold keeps every request answered once.
lemma OnceAppend(log: seq<Answered>, x: Answered)
  requires Std.Collections.Seq.All(log, (a: Answered) => (|ProofLib.Filter((b: Answered) => ((b.client == a.client) && (b.seq_ == a.seq_)), log)| == 1))
  requires forall h :: h in log ==> !((h.client == x.client) && (h.seq_ == x.seq_))
  ensures Std.Collections.Seq.All(log + [x], (a: Answered) => (|ProofLib.Filter((b: Answered) => ((b.client == a.client) && (b.seq_ == a.seq_)), log + [x])| == 1))
{
  var log2 := log + [x];
  forall i | 0 <= i < |log2|
    ensures |ProofLib.Filter((b: Answered) => ((b.client == log2[i].client) && (b.seq_ == log2[i].seq_)), log2)| == 1
  {
    var a := log2[i];
    var p := (b: Answered) => ((b.client == a.client) && (b.seq_ == a.seq_));
    ProofLib.FilterAppend(p, log, x);
    if i < |log| {
      assert a == log[i];
      assert a in log;
      assert |ProofLib.Filter(p, log)| == 1;
      assert !p(x);
    } else {
      assert a == x;
      ProofLib.FilterNone(p, log);
      assert forall j :: 0 <= j < |log| ==> !p(log[j]) by {
        forall j | 0 <= j < |log| ensures !p(log[j]) { assert log[j] in log; }
      }
    }
  }
}

// A to-do with an id the list does not hold keeps ids unique.
lemma IdsAppend(todos: seq<todo_Todo>, x: todo_Todo)
  requires Std.Collections.Seq.All(todos, (t: todo_Todo) => (|ProofLib.Filter((u: todo_Todo) => (u.id == t.id), todos)| == 1))
  requires forall t :: t in todos ==> t.id != x.id
  ensures Std.Collections.Seq.All(todos + [x], (t: todo_Todo) => (|ProofLib.Filter((u: todo_Todo) => (u.id == t.id), todos + [x])| == 1))
{
  var all := todos + [x];
  forall i | 0 <= i < |all|
    ensures |ProofLib.Filter((u: todo_Todo) => (u.id == all[i].id), all)| == 1
  {
    var a := all[i];
    var p := (u: todo_Todo) => (u.id == a.id);
    ProofLib.FilterAppend(p, todos, x);
    if i < |todos| {
      assert a == todos[i];
      assert a in todos;
      assert |ProofLib.Filter(p, todos)| == 1;
      assert !p(x);
    } else {
      assert a == x;
      ProofLib.FilterNone(p, todos);
      assert forall j :: 0 <= j < |todos| ==> !p(todos[j]) by {
        forall j | 0 <= j < |todos| ensures !p(todos[j]) { assert todos[j] in todos; }
      }
    }
  }
}

// An edit other than a creation keeps every id where it was.
lemma IdsEdit(todos: seq<todo_Todo>, op: todo_Op)
  requires op.kind != "create"
  requires Std.Collections.Seq.All(todos, (t: todo_Todo) => (|ProofLib.Filter((u: todo_Todo) => (u.id == t.id), todos)| == 1))
  ensures |todo_applyOp(todos, op)| == |todos|
  ensures forall i :: 0 <= i < |todos| ==> todo_applyOp(todos, op)[i].id == todos[i].id
  ensures Std.Collections.Seq.All(todo_applyOp(todos, op), (t: todo_Todo) => (|ProofLib.Filter((u: todo_Todo) => (u.id == t.id), todo_applyOp(todos, op))| == 1))
{
  var after := todo_applyOp(todos, op);
  assert |after| == |todos|;
  forall i | 0 <= i < |todos| ensures after[i].id == todos[i].id { }
  forall i | 0 <= i < |after|
    ensures |ProofLib.Filter((u: todo_Todo) => (u.id == after[i].id), after)| == 1
  {
    var p := (u: todo_Todo) => (u.id == todos[i].id);
    var q := (u: todo_Todo) => (u.id == after[i].id);
    ProofLib.FilterLengthPointwise(p, q, todos, after);
    assert |ProofLib.Filter(p, todos)| == 1;
  }
}

lemma CommitKeeps(s: Server, client: string, seq_: int, op: todo_Op)
  requires inv(s) && allows(s, client, seq_, op)
  ensures alwaysTheVersionCountsTheChanges(commit(client, s, seq_, op))
  ensures alwaysNoRequestIsAnsweredTwice(commit(client, s, seq_, op))
  ensures alwaysIdsAreUnique(commit(client, s, seq_, op))
  ensures stepNoToDoIsForgotten(s, commit(client, s, seq_, op))
{
  var after := commit(client, s, seq_, op);
  var x := Answered(client, seq_, op, true);
  VersionBridge(s);
  VersionBridge(after);
  ProofLib.FilterAppend((h: Answered) => h.ok, s.log, x);
  OnceBridge(s);
  OnceBridge(after);
  OnceAppend(s.log, x);
  IdsBridge(s);
  IdsBridge(after);
  if op.kind == "create" {
    var t := todo_Todo(op.id, op.title, false, false);
    IdsAppend(s.todos, t);
    assert after.todos == s.todos + [t];
    forall i | 0 <= i < |s.todos| ensures exists u :: u in after.todos && u.id == s.todos[i].id {
      assert after.todos[i] in after.todos;
    }
  } else {
    IdsEdit(s.todos, op);
    forall i | 0 <= i < |s.todos| ensures exists u :: u in after.todos && u.id == s.todos[i].id {
      assert after.todos[i] in after.todos;
    }
  }
}

lemma create_ensures(s: Server, client: string, seq_: int, id: string, title: string)
  ensures (inv(s) ==> canCreate(s, client, seq_, id, title) ==> alwaysTheVersionCountsTheChanges(create(s, client, seq_, id, title)))
  ensures (inv(s) ==> canCreate(s, client, seq_, id, title) ==> alwaysNoRequestIsAnsweredTwice(create(s, client, seq_, id, title)))
  ensures (inv(s) ==> canCreate(s, client, seq_, id, title) ==> alwaysIdsAreUnique(create(s, client, seq_, id, title)))
  ensures (inv(s) ==> canCreate(s, client, seq_, id, title) ==> stepEachRequestRaisesTheVersionByAtMostOne(s, create(s, client, seq_, id, title)))
  ensures (inv(s) ==> canCreate(s, client, seq_, id, title) ==> stepNoToDoIsForgotten(s, create(s, client, seq_, id, title)))
{
  if inv(s) && canCreate(s, client, seq_, id, title) {
    CommitKeeps(s, client, seq_, todo_Op("create", id, title, false));
  }
}

lemma setDone_ensures(s: Server, client: string, seq_: int, id: string, done: bool)
  ensures (inv(s) ==> canSetDone(s, client, seq_, id, done) ==> alwaysTheVersionCountsTheChanges(setDone(s, client, seq_, id, done)))
  ensures (inv(s) ==> canSetDone(s, client, seq_, id, done) ==> alwaysNoRequestIsAnsweredTwice(setDone(s, client, seq_, id, done)))
  ensures (inv(s) ==> canSetDone(s, client, seq_, id, done) ==> alwaysIdsAreUnique(setDone(s, client, seq_, id, done)))
  ensures (inv(s) ==> canSetDone(s, client, seq_, id, done) ==> stepEachRequestRaisesTheVersionByAtMostOne(s, setDone(s, client, seq_, id, done)))
  ensures (inv(s) ==> canSetDone(s, client, seq_, id, done) ==> stepNoToDoIsForgotten(s, setDone(s, client, seq_, id, done)))
{
  if inv(s) && canSetDone(s, client, seq_, id, done) {
    CommitKeeps(s, client, seq_, todo_Op("done", id, "", done));
  }
}

lemma rename_ensures(s: Server, client: string, seq_: int, id: string, title: string)
  ensures (inv(s) ==> canRename(s, client, seq_, id, title) ==> alwaysTheVersionCountsTheChanges(rename(s, client, seq_, id, title)))
  ensures (inv(s) ==> canRename(s, client, seq_, id, title) ==> alwaysNoRequestIsAnsweredTwice(rename(s, client, seq_, id, title)))
  ensures (inv(s) ==> canRename(s, client, seq_, id, title) ==> alwaysIdsAreUnique(rename(s, client, seq_, id, title)))
  ensures (inv(s) ==> canRename(s, client, seq_, id, title) ==> stepEachRequestRaisesTheVersionByAtMostOne(s, rename(s, client, seq_, id, title)))
  ensures (inv(s) ==> canRename(s, client, seq_, id, title) ==> stepNoToDoIsForgotten(s, rename(s, client, seq_, id, title)))
{
  if inv(s) && canRename(s, client, seq_, id, title) {
    CommitKeeps(s, client, seq_, todo_Op("rename", id, title, false));
  }
}

lemma remove_ensures(s: Server, client: string, seq_: int, id: string)
  ensures (inv(s) ==> canRemove(s, client, seq_, id) ==> alwaysTheVersionCountsTheChanges(remove(s, client, seq_, id)))
  ensures (inv(s) ==> canRemove(s, client, seq_, id) ==> alwaysNoRequestIsAnsweredTwice(remove(s, client, seq_, id)))
  ensures (inv(s) ==> canRemove(s, client, seq_, id) ==> alwaysIdsAreUnique(remove(s, client, seq_, id)))
  ensures (inv(s) ==> canRemove(s, client, seq_, id) ==> stepEachRequestRaisesTheVersionByAtMostOne(s, remove(s, client, seq_, id)))
  ensures (inv(s) ==> canRemove(s, client, seq_, id) ==> stepNoToDoIsForgotten(s, remove(s, client, seq_, id)))
{
  if inv(s) && canRemove(s, client, seq_, id) {
    CommitKeeps(s, client, seq_, todo_Op("remove", id, "", false));
  }
}

lemma refuse_ensures(s: Server, client: string, seq_: int, op: todo_Op)
  ensures (inv(s) ==> canRefuse(s, client, seq_, op) ==> alwaysTheVersionCountsTheChanges(refuse(s, client, seq_, op)))
  ensures (inv(s) ==> canRefuse(s, client, seq_, op) ==> alwaysNoRequestIsAnsweredTwice(refuse(s, client, seq_, op)))
  ensures (inv(s) ==> canRefuse(s, client, seq_, op) ==> alwaysIdsAreUnique(refuse(s, client, seq_, op)))
  ensures (inv(s) ==> canRefuse(s, client, seq_, op) ==> stepEachRequestRaisesTheVersionByAtMostOne(s, refuse(s, client, seq_, op)))
  ensures (inv(s) ==> canRefuse(s, client, seq_, op) ==> stepNoToDoIsForgotten(s, refuse(s, client, seq_, op)))
{
  if inv(s) && canRefuse(s, client, seq_, op) { RefuseKeeps(s, client, seq_, op); }
}

lemma RefuseKeeps(s: Server, client: string, seq_: int, op: todo_Op)
  requires inv(s) && canRefuse(s, client, seq_, op)
  ensures alwaysTheVersionCountsTheChanges(refuse(s, client, seq_, op))
  ensures alwaysNoRequestIsAnsweredTwice(refuse(s, client, seq_, op))
  ensures alwaysIdsAreUnique(refuse(s, client, seq_, op))
  ensures stepNoToDoIsForgotten(s, refuse(s, client, seq_, op))
{
  var after := refuse(s, client, seq_, op);
  var x := Answered(client, seq_, op, false);
  VersionBridge(s);
  VersionBridge(after);
  ProofLib.FilterAppend((h: Answered) => h.ok, s.log, x);
  OnceBridge(s);
  OnceBridge(after);
  OnceAppend(s.log, x);
  assert after.todos == s.todos;
  forall i | 0 <= i < |s.todos| ensures exists u :: u in after.todos && u.id == s.todos[i].id {
    assert after.todos[i] in after.todos;
  }
}

lemma lawACommitKeepsTheRules_ensures(s: Server, client: string, seq_: int, op: todo_Op)
  ensures (lawACommitKeepsTheRules(s, client, seq_, op) == true)
{
  if rulesHold(s) && allows(s, client, seq_, op) { CommitKeeps(s, client, seq_, op); }
}

lemma lawARefusalKeepsTheRules_ensures(s: Server, client: string, seq_: int, op: todo_Op)
  ensures (lawARefusalKeepsTheRules(s, client, seq_, op) == true)
{
  if rulesHold(s) && canRefuse(s, client, seq_, op) { RefuseKeeps(s, client, seq_, op); }
}
