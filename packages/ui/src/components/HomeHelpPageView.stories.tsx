import { fn } from "storybook/test";
import { meta, moreExamples, morePlay } from "./HomeHelpPageView.meta.tsx";
import { HomeHelpPageView } from "./HomeHelpPageView.tsx";

export default { title: "Ui/HomeHelpPageView", component: HomeHelpPageView };

const story = (name: string) => ({
  args: { ...meta.args, onPhoneChange: fn(), onSubmitPhone: fn(), onCodeChange: fn(), onSubmitCode: fn(), onResend: fn(), onChangeNumber: fn(), onContinueWithPhone: fn(), onCheckPassed: fn(), onCheckFailed: fn(), onCheckExpired: fn(), onAddressChange: fn(), onChooseAdd: fn(), onBackToChoices: fn(), onSubmitAddress: fn(), onAskReveal: fn(), onAskRevoke: fn(), ...moreExamples[name] },
  play: (morePlay as Readonly<Record<string, unknown>>)[name],
});

export const Saving = story("Saving");
export const Saved = story("Saved");
export const SavedFromTheStatus = story("Saved from the status");
export const AddressFromTheStatus = story("Address from the status");
export const CloudSignInExpired = story("Cloud sign-in expired");
export const Revealed = story("Revealed");
export const Removed = story("Removed");
export const Closed = story("Closed");
export const Unavailable = story("Unavailable");
export const TryLater = story("Try later");
export const RequestFailed = story("Request failed");
export const Unreachable = story("Unreachable");
