// PLAT-08: Turnstile checks the host name the token was solved on, and a hung siteverify fails closed
// within its timeout. A fake fetch: nothing leaves the process.
import { describe, expect, test } from "bun:test";
import { CloudflareTurnstile } from "../src/turnstile.ts";

const answer = (body: unknown) => (async () => new Response(JSON.stringify(body))) as unknown as typeof fetch;

describe("Cloudflare Turnstile", () => {
  test("a token solved on another site is refused; the right host passes; no token never calls out", async () => {
    let calls = 0;
    const counting = (async () => { calls++; return new Response(JSON.stringify({ success: true, hostname: "slop.date" })); }) as unknown as typeof fetch;
    const t = new CloudflareTurnstile("secret", counting);
    expect(await t.verify("tok", "198.51.100.1", ["slop.date", "www.slop.date"])).toBe(true);
    expect(await t.verify("tok", "198.51.100.1", ["peon.biz", "www.peon.biz"])).toBe(false);
    expect(await t.verify(undefined, "198.51.100.1", ["slop.date"])).toBe(false);
    expect(calls).toBe(2);
    expect(await new CloudflareTurnstile("s", answer({ success: false, hostname: "slop.date" })).verify("tok", "ip", ["slop.date"])).toBe(false);
    expect(await new CloudflareTurnstile("s", answer({ success: true })).verify("tok", "ip", ["slop.date"])).toBe(false);
  });

  test("a hung siteverify returns false within the timeout", async () => {
    const hang = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    const t0 = performance.now();
    expect(await new CloudflareTurnstile("s", hang, 200).verify("tok", "ip")).toBe(false);
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});
