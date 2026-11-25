import { fn } from "storybook/test";
import { meta, moreExamples, morePlay } from "./PhotoUploadPageView.meta.tsx";
import { PhotoUploadPageView } from "./PhotoUploadPageView.tsx";

export default { title: "Ui/PhotoUploadPageView", component: PhotoUploadPageView };

const story = (name: string) => ({
  args: { ...meta.args, onChoose: fn(), onConsentChange: fn(), onUpload: fn(), onRetry: fn(), ...moreExamples[name] },
  play: (morePlay as Readonly<Record<string, unknown>>)[name],
});

export const ConsentNeeded = story("Consent needed");
export const Uploading = story("Uploading");
export const TooLarge = story("Too large");
export const Unreachable = story("Unreachable");
export const RequestFailed = story("Request failed");
export const Done = story("Done");
export const DonePartly = story("Done partly");
export const AllRefused = story("All refused");
export const AdultsOnly = story("Adults only");
export const LinkClosed = story("Link closed");
