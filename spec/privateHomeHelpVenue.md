# Share the private location for home help

[Story F14](product/stories.md#story-f14--ask-for-bounded-help) permits exact
address disclosure for reviewed home help. The address is separate from the
[plan](boundedHelp.md). The ordinary conversation keeps using the coarse area.

The shell's storage keeps one row for each plan. A stored address or a
revocation marker in that row, kept until the plan changes or expires,
makes a later submit for the plan store nothing, so a revision can receive one address and a delayed submit cannot
restore a revoked address. The shell erases the ciphertext in the same
transaction as a consent withdrawal, and erases it on revision, closure, plan
deletion and expiry.

## Story: Control who can read my home-help address

> As the person who requested home help, I want to disclose my address only to the people who accepted the current plan.

### The requester supplies one address after everyone accepts this revision

Accept an address from a directly verified requester only after the current
roster and requester have all explicitly accepted the exact reviewed revision.
Use the current eligibility and consent facts in the same transaction as the
write. Store only authenticated ciphertext with a separate service key. A
private submission does not send a message.

```quint
pure def homeHelpVenueLive(now: int, expiresAt: int): bool = now < expiresAt

pure def mayStoreHomeHelpVenue(owner: bool, unanimousCurrentConsent: bool, now: int, expiresAt: int): bool =
  owner and unanimousCurrentConsent and homeHelpVenueLive(now, expiresAt)

pure def lawHomeHelpVenueStorageRequiresOwnerAndConsent(owner: bool, unanimousCurrentConsent: bool, now: int, expiresAt: int): bool =
  not(mayStoreHomeHelpVenue(false, unanimousCurrentConsent, now, expiresAt))
  and not(mayStoreHomeHelpVenue(owner, false, now, expiresAt))
```

### A helper reads the address in a directly verified private request

Return the address in a private uncached response only to a verified current
helper who accepted this revision. Check the live review, roster and all
consents again in the same transaction as the read. Bind ciphertext to the
app, plan, revision, approval expiry and exact roster. Keep the address out of
staff tools, messages, model context, analytics and request logs.

```quint
pure def mayReadHomeHelpVenue(helper: bool, unanimousCurrentConsent: bool, now: int, expiresAt: int): bool =
  helper and unanimousCurrentConsent and homeHelpVenueLive(now, expiresAt)

pure def lawHomeHelpVenueReadRequiresHelperAndConsent(helper: bool, unanimousCurrentConsent: bool, now: int, expiresAt: int): bool =
  not(mayReadHomeHelpVenue(false, unanimousCurrentConsent, now, expiresAt))
  and not(mayReadHomeHelpVenue(helper, false, now, expiresAt))

pure def lawExpiredHomeHelpVenueIsUnavailable(owner: bool, helper: bool, unanimousCurrentConsent: bool, expiresAt: int): bool =
  not(mayStoreHomeHelpVenue(owner, unanimousCurrentConsent, expiresAt, expiresAt))
  and not(mayReadHomeHelpVenue(helper, unanimousCurrentConsent, expiresAt, expiresAt))
```

### Revocation, plan change and expiry end access

The verified requester can revoke access for the current revision without
waiting for helpers. Consent withdrawal, revision, closure, plan deletion and expiry end
access, because a read and a store need current unanimous consent for the
current revision before its expiry. These rules govern future access to the
address.

```quint
pure def mayRevokeHomeHelpVenue(owner: bool, currentRevision: bool, now: int, expiresAt: int): bool =
  owner and currentRevision and homeHelpVenueLive(now, expiresAt)

pure def lawHomeHelpVenueRevocationRequiresCurrentOwner(owner: bool, currentRevision: bool, now: int, expiresAt: int): bool =
  not(mayRevokeHomeHelpVenue(false, currentRevision, now, expiresAt))
  and not(mayRevokeHomeHelpVenue(owner, false, now, expiresAt))
```

### The conversation points each participant to the private page

A participant sends `HOME HELP ADDRESS <plan ID> <revision>` in their own
signed conversation. The reply never contains the address. It gives the
requester the private page link when the requester may store the address, and
says whether an address is already saved. It gives a helper the private page
link only when a saved address exists and the helper may read it. Every other
case, including a person outside the roster, a missing yes, a changed roster,
a revoked address and expiry, gets the same closed answer. The reply to a
recorded yes names this command. The requester learns only that the whole
roster agreed, which the private page needs, and never who answered or how.
Changed on 2026-11-17 (audit CRI12): before this rule no message told a
participant that the address step existed, so a reviewed plan could not reach
the private page.
The private page reads the same step for the signed-in participant through a
status action of the site call. An open step answers with the person's role,
requester or helper, and whether an address is saved, and never with the
address, the other people or the reason. A closed step gets the closed answer
of the other actions. A revocation marker for the plan also closes the
requester's step, because a submit then stores nothing. Changed on 2026-11-22
(owner decision, one-purpose pages): the page could not know the role or a
saved address before it acted, and after a revocation the reply still asked
the requester to add an address that the page then refused.

```quint
type HomeHelpAddressStep = AddressStepClosed | RequesterAddsAddress | RequesterAddressSaved | HelperReadsAddress

pure val addressRevokedValues = Set(true, false)

pure def homeHelpAddressStep(requester: bool, helper: bool, unanimousCurrentConsent: bool, addressStored: bool, addressRevoked: bool, now: int, expiresAt: int): HomeHelpAddressStep =
  if (requester and mayStoreHomeHelpVenue(true, unanimousCurrentConsent, now, expiresAt))
    (if (addressStored) RequesterAddressSaved else if (addressRevoked) AddressStepClosed else RequesterAddsAddress)
  else if (helper and addressStored and mayReadHomeHelpVenue(true, unanimousCurrentConsent, now, expiresAt)) HelperReadsAddress
  else AddressStepClosed

pure def lawHomeHelpAddressStepNeedsConsent(requester: bool, helper: bool, addressStored: bool, addressRevoked: bool, now: int, expiresAt: int): bool =
  homeHelpAddressStep(requester, helper, false, addressStored, addressRevoked, now, expiresAt) == AddressStepClosed

pure def lawHomeHelpAddressStepNeedsParticipant(unanimousCurrentConsent: bool, addressStored: bool, addressRevoked: bool, now: int, expiresAt: int): bool =
  homeHelpAddressStep(false, false, unanimousCurrentConsent, addressStored, addressRevoked, now, expiresAt) == AddressStepClosed

pure def lawHelperWaitsForStoredAddress(unanimousCurrentConsent: bool, addressRevoked: bool, now: int, expiresAt: int): bool =
  homeHelpAddressStep(false, true, unanimousCurrentConsent, false, addressRevoked, now, expiresAt) == AddressStepClosed

pure def lawRevokedAddressClosesTheRequesterStep(helper: bool, unanimousCurrentConsent: bool, now: int, expiresAt: int): bool =
  homeHelpAddressStep(true, helper, unanimousCurrentConsent, false, true, now, expiresAt) == AddressStepClosed

pure def lawExpiredHomeHelpAddressStepIsClosed(requester: bool, helper: bool, unanimousCurrentConsent: bool, addressStored: bool, addressRevoked: bool, expiresAt: int): bool =
  homeHelpAddressStep(requester, helper, unanimousCurrentConsent, addressStored, addressRevoked, expiresAt, expiresAt) == AddressStepClosed
```
