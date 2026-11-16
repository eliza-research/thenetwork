// spec/landingEntry.md, "Take the signup prompt to my agent"
import { type MouseEvent, useEffect, useRef, useState } from "react";
import {
  type AgentId,
  type Event,
  type Landing,
  canChooseAgent,
  canChooseMessages,
  canMount,
  canPressCopy,
  canSettleMessages,
  deviceFor,
  initial,
  messagesOpensHere,
  messagesWaitMs,
  step,
} from "../../../core/src/generated/landingEntry.ts";
import type { LandingLinks } from "../brand/landing.ts";

/** What a landing view needs: the state, the links, and one handler for each control. */
export interface LandingController {
  state: Landing;
  links: LandingLinks;
  /** Give it to the prompt text, so that a refused copy can select the prompt. */
  promptRef: { current: HTMLElement | null };
  onCopy: () => void;
  onChooseAgent: (agent: AgentId) => void;
  onChooseMessages: (event: MouseEvent<HTMLAnchorElement>) => void;
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function selectText(node: HTMLElement | null) {
  const selection = window.getSelection();
  if (!node || !selection) return;
  const range = document.createRange();
  range.selectNodeContents(node);
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * The landing page state over the generated landingEntry machine, for the links that the prerender wrote into the page. Each handler checks the generated guard, does the outside effect (clipboard, device read, Messages wait), then applies the generated transition.
 * @model spec/landingEntry.md
 */
export function useLanding(links: LandingLinks): LandingController {
  const [state, setState] = useState<Landing>(initial);
  const promptRef = useRef<HTMLElement | null>(null);
  const apply = (event: Event) => setState((current) => step(current, event));
  const waiting = canSettleMessages(state);

  useEffect(() => {
    const userAgent = navigator.userAgent;
    const device = deviceFor(/Android|iPhone|iPad|iPod/.test(userAgent), /Macintosh|Mac OS X/.test(userAgent), navigator.maxTouchPoints);
    setState((current) => (canMount(current, device) ? step(current, { type: "mount", device }) : current));
  }, []);

  useEffect(() => {
    if (!waiting) return;
    let pageLeft = false;
    const leave = () => {
      pageLeft = true;
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") pageLeft = true;
    };
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", visibility);
    const timer = window.setTimeout(() => setState((current) => step(current, { type: "settleMessages", pageLeft })), messagesWaitMs);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [waiting]);

  const onCopy = async () => {
    if (!canPressCopy(state)) return;
    const copied = await writeClipboard(links.prompt);
    if (!copied) selectText(promptRef.current);
    apply({ type: "pressCopy", copied });
  };

  const onChooseAgent = async (agent: AgentId) => {
    if (!canChooseAgent(state, agent)) return;
    if (!state.mounted) return apply({ type: "chooseAgent", agent, copied: false });
    const copied = await writeClipboard(links.prompt);
    if (!copied) selectText(promptRef.current);
    apply({ type: "chooseAgent", agent, copied });
  };

  const onChooseMessages = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!canChooseMessages(state)) return event.preventDefault();
    if (!state.mounted) return apply({ type: "chooseMessages", copied: false });
    if (!messagesOpensHere(state.device)) event.preventDefault();
    void writeClipboard(links.joinMessage).then((copied) => apply({ type: "chooseMessages", copied }));
  };

  return {
    state,
    links,
    promptRef,
    onCopy: () => void onCopy(),
    onChooseAgent: (agent) => void onChooseAgent(agent),
    onChooseMessages,
  };
}
