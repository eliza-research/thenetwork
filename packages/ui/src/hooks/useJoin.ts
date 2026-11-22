// spec/browserJoin.md, "Join in the browser"
import { useEffect, useRef, useState } from "react";
import {
  browserInvitationKeepsAccount,
  browserInvitationMayBind,
  browserInvitationMayRetry,
  browserInvitationMaySubmit,
  browserPrefillMayPresentReceipt,
  canAnswerCloudStart,
  canAnswerCodeStart,
  canAnswerJoin,
  canAnswerResend,
  canAnswerVerify,
  canReadAuthMode,
  enabled,
  type Event,
  fragmentNameKept,
  initial,
  type JoinPage,
  minJoinAgeShown,
  type SessionView,
  step,
} from "../../../core/src/generated/browserJoin.ts";
import { type CalendarDate, calendarDateOfDay, signupClockDay } from "../../../core/src/generated/authorizationPages.ts";
import type { ApiError } from "../api/client.ts";
import { joinApp, maskPhone, readApp, readAuthLookup, readSession, type SessionAnswer, startCloud, startCode, toE164, verifyCode } from "../api/join.ts";
import type { ProfileValues } from "../components/ProfileStep.tsx";

/** What the page knows before it reads the app. The hook reads these once. */
export interface JoinOptions {
  /** The security check key; "" when the site has no security check. */
  siteKey: string;
  /** The minimum join age to show when the page cannot read the app. */
  pageMinAge: number;
  /** Whether the page takes the app as invite-only when it cannot read the app. */
  pageInviteOnly?: boolean;
  /** Where the cloud sign-in returns to. */
  returnPath?: string;
}

/** The join page state and the actions that change it. The names match the `JoinView` props. */
export interface JoinController {
  page: JoinPage;
  values: ProfileValues;
  phone: string;
  code: string;
  phoneShown: string;
  firstName: string;
  minJoinAge: number;
  failure: ApiError | undefined;
  checkRound: number;
  siteKey: string;
  onPhoneChange: (phone: string) => void;
  onSubmitPhone: () => void;
  onCodeChange: (code: string) => void;
  onSubmitCode: () => void;
  onResend: () => void;
  onChangeNumber: () => void;
  onContinueWithPhone: () => void;
  onValuesChange: (values: Partial<ProfileValues>) => void;
  onSubmitProfile: (consentWording: string) => void;
  onCheckPassed: (token: string) => void;
  onCheckFailed: () => void;
  onCheckExpired: () => void;
}

type JoinData = Omit<JoinController, `on${string}` | "siteKey">;

const emptyValues: ProfileValues = { firstName: "", birthdate: "", consent: false };

const cloudReceiptKey = "peon-cloud-join-receipt";

function takeCloudReceipt(): string | undefined {
  try {
    const receipt = window.sessionStorage.getItem(cloudReceiptKey);
    window.sessionStorage.removeItem(cloudReceiptKey);
    if (receipt && /^[0-9a-f]{32}$/.test(receipt)) return receipt;
  } catch { /* Private browser storage can be unavailable. */ }
}

function saveCloudReceipt(receipt: string): void {
  try { window.sessionStorage.setItem(cloudReceiptKey, receipt); } catch { /* The sign-in can still complete. */ }
}

interface LinkFields {
  viaAgent: boolean;
  name: string;
  invitation?: PrivateInvitation;
}

interface PrivateInvitation {
  token?: string;
  signupView?: string;
}

function readLink(): LinkFields {
  const fields = new URLSearchParams(window.location.hash.slice(1));
  const suppliedName = fields.get("firstName") ?? "";
  const invites = window.location.pathname === "/join" ? fields.getAll("invite") : [];
  const value = invites.length === 1 ? invites[0] : undefined;
  return {
    viaAgent: new URLSearchParams(window.location.search).get("via") === "agent",
    name: suppliedName.slice(0, fragmentNameKept(suppliedName.length)),
    ...(invites.length > 0 ? { invitation: {
      // A 32-byte base64url token has 43 characters and zero trailing padding bits.
      token: value && /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(value) ? value : undefined,
    } } : {}),
  };
}

function clearFragment(): void {
  if (window.location.hash !== "") window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
}

const noDate: CalendarDate = { year: 0, month: 0, day: 0 };

const calendarDateOf = (text: string): CalendarDate => {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  return parts ? { year: Number(parts[1]), month: Number(parts[2]), day: Number(parts[3]) } : noDate;
};

