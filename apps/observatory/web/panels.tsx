// spec/consoleNavigation.md, "Focus on a new subject keeps the last one in a short history"
// spec/consoleWorkspace.md, "Each panel shows a loading, refused, unavailable, failed, empty or full view"
// spec/consoleWorkspace.md, "The world menu exists only in the simulated world"
// spec/consoleWorkspace.md, "A reveal needs real data, the safety role and a reason"
// spec/consoleWorkspace.md, "A reveal ends early on request or when its time passes"
// spec/consoleMemberView.md, "The timeline shows recorded delivery and leak evidence for the exact message"
import { CrossAppButton } from "./apps.tsx";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { ScoreComponents } from "@thenetwork/core";
import {
  Alert, AreaLink as AreaLinkView, Button, cn, Countdown as CountdownView, Disclosure as DisclosureView, FactLine, InspectorSection, Input, Kpi,
  KpiGrid as KpiGridView, MemberLink as MemberLinkView, MeterBars, OpportunityLink, Popover, PopoverContent, PopoverTrigger, RevealControl, StatusMark, StatusRow,
  type KpiTone, type StatusTone,
} from "@thenetwork/ui";
import { canTogglePick, type Subject } from "../../../packages/core/src/generated/consoleNavigation.ts";
import { initial as initialDetail, staffPhotoAllowed, staffPhotoReasonReady, staffPhotoView, step as stepDetail } from "../../../packages/core/src/generated/consoleMemberView.ts";
import {
  canCloseWorldMenu, canOpenWorldMenu, canSendWorldEvent, canSubmitReveal, canStartReveal, closeWorldMenu, initial as initialWorkspace, openWorldMenu, panelView,
  receiveViewer, revealOffered, sendWorldEvent, step as stepWorkspace, worldMenuShown, type Event as WorkspaceEvent, type PanelAnswer, type PanelView, type RevealForm, type WorkMode, type WorkPanel,
  type Workspace, type WorldEvent,
} from "../../../packages/core/src/generated/consoleWorkspace.ts";
import type { AppProfile360, BookedPlan, BusinessProfile360, DatingProfile360, DeliveryReason, HealthAlert, MemberDetail, MemberPhoto, MemberTimeline, ObsFeedItem, ObsMember, ObsMessage, OpportunityDetail, SystemEvent, TimeChoice } from "../src/types.ts";
import { historyBetween, isBusyElsewhere, ReviewActions, reviewLine, VenueLink, wantsOf, workChannelLabel } from "./review.tsx";
import { isMemberActive, INACTIVE_PARTICIPANT_STATUS, OPEN, originLabel, originOf, store, useStore, type DrawerTab, type Fetched, type Focus, type Opp } from "./store.ts";
import { ago, COMPONENT_SIGN, consoleNav, dur, hasScoreParts, humanize, jumpTo, num, pct, pickMember, sentence, shortDate, stamp } from "./ui.tsx";

const TONE: Record<string, StatusTone> = { bad: "destructive", warn: "warn", good: "ok", info: "primary", gold: "primary", neutral: "neutral" };
const tone = (word: string | undefined): StatusTone => TONE[word ?? "neutral"] ?? "neutral";
const SCOPE_TONE: Record<string, string> = { agent_private: "bad", matchable: "info", shareable: "good", opportunity_specific: "warn" };
const STATUS_TONE: Record<string, string> = {
  accepted: "good", confirmed: "good", attended: "good", countered: "info", declined: "bad", no_show: "bad", ignored: "warn", expired: "warn",
  cancelled_with_notice: "warn", dropped: "neutral", invited: "info", pending: "neutral",
};
const MEMBER_STATE_TONE: Record<string, StatusTone> = { opted_out: "destructive", paused: "neutral", not_joined: "neutral", receiving: "warn" };
const OPP_STATE_TONE: Record<string, StatusTone> = { IN_REVIEW: "warn", MUTUALLY_ACCEPTED: "ok", QUORUM_MET: "ok", SCHEDULED: "ok" };
const SEVERITY_TEXT: Record<string, string> = { bad: "text-destructive", warn: "text-warn", good: "text-ok" };
/** Participant statuses from the reveal on (the member has seen who it is). */
const REVEALED = new Set(["invited", "accepted", "declined", "countered", "ignored", "expired", "dropped", "confirmed", "attended", "no_show", "cancelled_with_notice"]);
/** Said yes after the reveal (a later no-show or cancellation still said yes). */
const SAID_YES = new Set(["accepted", "confirmed", "attended", "no_show", "cancelled_with_notice"]);
const MET = new Set(["COMPLETED", "FEEDBACK_COLLECTED"]);
const STUCK_MS = 72 * 3_600_000, REQUEST_WAIT_MS = 3 * 86_400_000;
const plural = (n: number, word: string) => `${num(n)} ${word}${n === 1 ? "" : "s"}`;
export const stateLabel = (s: string) => (s === "IN_REVIEW" ? "In review" : sentence(s));

const SUBJECT: Record<NonNullable<Focus>["kind"], Subject> = { member: "MemberSubject", opportunity: "OpportunitySubject", neighborhood: "NeighborhoodSubject" };
const panelClass = "flex min-w-0 flex-col gap-4";
const headClass = "flex flex-col gap-1";
const titleClass = "text-lg font-semibold text-foreground";
const quiet = "text-sm text-muted-foreground";
const peopleClass = "flex flex-wrap gap-x-3 gap-y-1 text-sm";
const rowClass = "flex flex-wrap items-center gap-2 text-sm";

/** The inspector beside the stage: the overview, or the neighborhood, member or opportunity that has the focus. */
export function Inspector() {
  const s = useStore();
  const f = s.ui.focus;
  const subject: Subject = f ? SUBJECT[f.kind] : "Overview";
  return (
    <div className={panelClass}>
      {subject === "MemberSubject" ? <MemberPanel id={f!.id} key={f!.id} />
        : subject === "OpportunitySubject" ? <OpportunityPanel id={f!.id} key={f!.id} />
        : subject === "NeighborhoodSubject" ? <NeighborhoodPanel area={f!.id} key={f!.id} />
        : <Overview />}
    </div>
  );
}

/** The workspace model of this viewer, from the generated `receiveViewer`: the mode for work and the roles. */
function useWorkspace(): Workspace {
  const s = useStore();
  const mode: WorkMode = s.mode === "game" || s.env?.capabilities.hiddenTruth ? "SimulatedWorld" : s.canAct() ? "RealWithService" : "RealWithoutService";
  return receiveViewer(initialWorkspace, mode, s.can("safety"), s.isAdmin(), s.can("analyst"), s.canSim(), !!s.env?.piiRevealed);
}

/** The panel answer of a staff read: none yet, a refusal, rows or a failure. */
function answerOf(r?: Fetched<unknown>): PanelAnswer {
  return !r ? "NotAnswered" : r.status === 403 ? "AnswerForbidden" : r.data !== undefined ? "AnswerRows" : "AnswerFailed";
}
/** The inspector details read like the requests panel: no 404 view of their own. */
const DETAIL_PANEL: WorkPanel = "RequestsPanel";
const detailView = (r?: Fetched<unknown>): PanelView => panelView(DETAIL_PANEL, answerOf(r), 1);

