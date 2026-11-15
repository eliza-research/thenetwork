// Proofs that each transition of projects.md keeps a sheet to one project and
// a key to one project, and that the admin screen never creates a shared
// channel.
//
// The two `always` rules count with Std.Collections.Seq.Filter. The bridges
// below restate the generated definitions with ProofLib.Filter, whose facts
// meet the generated terms, and then as "no two entries have the same sheet"
// (or key). Each transition is then argued on that plain form. Lambdas passed
// to ProofLib are copied verbatim from gen/proof/projects/projects.dfy.

// ---- obligations ----

lemma connect_ensures(r: Registry, key: string, sheet: string, channel: string)
  ensures (inv(r) ==> canConnect(r, key, sheet, channel) ==> alwaysASheetHasOneProject(connect(r, key, sheet, channel)))
  ensures (inv(r) ==> canConnect(r, key, sheet, channel) ==> alwaysAKeyNamesOneProject(connect(r, key, sheet, channel)))
  ensures (inv(r) ==> canConnect(r, key, sheet, channel) ==> stepTheAdminScreenNeverSharesAChannel(r, connect(r, key, sheet, channel)))
{
  if inv(r) && canConnect(r, key, sheet, channel) {
    ConnectKeepsInv(r, key, sheet, channel);
    ConnectStep(r, key, sheet, channel);
  }
}

lemma disconnect_ensures(r: Registry, key: string)
  ensures (inv(r) ==> canDisconnect(r, key) ==> alwaysASheetHasOneProject(disconnect(r, key)))
  ensures (inv(r) ==> canDisconnect(r, key) ==> alwaysAKeyNamesOneProject(disconnect(r, key)))
  ensures (inv(r) ==> canDisconnect(r, key) ==> stepTheAdminScreenNeverSharesAChannel(r, disconnect(r, key)))
{
  if inv(r) {
    DisconnectKeepsInv(r, key);
    DisconnectStep(r, key);
  }
}

lemma setChannel_ensures(r: Registry, key: string, channel: string)
  ensures (inv(r) ==> canSetChannel(r, key, channel) ==> alwaysASheetHasOneProject(setChannel(r, key, channel)))
  ensures (inv(r) ==> canSetChannel(r, key, channel) ==> alwaysAKeyNamesOneProject(setChannel(r, key, channel)))
  ensures (inv(r) ==> canSetChannel(r, key, channel) ==> stepTheAdminScreenNeverSharesAChannel(r, setChannel(r, key, channel)))
{
  if inv(r) && canSetChannel(r, key, channel) {
    RechannelKeepsInv(r, setChannel(r, key, channel));
    SetChannelStep(r, key, channel);
  }
}

lemma handSetChannel_ensures(r: Registry, key: string, channel: string)
  ensures (inv(r) ==> canHandSetChannel(r, key, channel) ==> alwaysASheetHasOneProject(handSetChannel(r, key, channel)))
  ensures (inv(r) ==> canHandSetChannel(r, key, channel) ==> alwaysAKeyNamesOneProject(handSetChannel(r, key, channel)))
  ensures (inv(r) ==> canHandSetChannel(r, key, channel) ==> stepTheAdminScreenNeverSharesAChannel(r, handSetChannel(r, key, channel)))
{
  if inv(r) {
    RechannelKeepsInv(r, handSetChannel(r, key, channel));
  }
}

// ---- bridges from the generated definitions to ProofLib.Filter ----

lemma SheetsFilter(r: Registry)
  ensures alwaysASheetHasOneProject(r) == Std.Collections.Seq.All(r.entries, (a: Entry) => (|ProofLib.Filter((b: Entry) => (b.sheet == a.sheet), r.entries)| == 1))
{
}

lemma KeysFilter(r: Registry)
  ensures alwaysAKeyNamesOneProject(r) == Std.Collections.Seq.All(r.entries, (a: Entry) => (|ProofLib.Filter((b: Entry) => (b.key == a.key), r.entries)| == 1))
{
}

lemma DisconnectFilter(r: Registry, key: string)
  ensures disconnect(r, key).entries == ProofLib.Filter((e: Entry) => (e.key != key), r.entries)
{
}

lemma SharedFilter(r: Registry)
  ensures |sharedChannels(r)| == |ProofLib.Filter((a: Entry) => ((a.channel != "") && (exists b :: b in r.entries && ((b.key != a.key) && (b.channel == a.channel)))), r.entries)|
  ensures forall m :: 0 <= m < |sharedChannels(r)| ==> sharedChannels(r)[m] == ProofLib.Filter((a: Entry) => ((a.channel != "") && (exists b :: b in r.entries && ((b.key != a.key) && (b.channel == a.channel)))), r.entries)[m].channel
{
}

// ---- the rules in plain form ----

lemma SheetsBridge(r: Registry)
  ensures alwaysASheetHasOneProject(r) <==> ProofLib.DistinctBy(r.entries, (e: Entry) => e.sheet)
{
  var xs := r.entries;
  SheetsFilter(r);
  forall i | 0 <= i < |xs|
    ensures |ProofLib.Filter((b: Entry) => (b.sheet == xs[i].sheet), xs)| == 1 <==> forall j :: 0 <= j < |xs| && j != i ==> xs[j].sheet != xs[i].sheet
  {
    var a := xs[i];
    ProofLib.FilterCountOneIffUnique((b: Entry) => (b.sheet == a.sheet), xs, (e: Entry) => e.sheet, i);
  }
}

