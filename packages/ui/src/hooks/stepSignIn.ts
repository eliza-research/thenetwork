// spec/oneStepPage.md, "The sign-in moves as the browser join sign-in does"
import type { AuthLookup, VerifyResult } from "../../../core/src/generated/browserJoin.ts";
import {
  retryMinutesShown,
  type SignInAnswer,
  type SignInAttempt,
  type SignInAttemptKind,
  signInAttemptAllowed,
  signInAttemptNone,
  type SignInLookup,
  type StepSignIn,
} from "../../../core/src/generated/oneStepPage.ts";
import { maskPhone, readAuthLookup, startCloud, toE164, verifyCode } from "../api/join.ts";
import { startStepCode } from "../api/stepPages.ts";

/** The sign-in fields that a one-step page keeps beside its machine state. */
export interface SignInFields {
  /** The current number as the person typed it. */
  phone: string;
  /** The sign-in code as the person typed it. */
  code: string;
  /** The number that got the sign-in code, with only its last four digits shown. */
  phoneShown: string;
  /** The wait in whole minutes after "too many tries", when the server gave one. */
  retryMinutes: number | undefined;
  /** A new value shows a new security check widget, because the machine spent the check. */
  checkRound: number;
}

/** The sign-in fields before the person types anything. */
export const emptySignInFields: SignInFields = { phone: "", code: "", phoneShown: "", retryMinutes: undefined, checkRound: 0 };

/** What the person can do in the sign-in sub-flow. `readMode` is for the page hook, which calls it once after it loads. */
export interface SignInHandlers {
  readMode: () => Promise<void>;
  onPhoneChange: (phone: string) => void;
  onSubmitPhone: () => void;
  onCodeChange: (code: string) => void;
  onSubmitCode: () => void;
  onResend: () => void;
  onChangeNumber: () => void;
  onContinueWithPhone: () => void;
  onCheckPassed: (token: string) => void;
  onCheckFailed: () => void;
  onCheckExpired: () => void;
}

/** How a page hook joins the sign-in to its machine. */
export interface SignInOptions {
  /** The security check key; "" when the site has no security check. */
  siteKey: string;
  /** Where the Cloud sign-in comes back to. */
  returnPath: "/phone" | "/home-help";
  /** Sends `moveSignIn` with the attempt to the page machine. Returns the new sign-in, or undefined when the machine refused the event. */
  move: (attempt: SignInAttempt) => StepSignIn | undefined;
  /** The page's current sign-in fields. */
  fields: () => SignInFields;
  /** Changes some sign-in fields. */
  patch: (fields: Partial<SignInFields>) => void;
  /** Runs just before the page leaves for the Cloud sign-in. */
  beforeCloud?: () => void;
  /** Runs when the machine took a verified code: the page then reads the session. */
  afterVerified: () => Promise<void>;
}

const lookups: Readonly<Record<AuthLookup, SignInLookup>> = {
  ModeCloud: "SignInLookupCloud",
  ModeOtp: "SignInLookupOtp",
  LookupFailed: "SignInLookupFailed",
};

const verifyAnswers: Readonly<Record<VerifyResult, SignInAnswer>> = {
  Verified: "SignInAnswerOk",
  WrongCode: "SignInAnswerWrongCode",
  VerifyRateLimited: "SignInAnswerRateLimited",
  VerifyFailed: "SignInAnswerFailed",
};

const attemptOf = (kind: SignInAttemptKind, facts: Partial<Omit<SignInAttempt, "kind">> = {}): SignInAttempt => ({ ...signInAttemptNone, ...facts, kind });

const allows = (signIn: StepSignIn | undefined, kind: SignInAttemptKind): signIn is StepSignIn => signIn !== undefined && signInAttemptAllowed(signIn, attemptOf(kind));

/**
 * Builds the sign-in handlers of a one-step page. Each server answer becomes one `moveSignIn` event of the page machine, and nothing here decides what the machine decides.
 * The security check token and the number that got the code stay in this closure only.
 * @model spec/oneStepPage.md
 */
export function createSignIn({ siteKey, returnPath, move, fields, patch, beforeCloud, afterVerified }: SignInOptions): SignInHandlers {
  let token: string | undefined;
  let sentTo = "";
  const send = (kind: SignInAttemptKind, facts: Partial<Omit<SignInAttempt, "kind">> = {}) => move(attemptOf(kind, facts));
  const spendCheck = (): number => {
    token = undefined;
    return fields().checkRound + 1;
  };
  const answerStart = async (kind: "AttemptAnswerStart" | "AttemptAnswerResend", phone: string) => {
    const started = await startStepCode(phone, token);
    const waited = started.retryAfterSeconds;
    send(kind, { answer: started.answer, retryKnown: waited !== undefined });
    patch({
      checkRound: spendCheck(),
      retryMinutes: waited === undefined ? undefined : retryMinutesShown(waited),
      ...(kind === "AttemptAnswerStart" ? { code: "", phoneShown: maskPhone(phone) } : {}),
    });
  };
  const submitPhone = async () => {
    const e164 = toE164(fields().phone);
    const next = send("AttemptSubmitNumber", { valid: e164 !== null });
    if (e164 === null || !allows(next, "AttemptAnswerStart")) return;
    sentTo = e164;
    await answerStart("AttemptAnswerStart", e164);
  };
  const submitCode = async () => {
    const digits = fields().code.replace(/\D/g, "");
    const next = send("AttemptSubmitCode", { digits: digits.length });
    if (!allows(next, "AttemptAnswerVerify")) return;
    const verified = await verifyCode(sentTo, digits);
    const after = send("AttemptAnswerVerify", { answer: verifyAnswers[verified.result] });
    if (after?.stage === "SignInVerified") await afterVerified();
  };
  const resend = async () => {
    const next = send("AttemptResend");
    if (!allows(next, "AttemptAnswerResend")) return;
    await answerStart("AttemptAnswerResend", sentTo);
  };
  const continueWithPhone = async () => {
    const next = send("AttemptContinueCloud");
    if (!allows(next, "AttemptAnswerCloud")) return;
    const opened = await startCloud(returnPath);
    const after = send("AttemptAnswerCloud", { answer: opened.ok ? "SignInAnswerOk" : "SignInAnswerFailed" });
    if (!opened.ok || after?.stage !== "SignInLeftForCloud") return;
    beforeCloud?.();
    window.location.assign(opened.url);
  };
  return {
    readMode: async () => {
      const lookup = await readAuthLookup();
      send("AttemptReadMode", { lookup: lookups[lookup], checkOn: siteKey !== "" });
    },
    onPhoneChange: (phone) => patch({ phone }),
    onSubmitPhone: () => void submitPhone(),
    onCodeChange: (code) => patch({ code }),
    onSubmitCode: () => void submitCode(),
    onResend: () => void resend(),
    onChangeNumber: () => {
      send("AttemptChangeNumber");
    },
    onContinueWithPhone: () => void continueWithPhone(),
    onCheckPassed: (passed) => {
      token = passed;
      send("AttemptSettleCheck", { passed: true });
    },
    onCheckFailed: () => {
      token = undefined;
      send("AttemptSettleCheck", { passed: false });
    },
    onCheckExpired: () => {
      token = undefined;
      send("AttemptExpireCheck");
    },
  };
}
