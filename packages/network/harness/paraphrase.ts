// The paraphrase arm (audit 2026-10-08, matching-e2e-1): the simulator's personas speak in the
// taxonomy's own sentences ("I'd really like to find a regular climbing partner", "I'm around Park
// Slope most of the week", "Yes, I'd like that!"). The rules that read them were first written
// against those sentences, so a run on them grades the parser with its own phrasing. This agent
// wraps the persona policy and rewrites what each persona says into other words a member would use.
// The persona's decision does not change: only the text the Network reads does.
//
// The variants here were written for this harness and are not the test corpora (test/fixtures), so
// the arm also checks the rules on phrasing they were not tuned on.
import { DESIRES, type AgentReply, type Initiative, type PersonaAgent, type PersonaContext, type SimMessage } from "@thenetwork/sim";

/** Other ways to say each want (the persona keeps its want; the words change). */
const WANT_WORDS: Record<string, string[]> = {
  start_band: ["get a band going", "find people to make loud music with", "put a little band together"],
  learn_sailing: ["finally learn how to sail", "get out on a sailboat and learn the basics", "pick up sailing"],
  climbing_partner: ["find someone to boulder with", "get a steady climbing buddy", "find a belay partner"],
  tennis_partner: ["find someone to hit tennis balls with on weekends", "get a regular tennis buddy", "find a tennis partner for saturdays"],
  meet_founders: ["meet more people building startups", "get to know a few other founders", "swap notes with other founders"],
  climate_people: ["meet folks in the climate space", "get to know people doing climate work", "find people working on clean energy"],
  ai_mentor: ["find a mentor in machine learning", "get career advice from someone senior in ML", "pick an AI person's brain about my career"],
  new_friends: ["make some new friends here", "build a friend group in the city", "meet people to hang out with"],
  dinner_club: ["join a supper club", "find a group for regular dinners", "do monthly potlucks with people"],
  film_buddies: ["find a movie buddy", "find people to catch films with", "join a film club"],
  ceramics_class: ["give pottery a try", "take a ceramics class with someone", "get into pottery"],
  moving_help: ["get a hand moving my couch", "find someone to help me haul a sofa", "get help moving some furniture"],
  pitch_feedback: ["get someone to look at my pitch deck", "get honest notes on my deck", "have someone tear apart my pitch"],
  dating: ["start dating again", "meet someone to go on dates with", "find someone special"],
  chess_games: ["play chess with real people", "find a chess opponent nearby", "play some over-the-board chess"],
  parent_friends: ["meet other parents with little kids", "find playdates for my kid", "make some parent friends"],
  run_club: ["find a running buddy", "join a running group", "find people to jog with"],
  writing_group: ["join a writers workshop", "find a writing critique group", "find a writing accountability group"],
  hardware_collab: ["find someone to build an electronics project with", "find a collaborator for my arduino project", "team up on a hardware side project"],
  photo_walks: ["do photo walks around the city", "go shooting street photography with someone", "wander around with cameras"],
};
const YES = ["ok sure", "sounds fun, I'm down", "yeah let's do it", "sure thing", "I'm game"];
const NO = ["nah, not this week", "I'll sit this one out", "not for me right now, thanks", "no thank you", "pass for now"];

/** A stable pick from a list (FNV-1a of the persona id and the text): deterministic per run, no RNG draws. */
function pick<T>(xs: readonly T[], ...keys: string[]): T {
  let h = 0x811c9dc5;
  for (const ch of keys.join("|")) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return xs[h % xs.length]!;
}

/** The same message in other words. Anything not recognized stays as it is. */
export function paraphrase(personaId: string, text: string): string {
  let t = text;
  for (const d of DESIRES) if (t.includes(d.text)) t = t.split(d.text).join(pick(WANT_WORDS[d.id] ?? [d.text], personaId, d.id));
  t = t.replace(/I'm around ([A-Z][\w'.-]*(?: [A-Z][\w'.-]*)*) most of the week/, (_m, area: string) => pick([`I live in ${area}`, `I'm based in ${area}`, `home is ${area}`], personaId, area));
  t = t.replace(/^Anyone around who'd want to (.+)\? I'm near ([^.]+)\.$/, (_m, want: string, area: string) => pick([`would love to ${want}, I'm over in ${area}`, `looking to ${want}. I'm in ${area}`], personaId, want));
  t = t.replace(/^Still hoping to (.+)\. Anything come up\?$/, (_m, want: string) => `any luck finding someone? still want to ${want}`);
  if (/^(Yes, I'd like that!|Sure, sounds good\.|Yeah, I'm in\.|Happy to, sounds fun\.|Yes, I'd be up for that\.|Sure, that sounds good\.|I'm in, tell me more\.)/.test(t)) t = pick(YES, personaId, t);
  if (/^(No thanks, not right now\.|I'll pass this time, thanks\.|Not for me, but thanks\.|Can't right now, pass\.|Not this week, thanks\.|I'll pass for now\.)/.test(t)) t = pick(NO, personaId, t);
  return t;
}

/** Wraps a persona agent; its decisions are unchanged, its words are paraphrased. */
export class ParaphraseAgent implements PersonaAgent {
  get mode() { return this.inner.mode; }
  constructor(private inner: PersonaAgent) {}
  async respond(ctx: PersonaContext, msg: SimMessage): Promise<AgentReply> {
    const r = await this.inner.respond(ctx, msg);
    return r.text ? { ...r, text: paraphrase(ctx.persona.id, r.text) } : r;
  }
  async initiative(ctx: PersonaContext): Promise<Initiative | undefined> {
    const i = await this.inner.initiative(ctx);
    return i && i.kind === "ask" ? { ...i, text: paraphrase(ctx.persona.id, i.text) } : i;
  }
  joinMessage(ctx: PersonaContext) { return this.inner.joinMessage(ctx); }
}
