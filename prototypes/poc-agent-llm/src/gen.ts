// Labeled dataset generation. Labels are FIXED BY CONSTRUCTION: we sample a label spec with a seeded
// RNG, then a different model family (claude-sonnet-4.5 via Surplus) is told the label and writes the
// member message. The production model (gpt-6-luna) never sees the spec.
// Usage: bun run src/gen.ts [extract|route|all]
import { z } from "zod";
import { client, pool, rng, structured, writeJsonl, readJsonl, calls } from "./llm.ts";
import { ACTION_GUIDE, EXTRACTION_GUIDE, type Action, type Route } from "./spec.ts";
import { CONTEXTS, renderCtx, type Ctx } from "./contexts.ts";

const GEN_MODEL = process.env.GEN_MODEL ?? "claude-sonnet-4.5";
const gen = client({ callType: "gen", model: GEN_MODEL });
const Out = z.object({ text: z.string().min(1).max(1200) });

export const STYLES = [
  "terse all-lowercase SMS, 3-12 words, no punctuation",
  "SMS with several typos and autocorrect errors",
  "gen-z slang and abbreviations (ngl, lowkey, fr, tbh), lowercase",
  "non-native English speaker (Spanish first language): small grammar mistakes",
  "non-native English speaker (Mandarin first language): article/tense mistakes",
  "non-native English speaker (Hindi first language): Indian English phrasing",
  "non-native English speaker (Russian first language): dropped articles",
  "voice-transcript style: no punctuation, filler words (um, like, you know), a misheard word, run-on",
  "friendly normal texting, 1-3 sentences",
  "longer rambling message (3-5 sentences) mixing context and the request",
  "emoji-heavy casual text",
] as const;

// ------------------------------------------------------------------ extraction specs
const LOC = {
  sf: ["the Mission", "SF", "Oakland", "Berkeley", "near Dolores Park", "SoMa", "the Sunset", "Bernal Heights", "the city (San Francisco)"],
  nyc: ["Brooklyn", "bk", "Bushwick", "the LES", "Astoria", "Harlem", "Manhattan", "Williamsburg", "Crown Heights"],
  other: ["Austin", "Chicago", "LA", "Seattle", "Toronto", "Boston", "Denver", "Philly"],
};
const INTENTS: Record<string, string[]> = {
  social: ["make new friends since moving here", "find people to grab low-key weeknight dinners with", "meet people in my neighborhood", "find a group to hang out with on weekends"],
  professional: ["meet other founders working on climate", "find a technical cofounder", "meet angel investors for a seed round", "find design collaborators for a side project", "get intros to people hiring product managers"],
  hobby: ["find a regular tennis partner", "start a band (member plays bass)", "find people for pickup soccer", "find a ceramics / pottery crew", "find a climbing partner", "find people for a book club", "find people to play board games with"],
  help: ["get help moving a couch this Saturday", "get feedback on a pitch deck", "find someone to do a mock interview with", "borrow a truck for an afternoon"],
  events: ["find fun things to do this weekend", "find good live music shows", "find tech meetups to go to"],
  growth: ["find a mentor to learn to code", "practice public speaking", "find an accountability buddy for running", "find a Spanish conversation partner"],
};
const ROMANCE_INTENTS = ["meet someone to date", "go on dates with women around their age", "find a boyfriend", "meet people for dating, not just friends"];
const STATE_MEAN: Record<string, string> = {
  pause: "the member wants the Network to stop messaging them for a while / take a break",
  quiet: "the member is busy and wants far fewer messages, only important stuff",
  open: "the member has lots of free time and wants more suggestions / surprise me",
  normal: "the member wants to resume / go back to normal after having paused",
};
const QH: [number | null, number | null][] = [[21, null], [22, null], [23, 7], [22, 8], [null, 9], [0, 8], [21, 7], [20, null], [null, 10]];
const AGE_U18 = ["you're in 10th grade", "you're 16", "you're a high school junior", "you're 17 and your mom drives you places", "you're a sophomore in high school", "you're 15"];
const AGE_ADULT = ["you're 34", "you just turned 41", "you're retired", "you have two kids", "you're 27", "you're 52"];
const AGE_DISTRACT = ["your daughter is in 10th grade", "you teach 11th grade chemistry", "your little brother is 15", "you coach a high-school soccer team"];
const SENS: Record<string, string[]> = {
  physical_health: ["you have type 1 diabetes", "you're recovering from knee surgery", "you get chronic migraines"],
  mental_health: ["you've been dealing with depression", "you were recently diagnosed with ADHD", "you're in therapy for anxiety"],
  sexual_orientation_gender: ["you're bi and not out at work", "you're trans and recently started transitioning"],
  finances: ["you have a lot of credit card debt", "you just got laid off and money is tight"],
  immigration_status: ["you're on an H-1B and worried about your visa", "your immigration paperwork is in limbo"],
  pregnancy_fertility: ["you're 10 weeks pregnant and haven't told anyone", "you're going through IVF"],
  breakup_divorce: ["you're in the middle of a divorce", "you just got out of a 6-year relationship"],
  religion: ["you recently left the church you grew up in", "you converted to Islam last year"],
  substance_use: ["you're 8 months sober", "you're trying to quit drinking"],
  legal_trouble: ["you have a court date next month", "you got a DUI last year"],
  loneliness: ["you've been really lonely since moving", "you feel isolated and haven't had a real conversation in weeks"],
};
const ROMANCE_DISTRACT = ["mention your boyfriend or wife in passing", "say you went on a bad date last week, without asking for dating matches",
  "joke that dating apps are exhausting, without asking for anything romantic", "mention a friend of yours who is looking to date", "use the word 'date' to mean a calendar date"];
