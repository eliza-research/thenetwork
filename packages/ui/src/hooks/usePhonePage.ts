// spec/phonePage.md, "The page reads the session when it opens"
import { useEffect, useRef, useState } from "react";
import { retryMinutesShown } from "../../../core/src/generated/oneStepPage.ts";
import {
  canAnswerChangeResend,
  canAnswerNumberConfirm,
  canAnswerNumberStart,
  enabled,
  type Event,
  initial,
  type PhonePage,
  step,
} from "../../../core/src/generated/phonePage.ts";
import { maskPhone, toE164 } from "../api/join.ts";
import { confirmNumberChange, type PhoneStartResult, startNumberChange } from "../api/phone.ts";
import { readStepSession } from "../api/stepPages.ts";
import { takeCloudReturn } from "../lib/stepLink.ts";
import { createSignIn, emptySignInFields, type SignInFields, type SignInHandlers } from "./stepSignIn.ts";

/** What the page knows before it loads. */
export interface PhoneOptions {
  /** The security check key; "" when the site has no security check. */
  siteKey: string;
}

/** The phone page state and the actions that change it. The names match the `PhonePageView` props. */
export interface PhoneController extends SignInFields, Omit<SignInHandlers, "readMode"> {
  page: PhonePage;
  siteKey: string;
  /** The new number as the person typed it. */
  newNumber: string;
  /** The change code as the person typed it. */
  changeCode: string;
  /** The new number that got the change code, with only its last four digits shown. */
  newNumberShown: string;
  /** The wait in whole minutes after a change start that the server refused for too many tries, when it gave one. */
  changeRetryMinutes: number | undefined;
  onNewNumberChange: (newNumber: string) => void;
  onSubmitNewNumber: () => void;
  onChangeCodeChange: (changeCode: string) => void;
  onSubmitChangeCode: () => void;
  onResendChangeCode: () => void;
  onChangeNewNumber: () => void;
}

type PhoneData = SignInFields & Pick<PhoneController, "page" | "newNumber" | "changeCode" | "newNumberShown" | "changeRetryMinutes">;

/**
 * Runs the phone change page: each API answer becomes one event of the generated machine, and nothing here decides what the machine decides.
 * The new number that got the code stays in this hook only.
 * @model spec/phonePage.md
 */
export function usePhonePage({ siteKey }: PhoneOptions): PhoneController {
  const start: PhoneData = { ...emptySignInFields, page: initial, newNumber: "", changeCode: "", newNumberShown: "", changeRetryMinutes: undefined };
  const [data, setData] = useState(start);
  const current = useRef(start);
  const sentTo = useRef("");

  const [actions] = useState(() => {
    const commit = (next: PhoneData) => {
      current.current = next;
      setData(next);
    };
    const patch = (fields: Partial<PhoneData>) => commit({ ...current.current, ...fields });
    const send = (event: Event, fields: Partial<PhoneData> = {}): PhonePage | undefined => {
      const before = current.current;
      if (!enabled(before.page, event)) return undefined;
      const page = step(before.page, event);
      commit({ ...before, ...fields, page });
      return page;
    };
    const readSession = async () => {
      const session = await readStepSession();
      send({ type: "phoneSessionRead", session });
    };
    const { readMode, ...signIn } = createSignIn({
      siteKey,
      returnPath: "/phone",
      move: (attempt) => send({ type: "moveSignIn", attempt })?.signIn,
      fields: () => current.current,
      patch,
      afterVerified: readSession,
    });
    const retryOf = (started: PhoneStartResult) => ({
      retryKnown: started.retryAfterSeconds !== undefined,
      minutes: started.retryAfterSeconds === undefined ? undefined : retryMinutesShown(started.retryAfterSeconds),
    });
    const open = async () => {
      const cloudReturn = takeCloudReturn();
      if (!send({ type: "openPhonePage" })) return;
      const session = await readStepSession();
      if (!send({ type: "phoneLoaded", session, cloudReturn })) return;
      await readMode();
    };
    const submitNewNumber = async () => {
      const e164 = toE164(current.current.newNumber);
      const next = send({ type: "submitNewNumber", numberValid: e164 !== null });
      if (!next || e164 === null || !canAnswerNumberStart(next)) return;
      sentTo.current = e164;
      const started = await startNumberChange(e164);
      const retry = retryOf(started);
      send({ type: "answerNumberStart", startAnswer: started.answer, retryKnown: retry.retryKnown }, { changeCode: "", newNumberShown: maskPhone(e164), changeRetryMinutes: retry.minutes });
    };
    const submitChangeCode = async () => {
      const digits = current.current.changeCode.replace(/\D/g, "");
      const next = send({ type: "submitChangeCode", codeDigits: digits.length });
      if (!next || !canAnswerNumberConfirm(next)) return;
      const confirmed = await confirmNumberChange(digits);
      send({ type: "answerNumberConfirm", confirmAnswer: confirmed.answer }, confirmed.phoneMasked === undefined ? {} : { newNumberShown: confirmed.phoneMasked });
    };
    const resendChangeCode = async () => {
      const next = send({ type: "resendChangeCode" });
      if (!next || !canAnswerChangeResend(next)) return;
      const started = await startNumberChange(sentTo.current);
      const retry = retryOf(started);
      send({ type: "answerChangeResend", startAnswer: started.answer, retryKnown: retry.retryKnown }, { changeRetryMinutes: retry.minutes });
    };
    return {
      open,
      signIn,
      onNewNumberChange: (newNumber: string) => patch({ newNumber }),
      onSubmitNewNumber: () => void submitNewNumber(),
      onChangeCodeChange: (changeCode: string) => patch({ changeCode }),
      onSubmitChangeCode: () => void submitChangeCode(),
      onResendChangeCode: () => void resendChangeCode(),
      onChangeNewNumber: () => {
        send({ type: "changeNewNumber" });
      },
    };
  });

  useEffect(() => {
    void actions.open();
  }, [actions]);

  return {
    ...data,
    ...actions.signIn,
    siteKey,
    onNewNumberChange: actions.onNewNumberChange,
    onSubmitNewNumber: actions.onSubmitNewNumber,
    onChangeCodeChange: actions.onChangeCodeChange,
    onSubmitChangeCode: actions.onSubmitChangeCode,
    onResendChangeCode: actions.onResendChangeCode,
    onChangeNewNumber: actions.onChangeNewNumber,
  };
}
