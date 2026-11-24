// spec/phonePage.md, "The new number goes to the server only when it is valid and the mode is known"
// The /phone page flow through the site router and the shared backend: the page's own API modules
// (packages/ui/src/api/phone.ts, stepPages.ts, join.ts) and its sign-in shell (packages/ui/src/hooks/stepSignIn.ts)
// send each server answer to the generated phone page machine, as usePhonePage does. Only the DOM is left out:
// the PhonePageView play tests cover it. The relative fetch of the page goes to the site of the test browser.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { enabled, type Event, initial, inv, type PhonePage, step } from "../../packages/core/src/generated/phonePage.ts";
import { signInAttemptNone } from "../../packages/core/src/generated/oneStepPage.ts";
import type { AppId } from "../../packages/platform/src/apps.ts";
import { confirmNumberChange, type PhoneStartResult, startNumberChange } from "../../packages/ui/src/api/phone.ts";
import { readStepSession } from "../../packages/ui/src/api/stepPages.ts";
import { createSignIn, emptySignInFields, type SignInFields } from "../../packages/ui/src/hooks/stepSignIn.ts";
import { Browser, newPhone, pgAvailable, startStack, webJoin, type Stack } from "./harness.ts";

const T = 180_000;
const MIN = 60_000;
const realFetch = globalThis.fetch;

test("session load discards a stale change and a mode result keeps its screen", () => {
  const loading: PhonePage = { ...initial, screen: "PhoneLoading", changeStarted: true };
  expect(inv(loading)).toBe(true);
  const signedOut = step(loading, { type: "phoneLoaded", session: "SessionSignedOut", cloudReturn: "CloudReturnNone" });
  expect(signedOut).toMatchObject({ screen: "PhoneSignIn", pending: "PhoneIdle", changeStarted: false });
  expect(inv(signedOut)).toBe(true);

  const changing: PhonePage = { ...initial, screen: "PhoneNewNumber", changeStarted: true,
    signIn: { ...initial.signIn, stage: "SignInVerified" } };
  expect(inv(changing)).toBe(true);
  const mode = step(changing, { type: "moveSignIn", attempt: { ...signInAttemptNone, kind: "AttemptReadMode", lookup: "SignInLookupOtp" } });
  expect(mode).toMatchObject({ screen: "PhoneNewNumber", changeStarted: true, signIn: { auth: "SignInOtp" } });
  expect(inv(mode)).toBe(true);
});

/** The page's same-origin requests go to the site of `app`, with the cookies of `browser`. */
function pageOn(st: Stack, app: AppId, browser: Browser): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    typeof input === "string" && input.startsWith("/") ? st.site(app, input, { ...init, browser }) : realFetch(input, init)) as typeof fetch;
}

async function until(done: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (done()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`the page did not reach: ${what}`);
}

/** The phone page as usePhonePage runs it, without React. */
function phonePage() {
  let page: PhonePage = initial;
  let fields: SignInFields = { ...emptySignInFields };
  const send = (event: Event): PhonePage | undefined => {
    if (!enabled(page, event)) return undefined;
    page = step(page, event);
    return page;
  };
  const signIn = createSignIn({
    siteKey: "",
    returnPath: "/phone",
    move: (attempt) => send({ type: "moveSignIn", attempt })?.signIn,
    fields: () => fields,
    patch: (more) => { fields = { ...fields, ...more }; },
    afterVerified: async () => { send({ type: "phoneSessionRead", session: await readStepSession() }); },
  });
  let last: PhoneStartResult | undefined;
  return {
    get page() { return page; },
    get lastStart() { return last; },
    send,
    signIn,
    type: (more: Partial<SignInFields>) => { fields = { ...fields, ...more }; },
    async open() {
      send({ type: "openPhonePage" });
      send({ type: "phoneLoaded", session: await readStepSession(), cloudReturn: "CloudReturnNone" });
      await signIn.readMode();
    },
    async submitNewNumber(e164: string) {
      if (!send({ type: "submitNewNumber", numberValid: true })) throw new Error("the new-number form refused");
      const started = await startNumberChange(e164);
      last = started;
      return send({ type: "answerNumberStart", startAnswer: started.answer, retryKnown: started.retryAfterSeconds !== undefined });
    },
    async submitChangeCode(code: string) {
      if (!send({ type: "submitChangeCode", codeDigits: code.length })) throw new Error("the code form refused");
      const confirmed = await confirmNumberChange(code);
      return { page: send({ type: "answerNumberConfirm", confirmAnswer: confirmed.answer }), phoneMasked: confirmed.phoneMasked };
    },
    async resend(e164: string) {
      if (!send({ type: "resendChangeCode" })) throw new Error("the resend was refused");
      const started = await startNumberChange(e164);
      last = started;
      return send({ type: "answerChangeResend", startAnswer: started.answer, retryKnown: started.retryAfterSeconds !== undefined });
    },
  };
}

