# Cofounder standing intent

[Story F9](product/stories.md#story-f9--keep-a-standing-intent) keeps a member's declared professional goal available for later matching.

## Story: Keep looking for a cofounder

> As a Peon or Network member, I want to ask the Network to keep looking for a cofounder and stop when I pause or close the goal.

### Save only the current member's own affirmative goal

Save the goal from the adult member's own affirmative statement in a signed direct turn, in the active, consenting app membership bound to that turn. Peon and Network offer the Cofounder lane. A statement about another person, a negation, a quote, or assistant-submitted profile text does not grant this authority. Record the fixed professional objective, its member-confirmed source, and the signed receipt in one transaction. A receipt replay still requires the same current adult app membership and consent. This action opens no immediate request or proposal. Later matching uses the normal review and consent flow.

```quint
import matchLane as Lane from "./matchLane"

pure val cofounderIntentObjective = "find a cofounder"
pure val cofounderIntentDetails = "cofounder:member-confirmed"

pure def canSaveCofounderIntent(app: str, signedDirect: bool, affirmative: bool, currentAdultMember: bool): bool =
  Lane::laneOffered(app, Lane::Cofounder) and signedDirect and affirmative and currentAdultMember

pure def lawUnsignedTurnCannotSetCofounderIntent(app: str, affirmative: bool, currentAdultMember: bool): bool =
  not(canSaveCofounderIntent(app, false, affirmative, currentAdultMember))

pure def lawCofounderIntentNeedsOwnAffirmation(app: str, signedDirect: bool, currentAdultMember: bool): bool =
  not(canSaveCofounderIntent(app, signedDirect, false, currentAdultMember))
```

### A repeated statement preserves a live or paused goal

A repeated statement does not replace, extend or unpause a live or paused goal. A new affirmative turn after the goal closes or expires can create a fresh intent. Give the new intent its own stable identifier so any prior proposal still refers to the prior intent. Use the existing standing-intent lifetime and pause and close commands.

```quint
import standingIntent as Standing from "./standingIntent"

pure def cofounderIntentBlocksNew(phase: Standing::StandingIntentPhase): bool =
  phase == Standing::IntentLive or phase == Standing::IntentPaused

pure def lawClosedCofounderIntentCanBeReplaced(phase: Standing::StandingIntentPhase): bool =
  phase != Standing::IntentClosed or not(cofounderIntentBlocksNew(phase))
```

## Story: Meet a cofounder as an equal

> As a member looking for a cofounder, I want my stated work facts to decide who I meet, so that we bring different skills and the same commitment, and neither of us is the employer.

### A stated must-have is a hard rule for both cofounders

Each cofounder may state three work facts: a role (technical, business or both), a commitment (full time now, part time, or full time later) and an idea (has an idea, open to an idea, or either). For each fact the member may say it is a must-have, a preference, or that they do not mind; a fact that was not rated is "do not mind". A technical member wants a business or a both member; a business member wants a technical or a both member; a both member wants any stated role. Commitment wants the same stated commitment. A member with an idea wants a member who is open or either; an open member wants a member with an idea or either; an either member wants any stated idea. A must-have is met only by a stated value that the member wants: a value that was not stated never meets it. A pair is admissible only when each member's must-haves are met by the other. Only these work facts enter the Cofounder lane: no age, gender, orientation, trans status or proxy. The lane stays Peers with no standing offset, so neither member is the employer. Preferences raise the pair value through the lane's complement term (the shell lists a wanted value as a seek and the member's own value as an offer); they never refuse a pair. The shell reads the facts from the member's own matchable facets in the lane's app (packages/engine/src/packs/network/cofounderFacts.ts), with the tags cofounder:role:<technical|business|both>, cofounder:commitment:<full_time_now|part_time|full_time_later>, cofounder:idea:<has_idea|open|either>, cofounder:must:<field> and cofounder:prefer:<field>; it skips an inferred, sensitive or private facet by the same readable rule as standing. No conversation step asks for these facts, so in production the rule acts only on facets that already carry the tags. Changed (stated signifiers work, 2026-11-22): this rule is new, because the product owner asked for cofounders as equals and the research found that complementary roles and the same commitment predict a good cofounder pair.

```quint
type CofounderRole = TechnicalCofounder | BusinessCofounder | BothRoles | RoleUnstated
type CofounderCommitment = FullTimeNow | PartTimeNow | FullTimeLater | CommitmentUnstated
type CofounderIdea = HasIdea | OpenToIdea | IdeaEither | IdeaUnstated
type CofounderImportance = MustHave | Preference | DoNotMind

type CofounderFacts = {
  role: CofounderRole, roleImportance: CofounderImportance,
  commitment: CofounderCommitment, commitmentImportance: CofounderImportance,
  idea: CofounderIdea, ideaImportance: CofounderImportance,
}

pure def cofounderRoleWanted(mine: CofounderRole, theirs: CofounderRole): bool =
  if (theirs == RoleUnstated) false
  else if (mine == TechnicalCofounder) theirs != TechnicalCofounder
  else if (mine == BusinessCofounder) theirs != BusinessCofounder
  else true

pure def cofounderCommitmentWanted(mine: CofounderCommitment, theirs: CofounderCommitment): bool =
  theirs != CommitmentUnstated and (mine == CommitmentUnstated or theirs == mine)

pure def cofounderIdeaWanted(mine: CofounderIdea, theirs: CofounderIdea): bool =
  if (theirs == IdeaUnstated) false
  else if (mine == HasIdea) theirs != HasIdea
  else if (mine == OpenToIdea) theirs != OpenToIdea
  else true

pure def cofounderMustsMet(m: CofounderFacts, other: CofounderFacts): bool = and {
  m.roleImportance != MustHave or cofounderRoleWanted(m.role, other.role),
  m.commitmentImportance != MustHave or cofounderCommitmentWanted(m.commitment, other.commitment),
  m.ideaImportance != MustHave or cofounderIdeaWanted(m.idea, other.idea),
}

pure def cofounderFactsFit(left: CofounderFacts, right: CofounderFacts): bool =
  cofounderMustsMet(left, right) and cofounderMustsMet(right, left)

pure val unstatedCofounderFacts: CofounderFacts = {
  role: RoleUnstated, roleImportance: DoNotMind, commitment: CommitmentUnstated, commitmentImportance: DoNotMind,
  idea: IdeaUnstated, ideaImportance: DoNotMind,
}

pure val leftValues = Set(
  unstatedCofounderFacts,
  { ...unstatedCofounderFacts, role: TechnicalCofounder, roleImportance: MustHave },
  { ...unstatedCofounderFacts, role: TechnicalCofounder, roleImportance: Preference, commitment: FullTimeNow, commitmentImportance: MustHave },
  { ...unstatedCofounderFacts, role: BusinessCofounder, roleImportance: MustHave, idea: HasIdea, ideaImportance: MustHave },
  { ...unstatedCofounderFacts, role: BusinessCofounder, commitment: FullTimeNow, idea: OpenToIdea },
  { ...unstatedCofounderFacts, role: BothRoles, roleImportance: MustHave, commitment: PartTimeNow, commitmentImportance: Preference },
  { ...unstatedCofounderFacts, role: TechnicalCofounder, commitment: FullTimeLater, idea: IdeaEither, ideaImportance: MustHave },
)
pure val rightValues = leftValues

pure def lawCofounderFitIsSymmetric(left: CofounderFacts, right: CofounderFacts): bool =
  cofounderFactsFit(left, right) iff cofounderFactsFit(right, left)

pure def lawSameRoleFailsARoleMustHave(left: CofounderFacts, right: CofounderFacts): bool =
  (left.roleImportance == MustHave and left.role == right.role and left.role != BothRoles)
    implies not(cofounderFactsFit(left, right))

pure def lawUnstatedNeverMeetsAMustHave(left: CofounderFacts, right: CofounderFacts): bool =
  ((left.roleImportance == MustHave and right.role == RoleUnstated)
    or (left.commitmentImportance == MustHave and right.commitment == CommitmentUnstated)
    or (left.ideaImportance == MustHave and right.idea == IdeaUnstated))
    implies not(cofounderFactsFit(left, right))

pure def lawPreferencesNeverRefuse(left: CofounderFacts, right: CofounderFacts): bool =
  (left.roleImportance != MustHave and left.commitmentImportance != MustHave and left.ideaImportance != MustHave
    and right.roleImportance != MustHave and right.commitmentImportance != MustHave and right.ideaImportance != MustHave)
    implies cofounderFactsFit(left, right)
```
