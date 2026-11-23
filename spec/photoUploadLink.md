# Photo upload link

[Story F31](product/stories.md#story-f31--add-my-adult-dating-photos-privately) lets an adult Slop member add photos privately. The signed gateway turn carries no attachments, and the sites have no account pages, so the Network gives the member one app-bound upload link by text. The member asks for it ("ADD PHOTOS") or gets it after they agree to the photo consent ("YES PHOTOS"). This machine directs one link. The shell owns the random token and its keyed hash, the link row, the member, ban, hold and adult lookups, the consent record, and the upload through the [photo upload and retention](photoRetention.md) machine, which checks each image again. The [photo flow model](models/photos_rating.md) covers storage and rating.

## Story: Add my photos with a private one-time link

> As an adult Slop member who talks to the Network by text, I want a private link that lets me add my photos once, so my photos never pass through a conversation.

### A link is issued only to an adult live member of a photo app who is not banned or held

The shell checks the holder before it stores a link. The app must take photos, the person must be an adult on the app's own rule, the person and their phones must not be banned, no staff hold may cover the person on the app, and the membership must be live. The link opens for fifteen minutes from issue. A refused issue stores nothing. A person gets at most six links in a day, counted over the links issued in the last 24 hours.

```quint
type UploadLinkPhase = UploadLinkNone | UploadLinkOpen | UploadLinkSpent | UploadLinkRefused
type PhotoUploadLink = { phase: UploadLinkPhase, issuedAt: int, expiresAt: int }
type UploadLinkHolder = { takesPhotos: bool, adult: bool, banned: bool, held: bool, liveMember: bool }

pure val photoUploadLinkTtlMs: int = 900000
pure val initial: PhotoUploadLink = { phase: UploadLinkNone, issuedAt: 0, expiresAt: 0 }

pure val allowedUploadHolder: UploadLinkHolder = { takesPhotos: true, adult: true, banned: false, held: false, liveMember: true }
pure val holderValues = Set(allowedUploadHolder,
  { ...allowedUploadHolder, takesPhotos: false }, { ...allowedUploadHolder, adult: false },
  { ...allowedUploadHolder, banned: true }, { ...allowedUploadHolder, held: true }, { ...allowedUploadHolder, liveMember: false })
pure val atValues = Set(0, photoUploadLinkTtlMs - 1, photoUploadLinkTtlMs, photoUploadLinkTtlMs + 1)

pure def uploadLinkHolderAllowed(holder: UploadLinkHolder): bool =
  holder.takesPhotos and holder.adult and not(holder.banned) and not(holder.held) and holder.liveMember

pure val photoUploadLinksPerDay: int = 6
pure def uploadLinkDailyLimitReached(issuedToday: int): bool = issuedToday >= photoUploadLinksPerDay

pure def canIssueUploadLink(link: PhotoUploadLink): bool = link.phase == UploadLinkNone
pure def issueUploadLink(link: PhotoUploadLink, holder: UploadLinkHolder, at: int): PhotoUploadLink =
  if (uploadLinkHolderAllowed(holder)) { phase: UploadLinkOpen, issuedAt: at, expiresAt: at + photoUploadLinkTtlMs }
  else { ...link, phase: UploadLinkRefused }

pure def alwaysIssuedLinkLastsFifteenMinutes(link: PhotoUploadLink): bool =
  (link.phase == UploadLinkOpen or link.phase == UploadLinkSpent) implies link.expiresAt == link.issuedAt + photoUploadLinkTtlMs

pure def lawMinorGetsNoLink(holder: UploadLinkHolder, at: int): bool =
  not(holder.adult) implies issueUploadLink(initial, holder, at).phase == UploadLinkRefused

pure def sometimesLinkOpen(link: PhotoUploadLink): bool = link.phase == UploadLinkOpen
pure def sometimesLinkRefused(link: PhotoUploadLink): bool = link.phase == UploadLinkRefused
```

### A link uploads once, before it expires, on its own app, for a holder who is still eligible

Every use of an open link closes it. The use uploads only when the request reaches the link's own app before the expiry and the holder passes the same checks again at use. Any other use closes the link with nothing stored, so a member asks for a new link. The shell rejects a request from a still eligible holder without the current photo consent, or with an empty or oversized batch, before it uses the link; a holder who is no longer eligible closes the link even without the consent. Changed: before, a member who left the app (which clears the consent) got a consent error and kept an open link. A consent sent with the batch is recorded on the membership before storage.

```quint
pure def uploadLinkUsable(link: PhotoUploadLink, holder: UploadLinkHolder, sameApp: bool, at: int): bool =
  link.phase == UploadLinkOpen and at < link.expiresAt and sameApp and uploadLinkHolderAllowed(holder)

pure def canRedeemUploadLink(link: PhotoUploadLink): bool = link.phase == UploadLinkOpen
pure def redeemUploadLink(link: PhotoUploadLink, holder: UploadLinkHolder, sameApp: bool, at: int): PhotoUploadLink =
  { ...link, phase: if (uploadLinkUsable(link, holder, sameApp, at)) UploadLinkSpent else UploadLinkRefused }

pure def stepClosedLinkStaysClosed(before: PhotoUploadLink, after: PhotoUploadLink): bool =
  (before.phase == UploadLinkSpent or before.phase == UploadLinkRefused) implies after.phase == before.phase

pure def lawExpiredLinkNeverUploads(holder: UploadLinkHolder, sameApp: bool, at: int): bool =
  val link = issueUploadLink(initial, holder, at)
  redeemUploadLink(link, holder, sameApp, at + photoUploadLinkTtlMs).phase != UploadLinkSpent

pure def lawMinorNeverUploads(link: PhotoUploadLink, holder: UploadLinkHolder, sameApp: bool, at: int): bool =
  not(holder.adult) implies not(uploadLinkUsable(link, holder, sameApp, at))

pure def sometimesLinkSpent(link: PhotoUploadLink): bool = link.phase == UploadLinkSpent
```

### A status check says whether a link can still upload, and does not use it

The link page asks before the member chooses photos. The check reads the link row and the holder with the same decision that a use applies, `uploadLinkUsable`, on the app of the request, and it writes nothing, so the link stays open. An open link answers with whether the upload must carry the photo consent, and with the current consent version and text, so the page shows the exact words that the member agrees to. A malformed token gets status 404. An unknown, used or expired link, a link of another app and a holder who is no longer eligible all get status 410. Both answers have the same body, `link_unavailable`, which names no person, and a use of the link gives the same two statuses. Changed on 2026-11-22 (owner decision, one-purpose pages): before, the page could only learn that a link was closed by using it, and it had no source for the consent text.

```quint
pure val sameAppValues = Set(true, false)

pure def lawOpenStatusMeansTheUseUploads(holder: UploadLinkHolder, sameApp: bool, at: int): bool =
  val link = issueUploadLink(initial, holder, at)
  uploadLinkUsable(link, holder, sameApp, at) implies redeemUploadLink(link, holder, sameApp, at).phase == UploadLinkSpent

pure def lawClosedStatusMeansTheUseStoresNothing(holder: UploadLinkHolder, sameApp: bool, at: int): bool =
  val link = issueUploadLink(initial, holder, at)
  not(uploadLinkUsable(link, holder, sameApp, at)) implies redeemUploadLink(link, holder, sameApp, at).phase != UploadLinkSpent
```

### One link use carries one to four photos of at most four MiB each and eight MiB in all

A batch has the size that one private rating reads, so every photo in it can be rated. The whole batch is at most the size of one normal upload, eight MiB, so it fits under the nine MiB body that the site router and the backend's public port read. Each photo then goes through the normal upload checks. Changed: the eight MiB total is new; before, four photos of four MiB each were promised and the edge refused any batch over nine MiB before the backend saw it.

```quint
import photoPolicy as Policy from "./photoPolicy"

pure def uploadLinkBatchAllowed(count: int, largestBytes: int, totalBytes: int): bool =
  count >= 1 and count <= Policy::ratingMaxPhotos and largestBytes >= 1 and largestBytes <= Policy::ratingMaxBytes
    and totalBytes >= largestBytes and totalBytes <= Policy::uploadMaxBytes
```
