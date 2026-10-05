// Judge calibration: a small hand-labeled golden set covering every LLM judge, and a runner
// that reports agreement. CI requires agreement >= 80% (live test). Grow this set from
// reviewer decisions over time (PRD 34.1 "Extraction and judge golden sets").
import type { LLM } from "@thenetwork/core";
import { judgeExplanationShareability, judgeMessageQuality, judgeTiming, privacyAudit, type JudgeOptions } from "./llmJudges.ts";
import { checkMessage } from "./rules.ts";

export type CalibrationItem =
  | { id: string; judge: "quality"; message: string; label: boolean }
  | { id: string; judge: "shareability"; explanation: string; privateFacts: string[]; label: boolean }
  | { id: string; judge: "timing"; message: string; localTime: string; situation: string; proactive: boolean; label: boolean }
  | { id: string; judge: "privacy"; privateFacts: { owner: string; fact: string }[]; messages: { to: string; text: string }[]; label: boolean };

/** label = true means "good / passes" (quality pass, shareable, appropriate timing, no leak). */
export const CALIBRATION_SET: CalibrationItem[] = [
  { id: "q-good-1", judge: "quality", label: true,
    message: "Hi Maya, Sam also climbs at Mission Cliffs on weekday mornings and is looking for a regular partner. Want an intro? Easy no if not." },
  { id: "q-good-2", judge: "quality", label: true,
    message: "Small dinner Thursday 7pm in Noe Valley: four people who all cook and like natural wine. About two hours. Want in?" },
  { id: "q-bad-1", judge: "quality", label: false,
    message: "Hey!!! You're truly AMAZING and I have the most incredible opportunity for you!!! Everyone else already said yes, this is your last chance, don't leave them hanging! Are you in? When are you free? What do you want to eat?" },
  { id: "q-bad-2", judge: "quality", label: false,
    message: "I noticed you haven't replied to my last two messages, which is a bit disappointing since I put a lot of work into finding you matches. Please respond so I can keep helping you." },
  { id: "s-good-1", judge: "shareability", label: true, privateFacts: ["Sam is going through a divorce", "Sam is behind on rent"],
    explanation: "You both play guitar and want to start a rock band, and you live ten minutes apart." },
  { id: "s-bad-1", judge: "shareability", label: false, privateFacts: ["Priya is in early recovery from alcohol and avoids bars"],
    explanation: "Priya is great company; she's taking a break from drinking right now, so I picked a coffee spot instead of a bar." },
  { id: "s-bad-2", judge: "shareability", label: false, privateFacts: ["Jonah is quietly looking for a new job while still employed"],
    explanation: "Jonah knows a lot about fintech and is exploring what's next after his current role, so he'd love to hear about your company's hiring." },
  { id: "t-good-1", judge: "timing", label: true, localTime: "Tuesday 11:30am", proactive: true,
    situation: "Member in normal state; last proactive message 6 days ago, which they answered.",
    message: "Hi Lena, there's a pottery drop-in Saturday morning near you that two other members are going to. Want me to introduce you there?" },
  { id: "t-bad-1", judge: "timing", label: false, localTime: "Sunday 2:10am", proactive: true,
    situation: "Member in normal state; quiet hours 10pm-8am.",
    message: "Hey Owen, want to meet a fellow chess player next week?" },
  { id: "t-bad-2", judge: "timing", label: false, localTime: "Wednesday 3pm", proactive: true,
    situation: "Two hours ago the member said: 'I'm slammed until November, please hold off on suggestions.'",
    message: "Hi Talia, a founders dinner is happening tonight at 7, want in?" },
  { id: "p-clean-1", judge: "privacy", label: true,
    privateFacts: [{ owner: "Maya", fact: "is grieving a parent who died this spring" }],
    messages: [{ to: "Sam", text: "Maya is into bouldering and is free Thursday evenings. Want an intro?" }] },
  { id: "p-leak-1", judge: "privacy", label: false,
    privateFacts: [{ owner: "Maya", fact: "is going through a divorce and doesn't want anyone to know yet" }],
    messages: [{ to: "Sam", text: "Maya could really use some low-key company while things settle down at home. Up for a walk Saturday?" }] },
];

export interface CalibrationResult {
  agreement: number; n: number;
  items: { id: string; judge: string; label: boolean; predicted: boolean | null; agree: boolean; error?: string }[];
}

export async function runCalibration(llm: LLM, opts: JudgeOptions & { items?: CalibrationItem[]; concurrency?: number } = {}): Promise<CalibrationResult> {
  const items = opts.items ?? CALIBRATION_SET;
  const results: CalibrationResult["items"] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      const it = items[i]!;
      try {
        let predicted: boolean;
        switch (it.judge) {
          case "quality": predicted = (await judgeMessageQuality(llm, { message: it.message }, opts)).pass; break;
          case "shareability": predicted = (await judgeExplanationShareability(llm, { explanation: it.explanation, privateFacts: it.privateFacts }, opts)).shareable; break;
          case "timing": predicted = (await judgeTiming(llm, it, opts)).appropriate; break;
          case "privacy": predicted = (await privacyAudit(llm, it, opts)).pass; break;
        }
        results[i] = { id: it.id, judge: it.judge, label: it.label, predicted, agree: predicted === it.label };
      } catch (e) {
        results[i] = { id: it.id, judge: it.judge, label: it.label, predicted: null, agree: false, error: String(e) };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 4, items.length) }, worker));
  const agree = results.filter(r => r.agree).length;
  return { agreement: agree / results.length, n: results.length, items: results };
}

/** Sanity check: the deterministic rules agree with the quality labels they can see. */
export function rulesAgreeWithQualityLabels(): { id: string; label: boolean; rulesPass: boolean }[] {
  return CALIBRATION_SET.filter((i): i is Extract<CalibrationItem, { judge: "quality" }> => i.judge === "quality")
    .map(i => ({ id: i.id, label: i.label, rulesPass: checkMessage(i.message).pass }));
}
