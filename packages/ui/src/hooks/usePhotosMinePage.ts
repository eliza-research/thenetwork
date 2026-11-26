// spec/photosMinePage.md, "My photos page"
import { useEffect, useRef, useState } from "react";
import {
  canAnswerOpen,
  canAnswerTakeBack,
  enabled,
  type Event,
  type GrantMark,
  grantMarkAfter,
  grantMarkOnOpen,
  grantOffersTakeBack,
  initial,
  type PhotoHoldingsPage,
  type PhotoTile,
  photoTileFor,
  step,
} from "../../../core/src/generated/photosMinePage.ts";
import { type HoldingPhoto, holdingImage, holdingsTokenWellFormed, openHoldings, takeBackShare } from "../api/photosMine.ts";
import { takeLinkFragment } from "../lib/stepLink.ts";

/** The image of one photo: its tile and, when it shows, the object URL of its bytes. */
export interface HoldingImage {
  tile: PhotoTile;
  url?: string;
}

/** The opaque key of one share returned by the server. */
export type ShareKey = string;

/** The my photos page state and the actions that change it. The names match the `PhotosMinePageView` props. */
export interface PhotosMineController {
  page: PhotoHoldingsPage;
  /** The photos from the open answer, in number order. */
  photos: HoldingPhoto[];
  /** The mark of each share, by `ShareKey`. */
  marks: Readonly<Record<ShareKey, GrantMark>>;
  /** The image of each photo, by photo number. */
  images: Readonly<Record<number, HoldingImage>>;
  onTakeBack: (key: ShareKey) => void;
  onRetry: () => void;
}

type PhotosMineData = Omit<PhotosMineController, `on${string}`>;

const start: PhotosMineData = { page: initial, photos: [], marks: {}, images: {} };

const marksOf = (photos: readonly HoldingPhoto[]): Record<ShareKey, GrantMark> =>
  Object.fromEntries(photos.flatMap((photo) => photo.shares.map((share) => [share.shareRef, grantMarkOnOpen(share.access)])));

const loadingImages = (photos: readonly HoldingPhoto[]): Record<number, HoldingImage> =>
  Object.fromEntries(photos.map((photo) => [photo.n, { tile: "TileLoading" }]));

/**
 * Runs the my photos page: each person action and each server answer becomes one event of the generated machine.
 * The share marks and the image tiles change only through `grantMarkOnOpen`, `grantMarkAfter` and `photoTileFor`. After a take-back
 * the page reads the list again, so that each share shows the state that the server has. The link token stays in the memory of this hook only.
 * @model spec/photosMinePage.md
 */
export function usePhotosMinePage(): PhotosMineController {
  const [data, setData] = useState(start);
  const current = useRef(start);
  const token = useRef("");
  const urls = useRef<string[]>([]);

  const [actions] = useState(() => {
    const commit = (next: PhotosMineData) => {
      current.current = next;
      setData(next);
    };
    const send = (event: Event, fields: Partial<PhotosMineData> = {}): PhotoHoldingsPage | undefined => {
      const before = current.current;
      if (!enabled(before.page, event)) return undefined;
      const page = step(before.page, event);
      commit({ ...before, ...fields, page });
      return page;
    };
    const release = () => {
      for (const url of urls.current) URL.revokeObjectURL(url);
      urls.current = [];
    };
    const forgetIfClosed = (page: PhotoHoldingsPage | undefined) => {
      if (!page || page.linkHeld) return;
      token.current = "";
      release();
      commit({ ...current.current, photos: [], marks: {}, images: {} });
    };
    const loadImages = async (photos: readonly HoldingPhoto[]) => {
      for (const photo of photos) {
        if (!current.current.page.linkHeld) return;
        const result = await holdingImage(token.current, photo.n);
        if (result.url) urls.current.push(result.url);
        const image: HoldingImage = result.url ? { tile: photoTileFor(result.kind), url: result.url } : { tile: photoTileFor(result.kind) };
        const after = send({ type: "answerImage", imageAnswer: result.kind }, { images: { ...current.current.images, [photo.n]: image } });
        forgetIfClosed(after);
      }
    };
    const read = async () => {
      const result = await openHoldings(token.current);
      const after = send({ type: "answerOpen", opened: result.answer }, { photos: result.photos, marks: marksOf(result.photos), images: loadingImages(result.photos) });
      forgetIfClosed(after);
      if (after?.screen === "HoldingsList") await loadImages(current.current.photos);
    };
    return {
      open: async () => {
        const fragment = takeLinkFragment().replace(/^#/, "");
        const opened = send({ type: "openHoldingsPage", tokenWellFormed: holdingsTokenWellFormed(fragment) });
        if (!opened || !canAnswerOpen(opened)) return;
        token.current = fragment;
        await read();
      },
      onRetry: async () => {
        const next = send({ type: "retryOpen" });
        if (next && canAnswerOpen(next)) await read();
      },
      onTakeBack: async (key: ShareKey) => {
        const before = current.current;
        const mark = before.marks[key];
        if (mark === undefined || !grantOffersTakeBack(before.page, mark)) return;
        const next = send({ type: "takeBack" }, { marks: { ...before.marks, [key]: "GrantTakingBack" } });
        if (!next || !canAnswerTakeBack(next)) return;
        const kind = await takeBackShare(token.current, key);
        const after = send({ type: "answerTakeBack", takeBackAnswer: kind }, { marks: { ...current.current.marks, [key]: grantMarkAfter(kind) } });
        forgetIfClosed(after);
        const reopened = send({ type: "reopenAfterTakeBack" });
        if (!reopened || !canAnswerOpen(reopened)) return;
        release();
        commit({ ...current.current, photos: [], marks: {}, images: {} });
        await read();
      },
      release,
    };
  });

  useEffect(() => {
    void actions.open();
    return actions.release;
  }, [actions]);

  return {
    ...data,
    onTakeBack: (key: ShareKey) => void actions.onTakeBack(key),
    onRetry: () => void actions.onRetry(),
  };
}
