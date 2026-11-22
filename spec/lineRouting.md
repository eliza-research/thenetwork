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

New rule: these two checks moved from the service into this ordered gate without a change in behavior. A message that declines a member invitation ends there. Then the service reads the phone's hold state, only for a number that is not banned, because the read records the number as seen and can put a number unused for 12 months on hold. A held number gets no reply except the HELP text. Unlike a banned or underage sender, a held number cannot leave one app: the hold exists because the number may now belong to a new person, and the leave reply ("You're unsubscribed from slop") would tell that person which apps the earlier owner used. STOP still works for a held number because it comes first, and it stops every app with a reply that names no app. Every other message continues to the commands, photos, app leave, START, the member's conversation or the join.

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

### Every app leave gets one honest reply

New rule on 2026-11-21 (audit SHA66): before, "leave <app>" from a number that was not a member of that app, or for an app that does not run on this backend, ended with no reply, so the person could repeat it or send STOP, which stops every app. Now a leave from a live member of the app removes that membership and gets the app's left reply. A live member is one the app's network routes this number to, or one whose stored membership is neither invited nor removed (a retry after the network member was cleaned up). A leave from anyone else gets one reply that says they are not in that app and that nothing changed; it writes no consent event and names no other app.

```quint
type LeaveReply = LeftAppReply | NotInAppReply
pure def leaveReply(routedMember: bool, membershipInvited: bool, membershipRemoved: bool, hasMembership: bool): LeaveReply =
  if (routedMember or (hasMembership and not(membershipInvited) and not(membershipRemoved))) LeftAppReply else NotInAppReply

pure def lawStrangerHearsNotInApp(membershipInvited: bool, membershipRemoved: bool): bool =
  leaveReply(false, membershipInvited, membershipRemoved, false) == NotInAppReply

pure def lawInvitedOrRemovedHearsNotInApp(membershipInvited: bool, membershipRemoved: bool): bool =
  (membershipInvited or membershipRemoved) implies leaveReply(false, membershipInvited, membershipRemoved, true) == NotInAppReply

pure def lawRoutedMemberHearsLeft(membershipInvited: bool, membershipRemoved: bool, hasMembership: bool): bool =
  leaveReply(true, membershipInvited, membershipRemoved, hasMembership) == LeftAppReply
```

## Story: Join the apps I asked for from The Network

> As a person who joined The Network with no app keyword, I want my answer to "what are you looking for?" to enroll me only in the apps I asked for.

### A refused app is never enrolled, even with "all of them"

Changed: before this rule, "all of them" or "everything" added every app, also an app that the same answer refused ("everything but not dating" enrolled slop.date). Now the shell reads each of friends, dating and work as absent, wanted or refused, and "everything" adds only the apps that the answer did not refuse. A refusal ("not dating", "no work") wins over a mention of the same app. Changed again in review: the shell reading now lets a refusal cover its whole clause up to a comma, a full stop or a word such as "but" or "just" ("not looking for a date"), reads "nothing romantic", "anything but dating" and "dating? no" as refusals, carries a refusal over "or" after a comma ("no dating, or work"), and no longer reads "love" alone as dating ("I'd love to make friends"), because the earlier two-word reach read these refusals as wants and enrolled slop.date. When the reading is not clear it leans to refusal: a missed want only leaves an app out, and the message goes on to the member's conversation, where the person can name the app again. The order is friends, then slop, then peon. The text enrollment rule for other-app enrollment still checks each named app's age and running state.

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

## Story: Report a person in the app where I met them

> As a member of two or more apps, I want "block X", "report X" and my answer to "Who do you mean?" to reach the app where I met that person or where the question waits.

### A block, a report and the answer to "Who do you mean?" go to the app where they belong

New rule on 2026-11-22 (audit SD-250 and W3-220): before, these texts went to the app with the newest open item or the last app that wrote to the member, so a report about a person met in another app found nobody, and an answer to "Who do you mean?" could go to another app, where the waiting report lapsed and was never filed. Now, for a member of two or more apps, the service asks each app's network about the text. A block or report claims the app where the member's newest meeting with the named person took place. A text of at most four words claims the app where a "Who do you mean?" question from the last day waits, unless one of the member's other apps sent the member any message newer than the question, or the text is an answer with an age to a pending join for an app the member has yet to join. The service reads an app's network for an answer only when that app's stored state holds a question for the member; a block or report reads every app. The app with the newest claim takes the text, and on equal times the first app read keeps it. Changed again on 2026-11-22 (review of SD-250): before, only a newer open item in another app kept the answer from the question, so a short answer to another app's newer onboarding question ("climbing") or a join answer for a third app ("Kit, 29") went to the old question and was lost; and the service read every app's full state for every short text, which delayed the turn, and chose the newest claim in its own code. The claim comes after a dedicated line, a profile read, a survey reply and an app keyword, and before every other route ([text enrollment](textEnrollment.md)). A member of one app needs no read, because every route then reaches the same app. The network keeps the answer's own rules: an answer of more than four words is never taken as an answer.

