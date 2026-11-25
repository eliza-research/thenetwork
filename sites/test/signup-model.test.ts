import { afterAll, describe, expect, test } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PLUGINS_DIR, SITES, type Site, pluginSignupProblems, replaySignupPaths, signupStepProblems, skillText } from "../sites.ts";
import type { SignupReport } from "../../packages/core/src/generated/agentSignup.ts";

const tmp = mkdtempSync(join(tmpdir(), "signup-model-test-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const site = (app: string): Site => SITES.find(s => s.app === app)!;
const NATIVE = SITES.filter(s => s.app !== "peon");

const NATIVE_STOPS: SignupReport[] = [
  "ReportSaved", "ReportUnsupported", "ReportOtherApp", "ReportUnderAge", "ReportDeclined", "ReportSaveUnconfirmed",
  "ReportAlreadyMember", "ReportInviteNeeded", "ReportInviteUnavailable", "ReportOnHold", "ReportStopped", "ReportNotSaved",
];
const PEON_CONNECTOR_STOPS: SignupReport[] = [
  "ReportSaved", "ReportOtherApp", "ReportUnderAge", "ReportDeclined", "ReportSaveUnconfirmed",
  "ReportInviteNeeded", "ReportInviteUnavailable", "ReportOnHold", "ReportStopped", "ReportNotSaved",
];
const PEON_MESSAGES_STOPS: SignupReport[] = ["ReportSendTheText", "ReportUnderAge", "ReportDeclined"];

describe("each served skill replays every path of the agentSignup model", () => {
  for (const s of SITES) {
    test(s.domain, () => {
      const { problems, paths } = replaySignupPaths(s, skillText(s.skill));
      expect(problems).toEqual([]);
      const setups = paths.filter(p => p.branch === null).map(p => `${p.setup} ${p.transport} ${p.report}`);
      if (s.app === "peon") {
        expect(setups).toEqual([
          "ToolsPresent ConnectorHandoff ReportSaved",
          "ConnectorAdded ConnectorHandoff ReportSaved",
          "ConnectorNotAdded MessagesHandoff ReportSendTheText",
          "ConnectorImpossible MessagesHandoff ReportSendTheText",
        ]);
        expect(new Set(paths.filter(p => p.transport === "ConnectorHandoff").map(p => p.report))).toEqual(new Set(PEON_CONNECTOR_STOPS));
        expect(new Set(paths.filter(p => p.transport === "MessagesHandoff").map(p => p.report))).toEqual(new Set(PEON_MESSAGES_STOPS));
      } else {
        expect(setups).toEqual([
          "ToolsPresent NativeConnectorHandoff ReportSaved",
          "ConnectorAdded NativeConnectorHandoff ReportSaved",
          "ConnectorNotAdded NoTransport ReportUnsupported",
          "ConnectorImpossible NoTransport ReportUnsupported",
        ]);
        expect(new Set(paths.map(p => p.report))).toEqual(new Set(NATIVE_STOPS));
      }
    });
  }
});

test("a path below the join age stops, and a teen path ends at the end of its transport", () => {
  for (const s of SITES) {
    const { paths } = replaySignupPaths(s, skillText(s.skill));
    const under13 = paths.filter(p => p.branch?.startsWith("draftProfile(Under13)"));
    expect(under13.length, s.domain).toBeGreaterThan(0);
    for (const p of under13) expect(p.report, `${s.domain} ${p.setup}`).toBe("ReportUnderAge");
    const teen = paths.filter(p => p.branch?.startsWith("draftProfile(Teen)"));
    expect(teen.length, s.domain).toBeGreaterThan(0);
    for (const p of teen) expect(p.report, `${s.domain} ${p.setup}`).toBe(p.transport === "MessagesHandoff" ? "ReportSendTheText" : "ReportSaved");
  }
});

test("a person who asks for changes drafts again, and a person who has not finished in the browser goes back to the browser step", () => {
  for (const s of SITES) {
    const { paths } = replaySignupPaths(s, skillText(s.skill));
    for (const p of paths.filter(x => x.branch?.startsWith("decideApproval(AskChanges)"))) {
      expect(p.report, `${s.domain} ${p.setup}`).toBe(p.transport === "MessagesHandoff" ? "ReportSendTheText" : "ReportSaved");
    }
    expect(paths.some(p => p.branch?.startsWith("observeBrowser(BrowserWaiting, true)") && p.report === "ReportSaved"), s.domain).toBe(true);
  }
  const peon = replaySignupPaths(site("peon"), skillText(site("peon").skill)).paths;
  expect(peon.some(p => p.branch?.startsWith("checkSiteStatus(true, SiteNotJoined)") && p.report === "ReportSaved")).toBe(true);
  expect(peon.some(p => p.report === "ReportAlreadyMember")).toBe(false);
  for (const s of NATIVE) {
    const native = replaySignupPaths(s, skillText(s.skill)).paths;
    expect(native.some(p => p.branch?.startsWith("checkSiteStatus(true, SiteNotJoined)") && p.report === "ReportSaveUnconfirmed"), s.domain).toBe(true);
  }
});

test("the Peon connector path cannot check the status before the browser step", () => {
  const peon = site("peon");
  const text = skillText(peon.skill);
  expect(text).toMatch(/<!--\s*agentSignup ConnectorHandoff:[^>]*\bobserveBrowser\b/);
  const withoutBrowser = text.replace(/(<!--\s*agentSignup ConnectorHandoff:[^>]*?)\bobserveBrowser\s+/g, "$1")
    .replace(/<!--\s*agentSignup ConnectorHandoff:\s*observeBrowser\s*-->/g, "");
  expect(withoutBrowser).not.toMatch(/\bobserveBrowser\b/);
  expect(signupStepProblems(peon, withoutBrowser).join("\n"))
    .toContain('the agentSignup model does not allow "checkSiteStatus" in phase HandedOff (ConnectorHandoff)');
});

test("a native skill without the connector setup step fails the paths that do not have the connector tools", () => {
  const slop = site("slop");
  const text = skillText(slop.skill).replace("checkConnectorSetup resumeAfterConnector chooseTransport", "chooseTransport");
  const { problems } = replaySignupPaths(slop, text);
  expect(problems.join("\n")).toContain('the agentSignup model does not allow "chooseTransport" in phase CheckingCapability (NoTransport); path ConnectorNotAdded');
  expect(problems.join("\n")).toContain('the agentSignup model does not allow "chooseTransport" in phase CheckingCapability (NoTransport); path ConnectorImpossible');
  expect(problems.join("\n")).not.toContain("path ToolsPresent");
});

test("every plugin snapshot replays every path of the agentSignup model", () => {
  expect(pluginSignupProblems()).toEqual([]);
});

test("a plugin snapshot that hands off before the draft approval is reported with its plugin path", () => {
  const plugins = join(tmp, "plugins");
  cpSync(PLUGINS_DIR, plugins, { recursive: true });
  const file = join(plugins, "claude", "skills", "slop-date", "SKILL.md");
  const source = readFileSync(file, "utf8");
  const reordered = source.replace(
    /<!-- agentSignup: (decideApproval|offerHandoff) -->/g,
    (_, event) => `<!-- agentSignup: ${event === "decideApproval" ? "offerHandoff" : "decideApproval"} -->`,
  );
  expect(reordered).not.toBe(source);
  writeFileSync(file, reordered);
  const problems = pluginSignupProblems(plugins).join("\n");
  expect(problems).toContain("plugins/claude/skills/slop-date/SKILL.md:");
  expect(problems).toContain('the agentSignup model does not allow "offerHandoff" in phase AwaitingApproval (NativeConnectorHandoff)');
  expect(problems).not.toContain("plugins/openai/");
});
