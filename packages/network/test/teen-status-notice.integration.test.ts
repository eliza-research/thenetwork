import { expect, test } from "vitest";
import type { MemberId } from "@thenetwork/core";
import { Mini, type Spec } from "./mini.ts";
import { holdEveryItem } from "../../engine/src/reviewJudge.ts";

const climber = (id: string, name: string, age: number): Spec => ({
  id, name, age, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"],
  wants: [{ objective: "find a regular climbing partner", category: "hobby" }],
});

const BORN: Record<string, number> = { t16: 20100315, t17: 20090601 };

function world(app: "friends" | "ntwrk", exact: boolean) {
  const w = new Mini([climber("t16", "Tess Ruiz", 16), climber("t17", "Uma Park", 17)], { app, inlineJudge: holdEveryItem.inline });
  if (exact) for (const id of ["t16", "t17"]) Object.assign(w.members.find(m => m.id === id)!, { birthKey: BORN[id], birthExact: true, ageConflict: false, teenBarred: false });
  return w;
}

for (const app of ["friends", "ntwrk"] as const) {
  test(`the ${app} status notice of a minor promises friends only to a teen-ready member while staff have not stopped teen introductions`, async () => {
    const w = world(app, true);
    await w.onboard("t16", "t17");
    expect(w.net.minorNoticeOf("t16")).toBe("MinorTeenFriendNotice");
    expect(w.net.minorNoticeOf("t17")).toBe("MinorTeenFriendNotice");

    expect(w.net.stopTeenIntros("admin-a")).toEqual({ ok: true });
    expect(w.net.minorNoticeOf("t16")).toBe("MinorSinglePlayerNotice");
    w.restart();
    expect(w.net.minorNoticeOf("t16")).toBe("MinorSinglePlayerNotice");
    expect(w.net.resumeTeenIntros("admin-a")).toEqual({ ok: true });
    expect(w.net.minorNoticeOf("t16")).toBe("MinorTeenFriendNotice");

    const st = w.net.exportState();
    for (const m of st.members) if (m.id === "t17") m.minorSignal = true;
    w.net.importState(st);
    expect(w.net.minorNoticeOf("t17")).toBe("MinorSinglePlayerNotice");
    expect(w.net.minorNoticeOf("t16")).toBe("MinorTeenFriendNotice");

    const reported = w.net.exportState();
    for (const m of reported.members) if (m.id === "t16") m.minorReported = true;
    w.net.importState(reported);
    expect(w.net.minorNoticeOf("t16")).toBe("MinorSinglePlayerNotice");
    expect(w.net.minorNoticeOf("nobody" as MemberId)).toBeUndefined();
  });

  test(`the ${app} status notice of a minor with no exact birth date asks for the birthday only while staff have not stopped teen introductions`, async () => {
    const w = world(app, false);
    await w.onboard("t16");
    expect(w.net.minorNoticeOf("t16")).toBe("MinorBirthdayNotice");
    expect(w.net.stopTeenIntros("admin-a")).toEqual({ ok: true });
    expect(w.net.minorNoticeOf("t16")).toBe("MinorSinglePlayerNotice");
  });
}