const STATE_DISTRACT = ["mention pausing your gym membership", "say the office is quiet this week", "say you're open to any cuisine"];
const CITY_DISTRACT = ["say you're visiting {loc} next week, but do NOT say where you live", "say you grew up in {loc}, but do NOT say where you live now"];

export interface ExtractLabel {
  city: "sf" | "nyc" | "other" | null; intents: string[]; state_change: string | null; romance_opt_in: "opt_in" | "opt_out" | null;
  quiet_hours: { start: number | null; end: number | null } | null; age_signal: "under_18" | "adult" | null; sensitive: string[];
}

function sampleExtract(i: number) {
  const R = rng(1000 + i);
  const must: string[] = []; const avoid: string[] = [];
  const label: ExtractLabel = { city: null, intents: [], state_change: null, romance_opt_in: null, quiet_hours: null, age_signal: null, sensitive: [] };
  // city
  const cr = R.r();
  if (cr < 0.42) { const c = R.pick(["sf", "sf", "nyc", "nyc", "other"] as const); label.city = c; must.push(`Say or clearly imply that you live in ${R.pick(LOC[c])}.`); }
  else if (cr < 0.52) { const c = R.pick(["sf", "nyc"] as const); must.push(R.pick(CITY_DISTRACT).replace("{loc}", R.pick(LOC[c]))); avoid.push("where you live"); }
  else avoid.push("where you live");
  // romance
  const rr = R.r();
  if (rr < 0.11) { label.romance_opt_in = "opt_in"; must.push(`Explicitly ask to be matched for dating / romance (${R.pick(ROMANCE_INTENTS)}).`); label.intents.push("romance"); }
  else if (rr < 0.19) { label.romance_opt_in = "opt_out"; must.push("Explicitly say you do NOT want dating / romantic matches (taken, or keep it platonic)."); }
  else if (rr < 0.36) { must.push(R.pick(ROMANCE_DISTRACT) + " (this must NOT read as asking for dating matches)."); }
  // intents
  const n = R.chance(0.3) ? 0 : R.chance(0.7) ? 1 : 2;
  const cats = Object.keys(INTENTS);
  while (label.intents.filter(c => c !== "romance").length < n) {
    const c = R.pick(cats); if (label.intents.includes(c)) continue;
    label.intents.push(c); must.push(`Ask the Network to help you ${R.pick(INTENTS[c])} (category: ${c}).`);
  }
  if (!label.intents.length) avoid.push("asking for anything to be found or arranged");
  // state
  const sr = R.r();
  if (sr < 0.2) { const s = R.pick(["pause", "quiet", "open", "normal"]); label.state_change = s; must.push(`Express this participation-state change: ${STATE_MEAN[s]}.`); }
  else if (sr < 0.28) must.push(R.pick(STATE_DISTRACT) + " (NOT about how often the Network messages you).");
  else avoid.push("how often the Network should message you");
  // quiet hours
  const qr = R.r();
  if (qr < 0.13) { const [s, e] = R.pick(QH); label.quiet_hours = { start: s, end: e };
    const f = (h: number) => h === 0 ? "midnight" : h === 12 ? "noon" : h < 12 ? `${h}am` : `${h - 12}pm`;
    must.push(`State quiet hours meaning exactly: ${s !== null && e !== null ? `no messages between ${f(s)} and ${f(e)}` : s !== null ? `no messages after ${f(s)} (say nothing about mornings)` : `no messages before ${f(e!)} (say nothing about evenings)`}. Phrase it naturally.`); }
  else if (qr < 0.18) must.push("Mention you work late until 10pm (NOT a request about message times).");
  // age
  const ar = R.r();
  if (ar < 0.09) { label.age_signal = "under_18"; must.push(`Reveal naturally that ${R.pick(AGE_U18)}.`); }
  else if (ar < 0.21) { const a = R.pick(AGE_ADULT); label.age_signal = a === "you have two kids" ? null : "adult"; must.push(`Reveal naturally that ${a}.`); } // extract.v2: kids -> null
  else if (ar < 0.29) must.push(`Mention that ${R.pick(AGE_DISTRACT)} (say nothing about your own age).`);
  else avoid.push("your own age or school");
  // sensitive
  if (R.chance(0.25)) { const t = R.pick(Object.keys(SENS)); label.sensitive.push(t); must.push(`Disclose about yourself that ${R.pick(SENS[t])}.`); }
  else avoid.push("sensitive personal disclosures (health, money, sexuality, immigration, etc.)");
  if (!must.length) { const c = R.pick(cats); label.intents.push(c); must.push(`Ask the Network to help you ${R.pick(INTENTS[c])}.`); }
  return { id: `ex_${String(i).padStart(3, "0")}`, style: R.pick(STYLES), must, avoid, label };
}

