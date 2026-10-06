// MCP Apps item card (design §4, §9.2; P2). Renders cleared items from get_network_updates with at
// most two primary actions ("Interested", "Not for me") that call respond_to_network_item through the
// host bridge. Linked from tools/list only when the client declares the UI extension.
// Sketch only: production needs the @modelcontextprotocol/ext-apps client, theming and review screenshots.
export const ITEM_CARD_URI = "ui://network/item-card.html";
export const WIDGET_MIME = "text/html;profile=mcp-app";
export const UI_EXTENSION = "io.modelcontextprotocol/ui";

export const ITEM_CARD_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--bg:#fff;--fg:#141414;--muted:#666;--line:#e4e4e4;--accent:#141414}
@media (prefers-color-scheme:dark){:root{--bg:#161616;--fg:#f2f2f2;--muted:#a0a0a0;--line:#2c2c2c;--accent:#f2f2f2}}
body{margin:0;font:15px/1.45 system-ui,sans-serif;background:var(--bg);color:var(--fg)}
.card{border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:8px}
.t{font-weight:600}.b{color:var(--muted);margin:4px 0 10px}
button{font:inherit;border:1px solid var(--accent);background:none;color:var(--fg);border-radius:6px;padding:4px 10px;margin-right:6px}
.empty{color:var(--muted);padding:12px}
</style></head><body><div id="root"><div class="empty">Loading…</div></div>
<script>
const PRIMARY = { interested: "Interested", not_for_me: "Not for me" };
let nextId = 1; const pending = new Map();
function rpc(method, params){ const id = nextId++; parent.postMessage({jsonrpc:"2.0", id, method, params}, "*");
  return new Promise(r => pending.set(id, r)); }
function render(data){
  const root = document.getElementById("root"); root.replaceChildren();
  const items = (data && data.items) || [];
  if (!items.length){ const d = document.createElement("div"); d.className = "empty"; d.textContent = "Nothing new from your Network."; root.append(d); return; }
  for (const it of items){
    const c = document.createElement("div"); c.className = "card";
    const t = document.createElement("div"); t.className = "t"; t.textContent = it.title;
    const b = document.createElement("div"); b.className = "b"; b.textContent = it.summary;
    c.append(t, b);
    for (const r of Object.keys(PRIMARY)){
      if (!it.allowed_responses.includes(r)) continue;
      const btn = document.createElement("button"); btn.textContent = PRIMARY[r];
      btn.onclick = async () => { btn.disabled = true;
        await rpc("tools/call", {name:"respond_to_network_item", arguments:{item_id: it.item_id, response: r}});
        c.querySelectorAll("button").forEach(x => x.disabled = true); };
      c.append(btn);
    }
    root.append(c);
  }
}
window.addEventListener("message", (e) => {
  if (e.source !== parent) return; // only the host frame may answer or push tool results
  const m = e.data; if (!m || m.jsonrpc !== "2.0") return;
  if (m.id && pending.has(m.id)){ pending.get(m.id)(m.result); pending.delete(m.id); return; }
  if (m.method === "ui/notifications/tool-result") render(m.params && m.params.structuredContent);
});
rpc("ui/initialize", {appInfo:{name:"the-network-item-card", version:"0.2.0"}, appCapabilities:{}, protocolVersion:"2026-01-26"})
  .then(() => parent.postMessage({jsonrpc:"2.0", method:"ui/notifications/initialized"}, "*"));
</script></body></html>`;
