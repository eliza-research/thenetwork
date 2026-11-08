// The Join flow's decisions: which step comes next, who owns the form fields, and which form may be
// sent. Import-free, proved by LemmaScript (docs/formal-verification.md). join.ts and auth.ts do the
// DOM and the requests. They ask flowNext for each step and formProblems for each submit.
// The proofs model `number` as an integer, so the shell passes wholeAge for a fraction or NaN.

export type FlowStep = "loading" | "invite" | "phone" | "code" | "profile" | "member" | "blocked" | "done";

/** The form values that an owner can lose. */
export interface JoinFields { firstName: string; age: string; ticked: boolean }

export interface Flow {
  step: FlowStep;
  /** The number that otp/verify uses. */
  phone: string;
  /** The number that the code step shows. */
  shown: string;
  /** The account of the session. "" when there is no session. */
  account: string;
  fields: JoinFields;
  /** The account that the fields belong to. "" for a prefill from the link: no account owns it. */
  owner: string;
  consented: boolean;
  /** The message key of the page-level error. "" when there is none. */
  notice: string;
}

export type FlowEvent =
  | { tag: "loaded"; signedInAs: string; canJoin: boolean; member: boolean; inviteOnly: boolean; notice: string }
  | { tag: "typed"; fields: JoinFields }
  | { tag: "otpStarted"; number: string }
  | { tag: "changeNumber" }
  | { tag: "verified"; canJoin: boolean; member: boolean }
  | { tag: "rerouted"; account: string; canJoin: boolean; member: boolean; notice: string }
  | { tag: "sessionEnded"; notice: string }
  | { tag: "refused" }
  | { tag: "joined" };

export const NO_FIELDS: JoinFields = { firstName: "", age: "", ticked: false };

/** The form as the shell reads it: trimmed strings, and age after Number(). */
export interface JoinForm { firstName: string; age: number; wholeAge: boolean; zip: string; ticked: boolean }

export interface FormProblems { name: boolean; age: boolean; zip: boolean; consent: boolean }

/** The longest first name that parseJoin (platform/src/accounts.ts) takes. */
export const MAX_FIRST_NAME = 50;

function isEmpty(f: JoinFields): boolean {
  //@ verify
  return f.firstName === "" && f.age === "" && !f.ticked;
}

/** The safety rules of the flow. Each event keeps them. */
function flowOk(s: Flow): boolean {
  //@ verify
  return (s.step !== "code" || (s.phone.length > 0 && s.shown === s.phone))
    // A step that asks for a number or a code holds only with no session.
    && ((s.step !== "loading" && s.step !== "invite" && s.step !== "phone" && s.step !== "code") || s.account === "")
    && ((s.step !== "profile" && s.step !== "member") || s.account !== "")
    && (s.step !== "done" || (s.account !== "" && s.consented && s.fields.ticked && s.notice === ""))
    // A signed-in form never holds the fields of another account.
    && (s.account === "" || s.owner === s.account || isEmpty(s.fields));
}

export function initialFlow(fields: JoinFields): Flow {
  //@ verify
  //@ ensures flowOk(\result)
  return { step: "loading", phone: "", shown: "", account: "", fields, owner: "", consented: false, notice: "" };
}

function afterAuth(canJoin: boolean, member: boolean): FlowStep {
  //@ verify
  if (canJoin) return "profile";
  return member ? "member" : "blocked";
}

/** Keep fields that no other account owns. Clear the rest. */
function fieldsFor(fields: JoinFields, owner: string, account: string): JoinFields {
  //@ verify
  return owner === "" || owner === account ? fields : NO_FIELDS;
}

function signIn(s: Flow, account: string, canJoin: boolean, member: boolean, notice: string): Flow {
  //@ verify
  return { ...s, account, owner: account, fields: fieldsFor(s.fields, s.owner, account), step: afterAuth(canJoin, member), consented: false, notice };
}

