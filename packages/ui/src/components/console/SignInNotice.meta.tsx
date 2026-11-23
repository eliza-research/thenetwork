import { clearAllMocks, expect, userEvent, within } from "storybook/test";
import { initial } from "../../../../core/src/generated/staffSignIn.ts";
import type { ComponentMeta } from "../../lib/meta.ts";
import type { SignInNoticeProps } from "./SignInNotice.tsx";

type Context = { args: SignInNoticeProps; canvasElement: HTMLElement };

const asking = { ...initial, phase: "AskingToken" as const, tokenInAddress: false };

const presses = (name: string, handler: "onSignInAgain" | "onRetry") => async ({ args, canvasElement }: Context) => {
  clearAllMocks();
  await userEvent.click(within(canvasElement).getByRole("button", { name }));
  await expect(args[handler]).toHaveBeenCalledTimes(1);
};

const heading = (text: string) => async ({ canvasElement }: Context) => {
  await expect(within(canvasElement).getByRole("heading", { name: text })).toBeTruthy();
};

export const meta: ComponentMeta<SignInNoticeProps> = {
  args: { signIn: asking, token: "" },
  examples: {
    "Token typed": { token: " obs_3f9c " },
    Loading: { signIn: { ...initial, phase: "Checking", tokenInAddress: false } },
    "Single sign-on": { signIn: { ...initial, phase: "AskingAccess", tokenInAddress: false } },
    "No role with a token": { signIn: { ...initial, phase: "NoStaffRole", method: "TokenCredential", tokenInAddress: false } },
    "No role with single sign-on": { signIn: { ...initial, phase: "NoStaffRole", method: "AccessCredential", tokenInAddress: false } },
    "Second factor": { signIn: { ...initial, phase: "NeedsSecondFactor", method: "AccessCredential", tokenInAddress: false } },
    "Site refused": { signIn: { ...initial, phase: "SiteRefused", tokenInAddress: false } },
    Retry: { signIn: { ...initial, phase: "CheckFailed", tokenInAddress: false } },
  },
  play: {
    Default: async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      await userEvent.type(canvas.getByLabelText("Observatory token"), "o");
      await expect(args.onTokenChange).toHaveBeenCalledWith("o");
      await userEvent.click(canvas.getByRole("button", { name: "Use" }), { pointerEventsCheck: 0 });
      await expect(args.onSubmitToken).not.toHaveBeenCalled();
    },
    "Token typed": async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      await userEvent.click(within(canvasElement).getByRole("button", { name: "Use" }));
      await expect(args.onSubmitToken).toHaveBeenCalledWith("obs_3f9c");
    },
    Loading: async ({ canvasElement }: Context) => {
      const canvas = within(canvasElement);
      await expect(canvas.getByText("Loading…")).toBeTruthy();
      await expect(canvas.queryByRole("button")).toBeNull();
    },
    "Single sign-on": presses("Sign in with single sign-on", "onSignInAgain"),
    "No role with a token": async (context: Context) => {
      await heading("You have no staff role.")(context);
      await expect(within(context.canvasElement).getAllByLabelText("Observatory token").filter((field) => field instanceof HTMLInputElement)).toHaveLength(1);
    },
    "No role with single sign-on": async (context: Context) => {
      await heading("You have no staff role.")(context);
      await expect(within(context.canvasElement).queryByLabelText("Observatory token")).toBeNull();
      await presses("Sign in again", "onSignInAgain")(context);
    },
    "Second factor": presses("Sign in again", "onSignInAgain"),
    "Site refused": async (context: Context) => {
      await heading("This address cannot open the console.")(context);
      await expect(within(context.canvasElement).queryByRole("button")).toBeNull();
    },
    Retry: presses("Try again", "onRetry"),
  },
};
