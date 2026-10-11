// The landing page: a row of agent logos (sites/agents.ts writes the markup and every link). A click
// copies the prompt and opens the agent with the prompt filled in; an agent with no link is a button that
// copies and says where to paste. The prompt text is in the page itself ([data-prompt]). Without
// JavaScript the links still open the agent and the prompt stays selectable.

/** Copies the prompt. No clipboard permission: selects the text so the person can copy it by hand. */
async function copy(code: HTMLElement): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(code.textContent ?? "");
    return true;
  } catch {
    const range = document.createRange();
    range.selectNodeContents(code);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    return false;
  }
}

export interface Device {
  mobile: boolean;
  /** An sms: link opens Messages here: phones, and a Mac. */
  messages: boolean;
}

/** A phone or tablet, or a desktop. iPadOS reports itself as a Mac, so touch points decide. */
export function device(nav: Pick<Navigator, "userAgent" | "maxTouchPoints"> = navigator): Device {
  const ua = nav.userAgent;
  const mac = /Macintosh|Mac OS X/.test(ua);
  const mobile = /Android|iPhone|iPad|iPod/.test(ua) || (mac && nav.maxTouchPoints > 1);
  return { mobile, messages: mobile || mac };
}

export function mountAgents(root: Document = document): void {
  const code = root.querySelector<HTMLElement>("[data-prompt]");
  if (!code) return;
  const d = device();
  root.documentElement.dataset.device = d.mobile ? "mobile" : "desktop";
  root.documentElement.dataset.messages = d.messages ? "yes" : "no";
  const status = root.querySelector<HTMLElement>("[data-status]");
  const say = (text: string) => { if (status) status.textContent = text; };

  const button = root.querySelector<HTMLButtonElement>("[data-copy]");
  if (button) {
    button.hidden = false;
    button.addEventListener("click", async () => { button.textContent = (await copy(code)) ? "Copied" : "Selected: press copy"; });
  }
  for (const tile of root.querySelectorAll<HTMLElement>("[data-agent][data-toast]")) {
    tile.hidden = false;
    // A link is not stopped: the copy starts inside the click and the agent opens in a new tab.
    tile.addEventListener("click", async () => {
      const ok = await copy(code);
      say(ok ? tile.dataset.toast ?? "" : "Copy the prompt, then paste it into your agent.");
    });
  }
}

if (typeof document !== "undefined") mountAgents();