/** A member name that moves the focus to the member. */
function MemberLink({ id, first, children }: { id: string; first?: boolean; children?: ReactNode }) {
  const m = store.members.get(id);
  const name = m ? (first ? m.name.split(" ")[0] : m.name) : id;
  return <MemberLinkView onOpen={() => store.focus({ kind: "member", id })}>{children ?? name}</MemberLinkView>;
}
/** An opportunity name ("Maya + Jon") that moves the focus to the opportunity. */
function OppLink({ o, children }: { o: Opp; children?: ReactNode }) {
  return <OpportunityLink onOpen={() => store.focus({ kind: "opportunity", id: o.id })}>{children ?? store.oppTitle(o)}</OpportunityLink>;
}
/** A neighborhood name that moves the focus to the neighborhood. */
function AreaLink({ area }: { area?: string }) {
  if (!area) return null;
  return <AreaLinkView onOpen={() => store.focus({ kind: "neighborhood", id: area })}>{area}</AreaLinkView>;
}
/** The state of an opportunity as a colored shape. */
function OppMark({ state }: { state: string }) {
  return <StatusMark tone={OPP_STATE_TONE[state] ?? (OPEN.has(state) ? "primary" : "neutral")} label={stateLabel(state)} />;
}
/** The time left to a deadline on the console clock. */
function Countdown({ deadline, prefix, what }: { deadline: number; prefix?: string; what?: string }) {
  return <CountdownView deadline={deadline} now={store.now()} prefix={prefix} what={what} deadlineLabel={stamp(deadline)} />;
}
/** A disclosure whose open state stays for this viewer (localStorage obs.disclosure.<name>). Its content renders only while it is open. */
function Disclosure({ name, summary, children, defaultOpen = false }: { name: string; summary: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const key = `obs.disclosure.${name}`;
  const [open, setOpen] = useState<boolean>(() => {
    try { const v = localStorage.getItem(key); return v === null ? defaultOpen : v === "1"; } catch { return defaultOpen; }
  });
  return (
    <DisclosureView summary={summary} open={open} onOpenChange={o => {
      setOpen(o);
      try { localStorage.setItem(key, o ? "1" : "0"); } catch { return; }
    }}>
      {open ? children : null}
    </DisclosureView>
  );
}

/** Detail loads are audited staff reads: load on open and when `key` (what the store knows changed) changes, at most every 3 s. No timer. */
const RELOAD_GAP_MS = 3000;
function useDetailGate() {
  const gate = useRef(initialDetail);
  const begin = () => {
    gate.current = stepDetail(gate.current, { type: "beginDetail" });
    return gate.current.lastTicket;
  };
  const cancel = () => { gate.current = stepDetail(gate.current, { type: "cancelDetails" }); };
  const finish = (readTicket: number) => {
    const next = stepDetail(gate.current, { type: "finishDetail", readTicket });
    if (next === gate.current) return false;
    gate.current = next;
    return true;
  };
  return { begin, cancel, finish };
}

const detailScope = (...parts: unknown[]) => JSON.stringify([store.app, store.mode, store.authEpoch, ...parts]);

function useLive<T>(load: () => Promise<Fetched<T>>, key: string, scopeOf: () => string): Fetched<T> | undefined {
  const scope = scopeOf();
  const [d, setD] = useState<{ scope: string; value: Fetched<T> }>();
  const last = useRef(0), prevKey = useRef(key);
  const detail = useDetailGate();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const run = () => {
    const ticket = detail.begin();
    last.current = Date.now();
    load().then(value => {
      if (scope === scopeOf() && detail.finish(ticket)) setD({ scope, value });
    });
  };
  useLayoutEffect(() => {
    run();
    return () => { detail.cancel(); clearTimeout(timer.current); };
  }, [scope]);
  useEffect(() => {
    if (prevKey.current === key) return;
    prevKey.current = key;
    clearTimeout(timer.current);
    timer.current = setTimeout(run, Math.max(0, RELOAD_GAP_MS - (Date.now() - last.current)));
  }, [key]);
  return d?.scope === scope ? d.value : undefined;
}
/** What changes a member's detail: their counters and state, and the opportunities they are in. */
function memberKey(id: string): string {
  const m = store.members.get(id);
  let k = m ? `${m.state}|${m.trust}|${m.counters.msgsIn}|${m.counters.msgsOut}|${m.counters.proposals}|${m.counters.meetings}` : "";
  for (const o of store.opps.values()) if (o.participants.includes(id)) k += `|${o.id}:${o.state}:${o.updatedAt}`;
  return k;
}

/** The overview: alerts, the six numbers and what needs attention. */
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
  const holds = [...s.members.values()].filter(m => m.trust === "hold" && s.inBorough(m) && s.matchMemberDomain(m)).length;
  const prompt = s.game?.prompts[0];
  const toReview = (view: "pending" | "decided") => {
    if (jumpTo("review")) store.setUI({ reviewView: view });
    else { store.setFilters({ stateGroup: view === "pending" ? "review" : "closed" }); jumpTo("pipeline"); }
  };
  const server = st.alerts;
  const go = (drawer: DrawerTab) => store.setUI({ drawer, drawerOpen: true });
  const alerts: ReactNode[] = server ? [
    s.env?.error && <Alert variant="destructive" key="err">{s.env.error}</Alert>,
    ...server.map(a => <AlertLink key={a.key} tone={a.level} onClick={() => alertGo(a, toReview, go)}>{a.text}</AlertLink>),
    holds > 0 && <AlertLink key="hold" tone="bad" onClick={() => { store.setFilters({ members: "hold" }); go("safety"); }}>{plural(holds, "member")} on hold</AlertLink>,
    s.clock?.waitingForPlayer && prompt && <AlertLink key="you" tone="gold" onClick={() => store.focus({ kind: "member", id: prompt.memberId })}>Waiting for you as {s.firstName(prompt.memberId)}</AlertLink>,
  ].filter(Boolean) : [
    s.env?.error && <Alert variant="destructive" key="err">{s.env.error}</Alert>,
    violations > 0 && <AlertLink key="inv" tone="bad" onClick={() => store.setUI({ drawer: "safety", drawerOpen: true })}>{plural(violations, "invariant violation")}</AlertLink>,
    !!j?.canaryLeaks && <AlertLink key="canary" tone="bad" onClick={() => store.setUI({ drawer: "safety", drawerOpen: true })}>{plural(j.canaryLeaks, "canary leak")}</AlertLink>,
    !!j?.minorContacts && <AlertLink key="minor" tone="bad" onClick={() => store.setUI({ drawer: "safety", drawerOpen: true })}>{plural(j.minorContacts, "minor contact")}</AlertLink>,
    dueSoon > 0 && <AlertLink key="due" tone="warn" onClick={() => toReview("pending")}>{plural(dueSoon, "review item")} due in &lt; 1h</AlertLink>,
    expired > 0 && <AlertLink key="exp" tone="warn" onClick={() => toReview("decided")}>{expired} expired in review ({s.rangeLabel()})</AlertLink>,
    holds > 0 && <AlertLink key="hold" tone="bad" onClick={() => { store.setFilters({ members: "hold" }); store.setUI({ drawer: "safety", drawerOpen: true }); }}>{plural(holds, "member")} on hold</AlertLink>,
    s.clock?.waitingForPlayer && prompt && <AlertLink key="you" tone="gold" onClick={() => store.focus({ kind: "member", id: prompt.memberId })}>Waiting for you as {s.firstName(prompt.memberId)}</AlertLink>,
  ].filter(Boolean);
  return (
    <>
      {alerts.length > 0 && <div className="flex flex-col gap-2">{alerts}</div>}
      <KpiGrid />
      <NeedsAttention />
    </>
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

/** One alert that opens the place to act on it. */
function AlertLink({ tone: word, onClick, children }: { tone: string; onClick(): void; children: ReactNode }) {
  const t = tone(word);
  return (
    <Button variant="outline" size="sm" className="h-auto justify-start py-2 text-left whitespace-normal" onClick={onClick}>
      <StatusMark tone={t} label={word === "bad" ? "Alert" : word === "warn" ? "Warning" : "Note"} />
      <span>{children} →</span>
    </Button>
  );
}

const KPI_TONE: Record<string, KpiTone> = { good: "ok", warn: "warn", bad: "destructive" };

/** The six KPIs. With `area` they are scoped to one neighborhood instead of the borough filter. */
function KpiGrid({ area }: { area?: string }) {
  const s = useStore();
  const now = s.now();
  const f = s.ui.filters;
  const inScope = (m?: ObsMember) => !!m && (area ? m.area === area : s.inBorough(m)) && s.matchMemberDomain(m);
  const members = [...s.members.values()].filter(m => inScope(m));
  const originOk = (o: Opp) => f.origin === "all" || originOf(o) === f.origin;
  const opps = [...s.opps.values()].filter(o => o.source !== "shadow" && s.matchOppDomain(o) && o.participants.some(id => inScope(s.members.get(id))));
  const active = members.filter(isMemberActive).length;
  const inReview = opps.filter(o => o.state === "IN_REVIEW" && originOk(o));
  const dueSoon = inReview.some(o => o.review && o.review.deadline - now < 3_600_000);
  const reviewOff = s.network?.kind === "stub";
  const proposals = opps.filter(o => originOk(o) && s.inRange(o.createdAt)).length;
  const revealed = opps.filter(o => originOk(o) && s.inRange(o.updatedAt) && o.participants.every(id => REVEALED.has(o.status[id] ?? "")));
  const allYes = revealed.filter(o => o.participants.every(id => SAID_YES.has(o.status[id] ?? ""))).length;
  const yesRate = revealed.length ? allYes / revealed.length : undefined;
  const met = opps.filter(o => originOk(o) && MET.has(o.state) && o.meetingAt !== undefined && s.inRange(o.meetingAt)).length;
  const upcoming = opps.filter(o => o.state === "SCHEDULED").length;
  const requests = s.network && !area && f.borough === "all" && s.allDomainsSelected()
    ? s.network.requests.waiting + s.network.requests.probing
    : s.requests.length
      ? s.requests.filter(r => (r.outcome === "probing" || r.outcome === "none" || r.outcome === "open") && s.matchRequestDomain(r) && inScope(s.members.get(r.memberId))).length
      : opps.filter(o => OPEN.has(o.state) && originOf(o) === "request").length;
  const holds = members.filter(m => m.trust === "hold").length;
  const range = s.rangeLabel();
  const go = (patch: Parameters<typeof store.setFilters>[0], drawer?: Parameters<typeof store.setUI>[0]["drawer"]) => {
    store.setFilters(patch);
    if (drawer) store.setUI({ drawer, drawerOpen: true });
  };
  return (
    <KpiGridView>
      <Kpi label="Active members" value={num(active)} title="Joined, not paused or opted out (current state)" onSelect={() => go({ members: "active" })} />
      {reviewOff
        ? <Kpi label={`Proposals · ${range}`} value={num(proposals)} title="Opportunities created in the range" onSelect={() => store.setUI({ drawer: "pipeline", drawerOpen: true })} />
        : <Kpi label="In review" value={num(inReview.length)} tone={dueSoon ? KPI_TONE.warn : undefined} title="Waiting for a human reviewer before anyone is contacted (PRD 32.8). Amber: one is due in under 1 h." onSelect={() => (jumpTo("review") ? store.setUI({ reviewView: "pending" }) : jumpTo("pipeline"))} />}
      <Kpi label="Everyone-yes" value={yesRate === undefined ? "–" : pct(yesRate)} tone={yesRate !== undefined && yesRate >= 0.85 ? KPI_TONE.good : undefined} title={`Of ${revealed.length} opportunities revealed in the range, the share where every participant said yes. Target 85%.`} onSelect={() => store.setUI({ drawer: "pipeline", drawerOpen: true })} />
      <Kpi label={`Meetings · ${range}`} value={num(met)} title={`Meetings held in the range. ${upcoming} scheduled.`} onSelect={() => go({ stateGroup: "met" }, "pipeline")} />
      <Kpi label="Open requests" value={num(requests)} tone={requests ? KPI_TONE.warn : undefined} title="People requests still being worked on (probing or waiting)" onSelect={() => go({ origin: "request" }, "pipeline")} />
      <Kpi label="Safety holds" value={num(holds)} tone={holds ? KPI_TONE.bad : undefined} title="Members on trust hold (never matched until cleared)" onSelect={() => go({ members: "hold" }, "safety")} />
    </KpiGridView>
  );
}

/** At most five items to act on: review due, requests that wait, opportunities with no update. */
function NeedsAttention({ area }: { area?: string }) {
  const s = useStore();
  const now = s.now();
  const scoped = (o: Opp) => (area ? o.participants.some(id => s.members.get(id)?.area === area) && s.matchOppDomain(o) : s.matchOpp(o, { range: true, stateGroup: true }));
  const rows: ReactNode[] = [];
  const seen = new Set<string>();
  for (const o of s.reviewPending().filter(scoped)) {
    if (rows.length >= 5) break;
    seen.add(o.id);
    rows.push(<div className={rowClass} key={o.id}><OppMark state={o.state} /><OppLink o={o} />{o.review && <span className="ml-auto"><Countdown deadline={o.review.deadline} prefix="due in " /></span>}</div>);
  }
  const open = [...s.opps.values()].filter(o => o.source !== "shadow" && OPEN.has(o.state) && o.state !== "IN_REVIEW" && !seen.has(o.id) && scoped(o));
  for (const o of open.filter(o => originOf(o) === "request" && now - o.createdAt > REQUEST_WAIT_MS).sort((a, b) => a.createdAt - b.createdAt)) {
    if (rows.length >= 5) break;
    seen.add(o.id);
    rows.push(<div className={rowClass} key={o.id}><OppMark state={o.state} /><MemberLink id={o.participants[0]!} /><span className="text-muted-foreground">request waiting {dur(now - o.createdAt)}</span><span className="ml-auto"><OppLink o={o}>open</OppLink></span></div>);
  }
  for (const o of open.filter(o => o.state !== "SCHEDULED" && !seen.has(o.id) && now - o.updatedAt > STUCK_MS).sort((a, b) => a.updatedAt - b.updatedAt)) {
    if (rows.length >= 5) break;
    rows.push(<div className={rowClass} key={o.id}><OppMark state={o.state} /><OppLink o={o} /><span className="text-muted-foreground">{stateLabel(o.state).toLowerCase()} · no update for {dur(now - o.updatedAt)}</span></div>);
  }
  if (!rows.length) return null;
  return <InspectorSection title="Needs attention">{rows}</InspectorSection>;
}

/** The trust level of a member as a colored shape, or nothing when there is no hold or watch. */
function TrustMark({ trust }: { trust?: string }) {
  if (trust === "hold") return <StatusMark tone="destructive" label="Hold" showLabel title="Trust hold: never matched until cleared" />;
  if (trust === "watch") return <StatusMark tone="warn" label="Watch" showLabel title="Trust watch" />;
  return null;
}

/** One neighborhood: its numbers, what needs attention, its open opportunities and its members. */
function NeighborhoodPanel({ area }: { area: string }) {
  const s = useStore();
  const members = [...s.members.values()].filter(m => m.area === area && s.matchMemberDomain(m));
  const activity = (m: ObsMember) => m.counters.meetings * 2 + m.counters.accepted + m.counters.proposals * 0.2;
  const opps = [...s.opps.values()].filter(o => OPEN.has(o.state) && o.source !== "shadow" && s.matchOppDomain(o) && o.participants.some(id => s.members.get(id)?.area === area));
  return (
    <>
      <div className={headClass}>
        <h2 className={titleClass}>{area}</h2>
        <FactLine parts={[s.borough(area, members[0]?.city ?? s.activeCity()), `${members.length} members`, `${members.filter(isMemberActive).length} active`]} />
      </div>
      <KpiGrid area={area} />
      <NeedsAttention area={area} />
      <InspectorSection title={`Open opportunities (${opps.length})`}><OppList opps={opps} /></InspectorSection>
      <InspectorSection title="Members">
        {members.length ? (
          <div className={peopleClass}>
            {members.sort((a, b) => activity(b) - activity(a)).slice(0, 60).map(m => (
              <span key={m.id} className="inline-flex items-center gap-1"><MemberLink id={m.id} />{m.minor && <StatusMark tone="destructive" label="Under 18" />}<TrustMark trust={m.trust} /></span>
            ))}
          </div>
        ) : <p className={quiet}>{s.nothing()}</p>}
      </InspectorSection>
    </>
  );
}

/** One member: the facts, the controls, what they want, open items, the timeline and the detail behind disclosures. */
function MemberPanel({ id }: { id: string }) {
  const s = useStore();
  const m = s.members.get(id);
  const key = memberKey(id);
  const res = useLive<MemberDetail>(() => store.member(id), key, () => detailScope(id, !!store.truth, store.revealFor(id)?.until));
  const tl = useLive<MemberTimeline>(() => store.timeline(id), key, () => detailScope(id, store.revealFor(id)?.until));
  const d = res?.data;
  if (!m) return <p className={quiet}>Member not found.</p>;
  const game = !!s.env?.capabilities.canIntervene && s.canSim();
  const controlled = s.game?.controlled.includes(id);
  const picked = s.ui.picks.includes(id);
  const now = s.now();
  const oppMap = new Map<string, Opp>();
  for (const o of d?.opportunities ?? []) oppMap.set(o.id, o);
  for (const o of s.opps.values()) if (o.participants.includes(id)) oppMap.set(o.id, o);
  const opps = [...oppMap.values()].filter(o => o.source !== "shadow").sort((a, b) => b.updatedAt - a.updatedAt);
  const open = opps.filter(o => OPEN.has(o.state) && !INACTIVE_PARTICIPANT_STATUS.has(o.status[id] ?? "pending") && !o.booked?.cancelled[id]);
  const past = opps.filter(o => !OPEN.has(o.state) || INACTIVE_PARTICIPANT_STATUS.has(o.status[id] ?? "pending") || !!o.booked?.cancelled[id]);
  const meanEnj = m.counters.enjoymentN ? m.counters.enjoymentSum / m.counters.enjoymentN : undefined;
  const request = open.find(o => originOf(o) === "request" && o.participants[0] === id);
  const prompts = (s.game?.prompts ?? []).filter(p => p.memberId === id);
  const intents = d?.intents ?? [];
  const activeIntents = intents.filter(i => i.status === "active");
  const pastIntents = intents.filter(i => i.status !== "active");
  const view = detailView(res);
  return (
    <>
      <div className={headClass}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className={titleClass}>{m.name}</h2>
          {m.minor && (m.ageUnknown
            ? <StatusMark tone="warn" label="Age unknown" showLabel title="No valid age yet: treated as under 18 until they say. Never matched or introduced." />
            : <StatusMark tone="destructive" label="Under 18" showLabel title="Never matched or introduced. Chat and events only." />)}
          <TrustMark trust={m.trust} />
          {m.weekly && <StatusMark tone="primary" label="Weekly check-in" showLabel title="Said WEEKLY: gets &quot;What's your week like?&quot; on Sundays in their send window; the answer counts as their availability for 7 days" />}
          {m.calendar && <StatusMark tone="primary" label="Calendar consent" showLabel title="Said CALENDAR: free/busy consent recorded. No calendar source is connected yet." />}
          <MemberReveal id={id} />
          <CrossAppButton memberId={id} />
        </div>
        <FactLine parts={[
          <AreaLink area={m.area} />,
          <StatusMark tone={MEMBER_STATE_TONE[m.state] ?? "ok"} label={humanize(m.state)} showLabel />,
          open.length > 0 && `in ${open.length} open opportunit${open.length > 1 ? "ies" : "y"}`,
          m.joinedAt && `joined ${shortDate(m.joinedAt)}`,
          m.invitedBy && <span>invited by <MemberLink id={m.invitedBy} /></span>,
        ]} />
        <FactLine parts={[
          `${m.counters.proposals} proposals`, `${m.counters.accepted} yes`, `${m.counters.meetings} met`,
          meanEnj !== undefined && `${pct(meanEnj)} enjoyed`,
        ]} />
      </div>
      {game && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant={picked ? "primary" : "outline"} size="sm" disabled={!canTogglePick(consoleNav(), picked, !!m.minor)} title={m.minor ? "Members under 18 are never introduced" : "Pick for an intro (shift-click on the map)"} onClick={() => pickMember(id)}>{picked ? "Picked ✓" : "Pick for intro"}</Button>
          <Button variant={controlled ? "primary" : "outline"} size="sm" onClick={() => store.control({ type: "takeover", memberId: id, on: !controlled })}>{controlled ? "Let go" : "Play as"}</Button>
          <WorldMenu id={id} />
        </div>
      )}
      {(request || activeIntents.length > 0 || pastIntents.length > 0) && (
        <InspectorSection title="Wants">
          {request && <div className="text-sm"><OppLink o={request}><b>Request</b></OppLink> <span className="text-muted-foreground">· waiting {dur(now - request.createdAt)}</span></div>}
          {activeIntents.map(i => (
            <div className="text-sm" key={i.id} title={i.details}><b>{i.objective}</b> <span className="text-muted-foreground">· {i.category} · {dur(Math.max(0, now - i.createdAt))}</span></div>
          ))}
          {pastIntents.length > 0 && (
            <Disclosure name="past-intents" summary={`+${pastIntents.length} past`}>
              {pastIntents.map(i => <div className="text-muted-foreground" key={i.id} title={i.details}>{i.objective} · {i.category} · {i.status}</div>)}
            </Disclosure>
          )}
        </InspectorSection>
      )}
      {(open.length > 0 || prompts.length > 0) && (
        <InspectorSection title="Open items">
          {open.length > 0 && <OppList opps={open} me={id} />}
          {prompts.map(p => (
            <div className={cn(rowClass, "flex-nowrap")} key={p.id}><StatusMark tone="primary" label="waiting for your reply" showLabel /><span className="min-w-0 truncate text-muted-foreground">{p.body}</span></div>
          ))}
        </InspectorSection>
      )}
      {view === "PanelForbidden" ? <p className={quiet}>Your role cannot open this member.</p> : view !== "PanelRows" || !d ? <StatusRow view={view} error={res?.error} /> : (
        <>
          <InspectorSection title="Timeline">
            {tl?.data && detailView(tl) === "PanelRows" ? <MemberTimelineView t={tl.data} d={d} /> : <StatusRow view={detailView(tl)} error={tl?.error} />}
          </InspectorSection>
          {past.length > 0 && <Disclosure name="past-opps" summary={`Past opportunities (${past.length})`}><OppList opps={past} me={id} /></Disclosure>}
          <Disclosure name="connections" summary={`Connections (${d.edges.length})`}><Connections d={d} id={id} /></Disclosure>
          <Disclosure name="profile" summary="Profile"><Profile d={d} /></Disclosure>
          <AppSection id={id} />
          <Disclosure name="facts" summary={`Known facts (${d.facets.length})`}><Facts d={d} /></Disclosure>
          {s.truth && d.truth && <Disclosure name="truth" summary="Hidden truth"><Truth d={d} /></Disclosure>}
          {d.staffAccess && (
            <Disclosure name="staff-access" summary={`Staff who opened (${d.staffAccess.length})`}>
              {d.staffAccess.map((a, i) => <div key={i}>{a.actor.replace(/^token:/, "")} <span className="text-muted-foreground">· {humanize(a.action)} · {stamp(a.at)}</span></div>)}
            </Disclosure>
          )}
        </>
      )}
    </>
  );
}

const WORLD_EVENTS: { event: WorldEvent; action: "go_silent" | "force_flake" | "opt_out"; label: string }[] = [
  { event: "GoSilent", action: "go_silent", label: "Go silent (stops replying)" },
  { event: "ForceFlake", action: "force_flake", label: "Flake on next meeting" },
  { event: "TextStop", action: "opt_out", label: "Text STOP" },
];

/** The world menu of a simulated member: go silent, flake or text STOP. Its open state is the store popover, so Escape closes it first. */
function WorldMenu({ id }: { id: string }) {
  const s = useStore();
  const staff = useWorkspace();
  const key = `god:${id}`;
  const open = s.ui.popover === key;
  const w: Workspace = { ...staff, worldMenuOpen: open };
  if (!worldMenuShown(w.staff)) return null;
  const keep = (next: Workspace) => store.setUI({ popover: next.worldMenuOpen ? key : null });
  const act = (event: WorldEvent, action: "go_silent" | "force_flake" | "opt_out") => {
    if (!canSendWorldEvent(w, event)) return;
    store.control({ type: "god", action, memberId: id });
    keep(sendWorldEvent(w, event));
  };
  const toggle = (wantOpen: boolean) => {
    if (wantOpen ? canOpenWorldMenu(w) : canCloseWorldMenu(w)) keep(wantOpen ? openWorldMenu(w) : closeWorldMenu(w));
  };
  return (
    <Popover open={open} onOpenChange={toggle}>
      <PopoverTrigger asChild><Button variant="outline" size="sm">World ▾</Button></PopoverTrigger>
      <PopoverContent align="start" aria-label="World" className="w-auto gap-1 p-1">
        {WORLD_EVENTS.map(x => <Button key={x.event} variant="ghost" size="sm" className="justify-start" onClick={() => act(x.event, x.action)}>{x.label}</Button>)}
      </PopoverContent>
    </Popover>
  );
}

/** A wall-clock time that changes every 15 s while `on`: reveals end in real time, not in simulated time. */
function useWallClock(on: boolean): number {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!on) return;
    const h = setInterval(() => tick(x => x + 1), 15_000);
    return () => clearInterval(h);
  }, [on]);
  return Date.now();
}

