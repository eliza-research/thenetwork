# Mutual openness

This library decides whether two members are open to each other in the Date lane (slop.date) and in the Friend lane (friends.help). The members state every fact here themselves, in the agent conversation. The engine never infers gender, trans status or orientation from photos, names, text style, behaviour or another app. The shell reads the stated facet tags (`romance:is:`, `romance:seeks:`, `romance:trans:`, `romance:open_trans:`, `romance:shown_to:` in slop; `friends:gender:` and `friends:open_gender:` in friends), maps them onto these records, and calls the generated decisions in the pair rules, the Date and Friend segment keys and the pair recheck before reveal. The [engine flow model](models/engine_rules.md) checks the pair decision as one symmetric gate. An orientation label (straight, gay, bi, pan, queer) is never an input: only the stated seeking set filters. Trans status and the openness answers are agent_private facts. They are used only in this decision, never in member-facing text about another person, never in an explanation, and never in Hire, Mentor, Invest or Cofounder.

Defaults, for the product owner to confirm:

- **Trans openness not answered** reads as not open. A trans member who chose to say so is then proposed only to members who said yes. The research for this decision (docs/research/2026-11-17-matching-optimization/R6-signifiers-audit.md, Part B.2) found that most daters asked choose cisgender-only options, so reading silence as yes would move the rejection into the meeting.
- **Trans status not stated** reads as not trans. The engine never infers it.
- **Only trans partners** is honoured only for a member who stated trans. For any other member the answer admits nobody, so onboarding does not store it: the answer counts as not given, and the agent asks the plain trans question again until its ask limit. After that, the question is unanswered and reads as not open.
- **A trans qualifier on some of the named genders** ("women and trans men") cannot be kept per gender: seeking the qualified gender plainly would admit people the member did not name. Onboarding reads no seeking set from such a list, records the openness to trans partners, and the agent asks plainly which genders the member is open to. A member who is not trans and seeks only trans partners ("trans women only") cannot be expressed in this decision; that answer counts as not given, as above, and onboarding also stores no seeking set while that answer stands, so the member is never proposed someone outside what they said. This changed in review: before, the seeking set was kept and such a member was proposed members who are not trans.
- **"No preference"** (or "doesn't matter") to the trans question reads as open: it says trans status does not matter to the member.
- **A nonbinary member** appears to members who seek nonbinary people. The member can also choose to appear to members who seek women, men or both. Without that choice, the member appears to nobody else.
- **Gender not stated** in Date admits nobody. The agent asks.
- **Friendship openness not answered** reads as anyone. Friendship has no orientation to infer, and most friend finding has no gender limit. A member who wants women friends or men friends says so, and then meets only members who stated that gender.

This library is new with the stated signifiers work (2026-11-22). Before it, the Date pair rule admitted a pair when each member's gender was in the other's seeking set, onboarding dropped the words "trans" and "cis", and the Friend lane had no gender rule, so a stated exclusion or a stated wish was lost. The product owner asked for gay, bi and straight members, trans and not trans members with their own openness, and friendship with women, men or both; the rules below decide that from stated facts only.

The simulator measures these rules in their own arm (docs/results/2026-11-22-stated-openness.md). The pinned slop and friends worlds keep the truth that their launch gates were set on; the "stated openness world" arm adds the stated trans status, trans answers, shown-to choices and friendship openness, and its openness, minor and adversary gates block.

## Story: Meet only people who are open to me

> As a dating member, I want to meet only people whose stated openness includes who I said I am, and whom I said I am open to.

### A dating pair is admissible only when each member is inside the other's openness

Each member states a gender (woman, man, nonbinary, or not stated), a trans status (stated trans, stated not trans, or not stated), the genders they seek, whether they are open to trans partners (open, not open, only trans partners, or not answered), and, for a nonbinary member only, whether to also appear to people who seek women or men. A member appears to the seekers of their own gender. A nonbinary member also appears to the seekers of each gender they chose. A member admits another when the other appears to one of the genders the member seeks and the member's trans answer admits the other's trans status. A pair is admissible only when each member admits the other.

