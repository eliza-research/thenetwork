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
