// Human review queue (PRD 32.8, PRD 35 review module). Every network-composed opportunity waits
// here before any member is contacted. Cards sort by deadline; the selected card expands.
// A card shows the texts the app's pack would send (the probe per person, the reveal); an edit
// replaces a person's probe. SHADOW cards are labels only (matching off, shadow on): approve or reject
// records the label and nobody is contacted. SECOND cards are blind second reviews of an item someone
// else decided: the first decision is not shown and the second changes nothing. slop cards never show
// a score or its components (docs/review-rubric-slop.md). Compose: a reviewer's own opportunity.
// Keyboard (Review tab open, no input focused): j/k move, a approve, r then 1-8 reject with a
// reason, e edit what each person is told, s then 1-n re-roll (swap that person), n note, x score,
// Enter open, Esc leaves the current mode. The time from opening a card to the decision is sent with it.
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { ReviewReason } from "../src/types.ts";
import { VENUES } from "@thenetwork/network/geo";
import { OPEN, originLabel, originOf, REVIEW_REASONS, store, useStore, type DecideOpts, type Opp } from "./store.ts";
import { AreaLink, Badge, Components, Countdown, dur, humanize, MemberLink, OppLink, oppDot, stamp, StatusLine } from "./ui.tsx";

/** "you" for the signed-in reviewer, "sim" for the simulated one, else the staff id without the token prefix. */
export const reviewerName = (r?: string) =>
  !r ? "" : r === "player" || r === store.me?.id ? "you" : r === "sim_auto_reviewer" ? "sim" : r.replace(/^token:/, "");
const reasonLabel = (r?: string) => store.reasons().find(x => x[0] === r)?.[1].toLowerCase() ?? REVIEW_REASONS.find(x => x[0] === r)?.[1].toLowerCase() ?? (r ? humanize(r) : "");
/** An app's own code travels as "[code] note" with its PRD base code (src/apps.ts): show the app code. */
function reasonOf(rv: { reason?: string; note?: string }): { reason?: string; note?: string } {
  const m = /^\[([a-z_]+)\]\s*(.*)$/s.exec(rv.note ?? "");
  return m && store.reasons().some(x => x[0] === m[1]) ? { reason: m[1], note: m[2] || undefined } : { reason: rv.reason, note: rv.note };
}

/** A blind second review waiting for this console (someone else made the first decision). */
export const isSecond = (o: Opp) => o.state !== "IN_REVIEW" && o.review?.second?.status === "pending";
/** slop never shows a score, its components or anything about looks to a reviewer. */
const noScores = () => store.app === "slop";

/** One line for the review state: countdown while queued, then the decision. */
export function reviewLine(o: Opp): ReactNode {
  const rv = o.review;
  if (!rv) return null;
  if (rv.shadow && rv.decision && rv.decision !== "expired") return <span>Shadow label: {rv.decision === "approve" ? "good" : "not good"}{rv.reviewer ? ` · by ${reviewerName(rv.reviewer)}` : ""} · nobody contacted</span>;
  const extra = [
    rv.edits?.length ? "edited" : "",
    rv.rerolls ? `re-rolled ${rv.rerolls}×` : "",
    rv.secondsSpent ? `${rv.secondsSpent < 60 ? `${rv.secondsSpent}s` : dur(rv.secondsSpent * 1000)} on it` : "",
  ].filter(Boolean).join(" · ");
  const tail = extra ? <span className="muted"> · {extra}</span> : null;
  if (!rv.decision) return <span><Countdown deadline={rv.deadline} prefix="Due in " />{tail}</span>;
  if (rv.decision === "expired") return <span className="bad">Expired unsent</span>;
  const after = rv.decidedAt ? ` · ${dur(Math.max(0, rv.decidedAt - rv.queuedAt))} after queue` : "";
  if (rv.invalidated) return <span className="warn-text">Approved by {reviewerName(rv.reviewer) || "reviewer"}, stopped on re-check ({humanize(rv.invalidated)}){tail}</span>;
  if (rv.decision === "approve") return <span>Approved by {reviewerName(rv.reviewer) || "reviewer"}{after}{tail}</span>;
  const why = reasonOf(rv);
  return <span>Rejected in review{why.reason ? ` · ${reasonLabel(why.reason)}` : ""}{rv.reviewer ? ` · by ${reviewerName(rv.reviewer)}` : ""}{why.note ? ` · “${why.note}”` : ""}{tail}</span>;
}

