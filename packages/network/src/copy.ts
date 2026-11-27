// Every member-facing message the Network sends, in one reviewed place (PRD 12.4 voice: observant,
// concise, non-needy; one question at a time; an easy no; never another member's contact details
// or private facts; opt-out language on first contact). Probes never name anyone.
import {
  cityTimezone, cityTzLabel, clampSms, cleanPhrase, formatAnchorOrQuorumCancel, formatBackupVenuePivot, formatCrowdExpectation,
  formatTopOneVenueSuggestion, SMS_MAX_CHARS, styleViolations, type Category, type CityId, type StyleViolationOptions,
  type TopOneVenueSuggestionOptions,
} from "@thenetwork/core";
import type { MinorNotice } from "../../core/src/generated/textEnrollment.ts";

export {
  SMS_MAX_CHARS, styleViolations, formatTopOneVenueSuggestion, formatCrowdExpectation, formatBackupVenuePivot,
  formatAnchorOrQuorumCancel, type StyleViolationOptions, type TopOneVenueSuggestionOptions,
};

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
const MINOR_BIRTHDAY_ASK = "If you tell me your birthday (month, day and year), I can look for friends close to your age.";
const MINOR_TEEN_FRIENDS = "Since you're under 18, I only introduce you for friendship, to people aged 13 to 18 born within 2 years of you, and every introduction is checked before anyone hears about it.";
const MINOR_SLOP = "slop.date doesn't match anyone under 18 for dates. Friendship introductions for people under 18 happen on friends.help and ntwrk.party.";
const MINOR_PEON = "peon.biz doesn't match anyone under 18 for work. I can still help you myself. Friendship introductions for people under 18 happen on friends.help and ntwrk.party.";
const MINOR_SINGLE_PLAYER_WELCOME = "Since you're under 18, I won't introduce you to other members, but I can suggest public places and events.";
const MINOR_NOTICE = "Thanks for telling me. Since you're under 18, I won't introduce you to other members, but I'm happy to suggest public places and events.";
const minorScope = (notice: MinorNotice, singlePlayer: string): string => ({
  MinorSinglePlayerNotice: singlePlayer,
  MinorBirthdayNotice: `${singlePlayer} ${MINOR_BIRTHDAY_ASK}`,
  MinorTeenFriendNotice: MINOR_TEEN_FRIENDS,
  MinorSlopNotice: MINOR_SLOP,
  MinorPeonNotice: MINOR_PEON,
} satisfies Record<MinorNotice, string>)[notice];
const REPORT_SAFETY_HINT = " If you're ever in danger, call 911 first.";

