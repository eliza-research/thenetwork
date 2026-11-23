// spec/photosCheckPage.md, "Photo check page"
import { useEffect, useRef, useState } from "react";
import { enabled, type Event, initial, type PhotoCheck, proposalEnded, step } from "../../../core/src/generated/photosCheckPage.ts";
import { photoTokenWellFormed } from "../api/photoUpload.ts";
import { answerPhotoCheck, type CheckPhoto, type CheckReply, type CheckRequest, loadCheckPhoto, openPhotoCheck } from "../api/photosCheck.ts";
import { takeLinkFragment } from "../lib/stepLink.ts";

/** One photo on the page: the facts from the server, the object URL of its bytes, and whether it shows on the screen. */
export interface CheckPhotoShown extends CheckPhoto {
  src: string | undefined;
  state: "loading" | "shown" | "failed";
}

/** The photo check page state and the actions that change it. The names match the `PhotosCheckPageView` props. */
export interface PhotosCheckController {
  page: PhotoCheck;
  /** The first name of the receiver; "" before the open answer. */
  toFirstName: string;
  /** The notice from the server that the proposal step shows. */
  notice: string;
  /** Every photo of the member, in number order. The proposal step shows only the `proposed` ones. */
  photos: CheckPhotoShown[];
  /** The numbers that the current proposal names. */
  proposed: number[];
  /** The numbers that the person marked on the choose step. */
  marked: number[];
  /** The text from the server after "Send", or with a refusal; "" when there is none. */
  text: string;
  onPhotoShown: (n: number) => void;
  onPhotoFailed: (n: number) => void;
  onLoadAgain: () => void;
  onSend: () => void;
  onNotThis: () => void;
  onToggle: (n: number) => void;
  onChoose: () => void;
  onRetry: () => void;
}

type PhotosCheckData = Omit<PhotosCheckController, `on${string}`>;

const start: PhotosCheckData = { page: initial, toFirstName: "", notice: "", photos: [], proposed: [], marked: [], text: "" };

/**
 * Runs the photo check page: each server answer becomes one event of the generated machine, and nothing here decides what the machine decides.
 * The token, the revision and the photo bytes stay in the memory of this hook only, and the hook removes the photos when the step ends.
 * @model spec/photosCheckPage.md
 */
