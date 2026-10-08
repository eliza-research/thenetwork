// Right-hand inspector, routed on the focus: Overview (no focus), Member, Opportunity or
// Neighborhood. Lists and names link through MemberLink / OppLink / AreaLink, so a click anywhere
// moves the one focus.
import { CrossAppButton } from "./apps.tsx";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AppProfile360, BookedPlan, HealthAlert, MemberDetail, MemberPhoto, PeonProfile360, SlopProfile360, MemberTimeline, ObsFeedItem, ObsMember, ObsMessage, OpportunityDetail, SystemEvent, TimeChoice } from "../src/types.ts";
import { STATE_COLOR } from "./graph.ts";
import { historyBetween, isBusyElsewhere, ReviewActions, reviewLine, VenueLink, wantsOf } from "./review.tsx";
import { isMemberActive, OPEN, originLabel, originOf, store, useStore, type DrawerTab, type Fetched, type Opp } from "./store.ts";
import {
  ago, AreaLink, Badge, Components, Countdown, Disclosure, dur, humanize, Kpi, MemberLink, num, OppLink, oppDot, pct, Section, sentence, shortDate,
  stamp, StatusLine, useOutsideClose, WallLeft,
} from "./ui.tsx";

const SCOPE_TONE: Record<string, string> = { agent_private: "bad", matchable: "info", shareable: "good", opportunity_specific: "warn" };
const STATUS_TONE: Record<string, string> = {
  accepted: "good", confirmed: "good", attended: "good", countered: "info", declined: "bad", no_show: "bad", ignored: "warn", expired: "warn",
  cancelled_with_notice: "warn", dropped: "neutral", invited: "info", pending: "neutral",
};
/** Participant statuses from the reveal on (the member has seen who it is). */
const REVEALED = new Set(["invited", "accepted", "declined", "countered", "ignored", "expired", "dropped", "confirmed", "attended", "no_show", "cancelled_with_notice"]);
/** Said yes after the reveal (a later no-show or cancellation still said yes). */
const SAID_YES = new Set(["accepted", "confirmed", "attended", "no_show", "cancelled_with_notice"]);
const MET = new Set(["COMPLETED", "FEEDBACK_COLLECTED"]);
const STUCK_MS = 72 * 3_600_000, REQUEST_WAIT_MS = 3 * 86_400_000;
const plural = (n: number, word: string) => `${num(n)} ${word}${n === 1 ? "" : "s"}`;
export const stateLabel = (s: string) => (s === "IN_REVIEW" ? "In review" : sentence(s));

export function Inspector() {
  const s = useStore();
  const f = s.ui.focus;
  return (
    <aside className="inspector">
      {f?.kind === "member" ? <MemberPanel id={f.id} key={f.id} />
        : f?.kind === "opportunity" ? <OpportunityPanel id={f.id} key={f.id} />
        : f?.kind === "neighborhood" ? <NeighborhoodPanel area={f.id} key={f.id} />
        : <Overview />}
    </aside>
  );
}

/** Detail loads are audited staff reads: load on open and when `key` (what the store knows changed) changes, at most every 3 s. No timer. */
const RELOAD_GAP_MS = 3000;
function useLive<T>(load: () => Promise<Fetched<T>>, key: string, deps: unknown[]): Fetched<T> | undefined {
  const [d, setD] = useState<Fetched<T>>();
  const last = useRef(0), prevKey = useRef(key), gen = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const run = () => { const g = gen.current; last.current = Date.now(); load().then(x => { if (g === gen.current) setD(x); }); };
  useEffect(() => { gen.current++; run(); return () => { gen.current++; clearTimeout(timer.current); }; }, deps);
  useEffect(() => {
    if (prevKey.current === key) return;
    prevKey.current = key;
    clearTimeout(timer.current);
    timer.current = setTimeout(run, Math.max(0, RELOAD_GAP_MS - (Date.now() - last.current)));
  }, [key]);
  return d;
}
/** What changes a member's detail: their counters and state, and the opportunities they are in. */
function memberKey(id: string): string {
  const m = store.members.get(id);
  let k = m ? `${m.state}|${m.trust}|${m.counters.msgsIn}|${m.counters.msgsOut}|${m.counters.proposals}|${m.counters.meetings}` : "";
  for (const o of store.opps.values()) if (o.participants.includes(id)) k += `|${o.id}:${o.state}:${o.updatedAt}`;
  return k;
}
const forbidden = (r?: Fetched<unknown>) => r?.status === 403;

