// slop.date's onboarding (PRD 37.1 item 4, F4, 40.5): a short dating conversation that collects the
// hard fields the pack filters on (gender and seeking, age range, zip or neighborhood, radius, goal,
// dealbreakers) while matching is still off, so the first engine run has real profiles. Questions go
// in this order and a question whose answer is already known is skipped (a profile from the member's
// own AI assistant can fill several at once). A question that got no usable answer is asked once
// more, then dropped: the engine's own asks (packs.ts askText) catch what is still missing later.
// After the last question, one read-back in plain words; never a score, a rating or a safety tag.
import type { AppOnboarding, OnboardingState, OnboardingStep } from "../src/apphooks.ts";
import type { Copy } from "../src/copy.ts";

/** Each question is asked at most twice. */
const MAX_ASKS = 2;
const HARD = ["slop_orientation", "slop_age_range", "slop_distance", "slop_basics"] as const;

const DEALBREAKER_WORDS: Record<string, string> = {
  smoker: "smokers", heavy_drinker: "heavy drinkers", wants_kids: "someone who wants kids", no_kids_ever: "someone who never wants kids",
  has_kids: "someone with kids", religious: "someone religious", nonreligious: "someone not religious", right_politics: "right-leaning politics", left_politics: "left-leaning politics",
};
const GOAL_WORDS: Record<string, string> = { long_term: "something serious", casual: "something casual", unsure: "not sure yet what you want" };
const PLURAL: Record<string, string> = { woman: "women", man: "men", nonbinary: "nonbinary people" };
const RESUME: Record<string, string> = {
  goal: "what are you hoping to find?", who: "who would you like to meet?", where: "where are you based?", radius: "how far would you go for a first date?",
  dealbreakers: "any dealbreakers I should know about?", weekend: "what's a typical weekend like for you?", readback: "does what I have about you look right?",
};

const one = (s: OnboardingState, prefix: string) => s.tags.find(t => t.startsWith(prefix))?.slice(prefix.length);
const all = (s: OnboardingState, prefix: string) => s.tags.filter(t => t.startsWith(prefix)).map(t => t.slice(prefix.length));
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** The slop onboarding, in the app's copy. `site`: the app's domain, for the settings links. */
export function slopOnboarding(copy: Copy, site: string): AppOnboarding {
  const c = copy.dating;
  const steps: { id: string; reasons: readonly string[]; done(s: OnboardingState): boolean; text(s: OnboardingState): string }[] = [
    { id: "goal", reasons: ["slop_basics"], done: s => !!one(s, "slop:goal:"), text: () => c.goal },
    {
      id: "who", reasons: ["slop_orientation", "slop_age_range"],
      done: s => !!one(s, "romance:is:") && !!one(s, "romance:seeks:") && !!one(s, "romance:age:"),
      text: s => {
        const missing = [!one(s, "romance:seeks:") && c.whoSeeks, !one(s, "romance:is:") && c.whoIs, !one(s, "romance:age:") && c.whoAge].filter((x): x is string => !!x);
        return missing.length === 1 ? missing[0]! : c.who;
      },
    },
    { id: "where", reasons: [], done: s => !!one(s, "slop:zip:") || !!s.area, text: () => c.where },
    { id: "radius", reasons: ["slop_distance"], done: s => !!one(s, "slop:max_miles:"), text: () => c.radius },
    { id: "dealbreakers", reasons: ["slop_basics"], done: s => all(s, "slop:dealbreaker:").length > 0 || s.answered.includes("dealbreakers"), text: () => c.dealbreakers },
    { id: "weekend", reasons: [], done: s => s.answered.includes("weekend"), text: () => c.weekend },
  ];

  /** What was learned, in plain words. */
  function summary(s: OnboardingState): string {
    const parts: string[] = [];
    const is = one(s, "romance:is:"), seeks = all(s, "romance:seeks:"), age = one(s, "romance:age:");
    const who = [is ? `you're ${is === "nonbinary" ? "nonbinary" : `a ${is}`}` : "", seeks.length ? `${is ? "looking to meet" : "you'd like to meet"} ${seeks.length === 3 ? "people of any gender" : list(seeks.map(g => PLURAL[g] ?? g))}` : ""].filter(Boolean).join(" ");
    if (who) parts.push(age ? `${who}, ages ${age}` : who);
    else if (age) parts.push(`ages ${age}`);
    const zip = one(s, "slop:zip:"), scope = one(s, "slop:scope:"), mi = one(s, "slop:max_miles:");
    const where = zip ? `near ${zip}` : s.area ? `around ${s.area}` : "";
    const far = scope === "city" ? "anywhere in the city" : mi ? `up to ${mi} miles away` : "";
    if (where || far) parts.push([where, far].filter(Boolean).join(", "));
    const goal = one(s, "slop:goal:");
    if (goal) parts.push(goal === "unsure" ? GOAL_WORDS.unsure! : `looking for ${GOAL_WORDS[goal] ?? goal}`);
    const db = all(s, "slop:dealbreaker:").map(d => DEALBREAKER_WORDS[d]).filter((x): x is string => !!x);
    if (db.length) parts.push(`dealbreakers: ${list(db)}`);
    else if (s.answered.includes("dealbreakers")) parts.push("no dealbreakers");
    return parts.join("; ");
  }

  return {
    welcome: (first, question, inviter) => c.welcome(first, question, site, inviter),
    afterAge: question => c.afterAge(question, site),
    next(s): OnboardingStep | undefined {
      const st = steps.find(x => !x.done(s) && (s.asked[x.id] ?? 0) < MAX_ASKS);
      return st && { id: st.id, text: st.text(s), reasons: st.reasons };
    },
    readBack(s) { const x = summary(s); return x ? c.readBack(x) : c.readBackEmpty; },
    readBackReasons: HARD,
    // A whole profile is not an answer to one question: no bare readings ("women" in a sentence about friends).
    profileReasons: ["slop_basics"],
    fixAsk: c.fixAsk,
    done: photos => (photos ? `${c.done} ${c.photoAsk(site)}` : c.done),
    resume: step => c.resume(RESUME[step ?? ""] ?? RESUME.goal!),
  };
}
