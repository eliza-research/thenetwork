// PLAT-17: +1 numbers in the US and Canada only. The Caribbean and Atlantic NANP countries (premium
// SMS-pumping destinations), toll-free and other non-geographic codes, and N11 codes are refused,
// both as input and on /api/auth/otp/start (nothing is sent for them).
import { describe, expect, test } from "bun:test";
import { createPublicApi } from "../src/api.ts";
import { normalizePhone } from "../src/phone.ts";
import { MemoryPeopleStore } from "../src/store.ts";

const REFUSED = ["+1 876 555 0101", "+1 809 555 0101", "+1 242 555 0101", "+1 268 555 0101", "+1 473 555 0101", "+1 649 555 0101", "+1 868 555 0101",
  "+1 900 555 0101", "+1 800 555 0101", "+1 888 555 0101", "+1 500 555 0101", "+1 411 555 0101", "+1 911 555 0101", "+1 212 411 0101", "+1 290 555 0101", "+1 370 555 0101"];
const ACCEPTED = ["+1 212 555 0101", "(415) 555-0101", "416-555-0101", "+1 604 555 0101", "1 718 555 0101", "+1 787 555 0101"];

describe("US and Canada only", () => {
  test("normalizePhone refuses Caribbean, toll-free, premium, N11 and reserved codes and keeps US and Canadian numbers", () => {
    for (const p of REFUSED) expect([p, normalizePhone(p)]).toEqual([p, undefined]);
    for (const p of ACCEPTED) expect(normalizePhone(p)).toMatch(/^\+1\d{10}$/);
  });

  test("otp/start sends nothing to a refused number", async () => {
    let sent = 0;
    const api = createPublicApi({ store: new MemoryPeopleStore(), otp: { name: "fake", send: async () => { sent++; return { code: "123456" }; } }, env: { PLATFORM_ENV: "dev" }, minStartMs: 0, minVerifyMs: 0, log: () => {} });
    for (const phone of REFUSED) {
      const res = (await api.fetch(new Request("http://localhost:5102/api/auth/otp/start", { method: "POST", headers: { host: "localhost:5102", "content-type": "application/json" }, body: JSON.stringify({ phone }) })))!;
      expect([phone, res.status, (await res.json()).error]).toEqual([phone, 400, "invalid_phone"]);
    }
    expect(sent).toBe(0);
  });
});
