// spec/browserJoin.md, "After sign-in the page reads the session again and shows its step"
import type { FlowNotice as FlowNoticeState } from "../../../core/src/generated/browserJoin.ts";
import { apiMessages } from "../api/client.ts";
import { Alert, type AlertProps } from "./Alert.tsx";

export type FlowNoticeProps = Omit<AlertProps, "children" | "variant"> & {
  /** The notice of the join machine; "NoNotice" shows nothing. */
  notice: FlowNoticeState;
};

const notices: Readonly<Record<Exclude<FlowNoticeState, "NoNotice">, string>> = {
  ApiUnreachable: apiMessages.api_unreachable,
  SessionEnded: apiMessages.unauthorized,
  AccountChanged: apiMessages.account_changed,
};

/**
 * The notice above the join steps: the server cannot be reached, the session ended or the account changed.
 * @model spec/browserJoin.md
 */
export function FlowNotice({ notice, ...props }: FlowNoticeProps) {
  if (notice === "NoNotice") return null;
  return (
    <Alert variant="warn" {...props}>
      {notices[notice]}
    </Alert>
  );
}
