// The agents on every landing page: one logo each, no names. A click copies the prompt and opens the
// agent with the prompt filled in. Build-time data only: the page script (shared/agent.ts) holds no URL,
// it reads the data-* attributes this file writes.
//
// Link behaviour was researched on 2026-10-10 (docs/research/2026-10-10-agent-deep-links.md). The https
// links below are claimed by each vendor's mobile app (universal links / app links), so one link serves
// phone and desktop. An agent with no prompt link is a button: it copies the prompt and says where to paste it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Site } from "./sites.ts";

export interface Agent {
  id: string;
  /** The accessible name and the hover label. Never shown as text on the page. */
  name: string;
  /** sites/shared/logos/<logo>.svg (monochrome, currentColor). */
  logo: string;
  /** The link that opens the agent: "{q}" is the encoded prompt, "{skill}" the encoded SKILL.md URL. None: the tile is a copy button. */
  href?: string;
  /** Shown after the copy. Agents whose link does not fill the prompt reliably say "paste". */
  toast: string;
  /** Desktop only (hidden on a phone). */
  desktopOnly?: boolean;
}

export const AGENTS: Agent[] = [
  { id: "chatgpt", name: "ChatGPT", logo: "openai", href: "https://chatgpt.com/?q={q}", toast: "Opening ChatGPT. The prompt is copied too." },
  { id: "claude", name: "Claude", logo: "claude", href: "https://claude.ai/new?q={q}", toast: "Opening Claude. The prompt is copied too." },
  { id: "grok", name: "Grok", logo: "grok", href: "https://grok.com/?q={q}", toast: "Opening Grok. The prompt is copied too." },
  // muse.ai is a video host; keep the copy fallback until the agent's URL is confirmed.
  { id: "muse", name: "Muse", logo: "muse", toast: "Copied. Paste it into Muse." },
  { id: "gemini", name: "Gemini", logo: "gemini", href: "https://gemini.google.com/app?q={q}", toast: "Copied. Paste it into Gemini." },
  { id: "perplexity", name: "Perplexity", logo: "perplexity", href: "https://www.perplexity.ai/search?q={q}", toast: "Opening Perplexity. The prompt is copied too." },
  { id: "cursor", name: "Cursor", logo: "cursor", href: "https://cursor.com/link/prompt?text={q}", toast: "Opening Cursor. The prompt is copied too.", desktopOnly: true },
  // Their own URL schemes (the same links as slop.cash). Nothing opens where the agent is not installed, so the toast says what to do.
  { id: "openclaw", name: "OpenClaw", logo: "openclaw", href: "openclaw://agent?message={q}", toast: "Copied. If OpenClaw did not open, send it the prompt." },
  { id: "hermes", name: "Hermes", logo: "hermesagent", href: "hermes://skill/install?identifier={skill}", toast: "Copied. If Hermes did not open, send it the prompt." },
];

/** What a person types into their agent. The tests and the staging rewrite read this exact sentence. */
const skillUrlFor = (s: Pick<Site, "domain">, version: string) =>
  `https://${s.domain}/SKILL.md${s.domain === "slop.date" ? "" : `?version=${encodeURIComponent(version)}`}`;
export const promptFor = (s: Pick<Site, "domain">, version: string) => `Read ${skillUrlFor(s, version)} and follow it.`;

/** The first text that joins this app on the shared line (packages/platform/src/apps.ts keywordApp). */
export const keywordFor = (s: Pick<Site, "app">) => (s.app === "ntwrk" ? "network" : s.app);

/** Exact whole-message command accepted by the shared line's existing app router. */
export const joinMessageFor = (s: Pick<Site, "app">) => `join ${keywordFor(s)}`;

/** Standard SMS composition URI; message-app support for body prefilling varies. */
export const messagesHref = (s: Pick<Site, "app">, textLine: string) =>
  `sms:${textLine}?body=${encodeURIComponent(joinMessageFor(s))}`;

const logo = (name: string) => readFileSync(join(import.meta.dirname, "shared/logos", `${name}.svg`), "utf8").trim();
const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * The logo row for one site ({{AGENTS}} in index.html). Links work with no JavaScript;
 * prompt-copy buttons need the page script, so those buttons start hidden.
 * The shared-line Text Eliza button is separate from this agent chooser.
 */
export function agentRow(s: Pick<Site, "domain">, version: string): string {
  const prompt = promptFor(s, version);
  const q = encodeURIComponent(prompt);
  const skill = encodeURIComponent(skillUrlFor(s, version));
  const tiles = AGENTS.map((a) => {
    const common = `class="l-agent" data-agent="${a.id}" data-tip="${esc(a.name)}" data-toast="${esc(a.toast)}"${a.desktopOnly ? ' data-only="desktop"' : ""}`;
    return a.href
      ? `<a ${common} href="${esc(a.href.replace("{q}", q).replace("{skill}", skill))}" target="_blank" rel="noopener" aria-label="Open in ${esc(a.name)}">${logo(a.logo)}</a>`
      : `<button type="button" ${common} hidden aria-label="Copy the prompt for ${esc(a.name)}">${logo(a.logo)}</button>`;
  });
  return tiles.join("\n    ");
}
