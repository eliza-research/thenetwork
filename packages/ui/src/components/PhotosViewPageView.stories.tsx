import { fn } from "storybook/test";
import { meta, moreExamples, morePlay } from "./PhotosViewPageView.meta.tsx";
import { PhotosViewPageView } from "./PhotosViewPageView.tsx";

export default { title: "Ui/PhotosViewPageView", component: PhotosViewPageView };

const story = (name: string) => ({
  args: { ...meta.args, onTap: fn(), onAskReport: fn(), onKeepViewing: fn(), onReport: fn(), ...moreExamples[name] },
  play: (morePlay as Readonly<Record<string, unknown>>)[name],
});

export const Reporting = story("Reporting");
export const ReportUnreachable = story("Report unreachable");
export const Reported = story("Reported");
export const OtherDevice = story("Other device");
export const OtherDeviceReportLost = story("Other device, report lost");
export const Gone = story("Gone");
export const GoneAfterTheOpen = story("Gone after the open");
export const Replaced = story("Replaced");
export const ReplacedReportLost = story("Replaced, report lost");
export const ReportLost = story("Report lost");