async function genExtract(n: number) {
  const specs = Array.from({ length: n }, (_, i) => sampleExtract(i));
  const rows = await pool(specs, 8, async s => {
    const text = await writeExtract(s);
    return { id: s.id, text, style: s.style, label: s.label, spec: { must: s.must, avoid: s.avoid } };
  });
  writeJsonl("data/extraction.raw.jsonl", rows.filter(r => r.text));
  console.log(`extraction: ${rows.filter(r => r.text).length}/${n}`);
}
async function writeExtract(s: ReturnType<typeof sampleExtract>, feedback = "") {
    const prompt = `You write realistic test data: inbound text messages from members of "The Network", an SMS-based AI agent that introduces people to each other in their city.
Write ONE message from a member to the agent.
The message MUST do all of these:
${s.must.map(m => "- " + m).join("\n")}
${s.avoid.length ? `The message must NOT mention: ${s.avoid.join("; ")}.` : ""}
It must not say anything else that would change how the fields below are labeled.
Writing style: ${s.style}. Keep it natural; do not mention labels, categories or field names.

For reference, these are the labeling rules a strict extractor will apply (your message must be labeled exactly as intended under them):
${EXTRACTION_GUIDE}

${feedback ? `\nA previous attempt was rejected by a reviewer because: ${feedback}\nAvoid that problem.\n` : ""}
Return JSON: {"text": "<the member message>"}`;
    const r = await structured(gen, [{ role: "user", content: prompt }], Out, 1500);
    return r.value?.text ?? null;
}

