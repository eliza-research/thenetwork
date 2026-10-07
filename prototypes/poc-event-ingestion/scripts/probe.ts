import { politeFetch } from "../src/http";
const S = process.env.RAW ?? "/tmp";
for (const u of process.argv.slice(2)) {
  try {
    const r = await politeFetch(u);
    const t = await r.text();
    const name = u.replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "_").slice(0, 80);
    await Bun.write(`${S}/${name}`, t);
    const ld = [...t.matchAll(/<script[^>]*ld\+json[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    const types = ld.map((x) => { try { const j = JSON.parse(x); const a = Array.isArray(j) ? j : (j["@graph"] ?? [j]); return a.map((o: any) => o["@type"] + (o.itemListElement ? `[${o.itemListElement.length}]` : "")).join(","); } catch { return "bad"; } });
    console.log(r.status, u, r.headers.get("content-type"), t.length, "| ld:", types.join(" ; "), "| next:", t.includes("__NEXT_DATA__"), "| cf:", /cf-chl|Just a moment|captcha/i.test(t));
  } catch (e) { console.log("ERR", u, String(e)); }
}
