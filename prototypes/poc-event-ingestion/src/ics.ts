/** Minimal RFC 5545 VEVENT parser (unfolding, TZID/UTC/date-only DTSTART, escaped text). */
export interface IcsEvent {
  uid: string;
  summary: string;
  description: string;
  location: string;
  url: string | null;
  start: { iso: string | null; date: string; tzid: string | null; dateOnly: boolean };
  end: { iso: string | null; date: string; tzid: string | null; dateOnly: boolean } | null;
  status: string | null;
  geo: [number, number] | null;
  categories: string[];
}

function unescapeText(s: string) {
  return s.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\;/g, ";").replace(/\\\\/g, "\\");
}

function parseDt(value: string, params: Record<string, string>, zonedToUtc: (d: string, t: string, tz: string) => string) {
  const dateOnly = params.VALUE === "DATE" || /^\d{8}$/.test(value);
  const date = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  if (dateOnly) return { iso: null, date, tzid: params.TZID ?? null, dateOnly: true };
  const time = `${value.slice(9, 11)}:${value.slice(11, 13)}`;
  const sec = value.slice(13, 15) || "00";
  if (value.endsWith("Z")) return { iso: `${date}T${time}:${sec}.000Z`, date, tzid: "UTC", dateOnly: false };
  const tz = params.TZID ?? "UTC";
  return { iso: zonedToUtc(date, time, tz), date, tzid: tz, dateOnly: false };
}

export function parseIcs(text: string, zonedToUtc: (d: string, t: string, tz: string) => string): IcsEvent[] {
  const lines = text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const out: IcsEvent[] = [];
  let cur: Record<string, { value: string; params: Record<string, string> }[]> | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT" && cur) {
      const g = (k: string) => cur![k]?.[0];
      const ds = g("DTSTART");
      if (ds) {
        const de = g("DTEND");
        const geo = g("GEO")?.value.split(";").map(Number);
        out.push({
          uid: g("UID")?.value ?? "",
          summary: unescapeText(g("SUMMARY")?.value ?? ""),
          description: unescapeText(g("DESCRIPTION")?.value ?? ""),
          location: unescapeText(g("LOCATION")?.value ?? ""),
          url: g("URL")?.value ?? null,
          start: parseDt(ds.value, ds.params, zonedToUtc),
          end: de ? parseDt(de.value, de.params, zonedToUtc) : null,
          status: g("STATUS")?.value ?? null,
          geo: geo && geo.length === 2 && geo.every(Number.isFinite) ? [geo[0], geo[1]] : null,
          categories: (cur["CATEGORIES"] ?? []).flatMap((c) => unescapeText(c.value).split(",")).map((s) => s.trim()).filter(Boolean),
        });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const m = line.match(/^([A-Z-]+)((?:;[^:]*)?):(.*)$/);
    if (!m) continue;
    const params: Record<string, string> = {};
    for (const p of m[2].split(";").filter(Boolean)) {
      const [k, v] = p.split("=");
      params[k.toUpperCase()] = (v ?? "").replace(/^"|"$/g, "");
    }
    (cur[m[1]] ??= []).push({ value: m[3], params });
  }
  return out;
}