// ------------------------------------------------------------------ routing specs
const ANGLES: Record<Action, string[]> = {
  UPDATE_PROFILE: ["new job", "moved neighborhoods", "a new hobby they picked up", "correct something the agent got wrong about them", "ask to remove a fact from their profile", "mention a skill they have"],
  MANAGE_INTENT: ["create a long-term want: start a band", "create a long-term want: regular running buddy", "create: meet other climate founders over time", "create: find a weekly chess partner", "list my current asks", "pause my cofounder search", "close the tennis partner thing, found one", "change my book club ask to sci-fi only"],
  ASK_NETWORK: ["help moving a couch Saturday", "intro to someone who knows hardware manufacturing", "you'd like my friend Theo who is already a member, connect us", "someone to review my pitch deck this week", "people for a pickup basketball game tomorrow", "a mock interview partner before Thursday", "someone who's done an H-1B transfer to talk to"],
  CONCIERGE_SEARCH: ["information: opening hours of a place", "information: where's the nearest place to do X", "information: how to get from A to B", "information: is there a farmers market on Sunday", "recommendation: something fun this weekend", "recommendation: a good date-night restaurant", "recommendation: live music tonight", "recommendation: a quiet cafe to work from"],
  RESPOND_TO_OPPORTUNITY: ["yes enthusiastically", "decline politely", "maybe, need to check", "ask a question about the person or plan", "counter-propose a different day for the invite", "terse yes", "decline with a reason"],
  RELAY_MESSAGE: ["a reply to the other member's last message", "running late note", "ask the other member a question", "a thanks message to pass along", "share a tip with them"],
  SHARE_CONTACT: ["share my number with them", "ok to swap numbers", "give them my insta/contact", "stop sharing my number"],
  SCHEDULE: ["give availability windows", "pick one of proposed times", "reschedule the confirmed meetup", "cancel the meetup", "change the venue"],
  SET_STATE: ["pause for a few weeks", "slammed until November", "surprise me, more suggestions", "unpause / back on", "no texts after 9pm", "only tell me about music stuff", "no work stuff please"],
  INVITE_PERSON: ["invite a friend who isn't a member", "vouch for a coworker to join", "how do I get my sister in", "give the friend's name and why they'd be great"],
  BLOCK_OR_REPORT: ["block a member", "report creepy behavior", "the other person made them feel unsafe", "never match me with this person again, they were inappropriate", "report harassment in the relay thread"],
  GIVE_FEEDBACK: ["it was great", "not my vibe but fine", "the group was too big", "that suggestion was off", "was that worth a text: yes/no", "would see them again"],
  NONE: ["thanks", "hi / hello", "lol ok", "how does this work", "what do you know about me", "who runs this", "good morning!"],
};
const COUNTS: Record<Action, number> = {
  UPDATE_PROFILE: 18, MANAGE_INTENT: 22, ASK_NETWORK: 24, CONCIERGE_SEARCH: 34, RESPOND_TO_OPPORTUNITY: 20, RELAY_MESSAGE: 16,
  SHARE_CONTACT: 14, SCHEDULE: 18, SET_STATE: 18, INVITE_PERSON: 14, BLOCK_OR_REPORT: 16, GIVE_FEEDBACK: 18, NONE: 18,
};
function ctxFor(a: Action, angle: string, R: ReturnType<typeof rng>): Ctx {
  const pick = (k: string) => R.pick(CONTEXTS[k]);
  if (a === "RESPOND_TO_OPPORTUNITY") return pick("pending_invite");
  if (a === "RELAY_MESSAGE" || a === "SHARE_CONTACT") return pick("active_relay");
  if (a === "SCHEDULE") return /reschedule|cancel|venue/.test(angle) ? CONTEXTS.active_relay[1] : pick("scheduling");
  if (a === "GIVE_FEEDBACK") return R.chance(0.7) ? pick("feedback_ask") : pick("none");
  if (a === "BLOCK_OR_REPORT") return R.pick([pick("active_relay"), pick("feedback_ask"), pick("none")]);
  // distractor contexts for everything else: the message must NOT be about the active item
  const k = R.pick(["none", "none", "none", "pending_invite", "active_relay", "feedback_ask"]);
  return pick(k);
}
function routeFor(a: Action, angle: string): Route {
  if (a === "CONCIERGE_SEARCH") return angle.startsWith("information") ? "information" : "recommendation";
  if (a === "ASK_NETWORK") return "human_opportunity";
  if (a === "MANAGE_INTENT") return angle.startsWith("create") ? "standing_intent" : "none";
  return "none";
}

