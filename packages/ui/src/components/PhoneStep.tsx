// spec/browserJoin.md, "The phone step shows its parts from the sign-in mode"
import { type ComponentProps, type FormEvent, type ReactNode, useId } from "react";
import { type PhoneButton, phoneStepParts } from "../../../core/src/generated/browserJoin.ts";
import { Button } from "./Button.tsx";
import { Field } from "./Field.tsx";
import { FieldError } from "./FieldError.tsx";
import { PhoneInput } from "./PhoneInput.tsx";
import { StepFrame } from "./StepFrame.tsx";

export type PhoneStepProps = Omit<ComponentProps<"section">, "children" | "title"> & {
  /** The page waits for the sign-in mode: the form is busy. From `phoneFormWaiting`. */
  formWaiting?: boolean;
  /** The text-code sign-in: the step asks for a number. From `showsNumberForm`. */
  numberForm?: boolean;
  /** The cloud sign-in: the step shows one button and no number field. From `showsCloudButton`. */
  cloudButton?: boolean;
  /** A request runs: the controls are off and the button shows its busy label. */
  loading?: boolean;
  /** The number as the person typed it. */
  phone: string;
  onPhoneChange: (phone: string) => void;
  /** Why the page did not send the number, or why the server refused it. */
  error?: string;
  /** The security check, a `SecurityCheck`, shown above the button with the number form. */
  check?: ReactNode;
  onSubmitPhone: () => void;
  onContinueWithPhone: () => void;
};

const buttonText: Record<PhoneButton, string> = {
  PhoneButtonWaiting: "Loading sign-in…",
  PhoneButtonOpening: "Opening…",
  PhoneButtonCloud: "Continue with your phone",
  PhoneButtonSending: "Sending…",
  PhoneButtonSend: "Text me a code",
};

/**
 * The join step where a person types their own number to get a code, or leaves for the cloud sign-in. The generated `phoneStepParts` gives each part.
 * @model spec/browserJoin.md
 */
export function PhoneStep({ formWaiting = false, numberForm = false, cloudButton = false, loading = false, phone, onPhoneChange, error, check, onSubmitPhone, onContinueWithPhone, ...props }: PhoneStepProps) {
  const errorId = useId();
  const parts = phoneStepParts(formWaiting, numberForm, cloudButton, loading);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (parts.submit === "ContinueWithCloud") onContinueWithPhone();
    else if (parts.submit === "SendTheNumber") onSubmitPhone();
  };
  return (
    <StepFrame title="Confirm your phone number" loading={parts.busy} {...props}>
      <form noValidate onSubmit={submit} aria-busy={parts.busy || undefined} className="flex flex-col gap-4">
        {parts.numberField ? (
          <Field label="Mobile number">
            <PhoneInput name="phone" placeholder="(212) 555-0123" required data-focus disabled={formWaiting} readOnly={loading} aria-describedby={error ? errorId : undefined} value={phone} onChange={(event) => onPhoneChange(event.target.value)} />
          </Field>
        ) : null}
        {parts.check ? check : null}
        <FieldError id={errorId}>{error}</FieldError>
        <Button type="submit" loading={parts.busy} disabled={formWaiting} className="self-start">
          {buttonText[parts.button]}
        </Button>
      </form>
    </StepFrame>
  );
}
