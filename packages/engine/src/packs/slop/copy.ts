// slop.date member-facing copy. Every string still passes the core leak gate (LeakGuard) before it
// is sent: explanations in explain.ts, probes in attention.buildProbe. Distances are bands only
// ("2-5 mi"), never miles to a decimal, a zip or a coordinate. Declines are silent; nothing ever
// says why someone said no, and nothing claims a compatibility score.
import type { Facet } from "@thenetwork/core";

export const SLOP_LANE_LABEL: Record<string, string> = { romance: "a first date" };
export const SLOP_FACET_PHRASE: Partial<Record<Facet["kind"], string>> = { interest: "is into" };
export const SLOP_SAFE_FALLBACK = "I think you two could have a good first date.";
export const SLOP_LANE_ACTIVITY: Record<string, string> = { romance: "a first date" };

/** Ask-before-proposing questions (reason -> text). One question per message, about the member only. */
export const SLOP_ASK_QUESTIONS: Record<string, string> = {
  slop_orientation: "Before I suggest anyone: who are you hoping to meet (women, men, nonbinary people, or a mix), and how do you describe yourself?",
  slop_age_range: "What age range feels right for the people I suggest?",
  slop_distance: "How far would you go for a first date? Just your city, or within 2, 5, 10, 25, 50 or 100 miles of your zip?",
  slop_basics: "Quick one so I don't waste your evenings: anything that's a dealbreaker for you (smoking, kids, faith, politics), and what are you looking for right now, casual or something longer?",
  slop_type: "And what's your type? Describe the kind of person you click with, and how your friends would describe you.",
  // networkPack's reason, kept so a shared ask record from the platform always has a text.
  romance_prefs: "Before I suggest anyone to date: who are you hoping to meet, and what age range feels right?",
};

/**
 * The anonymous probe (PRD 40.5): it says plainly that it is a date, gives the planned activity and
 * the time options, and at most one shareable fact about the other person. No name, no photo, no
 * employer, no area code or zip (the core passes the recipient's own area; slop never prints it).
 */
export function slopProbeText(ctx: { when: string }, activity: string, attribute?: string): string {
  const also = attribute ? ` They're into ${attribute.replace(/[.\s]+$/, "")}.` : "";
  return `There's someone I think you might like to go on a date with: ${activity.replace(/[.\s]+$/, "")}, ${ctx.when}.${also} Want me to check if they're up for it? I'll only tell you who it is if you both say yes.`;
}

/** Age band for a probe or a reveal ("late 20s"), never the exact age. */
export function ageBand(age: number): string {
  if (age < 20) return "18-19";
  const d = Math.floor(age / 10) * 10, r = age % 10;
  return `${r <= 3 ? "early" : r <= 6 ? "mid" : "late"} ${d}s`;
}

/** "about 2-5 mi away" / "under 2 mi away": a band, never a number of miles. */
export const distancePhrase = (band: string) => (band.startsWith("under") ? `${band} away` : `about ${band} away`);