/** Earlier opportunities with the same participant set. */
export function historyBetween(o: Opp): Opp[] {
  const key = [...o.participants].sort().join("|");
  return [...store.opps.values()].filter(x => x.id !== o.id && x.createdAt <= o.createdAt && [...x.participants].sort().join("|") === key).sort((a, b) => b.createdAt - a.createdAt);
}

/** The intent each side is based on. Without the `wants` payload: the requester's objective only. */
export function wantsOf(o: Opp, id: string): string | undefined {
  if (o.wants) return o.wants[id];
  return originOf(o) === "request" && o.participants[0] === id ? o.objective : undefined;
}

/** Who a re-roll can swap out: everyone but the requester of a member request. */
export const swappable = (o: Opp) => o.participants.filter((id, i) => !(originOf(o) === "request" && i === 0));

// ---------------------------------------------------------------- actions
type ReviewMode = "none" | "reject" | "edit" | "reroll";
type ReviewError = { code?: string; text: string; oppId?: string };
interface ReviewCtl {
  mode: ReviewMode; setMode(v: ReviewMode): void;
  note: string; setNote(v: string): void;
  awaitingOther: boolean; setAwaitingOther(v: boolean): void;
  noteRef: RefObject<HTMLInputElement | null>;
  /** Edit drafts: participant id -> what they are told; "" key = the plan (objective). */
  drafts: Record<string, string>; setDrafts(v: Record<string, string>): void;
  /** Last refusal, shown under the card it came from (guard errors from an edit, a blocked approve). */
  error: ReviewError | null; setError(v: ReviewError | null): void;
  reset(): void;
}
function useReviewCtl(): ReviewCtl {
  const [mode, setMode] = useState<ReviewMode>("none");
  const [note, setNote] = useState("");
  const [awaitingOther, setAwaitingOther] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<ReviewError | null>(null);
  const noteRef = useRef<HTMLInputElement>(null);
  const reset = () => { setMode("none"); setNote(""); setAwaitingOther(false); setDrafts({}); setError(null); };
  return { mode, setMode, note, setNote, awaitingOther, setAwaitingOther, noteRef, drafts, setDrafts, error, setError, reset };
}

/** Why approval is blocked for this opportunity, if it is. A shadow label or a second review sends nothing, so matching may be off. */
export function approveBlock(o: Opp): string | undefined {
  if (!store.canAct()) return "Read-only source";
  if (o.participants.some(id => store.members.get(id)?.minor)) return "Members under 18 are never introduced";
  if (o.participants.some(id => store.members.get(id)?.declined)) return "A participant was declined at join";
  if (store.network?.matchingEnabled === false && !o.review?.shadow && !isSecond(o)) return "Proactive matching is off (admin switch)";
  return undefined;
}

/** Edit drafts: "<id>" what a person is told, "p:<id>" their probe, "" the plan. */
const probeKey = (id: string) => `p:${id}`;
function startDrafts(o: Opp): Record<string, string> {
  const probes = o.review?.drafts?.probe ?? {};
  return { ...Object.fromEntries(o.participants.map(id => [id, o.explanations[id] ?? ""])), ...Object.fromEntries(Object.entries(probes).map(([id, t]) => [probeKey(id), t])), "": o.objective };
}