/** Every member-facing text for one app. No text asks a member to reply "cancel" (a bare CANCEL is STOP). */
export function copyFor(b: CopyBrand, defaultCity?: CityId) {
  const tzLabel = (city?: CityId) => cityTzLabel(city ?? defaultCity);
  const cancelDateLabel = (city?: CityId) => (city ?? defaultCity) ? cityTzLabel(city ?? defaultCity) : "local";
  return {
  welcome: (first: string, inviter?: string) =>
    `Hi ${first}, I'm ${b.agent} (an AI)${inviter ? `; ${inviter} invited you` : ""}. Now and then I'll suggest a person or plan that seems worth your time, and you can always ask me for something. Reply STOP anytime to opt out. To start: what would you like more of in your life right now?`,
  welcomeMinor: (first: string, notice: MinorNotice) => {
    const scope = minorScope(notice, MINOR_SINGLE_PLAYER_WELCOME);
    if (notice === "MinorSlopNotice" || notice === "MinorPeonNotice") {
      return `Hi ${first}, I'm ${b.agent} (an AI) — ${scope} If you want local all-ages ideas, tell me a hobby or neighborhood, or reply STOP anytime to opt out.`;
    }
    return `Hi ${first}, I'm ${b.agent} (an AI). ${scope} Reply STOP anytime to opt out. What are you into?`;
  },
  /** First contact when the member record has no valid age (6.3): ask once, before anything else. */
  welcomeAskAge: (first: string) =>
    `Hi ${first}, I'm ${b.agent} (an AI). Reply STOP anytime to opt out. One thing before we start: what's your birthday (month, day and year)?`,
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
  /** The one re-engagement after 30 days of silence (F28). */
  reengage: "It's been a while, so I've kept quiet. Something came up that looks like a real fit for you. Want me to keep sending these, or reply PAUSE anytime?",
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
  bookingStartToCancel: `Which meeting should I cancel? Use “Please cancel my meeting on YYYY-MM-DD at HH:MM” with its ${cancelDateLabel()} date and 24-hour time.`,
  bookingStartToCancelFor: (city?: CityId) =>
    `Which meeting should I cancel? Use “Please cancel my meeting on YYYY-MM-DD at HH:MM” with its ${tzLabel(city)} date and 24-hour time.`,
  whichBookingToCancel: `I found more than one upcoming meeting. Which one should I cancel? Use “Please cancel my meeting on YYYY-MM-DD at HH:MM” with its ${cancelDateLabel()} date and 24-hour time.`,
  whichBookingToCancelFor: (city?: CityId) =>
    `I found more than one upcoming meeting. Which one should I cancel? Use “Please cancel my meeting on YYYY-MM-DD at HH:MM” with its ${tzLabel(city)} date and 24-hour time.`,
  noBookingToCancel: "I couldn't find a matching upcoming meeting.",
  whichBookingToReschedule: "More than one booking has that start. Which meeting did you mean?",
  rescheduleFormat: `Use RESCHEDULE YYYY-MM-DD HH:MM TO YYYY-MM-DD HH:MM with the old and proposed ${cancelDateLabel()} starts in 24-hour time.`,
  rescheduleFormatFor: (city?: CityId) =>
    `Use RESCHEDULE YYYY-MM-DD HH:MM TO YYYY-MM-DD HH:MM with the old and proposed ${tzLabel(city)} starts in 24-hour time.`,
  rescheduleUnavailable: "I couldn't apply that time change.",
  reschedulePending: "The time change needs everyone's acceptance.",
  rescheduleDeclined: "Thanks. I closed that time change request.",
  rescheduleOffer: (original: string, proposed: string, ref: string, city?: CityId) =>
    `Could your meeting move from ${original} to ${proposed}, ${tzLabel(city)}? The original booking stays until everyone agrees. Reply RESCHEDULE YES ${ref} or RESCHEDULE NO ${ref}.`,
  rescheduleUpdated: (proposed: string, city?: CityId) => `Everyone agreed. Your meeting is now ${proposed}, ${tzLabel(city)}, at the same place.`,
  /** A probe reply that was neither a clear yes nor a clear no (a condition, a maybe): asked once more. */
  probeClarify: "Just to check: is that a yes or a no? Either is fine.",
  probeTimeClarify: "Which of the offered times work for you? Reply with the letters or the times.",
  /** The member opted in to calendar free/busy (founder decision 4c); free/busy only, never event details. */
  calendarOptIn: "I’ve saved your choice. I’ll use only free/busy if you have an authorized calendar. Reply CALENDAR OFF anytime to stop.",
  calendarOff: "Done, I won't use your calendar.",
  /** Opt-in weekly check-in (founder decision 4d). */
  weeklyOptIn: "Done. Once a week I'll ask what your week looks like. Reply WEEKLY OFF anytime to stop.",
  weeklyOff: "Done, no more weekly check-ins.",
  weeklyCheckin: "What's your week like? A couple of evenings or times you're free is plenty, or reply PAUSE anytime.",
  /** A request in a category this app does not cover (slop is dating only, peon is work only). */
  requestOutOfScope: "That's not something I can help with here, so I won't look for it. Ask me anytime about something else.",
  /** A member on watch asked for an introduction: nothing starts until a person has looked. */
  requestOnWatch: "I can't start new introductions for you right now. A person on our team will look at your account first.",
  requestAck: "On it. I'll check with a couple of people and get back to you within a day.",
  homeHelpSafetyReview: "A team member needs to review requests that involve entering a home. I haven't contacted anyone or shared an address.",
  /** Matching is paused (the admin switch): the request waits as a standing request. */
  requestWaiting: "Got it. I'm not starting new introductions right now, but I'll keep your request open and look again soon.",
  /** A standing request found a match on a later try; sent only after a reviewer approved it. */
  requestRetryFound: "Good news: I may have found someone for what you asked about. Checking with them now.",
  /** `invites`: invite links work here (NetworkContext.invite); without them the text offers none. */
  requestNoneYet: (what: string, invites = true) =>
    `I couldn't find someone for ${what} this time. I'll keep an eye out.${invites ? " If you know someone who'd be great for it, reply with their first name and I'll send you an invite to pass on." : ""}`,
  plans: (lines: string[]) => `A few ideas nearby: ${lines.join("; ")}. Want me to see if anyone else is up for one of them?`,
  /** The same ideas with no offer to find company: for minors, members who cannot be matched, and while matching is off. */
  plansNoOffer: (lines: string[]) => `A few ideas nearby: ${lines.join("; ")}. Happy to suggest more anytime.`,
  declinedQuiet: "That one didn't come together this time. No action needed; I'll keep an eye out.",
  probeEnded: "That invitation has closed, so I didn't share anything about you. I'll keep an eye out for another.",
  probeVoided: "That plan changed before you answered, so I didn't count your answer or share anything about you. If the new plan fits, I'll ask you about it.",
  reminder: (when: string, venue: string) => `Reminder: ${when} at ${venue}. Have fun! If something comes up, just tell me.`,
  dayOfCheckIn: (when: string, venue: string) => `Still good for ${when} at ${venue}? Tell me if you're running late or can't make it.`,
  /** Someone dropped out of a booked plan. Never says who: the plan's change is the news, not the person (judge decliner_exposed). */
  dropNotice: (_first: string, keep: boolean) => keep
    ? `Quick update: one person can't make it now, sorry. The rest of you are still on.`
    : `Quick update: this one is off now, sorry about that. I'll look for another time.`,
  feedbackAsk: (others: string) => `How did it go with ${others} — would you want to see them again?`,
  feedbackThanks: "Thanks, that's really helpful.",
  growthAsk: `Glad that went well. If you know someone who'd enjoy ${b.name}, reply with their first name and I'll send you an invite link to pass on.`,
  /** A member names a friend to invite where no invite link can be sent: nothing is promised. */
  invitesNotOpen: (friend: string) => `Thanks! I can't send invite links yet, so nothing went to ${friend}. They're welcome to sign up for ${b.name} themselves.`,
  inviteSent: (friend: string) => `Done: here's an invite link for ${friend}. I'll welcome them when they join.`,
  forwardInvite: (url: string) => `You can forward this invite link:\n${url}`,
  inviteVouchQuestion: (first: string) => `How long and how well have you known ${first}? For example, “2 years, well” or “3 weeks, met once”.`,
  inviteVouchReadback: (first: string, relationship: string, durationMonths: number, depth: "met_once" | "somewhat" | "well") => {
    const duration = durationMonths === 0 ? "less than a month" : durationMonths === 1 ? "1 month" : `${durationMonths} months`;
    const level = { met_once: "met once", somewhat: "know somewhat", well: "know well" }[depth];
    return `Your vouch for ${first} is ${relationship}, ${duration}, ${level}. Reply CONFIRM INVITE to request a link you can forward.`;
  },
  inviteVouchConfirm: "Reply CONFIRM INVITE to request the link, or CANCEL INVITE to stop.",
  inviteCancelled: "I cleared your invitation request.",
  inviteInReview: (reference?: string) => reference ? `Your invite is waiting for review. To check it, reply CHECK INVITE ${reference}.` : "Your invite is waiting for review.",
  inviteUnavailable: "I couldn't make an invite link right now.",
  inviteeJoined: (friend: string) => `${friend} just joined. Thanks for bringing them in.`,
  secondEncounter: (others: string) => `You and ${others} both said you'd meet again. Want me to find a time?`,
  // Safety and boundaries.
  noContactDetails: "I can't share other members' contact details or private info. If you both want to after meeting, I can swap numbers.",
  noPromotion: `${cap(b.name)} isn't a place for promotion or fundraising, so I won't pass that along. I'm happy to help you meet people around shared interests.`,
  noMoney: "I won't relay requests for money or investments between members. If someone asked you for money, please tell me.",
  noInjection: "I can't help with that.",
  giveSpace: "I won't pass that along. If someone hasn't replied, please give them space.",
  blocked: "Done. You won't be matched with them, and they won't be told.",
  immediateDanger: "If you're in immediate danger, call local emergency services now. In the U.S., call 911.",
  /** A report about someone the member did not meet through the Network, or a name that matches nobody: no claim about who they are. */
  reportUnmatched: (immediateDanger = false) => `Thanks for telling me. I couldn't match that name to someone you met through me.${immediateDanger ? "" : REPORT_SAFETY_HINT}`,
  reported: (immediateDanger = false) => `Thanks for telling me. I've blocked them for you and flagged this for the safety team.${immediateDanger ? "" : REPORT_SAFETY_HINT}`,
  /** A block by a name that is not someone they met through the Network: the same words whether or not the name is a member's (no membership oracle). */
  blockUnmatched: "I couldn't match that name to someone you met through me. If they're a member, they won't be matched with you, and they won't be told.",
  /** "block him" or a name two of their counterparts share: which one. Only names of people the member was introduced to. */
  whoDoYouMean: (names: string[]) => names.length
    ? `Who do you mean: ${names.join(" or ")}? Reply with the name and I'll take care of it.`
    : "Who do you mean? Reply with their first name and I'll take care of it.",
  /** The answer to "Who do you mean?" still named nobody they met: nothing was applied. */
  whoUnresolved: "I couldn't tell who you mean, so nothing has changed yet. Reply block or report with their first name anytime.",
  safetyNoAction: "Okay.",
  checkInSafetyAsk: (first: string) => `I'm sorry it went that way. Do you want me to report ${first} to the safety team, block ${first}, or neither? Reply REPORT, BLOCK or NO. A report also blocks them.`,
  hold: "Your account is paused while our team takes a look. You'll hear from a person soon.",
  minorNotice: MINOR_NOTICE,
  minorScopeNotice: (notice: MinorNotice) => minorScope(notice, MINOR_NOTICE),
  minorBirthdayAsk: MINOR_BIRTHDAY_ASK,
  minorTeenFriends: MINOR_TEEN_FRIENDS,
  minorSlop: MINOR_SLOP,
  minorPeon: MINOR_PEON,
  birthdayWhich: (monthFirst: string, dayFirst: string) => `Just to check: is your birthday ${monthFirst} or ${dayFirst}? Reply with the month as a word, like ${monthFirst}.`,
  minorConcierge: (topic: string, ideas: string) => `For ${topic}, ${ideas}. Happy to suggest more anytime.`,
  emptyIntentFollowup: "I haven't found a match I can offer yet. Text “Show me public events” for ideas you can try on your own.",
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
  joinAsk: (minAge: number) => `Hi, I'm ${b.agent} (an AI). To join ${b.name}, reply with your first name and your birthday (month, day and year). You need to be ${minAge} or older. Reply STOP anytime to opt out.`,
  invited: (minAge: number) => `Hi, I'm ${b.agent} (an AI). You're invited to join ${b.name}. To accept, reply with your first name and your birthday (month, day and year). You need to be ${minAge} or older. Reply STOP anytime to opt out.`,
  /** An age came, but no first name. */
  joinNeedName: "Thanks. And your first name?",
  /** A person who already uses another app with this number joined this one. It never names the other app. */
  linkNotice: "You've used this number with us before. Nothing is shared between apps unless you say so. Reply SHARE to reuse the interests you confirmed before.",
  shareDone: "Done. I'll reuse the interests you confirmed before. Nothing else is shared. Reply UNSHARE to stop sharing from now on.",
  unshareDone: "Done. Nothing is shared between this app and your other apps now. Interests I already copied stay here until you ask me to remove them.",
  /** "leave <app>": this app only; the member's data in it is deleted. */
  leftApp: `Done. You've left ${b.name} and I deleted what you shared here. Other apps you use with this number are not affected.`,
  notInApp: `You're not in ${b.name}, so there is nothing to leave and nothing changed. Other apps you use with this number are not affected.`,
  topOneVenueSuggestion: (venue: string, area: string, when: string, opts?: TopOneVenueSuggestionOptions) =>
    formatTopOneVenueSuggestion(venue, area, when, opts),
  crowdExpectation: (mode: "network_curated" | "external_open", opts?: { interest?: string; platforms?: string; sparseAnchor?: boolean; cityName?: string }) =>
    formatCrowdExpectation(mode, { ...opts, brandName: b.name }),
  backupVenuePivot: (primaryVenue: string, backupVenue: string, reason: "full" | "closed", opts?: { address?: string; landmark?: string }) =>
    formatBackupVenuePivot(primaryVenue, backupVenue, reason, opts),
  anchorOrQuorumCancel: (reason: "anchor_drop" | "low_quorum" | "co_anchor_promoted", opts?: { activity?: string; when?: string; venue?: string }) =>
    formatAnchorOrQuorumCancel(reason, opts),
  silentPartnerVenueSwap: (when: string, venue: string, opts?: { area?: string; note?: string }) =>
    formatSilentPartnerVenueSwap(when, venue, opts),
  preArrivalBrief: (when: string, venue: string, opts?: { partner?: string; address?: string; landmark?: string; counterTab?: boolean }) =>
    formatPreArrivalBrief(when, venue, opts),
  partialGroupTwoPersonPivot: (when: string, venue: string, opts?: { activity?: string }) =>
    formatPartialGroupTwoPersonPivot(when, venue, opts),
  mediumDensityChoice: (activity: string, when: string, opts?: { venue?: string; networkCount?: number; platforms?: string }) =>
    formatMediumDensityChoice(activity, when, opts),
  weatherPivot: (activity: string, opts?: { originalVenue?: string; indoorBackup?: string; address?: string; when?: string }) =>
    formatWeatherPivot(activity, opts),
  externalFlakeRecovery: (opts?: { activity?: string; venue?: string }) =>
    formatExternalFlakeRecovery(opts),
  crossDomainBridge: (target: "dating" | "work" | "friends") =>
    formatCrossDomainBridge(target, { brandName: b.name }),
  };
}
export type Copy = ReturnType<typeof copyFor>;
/** The Network's copy (ntwrk). Other apps: copyFor(brandOf(app)). */
export const copy: Copy = copyFor(NTWRK_BRAND);