```quint
type StatedGender = GenderWoman | GenderMan | GenderNonbinary | GenderUnstated
type TransStatus = StatedTrans | StatedNotTrans | TransNotStated
type TransOpenness = OpenToTrans | NotOpenToTrans | OnlyTrans | TransUnanswered

type DatingStatement = {
  gender: StatedGender, trans: TransStatus,
  seeksWomen: bool, seeksMen: bool, seeksNonbinary: bool,
  shownToWomenSeekers: bool, shownToMenSeekers: bool,
  transOpenness: TransOpenness,
}

type DatingSegmentClass = { reachesWomenSeekers: bool, reachesMenSeekers: bool, reachesNonbinarySeekers: bool, transStated: bool }

pure def datingSegmentClassOf(m: DatingStatement): DatingSegmentClass = {
  reachesWomenSeekers: m.gender == GenderWoman or (m.gender == GenderNonbinary and m.shownToWomenSeekers),
  reachesMenSeekers: m.gender == GenderMan or (m.gender == GenderNonbinary and m.shownToMenSeekers),
  reachesNonbinarySeekers: m.gender == GenderNonbinary,
  transStated: m.trans == StatedTrans,
}

pure def transAnswerAdmits(m: DatingStatement, otherTransStated: bool): bool =
  if (m.transOpenness == OpenToTrans) true
  else if (m.transOpenness == OnlyTrans) m.trans == StatedTrans and otherTransStated
  else not(otherTransStated)

pure def datingClassAdmits(m: DatingStatement, c: DatingSegmentClass): bool =
  ((m.seeksWomen and c.reachesWomenSeekers) or (m.seeksMen and c.reachesMenSeekers) or (m.seeksNonbinary and c.reachesNonbinarySeekers))
    and transAnswerAdmits(m, c.transStated)

pure def datingOneWayOpen(m: DatingStatement, other: DatingStatement): bool =
  datingClassAdmits(m, datingSegmentClassOf(other))

pure def mutuallyOpen(left: DatingStatement, right: DatingStatement): bool =
  datingOneWayOpen(left, right) and datingOneWayOpen(right, left)

pure val sampleDatingStatement: DatingStatement = {
  gender: GenderWoman, trans: StatedNotTrans, seeksWomen: false, seeksMen: true, seeksNonbinary: false,
  shownToWomenSeekers: false, shownToMenSeekers: false, transOpenness: TransUnanswered,
}
pure val leftValues = Set(
  sampleDatingStatement,
  { ...sampleDatingStatement, gender: GenderMan, seeksWomen: true, seeksMen: false },
  { ...sampleDatingStatement, gender: GenderMan, seeksWomen: true, seeksMen: false, transOpenness: OpenToTrans },
  { ...sampleDatingStatement, trans: StatedTrans },
  { ...sampleDatingStatement, trans: StatedTrans, transOpenness: OnlyTrans },
  { ...sampleDatingStatement, gender: GenderMan, trans: StatedTrans, seeksWomen: true, seeksMen: false, transOpenness: OnlyTrans },
  { ...sampleDatingStatement, gender: GenderMan, seeksWomen: true, seeksMen: false, transOpenness: OnlyTrans },
  { ...sampleDatingStatement, seeksWomen: true, seeksNonbinary: true, transOpenness: OpenToTrans },
  { ...sampleDatingStatement, gender: GenderNonbinary, trans: TransNotStated, seeksWomen: true, seeksNonbinary: true },
  { ...sampleDatingStatement, gender: GenderNonbinary, trans: TransNotStated, seeksWomen: true, seeksMen: true, shownToMenSeekers: true, transOpenness: NotOpenToTrans },
  { ...sampleDatingStatement, gender: GenderUnstated, trans: TransNotStated, seeksWomen: true, seeksNonbinary: true },
  { ...sampleDatingStatement, gender: GenderMan, seeksWomen: false, seeksMen: true, shownToWomenSeekers: true },
)
pure val rightValues = leftValues

pure def lawMutualOpennessIsSymmetric(left: DatingStatement, right: DatingStatement): bool =
  mutuallyOpen(left, right) iff mutuallyOpen(right, left)
```

### A gender outside the other's seeking set is refused

A woman or a man is refused by a member who does not seek that gender. A nonbinary member is refused by a member who seeks none of the genders the nonbinary member appears to. The choice to appear to the seekers of women or men changes nothing for a member who is not nonbinary.

```quint
pure def lawUnsoughtBinaryGenderIsRefused(left: DatingStatement, right: DatingStatement): bool =
  ((right.gender == GenderWoman and not(left.seeksWomen)) or (right.gender == GenderMan and not(left.seeksMen)))
    implies not(mutuallyOpen(left, right))

pure def lawNonbinaryAppearsOnlyWhereChosen(left: DatingStatement, right: DatingStatement): bool =
  (right.gender == GenderNonbinary and not(left.seeksNonbinary)
    and not(left.seeksWomen and right.shownToWomenSeekers) and not(left.seeksMen and right.shownToMenSeekers))
    implies not(mutuallyOpen(left, right))

pure def lawShownToCountsOnlyForNonbinary(left: DatingStatement, right: DatingStatement): bool =
  right.gender != GenderNonbinary implies
    (mutuallyOpen(left, right) iff mutuallyOpen(left, { ...right, shownToWomenSeekers: false, shownToMenSeekers: false }))
```

### A member whose gender is not stated is not admissible in Date

```quint
pure def lawUnstatedGenderIsNotAdmissible(left: DatingStatement, right: DatingStatement): bool =
  right.gender == GenderUnstated implies not(mutuallyOpen(left, right))
```

### A member who stated trans meets only members who said they are open

A member who stated trans is admissible only to a member who answered "open", or to a member who also stated trans and answered "only trans partners". An unanswered question is read exactly as "not open". A trans status that was not stated is read exactly as "not trans". When both members stated trans, each one's answer must admit the other.

