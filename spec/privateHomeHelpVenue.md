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
