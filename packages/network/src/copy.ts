// Every member-facing message the Network sends, in one reviewed place (PRD 12.4 voice: observant,
// concise, non-needy; one question at a time; an easy no; never another member's contact details
// or private facts; opt-out language on first contact). Probes never name anyone.
import type { Category } from "@thenetwork/core";

const ACTIVITY: Record<Category, string> = {
  social: "meeting someone new for a coffee or a walk",
  professional: "a short coffee with someone in your field",
  romance: "a low-key first date",
  hobby: "doing your thing with someone who's into it too",
  help: "a quick favor",
  events: "going to something fun with someone",
  growth: "learning something new alongside someone",
};

export const copy = {
  welcome: (first: string, inviter?: string) =>
    `Hi ${first}, I'm the Network's agent (an AI)${inviter ? `; ${inviter} invited you` : ""}. Now and then I'll suggest a person or plan that seems worth your time, and you can always ask me for something. Reply STOP anytime to opt out. To start: what would you like more of in your life right now?`,
  welcomeMinor: (first: string) =>
    `Hi ${first}, I'm the Network's agent (an AI). Since you're under 18, I won't introduce you to other members, but I can suggest public places and events. Reply STOP anytime to opt out. What are you into?`,
  interview: {
    availability: "Thanks, that helps. When are you usually free, and which neighborhood are you around most?",
    format: "Last one for now: do you prefer one-on-one or small groups?",
    want: "Quick one so I can be useful: is there anything you'd like help finding right now, like a person, a group, or a plan?",
  },
  ackLearned: "Got it, thanks. I'll only text when something looks worth it.",
  /** Consent-first probe: no names, just the shape of the opportunity. */
  probe: (category: Category, detail: string, when: string, area: string, why?: string) =>
    `Quick check, no names yet: would you be up for ${detail || ACTIVITY[category]} ${when} near ${area}${why ? ` (${why})` : ""}? Yes or no is all I need, and no is completely fine.`,
  requestConfirm: (why: string, when: string) => `Closest match I found so far: someone nearby, and ${why}. Want me to check if they're up for it ${when}?`,
  nudge: "Just checking: still up for it? If not, no worries at all.",
  growthGap: (area: string, what: string) => `A few people near ${area} are looking for ${what}. Know anyone who'd be into it? Reply with their first name and I'll send you an invite to pass on.`,
  growthPlain: "Who else should be here? If a friend would enjoy the Network, reply with their first name and I'll send you an invite to pass on.",
  probeForRequest: (detail: string, when: string, area: string) =>
    `Someone near ${area} asked me for ${detail}, ${when}. Would you be up for it? Yes or no, no pressure either way.`,
  reveal: (first: string, others: string[], why: string, venue: string, when: string) =>
    others.length === 1
      ? `Thanks ${first}! Here's who: ${others[0]}. ${why}. I'd suggest ${when} at ${venue}. Want me to set it up?`
      : `Thanks ${first}! Here's the group: ${others.join(", ")}. ${why}. I'd suggest ${when} at ${venue}. Want in?`,
  requestAck: "On it. I'll check with a couple of people and get back to you within a day.",
  requestNoneYet: (what: string) =>
    `I couldn't find someone for ${what} this time. I'll keep an eye out. If you know someone who'd be great for it, reply with their first name and I'll send you an invite to pass on.`,
  plans: (lines: string[]) => `A few ideas nearby: ${lines.join("; ")}. Want me to see if anyone else is up for one of them?`,
  confirmed: (others: string, when: string, venue: string) => `You're set with ${others}: ${when} at ${venue}. I'll send a reminder that day.`,
  declinedQuiet: "That one didn't come together this time. No action needed; I'll keep an eye out.",
  reminder: (when: string, venue: string) => `Reminder: ${when} at ${venue}. Have fun! If something comes up, just tell me.`,
  dropNotice: (first: string, keep: boolean) => keep
    ? `Quick update: ${first} can't make it, sorry. The rest of you are still on.`
    : `Quick update: ${first} can't make it, so I'm calling this one off. Sorry about that; I'll look for another time.`,
  feedbackAsk: (others: string) => `How did it go with ${others}?`,
  feedbackThanks: "Thanks, that's really helpful.",
  growthAsk: "Glad that went well. If you know someone who'd enjoy the Network, reply with their first name and I'll send you an invite link to pass on.",
  inviteSent: (friend: string) => `Done: here's an invite link for ${friend}. I'll welcome them when they join.`,
  inviteeJoined: (friend: string) => `${friend} just joined. Thanks for bringing them in.`,
  secondEncounter: (others: string) => `You and ${others} both said you'd meet again. Want me to find a time?`,
  // Safety and boundaries.
  noContactDetails: "I can't share other members' contact details or private info. If you both want to after meeting, I can swap numbers.",
  noPromotion: "The Network isn't a place for promotion or fundraising, so I won't pass that along. I'm happy to help you meet people around shared interests.",
  noMoney: "I won't relay requests for money or investments between members. If someone asked you for money, please tell me.",
  noInjection: "I can't help with that.",
  giveSpace: "I won't pass that along. If someone hasn't replied, please give them space.",
  blocked: "Done. You won't be matched with them, and they won't be told.",
  reported: "Thanks for telling me. I've blocked them for you and flagged this for the safety team. If you're ever in danger, call 911 first.",
  hold: "Your account is paused while our team takes a look. You'll hear from a person soon.",
  minorNotice: "Thanks for telling me. Since you're under 18, I won't introduce you to other members, but I'm happy to suggest public places and events.",
  minorConcierge: (topic: string, ideas: string) => `For ${topic}, ${ideas}. Happy to suggest more anytime.`,
  stopWelcomeBack: "Welcome back. I'll only reach out when something looks worth it.",
};

/** "Thursday 7pm"-style phrasing in New York time. */
export function whenPhrase(t: number): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long", hour: "numeric", minute: "2-digit" }).format(t).replace(":00", "");
}

/** Copy style rules as code (PRD 12.4); the tests run every template through them. */
export function styleViolations(text: string, opts: { firstContact?: boolean } = {}): string[] {
  const v: string[] = [];
  if (text.length > 360) v.push("too_long");
  if ((text.match(/\?/g) ?? []).length > 1) v.push("more_than_one_question");
  if (/\+?\d{3}[-.\s]\d{3}[-.\s]\d{4}|@\w+\.\w+/.test(text)) v.push("contact_details");
  if (/!{2,}|you won't believe|act now|last chance/i.test(text)) v.push("pushy");
  if (opts.firstContact && !/STOP/.test(text)) v.push("missing_opt_out");
  return v;
}