export function formatSilentPartnerVenueSwap(
  when: string,
  venue: string,
  opts: { area?: string; note?: string } = {}
): string {
  const w = cleanPhrase(when);
  const v = cleanPhrase(venue);
  const details = [opts.area ? cleanPhrase(opts.area) : "", opts.note ? cleanPhrase(opts.note) : ""].filter(Boolean);
  const detailBit = details.length ? ` (${details.join(", ")})` : "";
  return clampSms(
    `Quick tweak for ${w}: let's do ${v}${detailBit} instead. Still works for you?`,
    `Quick tweak for ${w}: let's do ${v} instead. Still works for you?`
  );
}

export function formatPreArrivalBrief(
  when: string,
  venue: string,
  opts: { partner?: string; address?: string; landmark?: string; counterTab?: boolean } = {}
): string {
  const w = cleanPhrase(when);
  const v = cleanPhrase(venue);
  const who = opts.partner ? ` with ${cleanPhrase(opts.partner)}` : "";
  const addr = opts.address ? ` (${cleanPhrase(opts.address)})` : "";
  const landmark = opts.landmark ? ` Easy spot to meet: ${cleanPhrase(opts.landmark)}.` : "";
  const tab = opts.counterTab !== false ? " Everyone handles their own tab at the counter." : "";
  return clampSms(
    `Heads up for ${w}${who} at ${v}${addr}.${landmark}${tab} Text me here if you're running late, or anytime if anything feels off.`,
    `Heads up for ${w}${who} at ${v}.${landmark} Text me if you're running late, or anytime if anything feels off.`
  );
}

