# Share an official venue booking link

## Story: Find the venue’s booking page for my meeting

> As a booked participant, I want the venue’s official booking page so I can arrange admission myself if needed.

### Use only the current booked public venue

Only a confirmation for a scheduled, staff-reviewed opportunity can include a curated venue booking link. The recipient must be an accepted participant. Match the exact selected public venue ID, name and area to a current curated entry with an official booking page. Existing event listing links use the separate event catalog rule. A venue without a verified page still gets the ordinary confirmation.

The optional link appears once on its own final line. The member decides whether to book with the venue. The Network neither creates the reservation nor collects money. The curated Brooklyn Museum entry points to the [museum’s own ticketing calendar](https://secure.brooklynmuseum.org/).

```quint
pure def venueBookingLinkAllowed(reviewed: bool, scheduled: bool, consenting: bool, exactCuratedVenue: bool, upcoming: bool): bool =
  reviewed and scheduled and consenting and exactCuratedVenue and upcoming

pure def lawAnotherVenueCannotAuthorizeLink(reviewed: bool, scheduled: bool, consenting: bool, upcoming: bool): bool =
  not(venueBookingLinkAllowed(reviewed, scheduled, consenting, false, upcoming))
```

### Recheck the original confirmation before delivery

Use the same current venue entry and the exact message saved for this participant and opportunity. Confirm the scheduled booking is still at its original revision and that the message contains the current approved URL once on its final line. This authorization applies to that exact URL and leaves the normal checks for all other content in place. An old confirmation whose URL or booking changed cannot authorize delivery or replay.

```quint
pure def venueBookingLinkMayDeliver(bookingAllowed: bool, originalRevision: bool, exactMessage: bool, exactFinalLine: bool): bool =
  bookingAllowed and originalRevision and exactMessage and exactFinalLine

pure def lawChangedBookingCannotSendLink(bookingAllowed: bool, exactMessage: bool, exactFinalLine: bool): bool =
  not(venueBookingLinkMayDeliver(bookingAllowed, false, exactMessage, exactFinalLine))
```
