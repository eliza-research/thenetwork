// spec/monthlyGathering.md, "The gathering panel offers the draft form and one confirmation at a time"
import { useEffect, useRef, useState } from "react";
import { GatheringPanel, type GatheringChoice, type GatheringRow } from "@thenetwork/ui";
import { VENUES } from "@thenetwork/network/geo";
import { HOUR, MINUTE } from "../../core/src/clock.ts";
import { CITY_TZ, fromLocal, localParts } from "../../core/src/time.ts";
import { panelView } from "../../core/src/generated/consoleWorkspace.ts";
import {
  type GatheringError, type GatheringPhase, gatheringConfirmationCloses, gatheringDraftFormShown, gatheringDraftReady, gatheringErrorFor,
  gatheringListRead, gatheringLocalTimeExact, gatheringPanelAnswer, gatheringWriteFollowUp, monthlyGatheringConsoleAllowed,
} from "../../core/src/generated/monthlyGathering.ts";
import type { GatheringDraft, GatheringView } from "../src/gatherings.ts";
import { store, useStore, type Fetched } from "./store.ts";

const zone = CITY_TZ.nyc;
const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: zone });
const venues = [...VENUES].sort((a, b) => a.name.localeCompare(b.name)).map(place => ({ id: place.id, name: place.name }));
const phase: Record<GatheringView["status"], GatheringPhase> = { draft: "GatheringDraft", approved: "GatheringApproved", rejected: "GatheringRejected" };
const errors: Record<GatheringError, string> = {
  GatheringInvalid: "Choose an open public venue, a valid window and a supported capacity.",
  GatheringMonthTaken: "A gathering already occupies this month.",
  GatheringNotReviewable: "The draft changed or its venue is no longer available.",
  GatheringMissing: "This gathering is no longer available.",
  GatheringOtherError: "The gathering could not be saved. Try again.",
};
const draftRefused = "Enter a future New York window within one month, lasting 30 minutes to six hours, and a capacity of 3 to 150.";

function localTime(input: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(input);
  if (!match) return undefined;
  const [, year = 0, month = 0, day = 0, hour = 0, minute = 0] = match.map(Number);
  const base = fromLocal(year, month, day, hour, zone) + minute * MINUTE;
  const exact = [base - HOUR, base, base + HOUR].filter(at => {
    const actual = localParts(at, zone);
    return actual.year === year && actual.month === month && actual.day === day && actual.hour === hour && actual.minute === minute;
  });
  return gatheringLocalTimeExact(year, exact.length) ? exact[0] : undefined;
}

function localMonth(at: number): string {
  const { year, month } = localParts(at, zone);
  return `${year}-${String(month).padStart(2, "0")}`;
}

function readDraft(form: HTMLFormElement): GatheringDraft | undefined {
  const fields = new FormData(form);
  const kind = fields.get("venueKind"), venue = String(fields.get("venue") ?? "").trim();
  const startsAt = localTime(String(fields.get("startsAt"))), endsAt = localTime(String(fields.get("endsAt")));
  const capacity = Number(fields.get("capacity"));
  if (!venue || (kind !== "curated" && kind !== "listing") || startsAt === undefined || endsAt === undefined || !Number.isSafeInteger(capacity)) return;
  const month = localMonth(startsAt);
  if (!gatheringDraftReady(true, store.now(), startsAt, endsAt, localMonth(endsAt - 1) === month, capacity)) return;
  return { month, venue: { kind, id: venue }, startsAt, endsAt, capacity };
}

const rowOf = (row: GatheringView): GatheringRow => ({
  id: row.id, revision: row.revision, month: row.month, venue: row.venue.name, capacity: row.capacity, phase: phase[row.status],
  window: `${dateTime.format(row.startsAt)} – ${dateTime.format(row.endsAt)}`,
});

export function GatheringConsole() {
  const s = useStore();
  if (!monthlyGatheringConsoleAllowed(s.mode === "real", s.app === "ntwrk", !s.authNeeded && s.isAdmin(), s.canAct())) return null;
  return <Gatherings key={`${s.authEpoch}:${s.me?.id ?? ""}`} />;
}

function Gatherings() {
  const [answer, setAnswer] = useState<Fetched<{ gatherings: GatheringView[] }>>();
  const [choice, setChoice] = useState<GatheringChoice>();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const busy = useRef(false);
  useEffect(() => {
    let current = true;
    void store.fetch<{ gatherings: GatheringView[] }>("/api/gatherings").then(result => { if (current) setAnswer(result); });
    return () => { current = false; };
  }, [reload]);

  const write = async (path: string, body: GatheringDraft | Omit<GatheringChoice, "id">) => {
    if (busy.current) return false;
    busy.current = true;
    setSaving(true);
    setError(undefined);
    const result = await store.fetch<{ gathering: GatheringView }>(path, body);
    busy.current = false;
    setSaving(false);
    const followUp = gatheringWriteFollowUp(result.data !== undefined, result.status);
    if (gatheringConfirmationCloses(followUp)) setChoice(undefined);
    if (result.data) {
      const { gathering } = result.data;
      setAnswer(previous => ({ status: 200, data: { gatherings: [gathering, ...(previous?.data?.gatherings ?? []).filter(row => row.id !== gathering.id)]
        .sort((a, b) => b.startsAt - a.startsAt) } }));
      return true;
    }
    setError(errors[gatheringErrorFor(result.error)]);
    if (followUp === "GatheringWriteRefused") setAnswer({ status: result.status, error: result.error });
    if (gatheringListRead(followUp)) setReload(value => value + 1);
    return false;
  };
  const create = async (form: HTMLFormElement) => {
    const draft = readDraft(form);
    if (!draft) { setError(draftRefused); return; }
    if (await write("/api/gatherings", draft)) form.reset();
  };

  const rows = answer?.data?.gatherings ?? [];
  const loaded = gatheringPanelAnswer(answer !== undefined, answer?.status ?? 0, answer?.data !== undefined);
  return (
    <GatheringPanel
      view={panelView("GatheringPanel", loaded, rows.length)}
      formShown={gatheringDraftFormShown(loaded)}
      rows={rows.map(rowOf)}
      venues={venues}
      saving={saving}
      error={error}
      choice={choice}
      onCreate={form => { void create(form); }}
      onChoose={setChoice}
      onConfirm={selected => { void write(`/api/gatherings/${selected.id}/review`, { revision: selected.revision, decision: selected.decision }); }}
    />
  );
}