export function formatPartialGroupTwoPersonPivot(
  when: string,
  venue: string,
  opts: { activity?: string } = {}
): string {
  const w = cleanPhrase(when);
  const v = cleanPhrase(venue);
  const act = opts.activity ? ` for ${cleanPhrase(opts.activity)}` : "";
  return clampSms(
    `Quick update: a couple of people can't make ${w}${act}, so it would just be two of you at ${v}. Want to keep it as a 1:1, or should I find another time for a group?`,
    `Quick update: it's down to two of you for ${w} at ${v}. Want to keep it as a 1:1, or reschedule for a group?`
  );
}

export function formatMediumDensityChoice(
  activity: string,
  when: string,
  opts: { venue?: string; networkCount?: number; platforms?: string } = {}
): string {
  const act = cleanPhrase(activity);
  const w = cleanPhrase(when);
  const count = opts.networkCount ?? 3;
  const place = opts.venue ? ` at ${cleanPhrase(opts.venue)}` : "";
  const platforms = cleanPhrase(opts.platforms || "Luma/Meetup");
  return clampSms(
    `For ${act} ${w}${place}, we have ${count} vetted members ready. Want to keep it as a cozy ${count}-person hangout, or open a few screened ${platforms} spots?`,
    `We have ${count} vetted members for ${act} ${w}. Keep it small, or open a few screened local spots?`
  );
}

