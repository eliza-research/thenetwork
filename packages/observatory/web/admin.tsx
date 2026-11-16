// spec/consoleWorkspace.md, "Each panel shows a loading, refused, unavailable, failed, empty or full view"
// spec/consoleWorkspace.md, "Each panel opens only for the roles that can read it"
// spec/consoleWorkspace.md, "A held text waits for a reason of five characters or more"
// spec/consoleWorkspace.md, "A held photo is released only after staff load it and confirm the review"
// spec/consoleWorkspace.md, "Release needs a releasable text, and reject needs only a reason"
// spec/consoleWorkspace.md, "A case row opens, and a safety viewer lifts its hold or closes it"
// spec/consoleWorkspace.md, "A report decision needs a note and the Network service"
// spec/consoleWorkspace.md, "The request segments group the outcomes"
// spec/consoleWorkspace.md, "The switch shows only to an admin who can change it"
// spec/consoleWorkspace.md, "The first press asks for a confirmation and the second press saves"
// spec/consoleWorkspace.md, "Only an admin loads the audit log"
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  type AuditPhase,
  type ConfigEditor,
  type PanelAnswer,
  type ReportStep,
  type RequestOutcome,
  type RequestSegment,
  type WorkMode,
  type Workspace,
  actOnCase,
  actOnReport,
  canActOnCase,
  canActOnReport,
  canConfirmMatchingSwitch,
  canDecideHeld,
  canEndConfirmation,
  canLoadAudit,
  canLoadHeldPhoto,
  canMarkPhotoReviewed,
  canPressMatchingSwitch,
  canReceiveCase,
  canReceiveConfig,
  canReceiveReport,
  canToggleCaseRow,
  canTypeHeldReason,
  canTypeReportNote,
  chooseRequestSegment,
  configControl,
  confirmMatchingSwitch,
  decideHeld,
  endConfirmation,
  initial,
  loadHeldPhoto,
  markPhotoReviewed,
  panelAllowed,
  panelView,
  pressMatchingSwitch,
  receiveCase,
  receiveCaseAnswer,
  receiveConfig,
  receiveHeldAnswer,
  receiveHeldText,
  receiveReport,
  receiveReportAnswer,
  receiveSwitchAnswer,
  receiveViewer,
  reportOpen,
  reportStepAllowed,
  requestShown,
  toggleCaseRow,
  typeHeldReason,
  typeReportNote,
} from "../../core/src/generated/consoleWorkspace.ts";
import type { ReportPhase } from "../../core/src/generated/safetyCase.ts";
import { Button } from "../../ui/src/components/Button.tsx";
import { Checkbox } from "../../ui/src/components/Checkbox.tsx";
import { Disclosure } from "../../ui/src/components/Disclosure.tsx";
import { Input } from "../../ui/src/components/Input.tsx";
import { Label } from "../../ui/src/components/Label.tsx";
import { TableRow } from "../../ui/src/components/Table.tsx";
import { AuditQuery, AuditRow, auditColumns } from "../../ui/src/components/console/AuditRow.tsx";
import { CaseCard } from "../../ui/src/components/console/CaseCard.tsx";
import { ConfigField } from "../../ui/src/components/console/ConfigField.tsx";
import { Countdown } from "../../ui/src/components/console/Countdown.tsx";
import { DataCell, DataTable, type DataColumn } from "../../ui/src/components/console/DataTable.tsx";
import { FactLine } from "../../ui/src/components/console/FactLine.tsx";
import { HeldItemCard } from "../../ui/src/components/console/HeldItemCard.tsx";
import { InspectorSection } from "../../ui/src/components/console/InspectorSection.tsx";
import { Kpi } from "../../ui/src/components/console/Kpi.tsx";
import { KpiGrid } from "../../ui/src/components/console/KpiGrid.tsx";
import { ReportCard } from "../../ui/src/components/console/ReportCard.tsx";
import { RequestRow, requestColumns, requestSegmentOptions } from "../../ui/src/components/console/RequestRow.tsx";
import { Segments } from "../../ui/src/components/console/Segments.tsx";
import { StatusMark, type StatusTone } from "../../ui/src/components/console/StatusMark.tsx";
import { StatusRow } from "../../ui/src/components/console/StatusRow.tsx";
import { MemberLink, OpportunityLink } from "../../ui/src/components/console/SubjectLink.tsx";
import type { AuditEntry, BiasReportView, ConfigInfo, DiffNum, EngineRunSummary, HeldQueue, HeldText, LabArm, LabRun, ObsOpportunity, ObsRequest, ObsSafetyCase, RunDiff, SafetyAction, SafetyInfo, SafetyReport, ScoreMetric } from "../src/types.ts";
import { store, useStore } from "./store.ts";
import { dur, humanize, num, pct, stamp } from "./ui.tsx";

type Fetched<T> = { data?: T; status?: number; error?: string };

/** Load from an endpoint on mount, when `key` changes, and every `everyMs` (0: never). */
function useFetch<T>(load: () => Promise<{ data?: T; status: number; error?: string }>, key: unknown, everyMs = 0) {
  const [d, setD] = useState<{ data?: T; status: number; error?: string }>();
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    const run = () => load().then(x => { if (live) setD(x); });
    run();
    const h = everyMs ? setInterval(run, everyMs) : undefined;
    return () => { live = false; if (h) clearInterval(h); };
  }, [key, n, everyMs]);
  return { ...d, reload: () => setN(x => x + 1) };
}

/** The answer of one endpoint read, as the panel model names it. */
function answerOf(r: Fetched<unknown>, hasRows: boolean): PanelAnswer {
  return r.status === undefined ? "NotAnswered" : r.status === 403 ? "AnswerForbidden" : r.status === 404 ? "AnswerMissing" : hasRows ? "AnswerRows" : "AnswerFailed";
}

/** The workspace model of the current viewer: roles from the store, the work mode from the caller. */
function useViewer(mode: WorkMode): Workspace {
  const s = useStore();
  return receiveViewer(initial, mode, s.can("safety"), s.isAdmin(), s.can("analyst"), s.canSim(), false);
}

