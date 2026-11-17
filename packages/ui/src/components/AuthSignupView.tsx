// spec/authorizationPages.md, "A verified person can choose a separate signup step during connector authorization"
import { focusRing } from "../lib/cn.ts";
import { AuthShell, type AuthShellProps } from "./AuthShell.tsx";
import { Button } from "./Button.tsx";
import { Field } from "./Field.tsx";
import { FieldError } from "./FieldError.tsx";
import { Input } from "./Input.tsx";
import { Label } from "./Label.tsx";
import { Link } from "./Link.tsx";

export type AuthSignupViewProps = Omit<AuthShellProps, "title" | "chrome" | "children"> & {
  /** The pending OAuth browser request. */
  rid: string;
  /** The app's current text-message consent and its version. */
  consent: { text: string; version: string };
  /** Whether the app requires an invitation for signup. */
  requiresInvitation: boolean;
  /** The server's proof for this page and this browser request. */
  signupView: string;
  /** The handler's user-facing error for a rejected signup. */
  error?: string;
};

/**
 * Confirm this app's signup and text consent in the verified browser before allowing assistant access.
 * @model spec/authorizationPages.md
 */
export function AuthSignupView({ rid, consent, requiresInvitation, signupView, error, ...props }: AuthSignupViewProps) {
  return (
    <AuthShell title="Confirm your signup" {...props}>
      <form method="post" action="/oauth/authorize/signup" className="flex flex-col gap-4" aria-describedby={error ? "signup-error" : undefined}>
        <input type="hidden" name="rid" value={rid} />
        <input type="hidden" name="decision" value="join" />
        <input type="hidden" name="signupView" value={signupView} />
        <input type="hidden" name="consentVersion" value={consent.version} />
        <Field label="First name" controlId="signup-first-name">
          <Input name="firstName" type="text" autoComplete="given-name" maxLength={50} required />
        </Field>
        <Field label="Age" controlId="signup-age">
          <Input name="age" type="number" inputMode="numeric" min={1} max={120} step={1} required />
        </Field>
        <Field label="Home city" controlId="signup-home-city">
          <select name="homeCity" defaultValue="" required className={`${focusRing} h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground`}>
            <option value="" disabled>Choose your city</option>
            <option value="nyc">New York City</option>
            <option value="sf">San Francisco</option>
          </select>
        </Field>
        <Field label={requiresInvitation ? "Invitation link" : "Invitation link (optional)"} controlId="signup-invitation">
          <Input name="invitation" type="text" autoComplete="off" spellCheck={false} required={requiresInvitation} />
        </Field>
        <div className="flex items-start gap-3">
          <input id="signup-sms-consent" name="smsConsent" type="checkbox" value="yes" required className={`${focusRing} mt-1 size-4 shrink-0 accent-primary`} />
          <Label htmlFor="signup-sms-consent" className="font-normal">{consent.text}</Label>
        </div>
        <p className="text-sm text-muted-foreground">
          <Link href="/terms#sms">Text messaging terms</Link>, <Link href="/terms">terms</Link> and <Link href="/privacy">privacy policy</Link>.
        </p>
        <FieldError id="signup-error">{error}</FieldError>
        <Button type="submit" size="lg">Confirm signup</Button>
      </form>
      <form method="post" action="/oauth/authorize/signup" className="flex flex-col">
        <input type="hidden" name="rid" value={rid} />
        <input type="hidden" name="signupView" value={signupView} />
        <Button type="submit" variant="outline" size="lg" name="decision" value="skip">Back to connection</Button>
      </form>
    </AuthShell>
  );
}
