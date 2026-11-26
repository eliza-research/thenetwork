import { fn } from "storybook/test";
import { meta, moreExamples, morePlay } from "./PhotosCheckPageView.meta.tsx";
import { PhotosCheckPageView } from "./PhotosCheckPageView.tsx";

export default { title: "Ui/PhotosCheckPageView", component: PhotosCheckPageView };

const story = (name: string) => ({
  args: { ...meta.args, onPhotoShown: fn(), onPhotoFailed: fn(), onLoadAgain: fn(), onSend: fn(), onNotThis: fn(), onToggle: fn(), onChoose: fn(), onRetry: fn(), ...moreExamples[name] },
  play: (morePlay as Readonly<Record<string, unknown>>)[name],
});

export const Picking = story("Picking");
export const PickingMarked = story("Picking, marked");
export const PickCount = story("Pick count");
export const Choosing = story("Choosing");
export const Sent = story("Sent");
export const SentNoText = story("Sent, no text");
export const Closed = story("Closed");
export const Lapsed = story("Lapsed");
export const Changed = story("Changed");
export const Refused = story("Refused");
export const RefusedNoText = story("Refused, no text");
export const OtherDevice = story("Other device");