```quint
pure val maxWhoAnswerWords: int = 4
pure val memberAppsValues = Set(0, 1, 2, 4)
pure val wordsValues = Set(1, 4, 5, 20)
pure val meetingAtValues = Set(-1, 0, 7)
pure val pendingSafetyAtValues = Set(-1, 0, 5, 9)
pure val newestOtherMessageAtValues = Set(-1, 0, 5, 9)
pure val atValues = Set(-1, 0, 5, 9)
pure val leadAtValues = Set(-1, 0, 5, 9)

pure def safetyRouteReadNeeded(memberApps: int, safetyCommand: bool, words: int): bool =
  memberApps > 1 and (safetyCommand or words <= maxWhoAnswerWords)

pure def safetyAppReadNeeded(safetyCommand: bool, questionStored: bool): bool =
  safetyCommand or questionStored

pure def safetyCommandClaims(meetingAt: int): bool = meetingAt >= 0

pure def safetyAnswerClaims(pendingSafetyAt: int, newestOtherMessageAt: int, joinAnswerWithAge: bool): bool =
  pendingSafetyAt >= 0 and pendingSafetyAt >= newestOtherMessageAt and not(joinAnswerWithAge)

pure def safetyClaimLeads(claims: bool, at: int, leadAt: int): bool =
  claims and at > leadAt

pure def lawOneAppNeedsNoSafetyRead(safetyCommand: bool, words: int): bool =
  not(safetyRouteReadNeeded(1, safetyCommand, words))

pure def lawLongTextIsNoWhoAnswer(memberApps: int, words: int): bool =
  words > maxWhoAnswerWords implies not(safetyRouteReadNeeded(memberApps, false, words))

pure def lawCommandIsReadForSeveralApps(memberApps: int, words: int): bool =
  memberApps > 1 implies safetyRouteReadNeeded(memberApps, true, words)

pure def lawCommandReadsEveryApp(questionStored: bool): bool =
  safetyAppReadNeeded(true, questionStored)

pure def lawNoStoredQuestionNoAnswerRead(questionStored: bool): bool =
  not(questionStored) implies not(safetyAppReadNeeded(false, questionStored))

pure def lawNoMeetingNoCommandClaim(meetingAt: int): bool =
  meetingAt < 0 implies not(safetyCommandClaims(meetingAt))

pure def lawNoQuestionNoAnswerClaim(newestOtherMessageAt: int, joinAnswerWithAge: bool): bool =
  not(safetyAnswerClaims(-1, newestOtherMessageAt, joinAnswerWithAge))

pure def lawNewerMessageElsewhereKeepsTheAnswer(pendingSafetyAt: int, newestOtherMessageAt: int, joinAnswerWithAge: bool): bool =
  newestOtherMessageAt > pendingSafetyAt implies not(safetyAnswerClaims(pendingSafetyAt, newestOtherMessageAt, joinAnswerWithAge))

pure def lawJoinAnswerWithAgeKeepsTheAnswer(pendingSafetyAt: int, newestOtherMessageAt: int): bool =
  not(safetyAnswerClaims(pendingSafetyAt, newestOtherMessageAt, true))

pure def lawQuestionAfterEveryMessageClaims(pendingSafetyAt: int, newestOtherMessageAt: int): bool =
  (pendingSafetyAt >= 0 and newestOtherMessageAt <= pendingSafetyAt) implies safetyAnswerClaims(pendingSafetyAt, newestOtherMessageAt, false)

pure def lawNoClaimNeverLeads(at: int, leadAt: int): bool =
  not(safetyClaimLeads(false, at, leadAt))

pure def lawFirstClaimLeads(at: int): bool =
  at >= 0 implies safetyClaimLeads(true, at, -1)

pure def lawEqualTimeKeepsTheLead(at: int): bool =
  not(safetyClaimLeads(true, at, at))
```
