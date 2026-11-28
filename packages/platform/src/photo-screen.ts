import { createHash } from "node:crypto";
import { ratingMaxBytes } from "../../core/src/generated/photoPolicy.ts";
import { ClefError, clefRun, type ClefFetch, type ClefQuestion } from "../../engine/src/packs/slop/clef.ts";
import type { AppId } from "./apps.ts";
import type { PhotoType } from "./photos.ts";

const PHOTO_SCREEN_MODEL = "clef-flash" as const;
const PHOTO_SCREEN_TIMEOUT_MS = 4000;
const PHOTO_SCREEN_CACHE_MAX_ENTRIES = 1024;
const PHOTO_SCREEN_STATE = "A photo that one adult member of a dating app chose to send privately to one adult match. Judge only what is visible in the photo.";
const PHOTO_SCREEN_QUESTIONS: Record<string, ClefQuestion> = {
  "unsafe.sexual": { type: "noul", instructions: "Does this photo show nudity, exposed genitals, sexual activity or sexual content?" },
  "unsafe.minor": { type: "noul", instructions: "Could any person in this photo be under 18 years old?" },
  "unsafe.violence": { type: "noul", instructions: "Does this photo show violence, blood, injury, gore, self-harm or a weapon pointed at someone?" },
  "unsafe.hate": { type: "noul", instructions: "Does this photo show a hate symbol, a hateful gesture or hateful text?" },
  "unsafe.contact": { type: "noul", instructions: "Does this photo show a phone number, an email address, a street address, a QR code, a payment handle or a social media handle?" },
};

export type PhotoScreenResult = { kind: "answered"; riskPerMille: number } | { kind: "unanswered" } | { kind: "unusable" };
type PhotoScreenOutcome = "ok" | "unparsed" | "error" | "timeout";
interface PhotoScreenCall { app: AppId; model: string; outcome: PhotoScreenOutcome; status?: number; inputTokens?: number }
export interface PhotoScreenImage { bytes: Uint8Array; contentType: PhotoType }
export interface PhotoScreen {
  readonly id: string;
  screen(image: PhotoScreenImage, app: AppId): Promise<PhotoScreenResult>;
}

function parsePhotoScreenAnswers(answers: unknown): PhotoScreenResult {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return { kind: "unanswered" };
  let risk = 0;
  for (const id of Object.keys(PHOTO_SCREEN_QUESTIONS)) {
    const answer = (answers as Record<string, unknown>)[id];
    if (!answer || typeof answer !== "object") return { kind: "unanswered" };
    const value = (answer as { noul?: unknown }).noul;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) return { kind: "unanswered" };
    risk = Math.max(risk, value);
  }
  return { kind: "answered", riskPerMille: Math.ceil(risk * 1000) };
}

interface WorkersAiPhotoScreenOptions {
  token: string;
  accountId: string;
  fetch?: ClefFetch;
  baseUrl?: string;
  onCall?: (call: PhotoScreenCall) => void;
  maxCacheEntries?: number;
}

class WorkersAiPhotoScreen implements PhotoScreen {
  readonly id = `screen:${PHOTO_SCREEN_MODEL}`;
  private readonly cache = new Map<string, Extract<PhotoScreenResult, { kind: "answered" }>>();
  private readonly maxCacheEntries: number;
  constructor(private readonly o: WorkersAiPhotoScreenOptions) {
    if (!o.token || !o.accountId) throw new ClefError("the photo screen needs CLOUDFLARE_AI_TOKEN and CLOUDFLARE_ACCOUNT_ID");
    this.maxCacheEntries = o.maxCacheEntries ?? PHOTO_SCREEN_CACHE_MAX_ENTRIES;
  }

  private cacheGet(key: string): PhotoScreenResult | undefined {
    const hit = this.cache.get(key);
    if (!hit) return undefined;
    this.cache.delete(key);
    this.cache.set(key, hit);
    return { ...hit };
  }

  private cacheSet(key: string, value: Extract<PhotoScreenResult, { kind: "answered" }>): void {
    if (this.maxCacheEntries <= 0) return;
    this.cache.delete(key);
    this.cache.set(key, { ...value });
    while (this.cache.size > this.maxCacheEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  async screen(image: PhotoScreenImage, app: AppId): Promise<PhotoScreenResult> {
    if (image.bytes.byteLength > ratingMaxBytes) return { kind: "unusable" };
    const hash = createHash("sha256").update(image.contentType).update("\0").update(image.bytes).digest("hex");
    const cached = this.cacheGet(hash);
    if (cached) return cached;
    const record = (call: Omit<PhotoScreenCall, "app" | "model">) => this.o.onCall?.({ app, model: PHOTO_SCREEN_MODEL, ...call });
    const data = `data:${image.contentType};base64,${Buffer.from(image.bytes).toString("base64")}`;
    try {
      const result = await clefRun(
        { token: this.o.token, accountId: this.o.accountId, model: PHOTO_SCREEN_MODEL, ...(this.o.fetch ? { fetch: this.o.fetch } : {}), ...(this.o.baseUrl ? { baseUrl: this.o.baseUrl } : {}) },
        { state: PHOTO_SCREEN_STATE, questions: PHOTO_SCREEN_QUESTIONS, images: [data] },
        AbortSignal.timeout(PHOTO_SCREEN_TIMEOUT_MS),
      );
      const parsed = parsePhotoScreenAnswers(result.answers);
      if (parsed.kind === "answered") this.cacheSet(hash, parsed);
      const inputTokens = result.usage?.input_tokens;
      record({ outcome: parsed.kind === "answered" ? "ok" : "unparsed", ...(typeof inputTokens === "number" ? { inputTokens } : {}) });
      return parsed;
    } catch (e) {
      const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      record({ outcome: timeout ? "timeout" : "error", ...(e instanceof ClefError && e.status ? { status: e.status } : {}) });
      return { kind: "unanswered" };
    }
  }
}

const UNCONFIGURED_PHOTO_SCREEN: PhotoScreen = { id: "screen:unconfigured", screen: async () => ({ kind: "unanswered" }) };

export function photoScreenFromEnv(env: Record<string, string | undefined>, o: Omit<WorkersAiPhotoScreenOptions, "token" | "accountId"> = {}): PhotoScreen {
  return env.CLOUDFLARE_AI_TOKEN && env.CLOUDFLARE_ACCOUNT_ID
    ? new WorkersAiPhotoScreen({ token: env.CLOUDFLARE_AI_TOKEN, accountId: env.CLOUDFLARE_ACCOUNT_ID, ...o })
    : UNCONFIGURED_PHOTO_SCREEN;
}

export function simulatedPhotoScreen(decide: (image: PhotoScreenImage, app: AppId) => PhotoScreenResult): PhotoScreen {
  return { id: "screen:simulated", screen: async (image, app) => decide(image, app) };
}
