// spec/browserJoin.md, "The page sends a number only when it is valid and the security check passed"
import { Input, type InputProps } from "./Input.tsx";

export type PhoneInputProps = Omit<InputProps, "type" | "inputMode">;

/** A field for a mobile number, which the browser can fill from the person's own number. Name it with a `Field` or `aria-label`. */
export function PhoneInput({ autoComplete = "tel", ...props }: PhoneInputProps) {
  return <Input type="tel" inputMode="tel" autoComplete={autoComplete} {...props} />;
}
