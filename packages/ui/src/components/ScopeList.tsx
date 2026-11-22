// spec/authorizationPages.md, "Each scope shows as one short sentence, never as its scope name"
import type { ComponentProps } from "react";
import { scopeName, scopeText, scopes as knownScopes } from "../../../core/src/generated/authorizationPages.ts";
import { cn } from "../lib/cn.ts";

/** A scope as the connector server names it, for example `apps:read`. The generated `scopeName` gives the name of each known scope. */
export type ScopeId = string;

export type ScopeListProps = Omit<ComponentProps<"ul">, "children"> & {
  /** The scopes to describe, by their server names, in the order they were asked for. */
  scopes: readonly ScopeId[];
};

function textOf(name: ScopeId): string {
  const scope = knownScopes.find((known) => scopeName(known) === name);
  if (scope === undefined) throw new Error(`the consent page cannot describe the scope ${name}`);
  return scopeText(scope);
}

/**
 * What an assistant can do with each scope, as a short sentence per scope, never the raw scope name. A scope that the spec does not describe stops the render, so that no requested scope is hidden.
 * @model spec/authorizationPages.md
 */
export function ScopeList({ scopes, className, ...props }: ScopeListProps) {
  return (
    <ul className={cn("flex list-disc flex-col gap-1 pl-5 text-sm", className)} {...props}>
      {scopes.map((scope) => (
        <li key={scope}>{textOf(scope)}</li>
      ))}
    </ul>
  );
}
