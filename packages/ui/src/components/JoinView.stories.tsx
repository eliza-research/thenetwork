import { fn } from "storybook/test";
import { meta, moreExamples, morePlay } from "./JoinView.meta.tsx";
import { JoinView } from "./JoinView.tsx";

export default { title: "Ui/JoinView", component: JoinView };

const story = (name: string) => ({
  args: { ...meta.args, onPhoneChange: fn(), onSubmitPhone: fn(), onCodeChange: fn(), onSubmitCode: fn(), onResend: fn(), onChangeNumber: fn(), onContinueWithPhone: fn(), onValuesChange: fn(), onSubmitProfile: fn(), onCheckPassed: fn(), onCheckFailed: fn(), onCheckExpired: fn(), ...moreExamples[name] },
  play: (morePlay as Readonly<Record<string, unknown>>)[name],
});

export const DoneFromAgent = story("Done from agent");