export function formatWeatherPivot(
  activity: string,
  opts: { originalVenue?: string; indoorBackup?: string; address?: string; when?: string } = {}
): string {
  const act = cleanPhrase(activity);
  const when = opts.when ? ` ${cleanPhrase(opts.when)}` : "";
  if (opts.indoorBackup) {
    const orig = opts.originalVenue ? ` for ${cleanPhrase(opts.originalVenue)}` : "";
    const backup = cleanPhrase(opts.indoorBackup);
    const addr = opts.address ? ` (${cleanPhrase(opts.address)})` : "";
    return clampSms(
      `Weather looks rough${orig}, so we're moving ${act}${when} indoors to ${backup}${addr} at the same time. Still in?`,
      `Weather looks rough, so we're moving ${act} indoors to ${backup}. Still in?`
    );
  }
  return clampSms(
    `Rain is rolling in for ${act}${when}, so let's postpone today's session rather than getting soaked. Want me to look for next weekend?`,
    `Rain is rolling in for ${act}, so let's postpone today. Want me to look for next weekend?`
  );
}

export function formatExternalFlakeRecovery(opts: { activity?: string; venue?: string } = {}): string {
  const act = opts.activity ? ` for ${cleanPhrase(opts.activity)}` : "";
  const at = opts.venue ? ` at ${cleanPhrase(opts.venue)}` : "";
  return clampSms(
    `Ugh, looks like tonight's external RSVPs${act}${at} flaked — really sorry about that. Feel free to grab a snack or head out whenever you want; I'll prioritize a curated in-network match for you next.`,
    "Looks like tonight's external RSVPs flaked — really sorry about that. Head out whenever you want; I'll prioritize a curated match next."
  );
}

