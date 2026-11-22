// spec/authorizationPages.md, "The consent page names the client as its claim and lists every scope"
import { type AuthView, chromeFor, consentParts, offersFor, offersSignupConfirmation, showsSignupConfirmation } from "../../../core/src/generated/authorizationPages.ts";
import { Alert } from "./Alert.tsx";
import type { AuthShellProps } from "./AuthShell.tsx";
import { AuthShell } from "./AuthShell.tsx";
import { Button } from "./Button.tsx";
import { Card } from "./Card.tsx";
import { type ScopeId, ScopeList } from "./ScopeList.tsx";

export type ConsentViewProps = Omit<AuthShellProps, "title" | "chrome" | "children"> & {
  /** `ConsentRetryView` when the last approval could not be checked and the person can try again. */
  view?: Extract<AuthView, "ConsentView" | "ConsentRetryView">;
  /** The id of the stored authorization request, sent back with the form. */
  rid: string;
  /** The name the assistant gave for itself, or null when it gave none. */
  clientName: string | null;
  /** The host that the browser returns to. */
  redirectHost: string;
  /** Every scope that the assistant asks for. */
  scopes: readonly ScopeId[];
  /** The server permits the verified person to finish signup during this request. */
  canSignup?: boolean;
  /** The site confirmed signup before returning to connector consent. */
  signupSaved?: boolean;
  /** The server's proof that this browser can decide about the connector after signup. */
  signupApproval?: string;
};

/**
 * The consent page of a connector: the assistant's name as its own claim, the return host, what it can do, "Allow" and "Don't allow".
 * @model spec/authorizationPages.md
 */
export function ConsentView({ view = "ConsentView", rid, clientName, redirectHost, scopes, canSignup = false, signupSaved = false, signupApproval, ...props }: ConsentViewProps) {
  const parts = consentParts(view, clientName !== null);
  const offers = offersFor(view);
  const client = parts.client === "ProvidedName" && clientName !== null ? clientName : "An unnamed assistant";
  return (
    <AuthShell title="Allow this assistant?" chrome={chromeFor(view)} {...props}>
      {showsSignupConfirmation(view, signupSaved) ? <Alert variant="ok">Signup confirmed.</Alert> : null}
      <div className="flex flex-col gap-1">
        <p>
          <strong>{client}</strong>
          {parts.claimNote ? " (the name it provided)" : null}
        </p>
        {parts.returnHost ? <p className="text-sm text-muted-foreground">Return to {redirectHost}.</p> : null}
      </div>
      {parts.unavailableNotice ? (
        <Alert variant="warn">We can’t check your connection right now. Wait a moment, then try again below, or return to your agent or text conversation.</Alert>
      ) : null}
      {parts.scopeList ? (
        <Card className="gap-2 p-4">
          <p>It will be able to:</p>
          <ScopeList scopes={scopes} />
        </Card>
      ) : null}
      <form method="post" action="/oauth/authorize/consent" className="flex flex-wrap gap-3">
        <input type="hidden" name="rid" value={rid} />
        {signupApproval ? <input type="hidden" name="signupApproval" value={signupApproval} /> : null}
        {offers.allow || offers.retryAllow ? (
          <Button type="submit" size="lg" name="decision" value="approve">
            {offers.retryAllow ? "Try again" : "Allow"}
          </Button>
        ) : null}
        {offers.dontAllow ? (
          <Button type="submit" variant="outline" size="lg" name="decision" value="deny">
            Don't allow
          </Button>
        ) : null}
      </form>
      {offersSignupConfirmation(view, canSignup) ? (
        <form method="post" action="/oauth/authorize/signup">
          <input type="hidden" name="rid" value={rid} />
          <Button type="submit" variant="outline" size="lg" name="decision" value="open">Finish signup</Button>
        </form>
      ) : null}
    </AuthShell>
  );
}
