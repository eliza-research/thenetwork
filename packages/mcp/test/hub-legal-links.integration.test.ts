// spec/authorizationPages.md, "Every page shows the brand mark and the legal links". ntwrk.party renders the connector
// pages of every app at /mcp/<app> (spec/connectorTools.md). The legal links of a page for slop, peon or friends then open
// that app's own site, because the text consent names that app's terms. On the app's own site the links stay relative.
// The real platform (people store, OTP service, accounts, sessions) with a fake OTP provider; nothing is sent.
import { describe, expect, test } from "vitest";
import type { McpAppId } from "../src/apps.ts";
import { CHALLENGE, origin, PHONE_B, register, setup, type Env } from "./harness.ts";

const RETURN = "https://client.example/callback";
const SITE: Record<McpAppId, string> = { ntwrk: "ntwrk.party", slop: "slop.date", peon: "peon.biz", friends: "friends.help" };

/** The apps whose consent page on ntwrk.party offers the signup form to a new person (peon.biz offers none there). */
const SIGNUP: McpAppId[] = ["ntwrk", "slop", "friends"];

/** The href of each link on a page, in order. */
const hrefs = (html: string) => [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map(m => m[1]!.replaceAll("&amp;", "&"));

/** Authorize `app` on `domain` with a new phone, then open the signup form when the consent page offers it. */
async function signupPages(env: Env, domain: string, app: McpAppId) {
  const reg = await register(env, domain, { redirect_uris: [RETURN] });
  expect(reg.res.status).toBe(201);
  const resource = domain === "ntwrk.party" ? `https://ntwrk.party${app === "ntwrk" ? "/mcp" : `/mcp/${app}`}` : `${origin(domain)}/mcp`;
  const q = new URLSearchParams({
    response_type: "code", client_id: reg.body.client_id, redirect_uri: RETURN, code_challenge: CHALLENGE,
    code_challenge_method: "S256", state: `st-${app}`, scope: "membership:read profile:write", resource,
  });
  const start = await env.fetch(new Request(`${origin(domain)}/oauth/authorize?${q}`));
  const phoneForm = await start.text();
  expect(start.status, phoneForm.slice(0, 300)).toBe(200);
  const rid = /name="rid" value="([^"]+)"/.exec(phoneForm)?.[1];
  const browser = /((?:__Host-)?mcp_auth=[^;]+)/.exec(start.headers.get("set-cookie") ?? "")?.[1];
  if (!rid || !browser) throw new Error("no authorization request");
  const cookies = new Map<string, string>([[browser.slice(0, browser.indexOf("=")), browser.slice(browser.indexOf("=") + 1)]]);
  const post = async (path: string, form: Record<string, string>) => {
    const res = await env.fetch(new Request(`${origin(domain)}${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: origin(domain), cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") },
      body: new URLSearchParams({ rid, ...form }).toString(),
    }));
    for (const header of res.headers.getSetCookie()) {
      const pair = header.split(";")[0]!; const at = pair.indexOf("=");
      if (pair.slice(at + 1)) cookies.set(pair.slice(0, at), pair.slice(at + 1)); else cookies.delete(pair.slice(0, at));
    }
    return res;
  };
  env.clock.t += 31_000;
  expect((await post("/oauth/authorize/phone", { phone: PHONE_B })).status).toBe(200);
  const code = env.provider.last(PHONE_B);
  if (!code) throw new Error("no code sent");
  const consent = await (await post("/oauth/authorize/code", { code })).text();
  if (!consent.includes('action="/oauth/authorize/signup"')) return { phoneForm, consent, signup: null };
  const signup = await post("/oauth/authorize/signup", { decision: "open" });
  expect(signup.status).toBe(200);
  return { phoneForm, consent, signup: await signup.text() };
}

describe("the legal links of a connector page open the pages of the app it is for", () => {
  for (const app of ["slop", "peon", "friends"] as const) {
    test(`ntwrk.party at /mcp/${app}: the brand mark, the terms, the text messaging terms and the privacy policy are on ${SITE[app]}`, async () => {
      const site = `https://${SITE[app]}`;
      const pages = await signupPages(setup(), "ntwrk.party", app);
      for (const html of [pages.phoneForm, pages.consent]) {
        const links = hrefs(html);
        expect(links).toContain(`${site}/`);
        expect(links).toContain(`${site}/privacy`);
        expect(links).toContain(`${site}/terms`);
        // No link opens ntwrk.party's own home or legal pages.
        expect(links.filter(h => h === "/" || h.startsWith("/terms") || h.startsWith("/privacy"))).toEqual([]);
      }
      expect(pages.signup !== null).toBe(SIGNUP.includes(app));
      if (pages.signup === null) return;
      const links = hrefs(pages.signup);
      expect(links).toEqual(expect.arrayContaining([`${site}/terms#sms`, `${site}/terms`, `${site}/privacy`, `${site}/`]));
      expect(links.filter(h => h === "/" || h.startsWith("/terms") || h.startsWith("/privacy"))).toEqual([]);
    });
  }

  test("ntwrk.party for The Network itself, and an app on its own site, keep relative links", async () => {
    for (const [domain, app] of [["ntwrk.party", "ntwrk"], ["friends.help", "friends"]] as const) {
      const pages = await signupPages(setup(), domain, app);
      if (pages.signup === null) throw new Error(`${domain} offers no signup`);
      const links = hrefs(pages.signup);
      expect(links, domain).toEqual(expect.arrayContaining(["/", "/terms#sms", "/terms", "/privacy"]));
      expect(links.filter(h => h.startsWith("https://")), domain).toEqual([]);
    }
  });
});