/** The sign-in on the page with the code that the fake provider kept. */
async function signInOnPage(st: Stack, page: ReturnType<typeof phonePage>, phone: string) {
  st.clock.advance(31_000);
  page.type({ phone });
  page.signIn.onSubmitPhone();
  await until(() => page.page.signIn.stage === "SignInCode", "the sign-in code step");
  page.type({ code: st.otp.last(phone)! });
  page.signIn.onSubmitCode();
  await until(() => page.page.screen !== "PhoneSignIn" && page.page.screen !== "PhoneChecking", "the step after the sign-in");
}

describe.skipIf(!pgAvailable)("the /phone page on a text-code sign-in site", () => {
  let st: Stack;
  beforeAll(async () => { st = await startStack(); }, T);
  afterAll(async () => { await st?.close(); }, T);
  afterEach(() => { globalThis.fetch = realFetch; });

  // spec/oneStepPage.md, "Each step page is on the sites that can do the step"
  test("every site serves /phone, and no landing page links to it", async () => {
    for (const app of ["ntwrk", "slop", "peon", "friends"] as const) {
      const res = await st.site(app, "/phone");
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('name="robots" content="noindex"');
      expect(await (await st.site(app, "/")).text()).not.toContain('href="/phone"');
    }
  }, T);

  // spec/phonePage.md, "The sign-in step confirms the current number and then reads the session again";
  // "Only a well-formed change code goes to the server, and only a moved number shows the result"
  test("a signed-out page signs in on the current number, refuses the same number and a wrong code, and moves to the new number", async () => {
    const [A, B] = [newPhone(), newPhone()];
    const { b: old, res } = await webJoin(st, "slop", A, { age: 31, firstName: "Ana" });
    expect(res.status).toBe(200);
    const browser = new Browser();
    pageOn(st, "slop", browser);
    const page = phonePage();
    await page.open();
    expect(page.page).toMatchObject({ screen: "PhoneSignIn", notice: "NoStepNotice", signIn: { auth: "SignInOtp", check: "NoCheck" } });

    await signInOnPage(st, page, A);
    expect(page.page).toMatchObject({ screen: "PhoneNewNumber", notice: "NoStepNotice" });

    expect(await page.submitNewNumber(A)).toMatchObject({ screen: "PhoneNewNumber", error: "PhoneSameNumber" });
    expect(st.otp.last(B)).toBeUndefined();
    expect(await page.submitNewNumber(B)).toMatchObject({ screen: "PhoneCode", error: "PhoneNoError", changeStarted: true });
    const first = st.otp.last(B);
    expect(first).toMatch(/^\d{6}$/);

    st.clock.advance(31_000);
    expect(await page.resend(B)).toMatchObject({ screen: "PhoneCode", error: "PhoneNewCodeSent" });
    expect((await page.submitChangeCode("000000")).page).toMatchObject({ screen: "PhoneCode", error: "PhoneWrongCode" });

    const moved = await page.submitChangeCode(st.otp.last(B)!);
    expect(moved.page).toMatchObject({ screen: "PhoneDone", moved: true, doneSignedOut: false });
    expect(moved.phoneMasked?.endsWith(B.slice(-4))).toBe(true);
    expect(await readStepSession()).toBe("SessionSignedIn");
    pageOn(st, "slop", old);
    expect(await readStepSession()).toBe("SessionSignedOut");
  }, T);

  // spec/phonePage.md, "A sign-in that is too old starts the sign-in again on the same page"
  test("a sign-in older than ten minutes asks for the current number again, then the change starts", async () => {
    const [A, B] = [newPhone(), newPhone()];
    const { b } = await webJoin(st, "peon", A, { age: 30 });
    pageOn(st, "peon", b);
    st.clock.advance(11 * MIN);
    const page = phonePage();
    await page.open();
    expect(page.page.screen).toBe("PhoneNewNumber");

    expect(await page.submitNewNumber(B)).toMatchObject({
      screen: "PhoneSignIn", notice: "StepSignInAgain", changeStarted: false, signIn: { auth: "SignInOtp", stage: "SignInNumber" },
    });
    expect(st.otp.last(B)).toBeUndefined();

    await signInOnPage(st, page, A);
    expect(page.page).toMatchObject({ screen: "PhoneNewNumber", notice: "NoStepNotice" });
    expect(await page.submitNewNumber(B)).toMatchObject({ screen: "PhoneCode" });
  }, T);

  test("a second code to the same new number within 30 seconds is refused with the wait from retry-after", async () => {
    const [A, B] = [newPhone(), newPhone()];
    const { b } = await webJoin(st, "peon", A, { age: 30 });
    pageOn(st, "peon", b);
    const page = phonePage();
    await page.open();
    st.clock.advance(31_000);
    expect(await page.submitNewNumber(B)).toMatchObject({ screen: "PhoneCode" });
    expect(await page.resend(B)).toMatchObject({ screen: "PhoneCode", error: "PhoneRateLimited", retryKnown: true });
    expect(page.lastStart?.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(page.lastStart?.retryAfterSeconds).toBeLessThanOrEqual(30);
  }, T);

  // spec/phonePage.md, "Only a well-formed change code goes to the server, and only a moved number shows the result"
  test("a number that another person uses, and a change that expired, go back to the new-number step", async () => {
    const [A, B, C] = [newPhone(), newPhone(), newPhone()];
    const { b } = await webJoin(st, "friends", A, { age: 34 });
    await webJoin(st, "friends", C, { age: 29 });
    pageOn(st, "friends", b);
    const page = phonePage();
    await page.open();

    st.clock.advance(31_000);
    expect(await page.submitNewNumber(C)).toMatchObject({ screen: "PhoneCode" });
    expect((await page.submitChangeCode(st.otp.last(C)!)).page).toMatchObject({ screen: "PhoneNewNumber", error: "PhoneNumberInUse", changeStarted: false });

    expect(await page.submitNewNumber(B)).toMatchObject({ screen: "PhoneCode" });
    st.clock.advance(16 * MIN);
    expect((await page.submitChangeCode(st.otp.last(B)!)).page).toMatchObject({ screen: "PhoneNewNumber", error: "PhoneStartAgain" });
    expect(await readStepSession()).toBe("SessionSignedIn");
  }, T);

  // spec/phonePage.md, "The sign-in step confirms the current number and then reads the session again"
  test("a session that ended while the page was open starts the sign-in again and says so", async () => {
    const [A, B] = [newPhone(), newPhone()];
    const { b } = await webJoin(st, "slop", A, { age: 40 });
    pageOn(st, "slop", b);
    const page = phonePage();
    await page.open();
    expect(page.page.screen).toBe("PhoneNewNumber");
    b.jar.clear();
    expect(await page.submitNewNumber(B)).toMatchObject({ screen: "PhoneSignIn", notice: "StepSessionEnded" });
  }, T);
});
