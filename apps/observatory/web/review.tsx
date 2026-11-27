// spec/staffReview.md, "The visible card follows focus and queue order"
// spec/staffReview.md, "A changed card or revision starts a fresh draft"
// spec/staffReview.md, "A mode change applies only to a bound card"
// spec/staffReview.md, "An old response cannot clear or move a newer selection"
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { initial as initialReview, ownsReviewResponse, planPreviewMatchesCard, selectedReviewCard, step as stepReview, type ReviewCtl as ReviewState, type ReviewMode } from "../../../packages/core/src/generated/staffReview.ts";
import { teenFriendMaxAge, teenFriendMinAge, teenRosterSizeAllowed } from "../../../packages/core/src/generated/friendIntroAge.ts";
import { teenFriendApp, teenFriendCategory } from "../../../packages/core/src/generated/matchLane.ts";
import {
  Alert, Button, Countdown, Disclosure, FactLine, Input, ReviewActions as ReviewActionsView,
  ReviewCard, ReviewPerson, Segments, StatusMark, VenueLink as VenueLinkView, type ReviewFlag, type StatusTone,
} from "@thenetwork/ui";
import type { WorkIntroChannel } from "@thenetwork/core";
import { ALL_SEED_VENUES } from "../../../packages/core/src/cities.ts";
import type { ReviewReason, StaffPlanPreview, StaffProbePreview } from "../src/types.ts";
import { VENUES } from "@thenetwork/network/geo";
import { INACTIVE_PARTICIPANT_STATUS, OPEN, originLabel, originOf, REVIEW_REASONS, stateGroupOf, store, useStore, type DecideOpts, type JudgedReviewRow, type Opp, type StateGroup } from "./store.ts";
import { stateLabel } from "./panels.tsx";
import { AreaLink, dur, humanize, MemberLink, OppLink, ScoreParts as SharedScoreParts, stamp } from "./ui.tsx";

export { AreaLink as AreaName, MemberLink as MemberName, OppLink as OppName };
export function ScoreParts({ c }: { c?: Parameters<typeof SharedScoreParts>[0]["c"] }) {
  return <SharedScoreParts c={c} emptyNote />;
}

/** "you" for the signed-in reviewer, "sim" for the simulated one, else the staff id without the token prefix. */
export const reviewerName = (r?: string) =>
  !r ? "" : r === "player" || r === store.me?.id ? "you" : r === "sim_auto_reviewer" ? "sim" : r.replace(/^token:/, "");
const reasonLabel = (r?: string) => store.reasons().find(x => x[0] === r)?.[1].toLowerCase() ?? REVIEW_REASONS.find(x => x[0] === r)?.[1].toLowerCase() ?? (r ? humanize(r) : "");
/** An app's own code travels as "[code] note" with its PRD base code (src/apps.ts): show the app code. */
function reasonOf(rv: { reason?: string; note?: string }): { reason?: string; note?: string } {
  const m = /^\[([a-z_]+)\]\s*(.*)$/s.exec(rv.note ?? "");
  return m && store.reasons().some(x => x[0] === m[1]) ? { reason: m[1], note: m[2] || undefined } : { reason: rv.reason, note: rv.note };
}

const groupTone: Record<StateGroup, StatusTone> = { review: "warn", open: "primary", met: "ok", closed: "neutral" };

export function OppStateMark({ state }: { state: string }) {
  return <StatusMark tone={groupTone[stateGroupOf(state)]} label={stateLabel(state)} />;
}

export function reviewLine(o: Opp): ReactNode {
  const rv = o.review;
  if (!rv) return null;
  const extra = [
    rv.approver ? `via ${rv.approver}` : "",
    rv.judgeVerdict ? `judge: ${humanize(rv.judgeVerdict)}` : "",
    rv.exceptionReason ? `held: ${humanize(rv.exceptionReason)}` : "",
    rv.edits?.length ? "edited" : "",
    rv.rerolls ? `re-rolled ${rv.rerolls}×` : "",
    rv.secondsSpent ? `${rv.secondsSpent < 60 ? `${rv.secondsSpent}s` : dur(rv.secondsSpent * 1000)} on it` : "",
  ].filter(Boolean).join(" · ");
  const tail = extra ? <span className="text-muted-foreground"> · {extra}</span> : null;
  if (!rv.decision) return <span><Countdown deadline={rv.deadline} now={store.now()} deadlineLabel={stamp(rv.deadline)} prefix="Due in " />{tail}</span>;
  if (rv.decision === "expired") return <span className="text-destructive">Expired unsent</span>;
  const after = rv.decidedAt ? ` · ${dur(Math.max(0, rv.decidedAt - rv.queuedAt))} after queue` : "";
  if (rv.invalidated) return <span className="text-warn">Approved by {reviewerName(rv.reviewer) || "reviewer"}, stopped on re-check ({humanize(rv.invalidated)}){tail}</span>;
  if (rv.decision === "approve") return <span>Approved by {rv.approver === "judge" ? "review judge" : (reviewerName(rv.reviewer) || "reviewer")}{after}{tail}</span>;
  const why = reasonOf(rv);
  return <span>Rejected in review{why.reason ? ` · ${reasonLabel(why.reason)}` : ""}{rv.reviewer ? ` · by ${reviewerName(rv.reviewer)}` : ""}{why.note ? ` · “${why.note}”` : ""}{tail}</span>;
}