/** The work mode of a safety answer: the Network service bans and holds, and any acting mode clears a minor signal. */
const safetyMode = (canBan: boolean, canAct: boolean): WorkMode => (canBan ? "RealWithService" : canAct ? (store.mode === "real" ? "RealWithService" : "SimulatedWorld") : "RealWithoutService");

/** A member name that opens the member. */
function Member({ id, first = false, children }: { id: string; first?: boolean; children?: ReactNode }) {
  const m = store.members.get(id);
  return <MemberLink onOpen={() => store.focus({ kind: "member", id })}>{children ?? (m ? (first ? m.name.split(" ")[0] : m.name) : id)}</MemberLink>;
}

/** An opportunity reference that opens the opportunity. */
function Opportunity({ o, children }: { o: ObsOpportunity; children?: ReactNode }) {
  return <OpportunityLink onOpen={() => store.focus({ kind: "opportunity", id: o.id })}>{children ?? store.oppTitle(o)}</OpportunityLink>;
}

const grid = "grid gap-6 lg:grid-cols-2";
const quiet = "text-sm text-muted-foreground";

const BIAS_METRICS = [["proposals", "Proposals"], ["dates", "Dates"], ["secondDates", "Second dates"]] as const;
const biasColumns: DataColumn[] = [{ key: "group", label: "Group" }, { key: "members", label: "Members" }, ...BIAS_METRICS.map(([key, label]) => ({ key, label }))];

/**
 * The weekly bias monitor of the app's network (real mode, from the Network service): outcome ratio of
 * each photo-rating quintile (q1 lowest) and "unrated" against everyone. Under 0.8x is an alert. Aggregates only.
 */
export function BiasMonitor() {
  const s = useStore();
  const r = useFetch<{ ok: boolean; reports?: BiasReportView[]; error?: string }>(() => store.bias(), `${s.mode}`, 60_000);
  const reports = r.data?.reports;
  const view = panelView("BiasPanel", answerOf(r, !!reports), reports?.length ?? 0);
  const last = reports?.[0];
  return (
    <StatusRow
      view={view}
      error={r.error ?? r.data?.error}
      unavailable="The bias monitor runs on real data only (bun run sim measures it in simulation)."
      empty="No report yet: the Network service writes one a week for each network that takes photos."
    >
      {last && (
        <div className="flex flex-col gap-2 text-sm">
          <FactLine parts={[stamp(last.at), `${num(last.members)} adult members`, "alert under 0.8x"]} />
          {last.report.alerts.length
            ? last.report.alerts.map(a => (
              <p className="flex items-center gap-2 text-destructive" key={`${a.group}${a.metric}`}>
                <StatusMark tone="destructive" label="Alert" />{a.group}: {humanize(a.metric)} at {a.ratio.toFixed(2)}x
              </p>
            ))
            : <p className="text-ok">No group under 0.8x.</p>}
          <DataTable columns={biasColumns}>
            {Object.entries(last.report.groups).map(([g, x]) => (
              <TableRow key={g}>
                <DataCell>{g}</DataCell>
                <DataCell numeric>{num(x.n)}</DataCell>
                {BIAS_METRICS.map(([k]) => <DataCell key={k} numeric className={x.ratio[k] < 0.8 ? "text-destructive" : undefined}>{x.ratio[k].toFixed(2)}x</DataCell>)}
              </TableRow>
            ))}
          </DataTable>
          {reports && reports.length > 1 && <p className={quiet}>Earlier: {reports.slice(1).map(x => `${stamp(x.at)} (${x.report.alerts.length} alert${x.report.alerts.length === 1 ? "" : "s"})`).join(" · ")}</p>}
        </div>
      )}
    </StatusRow>
  );
}

/** Cases (urgent first), evidence events and lift/close actions; the minor-safety view. Safety and admin only. */
export function SafetyCases() {
  const s = useStore();
  const r = useFetch<SafetyInfo>(() => store.safety(), `${s.mode}|${s.network?.trust.hold}|${s.network?.trust.watch}|${s.stats?.blocks}`, 10_000);
  const [show, setShow] = useState<"open" | "all">("open");
  const viewer = useViewer("RealWithService");
  const info = r.data;
  if (!info) return <StatusRow view={panelView("CasesPanel", answerOf(r, false), 0)} error={r.error} />;
  const f = s.ui.focus;
  const cases = info.cases
    .filter(c => show === "all" || c.status !== "closed")
    .filter(c => f?.kind !== "member" || c.memberId === f.id)
    .filter(c => { const m = s.members.get(c.memberId); return !m || s.inBorough(m); });
  const minors = info.minors;
  const reports = (info.reports ?? []).filter(x => show === "all" || x.status === "open").filter(x => f?.kind !== "member" || x.subjectId === f.id || x.reporterId === f.id);
  const mode = safetyMode(!!info.canBan, info.canAct);
  return (
    <div className={grid}>
      {panelAllowed("HeldPanel", viewer.staff) && <HeldTexts />}
      {info.reports && (
        <InspectorSection title={`Reports after a date (${reports.length})`}>
          <StatusRow view={panelView("ReportsPanel", "AnswerRows", reports.length)} empty={s.nothing()}>
            {reports.slice(0, 80).map(x => <ReportItem key={x.id} r={x} mode={mode} onDone={r.reload} />)}
          </StatusRow>
          {!info.canBan && <p className={quiet}>Hold and ban by phone or person go to the Network service (real mode with NETWORK_SERVICE_URL).</p>}
        </InspectorSection>
      )}
      <InspectorSection
        title={`Cases (${cases.length})`}
        action={<Segments aria-label="Cases" value={show} onValueChange={v => setShow(v as "open" | "all")} options={[{ value: "open", label: "Open" }, { value: "all", label: "All" }]} />}
      >
        <StatusRow view={panelView("CasesPanel", "AnswerRows", cases.length)} empty={s.nothing()}>
          {cases.slice(0, 80).map(c => <CaseItem key={c.id} c={c} mode={mode} canAct={info.canAct} onDone={r.reload} />)}
        </StatusRow>
        {!info.canAct && <p className={quiet}>Read-only here: real mode acts through the Network service (set NETWORK_SERVICE_URL and NETWORK_SERVICE_TOKEN).</p>}
      </InspectorSection>
      <InspectorSection title="Minor safety">
        <p className="text-sm">{num(minors.members.length)} members under 18 · {num(minors.unknownAge.length)} with no valid age (treated as under 18) · never matched</p>
        {minors.inOpportunities.length
          ? minors.inOpportunities.map(x => (
            <p className="flex flex-wrap items-center gap-2 text-sm text-destructive" key={`${x.opportunityId}${x.memberId}`}>
              <StatusMark tone="destructive" label="Minor in an opportunity" />
              <Member id={x.memberId} /> in {s.opps.has(x.opportunityId) ? <Opportunity o={s.opps.get(x.opportunityId)!} /> : x.opportunityId} <span className="text-muted-foreground">· {humanize(x.state)}</span>
            </p>
          ))
          : <p className="text-sm text-ok">None in any open multi-person opportunity.</p>}
        {minors.members.length > 0 && <div className="flex flex-wrap gap-2">{minors.members.slice(0, 40).map(id => <Member key={id} id={id} />)}</div>}
        {minors.unknownAge.length > 0 && <div className="flex flex-wrap items-center gap-2"><span className={quiet}>Age unknown:</span> {minors.unknownAge.slice(0, 40).map(id => <Member key={id} id={id} />)}</div>}
      </InspectorSection>
    </div>
  );
}

