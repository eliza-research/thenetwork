// spec/browserJoin.md, "The page sends the profile only with a name, an age from 1 to 120 and the text consent ticked"
import { type ComponentProps, type FormEvent, useId } from "react";
import { Button } from "./Button.tsx";
import { Checkbox } from "./Checkbox.tsx";
import { Field } from "./Field.tsx";
import { FieldError } from "./FieldError.tsx";
import { Input } from "./Input.tsx";
import { Label } from "./Label.tsx";
import { Link } from "./Link.tsx";
import { StepFrame } from "./StepFrame.tsx";

/** The fields of the profile form, as the person typed them. */
export interface ProfileValues {
  firstName: string;
  age: string;
  consent: boolean;
}

export type ProfileStepProps = Omit<ComponentProps<"section">, "children" | "title"> & {
  values: ProfileValues;
  onValuesChange: (values: Partial<ProfileValues>) => void;
  /** The minimum join age that the age hint shows. */
  minJoinAge: number;
  /** The site's text-message consent; the page sends this exact text with the profile. */
  consentText: string;
  /** A request runs: the controls refuse input but keep focus, and the button shows its busy label. */
  loading?: boolean;
  /** Why the page did not send the profile, or why the server refused it. */
  error?: string;
  onSubmitProfile: () => void;
};

/**
 * The join step where a person checks their first name and age and agrees to the texts.
 * @model spec/browserJoin.md
 */
export function ProfileStep({ values, onValuesChange, minJoinAge, consentText, loading = false, error, onSubmitProfile, ...props }: ProfileStepProps) {
  const consentId = useId();
  const errorId = useId();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!loading) onSubmitProfile();
  };
  return (
    <StepFrame title="Confirm your details" loading={loading} {...props}>
      <form noValidate onSubmit={submit} aria-busy={loading || undefined} aria-describedby={error ? errorId : undefined} className="flex flex-col gap-4">
        <Field label="First name">
          <Input name="firstName" type="text" autoComplete="given-name" required data-focus readOnly={loading} value={values.firstName} onChange={(event) => onValuesChange({ firstName: event.target.value })} />
        </Field>
        <Field label="Age" description={`Join at ${minJoinAge}+. Matching is 18+ only.`}>
          <Input name="age" type="number" inputMode="numeric" min={1} max={120} required readOnly={loading} value={values.age} onChange={(event) => onValuesChange({ age: event.target.value })} />
        </Field>
        <div className="flex items-start gap-3">
          <Checkbox
            id={consentId}
            name="consent"
            required
            aria-disabled={loading || undefined}
            checked={values.consent}
            onCheckedChange={loading ? undefined : (checked) => onValuesChange({ consent: checked === true })}
            className="mt-1 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
          />
          <Label htmlFor={consentId} className="font-normal">
            {consentText}
          </Label>
        </div>
        <p className="text-sm text-muted-foreground">
          See the <Link href="/terms#sms">text messaging terms</Link>, <Link href="/terms">terms</Link> and <Link href="/privacy">privacy policy</Link>.
        </p>
        <FieldError id={errorId}>{error}</FieldError>
        <Button type="submit" loading={loading} className="self-start">
          {loading ? "Saving…" : "Join"}
        </Button>
      </form>
    </StepFrame>
  );
}
