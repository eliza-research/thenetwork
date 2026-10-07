// Right-hand inspector: Member 360 (profile, knowledge, intents, graph, opportunities, the member's
// own message timeline, hidden truth in game mode) and the opportunity view (participants, why,
// score components, oracle verdict, messages, engine run).
import { useEffect, useState } from "react";
import type { MemberDetail, ObsOpportunity, OpportunityDetail } from "../src/types.ts";
import { communityColor, EDGE_STYLE, OPP_COLOR, STATE_COLOR } from "./graph.ts";
import { OPEN, store, useStore } from "./store.ts";
import { Badge, Bars, Components, humanize, Kpi, localDate, num, pct, Section, stamp } from "./ui.tsx";

const SCOPE_TONE: Record<string, string> = { agent_private: "bad", matchable: "info", shareable: "good", opportunity_specific: "warn" };
const STATUS_TONE: Record<string, string> = {
  accepted: "good", confirmed: "good", attended: "good", countered: "info", declined: "bad", no_show: "bad", ignored: "warn", expired: "warn",
  cancelled_with_notice: "warn", dropped: "neutral", invited: "info", pending: "neutral",
};

export function Inspector() {
  const s = useStore();
  const sel = s.ui.selection;
  return (
    <aside className="inspector">
      {sel?.kind === "member" ? <MemberPanel id={sel.id} key={sel.id} />
        : sel?.kind === "opportunity" ? <OpportunityPanel id={sel.id} key={sel.id} />
        : <Overview />}
    </aside>
  );
}

function useDetail<T>(load: () => Promise<T | undefined>, deps: unknown[]): T | undefined {
  const [d, setD] = useState<T>();
  useEffect(() => {
    let live = true;
    const run = () => load().then(x => { if (live) setD(x); });
    run();
    const t = setInterval(run, 2500);
    return () => { live = false; clearInterval(t); };
  }, deps);
  return d;
}