/** Per-member PII reveal (admin-console 4.4): the generated reveal form over the store's grants. The server grant is the truth; a grant past its time shows as hidden. */
function MemberReveal({ id }: { id: string }) {
  const s = useStore();
  const staff = useWorkspace();
  const [form, setForm] = useState<RevealForm>(initialWorkspace.reveal);
  const [reason, setReason] = useState("");
  const grant = s.revealFor(id);
  const now = useWallClock(!!grant);
  const shown: RevealForm = grant ? { ...form, phase: "RevealGranted" } : form.phase === "RevealGranted" ? stepWorkspace({ ...staff, reveal: form }, { type: "expireReveal" }).reveal : form;
  const w: Workspace = { ...staff, reveal: shown };
  if (!revealOffered(w.staff)) return null;
  const send = (e: WorkspaceEvent) => setForm(stepWorkspace(w, e).reveal);
  const submit = async () => {
    if (!canSubmitReveal(w)) return;
    const sending = stepWorkspace(w, { type: "submitReveal" });
    setForm(sending.reveal);
    const granted = await store.reveal(id, reason.trim(), sending.reveal.minutes);
    setForm(stepWorkspace(sending, { type: "receiveRevealAnswer", granted }).reveal);
    if (granted) setReason("");
  };
  const left = grant ? grant.until - now : 0;
  return (
    <RevealControl
      reveal={shown}
      canStart={canStartReveal(w)}
      canSubmit={canSubmitReveal(w)}
      reason={reason}
      onReasonChange={r => { setReason(r); send({ type: "typeRevealReason", reasonChars: r.trim().length }); }}
      onMinutesChange={minutes => send({ type: "chooseRevealMinutes", minutes })}
      onStart={() => send({ type: "startReveal" })}
      onSubmit={submit}
      onCancel={() => send({ type: "cancelReveal" })}
      onEnd={() => { store.unreveal(id); send({ type: "endReveal" }); }}
      minutesLeft={grant ? (left <= 0 ? 0 : Math.max(1, Math.ceil(left / 60_000))) : undefined}
      grantedReason={grant?.reason}
    />
  );
}

