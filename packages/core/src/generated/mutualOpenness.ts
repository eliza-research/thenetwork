// GENERATED from spec/mutualOpenness.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Meet only people who are open to me / A dating pair is admissible only when each member is inside the other's openness (spec/mutualOpenness.md) */
export type StatedGender = "GenderWoman" | "GenderMan" | "GenderNonbinary" | "GenderUnstated";
/** Story: Meet only people who are open to me / A dating pair is admissible only when each member is inside the other's openness (spec/mutualOpenness.md) */
export type TransStatus = "StatedTrans" | "StatedNotTrans" | "TransNotStated";
/** Story: Meet only people who are open to me / A dating pair is admissible only when each member is inside the other's openness (spec/mutualOpenness.md) */
export type TransOpenness = "OpenToTrans" | "NotOpenToTrans" | "OnlyTrans" | "TransUnanswered";
/** Story: Meet only people who are open to me / A dating pair is admissible only when each member is inside the other's openness (spec/mutualOpenness.md) */
export interface DatingStatement { gender: StatedGender; trans: TransStatus; seeksWomen: boolean; seeksMen: boolean; seeksNonbinary: boolean; shownToWomenSeekers: boolean; shownToMenSeekers: boolean; transOpenness: TransOpenness }
/** Story: Meet only people who are open to me / A dating pair is admissible only when each member is inside the other's openness (spec/mutualOpenness.md) */
export interface DatingSegmentClass { reachesWomenSeekers: boolean; reachesMenSeekers: boolean; reachesNonbinarySeekers: boolean; transStated: boolean }
/** Story: Choose who I make friends with / A friend pair is admissible only when each member is inside the other's friendship openness (spec/mutualOpenness.md) */
export type FriendOpenness = "FriendsWithWomen" | "FriendsWithMen" | "FriendsWithAnyone";
/** Story: Choose who I make friends with / A friend pair is admissible only when each member is inside the other's friendship openness (spec/mutualOpenness.md) */
export interface FriendStatement { friendGender: StatedGender; friendOpenness: FriendOpenness }

/** Story: Meet only people who are open to me / A dating pair is admissible only when each member is inside the other's openness (spec/mutualOpenness.md) */
export const sampleDatingStatement: DatingStatement = { gender: "GenderWoman", trans: "StatedNotTrans", seeksWomen: false, seeksMen: true, seeksNonbinary: false, shownToWomenSeekers: false, shownToMenSeekers: false, transOpenness: "TransUnanswered" };
/** Story: Choose who I make friends with / A friend pair is admissible only when each member is inside the other's friendship openness (spec/mutualOpenness.md) */
export const friendOpennessUnanswered: FriendOpenness = "FriendsWithAnyone";

/** Story: Meet only people who are open to me / A dating pair is admissible only when each member is inside the other's openness (spec/mutualOpenness.md) */
//@ pure
export function datingSegmentClassOf(m: DatingStatement): DatingSegmentClass {
  return { reachesWomenSeekers: m.gender === "GenderWoman" || (m.gender === "GenderNonbinary" && m.shownToWomenSeekers), reachesMenSeekers: m.gender === "GenderMan" || (m.gender === "GenderNonbinary" && m.shownToMenSeekers), reachesNonbinarySeekers: m.gender === "GenderNonbinary", transStated: m.trans === "StatedTrans" };
}

/** Story: Meet only people who are open to me / A dating pair is admissible only when each member is inside the other's openness (spec/mutualOpenness.md) */
//@ pure
export function transAnswerAdmits(m: DatingStatement, otherTransStated: boolean): boolean {
  return m.transOpenness === "OpenToTrans" ? true : (m.transOpenness === "OnlyTrans" ? m.trans === "StatedTrans" && otherTransStated : !otherTransStated);
}

