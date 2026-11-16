// Generated from spec/turnReceipt.md via Vibestack and VibeLang. Run pnpm run spec:sync.
import * as M from "./turnReceipt.js";
/** Story: Record the gateway's delivery result once / A receipt belongs to a completed handled turn under current authority (spec/turnReceipt.md:9) @throws {never} */
export const initial = M.initial;
/** Every `always` rule at once. Holds initially and after every transition. @throws {never} */
export function inv(current) { return M.inv(current); }
/** Story: Record the gateway's delivery result once / A receipt belongs to a completed handled turn under current authority (spec/turnReceipt.md:9) @throws {never} */
export function checkTurn(receipt, handled) { return M.checkTurn(receipt, handled); }
/** Story: Record the gateway's delivery result once / A receipt belongs to a completed handled turn under current authority (spec/turnReceipt.md:9) @throws {never} */
export function canCheckAuthority(receipt) { return M.canCheckAuthority(receipt); }
/** Story: Record the gateway's delivery result once / A receipt belongs to a completed handled turn under current authority (spec/turnReceipt.md:9) @throws {never} */
export function checkAuthority(receipt, validAuthority) { return M.checkAuthority(receipt, validAuthority); }
/** Story: Record the gateway's delivery result once / A receipt belongs to a completed handled turn under current authority (spec/turnReceipt.md:9) @throws {never} */
export function canReadPrevious(receipt) { return M.canReadPrevious(receipt); }
/** Story: Record the gateway's delivery result once / A receipt belongs to a completed handled turn under current authority (spec/turnReceipt.md:9) @throws {never} */
export function readPrevious(receipt, identical, alreadyStored, previouslyUnknown, finalDelivery) { return M.readPrevious(receipt, identical, alreadyStored, previouslyUnknown, finalDelivery); }
/** Story: Record the gateway's delivery result once / A receipt belongs to a completed handled turn under current authority (spec/turnReceipt.md:9) @throws {never} */
export function canCheckTurn(receipt) { return M.canCheckTurn(receipt); }
/** Story: Record the gateway's delivery result once / A receipt names exactly the replies the turn collected (spec/turnReceipt.md:35) @throws {never} */
export function receiptReplyIdsMatch(loadedIds, submittedIds) { return M.receiptReplyIdsMatch(loadedIds, submittedIds); }
/** Story: Record the gateway's delivery result once / A receipt names exactly the replies the turn collected (spec/turnReceipt.md:35) @throws {never} */
export function noHistoryAllowed(accountFree, replyKind, reason, memberAbsent, knownApp) { return M.noHistoryAllowed(accountFree, replyKind, reason, memberAbsent, knownApp); }
/** Story: Record the gateway's delivery result once / A receipt names exactly the replies the turn collected (spec/turnReceipt.md:35) @throws {never} */
export function canCheckScope(receipt) { return M.canCheckScope(receipt); }
/** Story: Record the gateway's delivery result once / A receipt names exactly the replies the turn collected (spec/turnReceipt.md:35) @throws {never} */
export function checkScope(receipt, collectedReplies, orderedIdsMatch, providerIds, history) { return M.checkScope(receipt, collectedReplies, orderedIdsMatch, providerIds, history); }
/** Story: Record the gateway's delivery result once / A receipt names exactly the replies the turn collected (spec/turnReceipt.md:35) @throws {never} */
export function canCheckDelivery(receipt) { return M.canCheckDelivery(receipt); }
/** Story: Record the gateway's delivery result once / A receipt names exactly the replies the turn collected (spec/turnReceipt.md:35) @throws {never} */
export function checkDelivery(receipt, accepted, providerIds, history, accountFree) { return M.checkDelivery(receipt, accepted, providerIds, history, accountFree); }
/** Story: Record the gateway's delivery result once / A receipt names exactly the replies the turn collected (spec/turnReceipt.md:35) @throws {never} */
export function lawReceiptRequiresExactOrder(firstId, secondId) { return M.lawReceiptRequiresExactOrder(firstId, secondId); }
/** Story: Record the gateway's delivery result once / A receipt names exactly the replies the turn collected (spec/turnReceipt.md:35) @throws {never} */
export function lawAccountBoundReceiptNeedsHistory(replyKind, reason, memberAbsent, knownApp) { return M.lawAccountBoundReceiptNeedsHistory(replyKind, reason, memberAbsent, knownApp); }
/** Story: Record the gateway's delivery result once / Update the turn and the reply history together (spec/turnReceipt.md:63) @throws {never} */
export function receiptAccepted(delivery) { return M.receiptAccepted(delivery); }
/** Story: Record the gateway's delivery result once / Update the turn and the reply history together (spec/turnReceipt.md:63) @throws {never} */
export function canRecordReceipt(receipt) { return M.canRecordReceipt(receipt); }
/** Story: Record the gateway's delivery result once / Update the turn and the reply history together (spec/turnReceipt.md:63) @throws {never} */
export function recordReceipt(receipt) { return M.recordReceipt(receipt); }
/** Story: Record the gateway's delivery result once / Update the turn and the reply history together (spec/turnReceipt.md:63) @throws {never} */
export function receiptFinal(delivery) { return M.receiptFinal(delivery); }
/** Story: Record the gateway's delivery result once / Update the turn and the reply history together (spec/turnReceipt.md:63) @throws {never} */
export function receiptMessageStatus(delivery) { return M.receiptMessageStatus(delivery); }
/** Story: Record the gateway's delivery result once / Update the turn and the reply history together (spec/turnReceipt.md:63) @throws {never} */
export function sometimesCanStoreReceipt(receipt) { return M.sometimesCanStoreReceipt(receipt); }
/** Story: Record the gateway's delivery result once / Update the turn and the reply history together (spec/turnReceipt.md:63) @throws {never} */
export function sometimesCanReplayReceipt(receipt) { return M.sometimesCanReplayReceipt(receipt); }
/** Story: Record the gateway's delivery result once / Update the turn and the reply history together (spec/turnReceipt.md:63) @throws {never} */
export function stepReceiptNeedsAdmission(before, via, after) { return M.stepReceiptNeedsAdmission(before, via, after); }
/** Do the rules allow this event in this state? @throws {never} */
export function enabled(current, event) { return M.enabled(current, event); }
/** Apply an event. An event the rules do not allow leaves the state unchanged. @throws {never} */
export function step(current, event) { return M.step(current, event); }
/** Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program: the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy with exactly the fields the event has, so nothing the caller keeps can change it afterwards. @throws {never} */
export function parseEvent(x) { return M.parseEvent(x); }
/** Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The result is a fresh copy, so nothing the caller keeps can change it afterwards. @throws {never} */
export function parseState(x) { return M.parseState(x); }
/** A Machine never shares its held state with callers. @throws {never} */
export function snapshot_turnReceipt(value) { return structuredClone(value); }