// ---------------------------------------------------------------- overview
function Overview() {
  const s = useStore();
  const st = s.stats;
  if (!st) return null;
  const now = s.now();
  const j = s.judge();
  const violations = j?.invariants ?? st.invariantViolations;
  const pending = s.reviewPending();
  const dueSoon = pending.filter(o => o.review && o.review.deadline - now < 3_600_000).length;
  const expired = [...s.opps.values()].filter(o => o.review?.decision === "expired" && s.inRange(o.review.decidedAt ?? o.updatedAt) && s.matchOpp(o, { range: true, stateGroup: true })).length;
  const holds = [...s.members.values()].filter(m => m.trust === "hold" && s.inBorough(m)).length;
  const prompt = s.game?.prompts[0];
  const toReview = (view: "pending" | "decided") => {
    if (s.showReviewTab()) store.setUI({ drawer: "review", drawerOpen: true, reviewView: view });
    else { store.setFilters({ stateGroup: view === "pending" ? "review" : "closed" }); store.setUI({ drawer: "pipeline", drawerOpen: true }); }
  };
  const server = st.alerts;
  const go = (drawer: DrawerTab) => store.setUI({ drawer, drawerOpen: true });
  const alerts: ReactNode[] = server ? [
    s.env?.error && <div className="alert bad" key="err">{s.env.error}</div>,
    ...server.map(a => <AlertLink key={a.key} tone={a.level} onClick={() => alertGo(a, toReview, go)}>{a.text}</AlertLink>),
    holds > 0 && <AlertLink key="hold" tone="bad" onClick={() => { store.setFilters({ members: "hold" }); go("safety"); }}>{plural(holds, "member")} on hold</AlertLink>,
    s.clock?.waitingForPlayer && prompt && <AlertLink key="you" tone="gold" onClick={() => store.focus({ kind: "member", id: prompt.memberId })}>Waiting for you as {s.firstName(prompt.memberId)}</AlertLink>,
  ].filter(Boolean) : [
    s.env?.error && <div className="alert bad" key="err">{s.env.error}</div>,
    violations > 0 && <AlertLink key="inv" tone="bad" onClick={() => store.setUI({ drawer: "safety", drawerOpen: true })}>{plural(violations, "invariant violation")}</AlertLink>,
    !!j?.canaryLeaks && <AlertLink key="canary" tone="bad" onClick={() => store.setUI({ drawer: "safety", drawerOpen: true })}>{plural(j.canaryLeaks, "canary leak")}</AlertLink>,
    !!j?.minorContacts && <AlertLink key="minor" tone="bad" onClick={() => store.setUI({ drawer: "safety", drawerOpen: true })}>{plural(j.minorContacts, "minor contact")}</AlertLink>,
    dueSoon > 0 && <AlertLink key="due" tone="warn" onClick={() => toReview("pending")}>{plural(dueSoon, "review item")} due in &lt; 1h</AlertLink>,
    expired > 0 && <AlertLink key="exp" tone="warn" onClick={() => toReview("decided")}>{expired} expired in review ({s.rangeLabel()})</AlertLink>,
    holds > 0 && <AlertLink key="hold" tone="bad" onClick={() => { store.setFilters({ members: "hold" }); store.setUI({ drawer: "safety", drawerOpen: true }); }}>{plural(holds, "member")} on hold</AlertLink>,
    s.clock?.waitingForPlayer && prompt && <AlertLink key="you" tone="gold" onClick={() => store.focus({ kind: "member", id: prompt.memberId })}>Waiting for you as {s.firstName(prompt.memberId)}</AlertLink>,
  ].filter(Boolean);
  return (
    <div className="panel">
      {alerts.length > 0 && <div className="alert-strip">{alerts}</div>}
      <KpiGrid />
      <NeedsAttention />
    </div>
  );
}

/** Where a server health alert leads. */
function alertGo(a: HealthAlert, toReview: (v: "pending" | "decided") => void, go: (t: DrawerTab) => void) {
  const k = a.key;
  if (k === "review_sla_missed") toReview("decided");
  else if (k.startsWith("review_")) toReview("pending");
  else if (k === "matching_off") go(store.can("analyst") ? "config" : "feed");
  else if (k === "matcher_heartbeat") go("engine");
  else if (k === "deferred_backlog" || k.startsWith("send_refused")) go("feed");
  else if (k.startsWith("service_")) go(store.can("analyst") ? "config" : "feed");
  else go("safety");
}

function AlertLink({ tone, onClick, children }: { tone: string; onClick(): void; children: ReactNode }) {
  return <button type="button" className={`alert ${tone}`} onClick={onClick}>{children} →</button>;
}

/** The six KPIs. With `area` they are scoped to one neighborhood instead of the borough filter. */
function KpiGrid({ area }: { area?: string }) {
  const s = useStore();
  const now = s.now();
  const f = s.ui.filters;
  const inScope = (m?: ObsMember) => !!m && (area ? m.area === area : s.inBorough(m));
  const members = [...s.members.values()].filter(m => inScope(m));
  const originOk = (o: Opp) => f.origin === "all" || originOf(o) === f.origin;
  const opps = [...s.opps.values()].filter(o => o.source !== "shadow" && o.participants.some(id => inScope(s.members.get(id))));
  const active = members.filter(isMemberActive).length;
  const inReview = opps.filter(o => o.state === "IN_REVIEW" && originOk(o));
  const dueSoon = inReview.some(o => o.review && o.review.deadline - now < 3_600_000);
  const reviewOff = s.network?.kind === "stub";
  const proposals = opps.filter(o => originOk(o) && s.inRange(o.createdAt)).length;
  const revealed = opps.filter(o => originOk(o) && s.inRange(o.updatedAt) && o.participants.every(id => REVEALED.has(o.status[id] ?? "")));
  const allYes = revealed.filter(o => o.participants.every(id => SAID_YES.has(o.status[id] ?? ""))).length;
  const yesRate = revealed.length ? allYes / revealed.length : undefined;
  const met = opps.filter(o => MET.has(o.state) && o.meetingAt !== undefined && s.inRange(o.meetingAt)).length;
  const upcoming = opps.filter(o => o.state === "SCHEDULED").length;
  const requests = s.network && !area && f.borough === "all"
    ? s.network.requests.waiting + s.network.requests.probing
    : opps.filter(o => OPEN.has(o.state) && originOf(o) === "request").length;
  const holds = members.filter(m => m.trust === "hold").length;
  const range = s.rangeLabel();
  const go = (patch: Parameters<typeof store.setFilters>[0], drawer?: Parameters<typeof store.setUI>[0]["drawer"]) => {
    store.setFilters(patch);
    if (drawer) store.setUI({ drawer, drawerOpen: true });
  };
  return (
    <div className="kpis six">
      <Kpi label="Active members" value={num(active)} title="Joined, not paused or opted out (current state)" onClick={() => go({ members: "active" })} />
      {reviewOff
        ? <Kpi label={`Proposals · ${range}`} value={num(proposals)} title="Opportunities created in the range" onClick={() => store.setUI({ drawer: "pipeline", drawerOpen: true })} />
        : <Kpi label="In review" value={num(inReview.length)} tone={dueSoon ? "warn" : undefined} title="Waiting for a human reviewer before anyone is contacted (PRD 32.8). Amber: one is due in under 1 h." onClick={() => store.setUI(s.showReviewTab() ? { drawer: "review", drawerOpen: true, reviewView: "pending" } : { drawer: "pipeline", drawerOpen: true })} />}
      <Kpi label="Everyone-yes" value={yesRate === undefined ? "–" : pct(yesRate)} tone={yesRate !== undefined && yesRate >= 0.85 ? "good" : undefined} title={`Of ${revealed.length} opportunities revealed in the range, the share where every participant said yes. Target 85%.`} onClick={() => store.setUI({ drawer: "pipeline", drawerOpen: true })} />
      <Kpi label={`Meetings · ${range}`} value={num(met)} title={`Meetings held in the range. ${upcoming} scheduled.`} onClick={() => go({ stateGroup: "met" }, "pipeline")} />
      <Kpi label="Open requests" value={num(requests)} tone={requests ? "warn" : undefined} title="People requests still being worked on (probing or waiting)" onClick={() => go({ origin: "request" }, "pipeline")} />
      <Kpi label="Safety holds" value={num(holds)} tone={holds ? "bad" : undefined} title="Members on trust hold (never matched until cleared)" onClick={() => go({ members: "hold" }, "safety")} />
    </div>
  );
}

