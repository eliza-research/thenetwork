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

### A refusal or uncertainty cannot authorize a private item

An explicit request for a contact share or photo is valid only when the member does not refuse it or qualify it as uncertain. A contact or photo refusal does not stop an ordinary message that the member explicitly asks the agent to relay. The shell reads the member's text, including refusal phrases such as "will not send" and instructions to proceed such as "will not wait, send it".

A condition on the recipient's assent or a later time leaves the private item unapproved. The reader can recognize a complete quoted body as an explicit text relay. The body then goes through the ordinary relay text checks.

```quint
pure def privateRelayRequestAllowed(refused: bool, uncertain: bool): bool =
  not(refused) and not(uncertain)

pure def lawPrivateRelayRequiresUnqualifiedConsent(refused: bool, uncertain: bool): bool =
  (refused or uncertain) implies not(privateRelayRequestAllowed(refused, uncertain))
```

### A member can take back a pending number swap

An instruction to cancel or withhold the member's own contact share withdraws their pending swap. A direct refusal such as "don't send it" also withdraws it while it is pending. A go-ahead such as "don't hesitate" or "no need to wait" leaves the request in place unless the member also refuses it. The shell recognizes these phrases in the member's own message.

```quint
pure def pendingSwapWithdrawn(namesOwnContact: bool, withholdsContact: bool, declinesPendingSend: bool): bool =
  declinesPendingSend or (namesOwnContact and withholdsContact)

pure def lawGoAheadKeepsPendingSwap(namesOwnContact: bool): bool =
  not(pendingSwapWithdrawn(namesOwnContact, false, false))

pure def lawDirectRefusalWithdrawsPendingSwap(namesOwnContact: bool, withholdsContact: bool): bool =
  pendingSwapWithdrawn(namesOwnContact, withholdsContact, true)
```

### A phone exchange must still have consent at dispatch

A withdrawal also marks the prepared shares involving that member. An outbound share must still have a passed record and no rejection or withdrawal. A swap question goes only while the matching request is pending within its consent window.

```quint
pure def relayRecordMayDispatch(passed: bool, rejected: bool, withdrawn: bool): bool =
  passed and not(rejected) and not(withdrawn)

pure def lawWithdrawnRelayRecordsCannotDispatch(passed: bool, rejected: bool): bool =
  not(relayRecordMayDispatch(passed, rejected, true))
```

## Story: Keep unsafe items from reaching a match

> As a member, I want Eliza to stop or hold items when the relay checks find a reason.

### A blocking reason takes precedence over a hold

The shared threat reader keeps a choice of times or activities outside the
threat reason. A terminal “or else” or an explicit harmful consequence
still goes to the existing blocking decision.

A blocking reason blocks delivery. Other reasons hold the item. A relay verdict is pass only when the checks record no reason.

```quint
type RelayVerdict = Pass | Hold | Block

pure def relayVerdict(hasBlock: bool, hasReason: bool): RelayVerdict =
  if (hasBlock) Block else if (hasReason) Hold else Pass

pure def lawARelayPassHasNoReason(hasBlock: bool, hasReason: bool): bool =
  relayVerdict(hasBlock, hasReason) == Pass implies (not(hasBlock) and not(hasReason))
```