const HELD_QUEUES: { value: HeldQueue; label: string }[] = [{ value: "leak", label: "Leak review" }, { value: "relay", label: "Held relay" }];

/**
 * Texts that wait for staff before they go out: the leak guard's parked texts and relay items held for a
 * check (real mode, from the Network service; per app). Release or reject with a reason; both are audited.
 * Never a score. The text of a member under 18 or with an unknown age is not shown.
 */
function HeldTexts() {
  const s = useStore();
  const [queue, setQueue] = useState<HeldQueue>("leak");
  const r = useFetch<{ ok: boolean; items?: HeldText[]; code?: string; error?: string }>(() => store.held(queue), `${s.mode}|${s.app}|${queue}`, 30_000);
  const items = r.data?.items;
  return (
    <InspectorSection
      title={`Held texts${items ? ` (${items.length})` : ""}`}
      action={<Segments aria-label="Queue" value={queue} onValueChange={v => setQueue(v as HeldQueue)} options={HELD_QUEUES} />}
    >
      <StatusRow
        view={panelView("HeldPanel", answerOf(r, !!items), items?.length ?? 0)}
        error={r.error ?? r.data?.error}
        empty="Nothing held."
        unavailable={`Not available: ${s.mode === "real" ? (r.error ?? "the Network service has no route for this queue yet") : "held texts exist on real data only"}.`}
      >
        <div className="flex flex-col gap-2">{items?.slice(0, 100).map(x => <HeldItem key={x.id} x={x} onDone={r.reload} />)}</div>
      </StatusRow>
    </InspectorSection>
  );
}