/** The edits that differ from the current texts. Undefined when nothing changed. */
function editsOf(o: Opp, drafts: Record<string, string>): Pick<DecideOpts, "explanations" | "objective" | "probes"> | undefined {
  const explanations: Record<string, string> = {}, probes: Record<string, string> = {};
  for (const id of o.participants) if (drafts[id] !== undefined && drafts[id]!.trim() !== (o.explanations[id] ?? "").trim()) explanations[id] = drafts[id]!;
  for (const [id, t] of Object.entries(o.review?.drafts?.probe ?? {})) { const d = drafts[probeKey(id)]; if (d !== undefined && d.trim() !== t.trim()) probes[id] = d; }
  const objective = drafts[""] !== undefined && drafts[""]!.trim() !== o.objective.trim() ? drafts[""] : undefined;
  if (!Object.keys(explanations).length && !Object.keys(probes).length && objective === undefined) return undefined;
  return { ...(Object.keys(explanations).length ? { explanations } : {}), ...(Object.keys(probes).length ? { probes } : {}), ...(objective !== undefined ? { objective } : {}) };
}

/** Send a decision with the controller's note and edits; errors stay on the card. */
async function act(o: Opp, c: ReviewCtl, decision: "approve" | "reject" | "reroll", extra: DecideOpts = {}): Promise<boolean> {
  const edits = decision === "approve" && c.mode === "edit" ? editsOf(o, c.drafts) : undefined;
  const r = await store.decide(o, edits ? "edit" : decision, { ...extra, ...edits, note: c.note }, true);
  if (r.ok) { c.reset(); return true; }
  // A second press while the first is on its way: nothing was sent.
  if (r.code !== "in_flight") c.setError({ code: r.code, text: r.error ?? "refused", oppId: o.id });
  return false;
}

