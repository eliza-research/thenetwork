// spec/phonePage.md, "Only a well-formed change code goes to the server, and only a moved number shows the result"
import { type ComponentProps, type FormEvent, type ReactNode, useId } from "react";
import { supportEmail } from "../../../core/src/generated/brandIdentity.ts";
import { type PhoneError, phoneBusy, phoneNumberFormWaiting, phoneScreenWaiting } from "../../../core/src/generated/phonePage.ts";
import { apiMessages } from "../api/client.ts";
import type { PhoneController } from "../hooks/usePhonePage.ts";
import { Button } from "./Button.tsx";
import { CodeInput } from "./CodeInput.tsx";
import { Field } from "./Field.tsx";
import { FieldError } from "./FieldError.tsx";
import { Link } from "./Link.tsx";
import { OneStepPage } from "./OneStepPage.tsx";
import { PhoneInput } from "./PhoneInput.tsx";
import { StepFrame } from "./StepFrame.tsx";
import { StepSignInView } from "./StepSignInView.tsx";

export type PhonePageViewProps = Omit<ComponentProps<"div">, "children"> & PhoneController;

const errors: Readonly<Record<PhoneError, string | undefined>> = {
  PhoneNoError: undefined,
  PhoneNewCodeSent: undefined,
  PhoneInvalidNumber: apiMessages.invalid_phone,
  PhoneSameNumber: "This is the number you use now. Enter your new number.",
  PhoneRateLimited: "Too many tries. Try later.",
  PhoneCodeFormat: "Enter the code from the text we sent.",
  PhoneWrongCode: apiMessages.invalid_code,
  PhoneStartAgain: "That code has expired. Send a new code to start again.",
  PhoneNumberInUse: "You cannot use that number. Enter a different number.",
  PhoneRequestFailed: apiMessages.unknown,
};

const help: ReactNode = (
  <>
    No longer have that number? Email <Link href={`mailto:${supportEmail}`}>{supportEmail}</Link>.
  </>
);

/**
 * The phone change page: the shared notice and the one step that the phone machine shows. Feed it `usePhonePage`.
 * @model spec/phonePage.md
 */
export function PhonePageView({
  page,
  siteKey,
  newNumber,
  changeCode,
  newNumberShown,
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
  onNewNumberChange,
  onSubmitNewNumber,
  onChangeCodeChange,
  onSubmitChangeCode,
  onResendChangeCode,
  onChangeNewNumber,
  ...props
}: PhonePageViewProps) {
  const errorId = useId();
  const loading = phoneBusy(page);
  const error = errors[page.error];
  const formWaiting = phoneNumberFormWaiting(page);

  const submitNumber = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!loading && !formWaiting) onSubmitNewNumber();
  };
  const submitCode = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!loading) onSubmitChangeCode();
  };

  const stepFor = (): ReactNode => {
    switch (page.screen) {
      case "PhoneOpening":
      case "PhoneLoading":
      case "PhoneChecking":
        return null;
      case "PhoneSignIn":
        return (
          <StepSignInView
            signIn={page.signIn}
            siteKey={siteKey}
            title="Confirm your current number"
            lead="To change your number, first confirm the number you use now."
            note={help}
            phone={phone}
            code={code}
            phoneShown={phoneShown}
            retryMinutes={retryMinutes}
            checkRound={checkRound}
            onPhoneChange={onPhoneChange}
            onSubmitPhone={onSubmitPhone}
            onCodeChange={onCodeChange}
            onSubmitCode={onSubmitCode}
            onResend={onResend}
            onChangeNumber={onChangeNumber}
            onContinueWithPhone={onContinueWithPhone}
            onCheckPassed={onCheckPassed}
            onCheckFailed={onCheckFailed}
            onCheckExpired={onCheckExpired}
          />
        );
      case "PhoneNewNumber":
        return (
          <StepFrame title="Your new number" loading={loading}>
            <p className="text-foreground">We text a code to the new number.</p>
            <form noValidate onSubmit={submitNumber} aria-busy={loading || formWaiting || undefined} className="flex flex-col gap-4">
              <Field label="New mobile number">
                <PhoneInput name="new-phone" autoComplete="off" placeholder="(212) 555-0123" required data-focus disabled={formWaiting} readOnly={loading}
                  aria-describedby={error ? errorId : undefined} value={newNumber} onChange={(event) => onNewNumberChange(event.target.value)} />
              </Field>
              <FieldError id={errorId}>{error}</FieldError>
              <Button type="submit" loading={loading || formWaiting} disabled={formWaiting} className="self-start">
                {formWaiting ? "Loading…" : loading ? "Sending…" : "Send code"}
              </Button>
            </form>
          </StepFrame>
        );
      case "PhoneCode":
        return (
          <StepFrame title="Enter the code" loading={loading}>
            <p className="text-foreground">
              We sent a code to <strong>{newNumberShown}</strong>.
            </p>
            <form noValidate onSubmit={submitCode} aria-busy={loading || undefined} className="flex flex-col gap-4">
              <Field label="Code">
                <CodeInput name="code" maxLength={10} required data-focus readOnly={loading} aria-describedby={error ? errorId : undefined}
                  invalid={error !== undefined} value={changeCode} onChange={(event) => onChangeCodeChange(event.target.value)} />
              </Field>
              <FieldError id={errorId}>{error}</FieldError>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" loading={loading}>
                  {page.pending === "PhoneConfirming" ? "Changing…" : "Change number"}
                </Button>
                <Button variant="ghost" aria-disabled={loading || undefined} onClick={loading ? undefined : onResendChangeCode}>
                  Send a new code
                </Button>
                <Button variant="ghost" aria-disabled={loading || undefined} onClick={loading ? undefined : onChangeNewNumber}>
                  Use a different number
                </Button>
              </div>
              <p role="status" className="text-sm text-muted-foreground">
                {page.error === "PhoneNewCodeSent" ? "We sent a new code." : null}
              </p>
            </form>
          </StepFrame>
        );
      case "PhoneDone":
        return (
          <StepFrame title="Your number is changed">
            <p className="text-foreground">
              We now text <strong>{newNumberShown}</strong>.
            </p>
            {page.doneSignedOut ? <p className="text-foreground">Use your new number the next time you sign in.</p> : null}
          </StepFrame>
        );
      case "PhoneHeld":
        return (
          <StepFrame title="We need to check this number">
            <p className="text-foreground">
              Email <Link href={`mailto:${supportEmail}`}>{supportEmail}</Link> for help.
            </p>
          </StepFrame>
        );
      default: {
        const _exhaustive: never = page.screen;
        return _exhaustive;
      }
    }
  };

  return (
    <OneStepPage stepKey={page.screen} waiting={phoneScreenWaiting(page)} notice={page.notice} data-phone-step={page.screen} {...props}>
      {stepFor()}
    </OneStepPage>
  );
}
