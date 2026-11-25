// spec/homeHelpPage.md, "The page reads the session and shows the choice step or the sign-in step"
import { useEffect, useRef, useState } from "react";
import { enabled, type Event, type HomeHelpPage, initial, step } from "../../../core/src/generated/homeHelpPage.ts";
import type { CloudReturn, SignInAttempt, StepSession } from "../../../core/src/generated/oneStepPage.ts";
import { addressCheckOf, type HomeHelpLink, parseHomeHelpLink, readHelpStatus, sendVenue, type VenueAction } from "../api/homeHelp.ts";
import { readStepSession } from "../api/stepPages.ts";
import { keepLinkFragment, takeCloudReturn, takeKeptFragment, takeLinkFragment } from "../lib/stepLink.ts";
import { createSignIn, emptySignInFields, type SignInFields, type SignInHandlers } from "./stepSignIn.ts";

/** What the home-help page knows before it reads anything. */
export interface HomeHelpOptions {
  /** The security check key; "" when the site has no security check. */
  siteKey: string;
}

/** The home-help page state and the actions that change it. The names match the `HomeHelpPageView` props. */
export interface HomeHelpController extends SignInFields, Omit<SignInHandlers, "readMode"> {
  page: HomeHelpPage;
  /** The address as the requester types it. */
  address: string;
  /** The address from a revealed answer; "" on every other step. It stays in memory only. */
  revealedAddress: string;
  siteKey: string;
  onAddressChange: (address: string) => void;
  onChooseAdd: () => void;
  onBackToChoices: () => void;
  onSubmitAddress: () => void;
  onAskReveal: () => void;
  onAskRevoke: () => void;
}

interface HelpData extends SignInFields {
  page: HomeHelpPage;
  address: string;
  revealedAddress: string;
}

const start: HelpData = { ...emptySignInFields, page: initial, address: "", revealedAddress: "" };

/**
 * Runs the home-help address step: each server answer becomes one event of the generated machine, and nothing here decides what the machine decides.
 * After each session read that finds a session, the shell asks the server for the status of the person on the plan.
 * @model spec/homeHelpPage.md
 */
export function useHomeHelpPage({ siteKey }: HomeHelpOptions): HomeHelpController {
  const [data, setData] = useState(start);
  const current = useRef(start);
  const link = useRef<HomeHelpLink | undefined>(undefined);
  const linkText = useRef("");

  const [actions] = useState(() => {
    const commit = (next: HelpData) => {
      current.current = next;
      setData(next);
    };
    const patch = (fields: Partial<HelpData>) => commit({ ...current.current, ...fields });
    const send = (event: Event, fields: Partial<HelpData> = {}): HomeHelpPage | undefined => {
      const before = current.current;
      if (!enabled(before.page, event)) return undefined;
      const page = step(before.page, event);
      const merged = { ...before, ...fields, page };
      commit(page.addressHeld ? merged : { ...merged, revealedAddress: "" });
      return page;
    };
    const signIn = createSignIn({
      siteKey,
      returnPath: "/home-help",
      move: (attempt: SignInAttempt) => send({ type: "moveSignIn", attempt })?.signIn,
      fields: () => current.current,
      patch: (fields: Partial<SignInFields>) => patch(fields),
      beforeCloud: () => keepLinkFragment("home-help", linkText.current),
      afterVerified: async () => {
        const read = await statusAfter(await readStepSession());
        await signInReady(send({ type: "homeHelpSessionRead", session: read.session, status: read.status }));
      },
    });
    const statusAfter = async (session: StepSession) => {
      const target = link.current;
      if (session !== "SessionSignedIn" || !target) return { session, status: "StatusUnknown" as const };
      const read = await readHelpStatus(target);
      return { session: read.signedOut ? ("SessionSignedOut" as const) : session, status: read.status };
    };
    const signInReady = async (page: HomeHelpPage | undefined) => {
      if (page?.screen === "HelpSignIn" && page.signIn.auth === "SignInModePending") await signIn.readMode();
    };
    const open = async () => {
      const cloudReturn: CloudReturn = takeCloudReturn();
      const fromAddress = takeLinkFragment();
      const kept = takeKeptFragment("home-help");
      const read = fromAddress !== "" ? parseHomeHelpLink(fromAddress) : parseHomeHelpLink(kept, true);
      const opened = send({ type: "openHomeHelpPage", source: read.source, wellFormed: read.wellFormed });
      if (opened?.screen !== "HelpLoading" || !read.link) return;
      link.current = read.link;
      linkText.current = read.text;
      const loaded = await statusAfter(await readStepSession());
      await signInReady(send({ type: "homeHelpLoaded", session: loaded.session, status: loaded.status, cloudReturn }));
    };
    const run = async (action: VenueAction, event: Event, address?: string) => {
      const target = link.current;
      const next = send(event);
      if (!next || next.pending === "HelpIdle" || !target) return;
      const result = await sendVenue(action, target, address);
      const after = send({ type: "answerVenue", venueAnswer: result.answer });
      if (after?.screen === "HelpRevealed" && result.address !== undefined) patch({ revealedAddress: result.address });
      if (after?.screen === "HelpSaved") patch({ address: "" });
      await signInReady(after);
    };
    return {
      open,
      handlers: { ...signIn },
      onAddressChange: (address: string) => patch({ address }),
      onChooseAdd: () => void send({ type: "chooseAdd" }),
      onBackToChoices: () => void send({ type: "backToChoices" }),
      onSubmitAddress: () => {
        const { address } = current.current;
        void run("submit", { type: "submitAddress", addressCheck: addressCheckOf(address) }, address);
      },
      onAskReveal: () => void run("reveal", { type: "askReveal" }),
      onAskRevoke: () => void run("revoke", { type: "askRevoke" }),
    };
  });

  useEffect(() => {
    void actions.open();
  }, [actions]);

  const { handlers } = actions;
  return {
    ...data,
    siteKey,
    onPhoneChange: handlers.onPhoneChange,
    onSubmitPhone: handlers.onSubmitPhone,
    onCodeChange: handlers.onCodeChange,
    onSubmitCode: handlers.onSubmitCode,
    onResend: handlers.onResend,
    onChangeNumber: handlers.onChangeNumber,
    onContinueWithPhone: handlers.onContinueWithPhone,
    onCheckPassed: handlers.onCheckPassed,
    onCheckFailed: handlers.onCheckFailed,
    onCheckExpired: handlers.onCheckExpired,
    onAddressChange: actions.onAddressChange,
    onChooseAdd: actions.onChooseAdd,
    onBackToChoices: actions.onBackToChoices,
    onSubmitAddress: actions.onSubmitAddress,
    onAskReveal: actions.onAskReveal,
    onAskRevoke: actions.onAskRevoke,
  };
}