/** Earlier opportunities with the same participant set. */
export function historyBetween(o: Opp): Opp[] {
  const key = [...o.participants].sort().join("|");
  return [...store.opps.values()].filter(x => x.id !== o.id && x.createdAt <= o.createdAt && [...x.participants].sort().join("|") === key).sort((a, b) => b.createdAt - a.createdAt);
}

/** A member request's objective belongs to its requester. */
export function wantsOf(o: Opp, id: string): string | undefined {
  return originOf(o) === "request" && o.participants[0] === id ? o.objective : undefined;
}

/** Who a re-roll can swap out: everyone but the requester of a member request. */
export const swappable = (o: Opp) => o.participants.filter((id, i) => !(originOf(o) === "request" && i === 0));

type ReviewError = { code?: string; text: string; oppId?: string };
interface ReviewDraft {
  /** The generated review controller state, bound to the card. */
  state: ReviewState;
  mode: ReviewMode; setMode(v: ReviewMode, toggle?: boolean): ReviewMode;
  note: string; setNote(v: string): void;
  awaitingOther: boolean; requireNote(): void;
  noteRef: RefObject<HTMLInputElement | null>;
  /** Edit drafts: participant id -> what they are told; "" key = the plan (objective). */
  drafts: Record<string, string>; setDrafts(v: Record<string, string>): void;
  /** Last refusal, shown under the card it came from (guard errors from an edit, a blocked approve). */
  error: ReviewError | null; setError(v: ReviewError | null): void;
  response(): { current(): boolean; settle(): void };
}
const reviewKey = (o: Opp | undefined) => o ? JSON.stringify([store.app, store.mode, store.authEpoch, o.id, o.review?.deadline, o.review?.rerolls, o.participants]) : "";

type PlanPreview = StaffPlanPreview | "loading" | "unavailable" | undefined;

function realPlanUnderReview(o: Opp | undefined): o is Opp {
  return store.mode === "real" && o?.state === "IN_REVIEW" && originOf(o) === "planner";
}

function usePlanPreview(o: Opp | undefined): PlanPreview {
  const open = realPlanUnderReview(o) && (store.can("reviewer") || store.can("safety"));
  const key = open ? reviewKey(o) : "";
  const app = store.app, id = o?.id, revision = o?.review?.rerolls ?? 0, deadline = o?.review?.deadline;
  const [result, setResult] = useState<{ key: string; preview?: StaffPlanPreview }>();
  useEffect(() => {
    setResult(undefined);
    if (!key || !id || deadline === undefined) return;
    let current = true;
    void store.reviewPlanPreview(id, revision).then(({ data }) => {
      if (!current) return;
      const p = data?.preview;
      // spec/staffReview.md, "Plan approval in the console waits for the selected preview"
      setResult({ key, preview: p && planPreviewMatchesCard(app, p.app, id, p.opportunityId, revision, p.revision, deadline, p.deadline) ? p : undefined });
    });
    return () => { current = false; };
  }, [key, app, id, revision, deadline]);
  if (!key) return undefined;
  return result?.key === key ? result.preview ?? "unavailable" : "loading";
}

