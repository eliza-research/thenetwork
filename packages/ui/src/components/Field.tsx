import { type ComponentProps, type ReactElement, type ReactNode, useId } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "../lib/cn.ts";
import { Label } from "./Label.tsx";

export type FieldProps = Omit<ComponentProps<"div">, "children"> & {
  /** The name of the control, shown above it and given to it as its accessible name. */
  label: ReactNode;
  /** A short hint below the control, given to it as its description. */
  description?: ReactNode;
  /** Why the value is refused. It marks the control invalid and is given to it as its description. */
  error?: ReactNode;
  /** The id of the control; a generated id when left out. */
  controlId?: string;
  /** The one control: an `Input`, `Textarea`, `Select`, `Checkbox` or `RadioGroup`. It receives `id`, `aria-labelledby`, `aria-describedby` and `aria-invalid`. */
  children: ReactElement;
};

/** A control with its label, hint and error, wired together by ids so that a screen reader reads them as one. */
export function Field({ label, description, error, controlId, className, children, ...props }: FieldProps) {
  const generatedId = useId();
  const id = controlId ?? generatedId;
  const labelId = `${id}-label`;
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  const describedBy = [description ? descriptionId : undefined, error ? errorId : undefined].filter((part) => part !== undefined).join(" ");
  const control = { id, "aria-labelledby": labelId, ...(describedBy ? { "aria-describedby": describedBy } : {}), ...(error ? { "aria-invalid": true } : {}) };
  return (
    <div className={cn("flex flex-col gap-2", className)} {...props}>
      <Label id={labelId} htmlFor={id}>
        {label}
      </Label>
      <Slot {...control}>{children}</Slot>
      {description ? (
        <p id={descriptionId} className="text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
