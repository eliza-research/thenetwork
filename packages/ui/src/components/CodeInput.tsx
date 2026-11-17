// spec/browserJoin.md, "Only a well-formed code goes to the server, and only a verified code signs the person in"
import { Input, type InputProps } from "./Input.tsx";

export type CodeInputProps = Omit<InputProps, "type" | "inputMode" | "autoComplete">;

/** A field for a one-time code from a text, which the device can fill from the message. Name it with a `Field` or `aria-label`. */
export function CodeInput({ maxLength = 8, ...props }: CodeInputProps) {
  return <Input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={maxLength} {...props} />;
}
