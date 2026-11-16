// spec/browserJoin.md, "Only a well-formed code goes to the server, and only a verified code signs the person in"
import { type ComponentProps, type FormEvent, useId } from "react";
import { Button } from "./Button.tsx";
import { CodeInput } from "./CodeInput.tsx";
import { Field } from "./Field.tsx";
import { FieldError } from "./FieldError.tsx";
import { StepFrame } from "./StepFrame.tsx";

export type CodeStepProps = Omit<ComponentProps<"section">, "children" | "title"> & {
  /** The number that got the code, with only its last four digits shown. */
  phoneShown: string;
  /** The code as the person typed it. */
  code: string;
  onCodeChange: (code: string) => void;
  /** A request runs: the controls refuse input but keep focus, and the button shows its busy label. */
  loading?: boolean;
  /** Why the page did not send the code, or why the server refused it. */
  error?: string;
  /** The server sent a new code. */
  resent?: boolean;
  onSubmitCode: () => void;
  onResend: () => void;
  onChangeNumber: () => void;
};

/**
 * The join step where a person types the code from the text.
 * @model spec/browserJoin.md
 */
export function CodeStep({ phoneShown, code, onCodeChange, loading = false, error, resent = false, onSubmitCode, onResend, onChangeNumber, ...props }: CodeStepProps) {
  const errorId = useId();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!loading) onSubmitCode();
  };
  return (
    <StepFrame title="Enter the code" loading={loading} {...props}>
      <p className="text-foreground">
        Sent to <strong>{phoneShown}</strong>.
      </p>
      <form noValidate onSubmit={submit} aria-busy={loading || undefined} className="flex flex-col gap-4">
        <Field label="Code">
          <CodeInput name="code" required data-focus readOnly={loading} aria-describedby={error ? errorId : undefined} invalid={error !== undefined} value={code} onChange={(event) => onCodeChange(event.target.value)} />
        </Field>
        <FieldError id={errorId}>{error}</FieldError>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" loading={loading}>
            {loading ? "Checking…" : "Continue"}
          </Button>
          <Button variant="ghost" aria-disabled={loading || undefined} onClick={loading ? undefined : onResend}>
            Resend code
          </Button>
          <Button variant="ghost" aria-disabled={loading || undefined} onClick={loading ? undefined : onChangeNumber}>
            Change number
          </Button>
        </div>
        <p role="status" className="text-sm text-muted-foreground">
          {resent ? "We sent a new code." : null}
        </p>
      </form>
    </StepFrame>
  );
}
