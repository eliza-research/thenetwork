// The agent-first landing page (founder decision 10, AGENTS.md): one Copy button for the prompt the
// person pastes into their own AI agent. The prompt text is in the page itself ([data-prompt]); this
// only copies it and says so. Without JavaScript (or clipboard access) the text stays selectable.
export function mountCopy(root: ParentNode = document): void {
  const code = root.querySelector<HTMLElement>("[data-prompt]");
  const button = root.querySelector<HTMLButtonElement>("[data-copy]");
  if (!code || !button) return;
  button.hidden = false;
  button.addEventListener("click", async () => {
    const text = code.textContent ?? "";
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      // No clipboard permission: select the text so the person can copy it by hand.
      const range = document.createRange();
      range.selectNodeContents(code);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    button.textContent = ok ? "Copied" : "Selected: press copy";
  });
}

if (typeof document !== "undefined") mountCopy();