/** Approve, edit, re-roll and reject with one of the app's reason codes. Shared by the queue and the opportunity view. */
export function ReviewActions({ o, ctl, onDone }: { o: Opp; ctl?: ReviewCtl; onDone?: () => void }) {
  const local = useReviewCtl();
  const c = ctl ?? local;
  useEffect(() => { store.reviewOpen(o.id); }, [o.id]);
  if (!store.canReview()) return null;
  const block = approveBlock(o);
  const edits = c.mode === "edit" ? editsOf(o, c.drafts) : undefined;
  // A shadow label or a blind second review is approve or reject only.
  const labelOnly = !!o.review?.shadow || isSecond(o);
  const swap = labelOnly ? [] : swappable(o);
  const probes = o.review?.drafts?.probe ?? {};
  const toggle = (m: ReviewMode) => {
    c.setError(null); c.setAwaitingOther(false);
    if (c.mode === m) { c.setMode("none"); return; }
    if (m === "edit") c.setDrafts(startDrafts(o));
    c.setMode(m);
  };
  const reject = async (reason: ReviewReason) => {
    if (reason === "other" && !c.note.trim()) { c.setAwaitingOther(true); c.noteRef.current?.focus(); return; }
    if (await act(o, c, "reject", { reason })) onDone?.();
  };
  const approve = async () => { if (!block && await act(o, c, "approve")) onDone?.(); };
  // A re-roll keeps the item waiting with the new person (or closes it): stay on it.
  const reroll = (out: string) => act(o, c, "reroll", { swapOut: out });
  return (
    <div className="review-act">
      {c.mode === "edit" && (
        <div className="review-edit">
          {o.participants.map(id => (
            <div key={id}>
              {probes[id] !== undefined && (
                <label className="edit-row">
                  <span className="muted small" title="The anonymous probe this person gets (time options are added when it goes out). Leak-checked; on slop, nothing about looks.">Probe to {store.firstName(id)}</span>
                  <textarea className="input" rows={3} value={c.drafts[probeKey(id)] ?? ""} onChange={e => c.setDrafts({ ...c.drafts, [probeKey(id)]: e.target.value })} />
                </label>
              )}
              <label className="edit-row">
                <span className="muted small">Told {store.firstName(id)}</span>
                <textarea className="input" rows={2} value={c.drafts[id] ?? ""} onChange={e => c.setDrafts({ ...c.drafts, [id]: e.target.value })} />
              </label>
            </div>
          ))}
          <label className="edit-row">
            <span className="muted small">Plan</span>
            <input className="input" value={c.drafts[""] ?? ""} onChange={e => c.setDrafts({ ...c.drafts, "": e.target.value })} />
          </label>
        </div>
      )}
      {c.mode === "reroll" && (
        <div className="review-actions">
          <span className="muted small">Swap out</span>
          {swap.map((id, i) => <button key={id} className="chip" onClick={() => reroll(id)}><kbd>{i + 1}</kbd> {store.firstName(id)}</button>)}
          <span className="muted small">{o.alternates.length ? `${o.alternates.length} alternate${o.alternates.length > 1 ? "s" : ""}` : "No alternates: it closes and the engine composes again"}</span>
        </div>
      )}
      <div className={`review-actions ${c.mode === "reject" ? "rejecting" : ""}`}>
        <button className="btn primary" disabled={!!block} title={block ?? (o.review?.shadow ? "Label: a good match (a). Nobody is contacted." : "Approve (a)")} onClick={approve}>{edits ? "Approve with edits" : o.review?.shadow ? "Good match" : "Approve"}</button>
        {!labelOnly && <button className={c.mode === "edit" ? "btn active" : "btn"} title="Edit the probe and what each person is told (e)" onClick={() => toggle("edit")}>Edit</button>}
        {!labelOnly && <button className={c.mode === "reroll" ? "btn active" : "btn"} disabled={!swap.length} title={swap.length ? "Swap a participant for an alternate (s)" : "Nobody can be swapped"} onClick={() => toggle("reroll")}>Re-roll</button>}
        <button className={c.mode === "reject" ? "btn active" : "btn"} title="Reject with a reason (r)" onClick={() => toggle("reject")}>Reject ▾</button>
        {c.mode === "reject" && (
          <span className="reasons">
            {store.reasons().map(([k, label], i) => (
              <button key={k} className={c.awaitingOther && k === "other" ? "chip active" : "chip"} onClick={() => reject(k as ReviewReason)}><kbd>{i + 1}</kbd> {label}</button>
            ))}
          </span>
        )}
        <input
          ref={c.noteRef} className="input grow note" placeholder={c.awaitingOther ? "Note (required for Other)" : "Note"} value={c.note}
          onChange={e => c.setNote(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") { e.preventDefault(); if (c.awaitingOther && c.note.trim()) reject("other"); }
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); (e.target as HTMLInputElement).blur(); if (c.mode !== "none") { c.setMode("none"); c.setAwaitingOther(false); } }
          }}
        />
      </div>
      {c.error && c.error.oppId === o.id && <div className="callout bad small" role="alert">{c.error.text}{c.error.code ? <span className="muted"> · {c.error.code}</span> : null}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- queue
export function ReviewQueue() {
  const s = useStore();
  const game = !!s.env?.capabilities.canIntervene;
  const view = s.ui.reviewView;
  const pending = s.reviewPending();
  const decided = view === "decided" ? s.reviewDecided() : [];
  const f = s.ui.focus;
  const [selId, setSelId] = useState<string>();
  const [scoreOpen, setScoreOpen] = useState(false);
  const ctl = useReviewCtl();
  const [composing, setComposing] = useState(false);
  const sel = (f?.kind === "opportunity" && pending.find(o => o.id === f.id)) || pending.find(o => o.id === selId) || pending[0];
  const counts = s.network?.review ?? countDecisions();

  const select = (o: Opp | undefined, mapFocus = true) => {
    if (!o) return;
    if (o.id !== sel?.id) ctl.reset();
    setSelId(o.id); setScoreOpen(false);
    if (mapFocus) store.focus({ kind: "opportunity", id: o.id }, { replace: store.ui.focus?.kind === "opportunity" });
  };
  const next = () => { const i = sel ? pending.indexOf(sel) : -1; return pending[i + 1] ?? pending[i - 1]; };
  const afterDecision = () => { const n = next(); if (n) select(n); else setSelId(undefined); };

  // The queue owns its keyboard while mounted (capture phase, so Esc leaves a mode before the global chain).
  const live = useRef({ pending, sel, ctl, view, select, afterDecision });
  live.current = { pending, sel, ctl, view, select, afterDecision };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as Element | null)?.closest?.("input, textarea, select")) return;
      const { pending, sel, ctl, view, select, afterDecision } = live.current;
      if (view !== "pending") return;
      const handled = () => { e.preventDefault(); e.stopImmediatePropagation(); };
      if (e.key === "Escape" && ctl.mode !== "none") { handled(); ctl.setMode("none"); ctl.setAwaitingOther(false); return; }
      if (!sel) return;
      const i = pending.indexOf(sel);
      const canAct = store.canReview();
      if (e.key === "j") { handled(); select(pending[Math.min(pending.length - 1, i + 1)]); }
      else if (e.key === "k") { handled(); select(pending[Math.max(0, i - 1)]); }
      else if (e.key === "a" && canAct) { handled(); if (!approveBlock(sel)) act(sel, ctl, "approve").then(ok => { if (ok) afterDecision(); }); }
      else if (e.key === "r" && canAct) { handled(); ctl.setError(null); ctl.setMode("reject"); ctl.setAwaitingOther(false); }
      else if (e.key === "s" && canAct && !sel.review?.shadow && !isSecond(sel) && swappable(sel).length) { handled(); ctl.setError(null); ctl.setMode("reroll"); }
      else if (e.key === "e" && canAct && !sel.review?.shadow && !isSecond(sel)) {
        handled(); ctl.setError(null);
        ctl.setDrafts(startDrafts(sel));
        ctl.setMode("edit");
      }
      else if (ctl.mode === "reject" && /^[1-8]$/.test(e.key)) {
        handled();
        const pick = store.reasons()[Number(e.key) - 1];
        if (!pick) return;
        const reason = pick[0] as ReviewReason;
        if (reason === "other" && !ctl.note.trim()) { ctl.setAwaitingOther(true); ctl.noteRef.current?.focus(); return; }
        act(sel, ctl, "reject", { reason }).then(ok => { if (ok) afterDecision(); });
      }
      else if (ctl.mode === "reroll" && /^[1-6]$/.test(e.key)) {
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

  const mode = s.reviewMode();
  return (
    <div className="review">
      <div className="filters">
        {game && s.isAdmin() && (
          <div className="seg" role="radiogroup" aria-label="Reviewer" title="Who approves network-composed opportunities before anyone is contacted">
            <span className="muted small">Reviewer</span>
            <button className={mode === "auto" ? "active" : ""} onClick={() => store.control({ type: "review_mode", mode: "auto" })}>Sim</button>
            <button className={mode === "human" ? "active" : ""} onClick={() => store.control({ type: "review_mode", mode: "human" })}>You</button>
          </div>
        )}
        <span className="muted small">approved {counts.approved} · rejected {counts.rejected} · expired {counts.expired}</span>
        {s.canReview() && <button className={composing ? "btn active" : "btn"} title="Compose an introduction yourself: the same checks run, and it waits for review" onClick={() => setComposing(v => !v)}>Compose</button>}
        {s.network?.matchingEnabled === false && <Badge tone="warn" title="An admin turned proactive matching off: approvals wait">matching off</Badge>}
        {!s.canAct() && <span className="muted small">read-only</span>}
        <span className="spacer" />
        <div className="seg" role="radiogroup" aria-label="Review view">
          <button className={view === "pending" ? "active" : ""} onClick={() => store.setUI({ reviewView: "pending" })}>Pending</button>
          <button className={view === "decided" ? "active" : ""} onClick={() => store.setUI({ reviewView: "decided" })}>Decided</button>
        </div>
      </div>
      {composing && <ComposeForm onDone={() => setComposing(false)} />}
      {view === "pending" ? (
        pending.length ? (
          <div className="review-list">
            {pending.map(o => (
              <ReviewCard key={o.id} o={o} selected={o.id === sel?.id} onSelect={() => select(o)} ctl={ctl} scoreOpen={scoreOpen} setScoreOpen={setScoreOpen} onDone={afterDecision} />
            ))}
          </div>
        ) : <div className="muted small pad">{s.nothing()}</div>
      ) : (
        decided.length ? (
          <div className="review-list">
            {decided.slice(0, 100).map(o => (
              <div className="review-row" key={o.id}>
                {oppDot(o.state)}<OppLink o={o} /> <span className="muted small">{originLabel(originOf(o))}</span>
                <span className="small">{reviewLine(o)}</span>
                <span className="spacer" /><span className="muted small">{o.review?.decidedAt ? stamp(o.review.decidedAt) : ""}</span>
              </div>
            ))}
          </div>
        ) : <div className="muted small pad">{s.nothing()}</div>
      )}
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

function ReviewCard({ o, selected, onSelect, ctl, scoreOpen, setScoreOpen, onDone }: {
  o: Opp; selected: boolean; onSelect(): void; ctl: ReviewCtl; scoreOpen: boolean; setScoreOpen(v: boolean): void; onDone(): void;
}) {
  const s = store;
  const ref = useRef<HTMLDivElement>(null);
  // A re-roll gives a new deadline and moves the card: follow it.
  useEffect(() => { if (selected) ref.current?.scrollIntoView({ block: "nearest" }); }, [selected, o.review?.deadline]);
  const hist = selected ? historyBetween(o) : [];
  const editing = selected && ctl.mode === "edit";
  return (
    <div ref={ref} className={`review-card ${selected ? "selected" : ""} ${selected && ctl.mode === "reject" ? "rejecting" : ""}`}>
      <button type="button" className="review-head" onClick={onSelect}>
        {o.review && !isSecond(o) ? <Countdown deadline={o.review.deadline} /> : <span className="countdown">{isSecond(o) ? "2nd" : "–"}</span>}
        <span className="review-title">{s.oppTitle(o)}</span>
        <span className="muted small">{humanize(o.kind)}{o.category ? ` · ${o.category}` : ""} · {originLabel(originOf(o))}{o.review?.rerolls ? ` · re-rolled ${o.review.rerolls}×` : ""}</span>
        {o.review?.shadow && <Badge tone="warn" title="Shadow item: matching is off. Approve or reject is a label; nobody is contacted.">SHADOW</Badge>}
        {isSecond(o) && <Badge tone="info" title="Blind second review: someone else decided this item. Your decision is stored and changes nothing.">SECOND REVIEW</Badge>}
        <span className="spacer" />
        {o.source !== "player" && !noScores() && <span className="muted small">score {o.score.toFixed(2)}</span>}
        <span className="muted">{selected ? "▾" : "▸"}</span>
      </button>
      {selected && (
        <div className="review-body">
          {o.participants.map(id => {
            const m = s.members.get(id);
            const want = wantsOf(o, id);
            return (
              <div className="review-person" key={id}>
                <div className="review-person-head">
                  <MemberLink id={id} /> <span className="muted small"><AreaLink area={m?.area} /></span>
                  {m?.minor && <Badge tone="bad" title="Never matched or introduced. Approval is blocked.">Under 18</Badge>}
                  {m?.trust === "hold" && <Badge tone="bad">Hold</Badge>}
                  {m?.trust === "watch" && <Badge tone="warn">Watch</Badge>}
                  {isBusyElsewhere(o, id) && <Badge tone="warn" title="In another open opportunity">busy</Badge>}
                </div>
                {want && <div className="small"><span className="muted">wants:</span> “{want}”</div>}
                {!editing && o.review?.drafts?.probe[id] && (
                  <div className="small why" title="The probe this person gets (time options are added when it goes out)">
                    <span className="muted">probe{o.review.drafts.edited?.includes(id) ? " (edited)" : ""}:</span> “{o.review.drafts.probe[id]}”
                  </div>
                )}
                {!editing && o.review?.drafts?.reveal?.[id] && <div className="small muted" title="What they get if both say yes (place and time filled in then)">reveal: “{o.review.drafts.reveal[id]}”</div>}
                {!editing && o.explanations[id] && <div className="small why" title="Shown to this member"><span className="muted">told:</span> “{o.explanations[id]}”</div>}
              </div>
            );
          })}
          {!editing && (
            <StatusLine className="small" parts={[
              <span><span className="muted">Plan:</span> {o.objective}</span>,
              o.venue && <VenueLink venue={o.venue} />,
              o.meetingAt && stamp(o.meetingAt),
            ]} />
          )}
          <StatusLine className="small" parts={[
            <span><span className="muted">History:</span> {hist.length ? hist.slice(0, 3).map((h, i) => <span key={h.id}>{i > 0 && ", "}<OppLink o={h}>{humanize(h.state)} {stamp(h.createdAt)}</OppLink></span>) : "none"}</span>,
            o.alternates.length > 0 && <span><span className="muted">Alternates:</span> {o.alternates.map((a, i) => <span key={a}>{i > 0 && ", "}<MemberLink id={a} /></span>)}</span>,
          ]} />
          {o.source !== "player" && o.components && !noScores() && (
            <details className="disclosure" open={scoreOpen} onToggle={e => { const v = (e.currentTarget as HTMLDetailsElement).open; if (v !== scoreOpen) setScoreOpen(v); }}>
              <summary>Score {o.score.toFixed(2)}{o.exploration ? " · exploration" : ""}</summary>
              <Components c={o.components} />
            </details>
          )}
          <ReviewActions o={o} ctl={ctl} onDone={onDone} />
        </div>
      )}
    </div>
  );
}

/** A reviewer's own introduction (PRD 35.2): member ids, what it is for, and what each is told. The Network's filters run on submit. */
function ComposeForm({ onDone }: { onDone(): void }) {
  const [ids, setIds] = useState("");
  const [objective, setObjective] = useState("");
  const [told, setTold] = useState("");
  const [error, setError] = useState<string>();
  const submit = async () => {
    const participants = ids.split(/[\s,]+/).map(x => x.trim()).filter(Boolean);
    if (participants.length < 2 || !objective.trim()) { setError("Two or more member ids and what it is for"); return; }
    const explanations = told.trim() ? Object.fromEntries(participants.map(id => [id, told.trim()])) : undefined;
    const r = await store.control({ type: "compose", participants, objective: objective.trim(), ...(explanations ? { explanations } : {}) });
    if (r.ok) { store.toast("Composed: it waits for review", "good"); onDone(); } else setError(r.error ?? r.code ?? "refused");
  };
  return (
    <div className="review-edit">
      <label className="edit-row"><span className="muted small">Member ids</span><input className="input" value={ids} onChange={e => setIds(e.target.value)} placeholder="m1, m2" /></label>
      <label className="edit-row"><span className="muted small">What for</span><input className="input" value={objective} onChange={e => setObjective(e.target.value)} placeholder="coffee to talk about climbing" /></label>
      <label className="edit-row"><span className="muted small">Why (each is told)</span><input className="input" value={told} onChange={e => setTold(e.target.value)} placeholder="you both climb on weekends" /></label>
      <div className="review-actions">
        <button className="btn primary" onClick={submit}>Queue for review</button>
        <button className="btn" onClick={onDone}>Cancel</button>
        <span className="muted small">Minors, holds, blocks, busy members and message caps are refused. Another reviewer should approve it.</span>
      </div>
      {error && <div className="callout bad small" role="alert">{error}</div>}
    </div>
  );
}

/** In another open opportunity: the Network does not double-book. */
export function isBusyElsewhere(o: Opp, id: string) {
  for (const x of store.opps.values()) if (x.id !== o.id && x.source !== "shadow" && OPEN.has(x.state) && x.participants.includes(id)) return true;
  return false;
}

/** A venue name that flies the map to it, then its neighborhood as a focus link. */
export function VenueLink({ venue }: { venue: { name: string; lat: number; lng: number } }) {
  const area = VENUES.find(v => v.name === venue.name)?.neighborhood;
  return <span><button type="button" className="mlink" title="Show on the map" onClick={() => store.flyTo(venue.lat, venue.lng)}>{venue.name}</button>{area && <> · <AreaLink area={area} /></>}</span>;
}
