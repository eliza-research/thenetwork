// A ConsentNetwork for one app with a memory store, a SimClock and members you add by hand: what a
// test needs to drive a conversation by text (or by a profile from the member's AI assistant).
import { DAY, HOUR, SimClock, type InboundMessage, type Member, type MemberId, type NetworkContext, type SimMessage, type WorldSnapshot } from "@thenetwork/core";
import { ConsentNetwork, MemoryStore, runStored, runTick, type NetworkOptions } from "../src/index.ts";
import { appWiring } from "../service/packs.ts";
import { APPS, type AppId } from "../../platform/src/apps.ts";

export interface Sent { memberId: MemberId; body: string; ts: number; type?: string }

export function harness(app: AppId, o: NetworkOptions = {}) {
  const clock = new SimClock();
  const store = new MemoryStore();
  const members: Member[] = [];
  const sent: Sent[] = [];
  const logs: { type: string; detail: Record<string, unknown> }[] = [];
  const w = appWiring(app);
  const net = new ConsentNetwork({
    app: APPS[app], review: "human", matchingEnabled: false, store,
    ...(w.pack ? { pack: w.pack } : {}), ...(w.hooks ? { hooks: w.hooks } : {}), ...(w.plans !== undefined ? { plans: w.plans } : {}),
    ...(w.engine ? { engine: w.engine } : {}),
    ...o,
  });
  let seq = 0;
  const ctx: NetworkContext = {
    clock,
    send(memberId, body, opts) {
      const msg: SimMessage = { id: `out-${++seq}`, ts: clock.now(), direction: "outbound", channel: "imessage", from: "network", to: memberId, memberId, body, status: "delivered", ...(opts?.meta ? { meta: opts.meta } : {}) };
      sent.push({ memberId, body, ts: clock.now(), ...(opts?.meta?.type ? { type: opts.meta.type } : {}) });
      return msg;
    },
    snapshot: (): WorldSnapshot => ({ now: clock.now(), members: [...members], facets: [], intents: [], presence: [], edges: [], recentProposals: [] }),
    recordProposal() {},
    recordMeeting: () => `meeting-${++seq}`,
    recordBlock() {},
    log(type, detail) { logs.push({ type, detail }); },
  };
  net.init(ctx);

  const add = (id: MemberId, name: string, age: number | undefined) => {
    const prefs = w.prefs(age ?? 0);
    members.push({
      id, name, homeCity: "nyc", state: "normal", joinedAt: clock.now(), age: age as number, unansweredProactive: 0, apps: [app],
      prefs: { categoriesOptIn: prefs.categoriesOptIn as Member["prefs"]["categoriesOptIn"], romanceOptIn: prefs.romanceOptIn, quietHours: [22, 8], formats: ["one_to_one"], maxTravelMinutes: 45, onlyWhenAsked: false },
    });
  };
  /** A text from the member, handled as one stored unit; returns what was sent back to them. */
  const say = async (id: MemberId, body: string, source?: InboundMessage["source"]) => {
    const n = sent.length;
    clock.advance(2 * 60_000);
    await runStored(net, store, x => x.onInbound({ id: `in-${++seq}`, memberId: id, body, ts: clock.now(), channel: "imessage", ...(source ? { source } : {}) }));
    return sent.slice(n).filter(s => s.memberId === id).map(s => s.body);
  };
  /** Hourly ticks for `ms`; returns what was sent meanwhile. */
  const wait = async (ms: number) => {
    const n = sent.length;
    const end = clock.now() + ms;
    while (clock.now() + HOUR <= end) { clock.advance(HOUR); await runTick(net, store, clock.now()); }
    return sent.slice(n);
  };
  const state = async () => (await store.load())!;
  const tags = async (id: MemberId) => ((await state()).members as { id: string; appTags?: { tag: string }[] }[]).find(m => m.id === id)?.appTags?.map(t => t.tag).sort() ?? [];
  return { net, clock, store, members, sent, logs, add, say, wait, state, tags, DAY, HOUR };
}
