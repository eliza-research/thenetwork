// GENERATED from spec/venueBookingLink.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny



/** Story: Find the venue’s booking page for my meeting / Use only the current booked public venue (spec/venueBookingLink.md) */
//@ pure
export function venueBookingLinkAllowed(reviewed: boolean, scheduled: boolean, consenting: boolean, exactCuratedVenue: boolean, upcoming: boolean): boolean {
  return reviewed && scheduled && consenting && exactCuratedVenue && upcoming;
}

/** Story: Find the venue’s booking page for my meeting / Use only the current booked public venue (spec/venueBookingLink.md) */
//@ pure
export function lawAnotherVenueCannotAuthorizeLink(reviewed: boolean, scheduled: boolean, consenting: boolean, upcoming: boolean): boolean {
  //@ ensures \result === true
  return !venueBookingLinkAllowed(reviewed, scheduled, consenting, false, upcoming);
}

/** Story: Find the venue’s booking page for my meeting / Recheck the original confirmation before delivery (spec/venueBookingLink.md) */
//@ pure
export function venueBookingLinkMayDeliver(bookingAllowed: boolean, originalRevision: boolean, exactMessage: boolean, exactFinalLine: boolean): boolean {
  return bookingAllowed && originalRevision && exactMessage && exactFinalLine;
}

/** Story: Find the venue’s booking page for my meeting / Recheck the original confirmation before delivery (spec/venueBookingLink.md) */
//@ pure
export function lawChangedBookingCannotSendLink(bookingAllowed: boolean, exactMessage: boolean, exactFinalLine: boolean): boolean {
  //@ ensures \result === true
  return !venueBookingLinkMayDeliver(bookingAllowed, false, exactMessage, exactFinalLine);
}
