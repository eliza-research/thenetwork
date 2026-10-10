// Links in notifications (entry-flows doc, sections 5.3 and 5.4).
//  - The assistant's own link goes in the iMessage itself: a redirect through our domain keeps iOS in
//    Safari instead of opening the app.
//  - Fill-only parameters: ChatGPT ?prompt= (its ?q= auto-sends on the web), Claude /new?q=, Grok ?q=
//    (Grok asks "Send this message?"). We never rely on auto-send.
//  - The prompt carries only the task token: no names, no match details, no app brand (a dating
//    update reads "The Network"), never a login code.
//  - Our own domain only; public shorteners are filtered by carriers.

import { TOKEN_PATTERN } from "./tokens.ts";
import type { Assistant } from "./types.ts";

export const MAX_PROMPT_CHARS = 80;
export const MAX_URL_CHARS = 160;
export const DEFAULT_PAGE_BASE = "https://ntwrk.party";

export const ASSISTANT_LABEL: Record<Assistant, string> = { chatgpt: "ChatGPT", claude: "Claude", grok: "Grok" };

const ALLOWED_HOSTS = new Set(["chatgpt.com", "claude.ai", "grok.com", "ntwrk.party"]);
const SHORTENERS = /(^|\.)(bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|is\.gd|buff\.ly|rebrand\.ly|cutt\.ly|shorturl\.at)$/i;

export function updatePrompt(token: string): string {
  if (!TOKEN_PATTERN.test(token)) throw new Error("not a task token");
  const p = `Ask The Network for update ${token}`;
  if (p.length > MAX_PROMPT_CHARS) throw new Error("prompt too long");
  return p;
}

export function assistantLink(a: Assistant, prompt: string): string {
  const q = encodeURIComponent(prompt);
  switch (a) {
    case "chatgpt": return `https://chatgpt.com/?prompt=${q}`;
    case "claude": return `https://claude.ai/new?q=${q}`;
    case "grok": return `https://grok.com/?q=${q}`;
  }
}

export function buttonPageLink(token: string, base = DEFAULT_PAGE_BASE): string {
  if (!TOKEN_PATTERN.test(token)) throw new Error("not a task token");
  return `${base.replace(/\/$/, "")}/t/${token}`;
}

/** Throws unless the URL is https, on an allowed host, not a shortener, and fits one SMS segment. */
export function assertSendableUrl(url: string, extraHosts: string[] = []): string {
  const u = new URL(url);
  if (u.protocol !== "https:") throw new Error(`not https: ${url}`);
  if (SHORTENERS.test(u.hostname)) throw new Error(`public shortener: ${u.hostname}`);
  if (!ALLOWED_HOSTS.has(u.hostname) && !extraHosts.includes(u.hostname)) throw new Error(`host not allowed: ${u.hostname}`);
  if (url.length > MAX_URL_CHARS) throw new Error(`url longer than ${MAX_URL_CHARS}: ${url.length}`);
  return url;
}

/** The buttons on ntwrk.party/t/<token>. Tapping a button (a user gesture) does open the app. */
export function buttonPageButtons(token: string, assistants: Assistant[], replyTo?: string): { label: string; href: string }[] {
  const prompt = updatePrompt(token);
  const buttons = assistants.map(a => ({ label: `Open in ${ASSISTANT_LABEL[a]}`, href: assistantLink(a, prompt) }));
  if (replyTo) buttons.push({ label: "Reply by text", href: `sms:${replyTo}` });
  return buttons;
}
