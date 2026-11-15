# Relay decision

The [relay flow model](models/relay.md) follows requests from item creation to delivery. The engine owns content checks and classifier calls. This module computes the verdict from their results and checks the time window for item consent.

## Story: Share only the item I approved

> As a member in a match, I want Eliza to share my selected item only while my permission for it is valid.

### Consent cannot come from the future or outlive the item window

The consent must name the sender and the exact item. The shell checks those bindings. The consent timestamp cannot be after the item, and the elapsed time cannot exceed the configured lifetime.

```quint
pure def relayConsentStale(consentAt: int, itemAt: int, lifetime: int): bool =
  consentAt > itemAt or itemAt - consentAt > lifetime

pure def lawFutureConsentIsStale(consentAt: int, itemAt: int, lifetime: int): bool =
  consentAt > itemAt implies relayConsentStale(consentAt, itemAt, lifetime)
```

## Story: Keep unsafe items from reaching a match

> As a member, I want Eliza to stop or hold items when the relay checks find a reason.

### A blocking reason takes precedence over a hold

A blocking reason blocks delivery. Other reasons hold the item. A relay verdict is pass only when the checks record no reason.

```quint
type RelayVerdict = Pass | Hold | Block

pure def relayVerdict(hasBlock: bool, hasReason: bool): RelayVerdict =
  if (hasBlock) Block else if (hasReason) Hold else Pass

pure def lawARelayPassHasNoReason(hasBlock: bool, hasReason: bool): bool =
  relayVerdict(hasBlock, hasReason) == Pass implies (not(hasBlock) and not(hasReason))
```
