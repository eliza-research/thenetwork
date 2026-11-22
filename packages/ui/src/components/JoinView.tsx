// spec/browserJoin.md, "The page shows the step that the current session allows"
import { type ComponentProps, type ReactNode, useCallback, useRef } from "react";
import {
  agentReturnShown,
  birthdateErrorShown,
  type BlockReason,
  formBusy,
  type InlineError,
  type JoinPage,
  phoneFormWaiting,
  showsCloudButton,
  showsNumberForm,
} from "../../../core/src/generated/browserJoin.ts";
import { apiMessages } from "../api/client.ts";
import type { JoinController } from "../hooks/useJoin.ts";
import { cn } from "../lib/cn.ts";
import { BlockedStep } from "./BlockedStep.tsx";
import { CodeStep } from "./CodeStep.tsx";
import { DoneStep } from "./DoneStep.tsx";
import { FlowNotice } from "./FlowNotice.tsx";
import { MemberStep } from "./MemberStep.tsx";
import { PhoneStep } from "./PhoneStep.tsx";
import { ProfileStep } from "./ProfileStep.tsx";
import { SecurityCheck } from "./SecurityCheck.tsx";
import { Spinner } from "./Spinner.tsx";

export type JoinViewProps = Omit<ComponentProps<"div">, "children"> &
  JoinController & {
    /** The site's text-message consent; the page sends this exact text with the profile. */
    consentText: string;
    /** The text of the link back to the home page on the blocked step, such as "Back to peon.biz". */
    homeLabel: string;
    /** The site's own text for a blocked reason, such as one that names the app. */
    blockedMessages?: Partial<Record<BlockReason, string>>;
  };

const inlineErrors: Readonly<Record<Exclude<InlineError, "RequestFailed">, string | undefined>> = {
  NoError: undefined,
  NewCodeSent: undefined,
  InvalidPhone: apiMessages.invalid_phone,
  CheckPending: "Wait for the check above to finish, then try again.",
  CheckFailed: "The security check failed. Refresh the page and try again.",
  CheckRejected: apiMessages.turnstile,
  CheckAgain: "Confirm the check, then send a new code.",
  RateLimited: apiMessages.rate_limited,
  CodeFormat: "Enter the code from the text we sent.",
  InvalidCode: apiMessages.invalid_code,
  ProfileIncomplete: "Enter your first name and your birthday, and tick the box to agree to texts.",
  InvalidBirthdate: apiMessages.invalid_birthdate,
  CloudUnavailable: "Sign-in is unavailable. Try again.",
};

const errorText = (page: JoinPage, failure: JoinController["failure"]): string | undefined =>
  page.formError === "RequestFailed" ? apiMessages[failure ?? "unknown"] : inlineErrors[page.formError];

/**
 * The browser join page: the notice and the one step that the join machine shows. Feed it `useJoin`.
 * Focus moves to each new step after the first one: to its first field, or to its heading when it has no field.
 * @model spec/browserJoin.md
 */
export function JoinView({
  page,
  values,
  phone,
  code,
  phoneShown,
  firstName,
  minJoinAge,
  failure,
  checkRound,
  siteKey,
  onPhoneChange,
  onSubmitPhone,
  onCodeChange,
  onSubmitCode,
  onResend,
  onChangeNumber,
  onContinueWithPhone,
  onValuesChange,
  onSubmitProfile,
  onCheckPassed,
  onCheckFailed,
  onCheckExpired,
  consentText,
  homeLabel,
  blockedMessages,
  className,
  ...props
}: JoinViewProps) {
  const firstStepRef = useRef<HTMLElement | null>(null);
  const focusStep = useCallback((element: HTMLDivElement | null) => {
    if (!element || element.dataset.waiting !== undefined) return;
    if (firstStepRef.current === null) firstStepRef.current = element;
    if (firstStepRef.current === element) return;
    const field = element.querySelector<HTMLElement>("[data-focus]:not(:disabled)");
    if (field) return field.focus();
    element.querySelector<HTMLElement>("h1")?.focus();
  }, []);
  const loading = formBusy(page);
  const error = errorText(page, failure);
  const waiting = <Spinner size="md" className="text-muted-foreground" />;

  const stepFor = (): { waiting: boolean; view: ReactNode } => {
    switch (page.screen) {
      case "Opening":
      case "Loading":
      case "Checking":
      case "LeftForCloud":
        return { waiting: true, view: waiting };
      case "Phone":
        return {
          waiting: false,
          view: (
            <PhoneStep
              formWaiting={phoneFormWaiting(page)}
              numberForm={showsNumberForm(page)}
              cloudButton={showsCloudButton(page)}
              loading={loading}
              phone={phone}
              onPhoneChange={onPhoneChange}
              error={error}
              onSubmitPhone={onSubmitPhone}
              onContinueWithPhone={onContinueWithPhone}
              check={<SecurityCheck key={checkRound} check={page.check} siteKey={siteKey} onPassed={onCheckPassed} onFailed={onCheckFailed} onExpired={onCheckExpired} />}
            />
          ),
        };
      case "Code":
        return {
          waiting: false,
          view: (
            <CodeStep
              phoneShown={phoneShown}
              code={code}
              onCodeChange={onCodeChange}
              loading={loading}
              error={error}
              resent={page.formError === "NewCodeSent"}
              onSubmitCode={onSubmitCode}
              onResend={onResend}
              onChangeNumber={onChangeNumber}
            />
          ),
        };
      case "Profile":
        return {
          waiting: false,
          view: (
            <ProfileStep
              values={values}
              onValuesChange={onValuesChange}
              minJoinAge={minJoinAge}
              consentText={consentText}
              loading={loading}
              error={birthdateErrorShown(page) ? undefined : error}
              birthdateError={birthdateErrorShown(page) ? error : undefined}
              onSubmitProfile={() => onSubmitProfile(consentText)}
            />
          ),
        };
      case "Member":
        return { waiting: false, view: <MemberStep /> };
      case "Blocked":
        return { waiting: false, view: <BlockedStep reason={page.reason} messages={blockedMessages} homeLabel={homeLabel} /> };
      case "Done":
        return { waiting: false, view: <DoneStep firstName={firstName} agentReturn={agentReturnShown(page)} /> };
      default: {
        const _exhaustive: never = page.screen;
        return _exhaustive;
      }
    }
  };
  const current = stepFor();

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <FlowNotice notice={page.notice} />
      <div key={page.screen} ref={focusStep} data-join-step={page.screen}
        data-join-consent={page.consented ? "granted" : undefined} data-waiting={current.waiting ? "" : undefined}>
        {current.view}
      </div>
    </div>
  );
}