export function flowNext(s: Flow, e: FlowEvent): Flow {
  //@ verify
  //@ ensures flowOk(s) ==> flowOk(\result)
  //@ ensures s.step === "done" ==> \result === s
  //@ ensures \result.step === "done" && s.step !== "done" ==> s.step === "profile" && s.fields.ticked
  //@ ensures e.tag === "changeNumber" ==> \result.fields === s.fields
  //@ ensures flowOk(s) && s.step === "code" && e.tag === "verified" ==> \result.account === s.shown
  //@ ensures s.step === "code" && s.owner === "" && e.tag === "verified" ==> \result.fields === s.fields
  //@ ensures s.step === "loading" && s.owner === "" && e.tag === "loaded" ==> \result.fields === s.fields
  //@ ensures s.step === "code" && s.owner !== "" && s.owner !== s.phone && e.tag === "verified" ==> formResets(s, \result)
  //@ ensures flowOk(s) && s.owner === "" && !isEmpty(s.fields) ==> !formResets(s, \result)
  //@ ensures (e.tag === "loaded" || e.tag === "verified" || e.tag === "rerouted") && !e.canJoin && \result.step === "profile" ==> \result === s
  //@ ensures e.tag === "refused" && s.step === "profile" ==> \result.step !== "profile" && \result.step !== "done"
  //@ ensures e.tag === "joined" && s.step === "profile" && s.fields.ticked ==> \result.step === "done"
  switch (e.tag) {
    case "loaded":
      if (s.step !== "loading") return s;
      if (e.signedInAs === "") return { ...s, step: e.inviteOnly ? "invite" : "phone", notice: e.notice };
      return signIn(s, e.signedInAs, e.canJoin, e.member, e.notice);
    case "typed":
      if (s.step !== "profile") return s;
      return { ...s, fields: e.fields, owner: s.account };
    case "otpStarted":
      if (s.step !== "phone" || e.number.length === 0) return s;
      return { ...s, step: "code", phone: e.number, shown: e.number };
    case "changeNumber":
      if (s.step !== "code") return s;
      return { ...s, step: "phone" };
    case "verified":
      if (s.step !== "code") return s;
      return signIn(s, s.phone, e.canJoin, e.member, "");
    case "rerouted":
      if (s.step !== "profile" || e.account === "") return s;
      return signIn(s, e.account, e.canJoin, e.member, e.notice);
    case "sessionEnded":
      if (s.step === "done") return s;
      return { ...s, account: "", consented: false, step: "phone", notice: e.notice };
    case "refused":
      if (s.step !== "profile") return s;
      return { ...s, step: "blocked" };
    case "joined":
      if (s.step !== "profile" || !s.fields.ticked) return s;
      return { ...s, step: "done", consented: true, notice: "" };
  }
}

/** True when a step changed the owner and left no fields, so the shell clears the whole form. */
export function formResets(prev: Flow, next: Flow): boolean {
  //@ verify
  return prev.owner !== next.owner && isEmpty(next.fields);
}

function fiveDigits(z: string, i: number): boolean {
  //@ verify
  //@ requires i >= 0 && i <= 5 && z.length === 5
  //@ decreases 5 - i
  return i === 5 || (z.charCodeAt(i) >= 48 && z.charCodeAt(i) <= 57 && fiveDigits(z, i + 1));
}

function zipOk(zip: string): boolean {
  //@ verify
  return zip === "" || (zip.length === 5 && fiveDigits(zip, 0));
}

/** What parseJoin (platform/src/accounts.ts) takes from these fields. sites/test pins this copy to the real function. */
export function parseJoinTakes(f: JoinForm): boolean {
  //@ verify
  return f.firstName.length > 0 && f.firstName.length <= 50 && f.wholeAge && f.age >= 0 && f.age <= 120 && zipOk(f.zip);
}

export function formProblems(f: JoinForm): FormProblems {
  //@ verify
  return {
    name: f.firstName.length === 0 || f.firstName.length > MAX_FIRST_NAME,
    age: !f.wholeAge || f.age < 1 || f.age > 120,
    zip: !zipOk(f.zip),
    consent: !f.ticked,
  };
}

/** The client form can never pass what the server refuses. */
export function formPasses(f: JoinForm): boolean {
  //@ verify
  //@ ensures \result ==> parseJoinTakes(f) && f.ticked
  //@ ensures parseJoinTakes(f) && f.ticked && f.age >= 1 ==> \result
  const p = formProblems(f);
  return !p.name && !p.age && !p.zip && !p.consent;
}
