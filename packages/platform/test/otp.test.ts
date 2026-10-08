// Per-IP OTP limits bucket IPv6 by /64 (audit: one /64, which any VPS has, gave unlimited buckets).
//   bun test packages/platform/test/otp.test.ts
import { describe, expect, test } from "bun:test";
import { APPS } from "../src/apps.ts";
import { ipBucket, OtpService, type OtpProvider } from "../src/otp.ts";
import { MemoryPeopleStore } from "../src/store.ts";

class Quiet implements OtpProvider {
  readonly name = "dev";
  sent = 0;
  async send() { this.sent++; return { code: "123456" }; }
}

describe("ipBucket", () => {
  test("IPv4 as it is; IPv6 by its /64, whatever the spelling", () => {
    expect(ipBucket("203.0.113.7")).toBe("203.0.113.7");
    expect(ipBucket("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(ipBucket("2001:db8:1:2::1")).toBe("2001:db8:1:2::/64");
    expect(ipBucket("2001:0db8:0001:0002:ffff:0:0:28")).toBe("2001:db8:1:2::/64");
    expect(ipBucket("[2001:db8:1:2::99]")).toBe("2001:db8:1:2::/64");
    expect(ipBucket("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(ipBucket("2001:db8:1:3::1")).not.toBe(ipBucket("2001:db8:1:2::1"));
    expect(ipBucket("unknown")).toBe("unknown");
  });

  test("40 code requests from one /64 to 40 numbers: only the per-IP limit (10) are sent", async () => {
    const provider = new Quiet();
    const otp = new OtpService(new MemoryPeopleStore(), provider, { hashKey: "k".repeat(32), now: () => Date.UTC(2026, 9, 8, 12) });
    let ok = 0;
    for (let i = 1; i <= 40; i++) {
      // 555-01xx test numbers only.
      const r = await otp.start(APPS.slop, `+1212555${String(100 + (i % 100)).padStart(4, "0")}`, `2001:db8:1:2::${i.toString(16)}`);
      if (r.ok) ok++;
    }
    expect(ok).toBe(otp.limits.perIpPerHour);
    expect(provider.sent).toBe(otp.limits.perIpPerHour);
  });
});