async function genRoute() {
  const specs: RouteSpec[] = [];
  let i = 0;
  for (const [a, n] of Object.entries(COUNTS) as [Action, number][]) {
    for (let k = 0; k < n; k++, i++) {
      const R = rng(5000 + i);
      const angle = ANGLES[a][k % ANGLES[a].length];
      specs.push({ id: `rt_${String(i).padStart(3, "0")}`, action: a, route: routeFor(a, angle), angle, style: R.pick(STYLES), ctx: ctxFor(a, angle, R) });
    }
  }
  const rows = await pool(specs, 8, async s => ({ id: s.id, text: await writeRoute(s), action: s.action, route: s.route, angle: s.angle, style: s.style, ctx: s.ctx }));
  writeJsonl("data/routing.raw.jsonl", rows.filter(r => r.text));
  console.log(`routing: ${rows.filter(r => r.text).length}/${specs.length}`);
}
type RouteSpec = { id: string; action: Action; route: Route; angle: string; style: string; ctx: Ctx };
async function writeRoute(s: RouteSpec, feedback = "") {
    const prompt = `You write realistic test data: inbound text messages from members of "The Network", an SMS-based AI agent that introduces people to each other in their city.
Conversation context the agent has:
${renderCtx(s.ctx)}

Write the member's NEXT message so that, under the labeling rules below, the correct label is:
action = ${s.action}, route = ${s.route}
Angle to write about: ${s.angle}.
${s.ctx.kind !== "none" && !["RESPOND_TO_OPPORTUNITY", "RELAY_MESSAGE", "SHARE_CONTACT", "SCHEDULE", "GIVE_FEEDBACK", "BLOCK_OR_REPORT"].includes(s.action) ? "The message must NOT be a response to the active item above; it changes the subject." : ""}
Writing style: ${s.style}. Make it natural and realistic, unambiguous under the rules, and do not mention action names.

Labeling rules:
${ACTION_GUIDE}
${feedback ? `\nA previous attempt was rejected by a reviewer because: ${feedback}\nAvoid that problem.\n` : ""}
Return JSON: {"text": "<the member message>"}`;
    const r = await structured(gen, [{ role: "user", content: prompt }], Out, 1500);
    return r.value?.text ?? null;
}

