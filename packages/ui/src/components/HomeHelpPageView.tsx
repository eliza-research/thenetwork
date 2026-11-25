// spec/homeHelpPage.md, "The choice step offers only the actions that the role allows"
import type { ComponentProps, FormEvent, ReactNode } from "react";
import {
  type HelpError,
  helpBusy,
  helpOffersAdd,
  helpOffersRemove,
  helpOffersShow,
  helpWaiting,
  homeHelpAddressMax,
} from "../../../core/src/generated/homeHelpPage.ts";
import { apiMessages } from "../api/client.ts";
import type { HomeHelpController } from "../hooks/useHomeHelpPage.ts";
import { Button } from "./Button.tsx";
import { Field } from "./Field.tsx";
import { OneStepPage } from "./OneStepPage.tsx";
import { StepFrame } from "./StepFrame.tsx";
import { StepSignInView } from "./StepSignInView.tsx";
import { Textarea } from "./Textarea.tsx";

export type HomeHelpPageViewProps = Omit<ComponentProps<"div">, "children"> & HomeHelpController;

const errorText: Readonly<Record<HelpError, string | undefined>> = {
  HelpNoError: undefined,
  HelpAddressEmpty: "Enter your address.",
  HelpAddressTooLong: "This address is too long. Use 300 characters or fewer.",
  HelpAddressBadChars: "Write the address on one line, with no special characters.",
  HelpTryLater: apiMessages.server,
  HelpRequestFailed: apiMessages.unknown,
};

const Message = ({ title, children }: { title: string; children: ReactNode }) => (
  <StepFrame title={title}>
    <p className="text-foreground">{children}</p>
  </StepFrame>
);

/**
 * The home-help address page: the notice and the one step that the home-help machine shows. Feed it `useHomeHelpPage`.
 * The address of a revealed answer shows only on the revealed step.
 * @model spec/homeHelpPage.md
 */
export function HomeHelpPageView({
  page,
  address,
  revealedAddress,
  siteKey,
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
  onAddressChange,
  onChooseAdd,
  onBackToChoices,
  onSubmitAddress,
  onAskReveal,
  onAskRevoke,
  ...props
}: HomeHelpPageViewProps) {
  const loading = helpBusy(page);
  const error = errorText[page.error];
  const generalError = page.screen === "HelpAddress" ? undefined : error;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!loading) onSubmitAddress();
  };
  const removeButton = (
    <Button variant="ghost" aria-disabled={loading || undefined} onClick={loading ? undefined : onAskRevoke}>
      Remove my address
    </Button>
  );

  const stepFor = (): ReactNode => {
    switch (page.screen) {
      case "HelpOpening":
      case "HelpLoading":
      case "HelpChecking":
        return null;
      case "HelpBadLink":
        return <Message title="This link does not work">Text HOME HELP ADDRESS again for a new link.</Message>;
      case "HelpSignIn":
        return (
          <StepSignInView
            signIn={page.signIn}
            siteKey={siteKey}
            title="Confirm your number"
            lead="Confirm your number to continue with home help."
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
      case "HelpChoose":
        return (
          <StepFrame title="Home-help address">
            <p className="text-foreground">If you asked for help, add your address. If you are helping, show it.</p>
            <div className="flex flex-wrap items-center gap-2" aria-busy={loading || undefined}>
              {helpOffersAdd(page) ? (
                <Button data-focus aria-disabled={loading || undefined} onClick={loading ? undefined : onChooseAdd}>
                  Add my address
                </Button>
              ) : null}
              {helpOffersShow(page) ? (
                <Button variant={helpOffersAdd(page) ? "outline" : "primary"} loading={page.pending === "HelpRevealing"} onClick={loading ? undefined : onAskReveal}>
                  Show the address
                </Button>
              ) : null}
              {helpOffersRemove(page) ? removeButton : null}
            </div>
            {generalError ? <p role="alert" className="text-sm text-destructive">{generalError}</p> : null}
          </StepFrame>
        );
      case "HelpAddress":
        return (
          <StepFrame title="Your address" loading={loading}>
            <p className="text-foreground">Only the people in this plan can read it.</p>
            <form noValidate onSubmit={submit} aria-busy={loading || undefined} className="flex flex-col gap-4">
              <Field label="Address" error={error}>
                <Textarea name="address" autoComplete="street-address" rows={2} required data-focus readOnly={loading}
                  maxLength={homeHelpAddressMax} value={address} onChange={(event) => onAddressChange(event.target.value)} />
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" loading={loading}>
                  {loading ? "Saving…" : "Save address"}
                </Button>
                <Button variant="ghost" aria-disabled={loading || undefined} onClick={loading ? undefined : onBackToChoices}>
                  Back
                </Button>
              </div>
            </form>
          </StepFrame>
        );
      case "HelpSaved":
        return (
          <StepFrame title="Your address is saved">
            <p className="text-foreground">You can remove it at any time from this link.</p>
            {helpOffersRemove(page) ? (
              <div className="flex flex-wrap items-center gap-2" aria-busy={loading || undefined}>
                <Button variant="outline" data-focus loading={page.pending === "HelpRevoking"} onClick={loading ? undefined : onAskRevoke}>
                  Remove my address
                </Button>
              </div>
            ) : null}
            {generalError ? <p role="alert" className="text-sm text-destructive">{generalError}</p> : null}
          </StepFrame>
        );
      case "HelpRevealed":
        return (
          <StepFrame title="The address">
            <p data-address className="text-lg whitespace-pre-wrap break-words text-foreground">{revealedAddress}</p>
          </StepFrame>
        );
      case "HelpRemoved":
        return <Message title="Your address is removed">You cannot add it again for this plan.</Message>;
      case "HelpClosed":
        return <Message title="This step is closed">The plan changed or ended, or this step is not for you.</Message>;
      case "HelpUnavailable":
        return <Message title="Not available">Home help is not available right now.</Message>;
      default: {
        const _exhaustive: never = page.screen;
        return _exhaustive;
      }
    }
  };

  return (
    <OneStepPage stepKey={page.screen} waiting={helpWaiting(page)} notice={page.notice} data-home-help-step={page.screen} {...props}>
      {stepFor()}
    </OneStepPage>
  );
}
