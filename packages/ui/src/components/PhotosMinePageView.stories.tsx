import { fn } from "storybook/test";
import { meta, moreExamples, morePlay } from "./PhotosMinePageView.meta.tsx";
import { PhotosMinePageView } from "./PhotosMinePageView.tsx";

export default { title: "Ui/PhotosMinePageView", component: PhotosMinePageView };

const story = (name: string) => ({
  args: { ...meta.args, onTakeBack: fn(), onRetry: fn(), ...moreExamples[name] },
  play: (morePlay as Readonly<Record<string, unknown>>)[name],
});

export const TakeBackFailed = story("Take back failed");
export const TakeBackUnreachable = story("Take back unreachable");
export const Empty = story("Empty");
export const TimedOut = story("Timed out");
export const OtherPhone = story("Other phone");
export const Unavailable = story("Unavailable");
export const OpenUnreachable = story("Open unreachable");
export const OpenFailed = story("Open failed");
