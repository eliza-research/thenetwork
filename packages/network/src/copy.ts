// Every member-facing message the Network sends, in one reviewed place (PRD 12.4 voice: observant,
// concise, non-needy; one question at a time; an easy no; never another member's contact details
// or private facts; opt-out language on first contact). Probes never name anyone.
import type { Category } from "@thenetwork/core";

const ACTIVITY: Record<Category, string> = {
  social: "meeting someone new for a coffee or a walk",
  professional: "a short coffee with someone in your field",
  romance: "a low-key first date",
  hobby: "doing your thing with someone",
  help: "a quick favor",
  events: "going to something fun with someone",
  growth: "learning something new alongside someone",
};

/**
 * The words that name the app in member-facing copy. `agent` is how the agent names itself ("the
 * Network's agent"); `name` is the app's name inside a sentence ("the Network"). They come from the
 * platform app registry (packages/platform/src/apps.ts, brandOf below).
 */
export interface CopyBrand { agent: string; name: string }
/** The Network (ntwrk): the copy every earlier run used, word for word. */
export const NTWRK_BRAND: CopyBrand = { agent: "the Network's agent", name: "the Network" };
/** The copy brand of an app in the registry: "The Network" reads "the Network" inside a sentence. */
export const brandOf = (app: { name: string; brand: { agentName: string } }): CopyBrand => ({ agent: app.brand.agentName, name: app.name.replace(/^The /, "the ") });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Every member-facing text for one app. No text asks a member to reply "cancel" (a bare CANCEL is STOP). */
export function copyFor(b: CopyBrand) {
  return {
  welcome: (first: string, inviter?: string) =>
    `Hi ${first}, I'm ${b.agent} (an AI)${inviter ? `; ${inviter} invited you` : ""}. Now and then I'll suggest a person or plan that seems worth your time, and you can always ask me for something. Reply STOP anytime to opt out. To start: what would you like more of in your life right now?`,
  welcomeMinor: (first: string) =>
    `Hi ${first}, I'm ${b.agent} (an AI). Since you're under 18, I won't introduce you to other members, but I can suggest public places and events. Reply STOP anytime to opt out. What are you into?`,
  /** First contact when the member record has no valid age (6.3): ask once, before anything else. */
  welcomeAskAge: (first: string) =>
    `Hi ${first}, I'm ${b.agent} (an AI). Reply STOP anytime to opt out. One thing before we start: how old are you?`,
  /** An adult answered the age question: the usual welcome, without the greeting. */
  welcomeAfterAge: "Thanks. Now and then I'll suggest a person or plan that seems worth your time, and you can always ask me for something. To start: what would you like more of in your life right now?",
  interview: {
    availability: "Thanks, that helps. When are you usually free, and which neighborhood are you around most?",
    format: "Last one for now: do you prefer one-on-one or small groups?",
    want: "Quick one so I can be useful: is there anything you'd like help finding right now, like a person, a group, or a plan?",
  },
  ackLearned: "Got it, thanks. I'll only text when something looks worth it.",
  /**
   * Consent-first probe: no names, just the shape of the opportunity, an area and at most one fact
   * about the other person (`why`). With time options (founder decision 4) it asks which time works.
   */
  probe: (category: Category, detail: string, when: string, area: string | undefined, why?: string, times?: string) =>
    `Quick check, no names yet: would you be up for ${detail || ACTIVITY[category]}${times ? "" : ` ${when}`} ${area ? `near ${area}` : "nearby"}${why ? ` (${why})` : ""}?${tail(times)}`,
  /** Plans buddy: asking for plans is not consent to meet a stranger, so both people are asked first. */
  plansBuddyProbe: (venue: string, when: string, area: string | undefined, times?: string) =>
    `Quick check, no names yet: someone ${area ? `near ${area}` : "nearby"} is also looking for plans${times ? "" : ` ${when}`}. Would you be up for going to ${venue} together?${tail(times)}`,
  /** The one re-engagement after 14 days of silence (F28). */
  reengage: "It's been a while, so I've kept quiet. Something came up that looks like a real fit for you. Want me to keep sending these?",
  requestConfirm: (why: string, when: string, times?: string) => times
    ? `Closest match I found so far: someone nearby, and ${why}. Want me to check if they're up for it? I could do ${times}; tell me which works, or no.`
    : `Closest match I found so far: someone nearby, and ${why}. Want me to check if they're up for it ${when}?`,
  growthGap: (area: string | undefined, what: string) => `A few people ${area ? `near ${area}` : "nearby"} are looking for ${what}. Know anyone who'd be into it? Reply with their first name and I'll send you an invite to pass on.`,
  growthPlain: `Who else should be here? If a friend would enjoy ${b.name}, reply with their first name and I'll send you an invite to pass on.`,
  /**
   * The requester asked for this and the fit is strong, so there is no yes or no to ask: only when.
   * Their picks are the times the other person is offered (founder decision 4a).
   */
  requestTimes: (why: string, times: string) => `Found someone nearby for what you asked: ${why}. Which works for you: ${times}? Then I'll check with them.`,
  /** "Yes, but none of those times": one more try with other times (a direct reply, never on the cap). */
  timesRetry: (times: string) => `No problem. Would one of these work instead: ${times}?`,
  /** A member's request: the one fact is what they want (`want` reads after "wants to"); never where they live. */
  probeForRequest: (want: string, when: string, times?: string) => times
    ? `Someone nearby wants to ${want}. Would you be up for it?${tail(times)}`
    : `Someone nearby wants to ${want}, ${when}. Would you be up for it? Yes or no, no pressure either way.`,
  /**
   * The booked plan (attention v1.2): sent once everyone said yes. It names the others, the time and
   * the place, and is booked unless the member says they can't (silence for 48 hours = in).
   * `offer`: the one-time calendar and weekly check-in offer in a member's first plan.
   */
  booked: (others: string[], why: string, venue: string, when: string, offer = false) =>
    `${others.length === 1 ? `You're both in: meet ${others[0]}` : `You're all in: ${others.join(", ")}`}, ${when} at ${venue}. ${why}. Reply if your plans change.${offer ? ` ${OFFER}` : ""}`,
  bookedThanks: "Great, see you there.",
  /** A probe reply that was neither a clear yes nor a clear no (a condition, a maybe): asked once more. */
  probeClarify: "Just to check: is that a yes or a no? Either is fine.",
  /** The member opted in to calendar free/busy (founder decision 4c); free/busy only, never event details. */
  calendarOptIn: "Thanks. I'll only use free/busy from your calendar, never what's in it. Reply CALENDAR OFF anytime to stop.",
  calendarOff: "Done, I won't use your calendar.",
  /** Opt-in weekly check-in (founder decision 4d). */
  weeklyOptIn: "Done. Once a week I'll ask what your week looks like. Reply WEEKLY OFF anytime to stop.",
  weeklyOff: "Done, no more weekly check-ins.",
  weeklyCheckin: "What's your week like? A couple of evenings or times you're free is plenty.",
  /** A request in a category this app does not cover (slop is dating only, peon is work only). */
  requestOutOfScope: "That's not something I can help with here, so I won't look for it. Ask me anytime about something else.",
  /** A member on watch asked for an introduction: nothing starts until a person has looked. */
  requestOnWatch: "I can't start new introductions for you right now. A person on our team will look at your account first.",
  requestAck: "On it. I'll check with a couple of people and get back to you within a day.",
  /** Matching is paused (the admin switch): the request waits as a standing request. */
  requestWaiting: "Got it. I'm not starting new introductions right now, but I'll keep your request open and look again soon.",
  /** A standing request found a match on a later try; sent only after a reviewer approved it. */
  requestRetryFound: "Good news: I may have found someone for what you asked about. Checking with them now.",
  requestNoneYet: (what: string) =>
    `I couldn't find someone for ${what} this time. I'll keep an eye out. If you know someone who'd be great for it, reply with their first name and I'll send you an invite to pass on.`,
  plans: (lines: string[]) => `A few ideas nearby: ${lines.join("; ")}. Want me to see if anyone else is up for one of them?`,
  /** The same ideas with no offer to find company: for minors, members who cannot be matched, and while matching is off. */
  plansNoOffer: (lines: string[]) => `A few ideas nearby: ${lines.join("; ")}. Happy to suggest more anytime.`,
  declinedQuiet: "That one didn't come together this time. No action needed; I'll keep an eye out.",
  reminder: (when: string, venue: string) => `Reminder: ${when} at ${venue}. Have fun! If something comes up, just tell me.`,
  /** Someone dropped out of a booked plan. Never says who: the plan's change is the news, not the person (judge decliner_exposed). */
  dropNotice: (_first: string, keep: boolean) => keep
    ? `Quick update: one person can't make it now, sorry. The rest of you are still on.`
    : `Quick update: this one is off now, sorry about that. I'll look for another time.`,
  feedbackAsk: (others: string) => `How did it go with ${others}?`,
  feedbackThanks: "Thanks, that's really helpful.",
  growthAsk: `Glad that went well. If you know someone who'd enjoy ${b.name}, reply with their first name and I'll send you an invite link to pass on.`,
  inviteSent: (friend: string) => `Done: here's an invite link for ${friend}. I'll welcome them when they join.`,
  inviteeJoined: (friend: string) => `${friend} just joined. Thanks for bringing them in.`,
  secondEncounter: (others: string) => `You and ${others} both said you'd meet again. Want me to find a time?`,
  // Safety and boundaries.
  noContactDetails: "I can't share other members' contact details or private info. If you both want to after meeting, I can swap numbers.",
  noPromotion: `${cap(b.name)} isn't a place for promotion or fundraising, so I won't pass that along. I'm happy to help you meet people around shared interests.`,
  noMoney: "I won't relay requests for money or investments between members. If someone asked you for money, please tell me.",
  noInjection: "I can't help with that.",
  giveSpace: "I won't pass that along. If someone hasn't replied, please give them space.",
  blocked: "Done. You won't be matched with them, and they won't be told.",
  /** A report about someone the member did not meet through the Network, or a name that matches nobody: no claim about who they are. */
  reportUnmatched: "Thanks for telling me. I couldn't match that name to someone you met through me. If you're ever in danger, call 911 first.",
  reported: "Thanks for telling me. I've blocked them for you and flagged this for the safety team. If you're ever in danger, call 911 first.",
  hold: "Your account is paused while our team takes a look. You'll hear from a person soon.",
  minorNotice: "Thanks for telling me. Since you're under 18, I won't introduce you to other members, but I'm happy to suggest public places and events.",
  minorConcierge: (topic: string, ideas: string) => `For ${topic}, ${ideas}. Happy to suggest more anytime.`,
  stopWelcomeBack: "Welcome back. I'll only reach out when something looks worth it.",
  // Plans (plans v1.1). The probe itself is the engine's buildPlanProbe (no names, leak-checked).
  /** The booked plan, sent only once enough people said yes: names, time, public place, own way. Silence for 48 hours = in. */
  planBooked: (activity: string, others: string[], venue: string, when: string, offer = false) =>
    `You're in: ${activity}, ${when} at ${venue}, with ${others.join(", ").replace(/\.$/, "")}. Everyone pays their own way. Reply if your plans change.${offer ? ` ${OFFER}` : ""}`,
  /** The post-plan question: how it went, and whether they would do it again with this group (crews, would_interact_again). */
  planFeedbackAsk: (activity: string) => `How was ${activity}, and would you do it again with this group?`,
  /** A plan that did not come together; folded into the member's next message. Never says who declined. */
  planNotTogether: "That plan didn't come together this time.",
  /** Fallback: a public event for a member who said yes to a plan that did not come together. */
  planEvent: (title: string, when: string, area?: string) => `That plan didn't come together, but ${title} is on ${when}${area ? ` near ${area}` : ""}. Worth a look if you're still free.`,
  /** The crew offer after one great plan (>= 3 would do it again). Each person opts in. */
  crewOffer: (activity: string) => `A few of you said you'd do ${activity} again. Want to make it a weekly thing with the same people? Reply yes if you're in.`,
  crewYes: "Great. I'll set it up if enough people are in.",
  crewFormed: (activity: string) => `Your weekly ${activity} crew is on. I'll check before each session, and you can skip any week.`,
  crewNotFormed: "Not enough people for a weekly crew this time. I'll keep you in mind for the next plan.",
  // Joining by text (the platform service, before a member record exists). Nothing is stored until the age check passes.
  /** First message from someone who is not a member of an open app. */
  joinAsk: (minAge: number) => `Hi, I'm ${b.agent} (an AI). To join ${b.name}, reply with your first name and your age. You need to be ${minAge} or older. Reply STOP anytime to opt out.`,
  /** A staff invite (invite-only apps): the person's reply with name and age is the join and the opt-in. */
  invited: (minAge: number) => `Hi, I'm ${b.agent} (an AI). You're invited to join ${b.name}. To accept, reply with your first name and your age. You need to be ${minAge} or older. Reply STOP anytime to opt out.`,
  /** An age came, but no first name. */
  joinNeedName: "Thanks. And your first name?",
  /** A person who already uses another app with this number joined this one. It never names the other app. */
  linkNotice: "You've used this number with us before. Nothing is shared between apps unless you say so. Reply SHARE to reuse your first name, city and interests here.",
  shareDone: "Done. I'll reuse those basics here. Nothing else is shared.",
  /** "leave <app>": this app only; the member's data in it is deleted. */
  leftApp: `Done. You've left ${b.name} and I deleted what you shared here. Other apps you use with this number are not affected.`,
  };
}
export type Copy = ReturnType<typeof copyFor>;
/** The Network's copy (ntwrk). Other apps: copyFor(brandOf(app)). */
export const copy: Copy = copyFor(NTWRK_BRAND);