// ------------------------------------------------------------------ hard routing set (near-miss pairs, busy context)
const HARD: [Action, Route, string][] = [
  ["RESPOND_TO_OPPORTUNITY", "none", "looks like scheduling: counter-proposes a different day/time for Priya's still-pending coffee invite"],
  ["SCHEDULE", "none", "looks like responding to an invite: changes the time of the already-planned Saturday climb with Marcus"],
  ["RELAY_MESSAGE", "none", "looks like scheduling: tells Marcus they're running ~15 min late Saturday (no time change)"],
  ["SHARE_CONTACT", "none", "looks like a relay: asks the agent to give Marcus their instagram handle / number"],
  ["RELAY_MESSAGE", "none", "looks like contact sharing: a message for Marcus that mentions phones but does not share contact"],
  ["BLOCK_OR_REPORT", "none", "looks like feedback: describes coffee with Sarah K. where she made them uncomfortable / kept pushing after a no"],
  ["GIVE_FEEDBACK", "none", "looks like a report: negative, a bit harsh feedback on coffee with Sarah K. (boring, late) but nothing unsafe"],
  ["MANAGE_INTENT", "standing_intent", "looks like an immediate ask: an ongoing want (e.g. a regular weekly doubles partner) phrased casually"],
  ["ASK_NETWORK", "human_opportunity", "looks like a standing intent: a one-off person need for this week (e.g. someone to spot them at the climbing gym tomorrow)"],
  ["CONCIERGE_SEARCH", "information", "looks like asking for a person: 'anyone know ...' a fact/place question that search can answer"],
  ["CONCIERGE_SEARCH", "recommendation", "looks like a group ask: wants things to do tonight, no people needed"],
  ["ASK_NETWORK", "human_opportunity", "looks like a search: needs someone who has personally done X to talk to (e.g. someone who has raised a seed round)"],
  ["INVITE_PERSON", "none", "looks like an intro request: wants their friend who is NOT a member to join"],
  ["ASK_NETWORK", "human_opportunity", "looks like an invite: wants to be connected with a friend who IS already a member"],
  ["SET_STATE", "none", "looks like feedback: 'stop sending me X kind of stuff' as an ongoing notification preference"],
  ["GIVE_FEEDBACK", "none", "looks like a state change: says the last suggestion wasn't worth a text, without changing settings"],
  ["RESPOND_TO_OPPORTUNITY", "none", "looks like a state change: declines Priya's invite because they're busy this month"],
  ["SET_STATE", "none", "looks like an invite decline: asks for fewer messages in general for a few weeks, ignoring the Priya invite"],
  ["UPDATE_PROFILE", "none", "looks like an intent: shares that they recently got into bouldering, without asking for anything"],
  ["NONE", "none", "looks like a response: sarcastic or ambiguous reaction that is just small talk / thanks, clearly not answering the invite"],
];
async function genHard(per = 5) {
  const specs: RouteSpec[] = [];
  HARD.forEach(([action, route, hint], h) => { for (let k = 0; k < per; k++) {
    const R = rng(9000 + h * 10 + k);
    specs.push({ id: `hd_${String(h).padStart(2, "0")}_${k}`, action, route, angle: `HARD near-miss: ${hint}`, style: R.pick(STYLES), ctx: CONTEXTS.multi[0] });
  } });
  const rows = await pool(specs, 8, async s => ({ id: s.id, text: await writeRoute(s), action: s.action, route: s.route, angle: s.angle, style: s.style, ctx: s.ctx }));
  const ok = rows.filter(r => r.text);
  const audited = await pool(ok, 8, r => auditOne("routing", r));
  writeJsonl("data/routing_hard.raw.jsonl", ok);
  writeJsonl("data/routing_hard.jsonl", audited.filter(a => a.row).map(a => a.row));
  writeJsonl("data/audit_routing_hard.jsonl", audited.map(a => a.log));
  console.log(`hard: kept ${audited.filter(a => a.row).length}/${ok.length}, first-pass ok ${audited.filter(a => a.log.tries[0].matches).length}`);
}

