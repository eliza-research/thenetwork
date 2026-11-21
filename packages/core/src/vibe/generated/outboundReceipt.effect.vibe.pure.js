// Generated from spec/outboundReceipt.md via Vibestack and VibeLang. Run pnpm run spec:sync.
import * as M from "./outboundReceipt.js";
/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md) @throws {never} */
export const initial = M.initial;
/** Every `always` rule at once. Holds initially and after every transition. @throws {never} */
export function inv(current) { return M.inv(current); }
/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md) @throws {never} */
export function receiptRank(phase) { return M.receiptRank(phase); }
/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md) @throws {never} */
export function recordAcceptance(outbound, providerPhase) { return M.recordAcceptance(outbound, providerPhase); }
/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md) @throws {never} */
export function applyReceipt(outbound, providerPhase) { return M.applyReceipt(outbound, providerPhase); }
/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md) @throws {never} */
export function canRecordAcceptance(outbound, providerPhase) { return M.canRecordAcceptance(outbound, providerPhase); }
/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md) @throws {never} */
export function stepReceiptsDoNotRegress(before, via, after) { return M.stepReceiptsDoNotRegress(before, via, after); }
/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md) @throws {never} */
export function canApplyReceipt(outbound, providerPhase) { return M.canApplyReceipt(outbound, providerPhase); }
/** Story: Know whether a queued message reached the provider / A provider receipt advances through acceptance, send, delivery, and read (spec/outboundReceipt.md) @throws {never} */
export function lawDeliveredIgnoresFailure(phase) { return M.lawDeliveredIgnoresFailure(phase); }
/** Story: Know whether a queued message reached the provider / An uncertain send waits for a receipt instead of sending again (spec/outboundReceipt.md) @throws {never} */
export function canHoldUnrecordedReceipt(outbound) { return M.canHoldUnrecordedReceipt(outbound); }
/** Story: Know whether a queued message reached the provider / An uncertain send waits for a receipt instead of sending again (spec/outboundReceipt.md) @throws {never} */
export function holdUnrecordedReceipt(outbound) { return M.holdUnrecordedReceipt(outbound); }
/** Story: Know whether a queued message reached the provider / An uncertain send waits for a receipt instead of sending again (spec/outboundReceipt.md) @throws {never} */
export function stepUnrecordedReceiptWaits(before, via, after) { return M.stepUnrecordedReceiptWaits(before, via, after); }
/** Story: Know whether a queued message reached the provider / An uncertain send waits for a receipt instead of sending again (spec/outboundReceipt.md) @throws {never} */
export function canConfirmNeverAdmitted(outbound, neverAdmitted) { return M.canConfirmNeverAdmitted(outbound, neverAdmitted); }
/** Story: Know whether a queued message reached the provider / An uncertain send waits for a receipt instead of sending again (spec/outboundReceipt.md) @throws {never} */
export function confirmNeverAdmitted(outbound, neverAdmitted) { return M.confirmNeverAdmitted(outbound, neverAdmitted); }
/** Story: Know whether a queued message reached the provider / An uncertain send waits for a receipt instead of sending again (spec/outboundReceipt.md) @throws {never} */
export function canExpireUnknown(outbound, pastLimit) { return M.canExpireUnknown(outbound, pastLimit); }
/** Story: Know whether a queued message reached the provider / An uncertain send waits for a receipt instead of sending again (spec/outboundReceipt.md) @throws {never} */
export function expireUnknown(outbound, pastLimit) { return M.expireUnknown(outbound, pastLimit); }
/** Story: Know whether a queued message reached the provider / An uncertain send waits for a receipt instead of sending again (spec/outboundReceipt.md) @throws {never} */
export function sometimesCanCheckUnknown(outbound) { return M.sometimesCanCheckUnknown(outbound); }
/** Story: Know whether a queued message reached the provider / An uncertain send waits for a receipt instead of sending again (spec/outboundReceipt.md) @throws {never} */
export function sometimesCanRead(outbound) { return M.sometimesCanRead(outbound); }
/** Story: Know whether a queued message reached the provider / A provider failure either waits or ends the send (spec/outboundReceipt.md) @throws {never} */
export function canRecordProviderError(outbound) { return M.canRecordProviderError(outbound); }
/** Story: Know whether a queued message reached the provider / A provider failure either waits or ends the send (spec/outboundReceipt.md) @throws {never} */
export function recordProviderError(outbound, failure, hasAttemptsLeft) { return M.recordProviderError(outbound, failure, hasAttemptsLeft); }
/** Story: Know whether a queued message reached the provider / A provider failure either waits or ends the send (spec/outboundReceipt.md) @throws {never} */
export function lawAnUnknownResultDoesNotRetry(hasAttemptsLeft) { return M.lawAnUnknownResultDoesNotRetry(hasAttemptsLeft); }
/** Story: Know whether a queued message reached the provider / A send that may have reached the person keeps its person-cap slot (spec/outboundReceipt.md) @throws {never} */
export function returnsPersonSlot(phase) { return M.returnsPersonSlot(phase); }
/** Story: Know whether a queued message reached the provider / A send that may have reached the person keeps its person-cap slot (spec/outboundReceipt.md) @throws {never} */
export function lawUncertainSendKeepsSlot(phase) { return M.lawUncertainSendKeepsSlot(phase); }
/** Story: Know whether a queued message reached the provider / An acceptance records a send time only for a send that went out (spec/outboundReceipt.md) @throws {never} */
export function acceptanceRecordsSend(phase) { return M.acceptanceRecordsSend(phase); }
/** Story: Know whether a queued message reached the provider / An acceptance records a send time only for a send that went out (spec/outboundReceipt.md) @throws {never} */
export function acceptanceEndsRow(phase, receiptOwner, member) { return M.acceptanceEndsRow(phase, receiptOwner, member); }
/** Story: Know whether a queued message reached the provider / An acceptance records a send time only for a send that went out (spec/outboundReceipt.md) @throws {never} */
export function lawFailedAcceptanceRecordsNoSend(phase) { return M.lawFailedAcceptanceRecordsNoSend(phase); }
/** Story: Know whether a queued message reached the provider / An acceptance records a send time only for a send that went out (spec/outboundReceipt.md) @throws {never} */
export function lawReceiptOwnerEndsNonMemberRow(phase) { return M.lawReceiptOwnerEndsNonMemberRow(phase); }
/** Story: Know whether a queued message reached the provider / A gateway reply with no final receipt ends after the receipt deadline (spec/outboundReceipt.md) @throws {never} */
export function gatewayReplyPhase(pastLimit) { return M.gatewayReplyPhase(pastLimit); }
/** Story: Know whether a queued message reached the provider / A gateway reply with no final receipt ends after the receipt deadline (spec/outboundReceipt.md) @throws {never} */
export function lawGatewayReplyEndsOnlyPastLimit(pastLimit) { return M.lawGatewayReplyEndsOnlyPastLimit(pastLimit); }
/** Story: Know whether a queued message reached the provider / A gateway reply with no final receipt ends after the receipt deadline (spec/outboundReceipt.md) @throws {never} */
export function lawExpiredGatewayReplyKeepsSlot(pastLimit) { return M.lawExpiredGatewayReplyKeepsSlot(pastLimit); }
/** Do the rules allow this event in this state? @throws {never} */
export function enabled(current, event) { return M.enabled(current, event); }
/** Apply an event. An event the rules do not allow leaves the state unchanged. @throws {never} */
export function step(current, event) { return M.step(current, event); }
/** Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program: the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy with exactly the fields the event has, so nothing the caller keeps can change it afterwards. @throws {never} */
export function parseEvent(x) { return M.parseEvent(x); }
/** Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The result is a fresh copy, so nothing the caller keeps can change it afterwards. @throws {never} */
export function parseState(x) { return M.parseState(x); }
/** A Machine never shares a state with its callers. @throws {never} */
export function snapshot_outboundReceipt(value) { return structuredClone(value); }
