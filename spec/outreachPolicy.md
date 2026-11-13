# Outreach policy

## Story: Limit unsolicited messages across apps

> As a member of several apps, I want a single daily limit on unsolicited messages.

### The default daily proactive limit is three across all apps

The Network uses one default limit per person across apps. The send path takes a slot under a database lock before it hands the message to the channel. Replies and other non-proactive messages do not use proactive slots.

```quint
pure val personDailyCap: int = 3
```