const OFFER = "Next time I can skip the time question: reply CALENDAR to share your calendar's free/busy, or WEEKLY for a short weekly check-in.";
/** The answer request that ends a probe: with time options, which one works; without, yes or no. */
const tail = (times?: string) => (times ? ` I could do ${times}. Tell me which works, or no is completely fine.` : " Yes or no is all I need, and no is completely fine.");

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
  // A bare CANCEL is a STOP word (platform consent.ts): no text may ask a member to reply "cancel" (platform plan 4.3).
  if (/\b(?:reply|text|say|send|type)\s+["'“]?cancel\b/i.test(text)) v.push("asks_cancel");
  // Built phrases that read wrong: a skill label after "they" ("they works", "they ha a truck",
  // "they say they ML engineer") and a verb after "asked me for" ("asked me for meet people").
  if (/\bthey (?:say they )?(?:plays|has|does|works|teaches|gives|cooks|throws|shoots|sings|edits|loves|ha|doe|[A-Z]{2,}|[a-z]+ (?:engineer|designer|player))\b|\b(?:asked me for|someone for) (?:meet|make|find|get|play|join|go|try|start|be|learn)\b/.test(text)) v.push("grammar");
  // A raw taxonomy tag ("climate_tech") never reaches a member.
  if (/\b[a-z]+_[a-z_]+\b/.test(text)) v.push("raw_tag");
  return v;
}
