const HTML_ESCAPE_MAP: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw =
    typeof value === "string"
      ? value
      : typeof value === "number" || typeof value === "boolean" || typeof value === "bigint"
        ? String(value)
        : JSON.stringify(value);
  return raw.replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch] ?? ch);
}

export function safeHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      return parsed.href;
    }
    return null;
  } catch {
    return null;
  }
}

export const NETWORK_FAVICON_DATA_URI =
  "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><path d='M12 44L24 22L38 34L52 14M38 34L46 52' fill='none' stroke='currentColor' stroke-width='3.5' stroke-linecap='round' stroke-linejoin='round'/><g fill='currentColor'><circle cx='12' cy='44' r='5'/><circle cx='24' cy='22' r='6'/><circle cx='38' cy='34' r='7'/><circle cx='52' cy='14' r='5'/><circle cx='46' cy='52' r='5'/></g></svg>";