/** Story: Meet only people who are open to me / A dating pair is admissible only when each member is inside the other's openness (spec/mutualOpenness.md) */
//@ pure
export function datingClassAdmits(m: DatingStatement, c: DatingSegmentClass): boolean {
  return ((m.seeksWomen && c.reachesWomenSeekers) || (m.seeksMen && c.reachesMenSeekers) || (m.seeksNonbinary && c.reachesNonbinarySeekers)) && transAnswerAdmits(m, c.transStated);
}

/** Story: Meet only people who are open to me / A dating pair is admissible only when each member is inside the other's openness (spec/mutualOpenness.md) */
//@ pure
export function datingOneWayOpen(m: DatingStatement, other: DatingStatement): boolean {
  return datingClassAdmits(m, datingSegmentClassOf(other));
}

/** Story: Meet only people who are open to me / A dating pair is admissible only when each member is inside the other's openness (spec/mutualOpenness.md) */
//@ pure
export function mutuallyOpen(left: DatingStatement, right: DatingStatement): boolean {
  return datingOneWayOpen(left, right) && datingOneWayOpen(right, left);
}

/** Story: Meet only people who are open to me / A dating pair is admissible only when each member is inside the other's openness (spec/mutualOpenness.md) */
//@ pure
export function lawMutualOpennessIsSymmetric(left: DatingStatement, right: DatingStatement): boolean {
  //@ ensures \result === true
  return mutuallyOpen(left, right) === mutuallyOpen(right, left);
}

/** Story: Meet only people who are open to me / A gender outside the other's seeking set is refused (spec/mutualOpenness.md) */
//@ pure
export function lawUnsoughtBinaryGenderIsRefused(left: DatingStatement, right: DatingStatement): boolean {
  //@ ensures \result === true
  return !((right.gender === "GenderWoman" && !left.seeksWomen) || (right.gender === "GenderMan" && !left.seeksMen)) || !mutuallyOpen(left, right);
}

/** Story: Meet only people who are open to me / A gender outside the other's seeking set is refused (spec/mutualOpenness.md) */
//@ pure
export function lawNonbinaryAppearsOnlyWhereChosen(left: DatingStatement, right: DatingStatement): boolean {
  //@ ensures \result === true
  return !(right.gender === "GenderNonbinary" && !left.seeksNonbinary && !(left.seeksWomen && right.shownToWomenSeekers) && !(left.seeksMen && right.shownToMenSeekers)) || !mutuallyOpen(left, right);
}

/** Story: Meet only people who are open to me / A gender outside the other's seeking set is refused (spec/mutualOpenness.md) */
//@ pure
export function lawShownToCountsOnlyForNonbinary(left: DatingStatement, right: DatingStatement): boolean {
  //@ ensures \result === true
  return !(right.gender !== "GenderNonbinary") || mutuallyOpen(left, right) === mutuallyOpen(left, ({ ...right, shownToWomenSeekers: false, shownToMenSeekers: false } as DatingStatement));
}

/** Story: Meet only people who are open to me / A member whose gender is not stated is not admissible in Date (spec/mutualOpenness.md) */
//@ pure
export function lawUnstatedGenderIsNotAdmissible(left: DatingStatement, right: DatingStatement): boolean {
  //@ ensures \result === true
  return !(right.gender === "GenderUnstated") || !mutuallyOpen(left, right);
}

/** Story: Meet only people who are open to me / A member who stated trans meets only members who said they are open (spec/mutualOpenness.md) */
//@ pure
export function lawStatedTransNeedsAnOpenPartner(left: DatingStatement, right: DatingStatement): boolean {
  //@ ensures \result === true
  return !(right.trans === "StatedTrans" && mutuallyOpen(left, right)) || (left.transOpenness === "OpenToTrans" || (left.transOpenness === "OnlyTrans" && left.trans === "StatedTrans"));
}

/** Story: Meet only people who are open to me / A member who stated trans meets only members who said they are open (spec/mutualOpenness.md) */
//@ pure
export function lawUnansweredIsNotOpen(left: DatingStatement, right: DatingStatement): boolean {
  //@ ensures \result === true
  return !(left.transOpenness === "TransUnanswered") || mutuallyOpen(left, right) === mutuallyOpen(({ ...left, transOpenness: "NotOpenToTrans" } as DatingStatement), right);
}