lemma KeysBridge(r: Registry)
  ensures alwaysAKeyNamesOneProject(r) <==> ProofLib.DistinctBy(r.entries, (e: Entry) => e.key)
{
  var xs := r.entries;
  KeysFilter(r);
  forall i | 0 <= i < |xs|
    ensures |ProofLib.Filter((b: Entry) => (b.key == xs[i].key), xs)| == 1 <==> forall j :: 0 <= j < |xs| && j != i ==> xs[j].key != xs[i].key
  {
    var a := xs[i];
    ProofLib.FilterCountOneIffUnique((b: Entry) => (b.key == a.key), xs, (e: Entry) => e.key, i);
  }
}

lemma InvBridge(r: Registry)
  ensures inv(r) <==> ProofLib.DistinctBy(r.entries, (e: Entry) => e.sheet) && ProofLib.DistinctBy(r.entries, (e: Entry) => e.key)
{
  SheetsBridge(r);
  KeysBridge(r);
}

lemma SharedMem(r: Registry, c: string)
  ensures c in sharedChannels(r) <==>
    (c != "" && exists a, b :: a in r.entries && b in r.entries && a.channel == c && b.channel == c && b.key != a.key)
{
  var p := (a: Entry) => ((a.channel != "") && (exists b :: b in r.entries && ((b.key != a.key) && (b.channel == a.channel))));
  SharedFilter(r);
  var s := ProofLib.Filter(p, r.entries);
  if c in sharedChannels(r) {
    var m :| 0 <= m < |sharedChannels(r)| && sharedChannels(r)[m] == c;
    ProofLib.FilterMember(p, r.entries, s[m]);
  }
  if c != "" && exists a, b :: a in r.entries && b in r.entries && a.channel == c && b.channel == c && b.key != a.key {
    var a, b :| a in r.entries && b in r.entries && a.channel == c && b.channel == c && b.key != a.key;
    ProofLib.FilterMember(p, r.entries, a);
    var m :| 0 <= m < |s| && s[m] == a;
    assert sharedChannels(r)[m] == c;
  }
}

lemma DisconnectKeeps(r: Registry, key: string, x: Entry)
  ensures x in disconnect(r, key).entries <==> x in r.entries && x.key != key
{
  DisconnectFilter(r, key);
  ProofLib.FilterMember((e: Entry) => (e.key != key), r.entries, x);
}

// ---- the step rule, transition by transition ----

lemma ConnectStep(r: Registry, key: string, sheet: string, channel: string)
  requires canConnect(r, key, sheet, channel)
  ensures stepTheAdminScreenNeverSharesAChannel(r, connect(r, key, sheet, channel))
{
  var after := connect(r, key, sheet, channel);
  forall c | c in sharedChannels(after) ensures c in sharedChannels(r) {
    SharedMem(after, c);
    SharedMem(r, c);
    var a, b :| a in after.entries && b in after.entries && a.channel == c && b.channel == c && b.key != a.key;
    assert a in r.entries && b in r.entries;
  }
}

lemma DisconnectStep(r: Registry, key: string)
  ensures stepTheAdminScreenNeverSharesAChannel(r, disconnect(r, key))
{
  var after := disconnect(r, key);
  forall c | c in sharedChannels(after) ensures c in sharedChannels(r) {
    SharedMem(after, c);
    SharedMem(r, c);
    var a, b :| a in after.entries && b in after.entries && a.channel == c && b.channel == c && b.key != a.key;
    DisconnectKeeps(r, key, a);
    DisconnectKeeps(r, key, b);
  }
}

lemma SetChannelStep(r: Registry, key: string, channel: string)
  requires canSetChannel(r, key, channel)
  ensures stepTheAdminScreenNeverSharesAChannel(r, setChannel(r, key, channel))
{
  var after := setChannel(r, key, channel);
  forall c | c in sharedChannels(after) ensures c in sharedChannels(r) {
    SharedMem(after, c);
    SharedMem(r, c);
    var a, b :| a in after.entries && b in after.entries && a.channel == c && b.channel == c && b.key != a.key;
    var ia :| 0 <= ia < |after.entries| && after.entries[ia] == a;
    var ib :| 0 <= ib < |after.entries| && after.entries[ib] == b;
    var a0, b0 := r.entries[ia], r.entries[ib];
    if a0.key == key {
      assert b0.key != key && b0 == b && b0 in r.entries;
    } else if b0.key == key {
      assert a0 == a && a0 in r.entries;
    } else {
      assert a0 == a && b0 == b;
    }
  }
}

// ---- the always rules, transition by transition ----

lemma ConnectKeepsInv(r: Registry, key: string, sheet: string, channel: string)
  requires inv(r) && canConnect(r, key, sheet, channel)
  ensures inv(connect(r, key, sheet, channel))
{
  var after := connect(r, key, sheet, channel);
  InvBridge(r);
  InvBridge(after);
  assert forall i :: 0 <= i < |r.entries| ==> r.entries[i] in r.entries;
}

lemma DisconnectKeepsInv(r: Registry, key: string)
  requires inv(r)
  ensures inv(disconnect(r, key))
{
  InvBridge(r);
  InvBridge(disconnect(r, key));
  DisconnectFilter(r, key);
  ProofLib.FilterKeepsDistinctBy((e: Entry) => (e.key != key), r.entries, (e: Entry) => e.sheet);
  ProofLib.FilterKeepsDistinctBy((e: Entry) => (e.key != key), r.entries, (e: Entry) => e.key);
}

lemma RechannelKeepsInv(r: Registry, after: Registry)
  requires inv(r)
  requires |after.entries| == |r.entries|
  requires forall i :: 0 <= i < |r.entries| ==> after.entries[i].key == r.entries[i].key && after.entries[i].sheet == r.entries[i].sheet
  ensures inv(after)
{
  InvBridge(r);
  InvBridge(after);
}