function NeedsAttention({ area }: { area?: string }) {
  const s = useStore();
  const now = s.now();
  const scoped = (o: Opp) => (area ? o.participants.some(id => s.members.get(id)?.area === area) : s.matchOpp(o, { range: true, stateGroup: true }));
  const rows: ReactNode[] = [];
  const seen = new Set<string>();
  for (const o of s.reviewPending().filter(scoped)) {
    if (rows.length >= 5) break;
    seen.add(o.id);
    rows.push(<div className="attn" key={o.id}>{oppDot(o.state)}<OppLink o={o} /><span className="spacer" />{o.review && <Countdown deadline={o.review.deadline} prefix="due in " />}</div>);
  }
  const open = [...s.opps.values()].filter(o => o.source !== "shadow" && OPEN.has(o.state) && o.state !== "IN_REVIEW" && !seen.has(o.id) && scoped(o));
  for (const o of open.filter(o => originOf(o) === "request" && now - o.createdAt > REQUEST_WAIT_MS).sort((a, b) => a.createdAt - b.createdAt)) {
    if (rows.length >= 5) break;
    seen.add(o.id);
    rows.push(<div className="attn" key={o.id}>{oppDot(o.state)}<MemberLink id={o.participants[0]!} /><span className="muted small">request waiting {dur(now - o.createdAt)}</span><span className="spacer" /><OppLink o={o}>open</OppLink></div>);
  }
  for (const o of open.filter(o => o.state !== "SCHEDULED" && !seen.has(o.id) && now - o.updatedAt > STUCK_MS).sort((a, b) => a.updatedAt - b.updatedAt)) {
    if (rows.length >= 5) break;
    rows.push(<div className="attn" key={o.id}>{oppDot(o.state)}<OppLink o={o} /><span className="muted small">{stateLabel(o.state).toLowerCase()} · no update for {dur(now - o.updatedAt)}</span></div>);
  }
  if (!rows.length) return null;
  return <Section title="Needs attention">{rows}</Section>;
}