// ------------------------------------------------------------------ audit (third model family) + regenerate
const AUDIT_MODEL = process.env.AUDIT_MODEL ?? "gemini-2.5-pro";
const auditor = client({ callType: "audit", model: AUDIT_MODEL });
const Verdict = z.object({ matches: z.boolean(), problem: z.string() });
async function audit(text: string, intended: unknown, guide: string, ctx?: Ctx) {
  const fmt = ctx ? "" : "\nLabel format note: intents and sensitive are given as lists of categories/topics only (objective/summary omitted; every sensitive item is agent_private). Judge the content, not the format.";
  const prompt = `You audit labeled test data for a strict classifier. Given the labeling rules, decide whether the message would be labeled EXACTLY as intended by a careful annotator. Be strict: flag any field where the message clearly implies a different value (e.g. it asks for something extra, or omits something required, or is ambiguous between two labels). Minor style issues do not matter.
Rules:
${guide}
${ctx ? `\nConversation context:\n${renderCtx(ctx)}\n` : ""}
Message: ${JSON.stringify(text)}
Intended label: ${JSON.stringify(intended)}${fmt}
Return JSON {"matches": true|false, "problem": "<empty, or which field is wrong and why>"}`;
  const r = await structured(auditor, [{ role: "user", content: prompt }], Verdict, 4000);
  return r.value ?? { matches: false, problem: "auditor failed: " + r.error };
}
async function auditOne(kind: "extraction" | "routing", r: any) {
  const guide = kind === "extraction" ? EXTRACTION_GUIDE : ACTION_GUIDE;
  const labelOf = (r: any) => kind === "extraction" ? r.label : { action: r.action, route: r.route };
  let text = r.text; const tries: any[] = [];
  for (let k = 0; k < 3; k++) {
    const v = await audit(text, labelOf(r), guide, kind === "routing" ? r.ctx : undefined);
    tries.push({ text, ...v });
    if (v.matches) break;
    if (k === 2) { text = null; break; }
    text = kind === "extraction"
      ? await writeExtract({ id: r.id, style: r.style, must: r.spec.must, avoid: r.spec.avoid, label: r.label }, v.problem)
      : await writeRoute({ id: r.id, action: r.action, route: r.route, angle: r.angle, style: r.style, ctx: r.ctx }, v.problem);
    if (!text) break;
  }
  return { log: { id: r.id, tries }, row: text ? { ...r, text, regenerated: tries.length - 1 } : null };
}
/** Extraction top-up: new specs (ids 200+) through the same generate+audit loop until the set has \`target\` items. */
async function topupExtract(target = 200) {
  const have = readJsonl<any>("data/extraction.jsonl");
  const log = readJsonl<any>("data/audit_extraction.jsonl");
  const raw = readJsonl<any>("data/extraction.raw.jsonl");
  const need = target - have.length;
  if (need <= 0) return;
  const start = 200 + (raw.length - 200 > 0 ? raw.length - 200 : 0);
  const specs = Array.from({ length: Math.ceil(need * 1.6) }, (_, k) => sampleExtract(start + k));
  const res = await pool(specs, 8, async s => {
    const text = await writeExtract(s);
    const r = { id: s.id, text, style: s.style, label: s.label, spec: { must: s.must, avoid: s.avoid }, topup: true };
    raw.push(r);
    return text ? auditOne("extraction", r) : null;
  });
  const kept = res.filter(x => x?.row).map(x => x!.row).slice(0, need);
  writeJsonl("data/extraction.jsonl", [...have, ...kept]);
  writeJsonl("data/extraction.raw.jsonl", raw.sort((a, b) => a.id.localeCompare(b.id)));
  writeJsonl("data/audit_extraction.jsonl", [...log, ...res.filter(Boolean).map(x => x!.log)].sort((a, b) => a.id.localeCompare(b.id)));
  console.log(`topup: +${kept.length} -> ${have.length + kept.length}`);
}
async function auditAll() {
  for (const kind of ["extraction", "routing"] as const) {
    const rows = readJsonl<any>(`data/${kind}.raw.jsonl`);
    const guide = kind === "extraction" ? EXTRACTION_GUIDE : ACTION_GUIDE;
    const labelOf = (r: any) => kind === "extraction" ? r.label : { action: r.action, route: r.route };
    const log: any[] = [];
    const out = await pool(rows, 8, async r => {
      let text = r.text; const tries: any[] = [];
      for (let k = 0; k < 3; k++) {
        const v = await audit(text, labelOf(r), guide, kind === "routing" ? r.ctx : undefined);
        tries.push({ text, ...v });
        if (v.matches) break;
        if (k === 2) { text = null; break; }
        text = kind === "extraction"
          ? await writeExtract({ id: r.id, style: r.style, must: r.spec.must, avoid: r.spec.avoid, label: r.label }, v.problem)
          : await writeRoute({ id: r.id, action: r.action, route: r.route, angle: r.angle, style: r.style, ctx: r.ctx }, v.problem);
        if (!text) break;
      }
      log.push({ id: r.id, tries });
      return text ? { ...r, text, regenerated: tries.length - 1 } : null;
    });
    const kept = out.filter(Boolean);
    writeJsonl(`data/${kind}.jsonl`, kept);
    writeJsonl(`data/audit_${kind}.jsonl`, log.sort((a, b) => a.id.localeCompare(b.id)));
    console.log(`${kind}: kept ${kept.length}/${rows.length}; first-pass ok ${log.filter(l => l.tries[0].matches).length}; regenerated ok ${kept.filter((r: any) => r.regenerated).length}`);
  }
}

if (import.meta.main) {
  const what = process.argv[2] ?? "all";
  if (what === "extract" || what === "all") await genExtract(Number(process.env.N_EXTRACT ?? 200));
  if (what === "route" || what === "all") await genRoute();
  if (what === "audit" || what === "all") await auditAll();
  if (what === "topup") await topupExtract();
  if (what === "hard") await genHard();
  const g = calls.filter(c => c.ok);
  console.log(`gen calls ${g.length} (cached ${g.filter(c => c.cached).length}), cost $${(g.reduce((s, c) => s + c.costMicro, 0) / 1e6).toFixed(3)}`);
}
