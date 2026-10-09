// The two-app world (network block): The Network and slop.date on one shared line, as the service
// runs them (packages/network/service): one ConsentNetwork per app, each with its own snapshot of its
// own members (loadSnapshot reads one app's rows), the slop wiring on slop (appWiring), and the
// service's routing for a member's text: the app that wrote to them last, else their first app; a
// first text joins every app they use and a keyword (STOP) reaches every app. Some people use both
// apps. Every record names its app (the network stamps it on its texts and proposals; the world on
// inbound texts and joins), so the judge's cross_app_leak rule runs: a detail learned in one app never
// reaches a text in the other, and no text names someone who is not a member of that app.
import { hash32, type AppId, type InboundMessage, type MemberId, type NetworkContext, type NetworkUnderTest, type Proposal, type RunRecord } from "../../packages/core/src/index.ts";
import { ConsentNetwork } from "../../packages/network/src/network.ts";
import { appWiring } from "../../packages/network/service/packs.ts";
import { generatePersonas, World, type Persona, type SimSnapshot } from "../../packages/sim/src/index.ts";

export class TwoAppNetwork implements NetworkUnderTest {
  readonly name = "two-app";
  readonly nets = new Map<AppId, ConsentNetwork>();
  private last = new Map<MemberId, AppId>();
  private joined = new Set<MemberId>();
  constructor(seed: number, private apps: ReadonlyMap<MemberId, AppId[]>) {
    const w = appWiring("slop");
    this.nets.set("ntwrk", new ConsentNetwork({ seed, review: "auto" }));
    this.nets.set("slop", new ConsentNetwork({ seed, app: "slop", review: "auto", pack: w.pack, hooks: w.hooks, plans: w.plans ?? true, engine: w.engine }));
  }
  private member = (id: MemberId, app: AppId) => (this.apps.get(id) ?? ["ntwrk"]).includes(app);
  /** The app a member's next text goes to: the app that wrote to them last, else their first app. */
  appOf = (id: MemberId): AppId => this.last.get(id) ?? this.apps.get(id)?.[0] ?? "ntwrk";

  init(ctx: NetworkContext) {
    for (const [app, net] of this.nets) net.init({
      ...ctx,
      send: (id, body, o) => { this.last.set(id, app); return ctx.send(id, body, o); },
      snapshot: () => {
        const s = ctx.snapshot() as SimSnapshot, keep = (id: MemberId) => this.member(id, app);
        return {
          ...s, members: s.members.filter(m => keep(m.id)), facets: s.facets.filter(f => keep(f.memberId)), intents: s.intents.filter(i => keep(i.memberId)),
          presence: s.presence.filter(p => keep(p.memberId)), edges: s.edges.filter(e => keep(e.from) && keep(e.to)),
          recentProposals: s.recentProposals.filter(p => (p.app ?? "ntwrk") === app),
          ...(s.interactions ? { interactions: s.interactions.filter(x => x.participants.every(keep)) } : {}),
          ...(s.feedback ? { feedback: s.feedback.filter(x => keep(x.from) && keep(x.about)) } : {}),
          ...(s.openOpportunities ? { openOpportunities: s.openOpportunities.filter(x => x.participants.every(keep)) } : {}),
        };
      },
    });
  }
  async onInbound(m: InboundMessage) {
    const mine = this.apps.get(m.memberId) ?? ["ntwrk"];
    const first = !this.joined.has(m.memberId);
    this.joined.add(m.memberId);
    for (const app of first || m.keyword ? mine : [this.appOf(m.memberId)]) await this.nets.get(app)!.onInbound(m);
  }
  async tick(now: number) { for (const net of this.nets.values()) await net.tick(now); }
  submitProposal(p: Proposal) { this.nets.get(p.app ?? "ntwrk")!.submitProposal(p); }
}

/** New York personas: a third of the adults who date use slop too, a few use slop only; minors may use both (never matched). */
export function twoAppPersonas(seed: number, n: number): Persona[] {
  const ps = generatePersonas({ n, seed: `two-app:${seed}`, cityWeights: { nyc: 1, sf: 0 }, idPrefix: "t" });
  for (const p of ps) {
    // No invites between generated people: a 13-17 inviter would be named in an adult's welcome (a
    // minor contact the ntwrk worlds cover); this world is about the line between apps.
    p.secondaryCity = undefined; p.hidden.trips = []; p.relationships = []; delete p.invitedBy;
    const h = hash32("two-app", p.id) % 6;
    const dates = p.public.claimedAge >= 18 && p.hidden.romance.optIn;
    p.apps = dates && h < 2 ? ["ntwrk", "slop"] : dates && h === 2 ? ["slop"] : p.public.claimedAge < 18 && h === 0 ? ["ntwrk", "slop"] : ["ntwrk"];
  }
  return ps;
}

export async function runTwoApp(seed: number, days: number, n: number): Promise<{ records: RunRecord[]; personas: Persona[]; net: TwoAppNetwork }> {
  const personas = twoAppPersonas(seed, n);
  const net = new TwoAppNetwork(seed, new Map(personas.map(p => [p.id, p.apps ?? ["ntwrk"]])));
  const records: RunRecord[] = [];
  await new World({ seed, personas, days, network: net, writeLog: false, appOf: net.appOf, onRecord: r => records.push(r) }).run();
  return { records, personas, net };
}