/** One held text or photo on the held-row model. Held rows come only from the Network service. */
function HeldItem({ x, onDone }: { x: HeldText; onDone(): void }) {
  const scope = useStore(), photo = x.queue === "relay" && x.kind === "photo";
  const viewer = useViewer("RealWithService");
  const [held, setHeld] = useState(() => receiveHeldText(viewer, photo, !!x.textHidden).held);
  const [reason, setReason] = useState("");
  const identity = JSON.stringify([scope.mode, scope.app, x.id, x.createdAt ?? null, scope.me?.id, scope.me?.grants, scope.me?.roles, scope.authEpoch, scope.authNeeded]), active = useRef(identity); active.current = identity;
  const [preview, setPreview] = useState<string>(), [previewIdentity, setPreviewIdentity] = useState(""), [previewError, setPreviewError] = useState(""), [loading, setLoading] = useState(false);
  const move = (next: (w: Workspace) => Workspace) => setHeld(h => next({ ...viewer, held: h }).held);
  useEffect(() => { active.current = identity; setPreview(undefined); setPreviewIdentity(""); move(w => loadHeldPhoto(w, false)); setPreviewError(""); setLoading(false); return () => { active.current = ""; }; }, [identity]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const ws: Workspace = { ...viewer, held };
  const currentPreview = !!preview && previewIdentity === identity && !scope.authNeeded;
  const loadPhoto = async () => {
    setLoading(true); move(w => loadHeldPhoto(w, false)); setPreviewError(""); setPreview(undefined);
    const result = await store.heldPhoto(x.id, reason.trim());
    if (active.current !== identity) return;
    setLoading(false);
    if (result.blob) { setPreviewIdentity(identity); setPreview(URL.createObjectURL(result.blob)); } else setPreviewError(result.error ?? "The selected photo could not load. You can still reject it.");
  };
  const act = async (decision: "release" | "reject") => {
    const choice = decision === "release" ? "ReleaseHeld" : "RejectHeld";
    if (!canDecideHeld(ws, choice) || (photo && decision === "release" && !currentPreview)) return;
    move(w => decideHeld(w, choice));
    const res = await store.heldDecision(x.queue, x.id, decision, reason.trim(), photo && currentPreview && held.photoLoaded && held.photoReviewed);
    move(w => receiveHeldAnswer(w, !!res.data?.ok));
    if (res.data?.ok) { store.toast(decision === "release" ? "Released: every other send check runs again" : "Rejected: nothing is sent", "good"); setReason(""); onDone(); }
    else store.toast(res.data?.error ?? res.error ?? "refused", "bad");
  };
  return (
    <HeldItemCard
      held={held}
      kind={x.kind ? humanize(x.kind) : x.queue}
      who={x.memberId ? <Member id={x.memberId} /> : x.to ? <span className="text-muted-foreground">to {x.to}</span> : undefined}
      reasons={x.reasons.join(", ")}
      at={x.createdAt ? stamp(x.createdAt) : undefined}
      text={x.text}
      actionsShown={store.can("safety")}
      reason={reason}
      onReasonChange={v => { if (!canTypeHeldReason(ws)) return; setReason(v); move(w => typeHeldReason(w, v.trim().length)); }}
      canRelease={canDecideHeld(ws, "ReleaseHeld") && (!photo || currentPreview)}
      canReject={canDecideHeld(ws, "RejectHeld")}
      onRelease={() => act("release")}
      onReject={() => act("reject")}
      canLoadPhoto={canLoadHeldPhoto(ws) && !loading}
      canMarkPhotoReviewed={canMarkPhotoReviewed(ws)}
      photoSrc={currentPreview ? preview : undefined}
      photoError={previewError || undefined}
      photoLoading={loading}
      onLoadPhoto={loadPhoto}
      onPhotoShown={() => move(w => loadHeldPhoto(w, true))}
      onPhotoFailed={() => { move(w => loadHeldPhoto(w, false)); setPreview(undefined); setPreviewError("The selected photo could not display. Try again or reject it."); }}
      onPhotoReviewedChange={reviewed => { if (canMarkPhotoReviewed(ws)) move(w => markPhotoReviewed(w, reviewed)); }}
    />
  );
}

const LEVEL_TONE: Record<string, StatusTone> = { hold: "destructive", watch: "warn" };

/** One safety case on the case-row model. */
function CaseItem({ c, mode, canAct, onDone }: { c: ObsSafetyCase; mode: WorkMode; canAct: boolean; onDone(): void }) {
  const s = useStore();
  const viewer = useViewer(mode);
  const onHold = c.level === "hold" || c.status === "held";
  const closed = c.status === "closed";
  const [row, setRow] = useState(() => (canReceiveCase(viewer) ? receiveCase(viewer, onHold) : viewer).caseRow);
  const [note, setNote] = useState("");
  const current = { ...row, onHold, status: closed ? "CaseRowClosed" as const : row.status };
  const ws: Workspace = { ...viewer, caseRow: current };
  const act = async (step: "LiftStep" | "CloseStep") => {
    if (!canActOnCase(ws, step)) return;
    setRow(actOnCase(ws, step).caseRow);
    const r = await store.safetyAction(step === "LiftStep" ? { action: "lift", memberId: c.memberId, note: note.trim() || undefined } : { action: "close", caseId: c.id, note: note.trim() || undefined });
    const res = r.data;
    setRow(x => receiveCaseAnswer({ ...viewer, caseRow: x }, !!res?.ok).caseRow);
    if (res?.ok) { store.toast(step === "LiftStep" ? `Hold lifted · ${c.memberName}` : `Case closed · ${c.memberName}`, "good"); setNote(""); onDone(); }
    else store.toast(res?.error ?? r.error ?? "refused", "bad");
  };
  return (
    <CaseCard
      row={current}
      name={c.memberName}
      level={{ tone: LEVEL_TONE[c.level] ?? "neutral", label: c.level }}
      urgent={c.urgent}
      meta={`${c.status} · opened ${stamp(c.opened)} · ${c.events.length} event${c.events.length === 1 ? "" : "s"}`}
      due={closed
        ? c.closedAt ? <span className={quiet}>closed {stamp(c.closedAt)}{c.closedBy ? ` by ${c.closedBy.replace(/^token:/, "")}` : ""}</span> : undefined
        : <Countdown deadline={c.dueAt} now={s.now()} prefix="due in " overdue={c.overdue} deadlineLabel={stamp(c.dueAt)} />}
      events={c.events.map((e, i) => (
        <p className="text-sm" key={i}>
          <span className="text-muted-foreground">{stamp(e.at)}</span> {humanize(e.kind)} <span className="text-muted-foreground">· {e.points > 0 ? "+" : ""}{e.points} pts</span>
          {e.by && <> · by <Member id={e.by} /></>}
        </p>
      ))}
      timeline={<Member id={c.memberId}>Open timeline →</Member>}
      actionsShown={canAct && store.can("safety")}
      note={note}
      onNoteChange={setNote}
      canLift={canActOnCase(ws, "LiftStep")}
      canClose={canActOnCase(ws, "CloseStep")}
      onLift={() => act("LiftStep")}
      onClose={() => act("CloseStep")}
      onToggle={() => { if (canToggleCaseRow(ws)) setRow(toggleCaseRow(ws).caseRow); }}
    />
  );
}

const REPORT_STEPS: ReportStep[] = ["HoldPersonStep", "BanPhoneStep", "BanPersonStep", "DismissStep", "ClearMinorStep"];
const REPORT_PHASE: Record<SafetyReport["status"], ReportPhase> = { open: "ReportOpen", held: "ReportHeld", banned: "ReportBanned", dismissed: "ReportDismissed" };

/** The staff action and its toast for one report decision. */
function reportAction(step: ReportStep, r: SafetyReport, note: string): [SafetyAction, string] {
  if (step === "HoldPersonStep") return [{ action: "hold", memberId: r.subjectId, note, reportId: r.id }, "Person held on every app"];
  if (step === "BanPhoneStep") return [{ action: "ban", memberId: r.subjectId, by: "phone", note, reportId: r.id }, "Banned by phone"];
  if (step === "BanPersonStep") return [{ action: "ban", memberId: r.subjectId, by: "person", note, reportId: r.id }, "Banned by person"];
  if (step === "ClearMinorStep") return [{ action: "clear_minor", memberId: r.subjectId, note }, "Minor signal cleared on every app"];
  return [{ action: "dismiss", reportId: r.id, note }, "Report dismissed"];
}

/** One post-date report on the report-row model: hold or ban the person (by phone or by person), dismiss, or clear a minor signal. */
function ReportItem({ r, mode, onDone }: { r: SafetyReport; mode: WorkMode; onDone(): void }) {
  const s = useStore();
  const viewer = useViewer(mode);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [row, setRow] = useState(() => (canReceiveReport(viewer) ? receiveReport(viewer, r.kind === "minor") : viewer).report);
  const current = { ...row, status: REPORT_PHASE[r.status] };
  const ws: Workspace = { ...viewer, report: current };
  const n = note.trim();
  const act = async (step: ReportStep) => {
    if (!canActOnReport(ws, step)) return;
    setRow(actOnReport(ws, step).report);
    const [action, done] = reportAction(step, r, n);
    const res = await store.safetyAction(action);
    setRow(x => receiveReportAnswer({ ...viewer, report: x }, !!res.data?.ok).report);
    if (res.data?.ok) { store.toast(done, "good"); setNote(""); onDone(); } else store.toast(res.data?.error ?? res.error ?? "refused", "bad");
  };
  const steps = reportOpen(ws) && viewer.staff.safety ? REPORT_STEPS.filter(step => reportStepAllowed(step, viewer.staff.mode, current.minorReport)).map(step => ({ step, enabled: canActOnReport(ws, step) })) : [];
  return (
    <ReportCard
      report={current}
      expanded={open}
      onToggle={() => setOpen(!open)}
      kind={{ tone: r.kind === "harassment" || r.kind === "unsafe" ? "destructive" : "warn", label: humanize(r.kind) }}
      name={s.members.get(r.subjectId)?.name ?? r.subjectId}
      urgent={r.urgent && r.status === "open"}
      meta={`${r.status} · ${stamp(r.at)}${r.priorReports ? ` · ${r.priorReports} earlier report${r.priorReports > 1 ? "s" : ""}` : ""}`}
      due={r.status === "open" ? <Countdown deadline={r.dueAt} now={s.now()} prefix="due in " overdue={r.overdue} deadlineLabel={stamp(r.dueAt)} /> : undefined}
      detail={<p className="text-sm">Reported <Member id={r.subjectId} /> · by <Member id={r.reporterId} />{r.opportunityId && <> · after {s.opps.has(r.opportunityId) ? <Opportunity o={s.opps.get(r.opportunityId)!} /> : r.opportunityId}</>}</p>}
      steps={steps}
      note={note}
      onNoteChange={v => { if (!canTypeReportNote(ws)) return; setNote(v); setRow(typeReportNote(ws, v.trim().length).report); }}
      onAct={act}
    />
  );
}

const OUTCOME: Record<ObsRequest["outcome"], RequestOutcome> = { probing: "ProbingOutcome", open: "OpenOutcome", fulfilled: "FulfilledOutcome", booked: "BookedOutcome", none: "NoneOutcome", answered: "AnsweredOutcome" };

/** Member requests: what was asked for (never the member's words), the outcome, tries and age. */
export function Requests() {
  const s = useStore();
  const [seg, setSeg] = useState<RequestSegment>(initial.requestSegment);
  const f = s.ui.focus;
  const isOpen = (r: ObsRequest) => requestShown(OUTCOME[r.outcome], "OpenSegment");
  const scoped = s.requests.filter(r => {
    const m = s.members.get(r.memberId);
    if (m && !s.matchMember(m)) return false;
    if (!isOpen(r) && !s.inRange(r.openedAt)) return false;
    if (f?.kind === "member" && r.memberId !== f.id) return false;
    if (f?.kind === "opportunity" && r.opportunityId !== f.id) return false;
    if (f?.kind === "neighborhood" && m?.area !== f.id) return false;
    return true;
  });
  const rows = scoped.filter(r => requestShown(OUTCOME[r.outcome], seg));
  const byCat = new Map<string, { open: number; fulfilled: number; total: number }>();
  for (const r of scoped) {
    const c = byCat.get(r.category) ?? { open: 0, fulfilled: 0, total: 0 };
    c.total++; if (isOpen(r)) c.open++; if (r.outcome === "fulfilled") c.fulfilled++;
    byCat.set(r.category, c);
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Segments aria-label="Outcome" value={seg} onValueChange={v => setSeg(chooseRequestSegment(initial, v as RequestSegment).requestSegment)} options={requestSegmentOptions} />
        <span className={quiet}>{[...byCat].sort((a, b) => b[1].total - a[1].total).map(([k, c]) => `${k} ${c.open} open / ${c.fulfilled} fulfilled`).join(" · ")}</span>
      </div>
      <StatusRow view={panelView("RequestsPanel", "AnswerRows", rows.length)} empty={s.requests.length ? s.nothing() : "No requests yet."}>
        <DataTable columns={requestColumns}>
          {rows.slice(0, 200).map(r => (
            <RequestRow
              key={r.id}
              opened={stamp(r.openedAt)}
              member={<Member id={r.memberId} />}
              label={r.label}
              detail={`${r.category}${r.kind === "plans" ? " · plans" : ""}`}
              outcome={OUTCOME[r.outcome]}
              outcomeLabel={r.outcome}
              tries={r.tries}
              age={r.hoursToFulfil !== undefined ? `${r.hoursToFulfil}h` : dur(r.ageHours * 3_600_000)}
              ageTitle={r.hoursToFulfil !== undefined ? "Hours to fulfil" : "Age"}
              open={r.opportunityId && s.opps.has(r.opportunityId) ? <Opportunity o={s.opps.get(r.opportunityId)!}>open</Opportunity> : undefined}
            />
          ))}
        </DataTable>
      </StatusRow>
    </div>
  );
}

function fmtMetric(unit: ScoreMetric["unit"], v: number): string {
  return unit === "share" ? pct(v, v > 0 && v < 0.1 ? 1 : 0) : unit === "per_member_week" ? v.toFixed(2) : unit === "minutes" ? `${v.toFixed(1)} min` : num(v);
}

const scoreColumns: DataColumn[] = [{ key: "measure", label: "Measure" }, { key: "value", label: "Value", numeric: true }, { key: "target", label: "Target", numeric: true }, { key: "n", label: "n", numeric: true }];

/** PRD 28.2 scorecard: value, target, met. The definition is in each row's tooltip. */
export function Scorecard({ rows }: { rows: ScoreMetric[] }) {
  return (
    <DataTable columns={scoreColumns}>
      {rows.map(m => (
        <TableRow key={m.key} title={m.how}>
          <DataCell>{m.label}</DataCell>
          <DataCell numeric className={m.met === true ? "text-ok" : m.met === false ? "text-destructive" : undefined}>
            <span className="inline-flex items-center gap-1">
              {m.value === null ? "–" : fmtMetric(m.unit, m.value)}
              {m.met !== undefined && m.met !== null && <StatusMark tone={m.met ? "ok" : "destructive"} label={m.met ? "Target met" : "Target not met"} />}
            </span>
          </DataCell>
          <DataCell numeric muted>{m.target ? `${m.target.op} ${fmtMetric(m.unit, m.target.value)}` : ""}</DataCell>
          <DataCell numeric muted>{num(m.n)}</DataCell>
        </TableRow>
      ))}
    </DataTable>
  );
}

const cohortColumns: DataColumn[] = [{ key: "cohort", label: "Cohort" }, { key: "members", label: "Members", numeric: true }, { key: "joined", label: "Joined", numeric: true }, { key: "activated", label: "Activated", numeric: true }, { key: "rate", label: "Rate", numeric: true }];

export function Growth() {
  const s = useStore();
  const g = s.stats?.growth;
  if (!g) return null;
  const row = (label: string, c: typeof g.seed) => (
    <TableRow key={label}>
      <DataCell>{label}</DataCell><DataCell numeric>{num(c.members)}</DataCell><DataCell numeric>{num(c.joined)}</DataCell><DataCell numeric>{num(c.activated)}</DataCell><DataCell numeric>{c.rate === null ? "–" : pct(c.rate)}</DataCell>
    </TableRow>
  );
  return (
    <InspectorSection title="Growth">
      <KpiGrid compact>
        <Kpi label="invites sent" value={num(g.invitesSent)} />
        <Kpi label="invitees joined" value={num(g.inviteesJoined)} />
        <Kpi label="growth asks" value={num(g.growthAsks)} />
        <Kpi label="invited someone" value={g.inviterShare === null ? "–" : pct(g.inviterShare)} tone={g.inviterShare !== null && g.inviterShare >= 0.3 ? "ok" : undefined} title="Joined members who invited someone. PRD 28.2 target: at least 30%." />
      </KpiGrid>
      <DataTable columns={cohortColumns} title="Activated: joined and had a first outcome (attended a meeting, or a request was fulfilled or answered)">
        {row("Seed", g.seed)}{row("Invitees", g.invitees)}
      </DataTable>
    </InspectorSection>
  );
}

const historyColumns: DataColumn[] = [{ key: "v", label: "v" }, { key: "at", label: "When" }, { key: "who", label: "Who" }, { key: "key", label: "Setting" }, { key: "change", label: "Change" }];

export function Config() {
  const s = useStore();
  const r = useFetch<ConfigInfo>(() => store.config(), `${s.mode}|${s.network?.matchingEnabled}|${s.network?.review.mode}`);
  const viewer = useViewer(s.mode === "real" ? (s.canAct() ? "RealWithService" : "RealWithoutService") : "SimulatedWorld");
  const c = r.data;
  const packLocked = !!s.env?.matchingLocked;
  const base = c && canReceiveConfig(viewer) ? receiveConfig(viewer, c.matchingEnabled, packLocked, c.canChange) : viewer;
  const [edit, setEdit] = useState<{ of: ConfigInfo; config: ConfigEditor; error?: string }>();
  const ws: Workspace = edit && edit.of === c ? { ...base, config: edit.config } : base;
  const phase = ws.config.phase;
  useEffect(() => {
    if (phase !== "ConfigConfirming") return;
    const h = setTimeout(() => setEdit(e => (e && canEndConfirmation({ ...viewer, config: e.config }) ? { ...e, config: endConfirmation({ ...viewer, config: e.config }).config } : e)), 4000);
    return () => clearTimeout(h);
  }, [phase]);
  if (!c) return <StatusRow view={panelView("ConfigPanel", answerOf(r, false), 0)} error={r.error} />;
  const press = () => { if (canPressMatchingSwitch(ws)) setEdit({ of: c, config: pressMatchingSwitch(ws).config }); };
  const confirm = async () => {
    if (!canConfirmMatchingSwitch(ws)) return;
    const saving = confirmMatchingSwitch(ws);
    setEdit({ of: c, config: saving.config });
    const x = await store.control({ type: "matching", on: !c.matchingEnabled });
    setEdit({ of: c, config: receiveSwitchAnswer(saving, x.ok).config, error: x.ok ? undefined : x.error ?? "refused" });
    if (x.ok) { store.toast(`Proactive matching ${c.matchingEnabled ? "off" : "on"}`, c.matchingEnabled ? "info" : "good"); r.reload(); }
  };
  return (
    <div className="flex flex-col gap-6">
      <div className={grid}>
        <InspectorSection title={`Proactive matching · ${s.app} · NYC`}>
          <ConfigField
            control={configControl(c.canChange, viewer.staff.admin, packLocked, c.matchingEnabled)}
            phase={phase}
            matchingOn={c.matchingEnabled}
            canPress={canPressMatchingSwitch(ws)}
            canConfirm={canConfirmMatchingSwitch(ws)}
            onPress={press}
            onConfirm={confirm}
            review={c.reviewMode ?? "–"}
            error={phase === "ConfigFailed" && edit?.of === c ? edit.error : undefined}
          />
          <DataTable columns={historyColumns} empty={c.history.length ? undefined : "No changes yet."}>
            {[...c.history].reverse().map(h => (
              <TableRow key={h.version}>
                <DataCell muted>{h.version}</DataCell><DataCell muted>{stamp(h.at)}</DataCell><DataCell>{h.actor.replace(/^token:/, "")}</DataCell><DataCell>{humanize(h.key)}</DataCell><DataCell>{String(h.from ?? "–")} → {String(h.to)}</DataCell>
              </TableRow>
            ))}
          </DataTable>
        </InspectorSection>
        <InspectorSection title="Settings in force">
          <Disclosure summary={`Network options (${Object.keys(c.network).length})`}>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1">{Object.entries(c.network).map(([k, v]) => <div className="contents" key={k}><dt className="text-muted-foreground">{k}</dt><dd>{String(v)}</dd></div>)}</dl>
          </Disclosure>
          <Disclosure summary="Outreach numbers"><pre className="font-mono text-sm whitespace-pre-wrap">{JSON.stringify(c.outreach, null, 1)}</pre></Disclosure>
        </InspectorSection>
      </div>
      {panelAllowed("AuditPanel", viewer.staff) && <AuditLog />}
    </div>
  );
}

const auditDetail = (e: AuditEntry) => {
  const d = e.detail as { phase?: string; code?: string; refused?: string } | undefined;
  return [e.reason, d?.phase, d?.code ?? d?.refused].filter(Boolean).join(" · ");
};

/** Every staff read and action (admin only). Each load is itself logged. */
function AuditLog() {
  const [actor, setActor] = useState("");
  const [target, setTarget] = useState("");
  const [q, setQ] = useState({ actor: "", target: "" });
  const viewer = useViewer(store.mode === "real" ? "RealWithService" : "SimulatedWorld");
  const r = useFetch<{ sink: string; entries: AuditEntry[] }>(() => store.audit({ limit: 200, actor: q.actor || undefined, targetId: q.target || undefined }), `${q.actor}|${q.target}`);
  const phase: AuditPhase = r.status === undefined ? "AuditLoading" : r.data ? "AuditShown" : "AuditFailed";
  const entries = r.data?.entries ?? [];
  return (
    <InspectorSection
      title={`Audit log${r.data ? ` · ${r.data.sink}` : ""}`}
      action={
        <AuditQuery
          phase={phase}
          canLoad={canLoadAudit({ ...viewer, audit: phase })}
          actor={actor}
          onActorChange={setActor}
          target={target}
          onTargetChange={setTarget}
          onLoad={() => { if (q.actor === actor.trim() && q.target === target.trim()) r.reload(); else setQ({ actor: actor.trim(), target: target.trim() }); }}
        />
      }
    >
      <StatusRow view={panelView("AuditPanel", answerOf(r, !!r.data), entries.length)} error={r.error} empty="Nothing logged.">
        <DataTable columns={auditColumns}>
          {entries.map((e, i) => (
            <AuditRow
              key={e.id ?? i}
              at={stamp(e.at)}
              actor={e.actor.replace(/^token:/, "")}
              roles={e.roles.join(", ")}
              action={humanize(e.action)}
              target={<>{e.targetType ? `${e.targetType} ` : ""}{e.targetType === "member" && e.targetId && store.members.has(e.targetId) ? <Member id={e.targetId} /> : <span className="text-muted-foreground">{e.targetId ?? ""}</span>}</>}
              ok={e.ok}
              detail={auditDetail(e) || undefined}
              detailTitle={e.detail ? JSON.stringify(e.detail) : undefined}
            />
          ))}
        </DataTable>
      </StatusRow>
    </InspectorSection>
  );
}

const ARMS: [LabArm, string][] = [["push_baseline", "Push baseline"], ["push_v2", "Push v2"], ["consent", "Consent"]];

export function Lab() {
  const [poll, setPoll] = useState(0);
  const r = useFetch<{ enabled: boolean; running: number; runs: LabRun[] }>(() => store.lab(), "lab", poll);
  const [arms, setArms] = useState<LabArm[]>(["consent"]);
  const [seeds, setSeeds] = useState("1");
  const [days, setDays] = useState(7);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState<string>();
  const lab = r.data;
  const active = !!lab?.runs.some(x => x.status === "queued" || x.status === "running");
  useEffect(() => { setPoll(active ? 3000 : 0); }, [active]);
  if (!lab) return <StatusRow view={panelView("LabPanel", answerOf(r, false), 0)} error={r.error} />;
  if (!lab.enabled) return <p className={quiet}>The lab is off on this server.</p>;
  const start = async () => {
    setErr("");
    const list = seeds.split(/[\s,]+/).filter(Boolean).map(Number);
    const x = await store.labRun({ arms, seeds: list, days });
    if (!x.data?.ok) { setErr(x.error ?? "refused"); return; }
    setSel(x.data.run.id); setPoll(3000); r.reload();
  };
  const runs = [...lab.runs].sort((a, b) => b.createdAt - a.createdAt);
  const shown = runs.find(x => x.id === sel) ?? runs[0];
  return (
    <div className="flex flex-col gap-4">
      <form className="flex flex-wrap items-center gap-3" onSubmit={e => { e.preventDefault(); start(); }}>
        {ARMS.map(([k, l]) => (
          <Label key={k} className="font-normal">
            <Checkbox checked={arms.includes(k)} onCheckedChange={v => setArms(v === true ? [...arms, k] : arms.filter(a => a !== k))} />{l}
          </Label>
        ))}
        <Label className="font-normal">seeds <Input className="w-24" value={seeds} onChange={e => setSeeds(e.target.value)} title="1-5 seeds, comma-separated" /></Label>
        <Label className="font-normal">days <Input className="w-20" type="number" min={1} max={60} value={days} onChange={e => setDays(Number(e.target.value))} /></Label>
        <Button type="submit" disabled={!arms.length}>Start run</Button>
        <span className={quiet}>{lab.running} running</span>
        {err && <span role="alert" className="text-sm text-destructive">{err}</span>}
      </form>
      <StatusRow view={panelView("LabPanel", "AnswerRows", runs.length)} empty="No lab runs yet.">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="flex flex-col gap-1">
            {runs.map(x => (
              <Button
                key={x.id}
                variant="ghost"
                aria-current={x.id === shown?.id || undefined}
                className="h-auto flex-col items-start gap-1 px-3 py-2 text-left font-normal whitespace-normal aria-[current=true]:bg-accent aria-[current=true]:text-accent-foreground"
                onClick={() => setSel(x.id)}
              >
                <span>{stamp(x.createdAt)} <span className={x.status === "failed" ? "text-destructive" : "text-muted-foreground"}>· {x.status}{x.status === "running" || x.status === "queued" ? ` ${x.progress.done}/${x.progress.total}` : ""}</span></span>
                <span className="text-muted-foreground">{x.request.arms.join(", ")} · seeds {x.request.seeds.join(",")} · {x.request.days}d</span>
              </Button>
            ))}
          </div>
          {shown && <LabResults run={shown} />}
        </div>
      </StatusRow>
    </div>
  );
}

const secs = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : dur(ms));
const labColumns: DataColumn[] = [
  { key: "arm", label: "Arm" }, { key: "seed", label: "Seed", numeric: true }, { key: "yes", label: "Everyone-yes", numeric: true }, { key: "accept", label: "Accept", numeric: true },
  { key: "meetings", label: "Meetings", numeric: true }, { key: "inv", label: "Invariants", numeric: true }, { key: "leaks", label: "Canary leaks", numeric: true }, { key: "minors", label: "Minor contacts", numeric: true },
];

