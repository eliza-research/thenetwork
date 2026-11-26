// Generated from spec/publicEventCatalog.md via Vibestack and VibeLang. Run pnpm run spec:sync.
/** Story: Find a current public event / Use only an upcoming event from the allowed in-person supply (spec/publicEventCatalog.md) */
export declare const publicEventHorizonDays: number;
/** Story: Find a current public event / A successful complete scan replaces the previous source and expires if refresh stops (spec/publicEventCatalog.md) */
export declare const publicEventFreshDays: number;
/** Story: Find a current public event / A successful complete scan replaces the previous source and expires if refresh stops (spec/publicEventCatalog.md) */
export declare const publicEventScanMaxBytes: number;
/** Story: Find a current public event / A successful complete scan replaces the previous source and expires if refresh stops (spec/publicEventCatalog.md) */
export declare const publicEventScanRowLimit: number;
/** Story: Keep the deployed catalog current / The backend scans once a day, at most one process at a time, and waits after a failed attempt (spec/publicEventCatalog.md) */
export declare const publicEventRefreshMs: number;
/** Story: Keep the deployed catalog current / The backend scans once a day, at most one process at a time, and waits after a failed attempt (spec/publicEventCatalog.md) */
export declare const publicEventRetryMs: number;
/** Story: Find a current public event / Use only an upcoming event from the allowed in-person supply (spec/publicEventCatalog.md) */
export declare function publicEventWindowUsable(asOf: number, startsAt: number, endsAt: number): boolean;
/** Story: Find a current public event / Use only an upcoming event from the allowed in-person supply (spec/publicEventCatalog.md) */
export declare function publicEventAllowed(officialLink: boolean, publicPlace: boolean, online: boolean, youth: boolean, asOf: number, startsAt: number, endsAt: number): boolean;
/** Story: Find a current public event / A successful complete scan replaces the previous source and expires if refresh stops (spec/publicEventCatalog.md) */
export declare function publicEventScanResponseAllowed(responseStatus: number, rangeMarked: boolean, redirected: boolean): boolean;
/** Story: Find a current public event / A successful complete scan replaces the previous source and expires if refresh stops (spec/publicEventCatalog.md) */
export declare function publicEventScanComplete(bytesRead: number, rowsRead: number, allRowsRecognizable: boolean): boolean;
/** Story: Find a current public event / A successful complete scan replaces the previous source and expires if refresh stops (spec/publicEventCatalog.md) */
export declare function lawPartialEventScanCannotPublish(redirected: boolean): boolean;
/** Story: Find a current public event / A successful complete scan replaces the previous source and expires if refresh stops (spec/publicEventCatalog.md) */
export declare function publicEventPublicationNewer(seen: boolean, checkedAt: number, incomingAt: number): boolean;
/** Story: Find a current public event / A successful complete scan replaces the previous source and expires if refresh stops (spec/publicEventCatalog.md) */
export declare function publicEventCatalogFresh(checkedAt: number, asOf: number): boolean;
/** Story: Find a current public event / A successful complete scan replaces the previous source and expires if refresh stops (spec/publicEventCatalog.md) */
export declare function lawCatalogExpiresAtLimit(checkedAt: number): boolean;
/** Story: Find a current public event / A source id identifies a single normalized listing in each scan (spec/publicEventCatalog.md) */
export declare function publicEventDuplicateAllowed(previousPresent: boolean, sameListing: boolean): boolean;
/** Story: Find a current public event / A source id identifies a single normalized listing in each scan (spec/publicEventCatalog.md) */
export declare function lawConflictingPublicEventRowsCannotPublish(sameListing: boolean): boolean;
/** Story: Find a current public event / A contact or booking uses the same current listing that entered review (spec/publicEventCatalog.md) */
export declare function publicEventRevisionMatches(bound: string, available: string): boolean;
/** Story: Find a current public event / A contact or booking uses the same current listing that entered review (spec/publicEventCatalog.md) */
export declare function publicEventMemberAllowsMatch(adult: boolean, minimumAgeMet: boolean, categoryAllowed: boolean, eventFormatAllowed: boolean): boolean;
/** Story: Find a current public event / A contact or booking uses the same current listing that entered review (spec/publicEventCatalog.md) */
export declare function lawEventMinimumAgeAppliesToAdults(categoryAllowed: boolean, eventFormatAllowed: boolean): boolean;
/** Story: Find a current public event / A queued event contact still needs the reviewed listing at final claim (spec/publicEventCatalog.md) */
export declare function publicEventClaimAllowed(sameListing: boolean, exactContact: boolean, participantsEligible: boolean): boolean;
/** Story: Find a current public event / A queued event contact still needs the reviewed listing at final claim (spec/publicEventCatalog.md) */
export declare function lawMovedPublicEventCannotAuthorizeClaim(exactContact: boolean, participantsEligible: boolean): boolean;
/** Story: Find a current public event / A closed event opportunity without contact does not use a matching slot (spec/publicEventCatalog.md) */
export declare function closedPublicEventIsUnsent(bound: boolean, closed: boolean, contacted: boolean): boolean;
/** Story: Find a current public event / The send guard allows the exact official link in a booked confirmation (spec/publicEventCatalog.md) */
export declare function publicBookedEventLinkAllowed(booked: boolean, consenting: boolean, exactFinalLine: boolean): boolean;
/** Story: Keep the deployed catalog current / The backend scans once a day, at most one process at a time, and waits after a failed attempt (spec/publicEventCatalog.md) */
export declare function publicEventRefreshDue(published: boolean, checkedAt: number, attempted: boolean, attemptedAt: number, asOf: number): boolean;
/** Story: Keep the deployed catalog current / The backend scans once a day, at most one process at a time, and waits after a failed attempt (spec/publicEventCatalog.md) */
export declare function lawRefreshDueBeforeCatalogExpires(checkedAt: number): boolean;
/** Story: Keep the deployed catalog current / The backend scans once a day, at most one process at a time, and waits after a failed attempt (spec/publicEventCatalog.md) */
export declare function lawRecentAttemptWaits(published: boolean, checkedAt: number, attemptedAt: number): boolean;
/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export declare function exact_publicEventCatalog(n: number): number;
