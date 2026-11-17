// spec/authorizationPages.md, "The code page appears only after this request sent a code"
import { chromeFor, type FieldError, offersFor } from "../../../core/src/generated/authorizationPages.ts";
import type { AuthShellProps } from "./AuthShell.tsx";
import { AuthShell } from "./AuthShell.tsx";
import { Button } from "./Button.tsx";
import { Field } from "./Field.tsx";
import { Input } from "./Input.tsx";
import { VisuallyHidden } from "./VisuallyHidden.tsx";

/** A field error that can show on the code page. */
export type CodeFieldError = Extract<FieldError, "NoFieldError" | "CodeNotAccepted">;

const errorText: Record<CodeFieldError, string | undefined> = {
  NoFieldError: undefined,
  CodeNotAccepted: "That code did not work. Check the newest text and try again.",
};

export type AuthCodeViewProps = Omit<AuthShellProps, "title" | "chrome" | "children"> & {
  /** The id of the stored authorization request, sent back with each form. */
  rid: string;
  /** The last four digits of the phone number that got the code. */
  last4: string;
  /** Why the last code was refused: the generated `errorFor` of the reply. */
  fieldError?: CodeFieldError;
};

/**
 * The code page of connector sign-in: where the code went, one code field, "Continue" and "Cancel".
 * @model spec/authorizationPages.md
 */
export function AuthCodeView({ rid, last4, fieldError = "NoFieldError", ...props }: AuthCodeViewProps) {
  const offers = offersFor("CodeView");
  return (
    <AuthShell title="Enter your code" chrome={chromeFor("CodeView")} {...props}>
      <p>Sent to ••• {last4}.</p>
      <form method="post" action="/oauth/authorize/code" className="flex flex-col gap-4">
        <input type="hidden" name="rid" value={rid} />
        <Field label={<VisuallyHidden>Code</VisuallyHidden>} controlId="code" error={errorText[fieldError]}>
          <Input name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={10} required autoFocus className="h-10 text-base" />
        </Field>
        {offers.continueCode ? (
          <Button type="submit" size="lg">
            Continue
          </Button>
        ) : null}
      </form>
      {offers.cancel ? (
        <form method="post" action="/oauth/authorize/cancel" className="flex flex-col">
          <input type="hidden" name="rid" value={rid} />
          <Button type="submit" variant="outline" size="lg" name="decision" value="deny">
            Cancel
          </Button>
        </form>
      ) : null}
    </AuthShell>
  );
}
