// "Play as a member": a PersonaAgent that hands messages for player-controlled personas to the
// player and waits. The simulator awaits agent replies, so the world simply pauses until the
// player answers (or asks the persona's own policy to answer). Everyone else uses the inner agent.
import { MINUTE, type MemberId } from "@thenetwork/core";
import { decide, parseYesNo, type AgentReply, type PersonaAgent, type PersonaContext, type SimMessage } from "@thenetwork/sim";
import type { PlayerPrompt } from "./types.ts";

interface Pending { prompt: PlayerPrompt; ctx: PersonaContext; msg: SimMessage; resolve: (r: AgentReply) => void }

const CANT_MAKE_IT = /can'?t make it|have to bail|can'?t come|cancel/i;
const NO_REPLY_NEEDED = new Set(["info", "confirmation", "cancellation", "system", "concierge"]);

export class TakeoverAgent implements PersonaAgent {
  readonly controlled = new Set<MemberId>();
  private pending = new Map<string, Pending>();
  private seq = 0;
  constructor(private inner: PersonaAgent, private worldStart: number, private onPrompt: () => void = () => {}) {}
  get mode() { return this.inner.mode; }

  prompts(): PlayerPrompt[] { return [...this.pending.values()].map(p => p.prompt); }
  get waiting() { return this.pending.size > 0; }

  async respond(ctx: PersonaContext, msg: SimMessage): Promise<AgentReply> {
    if (!this.controlled.has(ctx.persona.id) || msg.system) return this.inner.respond(ctx, msg);
    // Only messages that ask something of the member pause the world; plain info is just read.
    if (msg.meta?.type && NO_REPLY_NEEDED.has(msg.meta.type)) return { intent: "ignore", messageType: msg.meta.type, decision: "none", delayMs: 0, action: "ignore" };
    return new Promise<AgentReply>(resolve => {
      const id = `prompt-${++this.seq}`;
      this.pending.set(id, {
        prompt: { id, memberId: ctx.persona.id, messageId: msg.id, body: msg.body, type: msg.meta?.type, proposalId: msg.meta?.proposalId, at: ctx.now },
        ctx, msg, resolve,
      });
      this.onPrompt();
    });
  }

  /** Answer a pending prompt with the player's text, or let the persona's own policy answer (auto). */
  async answer(promptId: string, opts: { text?: string; auto?: boolean }): Promise<AgentReply> {
    const p = this.pending.get(promptId);
    if (!p) throw new Error(`no pending prompt ${promptId}`);
    this.pending.delete(promptId);
    const reply = opts.auto || !opts.text?.trim() ? await this.inner.respond(p.ctx, p.msg) : this.playerReply(p.ctx, p.msg, opts.text.trim());
    p.resolve(reply);
    return reply;
  }

  /** Release every controlled persona (pending prompts are auto-answered by the policy). */
  async releaseAll() {
    this.controlled.clear();
    for (const id of [...this.pending.keys()]) await this.answer(id, { auto: true });
  }

  /**
   * Turn the player's words into the decision the world acts on. The policy still runs first so
   * the persona's private bookkeeping (proactive count, oracle view) stays consistent, then the
   * player's yes/no overrides it; saying yes commits the persona to show up.
   */
  private playerReply(ctx: PersonaContext, msg: SimMessage, text: string): AgentReply {
    const d = decide(ctx, msg, this.worldStart);
    const mem = ctx.memory;
    const pid = msg.meta?.proposalId ?? d.proposalId;
    const base: AgentReply = { ...d, action: "reply", text, delayMs: 2 * MINUTE, proposalId: pid };
    if (CANT_MAKE_IT.test(text)) {
      const upcoming = Object.entries(mem.proposals).find(([, pr]) => pr.decision !== "decline" && pr.at && pr.at > ctx.now)?.[0] ?? pid;
      if (upcoming && mem.proposals[upcoming]) mem.proposals[upcoming]!.plannedShow = false;
      return { ...base, intent: "flake_notice", decision: "none", proposalId: upcoming };
    }
    if (d.messageType === "proposal" && pid) {
      const yn = parseYesNo(text);
      if (yn !== "unclear") {
        const decision = yn === "no" ? "decline" : yn === "counter" ? "counter" : "accept";
        const pr = mem.proposals[pid] ?? { decision, plannedShow: false, enjoyment: 0, others: d.participants?.filter(x => x !== ctx.persona.id) ?? [] };
        mem.proposals[pid] = { ...pr, decision, plannedShow: decision !== "decline" };
        return { ...base, intent: decision, decision };
      }
    }
    if (d.messageType === "onboarding" || d.messageType === "question") { mem.questionsAnswered++; return { ...base, intent: "answer_question" }; }
    if (d.messageType === "feedback_request") return { ...base, intent: "feedback" };
    if (d.messageType === "scheduling") return { ...base, intent: "confirm_schedule" };
    return { ...base, intent: d.intent === "ignore" ? "ack" : d.intent };
  }

  initiative(ctx: PersonaContext) {
    // A controlled persona only speaks when the player says something.
    if (this.controlled.has(ctx.persona.id)) return Promise.resolve(undefined);
    return this.inner.initiative(ctx);
  }
  joinMessage(ctx: PersonaContext) { return this.inner.joinMessage(ctx); }
}