/** Story: Meet only people who are open to me / A member who stated trans meets only members who said they are open (spec/mutualOpenness.md) */
//@ pure
export function lawUnstatedTransIsNotInferred(left: DatingStatement, right: DatingStatement): boolean {
  //@ ensures \result === true
  return mutuallyOpen(left, ({ ...right, trans: "TransNotStated" } as DatingStatement)) === mutuallyOpen(left, ({ ...right, trans: "StatedNotTrans" } as DatingStatement));
}

/** Story: Meet only people who are open to me / Only trans partners is available only to a member who stated trans (spec/mutualOpenness.md) */
//@ pure
export function lawOnlyTransNeedsTwoStatedTransMembers(left: DatingStatement, right: DatingStatement): boolean {
  //@ ensures \result === true
  return !(left.transOpenness === "OnlyTrans" && mutuallyOpen(left, right)) || (left.trans === "StatedTrans" && right.trans === "StatedTrans");
}

/** Story: Meet only people who are open to me / The Date segment never refuses an admissible pair (spec/mutualOpenness.md) */
//@ pure
export function lawOneWayOpennessReadsOnlyTheSegmentClass(left: DatingStatement, right: DatingStatement): boolean {
  //@ ensures \result === true
  return datingOneWayOpen(left, right) === datingOneWayOpen(left, ({ ...right, seeksWomen: !right.seeksWomen, seeksMen: !right.seeksMen, seeksNonbinary: !right.seeksNonbinary, transOpenness: "OpenToTrans" } as DatingStatement));
}

/** Story: Choose who I make friends with / A friend pair is admissible only when each member is inside the other's friendship openness (spec/mutualOpenness.md) */
//@ pure
export function friendAdmits(m: FriendStatement, other: FriendStatement): boolean {
  return m.friendOpenness === "FriendsWithAnyone" || (m.friendOpenness === "FriendsWithWomen" && other.friendGender === "GenderWoman") || (m.friendOpenness === "FriendsWithMen" && other.friendGender === "GenderMan");
}

/** Story: Choose who I make friends with / A friend pair is admissible only when each member is inside the other's friendship openness (spec/mutualOpenness.md) */
//@ pure
export function friendsMutuallyOpen(first: FriendStatement, second: FriendStatement): boolean {
  return friendAdmits(first, second) && friendAdmits(second, first);
}

/** Story: Choose who I make friends with / A friend pair is admissible only when each member is inside the other's friendship openness (spec/mutualOpenness.md) */
//@ pure
export function lawFriendOpennessIsSymmetric(first: FriendStatement, second: FriendStatement): boolean {
  //@ ensures \result === true
  return friendsMutuallyOpen(first, second) === friendsMutuallyOpen(second, first);
}

/** Story: Choose who I make friends with / A friend pair is admissible only when each member is inside the other's friendship openness (spec/mutualOpenness.md) */
//@ pure
export function lawFriendsWithOneGenderMeetOnlyThatGender(first: FriendStatement, second: FriendStatement): boolean {
  //@ ensures \result === true
  return !friendsMutuallyOpen(first, second) || ((first.friendOpenness !== "FriendsWithWomen" || second.friendGender === "GenderWoman") && (first.friendOpenness !== "FriendsWithMen" || second.friendGender === "GenderMan"));
}

/** Story: Choose who I make friends with / A friend pair is admissible only when each member is inside the other's friendship openness (spec/mutualOpenness.md) */
//@ pure
export function lawFriendsOpenToAnyoneMeetEachOther(first: FriendStatement, second: FriendStatement): boolean {
  //@ ensures \result === true
  return !(first.friendOpenness === "FriendsWithAnyone" && second.friendOpenness === "FriendsWithAnyone") || friendsMutuallyOpen(first, second);
}