function PlanPreviewFacts({ preview }: { preview: PlanPreview }) {
  if (!preview) return null;
  if (typeof preview === "string") return <p role="status" className="text-sm text-muted-foreground">{preview === "loading" ? "Loading the plan for review." : "This plan preview is unavailable."}</p>;
  const localTimeRange = ({ start, end }: { start: number; end: number }) => `${stamp(start)} – ${stamp(end)} ET`;
  return <section className="flex flex-col gap-1 text-sm" aria-label="Plan under review">
    <FactLine parts={[preview.activity, preview.place.name, preview.place.area]} />
    {preview.options && <div>
      <span className="text-muted-foreground">Time options</span>
      <ol role="list" aria-label="Time options">
        {preview.options.map((slot, index) => <li key={slot.start}>{"ABC"[index]}. {localTimeRange(slot)}</li>)}
      </ol>
    </div>}
    <FactLine parts={[!preview.options && localTimeRange(preview), `Quorum ${preview.quorum} · up to ${preview.maxSeats} seats`]} />
    <FactLine parts={[`Invitation deadline ${stamp(preview.probeDeadline)} ET`, <span>Alternates {preview.alternates.length === 0 ? "none" : preview.alternates.map((id, i) => <span key={id}>{i > 0 && ", "}{i + 1}. <MemberLink id={id} /></span>)}</span>]} />
  </section>;
}

function useReviewCtl(cardKey: string): ReviewDraft {
  const [model, setModel] = useState<ReviewState>(initialReview);
  const [note, setNote] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<ReviewError | null>(null);
  const noteRef = useRef<HTMLInputElement>(null);
  const bound = stepReview(model, { type: "bindCard", cardKey });
  const live = useRef(bound);
  const mounted = useRef(false);
  const clearDraft = () => { setNote(""); setDrafts({}); setError(null); };
  const save = (next: ReviewState) => { live.current = next; setModel(next); };

  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useLayoutEffect(() => {
    if (bound === model) return;
    save(bound);
    clearDraft();
  }, [bound, model]);

  const setMode = (requestedMode: ReviewMode, togglePanel = false) => {
    const next = stepReview(live.current, { type: "changeReviewMode", requestedMode, togglePanel });
    save(next);
    return next.mode;
  };
  const requireNote = () => save(stepReview(live.current, { type: "requireReviewNote" }));
  const response = () => {
    const scope = [store.app, store.mode, store.authEpoch] as const;
    const { cardKey, revision } = live.current;
    const current = () => mounted.current && scope[0] === store.app && scope[1] === store.mode && scope[2] === store.authEpoch &&
      ownsReviewResponse(live.current, cardKey, revision);
    return {
      current,
      settle() {
        save(stepReview(live.current, { type: "settleReview", cardKey, revision }));
        clearDraft();
      },
    };
  };
  const changed = bound !== model;
  return {
    state: bound, mode: bound.mode, setMode, note: changed ? "" : note, setNote, awaitingOther: bound.noteNeeded, requireNote,
    noteRef, drafts: changed ? {} : drafts, setDrafts, error: changed ? null : error, setError, response,
  };
}

function teenIntroBlock(o: Opp): string | undefined {
  const members = o.participants.map(id => store.members.get(id));
  if (!members.some(m => m?.minor)) return undefined;
  if (store.game?.unified?.teenStop) return "Teen introductions are stopped";
  if (!teenFriendApp(store.app)) return "Members under 18 are never introduced on this app";
  if (o.category && !teenFriendCategory(store.app, o.category)) return "Members under 18 receive friendship introductions only";
  if (!teenRosterSizeAllowed(true, o.participants.length)) return "Teen introductions must have 2 to 6 people";
  if (members.some(m => m?.ageUnknown)) return "A participant has an unknown age";
  for (const m of members) {
    if (m?.age !== undefined && (m.age < teenFriendMinAge || m.age > teenFriendMaxAge)) {
      return "Nobody aged 19 or older can be introduced to a minor";
    }
  }
  for (let i = 0; i < members.length; i++) {
    const a = members[i];
    if (!a?.minor || a.age === undefined) continue;
    for (const b of members) {
      if (b?.age !== undefined && Math.abs(a.age - b.age) > 2) {
        return "Age gap exceeds 2 years for a teen introduction";
      }
    }
  }
  return undefined;
}

export function approveBlock(o: Opp, preview?: PlanPreview): string | undefined {
  if (!store.canAct()) return "Read-only source";
  if (realPlanUnderReview(o) && (typeof preview !== "object" || !o.review || !planPreviewMatchesCard(store.app, preview.app,
    o.id, preview.opportunityId, o.review.rerolls ?? 0, preview.revision, o.review.deadline, preview.deadline))) return "Open the current plan preview before approving";
  const teenBlock = teenIntroBlock(o);
  if (teenBlock) return teenBlock;
  if (o.participants.some(id => store.members.get(id)?.declined)) return "A participant was declined at join";
  if (store.network?.matchingEnabled === false) return "Proactive matching is off (admin switch)";
  return undefined;
}

