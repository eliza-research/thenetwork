// spec/oneStepPage.md, "The sign-in moves as the browser join sign-in does"
import { type ComponentProps, type FormEvent, type ReactNode, useId } from "react";
import {
  type SignInError,
  signInBusy,
  signInShowsCloudButton,
  signInShowsNumberForm,
  signInWaiting,
  type StepSignIn,
} from "../../../core/src/generated/oneStepPage.ts";
import { apiMessages } from "../api/client.ts";
import type { SignInFields, SignInHandlers } from "../hooks/stepSignIn.ts";
import { Button } from "./Button.tsx";
import { CodeStep } from "./CodeStep.tsx";
import { Field } from "./Field.tsx";
import { FieldError } from "./FieldError.tsx";
import { PhoneInput } from "./PhoneInput.tsx";
import { SecurityCheck } from "./SecurityCheck.tsx";
import { Spinner } from "./Spinner.tsx";
import { StepFrame } from "./StepFrame.tsx";

export type StepSignInViewProps = Omit<ComponentProps<"div">, "children" | "title"> &
  SignInFields &
  Omit<SignInHandlers, "readMode"> & {
    /** The sign-in sub-flow of the page machine. */
    signIn: StepSignIn;
    /** The security check key; "" when the site has no security check. */
    siteKey: string;
    /** The heading of the number step, such as "Confirm your current number". */
    title: string;
    /** One sentence below the heading. */
    lead: string;
    /** An optional short line below the number form, such as where to get help. */
    note?: ReactNode;
  };

const errors: Readonly<Record<Exclude<SignInError, "SignInRateLimited">, string | undefined>> = {
  SignInNoError: undefined,
  SignInNewCodeSent: undefined,
  SignInInvalidPhone: apiMessages.invalid_phone,
  SignInCheckPending: "Wait for the check above to finish, then try again.",
  SignInCheckFailed: "The security check failed. Refresh the page and try again.",
  SignInCheckRejected: apiMessages.turnstile,
  SignInCheckAgain: "Confirm the check, then send a new code.",
  SignInCodeFormat: "Enter the code from the text we sent.",
  SignInWrongCode: apiMessages.invalid_code,
  SignInCloudUnavailable: "Sign-in is unavailable. Try again.",
  SignInRequestFailed: apiMessages.unknown,
};

function signInErrorText(error: SignInError, retryMinutes: number | undefined): string | undefined {
  if (error !== "SignInRateLimited") return errors[error];
  if (retryMinutes === undefined) return apiMessages.rate_limited;
  return `Too many tries. Try again in ${retryMinutes} ${retryMinutes === 1 ? "minute" : "minutes"}.`;
}

/**
 * The sign-in step of a one-step page: the current number and the security check, the Cloud button, or the code from the text.
 * @model spec/oneStepPage.md
 */
export function StepSignInView({
  signIn,
  siteKey,
  title,
  lead,
  note,
  phone,
  code,
  phoneShown,
  retryMinutes,
  checkRound,
  onPhoneChange,
  onSubmitPhone,
  onCodeChange,
  onSubmitCode,
  onResend,
  onChangeNumber,
  onContinueWithPhone,
  onCheckPassed,
  onCheckFailed,
  onCheckExpired,
  ...props
}: StepSignInViewProps) {
  const errorId = useId();
  const loading = signInBusy(signIn);
  const error = signInErrorText(signIn.error, retryMinutes);
  const cloudButton = signInShowsCloudButton(signIn);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;
    if (cloudButton) onContinueWithPhone();
    else onSubmitPhone();
  };
  if (signInWaiting(signIn)) {
    return (
      <div data-sign-in={signIn.stage} {...props}>
        <Spinner size="md" className="text-muted-foreground" />
      </div>
    );
  }
  if (signIn.stage === "SignInCode") {
    return (
      <div data-sign-in={signIn.stage} {...props}>
        <CodeStep
          phoneShown={phoneShown}
          code={code}
          onCodeChange={onCodeChange}
          loading={loading}
          error={error}
          resent={signIn.error === "SignInNewCodeSent"}
          onSubmitCode={onSubmitCode}
          onResend={onResend}
          onChangeNumber={onChangeNumber}
        />
      </div>
    );
  }
  return (
    <div data-sign-in={signIn.stage} {...props}>
      <StepFrame title={title} loading={loading}>
        <p className="text-foreground">{lead}</p>
        <form noValidate onSubmit={submit} aria-busy={loading || undefined} className="flex flex-col gap-4">
          {signInShowsNumberForm(signIn) ? (
            <Field label="Mobile number">
              <PhoneInput name="phone" placeholder="(212) 555-0123" required data-focus readOnly={loading} aria-describedby={error ? errorId : undefined} value={phone} onChange={(event) => onPhoneChange(event.target.value)} />
            </Field>
          ) : null}
          {signInShowsNumberForm(signIn) ? (
            <SecurityCheck key={checkRound} check={signIn.check} siteKey={siteKey} onPassed={onCheckPassed} onFailed={onCheckFailed} onExpired={onCheckExpired} />
          ) : null}
          <FieldError id={errorId}>{error}</FieldError>
          <Button type="submit" loading={loading} className="self-start">
            {cloudButton ? (loading ? "Opening…" : "Continue with your phone") : loading ? "Sending…" : "Text me a code"}
          </Button>
        </form>
        {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
      </StepFrame>
    </div>
  );
}