export function usePhotosCheckPage(): PhotosCheckController {
  const [data, setData] = useState(start);
  const current = useRef(start);
  const token = useRef("");
  const revision = useRef(0);

  const [actions] = useState(() => {
    const commit = (next: PhotosCheckData) => {
      current.current = next;
      setData(next);
    };
    const patch = (fields: Partial<PhotosCheckData>) => commit({ ...current.current, ...fields });
    const send = (event: Event, fields: (page: PhotoCheck) => Partial<PhotosCheckData> = () => ({})): PhotoCheck | undefined => {
      const before = current.current;
      if (!enabled(before.page, event)) return undefined;
      const page = step(before.page, event);
      commit({ ...before, ...fields(page), page });
      return page;
    };
    const revokeAll = () => {
      for (const photo of current.current.photos) if (photo.src) URL.revokeObjectURL(photo.src);
    };
    const forget = () => {
      revokeAll();
      token.current = "";
      revision.current = 0;
      patch({ photos: [], proposed: [], marked: [] });
    };
    const setPhoto = (n: number, fields: Partial<CheckPhotoShown>) =>
      patch({ photos: current.current.photos.map((photo) => (photo.n === n ? { ...photo, ...fields } : photo)) });
    const checkSeen = () => {
      const { photos, proposed } = current.current;
      const loaded = proposed.length > 0 && proposed.every((n) => photos.some((photo) => photo.n === n && photo.state === "shown"));
      send({ type: "seeProposal", loaded });
    };
    const loadPhotos = async () => {
      const wanted = current.current.photos.filter((photo) => photo.src === undefined && photo.state !== "shown");
      for (const { n } of wanted) setPhoto(n, { state: "loading" });
      await Promise.all(
        wanted.map(async ({ n }) => {
          const link = token.current;
          const blob = link === "" ? undefined : await loadCheckPhoto(link, n);
          if (token.current === "" || token.current !== link) return;
          setPhoto(n, blob ? { src: URL.createObjectURL(blob), state: "loading" } : { src: undefined, state: "failed" });
        }),
      );
    };
    const load = async () => {
      const { opened, proposal } = await openPhotoCheck(token.current);
      const after = send({ type: "answerOpen", opened }, (page) =>
        proposal && (page.screen === "ProposalShown" || page.screen === "ProposalPicking")
          ? {
              toFirstName: proposal.toFirstName,
              notice: proposal.notice,
              photos: proposal.photos.map((photo) => ({ ...photo, src: undefined, state: "loading" as const })),
              proposed: proposal.proposed,
              marked: [],
            }
          : {},
      );
      if (!after) return;
      if (proposalEnded(after.screen)) return forget();
      if (proposal && (after.screen === "ProposalShown" || after.screen === "ProposalPicking")) {
        revision.current = proposal.revision;
        await loadPhotos();
      }
    };
    const answer = async (request: CheckRequest) => {
      const known = current.current.photos.map((photo) => photo.n);
      const reply: CheckReply = await answerPhotoCheck(token.current, revision.current, request, known);
      const after = send({ type: "answerCheck", answer: reply.answer }, (page) =>
        page.screen === "ProposalShown" && reply.answer.kind === "CheckProposed" ? { proposed: reply.proposed, marked: [], text: "" } : { text: reply.text },
      );
      if (!after) return;
      if (proposalEnded(after.screen)) return forget();
      if (after.screen === "ProposalShown" && reply.answer.kind === "CheckProposed") {
        if (reply.revision !== undefined) revision.current = reply.revision;
        checkSeen();
      }
    };
    return {
      open: async () => {
        const fragment = takeLinkFragment().replace(/^#/, "");
        const read = send({ type: "readCheckLink", tokenWellFormed: photoTokenWellFormed(fragment) });
        if (!read || read.pending !== "ProposalLoading") return;
        token.current = fragment;
        await load();
      },
      onRetry: async () => {
        if (send({ type: "retryOpen" })?.pending === "ProposalLoading") await load();
      },
      onPhotoShown: (n: number) => {
        setPhoto(n, { state: "shown" });
        checkSeen();
      },
      onPhotoFailed: (n: number) => {
        const photo = current.current.photos.find((p) => p.n === n);
        if (photo?.src) URL.revokeObjectURL(photo.src);
        setPhoto(n, { src: undefined, state: "failed" });
        checkSeen();
      },
      onLoadAgain: async () => {
        await loadPhotos();
      },
      onSend: async () => {
        if (send({ type: "sendProposal" })?.pending !== "ProposalSending") return;
        await answer({ answer: "send" });
      },
      onNotThis: () => {
        send({ type: "showOthers" }, () => ({ marked: [] }));
      },
      onToggle: (n: number) => {
        const { photos, marked } = current.current;
        const photo = photos.find((p) => p.n === n);
        if (!photo || photo.state !== "shown" || photo.shared) return;
        const next = marked.includes(n) ? marked.filter((m) => m !== n) : [...marked, n].sort((a, b) => a - b);
        send({ type: "pickPhotos", picked: next.length }, () => ({ marked: next }));
      },
      onChoose: async () => {
        const numbers = current.current.marked;
        if (send({ type: "choosePicked" })?.pending !== "ProposalChoosing") return;
        await answer({ answer: "pick", numbers });
      },
      revokeAll,
    };
  });

  useEffect(() => {
    void actions.open();
    return () => actions.revokeAll();
  }, [actions]);

  return {
    ...data,
    onPhotoShown: actions.onPhotoShown,
    onPhotoFailed: actions.onPhotoFailed,
    onLoadAgain: () => void actions.onLoadAgain(),
    onSend: () => void actions.onSend(),
    onNotThis: actions.onNotThis,
    onToggle: actions.onToggle,
    onChoose: () => void actions.onChoose(),
    onRetry: () => void actions.onRetry(),
  };
}