/** The edits that differ from the current texts. Undefined when nothing changed. */
function editsOf(o: Opp, drafts: Record<string, string>): Pick<DecideOpts, "explanations" | "objective"> | undefined {
  const explanations: Record<string, string> = {};
  for (const id of o.participants) if (drafts[id] !== undefined && drafts[id]!.trim() !== (o.explanations[id] ?? "").trim()) explanations[id] = drafts[id]!;
  const objective = drafts[""] !== undefined && drafts[""]!.trim() !== o.objective.trim() ? drafts[""] : undefined;
  if (!Object.keys(explanations).length && objective === undefined) return undefined;
  return { ...(Object.keys(explanations).length ? { explanations } : {}), ...(objective !== undefined ? { objective } : {}) };
}

/** Sends a decision with the draft note and edits. Errors stay on the card; a second press while the first is on its way sends nothing and shows nothing. */
async function act(o: Opp, c: ReviewDraft, decision: "approve" | "reject" | "reroll", extra: DecideOpts = {}): Promise<boolean> {
  const response = c.response();
  const edits = decision === "approve" && c.mode === "EditReview" ? editsOf(o, c.drafts) : undefined;
  const r = await store.decide(o, edits ? "edit" : decision, { ...extra, ...edits, note: c.note }, true);
  if (!response.current()) return false;
  if (r.ok) { response.settle(); return true; }
  if (r.code !== "in_flight") c.setError({ code: r.code, text: r.error ?? "refused", oppId: o.id });
  return false;
}

/** Approve, edit, re-roll and reject with one of the app's reason codes. Shared by the queue and the opportunity view. A re-roll keeps the item open with the new person, so the queue stays on it. */
export function ReviewActions({ o, ctl, onDone, planPreview }: { o: Opp; ctl?: ReviewDraft; onDone?: () => void; planPreview?: PlanPreview }) {
  const local = useReviewCtl(ctl ? "" : reviewKey(o));
  const localPreview = usePlanPreview(ctl ? undefined : o);
  const preview = ctl ? planPreview : localPreview;
  const c = ctl ?? local;
  useEffect(() => { store.reviewOpen(o.id); }, [o.id]);
  if (!store.canReview()) return null;
  const block = approveBlock(o, preview);
  const edits = c.mode === "EditReview" ? editsOf(o, c.drafts) : undefined;
  const toggle = (m: ReviewMode) => {
    c.setError(null);
    if (c.setMode(m, true) === "EditReview") c.setDrafts({ ...Object.fromEntries(o.participants.map(id => [id, o.explanations[id] ?? ""])), "": o.objective });
  };
  const reject = async (reason: ReviewReason) => {
    if (reason === "other" && !c.note.trim()) { c.requireNote(); c.noteRef.current?.focus(); return; }
    if (await act(o, c, "reject", { reason })) onDone?.();
  };
  const approve = async () => { if (!block && await act(o, c, "approve")) onDone?.(); };
  return (
    <>{!ctl && <PlanPreviewFacts preview={preview} />}<ReviewActionsView
      ctl={c.state}
      approveBlock={block}
      edited={!!edits}
      reasons={store.reasons().map(([code, label]) => ({ code, label }))}
      swaps={swappable(o).map(id => ({ id, name: store.firstName(id) }))}
      alternates={o.alternates.length}
      edits={o.participants.map(id => ({ id, label: `Told ${store.firstName(id)}`, value: c.drafts[id] ?? "" }))}
      plan={c.drafts[""] ?? ""}
      note={c.note}
      onNoteChange={c.setNote}
      noteRef={c.noteRef}
      onEditChange={(id, value) => c.setDrafts({ ...c.drafts, [id]: value })}
      onPlanChange={value => c.setDrafts({ ...c.drafts, "": value })}
      onApprove={() => void approve()}
      onToggleMode={toggle}
      onLeaveMode={() => { if (c.mode !== "IdleReview") c.setMode("IdleReview"); }}
      onReject={code => void reject(code as ReviewReason)}
      onReroll={id => void act(o, c, "reroll", { swapOut: id })}
      error={c.error && c.error.oppId === o.id ? c.error : undefined}
    /></>
  );
}

