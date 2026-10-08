// Landing-page demo: a short replay of a synthetic (simulated) run, from GET /api/demo.
// The section stays hidden when the API is down, the answer is not marked synthetic, or the
// shape is wrong. Expected shape (see sites/README.md):
//   { synthetic: true, title?: string, messages: [{ from: "agent" | "member", text: string, name?: string }] }
// Text goes in with textContent only.
import { api } from "./api.ts";

interface DemoMessage {
  from: string;
  text: string;
  name?: string;
}

export function readDemo(data: unknown): { title?: string; messages: DemoMessage[] } | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.synthetic !== true || !Array.isArray(d.messages)) return null;
  const messages = d.messages
    .filter((m): m is DemoMessage => !!m && typeof (m as DemoMessage).text === "string" && typeof (m as DemoMessage).from === "string")
    .slice(0, 10);
  if (!messages.length) return null;
  return { title: typeof d.title === "string" ? d.title : undefined, messages };
}

export async function mountDemo(section: HTMLElement): Promise<void> {
  const list = section.querySelector<HTMLOListElement>("[data-demo-list]");
  if (!list) return;
  const res = await api.demo();
  const demo = res.ok ? readDemo(res.data) : null;
  if (!demo) return;
  const title = section.querySelector<HTMLElement>("[data-demo-title]");
  if (title && demo.title) title.textContent = demo.title;
  const agentName = section.dataset.agentName ?? "Agent";
  for (const m of demo.messages) {
    const li = document.createElement("li");
    li.className = m.from === "agent" ? "from-agent" : "from-member";
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = m.from === "agent" ? agentName : m.name ?? "Member";
    const text = document.createElement("span");
    text.className = "text";
    text.textContent = m.text;
    li.append(who, text);
    list.append(li);
  }
  section.hidden = false;
}

const section = document.querySelector<HTMLElement>("[data-demo]");
if (section) void mountDemo(section);
