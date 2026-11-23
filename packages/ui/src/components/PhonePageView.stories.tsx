import { fn } from "storybook/test";
import { meta, moreExamples, morePlay } from "./PhonePageView.meta.tsx";
import { PhonePageView } from "./PhonePageView.tsx";

export default { title: "Ui/PhonePageView", component: PhonePageView };

const story = (name: string) => ({
  args: { ...meta.args, onPhoneChange: fn(), onSubmitPhone: fn(), onCodeChange: fn(), onSubmitCode: fn(), onResend: fn(), onChangeNumber: fn(), onContinueWithPhone: fn(), onCheckPassed: fn(), onCheckFailed: fn(), onCheckExpired: fn(), onNewNumberChange: fn(), onSubmitNewNumber: fn(), onChangeCodeChange: fn(), onSubmitChangeCode: fn(), onResendChangeCode: fn(), onChangeNewNumber: fn(), ...moreExamples[name] },
  play: (morePlay as Readonly<Record<string, unknown>>)[name],
});

export const Code = story("Code");
export const WrongCode = story("Wrong code");
export const CodeFormat = story("Code format");
export const NewCodeSent = story("New code sent");
export const StartAgain = story("Start again");
export const NumberInUse = story("Number in use");
export const Done = story("Done");
export const DoneOnCloud = story("Done on Cloud");
export const Held = story("Held");
export const Unreachable = story("Unreachable");
