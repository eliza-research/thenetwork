# Share the private location for home help

[Story F14](product/stories.md#story-f14--ask-for-bounded-help) permits exact
address disclosure for reviewed home help. The address is separate from the
[plan](boundedHelp.md). The ordinary conversation keeps using the coarse area.

## Story: Control who can read my home-help address

> As the person who requested home help, I want to disclose my address only to the people who accepted the current plan.

### The requester supplies one address after everyone accepts this revision

Accept an address from a directly verified requester only after the current
roster and requester have all explicitly accepted the exact reviewed revision.
Use the current eligibility and consent facts in the same transaction as the
write. Store only authenticated ciphertext with a separate service key. A
revision can receive one address. A private submission does not send a message.

```quint
pure def homeHelpVenueLive(now: int, expiresAt: int): bool = now < expiresAt

pure def mayStoreHomeHelpVenue(owner: bool, unanimousCurrentConsent: bool, now: int, expiresAt: int): bool =
  owner and unanimousCurrentConsent and homeHelpVenueLive(now, expiresAt)

pure def lawHomeHelpVenueStorageRequiresOwnerAndConsent(owner: bool, unanimousCurrentConsent: bool, now: int, expiresAt: int): bool =
  mayStoreHomeHelpVenue(owner, unanimousCurrentConsent, now, expiresAt) implies (owner and unanimousCurrentConsent)
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
  mayReadHomeHelpVenue(helper, unanimousCurrentConsent, now, expiresAt) implies (helper and unanimousCurrentConsent)

pure def lawExpiredHomeHelpVenueIsUnavailable(owner: bool, helper: bool, unanimousCurrentConsent: bool, expiresAt: int): bool =
  not(mayStoreHomeHelpVenue(owner, unanimousCurrentConsent, expiresAt, expiresAt))
  and not(mayReadHomeHelpVenue(helper, unanimousCurrentConsent, expiresAt, expiresAt))
```

### Revocation, plan change and expiry end access

The verified requester can revoke access for the current revision without
waiting for helpers. Erase the ciphertext and retain a marker until the plan
changes or expires, so a delayed submit cannot restore the address. Consent
withdrawal ends access and erases ciphertext in the same transaction. Erase
ciphertext on revision, closure, plan deletion and expiry. These rules govern
future access to the address.

```quint
pure def mayRevokeHomeHelpVenue(owner: bool, currentRevision: bool, now: int, expiresAt: int): bool =
  owner and currentRevision and homeHelpVenueLive(now, expiresAt)

pure def lawHomeHelpVenueRevocationRequiresCurrentOwner(owner: bool, currentRevision: bool, now: int, expiresAt: int): bool =
  mayRevokeHomeHelpVenue(owner, currentRevision, now, expiresAt) implies (owner and currentRevision)
```