// ---------------------------------------------------------------- overview
function Overview() {
  const s = useStore();
  const st = s.stats;
  if (!st) return null;
  const game = s.env?.capabilities.canIntervene;
  return (
    <div className="panel">
      <div className="panel-head">
        <div className="eyebrow">{game ? "Simulated world" : "Real world"}</div>
        <h2>{game ? "The Network, live" : "The Network, as it is"}</h2>
        <p className="muted">{game
          ? `${num(st.members)} synthetic New Yorkers living their weeks. The engine suggests; the Network checks availability anonymously, reveals only when everyone's in, meets them at real public places, and learns.`
          : `Reading ${s.env?.database ?? "the database"} read-only. Names and contact details are scrubbed.`}</p>
      </div>
      {s.env?.error && <div className="callout bad">{s.env.error}</div>}
      <div className="kpis">
        <Kpi label="members joined" value={num(st.joined)} sub={`${num(st.members)} total`} />
        <Kpi label="messages" value={num(st.messages)} sub={`${num(st.proactive)} proactive`} />
        <Kpi label="proposals" value={num(st.proposals)} sub={`${num(st.invites)} invites sent`} />
        <Kpi label="accept rate" value={pct(st.invites ? st.accepts / st.invites : 0)} sub={`${num(st.accepts)} yes · ${num(st.declines)} no`} />
        <Kpi label="meetings held" value={num(st.meetingsHeld)} sub={`${num(st.meetingsScheduled)} scheduled`} tone="good" />
        <Kpi label="mean enjoyment" value={st.enjoymentN ? pct(st.enjoymentSum / st.enjoymentN) : "–"} sub={`${num(st.attended)} attendances`} />
        {game && <Kpi label="precision vs truth" value={pct(st.oracleJudged ? st.compatible / st.oracleJudged : 0)} sub="proposals truly compatible" />}
        {game && <Kpi label="unsafe proposals" value={num(st.unsafe)} sub="by hidden truth" tone={st.unsafe ? "bad" : "good"} />}
        <Kpi label="blocks · opt-outs" value={`${st.blocks} · ${st.optOuts}`} tone={st.optOuts ? "warn" : undefined} />
        <Kpi label="safety flags" value={num(st.adversarialAttempts)} sub={`${st.invariantViolations} invariant violations`} tone={st.invariantViolations ? "bad" : undefined} />
      </div>
      <Section title="Relationships the Network knows">
        <Bars data={st.edgesByType} color={k => EDGE_STYLE[k]?.color ?? "#888"} />
      </Section>
      <Section title="Opportunities by state">
        <Bars data={st.oppsByState} color={k => OPP_COLOR[k] ?? "#7c8799"} />
      </Section>
      {game && (
        <Section title="How to play">
          <ol className="howto">
            <li><b>Watch.</b> Press play. Arcs are live opportunities; rings pulse when people accept, meet or block.</li>
            <li><b>Matchmake.</b> Shift-click 2 people (or 3-6 for a group), then Propose. Your intros go out with the 10am batch. Avoid people with a white ring: they're already in an open opportunity.</li>
            <li><b>Be a member.</b> Select someone and press "Play as". The world pauses whenever the Network texts them.</li>
            <li><b>Score.</b> Accepts, meetings and enjoyment earn points; unsafe intros cost 150 and a strike. Beat engine-v1 per proposal.</li>
          </ol>
        </Section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- member
function MemberPanel({ id }: { id: string }) {
  const s = useStore();
  const m = s.members.get(id);
  const d = useDetail<MemberDetail>(() => store.member(id), [id, s.mode, !!s.truth]);
  const [tab, setTab] = useState<"profile" | "graph" | "opps" | "messages" | "truth">("profile");
  if (!m) return <div className="panel muted">Member not found.</div>;
  const game = !!s.env?.capabilities.canIntervene;
  const controlled = s.game?.controlled.includes(id);
  const picked = s.ui.picks.includes(id);
  const busy = s.busy().has(id);
  const meanEnj = m.counters.enjoymentN ? m.counters.enjoymentSum / m.counters.enjoymentN : undefined;
  return (
    <div className="panel">
      <div className="panel-head">
        <div className="eyebrow"><span className="dot" style={{ background: communityColor(m.community ?? m.city) }} />{m.community?.replace(":", " · ") ?? m.city}</div>
        <h2>{m.name}</h2>
        <div className="chips">
          <Badge tone="info">{m.city.toUpperCase()}{m.area ? ` · ${m.area}` : ""}</Badge>
          <Badge tone={m.state === "opted_out" ? "bad" : "neutral"}><span className="dot" style={{ background: STATE_COLOR[m.state] }} />{humanize(m.state)}</Badge>
          {m.minor && <Badge tone="bad" title="Members under 18 are never connected to anyone">under 18 · single-player</Badge>}
          {busy && <Badge tone="warn" title="In an open opportunity: the Network won't double-book">busy</Badge>}
          {controlled && <Badge tone="gold">you're playing</Badge>}
        </div>
        {d?.profile?.occupation && <p className="muted small">{d.profile.occupation}{d.profile.pronouns ? ` · ${d.profile.pronouns}` : ""}{m.joinedAt ? ` · joined ${localDate(m.joinedAt, m.city)}` : ""}</p>}
      </div>
      <div className="kpis compact">
        <Kpi label="proposals" value={m.counters.proposals} />
        <Kpi label="said yes" value={m.counters.accepted} />
        <Kpi label="meetings" value={m.counters.meetings} />
        <Kpi label="enjoyment" value={meanEnj === undefined ? "–" : pct(meanEnj)} />
      </div>
      {game && (
        <div className="actions">
          <button className={picked ? "btn gold" : "btn"} onClick={() => store.togglePick(id)}>{picked ? "Picked ✓" : "Pick for intro"}</button>
          <button className={controlled ? "btn gold" : "btn"} onClick={() => store.control({ type: "takeover", memberId: id, on: !controlled })}>{controlled ? "Let go" : "Play as"}</button>
          <GodMenu id={id} />
        </div>
      )}
      <div className="tabs">
        {(["profile", "graph", "opps", "messages", ...(s.truth ? ["truth"] : [])] as const).map(t => (
          <button key={t} className={tab === t ? "tab active" : "tab"} onClick={() => setTab(t as typeof tab)}>
            {t === "opps" ? `Opportunities${d ? ` ${d.opportunities.length}` : ""}` : t === "messages" ? `Messages${d ? ` ${d.messages.length}` : ""}` : t === "graph" ? `Connections${d ? ` ${d.edges.length}` : ""}` : t === "truth" ? "Hidden truth" : "Profile"}
          </button>
        ))}
      </div>
      {!d ? <div className="muted small pad">Loading…</div> : (
        <div className="tab-body">
          {tab === "profile" && <ProfileTab d={d} />}
          {tab === "graph" && <GraphTab d={d} id={id} />}
          {tab === "opps" && <OppList opps={d.opportunities} me={id} />}
          {tab === "messages" && <Timeline d={d} />}
          {tab === "truth" && <TruthTab d={d} />}
        </div>
      )}
    </div>
  );
}

function GodMenu({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const act = (action: "go_silent" | "force_flake" | "opt_out") => { store.control({ type: "god", action, memberId: id }); setOpen(false); };
  return (
    <div className="menu">
      <button className="btn" onClick={() => setOpen(!open)}>World ▾</button>
      {open && (
        <div className="menu-pop">
          <button onClick={() => act("go_silent")}>Go silent (stops replying)</button>
          <button onClick={() => act("force_flake")}>Flake on next meeting</button>
          <button onClick={() => act("opt_out")}>Text STOP</button>
        </div>
      )}
    </div>
  );
}

function ProfileTab({ d }: { d: MemberDetail }) {
  const byKind = new Map<string, typeof d.facets>();
  for (const f of d.facets) { if (!byKind.has(f.kind)) byKind.set(f.kind, []); byKind.get(f.kind)!.push(f); }
  return (
    <>
      {d.profile?.bio && <p className="bio">{d.profile.bio}</p>}
      <Section title={`Intents · ${d.intents.length}`}>
        {d.intents.length ? d.intents.map(i => (
          <div className="intent" key={i.id}>
            <Badge tone="info">{i.category}</Badge> <b>{i.objective}</b> <Badge tone={i.status === "active" ? "good" : "neutral"}>{i.status}</Badge>
            {i.details && <div className="muted small">{i.details}</div>}
          </div>
        )) : <div className="muted small">No intents yet.</div>}
      </Section>
      <Section title={`What the Network knows · ${d.facets.length} facets`}>
        <div className="legend-row small muted">scope: <Badge tone="good">shareable</Badge><Badge tone="info">matchable</Badge><Badge tone="bad">agent private</Badge></div>
        {[...byKind.entries()].map(([kind, fs]) => (
          <div className="facet-group" key={kind}>
            <div className="facet-kind">{humanize(kind)}</div>
            <div className="facet-list">
              {fs.map(f => (
                <span className={`facet scope-${SCOPE_TONE[f.scope]}`} key={f.id} title={`${f.scope} · ${f.provenance}${f.source ? ` via ${f.source}` : ""} · confidence ${f.confidence}`}>{f.value}</span>
              ))}
            </div>
          </div>
        ))}
      </Section>
      <Section title="Presence">
        {d.presence.map((p, i) => (
          <div className="small" key={i}><Badge>{p.type}</Badge> {p.city.toUpperCase()} {p.areas.join(", ")}{p.from ? ` · ${localDate(p.from)}–${localDate(p.to ?? p.from)}` : ""}</div>
        ))}
      </Section>
    </>
  );
}

function GraphTab({ d, id }: { d: MemberDetail; id: string }) {
  const s = useStore();
  const groups = new Map<string, string[]>();
  for (const e of d.edges) {
    const other = e.from === id ? e.to : e.from;
    const label = e.type === "invited_by" ? (e.to === id ? "invited by" : "invited") : e.type === "vouched_for" ? (e.to === id ? "vouched for by" : "vouched for") : e.type === "blocked" ? (e.from === id ? "blocked" : "blocked by") : humanize(e.type);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(other);
  }
  if (!groups.size) return <div className="muted small">No connections yet.</div>;
  return (
    <>
      {[...groups.entries()].map(([label, ids]) => (
        <Section key={label} title={`${label} · ${ids.length}`}>
          <div className="people">
            {ids.map(o => <button key={o} className="person" onClick={() => store.select({ kind: "member", id: o })}>{s.members.get(o)?.name ?? o}</button>)}
          </div>
        </Section>
      ))}
    </>
  );
}

export function OppList({ opps, me }: { opps: ObsOpportunity[]; me?: string }) {
  const s = useStore();
  if (!opps.length) return <div className="muted small">No opportunities yet.</div>;
  return (
    <div className="opp-list">
      {opps.slice(0, 60).map(o => (
        <button className="opp-row" key={o.id} onClick={() => store.select({ kind: "opportunity", id: o.id })}>
          <span className="dot" style={{ background: OPP_COLOR[o.state] ?? "#7c8799" }} />
          <span className="opp-main">
            <span className="opp-title">{o.participants.filter(x => x !== me).map(x => s.members.get(x)?.name.split(" ")[0] ?? x).join(", ")} <span className="muted">· {humanize(o.kind)}</span></span>
            <span className="muted small">{humanize(o.state)}{me && o.status[me] ? ` · you: ${humanize(o.status[me]!)}` : ""} · {o.source === "engine" ? humanize(o.generator) : o.source}</span>
          </span>
          <span className="muted small">{stamp(o.createdAt)}</span>
        </button>
      ))}
    </div>
  );
}

function Timeline({ d }: { d: MemberDetail }) {
  if (!d.messages.length) return <div className="muted small">No messages yet.</div>;
  return (
    <div className="timeline">
      {d.messages.map(m => (
        <div key={m.id} className={`msg ${m.direction} ${m.system ? "system" : ""}`}>
          <div className="msg-meta">{m.direction === "outbound" ? "Network" : d.member.name.split(" ")[0]} · {stamp(m.ts, d.member.city)}{m.type ? ` · ${humanize(m.type)}` : ""}{m.proactive ? " · proactive" : ""}{m.status !== "delivered" ? ` · ${humanize(m.status)}` : ""}</div>
          <div className="msg-body">{m.body}</div>
        </div>
      ))}
    </div>
  );
}

function TruthTab({ d }: { d: MemberDetail }) {
  const t = d.truth;
  if (!t) return <div className="muted small">Turn on the truth lens to see hidden ground truth.</div>;
  return (
    <>
      <div className="callout warn small">Hidden ground truth: the Network never sees this. Using it marks your score as assisted.</div>
      <div className="kpis compact">
        <Kpi label="archetype" value={humanize(t.archetype)} />
        <Kpi label="true age" value={t.trueAge} tone={t.trueAge < 18 ? "bad" : undefined} />
        <Kpi label="flakiness" value={pct(t.flakiness)} />
        <Kpi label="social energy" value={pct(t.socialEnergy)} />
        <Kpi label="capacity" value={pct(t.capacity)} />
        <Kpi label="honesty" value={pct(t.honesty)} />
      </div>
      {t.adversarial && <div className="callout bad">Adversarial: {humanize(t.adversarial)}</div>}
      <Section title="What they actually want">
        {t.desires.map((x, i) => <div key={i} className="small"><Badge tone="info">{x.category}</Badge> {x.text} <span className="muted">· strength {pct(x.strength)}</span></div>)}
      </Section>
      <Section title="True interests and skills"><div className="facet-list">{[...t.interests, ...t.skills].map(x => <span className="facet" key={x}>{humanize(x)}</span>)}</div></Section>
      <Section title="Boundaries"><div className="small">{t.boundaries.join(" · ") || "none"}</div></Section>
      <Section title="Romance"><div className="small">{t.romanceOptIn ? "open to dating" : "not dating"}</div></Section>
      {t.privateFact && <Section title="Told the agent in confidence"><div className="small private">{t.privateFact}</div></Section>}
      {d.memory && Object.keys(d.memory).length > 0 && (
        <Section title="Private decisions on proposals">
          {Object.entries(d.memory).map(([pid, v]) => <div className="small" key={pid}>{pid.slice(0, 18)}… {v.decision} · plans to show: {v.plannedShow ? "yes" : "no"} · would enjoy {pct(v.enjoyment)}</div>)}
        </Section>
      )}
    </>
  );
}

// ---------------------------------------------------------------- opportunity
function OpportunityPanel({ id }: { id: string }) {
  const s = useStore();
  const live = s.opps.get(id);
  const d = useDetail<OpportunityDetail>(() => store.opportunity(id), [id, s.mode, !!s.truth, live?.state]);
  const o = d?.opportunity ?? live;
  if (!o) return <div className="panel muted">Opportunity not found.</div>;
  const name = (x: string) => s.members.get(x)?.name ?? x;
  const held = o.state === "COMPLETED" || o.state === "FEEDBACK_COLLECTED";
  return (
    <div className="panel">
      <div className="panel-head">
        <div className="eyebrow">{o.source === "engine" ? `engine · ${humanize(o.generator)}` : o.source === "shadow" ? "shadow run · not sent" : o.source === "player" ? "your proposal" : o.source}</div>
        <h2>{humanize(o.kind)}{o.category ? ` · ${o.category}` : ""}</h2>
        <div className="chips">
          <Badge tone={OPEN.has(o.state) ? "info" : held ? "good" : "neutral"}><span className="dot" style={{ background: OPP_COLOR[o.state] ?? "#7c8799" }} />{humanize(o.state)}</Badge>
          <Badge>{o.city.toUpperCase()}</Badge>
          {o.exploration && <Badge tone="warn" title="Picked partly to explore, not only exploit">exploration</Badge>}
          {o.reason && <Badge tone="neutral">{o.reason}</Badge>}
        </div>
        <p className="muted small">“{o.objective}” · proposed {stamp(o.createdAt)}{o.meetingAt ? ` · meeting ${stamp(o.meetingAt, o.city)}` : ""}</p>
      </div>
      <Section title="People">
        {o.participants.map(x => (
          <div className="participant" key={x}>
            <button className="person" onClick={() => store.select({ kind: "member", id: x })}>{name(x)}</button>
            <Badge tone={STATUS_TONE[o.status[x] ?? "pending"]}>{humanize(o.status[x] ?? "pending")}</Badge>
            {o.enjoyment[x] !== undefined && <span className="small">enjoyed {pct(o.enjoyment[x]!)}</span>}
            {o.explanations[x] && <div className="why">Why, as told to them: “{o.explanations[x]}”</div>}
          </div>
        ))}
        {o.alternates.length > 0 && <div className="small muted">Alternates: {o.alternates.map(name).join(", ")}</div>}
      </Section>
      {o.source !== "player" && o.components && (
        <Section title={`Score ${o.score.toFixed(3)}`} right={d?.run ? <button className="link" onClick={() => store.setUI({ drawer: "engine", drawerOpen: true })}>run {d.run.id.slice(0, 8)} →</button> : undefined}>
          <Components c={o.components} />
        </Section>
      )}
      {o.oracle ? (
        <Section title="Ground truth (oracle)">
          <div className={`callout ${o.oracle.unsafe ? "bad" : o.oracle.compatible ? "good" : "warn"} small`}>
            {o.oracle.unsafe ? `Unsafe: ${o.oracle.flags.join(", ")}` : o.oracle.compatible ? "Truly compatible" : "Not a real fit"} · quality {pct(o.oracle.quality)}
          </div>
          {Object.entries(o.oracle.participants).map(([x, p]) => (
            <div className="small" key={x}>{name(x).split(" ")[0]}: accept {pct(p.acceptProb)} · show {pct(p.showProb)} · would enjoy {pct(p.enjoyment)}</div>
          ))}
        </Section>
      ) : s.env?.capabilities.hiddenTruth ? <div className="muted small pad">Ground truth is revealed when this resolves, or with the truth lens.</div> : null}
      {o.feedback?.length ? (
        <Section title="Feedback">{o.feedback.map((f, i) => <div className="small" key={i}><b>{name(f.memberId).split(" ")[0]}:</b> “{f.text}”</div>)}</Section>
      ) : null}
      {d && d.messages.length > 0 && (
        <Section title={`Messages · ${d.messages.length}`}>
          <div className="timeline">
            {d.messages.map(m => (
              <div key={`${m.memberId}-${m.id}`} className={`msg ${m.direction}`}>
                <div className="msg-meta">{m.direction === "outbound" ? `Network → ${name(m.memberId).split(" ")[0]}` : name(m.memberId).split(" ")[0]} · {stamp(m.ts, o.city)}</div>
                <div className="msg-body">{m.body}</div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