/** Runs the browser join flow: each API answer becomes one event of the generated machine, and nothing here decides what the machine decides. */
export function useJoin({ siteKey, pageMinAge, pageInviteOnly = false, returnPath = "/join" }: JoinOptions): JoinController {
  const start: JoinData = {
    page: initial,
    values: emptyValues,
    phone: "",
    code: "",
    phoneShown: "",
    firstName: "",
    minJoinAge: pageMinAge,
    failure: undefined,
    checkRound: 0,
  };
  const [data, setData] = useState(start);
  const current = useRef(start);
  const token = useRef<string | undefined>(undefined);
  const sentTo = useRef("");
  const signupView = useRef<string | undefined>(undefined);
  const invitation = useRef<PrivateInvitation | undefined>(undefined);
  const accounts = useRef(new Map<string, number>());

  const [actions] = useState(() => {
    const commit = (next: JoinData) => {
      current.current = next;
      setData(next);
    };
    const patch = (fields: Partial<JoinData>) => commit({ ...current.current, ...fields });
    const send = (event: Event, fields: Partial<JoinData> = {}): JoinPage | undefined => {
      const before = current.current;
      if (!enabled(before.page, event)) return undefined;
      const page = step(before.page, event);
      if (!browserInvitationKeepsAccount(before.page.account, page.account)) invitation.current = undefined;
      const merged = { ...before, ...fields, page };
      const values = !page.formHasValues ? emptyValues : page.birthdayGiven ? merged.values : { ...merged.values, birthdate: "" };
      commit({ ...merged, values });
      return page;
    };
    const viewOf = (session: SessionAnswer): SessionView => {
      if (session.account === "") return { result: session.result, account: 0, reason: session.reason };
      const known = accounts.current.get(session.account) ?? accounts.current.size + 1;
      accounts.current.set(session.account, known);
      return { result: session.result, account: known, reason: session.reason };
    };
    const lookUpAuth = async () => {
      const lookup = await readAuthLookup();
      send({ type: "readAuthMode", lookup, checkOn: siteKey !== "" });
    };
    const readAccount = (session: SessionAnswer) => {
      signupView.current = session.signupView;
      const pending = invitation.current;
      if (pending && session.result === "MayJoin" && browserInvitationMayBind(session.peon === true, session.signupView !== undefined)) {
        pending.signupView ??= session.signupView;
      }
      return viewOf(session);
    };
    const recheck = async () => {
      const session = await readSession();
      send({ type: "recheck", view: readAccount(session) });
    };
    const open = async () => {
      const link = readLink();
      const opened = send(
        { type: "openPage", viaAgent: link.viaAgent, fragmentName: link.name !== "" },
        { values: { firstName: link.name, birthdate: "", consent: false } },
      );
      if (!opened) return;
      invitation.current = link.invitation;
      clearFragment();
      const receipt = takeCloudReceipt();
      const presentedReceipt = browserPrefillMayPresentReceipt(link.viaAgent, link.name !== "", !!link.invitation)
        ? receipt : undefined;
      const [app, session] = await Promise.all([readApp(), readSession(presentedReceipt)]);
      const view = readAccount(session);
      const prefill = session.joinPrefill;
      if (prefill) send({ type: "restoreCloudPrefill", view, fromAgent: prefill.viaAgent, hasFields: prefill.firstName !== "" },
        { values: { firstName: prefill.firstName, birthdate: "", consent: false } });
      const loaded = send(
        { type: "loaded", view, appUnreachable: !app.read && app.unreachable, inviteOnly: app.read ? app.inviteOnly : pageInviteOnly },
        { minJoinAge: minJoinAgeShown(app.read, app.read ? app.minJoinAge : pageMinAge, pageMinAge) },
      );
      if (loaded && canReadAuthMode(loaded)) await lookUpAuth();
    };
    const spendCheck = () => {
      token.current = undefined;
      return current.current.checkRound + 1;
    };
    const controller = {
      open,
      onPhoneChange: (phone: string) => patch({ phone }),
      onCodeChange: (code: string) => patch({ code }),
      onSubmitPhone: async () => {
        const e164 = toE164(current.current.phone);
        const next = send({ type: "submitPhone", phoneValid: e164 !== null });
        if (!next || !canAnswerCodeStart(next) || e164 === null) return;
        const answer = await startCode(e164, token.current);
        sentTo.current = e164;
        send({ type: "answerCodeStart", started: answer.result }, { failure: answer.error, phoneShown: maskPhone(e164), code: "", checkRound: spendCheck() });
      },
      onSubmitCode: async () => {
        const digits = current.current.code.replace(/\D/g, "");
        const next = send({ type: "submitCode", codeDigitCount: digits.length });
        if (!next || !canAnswerVerify(next)) return;
        const answer = await verifyCode(sentTo.current, digits);
        const after = send({ type: "answerVerify", verifyAnswer: answer.result }, { failure: answer.error });
        if (after?.screen === "Checking") await recheck();
      },
      onResend: async () => {
        const next = send({ type: "resendCode" });
        if (!next || !canAnswerResend(next)) return;
        const answer = await startCode(sentTo.current);
        send({ type: "answerResend", resent: answer.result }, { failure: answer.error });
      },
      onChangeNumber: () => {
        send({ type: "changeNumber" });
      },
      onContinueWithPhone: async () => {
        const next = send({ type: "continueWithPhone" });
        if (!next || !canAnswerCloudStart(next)) return;
        const answer = await startCloud(returnPath, { firstName: current.current.values.firstName, viaAgent: next.viaAgent });
        const after = send({ type: "answerCloudStart", opened: answer.ok }, answer.ok ? {} : { failure: answer.error });
        if (answer.ok && after?.screen === "LeftForCloud") {
          invitation.current = undefined;
          if (answer.receipt) saveCloudReceipt(answer.receipt);
          window.location.assign(answer.url);
        }
      },
      onValuesChange: (values: Partial<ProfileValues>) => {
        const next = { ...current.current.values, ...values };
        send({ type: "editProfile", birthdayGiven: next.birthdate !== "" }, { values: next });
      },
      onSubmitProfile: async (consentWording: string) => {
        const { values } = current.current;
        const view = signupView.current;
        const firstName = values.firstName.trim();
        const birthdate = values.birthdate.trim();
        const today = calendarDateOfDay(signupClockDay(Date.now()));
        const next = send({ type: "submitProfile", form: { nameGiven: firstName !== "", birthday: calendarDateOf(birthdate), today, consentTicked: values.consent } });
        if (!next || !canAnswerJoin(next)) return;
        const pending = invitation.current;
        const sameAccount = view !== undefined && pending?.signupView === view;
        if (pending && (!pending.token || !browserInvitationMaySubmit(sameAccount, next.addressClean, next.consented))) {
          invitation.current = undefined;
          send({ type: "answerJoin", joinAnswer: "JoinInvalidInvitation" });
          return;
        }
        const answer = await joinApp({
          ...(view ? { signupView: view } : {}),
          ...(pending?.token ? { inviteToken: pending.token } : {}),
          firstName,
          birthdate,
          consent: { sms: true, wording: consentWording },
        });
        if (!browserInvitationMayRetry(answer.result)) invitation.current = undefined;
        const after = send({ type: "answerJoin", joinAnswer: answer.result }, { failure: answer.error, firstName: answer.firstName ?? firstName });
        if (after?.screen === "Checking") await recheck();
      },
      onCheckPassed: (passed: string) => {
        token.current = passed;
        send({ type: "settleCheck", passed: true });
      },
      onCheckFailed: () => {
        token.current = undefined;
        send({ type: "settleCheck", passed: false });
      },
      onCheckExpired: () => {
        token.current = undefined;
        send({ type: "expireCheck" });
      },
    };
    return controller;
  });

  useEffect(() => {
    void actions.open();
  }, [actions]);

  return {
    ...data,
    siteKey,
    onPhoneChange: actions.onPhoneChange,
    onSubmitPhone: () => void actions.onSubmitPhone(),
    onCodeChange: actions.onCodeChange,
    onSubmitCode: () => void actions.onSubmitCode(),
    onResend: () => void actions.onResend(),
    onChangeNumber: actions.onChangeNumber,
    onContinueWithPhone: () => void actions.onContinueWithPhone(),
    onValuesChange: actions.onValuesChange,
    onSubmitProfile: (wording: string) => void actions.onSubmitProfile(wording),
    onCheckPassed: actions.onCheckPassed,
    onCheckFailed: actions.onCheckFailed,
    onCheckExpired: actions.onCheckExpired,
  };
}