function LabResults({ run }: { run: LabRun }) {
  const zero = (v: number | null) => <DataCell numeric className={v ? "text-destructive" : v === 0 ? "text-ok" : "text-muted-foreground"}>{v === null ? "–" : num(v)}</DataCell>;
  return (
    <div className="flex min-w-0 flex-col gap-2 md:col-span-2">
      <p className={quiet} title={run.file}>{run.id} · by {run.requestedBy.replace(/^token:/, "")}{run.finishedAt && run.startedAt ? ` · ${secs(run.finishedAt - run.startedAt)}` : ""} · {run.file.split("/").pop()}</p>
      {run.error && <p role="alert" className="text-sm text-destructive">{run.error}</p>}
      <DataTable columns={labColumns} empty={run.results.length ? undefined : run.status === "failed" ? "No results." : "Waiting for results…"}>
        {run.results.map((x, i) => (
          <TableRow key={i}>
            <DataCell>{humanize(x.arm)}</DataCell><DataCell numeric>{x.seed}</DataCell>
            <DataCell numeric>{x.everyoneYes === null ? "–" : pct(x.everyoneYes)}</DataCell><DataCell numeric>{x.accept === null ? "–" : pct(x.accept)}</DataCell>
            <DataCell numeric>{x.meetings === null ? "–" : num(x.meetings)}</DataCell>
            {zero(x.judgeInvariants)}{zero(x.canaryLeaks)}{zero(x.minorContacts)}
          </TableRow>
        ))}
      </DataTable>
    </div>
  );
}