/**
 * The human review queue (PRD 32.8, PRD 35 review module). Every network-composed opportunity waits here before any member is contacted. Cards sort by deadline; the selected card opens.
 * Keys, while the Review tab is open and no field has focus: j and k move, a approves, r then 1 to 8 rejects with a reason, e edits what each person is told, s then 1 to n swaps a person, n goes to the note, x opens the score, Enter opens the opportunity, Esc leaves the mode. The queue reads the keys in the capture phase, so Esc leaves a mode before the global keys see it. The time from opening a card to the decision goes with the decision.
 */
export function ReviewQueue() {
  const s = useStore();
  const view = s.ui.reviewView;
  const pending = s.reviewPending();
  const decided = view === "decided" ? s.reviewDecided() : [];
  const f = s.ui.focus;
  const [selId, setSelId] = useState<string>();
  const [scoreOpen, setScoreOpen] = useState(false);
  const selectedId = selectedReviewCard(pending.map(o => o.id), f?.kind === "opportunity" ? f.id : "", selId ?? "");
  const sel = pending.find(o => o.id === selectedId);
  const ctl = useReviewCtl(view === "pending" ? reviewKey(sel) : "");
  const preview = usePlanPreview(view === "pending" ? sel : undefined);
  const counts = s.network?.review ?? countDecisions();

  const select = (o: Opp | undefined, mapFocus = true) => {
    if (!o) return;
    setSelId(o.id); setScoreOpen(false);
    if (mapFocus) store.focus({ kind: "opportunity", id: o.id }, { replace: store.ui.focus?.kind === "opportunity" });
  };
  const next = () => { const i = sel ? pending.indexOf(sel) : -1; return pending[i + 1] ?? pending[i - 1]; };
  const afterDecision = () => { const n = live.current.next(); if (n) live.current.select(n); else setSelId(undefined); };

  const live = useRef({ pending, sel, ctl, view, select, next, afterDecision, preview });
  useLayoutEffect(() => { live.current = { pending, sel, ctl, view, select, next, afterDecision, preview }; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as Element | null)?.closest?.("input, textarea, select")) return;
      const { pending, sel, ctl, view, select, afterDecision, preview } = live.current;
      if (view !== "pending") return;
      const handled = () => { e.preventDefault(); e.stopImmediatePropagation(); };
      if (e.key === "Escape" && ctl.mode !== "IdleReview") { handled(); ctl.setMode("IdleReview"); return; }
      if (!sel) return;
      const i = pending.indexOf(sel);
      const canAct = store.canReview();
      if (e.key === "j") { handled(); select(pending[Math.min(pending.length - 1, i + 1)]); }
      else if (e.key === "k") { handled(); select(pending[Math.max(0, i - 1)]); }
      else if (e.key === "a" && canAct) { handled(); if (!approveBlock(sel, preview)) act(sel, ctl, "approve").then(ok => { if (ok) afterDecision(); }); }
      else if (e.key === "r" && canAct) { handled(); ctl.setError(null); ctl.setMode("RejectReview"); }
      else if (e.key === "s" && canAct && swappable(sel).length) { handled(); ctl.setError(null); ctl.setMode("RerollReview"); }
      else if (e.key === "e" && canAct) {
        handled(); ctl.setError(null);
        ctl.setDrafts({ ...Object.fromEntries(sel.participants.map(id => [id, sel.explanations[id] ?? ""])), "": sel.objective });
        ctl.setMode("EditReview");
      }
      else if (ctl.mode === "RejectReview" && /^[1-8]$/.test(e.key)) {
        handled();
        const pick = store.reasons()[Number(e.key) - 1];
        if (!pick) return;
        const reason = pick[0] as ReviewReason;
        if (reason === "other" && !ctl.note.trim()) { ctl.requireNote(); ctl.noteRef.current?.focus(); return; }
        act(sel, ctl, "reject", { reason }).then(ok => { if (ok) afterDecision(); });
      }
      else if (ctl.mode === "RerollReview" && /^[1-6]$/.test(e.key)) {
        const out = swappable(sel)[Number(e.key) - 1];
        if (out) { handled(); act(sel, ctl, "reroll", { swapOut: out }); }
      }
      else if (e.key === "n") { handled(); ctl.noteRef.current?.focus(); }
      else if (e.key === "x") { handled(); setScoreOpen(v => !v); }
      else if (e.key === "Enter") { handled(); store.focus({ kind: "opportunity", id: sel.id }); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const empty = <p className="py-2 text-sm text-muted-foreground">{s.nothing()}</p>;
  const canJudged = s.mode === "real" && (s.can("reviewer") || s.can("safety"));
  const viewOptions = [
    { value: "pending", label: "Pending" },
    { value: "decided", label: "Decided" },
    ...(canJudged ? [{ value: "judged", label: "Judged" }] : []),
  ];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-muted-foreground">approved {counts.approved} · rejected {counts.rejected} · expired {counts.expired}</span>
        {s.network?.matchingEnabled === false && <StatusMark tone="warn" label="matching off" title="An admin turned proactive matching off: approvals wait" showLabel />}
        {!s.canAct() && <span className="text-muted-foreground">read-only</span>}
        <Segments
          className="ml-auto"
          aria-label="Review view"
          value={view === "judged" && !canJudged ? "pending" : view}
          onValueChange={v => store.setUI({ reviewView: v as "pending" | "decided" | "judged" })}
          options={viewOptions}
        />
      </div>
      {view === "judged" && canJudged ? (
        <JudgedReviewsList />
      ) : view === "pending" ? (
        pending.length ? (
          <div className="flex flex-col gap-2">
            {pending.map(o => (
              <QueueCard key={o.id} o={o} selected={o.id === sel?.id} planPreview={o.id === sel?.id ? preview : undefined} onSelect={() => select(o)} ctl={ctl} scoreOpen={scoreOpen} setScoreOpen={setScoreOpen} onDone={afterDecision} />
            ))}
          </div>
        ) : empty
      ) : (
        decided.length ? (
          <ul className="flex flex-col gap-1">
            {decided.slice(0, 100).map(o => (
              <li className="flex flex-wrap items-center gap-2 text-sm" key={o.id}>
                <OppStateMark state={o.state} /><OppLink o={o} /> <span className="text-muted-foreground">{originLabel(originOf(o))}</span>
                <span>{reviewLine(o)}</span>
                <span className="ml-auto text-muted-foreground">{o.review?.decidedAt ? stamp(o.review.decidedAt) : ""}</span>
              </li>
            ))}
          </ul>
        ) : empty
      )}
    </div>
  );
}

