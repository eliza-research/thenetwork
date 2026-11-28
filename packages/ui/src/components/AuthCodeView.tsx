// spec/authorizationPages.md, "The code page appears only after this request sent a code"
import { chromeFor, type FieldError, offersFor } from "../../../core/src/generated/authorizationPages.ts";
import type { AuthShellProps } from "./AuthShell.tsx";
import { AuthShell } from "./AuthShell.tsx";
import { Button } from "./Button.tsx";
import { Field } from "./Field.tsx";
import { Input } from "./Input.tsx";
import { VisuallyHidden } from "./VisuallyHidden.tsx";

/** A field error or resend status that can show on the code page. */
export type CodeFieldError = Extract<FieldError, "NoFieldError" | "CodeNotAccepted" | "CodeResent" | "CodeResendRateLimited" | "CodeResendFailed">;

const errorText: Record<CodeFieldError, string | undefined> = {
  NoFieldError: undefined,
  CodeResent: undefined,
  CodeNotAccepted: "That code did not work. Check the newest text and try again.",
  CodeResendRateLimited: "Too many codes right now. Wait a few minutes and try again.",
  CodeResendFailed: "We could not send a new code right now. Try again in a moment.",
};

export type AuthCodeViewProps = Omit<AuthShellProps, "title" | "chrome" | "children"> & {
  /** The id of the stored authorization request, sent back with each form. */
  rid: string;
  /** The last four digits of the phone number that got the code. */
  last4: string;
  /** Why the last code or resend reply stayed on this page: the generated `errorFor` of the reply. */
  fieldError?: CodeFieldError;
};

/**
 * The code page of connector sign-in: where the code went, one code field, "Continue", "Resend code", "Use a different number" and "Cancel".
 * @model spec/authorizationPages.md
 */
export function AuthCodeView({ rid, last4, fieldError = "NoFieldError", ...props }: AuthCodeViewProps) {
  const offers = offersFor("CodeView");
  return (
    <AuthShell title="Enter your code" chrome={chromeFor("CodeView")} {...props}>
      <div className="flex flex-col gap-1">
        <p>Sent to ••• {last4}.</p>
        {fieldError === "CodeResent" ? (
          <p role="status" className="text-sm text-muted-foreground">
            We sent a new code.
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-3">
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
        {offers.resendCode || offers.changeNumber ? (
          <div className="flex flex-wrap items-center gap-2">
            {offers.resendCode ? (
              <form method="post" action="/oauth/authorize/resend">
                <input type="hidden" name="rid" value={rid} />
                <Button type="submit" variant="ghost">
                  Resend code
                </Button>
              </form>
            ) : null}
            {offers.changeNumber ? (
              <form method="post" action="/oauth/authorize/change-phone">
                <input type="hidden" name="rid" value={rid} />
                <Button type="submit" variant="ghost">
                  Use a different number
                </Button>
              </form>
            ) : null}
          </div>
        ) : null}
      </div>
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
