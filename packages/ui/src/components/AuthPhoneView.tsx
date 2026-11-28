// spec/authorizationPages.md, "The phone page sends a code or tells why it did not"
import { checkFor, chromeFor, type FieldError, offersFor } from "../../../core/src/generated/authorizationPages.ts";
import type { AuthShellProps } from "./AuthShell.tsx";
import { AuthShell } from "./AuthShell.tsx";
import { Button } from "./Button.tsx";
import { Field } from "./Field.tsx";
import { Input } from "./Input.tsx";

/** A field error that can show on the phone page. */
export type PhoneFieldError = Extract<FieldError, "NoFieldError" | "CheckNotPassed" | "PhoneNotValid" | "CodesRateLimited" | "CodeSendFailed">;

const errorText: Record<PhoneFieldError, string | undefined> = {
  NoFieldError: undefined,
  CheckNotPassed: "Please complete the check and try again.",
  PhoneNotValid: "Enter a US or Canada phone number.",
  CodesRateLimited: "Too many codes were asked for. Please wait and try again.",
  CodeSendFailed: "Sign-in is not available for this app right now.",
};

export type AuthPhoneViewProps = Omit<AuthShellProps, "title" | "chrome" | "children"> & {
  /** The id of the stored authorization request, sent back with each form. */
  rid: string;
  /** Why the last phone number was refused: the generated `errorFor` of the reply. */
  fieldError?: PhoneFieldError;
  /** The Turnstile site key when the site has a security check. */
  turnstileSiteKey?: string;
};

/**
 * The phone page of connector sign-in: one phone field, the security check when the site has one, "Text me a code" and "Cancel".
 * @model spec/authorizationPages.md
 */
export function AuthPhoneView({ rid, fieldError = "NoFieldError", turnstileSiteKey, ...props }: AuthPhoneViewProps) {
  const offers = offersFor("PhoneView");
  const check = checkFor("PhoneView", turnstileSiteKey !== undefined);
  return (
    <AuthShell title="Confirm your phone number" chrome={chromeFor("PhoneView")} {...props}>
      <form method="post" action="/oauth/authorize/phone" className="flex flex-col gap-4">
        <input type="hidden" name="rid" value={rid} />
        <Field label="Your phone number" controlId="phone" error={errorText[fieldError]}>
          <Input name="phone" type="tel" autoComplete="tel" inputMode="tel" required autoFocus={fieldError !== "NoFieldError"} maxLength={40} placeholder="(212) 555-0100" className="h-10 text-base" />
        </Field>
        {check !== "CheckOff" ? <div className="cf-turnstile" data-sitekey={turnstileSiteKey} /> : null}
        {offers.sendCode ? (
          <Button type="submit" size="lg">
            Text me a code
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
