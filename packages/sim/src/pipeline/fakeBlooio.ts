// A fake Blooio for the pipeline world: the FetchLike the real BlooioClient (packages/blooio) calls.
// Nothing leaves the process. It answers POST /messages like Blooio v4 (a message id, status
// "queued"), honours Idempotency-Key (a replayed key returns the first result with HTTP 200 and is
// counted, never sent twice), and keeps every text it took, so a test reads what a phone got.
// Any other host than FAKE_BLOOIO_BASE throws: the world can never reach the real API.
import type { FetchLike } from "../../../blooio/src/blooio/client.ts";

export const FAKE_BLOOIO_BASE = "https://blooio.fake.invalid/v4";

/** One text the fake provider accepted. */
export interface SentText {
  id: string;
  to: string;
  from?: string;
  text: string;
  /** The queue's provider key (`tn:<network message id>`). */
  key: string;
  at: number;
}

export class FakeBlooio {
  readonly sent: SentText[] = [];
  /** Sends that reused a key (the provider returned the first result, nothing was sent again). */
  replays = 0;
  /** Calls that were not a send (typing, read receipts), by path. */
  readonly other: string[] = [];
  /** The next N sends fail with this HTTP status (e.g. 503: retryable). */
  failNext: { status: number; code?: string; n: number } | undefined;
  private byKey = new Map<string, SentText>();
  private seq = 0;

  constructor(private now: () => number) {}

  readonly fetch: FetchLike = async (input, init) => {
    if (!input.startsWith(FAKE_BLOOIO_BASE)) throw new Error(`the fake Blooio only answers ${FAKE_BLOOIO_BASE}, not ${input}`);
    const path = input.slice(FAKE_BLOOIO_BASE.length);
    if (init?.method !== "POST" || path !== "/messages") { this.other.push(`${init?.method ?? "GET"} ${path}`); return Response.json({ ok: true }); }
    const key = new Headers(init.headers).get("idempotency-key") ?? "";
    const prev = this.byKey.get(key);
    if (prev) { this.replays++; return Response.json({ message_id: prev.id, status: "queued", protocol: "imessage" }, { status: 200 }); }
    if (this.failNext && this.failNext.n > 0) {
      this.failNext.n--;
      const { status, code } = this.failNext;
      if (!this.failNext.n) this.failNext = undefined;
      return Response.json({ error: { code: code ?? "unavailable", message: "fake failure" } }, { status });
    }
    const body = JSON.parse(String(init.body)) as { to: string; from?: string; text: string };
    const s: SentText = { id: `fake_${++this.seq}`, to: body.to, ...(body.from ? { from: body.from } : {}), text: body.text, key, at: this.now() };
    this.sent.push(s);
    this.byKey.set(key, s);
    return Response.json({ message_id: s.id, status: "queued", protocol: "imessage" }, { status: 201 });
  };

  /** What one phone got, oldest first. */
  to(phone: string): SentText[] { return this.sent.filter(s => s.to === phone); }
}
