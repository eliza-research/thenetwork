// Human review queue (PRD 32.8, PRD 35 review module). Every network-composed opportunity waits
// here before any member is contacted. Cards sort by deadline; the selected card expands.
// Keyboard (Review tab open, no input focused): j/k move, a approve, r then 1-8 reject with a
// reason, e edit what each person is told, s then 1-n re-roll (swap that person), n note, x score,
// Enter open, Esc leaves the current mode. The time from opening a card to the decision is sent with it.
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { ReviewReason } from "../src/types.ts";
import { VENUES } from "@thenetwork/network/geo";
import { OPEN, originLabel, originOf, REVIEW_REASONS, store, useStore, type DecideOpts, type Opp } from "./store.ts";
import { approveBlock as approveCore, choose, keyStep, moveOnAfter, rebind, reviewStatus, settle, toggleMode, type Block, type Ctl, type Key, type Mode } from "./logic/review.ts";
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

/** One line for the review state: countdown while queued, then the decision. */
export function reviewLine(o: Opp): ReactNode {
  const rv = o.review;
  if (!rv) return null;
  const extra = [
    rv.edits?.length ? "edited" : "",
    rv.rerolls ? `re-rolled ${rv.rerolls}×` : "",
    rv.secondsSpent ? `${rv.secondsSpent < 60 ? `${rv.secondsSpent}s` : dur(rv.secondsSpent * 1000)} on it` : "",
  ].filter(Boolean).join(" · ");
  const tail = extra ? <span className="muted"> · {extra}</span> : null;
  const status = reviewStatus({ decision: rv.decision ?? "pending", invalidated: !!rv.invalidated, inReview: o.state === "IN_REVIEW" });
  if (status === "waiting") return <span><Countdown deadline={rv.deadline} prefix="Due in " />{tail}</span>;
  if (status === "closed_unsent") return <span>{humanize(o.state)}{tail}</span>;
  if (status === "expired_unsent") return <span className="bad">Expired unsent</span>;
  const after = rv.decidedAt ? ` · ${dur(Math.max(0, rv.decidedAt - rv.queuedAt))} after queue` : "";
  if (status === "stopped") return <span className="warn-text">Approved by {reviewerName(rv.reviewer) || "reviewer"}, stopped on re-check ({humanize(rv.invalidated!)}){tail}</span>;
  if (status === "approved") return <span>Approved by {reviewerName(rv.reviewer) || "reviewer"}{after}{tail}</span>;
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

// ---------------------------------------------------------------- actions
type ReviewError = { code?: string; text: string; oppId?: string };
interface ReviewCtl {
  /** The proved controller (logic/review.ts), current even before the next render. */
  core(): Ctl; commit(next: Ctl): void;
  /** True while the controller belongs to this item. */
  owns(id: string): boolean;
  mode: Mode; draftsId: string;
  note: string; setNote(v: string): void;
  awaitingOther: boolean; setAwaitingOther(v: boolean): void;
  noteRef: RefObject<HTMLInputElement | null>;
  /** Edit drafts: participant id -> what they are told; "" key = the plan (objective). */
  drafts: Record<string, string>; setDrafts(v: Record<string, string>): void;
  /** Last refusal, shown under the card it came from (guard errors from an edit, a blocked approve). */
  error: ReviewError | null; setError(v: ReviewError | null): void;
}
function useReviewCtl(initial: string): ReviewCtl {
  const [core, setCore] = useState<Ctl>({ mode: "idle", boundId: initial, draftsId: "", chosen: initial !== "" });
  const [note, setNote] = useState("");
  const [awaitingOther, setAwaitingOther] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<ReviewError | null>(null);
  const noteRef = useRef<HTMLInputElement>(null);
  const latest = useRef(core);
  // Every move goes through here. What is typed for one item leaves with that item.
  const commit = (next: Ctl) => {
    const left = next.boundId !== latest.current.boundId;
    if (left) { setNote(""); setError(null); }
    if (left || !next.draftsId) setDrafts({});
    if (left || next.mode !== latest.current.mode) setAwaitingOther(false);
    latest.current = next; setCore(next);
  };
  return { core: () => latest.current, commit, owns: id => latest.current.boundId === id, mode: core.mode, draftsId: core.draftsId, note, setNote, awaitingOther, setAwaitingOther, noteRef, drafts, setDrafts, error, setError };
}

const BLOCK_TEXT: Record<Exclude<Block, "idle">, string> = {
  read_only: "Read-only source",
  minor: "Members under 18 are never introduced",
  declined: "A participant was declined at join",
  matching_off: "Proactive matching is off (admin switch)",
  expired: "Expired unsent",
};
/** Why approval is blocked for this opportunity, if it is. No review record means no deadline: it stays blocked. */
export function approveBlock(o: Opp): string | undefined {
  const block = approveCore(store.canAct(), o.participants, store.members, store.network?.matchingEnabled === false, store.now(), o.review?.deadline ?? 0);
  return block === "idle" ? undefined : BLOCK_TEXT[block];
}

/** The edits that differ from the current texts. Undefined when nothing changed. */
function editsOf(o: Opp, drafts: Record<string, string>): Pick<DecideOpts, "explanations" | "objective"> | undefined {
  const explanations: Record<string, string> = {};
  for (const id of o.participants) if (drafts[id] !== undefined && drafts[id]!.trim() !== (o.explanations[id] ?? "").trim()) explanations[id] = drafts[id]!;
  const objective = drafts[""] !== undefined && drafts[""]!.trim() !== o.objective.trim() ? drafts[""] : undefined;
  if (!Object.keys(explanations).length && objective === undefined) return undefined;
  return { ...(Object.keys(explanations).length ? { explanations } : {}), ...(objective !== undefined ? { objective } : {}) };
}

/** Send a decision with the controller's note and edits; errors stay on the card, or become a toast when the card has gone. */
async function act(o: Opp, c: ReviewCtl, decision: "approve" | "reject" | "reroll", withEdits: boolean, extra: DecideOpts = {}): Promise<boolean> {
  const edits = withEdits ? editsOf(o, c.drafts) : undefined;
  const r = await store.decide(o, edits ? "edit" : decision, { ...extra, ...edits, note: c.note }, true);
  if (r.ok) { c.commit(settle(c.core(), o.id)); return true; }
  // A second press while the first is on its way: nothing was sent.
  if (r.code === "in_flight") return false;
  const text = r.error ?? "refused";
  if (c.owns(o.id) && store.opps.get(o.id)?.state === "IN_REVIEW") c.setError({ code: r.code, text, oppId: o.id });
  else store.toast(text, "bad");
  return false;
}

/** Commit a controller step. Load the drafts when it opened the editor; a new mode clears the last refusal. */
function applyStep(o: Opp, c: ReviewCtl, next: Ctl) {
  const before = c.core();
  c.commit(next);
  if (next.draftsId === o.id && before.draftsId !== o.id) c.setDrafts({ ...Object.fromEntries(o.participants.map(id => [id, o.explanations[id] ?? ""])), "": o.objective });
  if (next.mode !== before.mode) c.setError(null);
}

/** One key or button press on item o: the proved reducer decides, this runs what it returned. */
function press(o: Opp, c: ReviewCtl, key: Key, digit: number, repeat: boolean, onDone?: () => void) {
  const reasons = store.reasons(), swap = swappable(o);
  const { ctl, cmd } = keyStep(c.core(), o.id, { key, digit, repeat, blocked: !!approveBlock(o), canAct: store.canReview(), reasons: reasons.length, swaps: swap.length });
  applyStep(o, c, ctl);
  const done = (ok: boolean) => { if (ok) onDone?.(); };
  if (cmd.tag === "approve") act(o, c, "approve", cmd.withEdits).then(done);
  else if (cmd.tag === "reject") {
    const reason = reasons[cmd.digit - 1]![0] as ReviewReason;
    if (reason === "other" && !c.note.trim()) { c.setAwaitingOther(true); c.noteRef.current?.focus(); return; }
    act(o, c, "reject", false, { reason }).then(done);
  }
  // A re-roll keeps the item waiting with the new person (or closes it): stay on it.
  else if (cmd.tag === "reroll") act(o, c, "reroll", false, { swapOut: swap[cmd.digit - 1]! });
}

/** Approve, edit, re-roll and reject with one of the app's reason codes. Shared by the queue and the opportunity view. */
export function ReviewActions({ o, ctl, onDone }: { o: Opp; ctl?: ReviewCtl; onDone?: () => void }) {
  const local = useReviewCtl(o.id);
  const c = ctl ?? local;
  useEffect(() => { store.reviewOpen(o.id); }, [o.id]);
  // A refusal shown here must not end with the card: when the item closes, it stays as a toast.
  const shown = useRef(c.error); shown.current = c.error;
  useEffect(() => () => {
    const e = shown.current;
    if (e?.oppId === o.id && store.opps.get(o.id)?.state !== "IN_REVIEW") store.toast(e.text, "bad");
  }, [o.id]);
  if (!store.canReview()) return null;
  const block = approveBlock(o);
  const edits = c.draftsId === o.id ? editsOf(o, c.drafts) : undefined;
  const swap = swappable(o);
  /** A click on this card is the reviewer's choice of this card. */
  const click = (key: Key, digit = 0) => { c.commit(choose(c.core(), o.id)); press(o, c, key, digit, false, onDone); };
  const toggle = (m: Mode) => { c.setError(null); c.setAwaitingOther(false); applyStep(o, c, toggleMode(c.core(), o.id, m)); };
  const reject = (reason: ReviewReason) => click("digit", store.reasons().findIndex(x => x[0] === reason) + 1);
  const approve = () => click("a");
  const reroll = (i: number) => click("digit", i + 1);
  return (
    <div className="review-act">
      {c.mode === "edit" && (
        <div className="review-edit">
          {o.participants.map(id => (
            <label key={id} className="edit-row">
              <span className="muted small">Told {store.firstName(id)}</span>
              <textarea className="input" rows={2} value={c.drafts[id] ?? ""} onChange={e => c.setDrafts({ ...c.drafts, [id]: e.target.value })} />
            </label>
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
          {swap.map((id, i) => <button key={id} className="chip" onClick={() => reroll(i)}><kbd>{i + 1}</kbd> {store.firstName(id)}</button>)}
          <span className="muted small">{o.alternates.length ? `${o.alternates.length} alternate${o.alternates.length > 1 ? "s" : ""}` : "No alternates: it closes and the engine composes again"}</span>
        </div>
      )}
      <div className={`review-actions ${c.mode === "reject" ? "rejecting" : ""}`}>
        <button className="btn primary" disabled={!!block} title={block ?? "Approve (a)"} onClick={approve}>{edits ? "Approve with edits" : "Approve"}</button>
        <button className={c.mode === "edit" ? "btn active" : "btn"} title="Edit what each person is told (e)" onClick={() => toggle("edit")}>Edit</button>
        <button className={c.mode === "reroll" ? "btn active" : "btn"} disabled={!swap.length} title={swap.length ? "Swap a participant for an alternate (s)" : "Nobody can be swapped"} onClick={() => toggle("reroll")}>Re-roll</button>
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
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); (e.target as HTMLInputElement).blur(); if (c.mode !== "idle") press(o, c, "esc", 0, false); }
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
  const sel = (f?.kind === "opportunity" && pending.find(o => o.id === f.id)) || pending.find(o => o.id === selId) || pending[0];
  const ctl = useReviewCtl(sel?.id ?? "");
  const counts = s.network?.review ?? countDecisions();
  // The controller follows the selection in this render, so no frame shows one item's mode on another.
  // A focus link is the reviewer's choice. Any other move (the card left, the filter changed) is not.
  if (sel && !ctl.owns(sel.id)) ctl.commit(f?.kind === "opportunity" && f.id === sel.id ? choose(ctl.core(), sel.id) : rebind(ctl.core(), sel.id));
  // Hold the card on view: an item with a sooner deadline must not take its place.
  useEffect(() => { if (sel) setSelId(sel.id); }, [sel?.id]);

  const select = (o: Opp | undefined, mapFocus = true) => {
    if (!o) return;
    ctl.commit(choose(ctl.core(), o.id));
    setSelId(o.id); setScoreOpen(false);
    if (mapFocus) store.focus({ kind: "opportunity", id: o.id }, { replace: store.ui.focus?.kind === "opportunity" });
  };
  /** The answer for item id arrived: move on, unless this queue is unmounted or the reviewer has already chosen another card. */
  const afterDecision = (id: string) => {
    const { pending, sel, ctl, select } = live.current;
    if (!moveOnAfter(mounted.current, ctl.core(), id)) return;
    const i = pending.findIndex(o => o.id === id);
    const n = i < 0 ? sel : pending[i + 1] ?? pending[i - 1];
    if (n) select(n); else setSelId(undefined);
  };

  // The queue owns its keyboard while mounted (capture phase, so Esc leaves a mode before the global chain).
  const live = useRef({ pending, sel, ctl, view, select, afterDecision });
  live.current = { pending, sel, ctl, view, select, afterDecision };
  // False after unmount: an answer that arrives later must not move the focus of the store.
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as Element | null;
      if (target?.closest?.("input, textarea, select")) return;
      // An open popover has the keyboard. A focused control keeps Enter; a card head only opens the card.
      if (store.ui.popover) return;
      if (e.key === "Enter" && target?.closest?.("button:not(.review-head), a, summary")) return;
      const { pending, sel, ctl, view, select, afterDecision } = live.current;
      if (view !== "pending") return;
      const handled = () => { e.preventDefault(); e.stopImmediatePropagation(); };
      if (e.key === "Escape" && sel && ctl.core().mode !== "idle") { handled(); press(sel, ctl, "esc", 0, false); return; }
      if (!sel) return;
      const i = pending.indexOf(sel);
      const canAct = store.canReview();
      const mode = ctl.core().mode;
      const send = (key: Key, digit = 0) => { handled(); press(sel, ctl, key, digit, e.repeat, () => afterDecision(sel.id)); };
      if (e.key === "j") { handled(); select(pending[Math.min(pending.length - 1, i + 1)]); }
      else if (e.key === "k") { handled(); select(pending[Math.max(0, i - 1)]); }
      else if (e.key === "a" && canAct) send("a");
      else if (e.key === "r" && canAct) send("r");
      else if (e.key === "s" && canAct && swappable(sel).length) send("s");
      else if (e.key === "e" && canAct) send("e");
      else if (mode === "reject" && /^[1-8]$/.test(e.key)) send("digit", Number(e.key));
      else if (mode === "reroll" && /^[1-6]$/.test(e.key) && swappable(sel)[Number(e.key) - 1]) send("digit", Number(e.key));
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
        {s.network?.matchingEnabled === false && <Badge tone="warn" title="An admin turned proactive matching off: approvals wait">matching off</Badge>}
        {!s.canAct() && <span className="muted small">read-only</span>}
        <span className="spacer" />
        <div className="seg" role="radiogroup" aria-label="Review view">
          <button className={view === "pending" ? "active" : ""} onClick={() => store.setUI({ reviewView: "pending" })}>Pending</button>
          <button className={view === "decided" ? "active" : ""} onClick={() => store.setUI({ reviewView: "decided" })}>Decided</button>
        </div>
      </div>
      {view === "pending" ? (
        pending.length ? (
          <div className="review-list">
            {pending.map(o => (
              <ReviewCard key={o.id} o={o} selected={o.id === sel?.id} onSelect={() => select(o)} ctl={ctl} scoreOpen={scoreOpen} setScoreOpen={setScoreOpen} onDone={() => afterDecision(o.id)} />
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
        {o.review ? <Countdown deadline={o.review.deadline} /> : <span className="countdown">–</span>}
        <span className="review-title">{s.oppTitle(o)}</span>
        <span className="muted small">{humanize(o.kind)}{o.category ? ` · ${o.category}` : ""} · {originLabel(originOf(o))}{o.review?.rerolls ? ` · re-rolled ${o.review.rerolls}×` : ""}</span>
        <span className="spacer" />
        {o.source !== "player" && <span className="muted small">score {o.score.toFixed(2)}</span>}
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
          {o.source !== "player" && o.components && (
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
