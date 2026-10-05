// Minimal MCP Apps (SEP-1865) widget for network_get_updates. Renders cleared items as cards with
// accept / decline / tell-me-more buttons that call network_respond through the host bridge.
// Sketch only: production needs the @modelcontextprotocol/ext-apps client, theming, and review screenshots.
export const UPDATES_WIDGET_URI = "ui://the-network/updates.html";
export const WIDGET_MIME = "text/html;profile=mcp-app";

export const UPDATES_WIDGET_HTML = `<!doctype html>
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
    const b = document.createElement("div"); b.className = "b"; b.textContent = it.body;
    c.append(t, b);
    for (const d of it.allowed_decisions){
      const btn = document.createElement("button"); btn.textContent = d.replace(/_/g, " ");
      btn.onclick = async () => { btn.disabled = true;
        await rpc("tools/call", {name:"network_respond", arguments:{item_id: it.item_id, decision: d, client_request_id: crypto.randomUUID()}});
        c.querySelectorAll("button").forEach(x => x.disabled = true); };
      c.append(btn);
    }
    root.append(c);
  }
}
window.addEventListener("message", (e) => {
  const m = e.data; if (!m || m.jsonrpc !== "2.0") return;
  if (m.id && pending.has(m.id)){ pending.get(m.id)(m.result); pending.delete(m.id); return; }
  if (m.method === "ui/notifications/tool-result") render(m.params && m.params.structuredContent);
});
rpc("ui/initialize", {appInfo:{name:"the-network-updates", version:"0.0.1"}, appCapabilities:{}, protocolVersion:"2026-01-26"})
  .then(() => parent.postMessage({jsonrpc:"2.0", method:"ui/notifications/initialized"}, "*"));
if (window.openai && window.openai.toolOutput) render(window.openai.toolOutput); // legacy Apps SDK host
</script></body></html>`;
