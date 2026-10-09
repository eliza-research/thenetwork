// Alert dispatch (critical path item 11; PRD 35.2, 36.3). The monitor (monitor.ts) finds what is wrong;
// this file decides what to send and where.
//  - Sinks: the log (always), a file of JSON lines (ALERT_FILE) and a generic webhook (ALERT_WEBHOOK_URL,
//    a JSON POST that Slack-style incoming webhooks and most pagers accept). Never SMS or iMessage: an
//    alert must not use the member line.
//  - Dedupe: an alert fires once per key; while it stays active it is sent again only every
//    reAlertMs (default 6 hours, ALERT_REALERT_MS). When it clears, one "resolved" line goes out.
//  - The dedupe state can be saved and loaded (scripts/monitor.ts --once keeps it in a file).
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { HOUR } from "@thenetwork/core";

export interface Alert {
  /** Stable key: the same problem keeps the same key while it lasts (e.g. "report_urgent_overdue:slop"). */
  key: string;
  level: "warn" | "bad";
  text: string;
  count?: number;
  app?: string;
}
export interface SentAlert extends Alert { at: number; state: "firing" | "repeat" | "resolved" }

export interface AlertSink {
  readonly name: string;
  send(alerts: SentAlert[]): Promise<void>;
}

/** One line per alert to the process log. */
export class LogSink implements AlertSink {
  readonly name = "log";
  constructor(private readonly log: (line: string) => void) {}
  async send(alerts: SentAlert[]) {
    for (const a of alerts) this.log(`[alert] ${a.state} ${a.level} ${a.key}: ${a.text}`);
  }
}

/** JSON lines appended to a local file. */
export class FileSink implements AlertSink {
  readonly name = "file";
  constructor(private readonly path: string) { mkdirSync(dirname(path), { recursive: true }); }
  async send(alerts: SentAlert[]) {
    if (alerts.length) appendFileSync(this.path, alerts.map(a => JSON.stringify(a)).join("\n") + "\n");
  }
}

/** A JSON POST to a webhook: { text, alerts }. The URL is a secret (it is never logged). */
export class WebhookSink implements AlertSink {
  readonly name = "webhook";
  constructor(private readonly url: string, private readonly fetchFn: (url: string, init: RequestInit) => Promise<Response> = (u, i) => fetch(u, i), private readonly timeoutMs = 10_000) {}
  async send(alerts: SentAlert[]) {
    if (!alerts.length) return;
    const text = alerts.map(a => `${a.state === "resolved" ? "RESOLVED" : a.level.toUpperCase()} ${a.text}`).join("\n");
    const res = await this.fetchFn(this.url, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, alerts }), signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`webhook answered ${res.status}`);
  }
}

/** The sinks the environment asks for: the log always, ALERT_FILE and ALERT_WEBHOOK_URL when set. */
export function sinksFromEnv(env: Record<string, string | undefined>, log: (line: string) => void): AlertSink[] {
  const out: AlertSink[] = [new LogSink(log)];
  if (env.ALERT_FILE) out.push(new FileSink(env.ALERT_FILE));
  if (env.ALERT_WEBHOOK_URL) {
    let ok = false;
    try { ok = new URL(env.ALERT_WEBHOOK_URL).protocol === "https:"; } catch { /* checked below */ }
    if (ok) out.push(new WebhookSink(env.ALERT_WEBHOOK_URL));
    else log("[alert] ALERT_WEBHOOK_URL is not an https URL; the webhook sink is off");
  }
  return out;
}

export const DEFAULT_REALERT_MS = 6 * HOUR;
export interface DispatchState { [key: string]: { first: number; last: number; level: Alert["level"] } }

/**
 * Sends each alert once, again every reAlertMs while it stays active, and once more when it clears.
 * A sink that throws is logged and does not stop the others; the alert still counts as sent (the log
 * sink has it), so a broken webhook does not page the log every five minutes.
 */
export class AlertDispatcher {
  private state: DispatchState = {};
  readonly reAlertMs: number;
  constructor(private readonly o: { sinks: AlertSink[]; now: () => number; reAlertMs?: number; log?: (s: string) => void; state?: DispatchState }) {
    this.reAlertMs = o.reAlertMs ?? DEFAULT_REALERT_MS;
    if (o.state) this.state = { ...o.state };
  }

  /** The current state (to save between runs). */
  snapshot(): DispatchState { return { ...this.state }; }

  /** Compare the active alerts with what was sent; send what is new, due again, or resolved. Returns what was sent. */
  async dispatch(active: Alert[]): Promise<SentAlert[]> {
    const now = this.o.now();
    const out: SentAlert[] = [];
    const seen = new Set<string>();
    for (const a of active) {
      if (seen.has(a.key)) continue;
      seen.add(a.key);
      const s = this.state[a.key];
      // A warning that turns bad is new news: send it now.
      if (!s || (a.level === "bad" && s.level === "warn")) { out.push({ ...a, at: now, state: "firing" }); this.state[a.key] = { first: s?.first ?? now, last: now, level: a.level }; }
      else if (now - s.last >= this.reAlertMs) { out.push({ ...a, at: now, state: "repeat" }); s.last = now; s.level = a.level; }
    }
    for (const key of Object.keys(this.state)) {
      if (seen.has(key)) continue;
      out.push({ key, level: this.state[key]!.level, text: `Resolved: ${key}`, at: now, state: "resolved" });
      delete this.state[key];
    }
    if (out.length) for (const s of this.o.sinks) {
      try { await s.send(out); } catch (e) { this.o.log?.(`[alert] sink ${s.name} failed: ${(e as Error).message}`); }
    }
    return out;
  }
}
