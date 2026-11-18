# Shared-line routing and inbound precedence

The shared text line serves every app. The service reads each message into a small typed reading: the carrier keyword, whether the text names an app to leave, whether it declines a member invitation, and, for an answer to "what are you looking for?", which apps it wants or refuses. The regular expressions that make the reading stay in the shell (`packages/platform/src/apps.ts`, `packages/platform/src/consent.ts`, `packages/network/service/service.ts`). This module decides what the reading does. The [text enrollment](textEnrollment.md) module picks the app for the message and runs the join. The [member age](memberAge.md) and [safety case](safetyCase.md) modules own the age and ban guards that this module applies in order. The service keeps the database reads, the consent ledger, the phone hold write and the replies. The corpus `evals/network/line-routing.jsonl` records real phrasings with their readings and decisions, and `packages/network/test/line-routing.integration.test.ts` sends each one through the inbound path. The product story is [Story F30](product/stories.md#story-f30--join-the-app-i-asked-for).

## Story: Keep carrier commands, bans and age ahead of every other reading

> As a person on the shared line, I want STOP, HELP and "leave <app>" to work first, and I want a ban or an age refusal to stop everything else.

### STOP ends the message before any other check

New rule: before this module, the order of these checks was hand-written in the service. STOP or STOP ALL goes to the consent ledger before the ban, age, invitation or hold checks. The service then applies STOP to every member it covers. A message without STOP goes to the ban check.

```quint
import memberAge as Age from "./memberAge"
import safetyCase as Safety from "./safetyCase"

type LineCommand = LineNoCommand | LineStop | LineStopAll | LineHelp | LineStart
type LineGatePhase = LineAwaitingCommand | LineAwaitingBan | LineAwaitingAge | LineAwaitingInviteDecline |
  LineAwaitingNumberHold | LineStopped | LineBannedIgnored | LineBannedHelp | LineAgeDeclined | LineUnderageHelp |
  LineInviteDeclined | LineNumberHeld | LineContinue
type LineGate = { phase: LineGatePhase, command: LineCommand, leaveNamed: bool, banned: bool, underage: bool }

pure val initial: LineGate =
  { phase: LineAwaitingCommand, command: LineNoCommand, leaveNamed: false, banned: false, underage: false }

pure def lineCommandStops(command: LineCommand): bool = command == LineStop or command == LineStopAll

pure def canReadLineCommand(gate: LineGate): bool = gate.phase == LineAwaitingCommand
pure def readLineCommand(gate: LineGate, command: LineCommand, leaveNamed: bool): LineGate =
  { ...gate, command: command, leaveNamed: leaveNamed,
    phase: if (lineCommandStops(command)) LineStopped else LineAwaitingBan }

pure def alwaysStopGoesNoFurther(gate: LineGate): bool =
  lineCommandStops(gate.command) implies gate.phase == LineStopped

pure def sometimesLineStopped(gate: LineGate): bool = gate.phase == LineStopped
```

### A banned number gets only HELP and app leave

New rule: the ban check moved from the service into this ordered gate without a change in behavior. After STOP, a banned number or person can only get the HELP text or leave an app. Every other message from a banned number ends with no reply. HELP comes before leave when a message is both.

```quint
pure def lineCompliance(command: LineCommand, leaveNamed: bool): bool = command == LineHelp or leaveNamed

pure def linePastBan(phase: LineGatePhase): bool =
  phase == LineAwaitingAge or phase == LineAwaitingInviteDecline or phase == LineAwaitingNumberHold or
  phase == LineInviteDeclined or phase == LineNumberHeld or phase == LineContinue

pure def canCheckLineBan(gate: LineGate): bool = gate.phase == LineAwaitingBan
pure def checkLineBan(gate: LineGate, banned: bool): LineGate =
  { ...gate, banned: banned,
    phase: if (not(Safety::inboundAllowedAfterBan(banned, lineCompliance(gate.command, gate.leaveNamed)))) LineBannedIgnored
           else if (banned and gate.command == LineHelp) LineBannedHelp
           else LineAwaitingAge }

pure def alwaysBannedPassesOnlyToLeave(gate: LineGate): bool =
  (linePastBan(gate.phase) and gate.banned) implies (gate.leaveNamed and gate.command != LineHelp)

pure def sometimesBannedLeaves(gate: LineGate): bool = gate.phase == LineContinue and gate.banned
pure def sometimesBannedIgnored(gate: LineGate): bool = gate.phase == LineBannedIgnored
pure def sometimesBannedGetsHelp(gate: LineGate): bool = gate.phase == LineBannedHelp
```

### A confirmed age under 13 gets only HELP and app leave

New rule: the age check moved from the service into this ordered gate without a change in behavior. The service reads the lowest known age of the sender's member in the routed app, or -1 when there is none. A confirmed age under the join minimum declines every message except HELP and an app leave, START included. HELP gets the help text.

```quint
pure val ageValues = Set(-1, 0, 12, 13, 17, 18, 40, 121)

pure def linePastAge(phase: LineGatePhase): bool =
  phase == LineAwaitingInviteDecline or phase == LineAwaitingNumberHold or
  phase == LineInviteDeclined or phase == LineNumberHeld or phase == LineContinue

pure def canCheckLineAge(gate: LineGate): bool = gate.phase == LineAwaitingAge
pure def checkLineAge(gate: LineGate, age: int): LineGate =
  { ...gate, underage: Age::confirmedUnderage(age),
    phase: if (not(Age::textUseAllowedAtAge(age, lineCompliance(gate.command, gate.leaveNamed)))) LineAgeDeclined
           else if (Age::confirmedUnderage(age) and gate.command == LineHelp) LineUnderageHelp
           else LineAwaitingInviteDecline }

pure def alwaysUnderagePassesOnlyToLeave(gate: LineGate): bool =
  (linePastAge(gate.phase) and gate.underage) implies (gate.leaveNamed and gate.command != LineHelp)

pure def lawUnderageStartIsDeclined(age: int): bool =
  Age::confirmedUnderage(age) implies
    checkLineAge({ phase: LineAwaitingAge, command: LineStart, leaveNamed: false, banned: false, underage: false }, age).phase == LineAgeDeclined

pure def sometimesUnderageLeaves(gate: LineGate): bool = gate.phase == LineContinue and gate.underage
pure def sometimesAgeDeclined(gate: LineGate): bool = gate.phase == LineAgeDeclined
pure def sometimesUnderageGetsHelp(gate: LineGate): bool = gate.phase == LineUnderageHelp
```

### An invitation decline and a held number come before any flow

New rule: these two checks moved from the service into this ordered gate without a change in behavior. A message that declines a member invitation ends there. Then the service reads the phone's hold state, only for a number that is not banned, because the read records the number as seen and can put a number unused for 12 months on hold. A held number gets no reply except the HELP text. Every other message continues to the commands, photos, app leave, START, the member's conversation or the join.

```quint
pure def canCheckLineInviteDecline(gate: LineGate): bool = gate.phase == LineAwaitingInviteDecline
pure def checkLineInviteDecline(gate: LineGate, declines: bool): LineGate =
  { ...gate, phase: if (declines) LineInviteDeclined else LineAwaitingNumberHold }

pure def lineNumberHoldReadNeeded(banned: bool): bool = not(banned)

pure def canCheckLineNumberHold(gate: LineGate): bool = gate.phase == LineAwaitingNumberHold
pure def checkLineNumberHold(gate: LineGate, held: bool): LineGate =
  { ...gate, phase: if (held and lineNumberHoldReadNeeded(gate.banned)) LineNumberHeld else LineContinue }

pure def lineHeldNumberGetsHelp(phase: LineGatePhase, command: LineCommand): bool =
  phase == LineNumberHeld and command == LineHelp

pure def alwaysHeldNumberIsNotBanned(gate: LineGate): bool =
  gate.phase == LineNumberHeld implies not(gate.banned)

pure def sometimesInviteDeclined(gate: LineGate): bool = gate.phase == LineInviteDeclined
pure def sometimesNumberHeld(gate: LineGate): bool = gate.phase == LineNumberHeld
pure def sometimesLineContinues(gate: LineGate): bool =
  gate.phase == LineContinue and not(gate.banned) and not(gate.underage)
```

## Story: Join the apps I asked for from The Network

> As a person who joined The Network with no app keyword, I want my answer to "what are you looking for?" to enroll me only in the apps I asked for.

### A refused app is never enrolled, even with "all of them"

Changed: before this rule, "all of them" or "everything" added every app, also an app that the same answer refused ("everything but not dating" enrolled slop.date). Now the shell reads each of friends, dating and work as absent, wanted or refused, and "everything" adds only the apps that the answer did not refuse. A refusal ("not dating", "no work") wins over a mention of the same app. The order is friends, then slop, then peon. The text enrollment rule for other-app enrollment still checks each named app's age and running state.

```quint
type LookingForMention = MentionAbsent | MentionWanted | MentionRefused
type LookingForReading = { friends: LookingForMention, dating: LookingForMention, work: LookingForMention, everything: bool }

pure def lookingForWants(mention: LookingForMention, everything: bool): bool =
  mention == MentionWanted or (everything and mention == MentionAbsent)

pure def lookingForApps(reading: LookingForReading): List[str] =
  val friendsApps = if (lookingForWants(reading.friends, reading.everything)) List("friends") else List()
  val datingApps = if (lookingForWants(reading.dating, reading.everything)) List("slop") else List()
  val workApps = if (lookingForWants(reading.work, reading.everything)) List("peon") else List()
  friendsApps.concat(datingApps).concat(workApps)

pure def lawRefusedMentionIsNeverWanted(everything: bool): bool =
  not(lookingForWants(MentionRefused, everything))

pure def lawRefusedDatingNeverEnrollsSlop(friends: LookingForMention, work: LookingForMention, everything: bool): bool =
  not(lookingForApps({ friends: friends, dating: MentionRefused, work: work, everything: everything }).includes("slop"))

pure def lawEverythingAddsUnrefusedApps(friends: LookingForMention, dating: LookingForMention, work: LookingForMention): bool =
  (friends != MentionRefused and dating != MentionRefused and work != MentionRefused) implies
    lookingForApps({ friends: friends, dating: dating, work: work, everything: true }) == List("friends", "slop", "peon")
```