export function formatCrossDomainBridge(
  target: "dating" | "work" | "friends",
  opts: { brandName?: string } = {}
): string {
  const brand = cleanPhrase(opts.brandName || "the Network");
  if (target === "dating") {
    return clampSms(
      `Glad the friend hang went well. I keep friend meetups strictly platonic, and nothing carries over unless you ask. Want me to opt you into dating intros on ${brand} separately?`,
      "I keep friend hangs strictly platonic. Want me to opt you into separate dating intros?"
    );
  }
  if (target === "work") {
    return clampSms(
      `Glad that went well. Work intros stay completely separate from social and dating here, with nothing shared across lanes. Want me to opt you into work intros on ${brand}?`,
      "Work intros stay completely separate here. Want me to opt you into work intros?"
    );
  }
  return clampSms(
    `Happy to help you expand your friend circle too. Friend intros stay separate and strictly platonic on ${brand}. Want me to look for a low-key friend hangout?`,
    "Friend intros stay separate and platonic. Want me to look for a low-key friend hangout?"
  );
}

const OFFER = "For future plans, reply CALENDAR to allow free/busy from an authorized calendar, or WEEKLY for a short weekly check-in.";
/** The answer request that ends a probe: with time options, which one works; without, yes or no. */
const tail = (times?: string) => (times ? ` I could do ${times}. Tell me which works, or no is completely fine.` : " Yes or no is all I need, and no is completely fine.");

/** "Thursday 7pm"-style phrasing in a city's timezone (or explicit IANA timezone; defaults to America/New_York). */
export function whenPhrase(t: number, cityOrTz?: CityId): string {
  const timeZone = cityOrTz
    ? (cityTimezone(cityOrTz) ?? (cityOrTz === "UTC" || cityOrTz.includes("/") ? cityOrTz : "America/New_York"))
    : "America/New_York";
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", hour: "numeric", minute: "2-digit" }).format(t).replace(":00", "");
}

/**
 * The one-time notice to a person on the eliza.app line who is not a member of any Network app, sent
 * once per number as the first reply of their first signed turn, before the join flow
 * (packages/network/service/README.md, "The Eliza seam"). Approved by the founder on 2026-10-11 (#22).
 * A change to the wording needs a new founder approval.
 */
export const ELIZA_NOTICE_STATUS: "DRAFT" | "APPROVED" = "APPROVED";
export const ELIZA_NOTICE =
  "Hi, it's Eliza. I'm now the agent of The Network (ntwrk.party), which helps people meet for friends, dating and work. Nothing changes for you unless you join, and nobody is matched with you without your consent. Reply STOP anytime to stop all messages from this number.";
