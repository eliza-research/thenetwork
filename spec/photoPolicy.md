# Photo intake and rating

The [photo flow model](models/photos_rating.md) covers storage, asynchronous rating, deletion, and the authority checks around each effect.

## Story: Let slop use my photos for private matching

> As an adult slop.date member, I want the service to keep my own photos private and use a bounded set for matching.

### The rater requires an adult age without a failed age check

The shared age policy supplies the adult eligibility result. A known failed age check excludes the subject. The production platform also requires a live membership, consent where applicable, and no ban.

```quint
pure def photoSubjectAllowed(adult: bool, ageCheckFailed: bool): bool =
  adult and not(ageCheckFailed)

pure def lawRatingRequiresAdult(ageCheckFailed: bool): bool =
  not(photoSubjectAllowed(false, ageCheckFailed))
```

### Photo intake and rating have separate limits

Slop accepts up to six stored photos per person, at most eight MiB per upload. A rating uses up to four photos at most four MiB each. The text attachment handler also reads at most four photos in one message.

```quint
pure val uploadMaxBytes: int = 8388608
pure val uploadMaxPerPerson: int = 6
pure val ratingMaxPhotos: int = 4
pure val ratingMaxBytes: int = 4194304
pure val photoMaxPerMessage: int = 4

pure def photoSlotsFull(storedCount: int): bool =
  storedCount >= uploadMaxPerPerson
```
