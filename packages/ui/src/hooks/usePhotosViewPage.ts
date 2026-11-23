// spec/photosViewPage.md, "Photo view page"
import { useEffect, useRef, useState } from "react";
import {
  canAnswerViewImage,
  canAnswerViewOpen,
  canAnswerReport,
  enabled,
  type Event,
  initial,
  type PhotosViewPage,
  step,
  viewPhotosHeld,
} from "../../../core/src/generated/photosViewPage.ts";
import { loadPhotoView, openPhotoView, photoViewTokenWellFormed, reportPhotoView } from "../api/photosView.ts";
import { takeLinkFragment } from "../lib/stepLink.ts";

/** One photo that the page shows: its place in the offer and the object URL of its bytes in memory. */
export interface ViewedPhoto {
  n: number;
  url: string;
}

/** The photo view page state and the actions that change it. The names match the `PhotosViewPageView` props. */
export interface PhotosViewController {
  page: PhotosViewPage;
  /** The photos that loaded, in offer order. Empty unless the machine holds photos. */
  photos: ViewedPhoto[];
  /** The sender's first name from the open answer; "" before the tap. */
  fromFirstName: string;
  /** The end of the view window in epoch milliseconds, from the open answer. */
  until: number | undefined;
  onTap: () => void;
  onAskReport: () => void;
  onKeepViewing: () => void;
  onReport: () => void;
}

type PhotosViewData = Omit<PhotosViewController, `on${string}`>;

const start: PhotosViewData = { page: initial, photos: [], fromFirstName: "", until: undefined };

const longestTimer = 2_147_483_647;

/**
 * Runs the photo view page: each server answer and the end of the window become one event of the generated machine, and
 * nothing here decides what the machine decides. The token and the object URLs stay in the memory of this hook only.
 * @model spec/photosViewPage.md
 */
export function usePhotosViewPage(): PhotosViewController {
  const [data, setData] = useState(start);
  const current = useRef(start);
  const token = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [actions] = useState(() => {
    const release = (photos: readonly ViewedPhoto[]) => {
      for (const photo of photos) URL.revokeObjectURL(photo.url);
    };
    const stopTimer = () => {
      if (timer.current !== undefined) clearTimeout(timer.current);
      timer.current = undefined;
    };
    const commit = (next: PhotosViewData) => {
      const held = viewPhotosHeld(next.page);
      if (!held) release(next.photos);
      const settled = held ? next : { ...next, photos: [] };
      if (!settled.page.linkHeld) {
        token.current = "";
        stopTimer();
      }
      current.current = settled;
      setData(settled);
    };
    const send = (event: Event, fields: Partial<PhotosViewData> = {}): PhotosViewPage | undefined => {
      const before = current.current;
      if (!enabled(before.page, event)) return undefined;
      const page = step(before.page, event);
      commit({ ...before, ...fields, page });
      return current.current.page;
    };
    const startTimer = (until: number | undefined) => {
      stopTimer();
      if (until === undefined) return;
      const wait = Math.min(Math.max(until - Date.now(), 0), longestTimer);
      timer.current = setTimeout(() => {
        timer.current = undefined;
        send({ type: "endViewWindow" });
      }, wait);
    };
    const loadPhotos = async (count: number) => {
      for (let n = 1; n <= count; n++) {
        if (!canAnswerViewImage(current.current.page)) return;
        const image = await loadPhotoView(token.current, n);
        const photos = image.url === undefined ? current.current.photos : [...current.current.photos, { n, url: image.url }];
        const after = send({ type: "answerViewImage", image: image.answer }, { photos });
        if (!after && image.url !== undefined) URL.revokeObjectURL(image.url);
        if (!after) return;
      }
    };
    return {
      open: () => {
        const fragment = takeLinkFragment().replace(/^#/, "");
        const opened = send({ type: "openViewPage", tokenWellFormed: photoViewTokenWellFormed(fragment) });
        if (opened?.linkHeld) token.current = fragment;
      },
      close: () => {
        stopTimer();
        release(current.current.photos);
      },
      onTap: async () => {
        const next = send({ type: "tapToView" });
        if (!next || !canAnswerViewOpen(next)) return;
        const result = await openPhotoView(token.current);
        const after = send({ type: "answerViewOpen", openAnswer: result.answer }, result.answer.kind === "OpenShown" ? { fromFirstName: result.fromFirstName, until: result.until } : {});
        if (!after || after.screen !== "ViewShowing") return;
        startTimer(result.until);
        await loadPhotos(after.count);
      },
      onAskReport: () => {
        send({ type: "askToReport" });
      },
      onKeepViewing: () => {
        send({ type: "keepViewing" });
      },
      onReport: async () => {
        const next = send({ type: "sendReport" });
        if (!next || !canAnswerReport(next)) return;
        const report = await reportPhotoView(token.current);
        send({ type: "answerReport", report });
      },
    };
  });

  useEffect(() => {
    actions.open();
    return actions.close;
  }, [actions]);

  return {
    ...data,
    onTap: () => void actions.onTap(),
    onAskReport: actions.onAskReport,
    onKeepViewing: actions.onKeepViewing,
    onReport: () => void actions.onReport(),
  };
}