// ---------------------------------------------------------------- neighborhood
function NeighborhoodPanel({ area }: { area: string }) {
  const s = useStore();
  const members = [...s.members.values()].filter(m => m.area === area);
  const activity = (m: ObsMember) => m.counters.meetings * 2 + m.counters.accepted + m.counters.proposals * 0.2;
  const opps = [...s.opps.values()].filter(o => OPEN.has(o.state) && o.source !== "shadow" && o.participants.some(id => s.members.get(id)?.area === area));
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>{area}</h2>
        <StatusLine parts={[s.borough(area), `${members.length} members`, `${members.filter(isMemberActive).length} active`]} />
      </div>
      <KpiGrid area={area} />
      <NeedsAttention area={area} />
      <Section title={`Open opportunities (${opps.length})`}><OppList opps={opps} /></Section>
      <Section title="Members">
        {members.length ? (
          <div className="people">
            {members.sort((a, b) => activity(b) - activity(a)).slice(0, 60).map(m => (
              <span key={m.id} className="person-row"><MemberLink id={m.id} />{m.minor && <Badge tone="bad">Under 18</Badge>}{m.trust === "hold" ? <Badge tone="bad">Hold</Badge> : m.trust === "watch" ? <Badge tone="warn">Watch</Badge> : null}</span>
            ))}
          </div>
        ) : <div className="muted small">{s.nothing()}</div>}
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------- member
function MemberPanel({ id }: { id: string }) {
  const s = useStore();
  const m = s.members.get(id);
  const grant = s.revealFor(id);
  const key = memberKey(id);
  const res = useLive<MemberDetail>(() => store.member(id), key, [id, s.mode, !!s.truth, grant?.until]);
  const tl = useLive<MemberTimeline>(() => store.timeline(id), key, [id, s.mode, grant?.until]);
  const d = res?.data;
  if (!m) return <div className="panel muted">Member not found.</div>;
  const game = !!s.env?.capabilities.canIntervene && s.canSim();
  const controlled = s.game?.controlled.includes(id);
  const picked = s.ui.picks.includes(id);
  const now = s.now();
  // Live opportunities from the store, plus any older ones only the detail has.
  const oppMap = new Map<string, Opp>();
  for (const o of d?.opportunities ?? []) oppMap.set(o.id, o);
  for (const o of s.opps.values()) if (o.participants.includes(id)) oppMap.set(o.id, o);
  const opps = [...oppMap.values()].filter(o => o.source !== "shadow").sort((a, b) => b.updatedAt - a.updatedAt);
  const open = opps.filter(o => OPEN.has(o.state));
  const past = opps.filter(o => !OPEN.has(o.state));
  const meanEnj = m.counters.enjoymentN ? m.counters.enjoymentSum / m.counters.enjoymentN : undefined;
  const request = open.find(o => originOf(o) === "request" && o.participants[0] === id);
  const prompts = (s.game?.prompts ?? []).filter(p => p.memberId === id);
  const intents = d?.intents ?? [];
  const activeIntents = intents.filter(i => i.status === "active");
  const pastIntents = intents.filter(i => i.status !== "active");
  return (
    <div className="panel">
      <div className="panel-head">
        <div className="title-row">
          <h2>{m.name}</h2>
          {m.minor && (m.ageUnknown
            ? <Badge tone="warn" title="No valid age yet: treated as under 18 until they say. Never matched or introduced.">Age unknown</Badge>
            : <Badge tone="bad" title="Never matched or introduced. Chat and events only.">Under 18</Badge>)}
          {m.trust === "hold" && <Badge tone="bad" title="Trust hold: never matched until cleared">Hold</Badge>}
          {m.trust === "watch" && <Badge tone="warn" title="Trust watch">Watch</Badge>}
          {m.weekly && <Badge tone="info" title="Said WEEKLY: gets &quot;What's your week like?&quot; on Sundays in their send window; the answer counts as their availability for 7 days">Weekly check-in</Badge>}
          {m.calendar && <Badge tone="info" title="Said CALENDAR: free/busy consent recorded. No calendar source is connected yet.">Calendar consent</Badge>}
          <RevealControl id={id} />
          <CrossAppButton memberId={id} />
        </div>
        <StatusLine parts={[
          <AreaLink area={m.area} />,
          <span><span className="dot" style={{ background: STATE_COLOR[m.state] }} />{humanize(m.state)}</span>,
          open.length > 0 && `in ${open.length} open opportunit${open.length > 1 ? "ies" : "y"}`,
          m.joinedAt && `joined ${shortDate(m.joinedAt)}`,
          m.invitedBy && <span>invited by <MemberLink id={m.invitedBy} /></span>,
        ]} />
        <StatusLine parts={[
          `${m.counters.proposals} proposals`, `${m.counters.accepted} yes`, `${m.counters.meetings} met`,
          meanEnj !== undefined && `${pct(meanEnj)} enjoyed`,
        ]} />
      </div>
      {game && (
        <div className="actions">
          <button className={picked ? "btn gold" : "btn"} disabled={m.minor && !picked} title={m.minor ? "Members under 18 are never introduced" : "Pick for an intro (shift-click on the map)"} onClick={() => store.togglePick(id)}>{picked ? "Picked ✓" : "Pick for intro"}</button>
          <button className={controlled ? "btn gold" : "btn"} onClick={() => store.control({ type: "takeover", memberId: id, on: !controlled })}>{controlled ? "Let go" : "Play as"}</button>
          <GodMenu id={id} />
        </div>
      )}
      {(request || activeIntents.length > 0 || pastIntents.length > 0) && (
        <Section title="Wants">
          {request && <div className="intent"><OppLink o={request}><b>Request</b></OppLink> <span className="muted small">· waiting {dur(now - request.createdAt)}</span></div>}
          {activeIntents.map(i => (
            <div className="intent" key={i.id} title={i.details}><b>{i.objective}</b> <span className="muted small">· {i.category} · {dur(Math.max(0, now - i.createdAt))}</span></div>
          ))}
          {pastIntents.length > 0 && (
            <Disclosure name="past-intents" summary={`+${pastIntents.length} past`}>
              {pastIntents.map(i => <div className="intent muted" key={i.id} title={i.details}>{i.objective} <span className="small">· {i.category} · {i.status}</span></div>)}
            </Disclosure>
          )}
        </Section>
      )}
      {(open.length > 0 || prompts.length > 0) && (
        <Section title="Open items">
          {open.length > 0 && <OppList opps={open} me={id} />}
          {prompts.map(p => (
            <div className="attn" key={p.id}><span className="busy gold">waiting for your reply</span><span className="muted small ellipsis">{p.body}</span></div>
          ))}
        </Section>
      )}
      {forbidden(res) ? <div className="muted small">Your role cannot open this member.</div> : !d ? <div className="muted small">{res?.error ?? "Loading…"}</div> : (
        <>
          <Section title="Timeline">{tl?.data ? <MemberTimelineView t={tl.data} d={d} /> : <div className="muted small">{tl?.error ?? "Loading…"}</div>}</Section>
          {past.length > 0 && <Disclosure name="past-opps" summary={`Past opportunities (${past.length})`}><OppList opps={past} me={id} /></Disclosure>}
          <Disclosure name="connections" summary={`Connections (${d.edges.length})`}><Connections d={d} id={id} /></Disclosure>
          <Disclosure name="profile" summary="Profile"><Profile d={d} /></Disclosure>
          <AppSection id={id} />
          <Disclosure name="facts" summary={`Known facts (${d.facets.length})`}><Facts d={d} /></Disclosure>
          {s.truth && d.truth && <Disclosure name="truth" summary="Hidden truth"><Truth d={d} /></Disclosure>}
          {d.staffAccess && (
            <Disclosure name="staff-access" summary={`Staff who opened (${d.staffAccess.length})`}>
              {d.staffAccess.map((a, i) => <div className="small" key={i}>{a.actor.replace(/^token:/, "")} <span className="muted">· {humanize(a.action)} · {stamp(a.at)}</span></div>)}
            </Disclosure>
          )}
        </>
      )}
    </div>
  );
}

function GodMenu({ id }: { id: string }) {
  const s = useStore();
  const key = `god:${id}`;
  const open = s.ui.popover === key;
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(ref, open);
  const act = (action: "go_silent" | "force_flake" | "opt_out") => { store.control({ type: "god", action, memberId: id }); store.setUI({ popover: null }); };
  return (
    <div className="menu" ref={ref}>
      <button className="btn" onClick={() => store.setUI({ popover: open ? null : key })}>World ▾</button>
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

function Profile({ d }: { d: MemberDetail }) {
  const p = d.profile;
  return (
    <>
      {p?.bio && <p className="bio">{p.bio}</p>}
      <StatusLine className="small" parts={[p?.occupation, p?.pronouns, p?.availability]} />
      {d.presence.map((x, i) => (
        <div className="small" key={i}>{humanize(x.type)} · {x.areas.join(", ")}{x.from ? ` · ${shortDate(x.from)}–${shortDate(x.to ?? x.from)}` : ""}</div>
      ))}
    </>
  );
}

function Facts({ d }: { d: MemberDetail }) {
  const byKind = new Map<string, typeof d.facets>();
  for (const f of d.facets) { if (!byKind.has(f.kind)) byKind.set(f.kind, []); byKind.get(f.kind)!.push(f); }
  if (!byKind.size) return <div className="muted small">None.</div>;
  return (
    <>
      {[...byKind.entries()].map(([kind, fs]) => (
        <div className="facet-group" key={kind}>
          <div className="facet-kind">{humanize(kind)}</div>
          <div className="facet-list">
            {fs.map(f => (
              <span className={`facet scope-${SCOPE_TONE[f.scope]}`} key={f.id} title={`${humanize(f.scope)} · ${f.provenance}${f.source ? ` via ${f.source}` : ""} · confidence ${f.confidence}`}>{f.value}</span>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function Connections({ d, id }: { d: MemberDetail; id: string }) {
  const groups = new Map<string, string[]>();
  for (const e of d.edges) {
    const other = e.from === id ? e.to : e.from;
    const label = e.type === "invited_by" ? (e.to === id ? "invited by" : "invited") : e.type === "vouched_for" ? (e.to === id ? "vouched for by" : "vouched for") : e.type === "blocked" ? (e.from === id ? "blocked" : "blocked by") : humanize(e.type);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(other);
  }
  if (!groups.size) return <div className="muted small">None.</div>;
  return (
    <>
      {[...groups.entries()].map(([label, ids]) => (
        <div className="conn-group" key={label}>
          <span className="muted small">{label} ({ids.length})</span>
          <div className="people">{ids.map(o => <MemberLink key={o} id={o} />)}</div>
        </div>
      ))}
    </>
  );
}

export function OppList({ opps, me }: { opps: Opp[]; me?: string }) {
  const s = useStore();
  if (!opps.length) return <div className="muted small">{s.nothing()}</div>;
  return (
    <div className="opp-list">
      {opps.slice(0, 60).map(o => (
        <button className="opp-row" key={o.id} onClick={() => store.focus({ kind: "opportunity", id: o.id })}>
          {oppDot(o.state)}
          <span className="opp-main">
            <span className="opp-title">{me ? o.participants.filter(x => x !== me).map(x => s.firstName(x)).join(", ") : s.oppTitle(o)} <span className="muted">· {humanize(o.kind)}</span></span>
            <StatusLine className="small" parts={[
              stateLabel(o.state).toLowerCase(),
              me && o.status[me] && `you: ${humanize(o.status[me]!)}`,
              originLabel(originOf(o)),
            ]} />
          </span>
          {o.state === "IN_REVIEW" && o.review ? <Countdown deadline={o.review.deadline} /> : <span className="muted small">{ago(o.createdAt)}</span>}
        </button>
      ))}
    </div>
  );
}

type TimelineItem = { t: number; key: string; msg?: ObsMessage & { memberId?: string }; ev?: ObsFeedItem; sys?: SystemEvent };

/** A compact mark per system event type (decisions, probes, refusals, safety, age). */
function eventIcon(e: SystemEvent): string {
  const t = e.type, d = e.detail ?? {};
  if (t === "review_decision") return d.decision === "reject" ? "✕" : d.decision === "reroll" ? "↻" : "✓";
  if (t === "review_expired") return "⧖";
  if (t === "review_invalidated" || t === "review_refused" || t === "send_refused" || t === "send_skipped" || t === "proposal_skipped") return "⊘";
  if (t.startsWith("review")) return "▣";
  if (t.startsWith("probe") || t === "time_answer") return "◌";
  if (t === "send_deferred") return "◷";
  if (t === "gate_reason") return "⊘";
  if (t === "booked_cancelled") return "✕";
  if (t === "availability_offer" || t === "calendar_consent" || t === "weekly_checkin_consent" || t === "checkin_sent" || t === "availability_stated") return "▦";
  if (t === "guard_blocked") return "◈";
  if (t === "trust" || t === "abuse" || t === "safety_flag" || t === "safety_action" || t === "member_blocked") return "⚑";
  if (t.startsWith("age") || t === "minor_signal" || t === "join_declined") return "△";
  if (t.startsWith("request")) return "✦";
  if (t === "meeting_scheduled" || t === "interaction_occurred" || t === "venue") return "◎";
  if (t === "matching_switch" || t === "review_mode") return "≡";
  if (t === "member_accepted") return "✓";
  return "·";
}
/** The leak-check result on an outbound message. */
function GuardMark({ g }: { g?: ObsMessage["guard"] }) {
  if (!g) return null;
  return g === "passed"
    ? <span className="guard ok" title="Leak check passed: sent as written"> · ✓ leak check</span>
    : <span className="guard warn" title="The leak check stopped the first text: this generic version went out"> · leak check: generic sent</span>;
}
/** Messages and feed events in time order: the latest 30, then "Show earlier". */
function TimelineList({ items, who }: { items: TimelineItem[]; who: (m: ObsMessage & { memberId?: string }) => string }) {
  const [n, setN] = useState(30);
  const s = useStore();
  if (!items.length) return <div className="muted small">{s.nothing()}</div>;
  const sorted = items.sort((a, b) => a.t - b.t);
  const shown = sorted.slice(-n);
  return (
    <div className="timeline">
      {sorted.length > n && <button className="link small" onClick={() => setN(n + 30)}>Show earlier ({sorted.length - n})</button>}
      {shown.map(x => x.msg ? (
        <div key={x.key} className={`msg ${x.msg.direction} ${x.msg.system ? "system" : ""}`}>
          <div className="msg-meta">{who(x.msg)} · {stamp(x.msg.ts)}{x.msg.type ? ` · ${humanize(x.msg.type)}` : ""}{x.msg.proactive ? <span className="proactive" title="Proactive: the Network started this"> · proactive</span> : null}{x.msg.status !== "delivered" ? ` · ${humanize(x.msg.status)}` : ""}<GuardMark g={x.msg.guard} /></div>
          <div className={`msg-body ${x.msg.hiddenLength !== undefined ? "muted" : ""}`}>{x.msg.body}{x.msg.hiddenLength !== undefined ? ` · ${x.msg.hiddenLength} chars` : ""}</div>
          {x.msg.timeOptions && <TimeChips offered={x.msg.timeOptions} />}
          {x.msg.booked && <div className="small muted">Booked for {stamp(x.msg.booked.at)} · silence for {x.msg.booked.optOutHours} h counts as yes; &quot;can't&quot; cancels</div>}
        </div>
      ) : x.sys ? (
        <div key={x.key} className={`tl-event sev-${x.sys.severity ?? "info"}`} title={x.sys.detail ? Object.entries(x.sys.detail).map(([k, v]) => `${k}: ${v}`).join(" · ") : x.sys.type}>
          <span className="tl-icon" aria-hidden>{eventIcon(x.sys)}</span><span className="muted">{stamp(x.sys.t)}</span> {x.sys.text}
          {x.sys.opportunityId && store.opps.has(x.sys.opportunityId) && !(store.ui.focus?.kind === "opportunity" && store.ui.focus.id === x.sys.opportunityId) && <> <OppLink o={store.opps.get(x.sys.opportunityId)!}>→</OppLink></>}
        </div>
      ) : (
        <div key={x.key} className={`tl-event sev-${x.ev!.severity ?? "info"}`}><span className="muted">{stamp(x.ev!.t)} · {humanize(x.ev!.kind)}</span> {x.ev!.text}</div>
      ))}
    </div>
  );
}

/** Messages and what the system did for this member, in time order (GET /api/member/:id/timeline), then sends waiting for their window. */
function MemberTimelineView({ t, d }: { t: MemberTimeline; d: MemberDetail }) {
  const items: TimelineItem[] = t.entries.map((e, i) => e.kind === "message"
    ? { t: e.t, key: `m${e.message.id}`, msg: e.message }
    : { t: e.t, key: `e${i}-${e.event.type}`, sys: e.event });
  const waiting = new Map<string, number>();
  for (const p of t.pending) { const k = humanize(p.type ?? p.kind); waiting.set(k, (waiting.get(k) ?? 0) + 1); }
  return (
    <>
      <TimelineList items={items} who={m => (m.direction === "outbound" ? "Network" : d.member.name.split(" ")[0]!)} />
      {waiting.size > 0 && <div className="small muted" title="Deferred to the member's sending window">Waiting to send: {[...waiting].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join(", ")}</div>}
    </>
  );
}

/** The times a message offered, with the picks marked (keys a, b, c). */
function TimeChips({ offered, picked }: { offered: TimeChoice[]; picked?: string[] }) {
  return (
    <span className="time-chips">
      {offered.map(x => {
        const on = picked?.includes(x.key);
        return <span key={x.key} className={`chip small ${on ? "active" : picked ? "muted" : ""}`} title={stamp(x.start)}><kbd>{x.key}</kbd> {x.label}{on ? " ✓" : ""}</span>;
      })}
    </span>
  );
}

/**
 * The booked plan per member: when it reached them, and their opt-out window (48 hours, or until the
 * meeting if sooner; silence after that counts as confirmed), or that they called it off.
 */
function BookedPlanView({ o, b }: { o: Opp; b: BookedPlan }) {
  const s = useStore();
  const now = s.now();
  return (
    <>
      <div className="small">Booked for {stamp(b.at)}{o.venue ? <> at <VenueLink venue={o.venue} /></> : null}. Each member can say they can't within {b.optOutHours} h; silence is a yes.</div>
      {o.participants.map(x => {
        const told = b.told[x], off = b.cancelled[x];
        const closes = told === undefined ? undefined : Math.min(told + b.optOutHours * 3_600_000, b.at);
        return (
          <div className="small participant" key={x}>
            <MemberLink id={x} first />
            {off ? <Badge tone="warn" title={off.told ? "They told us they can't make it" : "They dropped out without replying to us"}>called off {stamp(off.at)}{off.told ? "" : " · silently"}</Badge>
              : told === undefined ? <span className="muted">not told yet</span>
              : closes! > now ? <span><span className="muted">told {stamp(told)} · opt-out closes </span><Countdown deadline={closes!} prefix="in " what="Opt-out window closes" /></span>
              : <Badge tone="good" title="The opt-out window passed: silence counts as confirmed">confirmed</Badge>}
          </div>
        );
      })}
    </>
  );
}

/** Per-member PII reveal (admin-console 4.4): safety and admin, real mode, a reason, at most 15 minutes, logged before it is granted. */
function RevealControl({ id }: { id: string }) {
  const s = useStore();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [minutes, setMinutes] = useState(15);
  if (!s.can("safety") || s.env?.capabilities.hiddenTruth || s.env?.piiRevealed) return null;
  const g = s.revealFor(id);
  if (g) return <><Badge tone="warn" title={`Revealed: ${g.reason}`}>Revealed · <WallLeft until={g.until} /></Badge><button className="btn small-btn" title="End the reveal now (logged)" onClick={() => store.unreveal(id)}>End</button></>;
  if (!open) return <button className="btn small-btn" title="Show names and this member's own words for up to 15 minutes. Logged." onClick={() => setOpen(true)}>Reveal</button>;
  const submit = async () => { if (reason.trim().length >= 5 && await store.reveal(id, reason.trim(), minutes)) { setOpen(false); setReason(""); } };
  return (
    <form className="reveal-form" onSubmit={e => { e.preventDefault(); submit(); }}>
      <input className="input grow" autoFocus placeholder="Reason (logged)" value={reason} onChange={e => setReason(e.target.value)} onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } }} />
      <select className="input" value={minutes} onChange={e => setMinutes(Number(e.target.value))} aria-label="Minutes">{[5, 10, 15].map(n => <option key={n} value={n}>{n} min</option>)}</select>
      <button className="btn primary" type="submit" disabled={reason.trim().length < 5} title="At least 5 characters">Reveal</button>
      <button className="btn ghost" type="button" onClick={() => setOpen(false)}>Cancel</button>
    </form>
  );
}

// ---------------------------------------------------------------- per-app Member 360 (admin-console 3.3.1)
/** The app's own panel: slop (dating preferences behind a reveal, the photo rule) or peon (roles, applications). */
function AppSection({ id }: { id: string }) {
  const s = useStore();
  const grant = s.revealFor(id);
  const has = s.app === "slop" || s.app === "peon";
  // Only the apps with a panel ask (each ask is an audited read).
  const r = useLive<AppProfile360>(() => (has ? store.memberApp(id) : Promise.resolve({ status: 200 as const, data: { app: s.app, none: true as const } })), memberKey(id), [id, s.mode, s.app, grant?.until]);
  const p = r?.data;
  if (!has || !p || "none" in p) return null;
  return p.app === "slop"
    ? <Disclosure name="app-slop" summary="Dating (slop)"><SlopPanel id={id} p={p} /></Disclosure>
    : <Disclosure name="app-peon" summary={`Hiring (peon) · ${(p as PeonProfile360).applications.length} introductions`}><PeonPanel p={p as PeonProfile360} /></Disclosure>;
}

const PHOTO_TEXT: Record<SlopProfile360["photos"], string> = {
  never_minor: "No photos: this member is under 18 or has no verified age. Photos and ratings are for verified adults only.",
  needs_verification: "No photos until the member's age (18+) is verified.",
  reason_required: "Photos: admin or safety, with a reason (logged).",
};

function SlopPanel({ id, p }: { id: string; p: SlopProfile360 }) {
  const s = useStore();
  const [reason, setReason] = useState("");
  const [photos, setPhotos] = useState<MemberPhoto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const show = async () => {
    const r = await store.photos(id, reason.trim());
    if (r.data?.photos) { setPhotos(r.data.photos); setError(null); } else setError(r.error ?? r.data?.error ?? "refused");
  };
  return (
    <>
      <div className="small">{p.adult ? "Adult" : "Under 18 or age unknown: never matched"} · age {p.ageVerified ? "verified" : "not verified"}</div>
      {p.prefs.hidden
        ? <div className="muted small">Dating preferences hidden ({p.prefs.count} facts). {s.env?.capabilities.hiddenTruth ? "Simulated world: the truth lens shows hidden facts." : s.can("safety") ? "Reveal this member (logged) to see them." : "Safety or admin only."}</div>
        : <SlopPrefsView prefs={p.prefs.prefs} />}
      <div className="muted small">{PHOTO_TEXT[p.photos]} Scores and ratings are never shown.</div>
      {p.photos === "reason_required" && s.can("safety") && !photos && (
        <form className="person-reason" onSubmit={e => { e.preventDefault(); if (reason.trim().length >= 5) show(); }}>
          <input className="input grow" placeholder="Reason (logged)" value={reason} onChange={e => setReason(e.target.value)} aria-label="Reason to see photos" />
          <button className="btn" type="submit" disabled={reason.trim().length < 5}>Show photos</button>
          {error && <span className="bad small" role="alert">{error}</span>}
        </form>
      )}
      {photos && (photos.length
        ? <div className="photos">{photos.map(ph => <img key={ph.id} src={ph.url} alt="Member photo" referrerPolicy="no-referrer" loading="lazy" />)}</div>
        : <div className="muted small">No photos.</div>)}
    </>
  );
}

function SlopPrefsView({ prefs }: { prefs: NonNullable<Extract<SlopProfile360["prefs"], { hidden: false }>["prefs"]> }) {
  const rows: [string, string | undefined][] = [
    ["Is", prefs.is], ["Seeks", prefs.seeks.join(", ") || undefined], ["Age range", prefs.ageRange?.join("-")],
    ["Where", [prefs.scope, prefs.maxMiles !== undefined ? `${prefs.maxMiles} mi` : undefined].filter(Boolean).join(" · ") || undefined], ["Goal", prefs.goal],
    ["Values", Object.entries(prefs.values).map(([k, v]) => `${humanize(k)}: ${v}`).join(" · ") || undefined],
    ["Dealbreakers", prefs.dealbreakers.map(humanize).join(", ") || undefined], ["First dates", prefs.activities.map(humanize).join(", ") || undefined],
    ["Usually free", prefs.free.join(", ") || undefined], ["Verification", prefs.verification.join(", ") || undefined], ["Safety cues", prefs.safety.join(", ") || undefined],
  ];
  return <>{rows.filter(([, v]) => v).map(([k, v]) => <div className="small" key={k}><span className="muted">{k}</span> {v}</div>)}</>;
}

function PeonPanel({ p }: { p: PeonProfile360 }) {
  const s = useStore();
  return (
    <>
      <div className="small">{p.entity === "job" ? "Job seat (hiring manager)" : p.entity === "candidate" ? "Candidate" : "Not set up yet"}</div>
      {p.roles.map((r, i) => (
        <div className="small" key={i}>
          <b>{r.title ?? humanize(r.family ?? "role")}</b>
          <span className="muted">{[r.family && r.title ? humanize(r.family) : undefined, r.seniority !== undefined ? `level ${r.seniority}` : undefined, r.pay, r.mode, r.market?.toUpperCase(), r.openings !== undefined ? `${r.openings} open` : undefined, r.verified === undefined ? undefined : r.verified ? "employer verified" : "employer not verified"].filter(Boolean).map(x => ` · ${x}`).join("")}</span>
        </div>
      ))}
      {p.applications.length
        ? p.applications.map(a => <div className="small" key={a.opportunityId}>{s.opps.has(a.opportunityId) ? <OppLink o={s.opps.get(a.opportunityId)!} /> : a.opportunityId} <span className="muted">· {humanize(a.state)}{a.status ? ` · ${humanize(a.status)}` : ""}</span></div>)
        : <div className="muted small">No introductions yet.</div>}
    </>
  );
}

function Truth({ d }: { d: MemberDetail }) {
  const t = d.truth!;
  return (
    <>
      <div className="small">
        {humanize(t.archetype)} · <span className={t.trueAge < 18 ? "bad" : ""}>{t.trueAge}</span> · flaky {pct(t.flakiness)} · energy {pct(t.socialEnergy)} · capacity {pct(t.capacity)} · honest {pct(t.honesty)}
      </div>
      {t.adversarial && <div className="callout bad small">Adversarial: {humanize(t.adversarial)}</div>}
      <Section title="What they actually want">
        {t.desires.map((x, i) => <div key={i} className="small">{x.text} <span className="muted">· {x.category} · strength {pct(x.strength)}</span></div>)}
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
  const res = useLive<OpportunityDetail>(() => store.opportunity(id), `${live?.state}|${live?.updatedAt}|${live?.review?.decision}|${live?.participants.join(",")}`, [id, s.mode, !!s.truth]);
  const d = res?.data;
  // The store copy is the freshest (review state); the detail can carry more (the oracle under the lens).
  const o: Opp | undefined = live && d?.opportunity ? { ...d.opportunity, ...live, oracle: live.oracle ?? d.opportunity.oracle } : live ?? d?.opportunity;
  if (!o) return <div className="panel muted">Opportunity not found.</div>;
  const resolved = !OPEN.has(o.state);
  const shadow = o.source === "shadow";
  const showActions = o.state === "IN_REVIEW" && s.reviewMode() === "human" && s.canReview();
  const hist = historyBetween(o);
  // The full event history (oldest first) when the server sends it; else the feed items in memory.
  const items: TimelineItem[] = [
    ...(d?.messages ?? []).map(m => ({ t: m.ts, key: `m${m.memberId}-${m.id}`, msg: m })),
    ...(d?.events
      ? d.events.map((e, i) => ({ t: e.t, key: `e${i}-${e.type}`, sys: e }))
      : s.feed.filter(x => x.kind !== "message" && x.opportunityId === id).map(x => ({ t: x.t, key: `f${x.seq}`, ev: x }))),
  ];
  const now = s.now();
  const statusParts: ReactNode[] = [
    <span>{oppDot(o.state)}{stateLabel(o.state)}{!resolved && o.stateSince !== undefined ? <span title="Time in this state"> · {dur(Math.max(0, now - o.stateSince))}</span> : null}</span>,
    shadow ? "Shadow · not sent" : originLabel(originOf(o)),
    humanize(o.kind), o.category, resolved ? `open ${dur(Math.max(0, o.updatedAt - o.createdAt))}` : ago(o.createdAt),
    resolved && o.reason && o.state !== "REJECTED_IN_REVIEW" && humanize(o.reason),
  ];
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>{s.oppTitle(o)}</h2>
        <StatusLine parts={statusParts} />
        {o.review && <div className="status-line">{reviewLine(o)}</div>}
      </div>
      {showActions && <ReviewActions o={o} />}
      <Section title="People">
        {o.participants.map(x => {
          const m = s.members.get(x);
          const want = wantsOf(o, x);
          return (
            <div className="participant" key={x}>
              <MemberLink id={x} />
              <Badge tone={STATUS_TONE[o.status[x] ?? "pending"]}>{humanize(o.status[x] ?? "pending")}</Badge>
              {o.enjoyment[x] !== undefined && <span className="small">enjoyed {pct(o.enjoyment[x]!)}</span>}
              {m?.minor && <Badge tone="bad" title="Members under 18 are never introduced. This must not happen.">Under 18</Badge>}
              {OPEN.has(o.state) && isBusyElsewhere(o, x) && <Badge tone="warn" title="In another open opportunity">busy</Badge>}
              {m?.trust === "hold" ? <Badge tone="bad">Hold</Badge> : m?.trust === "watch" ? <Badge tone="warn">Watch</Badge> : null}
              {want && <div className="small full"><span className="muted">wants:</span> {want}</div>}
              {o.explanations[x] && <div className="why" title="Shown to this member">“{o.explanations[x]}”</div>}
            </div>
          );
        })}
      </Section>
      <Section title="Plan">
        <div className="small">“{o.objective}”</div>
        <StatusLine className="small" parts={[o.venue && <VenueLink venue={o.venue} />, o.meetingAt && stamp(o.meetingAt)]} />
      </Section>
      {o.times && Object.keys(o.times).length > 0 && (
        <Section title="Times">
          {o.participants.filter(x => o.times![x]).map(x => {
            const t = o.times![x]!;
            return (
              <div className="small time-row" key={x}>
                <MemberLink id={x} first />{" "}
                {t.offered.length ? <TimeChips offered={t.offered} picked={t.picked} /> : null}
                <span className="muted">{t.picked === undefined ? " · no answer yet" : t.picked.length ? (t.offered.length ? "" : ` · picked ${t.picked.join(", ")}`) : " · none of these fit"}</span>
              </div>
            );
          })}
        </Section>
      )}
      {o.booked && <Section title="Booked plan"><BookedPlanView o={o} b={o.booked} /></Section>}
      {o.feedback?.length ? (
        <Section title="Feedback">{o.feedback.map((f, i) => <div className="small" key={i}><MemberLink id={f.memberId} first />: “{f.text}”</div>)}</Section>
      ) : null}
      {forbidden(res) && <div className="muted small">Your role cannot open this opportunity's messages.</div>}
      <Section title="History">
        <TimelineList items={items} who={m => (m.direction === "outbound" ? `Network → ${s.firstName(m.memberId ?? "")}` : s.firstName(m.memberId ?? ""))} />
      </Section>
      {o.source !== "player" && o.components && (
        <Disclosure name="score" summary={<>Score {o.score.toFixed(2)}{d?.run ? <> · <button className="mlink" onClick={e => { e.preventDefault(); store.setUI({ drawer: "engine", drawerOpen: true }); }}>run {d.run.id.slice(0, 4)} →</button></> : null}</>}>
          {o.exploration && <div className="small muted" title="Picked partly to explore, not only exploit">exploration</div>}
          <Components c={o.components} />
        </Disclosure>
      )}
      {o.alternates.length > 0 && (
        <Disclosure name="alternates" summary={`Alternates (${o.alternates.length})`}>
          <div className="people">{o.alternates.map(a => <MemberLink key={a} id={a} />)}</div>
        </Disclosure>
      )}
      {o.oracle && (
        <details className="disclosure" open={!!s.truth || resolved}>
          <summary>Oracle</summary>
          <div className={`callout ${o.oracle.unsafe ? "bad" : o.oracle.compatible ? "good" : "warn"} small`}>
            {o.oracle.unsafe ? `Unsafe: ${o.oracle.flags.join(", ")}` : o.oracle.compatible ? "Truly compatible" : "Not a real fit"} · quality {pct(o.oracle.quality)}
          </div>
          {Object.entries(o.oracle.participants).map(([x, p]) => (
            <div className="small" key={x}>{s.firstName(x)}: accept {pct(p.acceptProb)} · show {pct(p.showProb)} · would enjoy {pct(p.enjoyment)}</div>
          ))}
        </details>
      )}
      {hist.length > 0 && (
        <Disclosure name="history" summary={`History between them (${hist.length})`}>
          <OppList opps={hist} />
        </Disclosure>
      )}
    </div>
  );
}
