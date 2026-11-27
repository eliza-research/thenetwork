import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import type { Clock } from "../clock.ts";
import type { SQL } from "../runtime/postgres.ts";
import type { DekResolution, DekSubject, TrajectoryKeyRing } from "./types.ts";

const MIN_MASTER_KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const DEK_BYTES = 32;
const KEK_INFO = Buffer.from("thenetwork-trajectory-kek-v1");
const SYS_KEY_PREFIX = "sys:";
const PERSON_KEY_PREFIX = "person:";

export function deriveMasterKek(masterKey: string): Buffer {
  if (Buffer.byteLength(masterKey, "utf8") < MIN_MASTER_KEY_BYTES) {
    throw new Error(`trajectory master key must be at least ${MIN_MASTER_KEY_BYTES} bytes`);
  }
  return Buffer.from(hkdfSync("sha256", Buffer.from(masterKey, "utf8"), Buffer.alloc(0), KEK_INFO, 32));
}

function deriveSystemDayKey(kek: Buffer, dayKey: string): Buffer {
  return Buffer.from(hkdfSync("sha256", kek, Buffer.alloc(0), Buffer.from(`thenetwork-trajectory-sys:${dayKey}`), 32));
}

function aesGcmEncrypt(plaintext: Buffer, key: Buffer, aad?: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  if (aad) cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

function aesGcmDecrypt(envelope: Buffer, key: Buffer, aad?: Buffer): Buffer {
  if (envelope.length < IV_BYTES + TAG_BYTES) {
    throw new Error("encrypted trajectory envelope truncated");
  }
  const iv = envelope.subarray(0, IV_BYTES);
  const tag = envelope.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = envelope.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  if (aad) decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function wrapDek(dek: Buffer, kek: Buffer, personId: string): Buffer {
  return aesGcmEncrypt(dek, kek, Buffer.from(personId, "utf8"));
}

export function unwrapDek(wrapped: Buffer, kek: Buffer, personId: string): Buffer {
  return aesGcmDecrypt(wrapped, kek, Buffer.from(personId, "utf8"));
}

export function encryptTrajectoryPayload(payload: Record<string, unknown>, key: Buffer, dekRef: string): string {
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  return aesGcmEncrypt(plaintext, key, Buffer.from(dekRef, "utf8")).toString("base64url");
}

export function decryptTrajectoryPayload(encoded: string, key: Buffer, dekRef: string): Record<string, unknown> {
  const raw = Buffer.from(encoded, "base64url");
  const plaintext = aesGcmDecrypt(raw, key, Buffer.from(dekRef, "utf8"));
  return JSON.parse(plaintext.toString("utf8")) as Record<string, unknown>;
}

function parsePersonRef(dekRef: string): { personId: string; version: number } | undefined {
  if (!dekRef.startsWith(PERSON_KEY_PREFIX)) return undefined;
  const rest = dekRef.slice(PERSON_KEY_PREFIX.length);
  const sep = rest.lastIndexOf(":v");
  if (sep <= 0) return undefined;
  const personId = rest.slice(0, sep);
  const version = Number(rest.slice(sep + 2));
  if (!personId || !Number.isInteger(version) || version < 1) return undefined;
  return { personId, version };
}

export class MemoryTrajectoryKeyRing implements TrajectoryKeyRing {
  private readonly kek: Buffer;
  private readonly wrappedDeks = new Map<string, { version: number; wrapped: Buffer }>();
  private readonly shredded = new Set<string>();

  constructor(masterKey: string) {
    this.kek = deriveMasterKek(masterKey);
  }

  async getOrCreateDek(subject: DekSubject): Promise<DekResolution> {
    if (subject.isMinor) return "redacted";
    if (!subject.personId) {
      const dekRef = `${SYS_KEY_PREFIX}${subject.dayKey}`;
      return { dekRef, key: deriveSystemDayKey(this.kek, subject.dayKey) };
    }
    if (this.shredded.has(subject.personId)) return "redacted";
    let entry = this.wrappedDeks.get(subject.personId);
    if (!entry) {
      const dek = randomBytes(DEK_BYTES);
      entry = { version: 1, wrapped: wrapDek(dek, this.kek, subject.personId) };
      this.wrappedDeks.set(subject.personId, entry);
      return { dekRef: `${PERSON_KEY_PREFIX}${subject.personId}:v${entry.version}`, key: dek };
    }
    return {
      dekRef: `${PERSON_KEY_PREFIX}${subject.personId}:v${entry.version}`,
      key: unwrapDek(entry.wrapped, this.kek, subject.personId),
    };
  }

  async resolveDek(dekRef: string): Promise<Buffer | undefined> {
    if (dekRef === "redacted") return undefined;
    if (dekRef.startsWith(SYS_KEY_PREFIX)) {
      const dayKey = dekRef.slice(SYS_KEY_PREFIX.length);
      return dayKey ? deriveSystemDayKey(this.kek, dayKey) : undefined;
    }
    const parsed = parsePersonRef(dekRef);
    if (!parsed || this.shredded.has(parsed.personId)) return undefined;
    const entry = this.wrappedDeks.get(parsed.personId);
    if (!entry || entry.version !== parsed.version) return undefined;
    return unwrapDek(entry.wrapped, this.kek, parsed.personId);
  }

  async shredPerson(personId: string): Promise<void> {
    this.wrappedDeks.delete(personId);
    this.shredded.add(personId);
  }

  hasPersonDek(personId: string): boolean {
    return this.wrappedDeks.has(personId);
  }
}

export class PgTrajectoryKeyRing implements TrajectoryKeyRing {
  private readonly sql: SQL;
  private readonly kek: Buffer;
  private readonly clock: Clock;
  private readonly cache = new Map<string, { version: number; key: Buffer }>();

  constructor(options: { sql: SQL; masterKey: string; clock: Clock }) {
    this.sql = options.sql;
    this.kek = deriveMasterKek(options.masterKey);
    this.clock = options.clock;
  }

  async getOrCreateDek(subject: DekSubject): Promise<DekResolution> {
    if (subject.isMinor) return "redacted";
    if (!subject.personId) {
      const dekRef = `${SYS_KEY_PREFIX}${subject.dayKey}`;
      return { dekRef, key: deriveSystemDayKey(this.kek, subject.dayKey) };
    }
    const cached = this.cache.get(subject.personId);
    if (cached) {
      return { dekRef: `${PERSON_KEY_PREFIX}${subject.personId}:v${cached.version}`, key: cached.key };
    }
    const freshDek = randomBytes(DEK_BYTES);
    const wrapped = wrapDek(freshDek, this.kek, subject.personId);
    const createdAt = new Date(this.clock.now());
    const inserted = await this.sql<{ key_version: number; wrapped_dek: Uint8Array }[]>`
      insert into analytics.trajectory_deks (person_id, key_version, wrapped_dek, created_at)
      values (${subject.personId}::uuid, 1, ${wrapped}, ${createdAt})
      on conflict (person_id) do nothing
      returning key_version, wrapped_dek`;
    if (inserted.length === 1) {
      const version = Number(inserted[0]!.key_version);
      this.cache.set(subject.personId, { version, key: freshDek });
      return { dekRef: `${PERSON_KEY_PREFIX}${subject.personId}:v${version}`, key: freshDek };
    }
    const existing = await this.sql<{ key_version: number; wrapped_dek: Uint8Array }[]>`
      select key_version, wrapped_dek from analytics.trajectory_deks where person_id = ${subject.personId}::uuid`;
    const row = existing[0];
    if (!row) return "redacted";
    const version = Number(row.key_version);
    const key = unwrapDek(Buffer.from(row.wrapped_dek), this.kek, subject.personId);
    this.cache.set(subject.personId, { version, key });
    return { dekRef: `${PERSON_KEY_PREFIX}${subject.personId}:v${version}`, key };
  }

  async resolveDek(dekRef: string): Promise<Buffer | undefined> {
    if (dekRef === "redacted") return undefined;
    if (dekRef.startsWith(SYS_KEY_PREFIX)) {
      const dayKey = dekRef.slice(SYS_KEY_PREFIX.length);
      return dayKey ? deriveSystemDayKey(this.kek, dayKey) : undefined;
    }
    const parsed = parsePersonRef(dekRef);
    if (!parsed) return undefined;
    const cached = this.cache.get(parsed.personId);
    if (cached && cached.version === parsed.version) return cached.key;
    const rows = await this.sql<{ key_version: number; wrapped_dek: Uint8Array }[]>`
      select key_version, wrapped_dek from analytics.trajectory_deks
      where person_id = ${parsed.personId}::uuid and key_version = ${parsed.version}`;
    const row = rows[0];
    if (!row) return undefined;
    const key = unwrapDek(Buffer.from(row.wrapped_dek), this.kek, parsed.personId);
    this.cache.set(parsed.personId, { version: parsed.version, key });
    return key;
  }

  async shredPerson(personId: string): Promise<void> {
    this.cache.delete(personId);
    await this.sql`delete from analytics.trajectory_deks where person_id = ${personId}::uuid`;
  }
}
