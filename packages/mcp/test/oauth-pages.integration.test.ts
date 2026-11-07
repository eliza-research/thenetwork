// The OAuth pages: CSP form targets, the retry link and escaping, through the real handler and renderers.
import { describe, expect, test } from "bun:test";
import { defaultApps } from "../src/apps.ts";
import { codePage, consentPage, messagePage } from "../src/pages.ts";
import { CHALLENGE, origin, register, setup } from "./harness.ts";

const PEON = "peon.biz";
const app = defaultApps().peon;
const csp = (r: Response) => r.headers.get("content-security-policy")!;
const formAction = (r: Response) => /form-action [^;]*/.exec(csp(r))![0];

async function phonePageFor(redirectUri: string) {
  const env = setup();
  const reg = await register(env, PEON, { redirect_uris: [redirectUri] });
  const q = new URLSearchParams({ response_type: "code", client_id: reg.body.client_id, redirect_uri: redirectUri, code_challenge: CHALLENGE, code_challenge_method: "S256", state: "x" });
  const start = await env.fetch(new Request(`${origin(PEON)}/oauth/authorize?${q}`));
  const page = await start.clone().text();
  const rid = /name="rid" value="([^"]+)"/.exec(page)![1]!;
  const cookie = /((?:__Host-)?mcp_auth=[^;]+)/.exec(start.headers.get("set-cookie")!)![1]!;
  const cancel = await env.fetch(new Request(`${origin(PEON)}/oauth/authorize/cancel`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie, origin: origin(PEON) }, body: new URLSearchParams({ rid }).toString() }));
  return { start, cancel };
}

describe("Cancel reaches the client", () => {
  test.each([["https://client.example/callback", "https://client.example"], ["http://127.0.0.1:5299/callback", "http://127.0.0.1:5299"], ["http://localhost:6274/oauth/callback", "http://localhost:6274"]])("phone page of %s allows the redirect of its own Cancel", async (redirectUri, source) => {
    const { start, cancel } = await phonePageFor(redirectUri);
    expect(formAction(start)).toBe(`form-action 'self' ${source}`);
    expect(cancel.status).toBe(303);
    const to = new URL(cancel.headers.get("location")!);
    expect(to.origin).toBe(source);
    expect(to.searchParams.get("error")).toBe("access_denied");
  });

  test("code page lists the redirect host it is given and nothing else", () => {
    expect(formAction(codePage(app, "rid", "0123", { redirectHost: "client.example" }))).toBe("form-action 'self' https://client.example");
    expect(formAction(codePage(app, "rid", "0123", { redirectHost: "127.0.0.1:5299" }))).toBe("form-action 'self' http://127.0.0.1:5299");
    expect(formAction(codePage(app, "rid", "0123"))).toBe("form-action 'self'");
  });

  test("a host that only starts like a loopback name stays https", async () => {
    const { start } = await phonePageFor("https://localhost.evil.example/cb");
    expect(formAction(start)).toBe("form-action 'self' https://localhost.evil.example");
  });
});

describe("CSP form targets", () => {
  test.each(["https://x;sandbox;y.example", "https://a,b.example", "https://a b.example", "https://a\tb.example"])("%j cannot enter the header", origin => {
    const res = consentPage(app, "rid", "Client", "host", origin, []);
    expect(formAction(res)).toBe("form-action 'self'");
    expect(csp(res).split("; ")).toHaveLength(9);
    expect(csp(res)).not.toContain(",");
  });

  test("a clean target stays", () => {
    expect(formAction(consentPage(app, "rid", "Client", "host", "https://chatgpt.com", []))).toBe("form-action 'self' https://chatgpt.com");
  });
});

describe("the retry link stays on the site", () => {
  const link = async (path: string) => /<a href="([^"]*)">Try again<\/a>/.exec(await messagePage(app, "t", "x", 503, path).text())?.[1];

  test.each(["/\\evil.example", "/\t/evil.example", "/\n/evil.example", "/\r\\evil.example", "//evil.example", "https://evil.example/", "evil", "", "/ok\\path"])("%j gives no link", async path => {
    expect(await link(path)).toBeUndefined();
  });

  test.each(["/oauth/cloud-return?rid=abc_DEF-123", "/oauth/consents", "/", "/a/b?x=1&y=2"])("%j gives a same-site link", async path => {
    const shown = (await link(path))!.replaceAll("&amp;", "&");
    expect(shown).toBe(path);
    expect(new URL(shown, "https://peon.biz").origin).toBe("https://peon.biz");
  });
});

test("a client name cannot add markup to the consent page", async () => {
  const hostile = `"><script>alert('x')</script>&amp;`;
  const html = await consentPage(app, "rid", hostile, "host", "https://client.example", []).text();
  expect(html).toContain("&quot;&gt;&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;&amp;amp;");
  expect(html).not.toContain("<script>alert");
});
