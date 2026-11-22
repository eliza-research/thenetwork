// spec/photoUploadPage.md, "Photo upload page"
import { useEffect, useRef, useState } from "react";
import {
  canAnswerUpload,
  enabled,
  type Event,
  initial,
  photoConsentHeaderSent,
  photoUploadOffered,
  type PhotoUploadPage,
  step,
} from "../../../core/src/generated/photoUploadPage.ts";
import { batchOf, type PhotoRefusalShown, photoTokenWellFormed, sendPhotos } from "../api/photoUpload.ts";
import { takeLinkFragment } from "../lib/stepLink.ts";

/** What the page knows from the site build. The hook reads it once. */
export interface PhotoUploadOptions {
  /** The version of the photo consent that the page shows; the page sends it only when the person ticks the box. */
  consentVersion: string;
}

/** The photo upload page state and the actions that change it. The names match the `PhotoUploadPageView` props. */
export interface PhotoUploadController {
  page: PhotoUploadPage;
  /** The names of the chosen files, in the order the person chose them. */
  fileNames: string[];
  /** The refusals of single photos from the last answer, each once. */
  refused: PhotoRefusalShown[];
  onChoose: (files: File[]) => void;
  onConsentChange: (ticked: boolean) => void;
  onUpload: () => void;
}

type PhotoUploadData = Omit<PhotoUploadController, `on${string}`>;

const start: PhotoUploadData = { page: initial, fileNames: [], refused: [] };

/**
 * Runs the photo upload page: each server answer becomes one event of the generated machine, and nothing here decides what the machine decides.
 * The link token stays in the memory of this hook only.
 * @model spec/photoUploadPage.md
 */
export function usePhotoUploadPage({ consentVersion }: PhotoUploadOptions): PhotoUploadController {
  const [data, setData] = useState(start);
  const current = useRef(start);
  const token = useRef("");
  const files = useRef<File[]>([]);

  const [actions] = useState(() => {
    const commit = (next: PhotoUploadData) => {
      current.current = next;
      setData(next);
    };
    const send = (event: Event, fields: Partial<PhotoUploadData> = {}): PhotoUploadPage | undefined => {
      const before = current.current;
      if (!enabled(before.page, event)) return undefined;
      const page = step(before.page, event);
      commit({ ...before, ...fields, page });
      return page;
    };
    const forget = () => {
      token.current = "";
      files.current = [];
    };
    return {
      open: () => {
        const fragment = takeLinkFragment().replace(/^#/, "");
        const opened = send({ type: "openPhotoPage", tokenWellFormed: photoTokenWellFormed(fragment) });
        if (opened && photoUploadOffered(opened)) token.current = fragment;
      },
      onChoose: (chosen: File[]) => {
        const next = send({ type: "choosePhotos", batch: batchOf(chosen) }, { fileNames: chosen.map((file) => file.name) });
        if (next) files.current = chosen;
      },
      onConsentChange: (ticked: boolean) => {
        send({ type: "tickConsent", ticked });
      },
      onUpload: async () => {
        const chosen = files.current;
        const next = send({ type: "uploadPhotos", batch: batchOf(chosen) });
        if (!next || !canAnswerUpload(next)) return;
        const result = await sendPhotos(token.current, chosen, photoConsentHeaderSent(next) ? consentVersion : undefined);
        const after = send({ type: "answerUpload", answer: result.answer }, { refused: result.refused });
        if (after && !photoUploadOffered(after)) forget();
      },
    };
  });

  useEffect(() => {
    actions.open();
  }, [actions]);

  return {
    ...data,
    onChoose: actions.onChoose,
    onConsentChange: actions.onConsentChange,
    onUpload: () => void actions.onUpload(),
  };
}
