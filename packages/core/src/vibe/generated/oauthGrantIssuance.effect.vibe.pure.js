// Generated from spec/oauthGrantIssuance.md via Vibestack and VibeLang. Run pnpm run spec:sync.
import * as M from "./oauthGrantIssuance.js";
/** Story: Connect my agent after I approve access / Locked approval must still match the owner and both deadlines (spec/oauthGrantIssuance.md:47) @throws {never} */
export const eligibleApproval = M.eligibleApproval;
/** Story: Connect my agent after I approve access / An expired request cannot begin issuance (spec/oauthGrantIssuance.md:9) @throws {never} */
export const initial = M.initial;
/** Every `always` rule at once. Holds initially and after every transition. @throws {never} */
export function inv(current) { return M.inv(current); }
/** Story: Connect my agent after I approve access / An expired request cannot begin issuance (spec/oauthGrantIssuance.md:9) @throws {never} */
export function requestIsLive(asOf, expiresAt) { return M.requestIsLive(asOf, expiresAt); }
/** Story: Connect my agent after I approve access / An expired request cannot begin issuance (spec/oauthGrantIssuance.md:9) @throws {never} */
export function canBeginApproval(issuance) { return M.canBeginApproval(issuance); }
/** Story: Connect my agent after I approve access / An expired request cannot begin issuance (spec/oauthGrantIssuance.md:9) @throws {never} */
export function beginApproval(issuance, requestLive) { return M.beginApproval(issuance, requestLive); }
/** Story: Connect my agent after I approve access / An expired request cannot begin issuance (spec/oauthGrantIssuance.md:9) @throws {never} */
export function lawDeadlineExcludesExpiry(expiresAt) { return M.lawDeadlineExcludesExpiry(expiresAt); }
/** Story: Connect my agent after I approve access / Authority is checked before the consent request is locked (spec/oauthGrantIssuance.md:32) @throws {never} */
export function canCheckGrantAuthority(issuance) { return M.canCheckGrantAuthority(issuance); }
/** Story: Connect my agent after I approve access / Authority is checked before the consent request is locked (spec/oauthGrantIssuance.md:32) @throws {never} */
export function checkGrantAuthority(issuance, authority) { return M.checkGrantAuthority(issuance, authority); }
/** Story: Connect my agent after I approve access / Locked approval must still match the owner and both deadlines (spec/oauthGrantIssuance.md:47) @throws {never} */
export function canCheckLockedApproval(issuance) { return M.canCheckLockedApproval(issuance); }
/** Story: Connect my agent after I approve access / Locked approval must still match the owner and both deadlines (spec/oauthGrantIssuance.md:47) @throws {never} */
export function checkLockedApproval(issuance, approval) { return M.checkLockedApproval(issuance, approval); }
/** Story: Connect my agent after I approve access / A successful response follows one atomic commit (spec/oauthGrantIssuance.md:68) @throws {never} */
export function canRecordCommit(issuance, committed) { return M.canRecordCommit(issuance, committed); }
/** Story: Connect my agent after I approve access / A successful response follows one atomic commit (spec/oauthGrantIssuance.md:68) @throws {never} */
export function recordCommit(issuance, committed) { return M.recordCommit(issuance, committed); }
/** Story: Connect my agent after I approve access / A successful response follows one atomic commit (spec/oauthGrantIssuance.md:68) @throws {never} */
export function canRecordStorageFailure(issuance) { return M.canRecordStorageFailure(issuance); }
/** Story: Connect my agent after I approve access / A successful response follows one atomic commit (spec/oauthGrantIssuance.md:68) @throws {never} */
export function recordStorageFailure(issuance) { return M.recordStorageFailure(issuance); }
/** Story: Connect my agent after I approve access / A successful response follows one atomic commit (spec/oauthGrantIssuance.md:68) @throws {never} */
export function stepIssuanceFollowsCommit(before, via, after) { return M.stepIssuanceFollowsCommit(before, via, after); }
/** Story: Connect my agent after I approve access / A successful response follows one atomic commit (spec/oauthGrantIssuance.md:68) @throws {never} */
export function sometimesRetriesIssuance(issuance) { return M.sometimesRetriesIssuance(issuance); }
/** Story: Connect my agent after I approve access / An issued grant had current authority, owner and deadlines (spec/oauthGrantIssuance.md:91) @throws {never} */
export function alwaysIssuanceRequiresCurrentApproval(issuance) { return M.alwaysIssuanceRequiresCurrentApproval(issuance); }
/** Story: Connect my agent after I approve access / An issued grant had current authority, owner and deadlines (spec/oauthGrantIssuance.md:91) @throws {never} */
export function sometimesIssuesGrant(issuance) { return M.sometimesIssuesGrant(issuance); }
/** Story: Connect my agent after I approve access / An issued grant had current authority, owner and deadlines (spec/oauthGrantIssuance.md:91) @throws {never} */
export function sometimesRetriesAuthority(issuance) { return M.sometimesRetriesAuthority(issuance); }
/** Story: Connect my agent after I approve access / An issued grant had current authority, owner and deadlines (spec/oauthGrantIssuance.md:91) @throws {never} */
export function sometimesDeniesAuthority(issuance) { return M.sometimesDeniesAuthority(issuance); }
/** Story: Connect my agent after I approve access / An issued grant had current authority, owner and deadlines (spec/oauthGrantIssuance.md:91) @throws {never} */
export function sometimesExpiresApproval(issuance) { return M.sometimesExpiresApproval(issuance); }
/** Do the rules allow this event in this state? @throws {never} */
export function enabled(current, event) { return M.enabled(current, event); }
/** Apply an event. An event the rules do not allow leaves the state unchanged. @throws {never} */
export function step(current, event) { return M.step(current, event); }
/** Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program: the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy with exactly the fields the event has, so nothing the caller keeps can change it afterwards. @throws {never} */
export function parseEvent(x) { return M.parseEvent(x); }
/** Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The result is a fresh copy, so nothing the caller keeps can change it afterwards. @throws {never} */
export function parseState(x) { return M.parseState(x); }
/** A Machine never shares its held state with callers. @throws {never} */
export function snapshot_oauthGrantIssuance(value) { return structuredClone(value); }
