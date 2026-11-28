# Participation controls in conversation

The member can change settings for the app handling their signed text. The service reads the canonical phone and membership, writes the setting, and records the reply in the same transaction. The service writes quiet hours only for a quiet hours command, so a signup or an update to a different setting keeps the saved hours. These settings govern later outreach in that app. The shared-line STOP and START commands use the [carrier consent rules](carrierConsent.md).

## Story: Change when and about what Eliza can contact me

> As a member, I want to pause or resume matching, set quiet hours, and choose categories in my conversation.

### Only the current member can change settings in the current app

Require a signed direct text from the current owner of an active, opted-in membership for that app. A command cannot join an app, act for a different member, or opt a person back into carrier messages. Reject a settings command embedded in an assistant's profile submission.

```quint
pure def participationControlAllowed(signedDirect: bool, ownActiveMembership: bool): bool =
  signedDirect and ownActiveMembership
```

### Quiet hours use the member's local clock

Save two explicitly specified whole hours. Ask for clarification when a quiet hours command does not determine both endpoints. Accept overnight windows. A window with the same start and end hour is empty. Explicitly turning quiet hours off sets both endpoints to midnight. A signup or an update to a different setting keeps the saved hours.

A direct refusal bounded by a clock time, such as "don't text me after 10 pm" or "don't text me before 7 am", sets the named endpoint and keeps the saved value of the other endpoint. The reply confirms the saved window. The [quiet hours rules](quietHours.md) define the endpoint update.

```quint
pure def controlQuietHoursValid(startHour: int, endHour: int): bool =
  startHour >= 0 and startHour < 24 and endHour >= 0 and endHour < 24

pure def quietHoursCommandComplete(startKnown: bool, endKnown: bool, startHour: int, endHour: int): bool =
  startKnown and endKnown and controlQuietHoursValid(startHour, endHour)

pure val quietHoursOffHour: int = 0

pure def quietHoursEmpty(startHour: int, endHour: int): bool = startHour == endHour

pure def lawMissingEndpointNeedsClarification(known: bool, startHour: int, endHour: int): bool =
  not(quietHoursCommandComplete(false, known, startHour, endHour)) and not(quietHoursCommandComplete(known, false, startHour, endHour))

pure def lawQuietHoursOffIsEmpty(startHour: int): bool =
  (startHour == quietHoursOffHour) implies (quietHoursEmpty(startHour, quietHoursOffHour) and controlQuietHoursValid(startHour, quietHoursOffHour))
```

### A category changes only on an explicit request

An enable command can add a category the app offers. Enabling dating also requires known adult eligibility. A disable command removes the category even if the app no longer offers it. Choosing another category leaves dating permission as it was.

```quint
pure def participationCategoryAllowed(category: str, enable: bool, appOffers: bool, adult: bool): bool =
  not(enable) or (appOffers and (category != "romance" or adult))

pure def changeParticipationCategory(categories: List[str], category: str, enable: bool): List[str] =
  if (enable) {
    if (categories.includes(category)) categories else categories.append(category)
  } else categories.select(saved => saved != category)

pure def controlRomanceOptIn(priorOptIn: bool, category: str, enable: bool): bool =
  if (category == "romance") enable else priorOptIn

pure def lawNonDatingCategoryLeavesDatingPermission(priorOptIn: bool, category: str, enable: bool): bool =
  (category != "romance") implies controlRomanceOptIn(priorOptIn, category, enable) == priorOptIn
```

### Pause and resume apply immediately to matching

Set paused participation until the member changes it, or resume normal participation. Either explicit change replaces a temporary participation window. A pause that names a weekday ends at the start of the next such weekday in the member's local time, counting the same weekday as seven days ahead. A member who opted out of carrier messages must use the separate START path. An idempotent repeat confirms the setting without creating another setting-change event.

A pause with a duration or an end day is a [participation window](participationWindow.md) that pauses matching from the request until that end. It keeps the stored participation, except that it replaces a pause with no end. At the end of the window, matching uses the stored participation again.

```quint
pure def participationControlState(pause: bool): str = if (pause) "paused" else "normal"

pure def pauseUntilWeekdayDaysAhead(todayWeekday: int, namedWeekday: int): int =
  if ((namedWeekday - todayWeekday + 7) % 7 == 0) 7 else (namedWeekday - todayWeekday + 7) % 7

pure def lawPauseUntilWeekdayEndsAhead(todayWeekday: int, namedWeekday: int): bool =
  (0 <= todayWeekday and todayWeekday < 7 and 0 <= namedWeekday and namedWeekday < 7) implies
    (pauseUntilWeekdayDaysAhead(todayWeekday, namedWeekday) >= 1 and pauseUntilWeekdayDaysAhead(todayWeekday, namedWeekday) <= 7)
```
