// spec/staffSignIn.md, "The token form accepts a pasted token and checks it again"
import { type ComponentProps, useId } from "react";
import { cn } from "../../lib/cn.ts";
import { Button } from "../Button.tsx";
import { Input } from "../Input.tsx";

export type TokenPromptProps = Omit<ComponentProps<"form">, "onSubmit" | "children" | "title"> & {
  /** The pasted token. It stays in the field until the form is sent. */
  value: string;
  onValueChange: (value: string) => void;
  /** True when the token can go: the generated `canSubmitToken(signIn, value.trim().length)`. */
  canSubmit: boolean;
  /** Sends the token: the generated `submitToken`, which starts a new identity check. */
  onSubmitToken: (token: string) => void;
  /** The one heading of the form; null leaves it out where the view has its own heading. */
  title?: string | null;
  placeholder?: string;
  /** The accessible name of the field. */
  inputLabel?: string;
  submitLabel?: string;
};

/**
 * The staff token form: a password field and one button that works only when the field holds text.
 * @model spec/staffSignIn.md
 */
export function TokenPrompt({
  value,
  onValueChange,
  canSubmit,
  onSubmitToken,
  title = "Token required",
  placeholder = "Paste token",
  inputLabel = "Observatory token",
  submitLabel = "Use",
  className,
  ...props
}: TokenPromptProps) {
  const headingId = useId();
  return (
    <form
      aria-labelledby={title ? headingId : undefined}
      aria-label={title ? undefined : inputLabel}
      className={cn("flex flex-col gap-3", className)}
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) onSubmitToken(value.trim());
      }}
      {...props}
    >
      {title ? (
        <h2 id={headingId} className="text-base font-semibold">
          {title}
        </h2>
      ) : null}
      <div className="flex gap-2">
        <Input type="password" autoFocus autoComplete="off" placeholder={placeholder} aria-label={inputLabel} value={value} onChange={(event) => onValueChange(event.target.value)} />
        <Button type="submit" disabled={!canSubmit}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
