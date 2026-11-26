import { createHash } from "node:crypto";
import { readCapped } from "../../platform/src/body.ts";
import { svcSign, svcVerify } from "../../core/src/svc/svc-auth.ts";

export interface ProfileReviewProofTransportOptions {
  origin: string; secret: string; now: () => number; development?: boolean; fetch?: typeof fetch;
}

export function profileReviewProofTransport(o: ProfileReviewProofTransportOptions) {
  const origin = new URL(o.origin);
  const local = o.development && origin.protocol === "http:" && ["127.0.0.1", "localhost"].includes(origin.hostname);
  if ((!local && origin.protocol !== "https:") || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/"
    || o.secret.length < 32) throw new Error("Profile review proof requires an exact trusted origin and service secret");
  return async (path: string, id: string, payload: unknown): Promise<{ value: unknown; selectorSha256: string; now: number } | null> => {
    const before = o.now();
    if (!Number.isSafeInteger(before) || !/^\/api\/internal\/network\/profile-review-(?:owner|source|disconnect|withdrawal)$/u.test(path)) return null;
    const body = JSON.stringify(payload);
    if (new TextEncoder().encode(body).length > 16 * 1024) return null;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<null>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(null); }, 3000); });
    try {
      const request = (async () => {
        const response = await (o.fetch ?? fetch)(origin.origin + path, { method: "POST", redirect: "manual", signal: controller.signal,
          headers: { "Content-Type": "application/json", ...await svcSign(o.secret, { method: "POST", path, id, body, nowS: Math.floor(before / 1000) }) }, body });
        if (controller.signal.aborted || response.status !== 200) return null;
        const bytes = await readCapped(response, 16 * 1024);
        if (controller.signal.aborted || bytes === "too_large") return null;
        const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        const after = o.now();
        if (!Number.isSafeInteger(after) || after < before) return null;
        const signature = await svcVerify(o.secret, { method: "POST", path, headers: response.headers, body: raw, nowS: Math.floor(after / 1000) });
        if (!signature.ok || signature.id !== `${id}:proof`) return null;
        return { value: JSON.parse(raw) as unknown, selectorSha256: createHash("sha256").update(body).digest("hex"), now: after };
      })().catch(() => null);
      return await Promise.race([request, deadline]);
    } finally { clearTimeout(timer!); controller.abort(); }
  };
}
