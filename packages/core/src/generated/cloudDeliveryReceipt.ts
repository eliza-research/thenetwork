// GENERATED from spec/cloudDeliveryReceipt.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny



/** Story: Recover a delivery through the canonical Cloud transport / Transient refusal has a different response from unknown acceptance (spec/cloudDeliveryReceipt.md) */
//@ pure
export function cloudDispatchMayRetry(receiptLookup: boolean, failed: boolean, retryable: boolean, status: number, code: string): boolean {
  return !receiptLookup && failed && retryable && ((status === 503 && code === "unavailable") || (status === 423 && code === "delivery_pending") || (status === 422 && code === "rejected"));
}

/** Story: Recover a delivery through the canonical Cloud transport / Transient refusal has a different response from unknown acceptance (spec/cloudDeliveryReceipt.md) */
//@ pure
export function cloudLookupConfirmsAbsence(receiptLookup: boolean, failed: boolean, retryable: boolean, status: number, code: string): boolean {
  return receiptLookup && failed && retryable && status === 422 && code === "rejected";
}

/** Story: Recover a delivery through the canonical Cloud transport / Transient refusal has a different response from unknown acceptance (spec/cloudDeliveryReceipt.md) */
//@ pure
export function lawCloudTemporaryLookupDoesNotProveAbsence(failed: boolean, retryable: boolean, status: number): boolean {
  //@ ensures \result === true
  return !cloudLookupConfirmsAbsence(true, failed, retryable, status, "unavailable");
}

/** Story: Recover a delivery through the canonical Cloud transport / Transient refusal has a different response from unknown acceptance (spec/cloudDeliveryReceipt.md) */
//@ pure
export function lawCloudLookupNeverUsesDispatchRetry(failed: boolean, retryable: boolean, status: number, code: string): boolean {
  //@ ensures \result === true
  return !cloudDispatchMayRetry(true, failed, retryable, status, code);
}

/** Story: Recover a delivery through the canonical Cloud transport / The queued adapter requires a current canonical receipt (spec/cloudDeliveryReceipt.md) */
//@ pure
export function cloudReceiptTimeAllowed(queueCreatedAt: number, observedAt: number, tolerance: number, hasTime: boolean, canonicalTime: boolean, acceptedAt: number): boolean {
  return 0 <= queueCreatedAt && 0 <= observedAt && 0 <= tolerance && queueCreatedAt <= exact_cloudDeliveryReceipt(observedAt + tolerance) && (!hasTime || (canonicalTime && exact_cloudDeliveryReceipt(queueCreatedAt - tolerance) <= acceptedAt && acceptedAt <= exact_cloudDeliveryReceipt(observedAt + tolerance)));
}

/** Story: Recover a delivery through the canonical Cloud transport / The queued adapter requires a current canonical receipt (spec/cloudDeliveryReceipt.md) */
//@ pure
export function cloudDeliveryReceiptAllowed(status: number, accepted: boolean, hasHistory: boolean, hasIds: boolean, hasReplayFlag: boolean, validTime: boolean): boolean {
  return status === 200 && accepted && hasHistory && hasIds && hasReplayFlag && validTime;
}

/** Story: Recover a delivery through the canonical Cloud transport / The queued adapter requires a current canonical receipt (spec/cloudDeliveryReceipt.md) */
//@ pure
export function lawCloudQueuedReceiptNeedsHistory(status: number, accepted: boolean, hasIds: boolean, hasReplayFlag: boolean, validTime: boolean): boolean {
  //@ ensures \result === true
  return !cloudDeliveryReceiptAllowed(status, accepted, false, hasIds, hasReplayFlag, validTime);
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_cloudDeliveryReceipt(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