```quint
pure def lawStatedTransNeedsAnOpenPartner(left: DatingStatement, right: DatingStatement): bool =
  (right.trans == StatedTrans and mutuallyOpen(left, right)) implies
    (left.transOpenness == OpenToTrans or (left.transOpenness == OnlyTrans and left.trans == StatedTrans))

pure def lawUnansweredIsNotOpen(left: DatingStatement, right: DatingStatement): bool =
  left.transOpenness == TransUnanswered implies
    (mutuallyOpen(left, right) iff mutuallyOpen({ ...left, transOpenness: NotOpenToTrans }, right))

pure def lawUnstatedTransIsNotInferred(left: DatingStatement, right: DatingStatement): bool =
  mutuallyOpen(left, { ...right, trans: TransNotStated }) iff mutuallyOpen(left, { ...right, trans: StatedNotTrans })
```

### Only trans partners is available only to a member who stated trans

```quint
pure def lawOnlyTransNeedsTwoStatedTransMembers(left: DatingStatement, right: DatingStatement): bool =
  (left.transOpenness == OnlyTrans and mutuallyOpen(left, right)) implies
    (left.trans == StatedTrans and right.trans == StatedTrans)
```

### The Date segment never refuses an admissible pair

What a member decides about another member reads only the other member's segment class: the genders the other member appears to, and the other member's stated trans status. The other member's own seeking set and trans answer change nothing in that one-way decision. So the shell can key the Date segment by class: a member's own key is their segment class and their coarse cell, and their partner keys are every class the member admits, on every cell within the member's own limit. The shell enumerates the 16 classes (packages/engine/src/packs/slop/generators.ts). That the enumeration and its key cover every admissible pair is outside this law; the evidence is the slop sim monitor "segment refuses what rules admit" and the Date segment case in packages/engine/test/mutual-openness.integration.test.ts.

```quint
pure def lawOneWayOpennessReadsOnlyTheSegmentClass(left: DatingStatement, right: DatingStatement): bool =
  datingOneWayOpen(left, right) iff datingOneWayOpen(left, {
    ...right, seeksWomen: not(right.seeksWomen), seeksMen: not(right.seeksMen), seeksNonbinary: not(right.seeksNonbinary),
    transOpenness: OpenToTrans,
  })
```

## Story: Choose who I make friends with

> As a friends.help member, I want to say whether I want to meet women, men or anyone, and meet only people who are open to me too.

### A friend pair is admissible only when each member is inside the other's friendship openness

Each member may state a gender and a friendship openness: women, men or anyone. A member who did not answer is open to anyone. A member open to women admits only members who stated they are women; a member open to men admits only members who stated they are men. A pair is admissible only when each member admits the other. Every pair in a circle passes the same pair gate, so a circle holds only members who are all open to each other. The Friend segment key (packages/engine/src/packs/friends/vectors.ts) is the member's home, transit-tolerance class and stated gender; the partner keys list every stated gender the member admits, so the segment refuses no pair that this rule and the transit rule admit.

```quint
type FriendOpenness = FriendsWithWomen | FriendsWithMen | FriendsWithAnyone
type FriendStatement = { friendGender: StatedGender, friendOpenness: FriendOpenness }

pure val friendOpennessUnanswered: FriendOpenness = FriendsWithAnyone

pure def friendAdmits(m: FriendStatement, other: FriendStatement): bool =
  m.friendOpenness == FriendsWithAnyone
    or (m.friendOpenness == FriendsWithWomen and other.friendGender == GenderWoman)
    or (m.friendOpenness == FriendsWithMen and other.friendGender == GenderMan)

pure def friendsMutuallyOpen(first: FriendStatement, second: FriendStatement): bool =
  friendAdmits(first, second) and friendAdmits(second, first)

pure val firstValues = Set(
  { friendGender: GenderWoman, friendOpenness: FriendsWithAnyone },
  { friendGender: GenderWoman, friendOpenness: FriendsWithWomen },
  { friendGender: GenderWoman, friendOpenness: FriendsWithMen },
  { friendGender: GenderMan, friendOpenness: FriendsWithAnyone },
  { friendGender: GenderMan, friendOpenness: FriendsWithMen },
  { friendGender: GenderMan, friendOpenness: FriendsWithWomen },
  { friendGender: GenderNonbinary, friendOpenness: FriendsWithAnyone },
  { friendGender: GenderUnstated, friendOpenness: FriendsWithAnyone },
  { friendGender: GenderUnstated, friendOpenness: FriendsWithWomen },
)
pure val secondValues = firstValues

pure def lawFriendOpennessIsSymmetric(first: FriendStatement, second: FriendStatement): bool =
  friendsMutuallyOpen(first, second) iff friendsMutuallyOpen(second, first)

pure def lawFriendsWithOneGenderMeetOnlyThatGender(first: FriendStatement, second: FriendStatement): bool =
  friendsMutuallyOpen(first, second) implies
    ((first.friendOpenness != FriendsWithWomen or second.friendGender == GenderWoman)
      and (first.friendOpenness != FriendsWithMen or second.friendGender == GenderMan))

pure def lawFriendsOpenToAnyoneMeetEachOther(first: FriendStatement, second: FriendStatement): bool =
  (first.friendOpenness == FriendsWithAnyone and second.friendOpenness == FriendsWithAnyone)
    implies friendsMutuallyOpen(first, second)
```