/** The member's own profile: bio, work, pronouns, availability and where they spend time. */
function Profile({ d }: { d: MemberDetail }) {
  const p = d.profile;
  return (
    <div className="flex flex-col gap-1">
      {p?.bio && <p className="text-foreground">{p.bio}</p>}
      <FactLine parts={[p?.occupation, p?.pronouns, p?.availability]} />
      {d.presence.map((x, i) => (
        <div key={i}>{humanize(x.type)} · {x.areas.join(", ")}{x.from ? ` · ${shortDate(x.from)}–${shortDate(x.to ?? x.from)}` : ""}</div>
      ))}
    </div>
  );
}

/** The known facts by kind; the shape and color of each fact is its scope. */
function Facts({ d }: { d: MemberDetail }) {
  const byKind = new Map<string, typeof d.facets>();
  for (const f of d.facets) { if (!byKind.has(f.kind)) byKind.set(f.kind, []); byKind.get(f.kind)!.push(f); }
  if (!byKind.size) return <p className={quiet}>None.</p>;
  return (
    <div className="flex flex-col gap-2">
      {[...byKind.entries()].map(([kind, fs]) => (
        <div key={kind} className="flex flex-col gap-1">
          <div className="font-medium text-muted-foreground">{humanize(kind)}</div>
          <ul className="flex flex-wrap gap-x-3 gap-y-1">
            {fs.map(f => (
              <li className="inline-flex items-center gap-1" key={f.id} title={`${humanize(f.scope)} · ${f.provenance}${f.source ? ` via ${f.source}` : ""} · confidence ${f.confidence}`}>
                <StatusMark tone={tone(SCOPE_TONE[f.scope])} label={humanize(f.scope)} />{f.value}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** The member's connections by type: invited, vouched for, blocked. */
function Connections({ d, id }: { d: MemberDetail; id: string }) {
  const groups = new Map<string, string[]>();
  for (const e of d.edges) {
    const other = e.from === id ? e.to : e.from;
    const label = e.type === "invited_by" ? (e.to === id ? "invited by" : "invited") : e.type === "vouched_for" ? (e.to === id ? "vouched for by" : "vouched for") : e.type === "blocked" ? (e.from === id ? "blocked" : "blocked by") : humanize(e.type);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(other);
  }
  if (!groups.size) return <p className={quiet}>None.</p>;
  return (
    <div className="flex flex-col gap-2">
      {[...groups.entries()].map(([label, ids]) => (
        <div key={label} className="flex flex-col gap-1">
          <span className="text-muted-foreground">{label} ({ids.length})</span>
          <div className={peopleClass}>{ids.map(o => <MemberLink key={o} id={o} />)}</div>
        </div>
      ))}
    </div>
  );
}

/** A list of opportunities; a row opens the opportunity. With `me`, the names are the other people and the status is this member's. */
export function OppList({ opps, me }: { opps: Opp[]; me?: string }) {
  const s = useStore();
  if (!opps.length) return <p className={quiet}>{s.nothing()}</p>;
  return (
    <ul className="flex flex-col">
      {opps.slice(0, 60).map(o => (
        <li key={o.id}>
          <Button variant="ghost" className="h-auto w-full justify-start px-2 py-1 text-left font-normal whitespace-normal" onClick={() => store.focus({ kind: "opportunity", id: o.id })}>
            <OppMark state={o.state} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-medium text-foreground">{me ? o.participants.filter(x => x !== me).map(x => s.firstName(x)).join(", ") : s.oppTitle(o)} <span className="font-normal text-muted-foreground">· {humanize(o.kind)}</span></span>
              <FactLine parts={[
                stateLabel(o.state).toLowerCase(),
                me && o.status[me] && `you: ${humanize(o.status[me]!)}`,
                originLabel(originOf(o)),
              ]} />
            </span>
            {o.state === "IN_REVIEW" && o.review ? <Countdown deadline={o.review.deadline} /> : <span className={quiet}>{ago(o.createdAt)}</span>}
          </Button>
        </li>
      ))}
    </ul>
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
  const mark = guardMarks[g];
  return <StatusMark tone={mark.tone} label={mark.label} showLabel title={mark.description} />;
}
const guardMarks: Record<NonNullable<ObsMessage["guard"]>, { tone: StatusTone; label: string; description: string }> = {
  passed: { tone: "ok", label: "Leak check passed", description: "The body passed the leak check before a delivery attempt." },
  fallback: { tone: "warn", label: "Generic fallback", description: "The leak check stopped the first text and a generic replacement was used." },
  blocked: { tone: "destructive", label: "Stopped by leak check", description: "The leak check stopped this body." },
  released: { tone: "warn", label: "Released by staff", description: "Staff released this body from leak review." },
};
const deliveryReason: Record<DeliveryReason, string> = {
  line_paused: "Shared line paused", recipient_cap: "Recipient send cap", line_cap: "Shared line send cap", new_conversation_cap: "New conversation cap",
  awaiting_admission: "Waiting for send admission", earlier_attempt: "Retry after an earlier attempt", reply_window: "Reply window closed",
  plan_availability_changed: "Plan availability changed", eligibility: "Eligibility check refused", expired_or_stale: "Deadline passed or plan changed",
  sending_not_approved: "Sending approval missing", no_send_consent: "Send consent unavailable", person_cap: "Person send cap", quiet_hours: "Quiet hours",
  awaiting_reply: "Waiting for a reply", leak_guard: "Leak review required", invalid_timezone: "Time zone unavailable",
  membership_unavailable: "Membership unavailable", acceptance_unknown: "Provider acceptance unconfirmed", provider_refused: "Provider refused delivery",
  dispatch_error: "Dispatch could not complete", accepted_by_provider: "Provider accepted",
};
const impliedReason: Partial<Record<string, DeliveryReason>> = {
  accepted: "accepted_by_provider", deferred_quiet_hours: "quiet_hours", held_awaiting_reply: "awaiting_reply",
  parked_leak_review: "leak_guard", dropped_leak_review: "leak_guard",
};
/** Messages and feed events in time order: the latest 30, then "Show earlier". */
function TimelineList({ items, who }: { items: TimelineItem[]; who: (m: ObsMessage & { memberId?: string }) => string }) {
  const [n, setN] = useState(30);
  const s = useStore();
  if (!items.length) return <p className={quiet}>{s.nothing()}</p>;
  const sorted = items.sort((a, b) => a.t - b.t);
  const shown = sorted.slice(-n);
  return (
    <div className="flex flex-col gap-2 text-sm">
      {sorted.length > n && <Button variant="ghost" size="sm" className="self-start" onClick={() => setN(n + 30)}>Show earlier ({sorted.length - n})</Button>}
      {shown.map(x => x.msg ? (
        <div key={x.key} className={cn("flex flex-col gap-1 rounded-md p-2", x.msg.direction === "outbound" ? "bg-muted" : "border border-border", x.msg.system && "text-muted-foreground")}>
          <div className="flex flex-wrap items-center gap-x-1 text-muted-foreground">
            {who(x.msg)} · {stamp(x.msg.ts)}{x.msg.type ? ` · ${humanize(x.msg.type)}` : ""}
            {x.msg.proactive ? <span title="Proactive: the Network started this"> · proactive</span> : null}
            {x.msg.status !== "delivered" ? ` · ${humanize(x.msg.status)}` : ""}
            {x.msg.deliveryReason && x.msg.deliveryReason !== impliedReason[x.msg.status] ? ` · ${deliveryReason[x.msg.deliveryReason]}` : ""}
            <GuardMark g={x.msg.guard} />
          </div>
          <div className={cn("whitespace-pre-wrap", x.msg.hiddenLength !== undefined ? "text-muted-foreground" : "text-foreground")}>{x.msg.body}{x.msg.hiddenLength !== undefined ? ` · ${x.msg.hiddenLength} chars` : ""}</div>
          {x.msg.timeOptions && <TimeChoices offered={x.msg.timeOptions} />}
          {x.msg.booked && <div className="text-muted-foreground">Booked for {stamp(x.msg.booked.at)} · silence for {x.msg.booked.optOutHours} h counts as yes; &quot;can't&quot; cancels</div>}
        </div>
      ) : x.sys ? (
        <div key={x.key} className={SEVERITY_TEXT[x.sys.severity ?? "info"] ?? "text-foreground"} title={x.sys.detail ? Object.entries(x.sys.detail).map(([k, v]) => `${k}: ${v}`).join(" · ") : x.sys.type}>
          <span className="mr-1" aria-hidden>{eventIcon(x.sys)}</span><span className="text-muted-foreground">{stamp(x.sys.t)}</span> {x.sys.text}
          {x.sys.opportunityId && store.opps.has(x.sys.opportunityId) && !(store.ui.focus?.kind === "opportunity" && store.ui.focus.id === x.sys.opportunityId) && <> <OppLink o={store.opps.get(x.sys.opportunityId)!}>→</OppLink></>}
        </div>
      ) : (
        <div key={x.key} className={SEVERITY_TEXT[x.ev!.severity ?? "info"] ?? "text-foreground"}><span className="text-muted-foreground">{stamp(x.ev!.t)} · {humanize(x.ev!.kind)}</span> {x.ev!.text}</div>
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
      {waiting.size > 0 && <p className={quiet} title="Deferred to the member's sending window">Waiting to send: {[...waiting].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join(", ")}</p>}
    </>
  );
}

/** The times a message offered, with the picks marked (keys a, b, c). */
function TimeChoices({ offered, picked }: { offered: TimeChoice[]; picked?: string[] }) {
  return (
    <span className="inline-flex flex-wrap gap-x-3 gap-y-1 text-sm">
      {offered.map(x => {
        const on = picked?.includes(x.key);
        return (
          <span key={x.key} className={cn("inline-flex items-center gap-1", on ? "font-medium text-foreground" : "text-muted-foreground")} title={stamp(x.start)}>
            <kbd className="font-mono">{x.key}</kbd> {x.label}{on && <StatusMark tone="ok" label="picked" />}
          </span>
        );
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
      <div className="text-sm">Booked for {stamp(b.at)}{o.venue ? <> at <VenueLink venue={o.venue} /></> : null}. Each member can say they can't within {b.optOutHours} h; silence is a yes.</div>
      {o.participants.map(x => {
        const told = b.told[x], off = b.cancelled[x];
        const closes = told === undefined ? undefined : Math.min(told + b.optOutHours * 3_600_000, b.at);
        return (
          <div className={rowClass} key={x}>
            <MemberLink id={x} first />
            {off ? <StatusMark tone="warn" showLabel label={`called off ${stamp(off.at)}${off.told ? "" : " · silently"}`} title={off.told ? "They told us they can't make it" : "They dropped out without replying to us"} />
              : told === undefined ? <span className="text-muted-foreground">not told yet</span>
              : closes! > now ? <span><span className="text-muted-foreground">told {stamp(told)} · opt-out closes </span><Countdown deadline={closes!} prefix="in " what="Opt-out window closes" /></span>
              : <StatusMark tone="ok" showLabel label="confirmed" title="The opt-out window passed: silence counts as confirmed" />}
          </div>
        );
      })}
    </>
  );
}

/** Domain-specific Member 360 disclosures: Dating (preferences behind a reveal, photo gate) and Business (roles, introductions). */
function AppSection({ id }: { id: string }) {
  const s = useStore();
  const supportsDomains = s.app === "ntwrk" || s.app === "slop" || s.app === "peon";
  const r = useLive<AppProfile360>(
    () => (supportsDomains ? store.memberApp(id) : Promise.resolve({ status: 200 as const, data: { app: s.app, none: true as const } })),
    memberKey(id),
    () => detailScope(id, store.revealFor(id)?.until),
  );
  const p = r?.data;
  if (!supportsDomains || !p || "none" in p) return null;
  const dating = "dating" in p ? p.dating : p.app === "slop" ? p as DatingProfile360 : undefined;
  const business = "business" in p ? p.business : p.app === "peon" ? p as BusinessProfile360 : undefined;
  if (!dating && !business) return null;
  return (
    <>
      {dating && <Disclosure name="domain-dating" summary="Dating"><DatingPanel id={id} p={dating} /></Disclosure>}
      {business && <Disclosure name="domain-business" summary={`Business · ${business.applications.length} introductions`}><BusinessPanel p={business} /></Disclosure>}
    </>
  );
}

const PHOTO_TEXT: Record<DatingProfile360["photos"], string> = {
  never_minor: "No photos: this member is under 18 or has no verified age. Photos and ratings are for verified adults only.",
  needs_verification: "No photos until the member's age (18+) is verified.",
  reason_required: "Photos: admin or safety, with a reason (logged).",
};

/** The dating panel: age, dating preferences, and photos behind a logged reason. */
function DatingPanel({ id, p }: { id: string; p: DatingProfile360 }) {
  const s = useStore();
  const [reason, setReason] = useState("");
  const [photos, setPhotos] = useState<MemberPhoto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const detail = useDetailGate();
  const permitted = () => staffPhotoAllowed(p.photos === "reason_required", store.can("safety"), store.members.get(id)?.minor === false);
  const allowed = permitted();
  const scope = detailScope(id, allowed);
  const reasonReady = staffPhotoReasonReady(reason.trim().length);
  const view = staffPhotoView(allowed, photos !== null);
  useLayoutEffect(() => {
    setPhotos(null);
    setError(null);
    return detail.cancel;
  }, [scope]);
  const show = async () => {
    if (!permitted() || !reasonReady) return;
    const ticket = detail.begin();
    const r = await store.photos(id, reason.trim());
    if (!permitted() || scope !== detailScope(id, true) || !detail.finish(ticket)) return;
    if (r.data?.photos) { setPhotos(r.data.photos); setError(null); } else setError(r.error ?? r.data?.error ?? "refused");
  };
  return (
    <div className="flex flex-col gap-2">
      <div>{p.adult ? "Adult" : "Under 18 or age unknown: never matched"} · age {p.ageVerified ? "verified" : "not verified"}</div>
      {p.prefs.hidden
        ? <p className={quiet}>Dating preferences hidden ({p.prefs.count} facts). {s.env?.capabilities.hiddenTruth ? "Simulated world: the truth lens shows hidden facts." : s.can("safety") ? "Reveal this member (logged) to see them." : "Safety or admin only."}</p>
        : <DatingPrefsView prefs={p.prefs.prefs} />}
      <p className={quiet}>{PHOTO_TEXT[p.photos]} Scores and ratings are never shown.</p>
      {view === "ShowPhotoForm" && (
        <form className="flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); show(); }}>
          <Input className="min-w-40 flex-1" placeholder="Reason (logged)" value={reason} onChange={e => setReason(e.target.value)} aria-label="Reason to see photos" />
          <Button variant="outline" size="sm" type="submit" disabled={!reasonReady}>Show photos</Button>
          {error && <span className="text-sm text-destructive" role="alert">{error}</span>}
        </form>
      )}
      {view === "ShowGallery" && photos && (photos.length
        ? <div className="grid grid-cols-3 gap-2">{photos.map(ph => <img key={ph.id} className="aspect-square w-full rounded-md object-cover" src={ph.url} alt="Member photo" referrerPolicy="no-referrer" loading="lazy" />)}</div>
        : <p className={quiet}>No photos.</p>)}
    </div>
  );
}

/** The dating preferences the member gave, one line each. */
function DatingPrefsView({ prefs }: { prefs: NonNullable<Extract<DatingProfile360["prefs"], { hidden: false }>["prefs"]> }) {
  const rows: [string, string | undefined][] = [
    ["Is", prefs.is], ["Seeks", prefs.seeks.join(", ") || undefined], ["Age range", prefs.ageRange?.join("-")],
    ["Where", [prefs.scope, prefs.maxMiles !== undefined ? `${prefs.maxMiles} mi` : undefined].filter(Boolean).join(" · ") || undefined], ["Goal", prefs.goal],
    ["Values", Object.entries(prefs.values).map(([k, v]) => `${humanize(k)}: ${v}`).join(" · ") || undefined],
    ["Dealbreakers", prefs.dealbreakers.map(humanize).join(", ") || undefined], ["First dates", prefs.activities.map(humanize).join(", ") || undefined],
    ["Usually free", prefs.free.join(", ") || undefined], ["Verification", prefs.verification.join(", ") || undefined], ["Safety cues", prefs.safety.join(", ") || undefined],
  ];
  return <dl className="flex flex-col gap-1">{rows.filter(([, v]) => v).map(([k, v]) => <div className="flex gap-3" key={k}><dt className="w-24 shrink-0 text-muted-foreground">{k}</dt><dd className="min-w-0">{v}</dd></div>)}</dl>;
}

/** The business panel: the hiring seat or candidate, roles, and introductions. */
function BusinessPanel({ p }: { p: BusinessProfile360 }) {
  const s = useStore();
  return (
    <div className="flex flex-col gap-1">
      <div>{p.entity === "job" ? "Job seat (hiring manager)" : p.entity === "candidate" ? "Candidate" : "Not set up yet"}</div>
      {p.roles.map((r, i) => (
        <div key={i}>
          <b>{r.title ?? humanize(r.family ?? "role")}</b>
          <span className="text-muted-foreground">{[r.family && r.title ? humanize(r.family) : undefined, r.seniority !== undefined ? `level ${r.seniority}` : undefined, r.pay, r.mode, r.market?.toUpperCase(), r.openings !== undefined ? `${r.openings} open` : undefined, r.verified === undefined ? undefined : r.verified ? "employer verified" : "employer not verified"].filter(Boolean).map(x => ` · ${x}`).join("")}</span>
        </div>
      ))}
      {p.applications.length
        ? p.applications.map(a => <div key={a.opportunityId}>{s.opps.has(a.opportunityId) ? <OppLink o={s.opps.get(a.opportunityId)!} /> : a.opportunityId} <span className="text-muted-foreground">· {humanize(a.state)}{a.status ? ` · ${humanize(a.status)}` : ""}</span></div>)
        : <p className={quiet}>No introductions yet.</p>}
    </div>
  );
}

/** The simulated persona's hidden truth, shown only under the truth lens. */
function Truth({ d }: { d: MemberDetail }) {
  const t = d.truth!;
  return (
    <div className="flex flex-col gap-3">
      <div>
        {humanize(t.archetype)} · <span className={t.trueAge < 18 ? "text-destructive" : undefined}>{t.trueAge}</span> · flaky {pct(t.flakiness)} · energy {pct(t.socialEnergy)} · capacity {pct(t.capacity)} · honest {pct(t.honesty)}
      </div>
      {t.adversarial && <Alert variant="destructive">Adversarial: {humanize(t.adversarial)}</Alert>}
      <InspectorSection title="What they actually want">
        {t.desires.map((x, i) => <div key={i}>{x.text} <span className="text-muted-foreground">· {x.category} · strength {pct(x.strength)}</span></div>)}
      </InspectorSection>
      <InspectorSection title="True interests and skills"><div className="flex flex-wrap gap-x-3 gap-y-1">{[...t.interests, ...t.skills].map(x => <span key={x}>{humanize(x)}</span>)}</div></InspectorSection>
      <InspectorSection title="Boundaries"><div>{t.boundaries.join(" · ") || "none"}</div></InspectorSection>
      <InspectorSection title="Romance"><div>{t.romanceOptIn ? "open to dating" : "not dating"}</div></InspectorSection>
      {t.privateFact && <InspectorSection title="Told the agent in confidence"><div className="italic">{t.privateFact}</div></InspectorSection>}
      {d.memory && Object.keys(d.memory).length > 0 && (
        <InspectorSection title="Private decisions on proposals">
          {Object.entries(d.memory).map(([pid, v]) => <div key={pid}>{pid.slice(0, 18)}… {v.decision} · plans to show: {v.plannedShow ? "yes" : "no"} · would enjoy {pct(v.enjoyment)}</div>)}
        </InspectorSection>
      )}
    </div>
  );
}

/** The score parts of a proposal: gains as green bars, costs as red bars, each from 0 to 1. */
function ScoreParts({ c }: { c: ScoreComponents }) {
  if (!hasScoreParts(c)) return null;
  const rows = (Object.keys(COMPONENT_SIGN) as (keyof ScoreComponents)[]).map(k => ({
    key: k, label: humanize(k.replace(/([A-Z])/g, "_$1")), value: c[k], tone: COMPONENT_SIGN[k] < 0 ? "destructive" as const : "ok" as const, title: `${k}: ${c[k]}`,
  }));
  return <MeterBars rows={rows} ranked={false} max={1} format={v => v.toFixed(2)} />;
}

/** One opportunity: its state, review actions, people, plan, times, booked plan, feedback, history and score. */
function OpportunityPanel({ id }: { id: string }) {
  const s = useStore();
  const live = s.opps.get(id);
  const res = useLive<OpportunityDetail>(() => store.opportunity(id), `${live?.state}|${live?.updatedAt}|${live?.review?.decision}|${live?.participants.join(",")}`, () => detailScope(id, !!store.truth));
  const d = res?.data;
  const o: Opp | undefined = live && d?.opportunity ? { ...d.opportunity, ...live, oracle: live.oracle ?? d.opportunity.oracle } : live ?? d?.opportunity;
  if (!o) return <p className={quiet}>Opportunity not found.</p>;
  const resolved = !OPEN.has(o.state);
  const shadow = o.source === "shadow";
  const showActions = o.state === "IN_REVIEW" && s.canReview();
  const hist = historyBetween(o);
  const items: TimelineItem[] = [
    ...(d?.messages ?? []).map(m => ({ t: m.ts, key: `m${m.memberId}-${m.id}`, msg: m })),
    ...(d?.events
      ? d.events.map((e, i) => ({ t: e.t, key: `e${i}-${e.type}`, sys: e }))
      : s.feed.filter(x => x.kind !== "message" && x.opportunityId === id).map(x => ({ t: x.t, key: `f${x.seq}`, ev: x }))),
  ];
  const now = s.now();
  const statusParts: ReactNode[] = [
    <span className="inline-flex items-center gap-1"><OppMark state={o.state} />{stateLabel(o.state)}{!resolved && o.stateSince !== undefined ? <span title="Time in this state"> · {dur(Math.max(0, now - o.stateSince))}</span> : null}</span>,
    shadow ? "Shadow · not sent" : originLabel(originOf(o)),
    humanize(o.kind), o.category, resolved ? `open ${dur(Math.max(0, o.updatedAt - o.createdAt))}` : ago(o.createdAt),
    resolved && o.reason && o.state !== "REJECTED_IN_REVIEW" && humanize(o.reason),
  ];
  const oracleTone = o.oracle ? (o.oracle.unsafe ? "destructive" : o.oracle.compatible ? "ok" : "warn") : "info";
  return (
    <>
      <div className={headClass}>
        <h2 className={titleClass}>{s.oppTitle(o)}</h2>
        <FactLine parts={statusParts} />
        {o.review && <p className={quiet}>{reviewLine(o)}</p>}
      </div>
      {showActions && <ReviewActions o={o} />}
      <InspectorSection title="People">
        {o.participants.map(x => {
          const m = s.members.get(x);
          const want = wantsOf(o, x);
          const status = o.status[x] ?? "pending";
          return (
            <div className="flex flex-col gap-1 text-sm" key={x}>
              <div className={rowClass}>
                <MemberLink id={x} />
                <StatusMark tone={tone(STATUS_TONE[status])} label={humanize(status)} showLabel />
                {o.enjoyment[x] !== undefined && <span>enjoyed {pct(o.enjoyment[x]!)}</span>}
                {m?.minor && <StatusMark tone="destructive" label="Under 18" showLabel title="Members under 18 are never introduced. This must not happen." />}
                {OPEN.has(o.state) && isBusyElsewhere(o, x) && <StatusMark tone="warn" label="busy" showLabel title="In another open opportunity" />}
                <TrustMark trust={m?.trust} />
              </div>
              {want && <div><span className="text-muted-foreground">wants:</span> {want}</div>}
              {o.explanations[x] && <div className="text-muted-foreground italic" title="Shown to this member">“{o.explanations[x]}”</div>}
            </div>
          );
        })}
      </InspectorSection>
      <InspectorSection title="Plan">
        <div className="text-sm">“{o.objective}”</div>
        <FactLine parts={[
          o.venue && <VenueLink venue={o.venue} />,
          o.backupVenue && <span><span className="text-muted-foreground">Backup:</span> <VenueLink venue={o.backupVenue} /></span>,
          o.workIntroChannel && <span><span className="text-muted-foreground">Channel:</span> {workChannelLabel(o.workIntroChannel)}</span>,
          o.meetingAt && stamp(o.meetingAt, o.city),
        ]} />
      </InspectorSection>
      {o.times && Object.keys(o.times).length > 0 && (
        <InspectorSection title="Times">
          {o.participants.filter(x => o.times![x]).map(x => {
            const t = o.times![x]!;
            return (
              <div className={rowClass} key={x}>
                <MemberLink id={x} first />
                {t.offered.length ? <TimeChoices offered={t.offered} picked={t.picked} /> : null}
                <span className="text-muted-foreground">{t.picked === undefined ? " · no answer yet" : t.picked.length ? (t.offered.length ? "" : ` · picked ${t.picked.join(", ")}`) : " · none of these fit"}</span>
              </div>
            );
          })}
        </InspectorSection>
      )}
      {o.booked && <InspectorSection title="Booked plan"><BookedPlanView o={o} b={o.booked} /></InspectorSection>}
      {o.feedback?.length ? (
        <InspectorSection title="Feedback">{o.feedback.map((f, i) => <div className="text-sm" key={i}><MemberLink id={f.memberId} first />: “{f.text}”</div>)}</InspectorSection>
      ) : null}
      {detailView(res) === "PanelForbidden" && <p className={quiet}>Your role cannot open this opportunity's messages.</p>}
      <InspectorSection title="History">
        <TimelineList items={items} who={m => (m.direction === "outbound" ? `Network → ${s.firstName(m.memberId ?? "")}` : s.firstName(m.memberId ?? ""))} />
      </InspectorSection>
      {o.source !== "player" && o.components && (
        <Disclosure name="score" summary={<>Score {o.score.toFixed(2)}{d?.run ? <> · <Button variant="ghost" size="sm" className="h-auto px-1" onClick={e => { e.preventDefault(); store.setUI({ drawer: "engine", drawerOpen: true }); }}>run {d.run.id.slice(0, 4)} →</Button></> : null}</>}>
          {o.exploration && <p className={quiet} title="Picked partly to explore, not only exploit">exploration</p>}
          <ScoreParts c={o.components} />
        </Disclosure>
      )}
      {o.alternates.length > 0 && (
        <Disclosure name="alternates" summary={`Alternates (${o.alternates.length})`}>
          <div className={peopleClass}>{o.alternates.map(a => <MemberLink key={a} id={a} />)}</div>
        </Disclosure>
      )}
      {o.oracle && (
        <DisclosureView summary="Oracle" open={!!s.truth || resolved}>
          <Alert variant={oracleTone}>
            {o.oracle.unsafe ? `Unsafe: ${o.oracle.flags.join(", ")}` : o.oracle.compatible ? "Truly compatible" : "Not a real fit"} · quality {pct(o.oracle.quality)}
          </Alert>
          {Object.entries(o.oracle.participants).map(([x, p]) => (
            <div key={x}>{s.firstName(x)}: accept {pct(p.acceptProb)} · show {pct(p.showProb)} · would enjoy {pct(p.enjoyment)}</div>
          ))}
        </DisclosureView>
      )}
      {hist.length > 0 && (
        <Disclosure name="history" summary={`History between them (${hist.length})`}>
          <OppList opps={hist} />
        </Disclosure>
      )}
    </>
  );
}