const fmtN = (x: number) => (Number.isInteger(x) ? num(x) : x.toFixed(3));
const diffColumns: DataColumn[] = [{ key: "k", label: "Measure", hideLabel: true }, { key: "a", label: "A", numeric: true }, { key: "b", label: "B", numeric: true }, { key: "d", label: "B − A", numeric: true }];

function DiffTable({ title, rows }: { title: string; rows: Record<string, DiffNum> }) {
  const xs = Object.entries(rows).filter(([, v]) => v.a || v.b);
  if (!xs.length) return null;
  return (
    <InspectorSection title={title}>
      <DataTable columns={diffColumns}>
        {xs.map(([k, v]) => (
          <TableRow key={k}>
            <DataCell>{humanize(k.replace(/([a-z])([A-Z])/g, "$1_$2"))}</DataCell><DataCell numeric muted>{fmtN(v.a)}</DataCell><DataCell numeric>{fmtN(v.b)}</DataCell><DataCell numeric muted={!v.delta}>{v.delta > 0 ? "+" : ""}{fmtN(v.delta)}</DataCell>
          </TableRow>
        ))}
      </DataTable>
    </InspectorSection>
  );
}

function TopList({ items }: { items: EngineRunSummary["top"] }) {
  if (!items.length) return <p className={quiet}>None.</p>;
  return <>{items.slice(0, 12).map(t => <p className="text-sm" key={t.key}><span className="font-mono tabular-nums">{t.score.toFixed(3)}</span> {t.participants.map((p, i) => <span key={p}>{i > 0 && " · "}<Member id={p} first /></span>)} <span className="text-muted-foreground">· {humanize(t.generator)}{t.selected ? " · selected" : ""}</span></p>)}</>;
}

