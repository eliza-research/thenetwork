// spec/connectedAssistants.md, "A grant card names the assistant as its claim and shows its date and scopes"
import { useId } from "react";
import { brandFor } from "../../../core/src/generated/brandIdentity.ts";
import { type ConsentsView, chromeFor, grantCard, offersFor } from "../../../core/src/generated/connectedAssistants.ts";
import { Alert } from "./Alert.tsx";
import { AuthMessageView } from "./AuthMessageView.tsx";
import type { AuthShellProps } from "./AuthShell.tsx";
import { AuthShell } from "./AuthShell.tsx";
import { Button } from "./Button.tsx";
import { Card } from "./Card.tsx";
import { EmptyState } from "./EmptyState.tsx";
import { type ScopeId, ScopeList } from "./ScopeList.tsx";

/** One live grant of the person's phone in this app. */
export interface GrantSummary {
  /** The grant id that the remove forms send. */
  id: string;
  /** The name the assistant gave for itself, or null when it gave none. */
  clientName: string | null;
  /** The date of the approval, as `YYYY-MM-DD`. */
  allowedOn: string;
  /** The approved scopes. */
  scopes: readonly ScopeId[];
}

export type ConnectedAssistantsViewProps = Omit<AuthShellProps, "title" | "chrome" | "children"> & {
  /** The view of the page model. */
  view: ConsentsView;
  /** The live grants; the list shows them in this order. */
  grants?: readonly GrantSummary[];
  /** Shows "Access removed." after a confirmed removal ended a grant. */
  notice?: boolean;
  /** The grant that waits for the person to confirm its removal. */
  confirmingGrantId?: string;
  removalProof?: string;
  /** The page itself: "Remove access" sends `remove` here with GET, "Keep access" and "Try again" open it. */
  pageHref?: string;
  /** Where the confirmed removal posts `grant`. */
  revokeAction?: string;
};

/**
 * The "Connected assistants" page: each assistant that can use the person's account in this app, with a two-step "Remove access".
 * @model spec/connectedAssistants.md
 */
export function ConnectedAssistantsView({
  view,
  grants = [],
  notice = false,
  confirmingGrantId,
  removalProof,
  pageHref = "/oauth/consents",
  revokeAction = "/oauth/consents/revoke",
  ...props
}: ConnectedAssistantsViewProps) {
  const nameId = useId();
  if (view === "Loading") return null;
  if (view === "SignInFirstView" || view === "RetryLaterView" || view === "NotAllowedView") return <AuthMessageView view={view} retryHref={pageHref} {...props} />;
  const offers = offersFor(view);
  return (
    <AuthShell title="Connected assistants" chrome={chromeFor(view)} {...props}>
      {notice ? <Alert variant="ok">Access removed.</Alert> : null}
      {view === "EmptyView" ? (
        <EmptyState title={`No assistant has access to your ${brandFor(props.app).name} account.`} />
      ) : (
        <ul className="flex flex-col gap-4">
          {grants.map((grant, index) => {
            const card = grantCard(grant.clientName !== null);
            const confirming = offers.confirmRemove && grant.id === confirmingGrantId;
            const assistantId = `${nameId}-${index}`;
            return (
              <li key={grant.id}>
                <Card className="gap-3 p-4">
                  <p id={assistantId}>
                    <strong>{card.assistant === "NamedByItself" && grant.clientName !== null ? grant.clientName : "An unnamed assistant"}</strong>
                    {card.claimNote ? " (as it calls itself)" : null}
                  </p>
                  {card.allowedDate ? (
                    <p className="text-sm text-muted-foreground">
                      Allowed <time dateTime={grant.allowedOn}>{grant.allowedOn}</time>
                    </p>
                  ) : null}
                  {card.scopeList ? <ScopeList scopes={grant.scopes} /> : null}
                  {card.removeButton && offers.removeAccess ? (
                    <form method="get" action={pageHref}>
                      <input type="hidden" name="remove" value={grant.id} />
                      <Button type="submit" variant="outline" aria-describedby={assistantId}>
                        Remove access
                      </Button>
                    </form>
                  ) : null}
                  {confirming ? (
                    <div className="flex flex-wrap gap-3">
                      <form method="post" action={revokeAction}>
                        <input type="hidden" name="grant" value={grant.id} />
                        <input type="hidden" name="confirmation" value={removalProof} />
                        <Button type="submit" variant="destructive" aria-describedby={assistantId}>
                          Remove access
                        </Button>
                      </form>
                      {offers.keepAccess ? (
                        <Button asChild variant="outline">
                          <a href={pageHref} autoFocus>
                            Keep access
                          </a>
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </AuthShell>
  );
}