function JudgedReviewsList() {
  const s = useStore();
  const [rows, setRows] = useState<JudgedReviewRow[] | null>(null);
  const [error, setError] = useState("");
  const [stopId, setStopId] = useState<string | null>(null);
  const [stopReason, setStopReason] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => {
    void store.judgedReviews().then(r => {
      if (r.data) { setRows(r.data.items ?? r.data.reviews ?? []); setError(""); }
      else setError(r.error ?? "Could not load judged reviews");
    });
  };
  useEffect(() => { load(); }, [s.app, s.mode]);
  const stop = async (id: string) => {
    const trimmed = stopReason.trim();
    if (trimmed.length < 5 || busy) return;
    setBusy(true);
    const r = await store.stopApprovedReview(id, trimmed);
    setBusy(false);
    if (r.data?.ok !== false && r.status === 200) {
      store.toast("Stopped approved introduction before reveal", "good");
      setStopId(null);
      setStopReason("");
      load();
    } else {
      store.toast(r.error ?? r.data?.error ?? "Could not stop introduction", "bad");
    }
  };
  if (error) return <Alert variant="destructive">{error}</Alert>;
  if (rows === null) return <p className="py-2 text-sm text-muted-foreground">Loading judged items…</p>;
  if (!rows.length) return <p className="py-2 text-sm text-muted-foreground">No judge-approved items yet.</p>;
  return (
    <div className="flex flex-col gap-2">
      {rows.slice(0, 80).map(item => {
        const opp = s.opps.get(item.opportunityId);
        const canStop = s.canAct() && !item.stopped;
        const tone: StatusTone = item.stopped ? "destructive" : item.verdict === "approve" ? "ok" : "warn";
        return (
          <div key={`${item.opportunityId}:${item.revision}`} className="flex flex-col gap-2 rounded-md border border-border bg-card p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <StatusMark tone={tone} label={item.stopped ? "stopped" : humanize(item.verdict ?? "judged")} showLabel />
              {opp ? <OppLink o={opp} /> : <span className="font-medium">{item.opportunityId}</span>}
              {item.exceptionReason && <span className="text-warn">· {humanize(item.exceptionReason)}</span>}
              {item.decidedAt && <span className="ml-auto text-muted-foreground tabular-nums">{stamp(item.decidedAt)}</span>}
            </div>
            {item.objective && <p className="text-foreground">{item.objective}</p>}
            {item.explanation && <p className="text-muted-foreground">{item.explanation}</p>}
            {canStop && (
              stopId === item.opportunityId ? (
                <form className="flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); void stop(item.opportunityId); }}>
                  <Input className="min-w-48 flex-1" aria-label="Reason to stop before reveal" placeholder="Reason (5+ chars, audited)…" value={stopReason} onChange={e => setStopReason(e.target.value)} />
                  <Button variant="destructive" size="sm" type="submit" disabled={stopReason.trim().length < 5 || busy}>Confirm stop</Button>
                  <Button variant="ghost" size="sm" type="button" onClick={() => { setStopId(null); setStopReason(""); }}>Cancel</Button>
                </form>
              ) : (
                <div>
                  <Button variant="outline" size="sm" onClick={() => setStopId(item.opportunityId)}>Stop before reveal</Button>
                </div>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}

function countDecisions() {
  const c = { approved: 0, rejected: 0, expired: 0 };
  for (const o of store.opps.values()) {
    const d = o.review?.decision;
    if (d === "approve") c.approved++; else if (d === "reject") c.rejected++; else if (d === "expired") c.expired++;
  }
  return c;
}

function flagsOf(o: Opp, id: string): ReviewFlag[] {
  const m = store.members.get(id);
  const flags: ReviewFlag[] = [];
  if (m?.minor) {
    const blocked = teenIntroBlock(o);
    flags.push({
      tone: blocked ? "destructive" : "warn",
      label: "Under 18",
      title: blocked ?? "Teen friendship intro: strict age and review rubric applies.",
    });
  }
  if (m?.trust === "hold") flags.push({ tone: "destructive", label: "Hold" });
  if (m?.trust === "watch") flags.push({ tone: "warn", label: "Watch" });
  if (isBusyElsewhere(o, id)) flags.push({ tone: "warn", label: "busy", title: "In another open opportunity" });
  return flags;
}

function ProbePreviewDisclosure({ o }: { o: Opp }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<StaffProbePreview | null>(null);
  const [error, setError] = useState("");
  const revision = o.review?.rerolls ?? 0;
  useEffect(() => {
    setPreview(null);
    setError("");
  }, [o.id, revision]);
  useEffect(() => {
    if (!open || preview || error) return;
    let live = true;
    void store.reviewProbes(o.id, revision).then(r => {
      if (!live) return;
      if (r.data?.preview) setPreview(r.data.preview);
      else setError(r.error ?? "Copy preview unavailable");
    });
    return () => { live = false; };
  }, [open, o.id, revision, preview, error]);
  if (store.mode !== "real" || (!store.can("reviewer") && !store.can("safety"))) return null;
  return (
    <Disclosure open={open} onOpenChange={setOpen} summary="Copy preview (probes & reveal)">
      {error ? <p className="text-sm text-muted-foreground">{error}</p>
        : !preview ? <p className="text-sm text-muted-foreground">Loading copy preview…</p>
        : (
          <div className="flex flex-col gap-2 text-sm">
            {preview.probes.map(p => (
              <div key={p.memberId} className="flex flex-col gap-1 rounded-md border border-border p-2">
                <MemberLink id={p.memberId} />
                {p.text && <div><span className="text-muted-foreground">Probe:</span> {p.text}</div>}
                {p.fallback && <div className="text-muted-foreground">Fallback: {p.fallback}</div>}
                <div><span className="text-muted-foreground">Reveal:</span> {p.reveal.text}</div>
              </div>
            ))}
          </div>
        )}
    </Disclosure>
  );
}

function QueueCard({ o, selected, onSelect, ctl, scoreOpen, setScoreOpen, onDone, planPreview }: {
  o: Opp; selected: boolean; onSelect(): void; ctl: ReviewDraft; scoreOpen: boolean; setScoreOpen(v: boolean): void; onDone(): void; planPreview?: PlanPreview;
}) {
  const s = store;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (selected) ref.current?.scrollIntoView({ block: "nearest" }); }, [selected, o.review?.deadline]);
  const hist = selected ? historyBetween(o) : [];
  const editing = selected && ctl.mode === "EditReview";
  const rv = o.review;
  return (
    <ReviewCard
      ref={ref}
      ctl={ctl.state}
      selected={selected}
      onSelect={onSelect}
      title={s.oppTitle(o)}
      meta={`${humanize(o.kind)}${o.category ? ` · ${o.category}` : ""} · ${originLabel(originOf(o))}${rv?.rerolls ? ` · re-rolled ${rv.rerolls}×` : ""}`}
      score={o.source !== "player" ? `score ${o.score.toFixed(2)}` : undefined}
      due={rv ? <Countdown deadline={rv.deadline} now={s.now()} deadlineLabel={stamp(rv.deadline)} /> : <span className="text-muted-foreground">–</span>}
    >
      {(rv?.judgeVerdict || rv?.exceptionReason || rv?.judgeExplanation) && (
        <Alert variant={rv.judgeVerdict === "approve" ? "ok" : rv.judgeVerdict === "flag" ? "destructive" : "warn"}>
          <div className="flex flex-col gap-1">
            <FactLine parts={[
              rv.judgeVerdict && `Review judge: ${humanize(rv.judgeVerdict)}`,
              rv.exceptionReason && `Held: ${humanize(rv.exceptionReason)}`,
            ]} />
            {rv.judgeExplanation && <p className="text-sm">{rv.judgeExplanation}</p>}
          </div>
        </Alert>
      )}
      {o.participants.map(id => (
        <ReviewPerson
          key={id}
          name={<MemberLink id={id} />}
          place={<AreaLink area={s.members.get(id)?.area} />}
          flags={flagsOf(o, id)}
          wants={wantsOf(o, id)}
          told={editing ? undefined : o.explanations[id]}
        />
      ))}
      {!editing && (
        <FactLine parts={[
          <span><span className="text-muted-foreground">Plan:</span> <span className="text-foreground">{o.objective}</span></span>,
          o.venue && <VenueLink venue={o.venue} />,
          o.backupVenue && <span><span className="text-muted-foreground">Backup:</span> <VenueLink venue={o.backupVenue} /></span>,
          o.workIntroChannel && <span><span className="text-muted-foreground">Channel:</span> {workChannelLabel(o.workIntroChannel)}</span>,
          o.meetingAt && stamp(o.meetingAt, o.city),
        ]} />
      )}
      <PlanPreviewFacts preview={planPreview} />
      {selected && <ProbePreviewDisclosure o={o} />}
      <FactLine parts={[
        <span>History: {hist.length ? hist.slice(0, 3).map((h, i) => <span key={h.id}>{i > 0 && ", "}<OppLink o={h}>{humanize(h.state)} {stamp(h.createdAt)}</OppLink></span>) : "none"}</span>,
        !planPreview && o.alternates.length > 0 && <span>Alternates: {o.alternates.map((a, i) => <span key={a}>{i > 0 && ", "}<MemberLink id={a} /></span>)}</span>,
      ]} />
      {o.source !== "player" && o.components && (
        <Disclosure
          open={scoreOpen}
          onOpenChange={setScoreOpen}
          summary={`Score ${o.score.toFixed(2)}${o.exploration ? " · exploration" : ""}`}
        >
          <ScoreParts c={o.components} />
        </Disclosure>
      )}
      <ReviewActions o={o} ctl={ctl} onDone={onDone} planPreview={planPreview} />
    </ReviewCard>
  );
}

/** In another open opportunity: the Network does not double-book. */
export function isBusyElsewhere(o: Opp, id: string) {
  for (const x of store.opps.values()) if (x.id !== o.id && x.source !== "shadow" && OPEN.has(x.state) && x.participants.includes(id) && !INACTIVE_PARTICIPANT_STATUS.has(x.status[id]) && !x.booked?.cancelled[id]) return true;
  return false;
}

export function workChannelLabel(channel: WorkIntroChannel): string {
  switch (channel) {
    case "WarmEmail": return "Warm email";
    case "ScheduledVideo": return "Scheduled video";
    case "RelayShare": return "Relay / number share";
    case "NoChannel": return "No channel";
  }
}

export function VenueLink({ venue }: { venue: { id?: string; name: string; lat: number; lng: number; neighborhood?: string } }) {
  const area = venue.neighborhood
    ?? store.venuesList.find(v => (venue.id && v.id === venue.id) || v.name === venue.name)?.neighborhood
    ?? ALL_SEED_VENUES.find(v => (venue.id && v.id === venue.id) || v.name === venue.name)?.neighborhood
    ?? VENUES.find(v => v.name === venue.name)?.neighborhood;
  return <span><VenueLinkView onShow={() => store.flyTo(venue.lat, venue.lng)}>{venue.name}</VenueLinkView>{area && <> · <AreaLink area={area} /></>}</span>;
}
