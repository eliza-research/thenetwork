// GENERATED from spec/requestResultView.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Read the current outcome of a member request / The request feed distinguishes a booking from fulfillment (spec/requestResultView.md) */
export type RequestEventView = "RequestBooked" | "RequestFulfilled" | "RequestProbing" | "RequestWaiting" | "RequestOther";


/** Story: Read the current outcome of a member request / The request feed distinguishes a booking from fulfillment (spec/requestResultView.md) */
//@ pure
export function requestEventView(requestStatus: string): RequestEventView {
  return requestStatus === "booked" ? "RequestBooked" : (requestStatus === "fulfilled" ? "RequestFulfilled" : (requestStatus === "probing" ? "RequestProbing" : (requestStatus === "waiting" ? "RequestWaiting" : "RequestOther")));
}

/** Story: Read the current outcome of a member request / The request feed distinguishes a booking from fulfillment (spec/requestResultView.md) */
//@ pure
export function lawBookedRequestIsNotFulfilled(requestStatus: string): boolean {
  //@ ensures \result === true
  return !(requestStatus === "booked") || requestEventView(requestStatus) === "RequestBooked";
}