/** Two engine runs side by side: A is the older one. */
export function RunDiffView({ a, b }: { a: string; b: string }) {
  const r = useFetch<RunDiff>(() => store.runDiff(a, b), `${a}|${b}`);
  const d = r.data;
  if (!d) return <StatusRow view={panelView("LabPanel", answerOf(r, false), 0)} error={r.error} />;
  const head = (x: RunDiff["a"]): ReactNode => <>{stamp(x.at)} · {x.engineVersion} · {x.proposals} proposals{x.city ? ` · ${x.city}` : ""}</>;
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm">A: {head(d.a)} <span className="text-muted-foreground">→</span> B: {head(d.b)}</p>
      <div className={grid}>
        <DiffTable title="Funnel" rows={d.funnel} />
        <DiffTable title="Fairness" rows={d.fairness} />
        <DiffTable title="Candidates by generator" rows={d.byGenerator} />
        <DiffTable title="Proposals by generator" rows={d.proposalsByGenerator} />
        <DiffTable title="Why candidates were filtered" rows={d.rejectedBy} />
      </div>
      <div className={grid}>
        <InspectorSection title={`Top configurations only in B (${d.top.added.length})`}><TopList items={d.top.added} /></InspectorSection>
        <InspectorSection title={`Only in A (${d.top.removed.length}) · in both: ${d.top.kept}`}><TopList items={d.top.removed} /></InspectorSection>
      </div>
    </div>
  );
}
