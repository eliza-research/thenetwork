// spec/staffSignIn.md, "Each sign-in phase has one view"
// spec/staffSignIn.md, "A single sign-on viewer signs in again through Cloudflare Access"
// spec/staffSignIn.md, "A failed check can be tried again"
import type { ComponentProps, ReactNode } from "react";
import { type StaffSignIn, canRetryCheck, canSignInAgain, canSubmitToken, signInView } from "../../../../core/src/generated/staffSignIn.ts";
import { cn } from "../../lib/cn.ts";
import { Button } from "../Button.tsx";
import { Spinner } from "../Spinner.tsx";
import { TokenPrompt } from "./TokenPrompt.tsx";

export type SignInNoticeProps = Omit<ComponentProps<"section">, "children"> & {
  /** The sign-in state. The view is the generated `signInView(signIn.phase)`; nothing shows when it is `ShowConsole`. */
  signIn: StaffSignIn;
  /** The text of the token field. */
  token: string;
  onTokenChange: (token: string) => void;
  /** Sends a pasted token: the generated `submitToken`. */
  onSubmitToken: (token: string) => void;
  /** Reloads the console through Cloudflare Access: the generated `signInAgain`. */
  onSignInAgain: () => void;
  /** Asks the server again who the viewer is: the generated `retryCheck`. */
  onRetry: () => void;
  /** The console mark above the panel. */
  brand?: ReactNode;
};

/**
 * The one panel of each sign-in phase before the console shows: loading, the token form, the single sign-on link, no staff role, the second factor, the refused site or the retry.
 * @model spec/staffSignIn.md
 */
export function SignInNotice({ signIn, token, onTokenChange, onSubmitToken, onSignInAgain, onRetry, brand, className, ...props }: SignInNoticeProps) {
  const view = signInView(signIn.phase);
  if (view === "ShowConsole") return null;
  const tokenForm = (
    <TokenPrompt
      value={token}
      onValueChange={onTokenChange}
      canSubmit={canSubmitToken(signIn, token.trim().length)}
      onSubmitToken={onSubmitToken}
      title={view === "ShowNoRole" ? null : undefined}
    />
  );
  const again = canSignInAgain(signIn);
  const heading = (text: string) => <h2 className="text-base font-semibold">{text}</h2>;
  return (
    <section className={cn("mx-auto flex w-full max-w-sm flex-col gap-4 rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm", className)} {...props}>
      {brand ? <div className="flex items-center gap-2 text-sm font-semibold">{brand}</div> : null}
      <div aria-live="polite" className="flex flex-col gap-4 empty:hidden">
        {view === "ShowLoading" ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner size="sm" label="Checking your sign-in" />
            Loading…
          </div>
        ) : null}
        {view === "ShowAccessLink" ? heading("Sign in") : null}
        {view === "ShowNoRole" ? heading("You have no staff role.") : null}
        {view === "ShowSecondFactorNeeded" ? heading("Sign in again with a second factor.") : null}
        {view === "ShowSiteRefused" ? heading("This address cannot open the console.") : null}
        {view === "ShowRetry" ? heading("The server does not answer.") : null}
      </div>
      {view === "ShowTokenForm" ? tokenForm : null}
      {view === "ShowNoRole" && canSubmitToken(signIn, 1) ? tokenForm : null}
      {again ? <Button onClick={onSignInAgain}>{view === "ShowAccessLink" ? "Sign in with single sign-on" : "Sign in again"}</Button> : null}
      {canRetryCheck(signIn) ? <Button onClick={onRetry}>Try again</Button> : null}
    </section>
  );
}
