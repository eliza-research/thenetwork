// spec/photoUploadPage.md, "Photo upload page"
import { useEffect, useRef, useState } from "react";
import {
  canAnswerLinkStatus,
  canAnswerUpload,
  enabled,
  type Event,
  initial,
  photoConsentHeaderSent,
  photoLinkHeld,
  type PhotoUploadPage,
  step,
} from "../../../core/src/generated/photoUploadPage.ts";
import { batchOf, type PhotoConsentShown, type PhotoRefusalShown, photoTokenWellFormed, readPhotoLink, sendPhotos } from "../api/photoUpload.ts";
import { takeLinkFragment } from "../lib/stepLink.ts";

/** The photo upload page state and the actions that change it. The names match the `PhotoUploadPageView` props. */
export interface PhotoUploadController {
  page: PhotoUploadPage;
  /** The names of the chosen files, in the order the person chose them. */
  fileNames: string[];
  /** The refusals of single photos from the last answer, each once. */
  refused: PhotoRefusalShown[];
  /** The photo consent text that the link status gave; the page shows it exactly. "" before the status answer. */
  consentText: string;
  onChoose: (files: File[]) => void;
  onConsentChange: (ticked: boolean) => void;
  onUpload: () => void;
  onRetry: () => void;
}

type PhotoUploadData = Omit<PhotoUploadController, `on${string}`>;

const start: PhotoUploadData = { page: initial, fileNames: [], refused: [], consentText: "" };

/**
 * Runs the photo upload page: each server answer becomes one event of the generated machine, and nothing here decides what the machine decides.
 * The link token and the consent version stay in the memory of this hook only. The consent text and version come from the link status, not from the site build.
 * @model spec/photoUploadPage.md
 */
export function usePhotoUploadPage(): PhotoUploadController {
  const [data, setData] = useState(start);
  const current = useRef(start);
  const token = useRef("");
  const consent = useRef<PhotoConsentShown | undefined>(undefined);
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
    const forgetIfClosed = (page: PhotoUploadPage | undefined) => {
      if (!page || photoLinkHeld(page)) return;
      token.current = "";
      files.current = [];
    };
    const readStatus = async () => {
      const result = await readPhotoLink(token.current);
      if (result.consent) consent.current = result.consent;
      const after = send({ type: "answerLinkStatus", linkStatus: result.linkStatus }, result.consent ? { consentText: result.consent.text } : {});
      forgetIfClosed(after);
    };
    return {
      open: async () => {
        const fragment = takeLinkFragment().replace(/^#/, "");
        const opened = send({ type: "openPhotoPage", tokenWellFormed: photoTokenWellFormed(fragment) });
        if (!opened || !canAnswerLinkStatus(opened)) return;
        token.current = fragment;
        await readStatus();
      },
      onRetry: async () => {
        const next = send({ type: "retryLinkStatus" });
        if (next && canAnswerLinkStatus(next)) await readStatus();
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
        const result = await sendPhotos(token.current, chosen, photoConsentHeaderSent(next) ? consent.current?.version : undefined);
        const after = send({ type: "answerUpload", answer: result.answer }, { refused: result.refused });
        forgetIfClosed(after);
      },
    };
  });

  useEffect(() => {
    void actions.open();
  }, [actions]);

  return {
    ...data,
    onChoose: actions.onChoose,
    onConsentChange: actions.onConsentChange,
    onUpload: () => void actions.onUpload(),
    onRetry: () => void actions.onRetry(),
  };
}
