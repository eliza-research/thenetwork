// spec/authorizationPages.md, "A verified person can choose a separate signup step during connector authorization"
import { signupConsentStartsTicked } from "../../../core/src/generated/authorizationPages.ts";
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
  /** The handler's user-facing error for a refused birthday. */
  birthdateError?: string;
  prefill?: { firstName: string; homeCity?: "nyc" | "sf" };
};

/**
 * Confirm this app's signup and text consent in the verified browser before allowing assistant access.
 * @model spec/authorizationPages.md
 */
export function AuthSignupView({ rid, consent, requiresInvitation, signupView, error, birthdateError, prefill, siteOrigin = "", ...props }: AuthSignupViewProps) {
  return (
    <AuthShell title="Confirm your signup" siteOrigin={siteOrigin} {...props}>
      <form method="post" action="/oauth/authorize/signup" className="flex flex-col gap-4" aria-describedby={error ? "signup-error" : undefined}>
        <input type="hidden" name="rid" value={rid} />
        <input type="hidden" name="decision" value="join" />
        <input type="hidden" name="signupView" value={signupView} />
        <input type="hidden" name="consentVersion" value={consent.version} />
        {prefill?.firstName && !error && !birthdateError ? <p className="text-sm text-muted-foreground">Check the details from your agent, add your birthday and finish.</p> : null}
        <Field label="First name" controlId="signup-first-name">
          <Input name="firstName" type="text" autoComplete="given-name" maxLength={50} required defaultValue={prefill?.firstName || undefined} />
        </Field>
        <Field label="Birthday" controlId="signup-birthdate" error={birthdateError}
          description="If you are under 18, we never match you for dates or for work. Friendship is the only kind of introduction open to people under 18, and only with people close to your own age.">
          <Input name="birthdate" type="date" autoComplete="off" required />
        </Field>
        <Field label="Home city" controlId="signup-home-city">
          <select name="homeCity" defaultValue={prefill?.homeCity ?? ""} required className={`${focusRing} h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground`}>
            <option value="" disabled>Choose your city</option>
            <option value="nyc">New York City</option>
            <option value="sf">San Francisco</option>
          </select>
        </Field>
        <Field label={requiresInvitation ? "Invitation link" : "Invitation link (optional)"} controlId="signup-invitation">
          <Input name="invitation" type="text" autoComplete="off" spellCheck={false} required={requiresInvitation} />
        </Field>
        <div className="flex items-start gap-3">
          <input id="signup-sms-consent" name="smsConsent" type="checkbox" value="yes" required defaultChecked={signupConsentStartsTicked(!!prefill?.firstName)} className={`${focusRing} mt-1 size-4 shrink-0 accent-primary`} />
          <Label htmlFor="signup-sms-consent" className="font-normal">{consent.text}</Label>
        </div>
        <p className="text-sm text-muted-foreground">
          <Link href={`${siteOrigin}/terms#sms`}>Text messaging terms</Link>, <Link href={`${siteOrigin}/terms`}>terms</Link> and <Link href={`${siteOrigin}/privacy`}>privacy policy</Link>.
        </p>
        <FieldError id="signup-error">{error}</FieldError>
        <Button type="submit" size="lg">Finish signup</Button>
      </form>
      <form method="post" action="/oauth/authorize/signup" className="flex flex-col">
        <input type="hidden" name="rid" value={rid} />
        <input type="hidden" name="signupView" value={signupView} />
        <Button type="submit" variant="outline" size="lg" name="decision" value="skip">Back to connection</Button>
      </form>
    </AuthShell>
  );
}
