# Quiet hours

The Network compares local wall-clock values in the same units. Callers resolve the recipient's time zone and use hours or minutes as appropriate. The rule uses only equality and ordering, so the same comparisons apply to fractional hours.

## Story: Avoid unsolicited messages during quiet hours

> As a member, I want Eliza to wait when I have set quiet hours, including when they span midnight.

### A quiet window includes its start and excludes its end

A window that ends after it starts covers the interval between those times. When the end precedes the start, the window covers the remaining time before midnight and the time after midnight up to the end. Equal start and end times specify an empty window. This rule classifies local time. The caller decides which message kinds must wait.

```quint
pure def withinQuietHours(localHour: int, startHour: int, endHour: int): bool =
  if (startHour == endHour) false
  else if (startHour < endHour) localHour >= startHour and localHour < endHour
  else localHour >= startHour or localHour < endHour
```

### A texted clock bound updates the saved window

A member can state a clock bound in a text, such as "don't text me after 10 pm" or "don't text me before 7 am". An after bound sets the window start. A before bound sets the window end. A stated window sets both. A bound the text does not state keeps its saved value. The text reader parses the stated bound. Later sends and notification planning read the saved window.

```quint
pure def quietStartAfterText(currentStart: int, statedStart: int, startStated: bool): int =
  if (startStated) statedStart else currentStart

pure def quietEndAfterText(currentEnd: int, statedEnd: int, endStated: bool): int =
  if (endStated) statedEnd else currentEnd

pure def lawUnstatedBoundKeepsSavedValue(currentStart: int, currentEnd: int, statedStart: int, statedEnd: int): bool =
  quietStartAfterText(currentStart, statedStart, false) == currentStart and
    quietEndAfterText(currentEnd, statedEnd, false) == currentEnd
```

### The boundary remains the same for windows that span midnight

When the start and end differ, the start is quiet and the end is open in both daytime and overnight windows.

```quint
pure def lawWindowBoundaries(startHour: int, endHour: int): bool =
  (startHour != endHour) implies
    (withinQuietHours(startHour, startHour, endHour) and not(withinQuietHours(endHour, startHour, endHour)))
```
