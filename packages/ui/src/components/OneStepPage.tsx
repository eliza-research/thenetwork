// spec/oneStepPage.md, "A step page shows one shared notice above the step"
import { type ComponentProps, type ReactNode, useCallback, useRef } from "react";
import { oneStepNoticeShown, type StepNotice } from "../../../core/src/generated/oneStepPage.ts";
import { apiMessages } from "../api/client.ts";
import { cn } from "../lib/cn.ts";
import { Alert } from "./Alert.tsx";
import { Spinner } from "./Spinner.tsx";

export type OneStepPageProps = Omit<ComponentProps<"div">, "children"> & {
  /** The current screen of the page machine: a new value moves focus to the new step. */
  stepKey: string;
  /** The page waits: it shows a spinner in place of the step. */
  waiting?: boolean;
  /** The shared notice above the step. */
  notice?: StepNotice;
  /** The one step that the page machine shows. */
  children?: ReactNode;
};

const notices: Readonly<Record<Exclude<StepNotice, "NoStepNotice">, string>> = {
  StepUnreachable: apiMessages.api_unreachable,
  StepSessionEnded: apiMessages.unauthorized,
  StepSignInAgain: "For your safety, sign in again with your current number.",
};

/**
 * The content column of a one-step page inside `PageShell`: the shared notice, then the one step.
 * Focus moves to each new step after the first one: to its first field, or to its heading when it has no field.
 * @model spec/oneStepPage.md
 */
export function OneStepPage({ stepKey, waiting = false, notice = "NoStepNotice", className, children, ...props }: OneStepPageProps) {
  const firstStepRef = useRef<HTMLElement | null>(null);
  const focusStep = useCallback((element: HTMLDivElement | null) => {
    if (!element || element.dataset.waiting !== undefined) return;
    if (firstStepRef.current === null) firstStepRef.current = element;
    if (firstStepRef.current === element) return;
    const field = element.querySelector<HTMLElement>("[data-focus]:not(:disabled)");
    if (field) return field.focus();
    element.querySelector<HTMLElement>("h1")?.focus();
  }, []);
  return (
    <div className={cn("mx-auto flex w-full max-w-sm flex-col gap-6", className)} {...props}>
      {notice !== "NoStepNotice" && oneStepNoticeShown(notice) ? <Alert variant="warn">{notices[notice]}</Alert> : null}
      <div key={stepKey} ref={focusStep} data-step={stepKey} data-waiting={waiting ? "" : undefined}>
        {waiting ? <Spinner size="md" className="text-muted-foreground" /> : children}
      </div>
    </div>
  );
}
