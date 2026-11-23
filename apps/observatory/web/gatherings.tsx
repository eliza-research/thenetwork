// spec/monthlyGathering.md, "The real staff console authors and reviews the exact gathering"
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Alert, Button, DataCell, DataTable, Disclosure, Field, Input, InspectorSection, Select, SelectItem, StatusRow, TableRow, type DataColumn } from "@thenetwork/ui";
import { VENUES } from "@thenetwork/network/geo";
import { HOUR, MINUTE } from "../../../packages/core/src/clock.ts";
import { CITY_TZ, fromLocal, localParts } from "../../../packages/core/src/time.ts";
import { gatheringDraftWindowAllowed, gatheringMaxCapacity, gatheringMinCapacity, monthlyGatheringConsoleAllowed, monthlyGatheringReviewOffered, type GatheringPhase } from "../../../packages/core/src/generated/monthlyGathering.ts";
import { panelView, type PanelAnswer } from "../../../packages/core/src/generated/consoleWorkspace.ts";
import type { GatheringDraft, GatheringView } from "../src/gatherings.ts";
import { store, useStore, type Fetched } from "./store.ts";

const zone = CITY_TZ.nyc;
const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: zone });
const venues = [...VENUES].sort((a, b) => a.name.localeCompare(b.name));
const phase: Record<GatheringView["status"], GatheringPhase> = { draft: "GatheringDraft", approved: "GatheringApproved", rejected: "GatheringRejected" };
const columns: DataColumn[] = [{ key: "month", label: "Month" }, { key: "venue", label: "Venue" }, { key: "window", label: "New York time" },
  { key: "capacity", label: "Capacity", numeric: true }, { key: "status", label: "Status" }, { key: "review", label: "Review" }];
const errors: Record<string, string> = {
  invalid_gathering: "Choose an open public venue, a valid window and a supported capacity.",
  month_unavailable: "A gathering already occupies this month.",
  gathering_not_reviewable: "The draft changed or its venue is no longer available.",
  not_found: "This gathering is no longer available.",
};

/** Refuse skipped or repeated local times instead of silently choosing another instant. */
function localTime(input: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(input);
  if (!match) return undefined;
  const [, year = 0, month = 0, day = 0, hour = 0, minute = 0] = match.map(Number);
  if (year < 1970) return undefined;
  const base = fromLocal(year, month, day, hour, zone) + minute * MINUTE;
  const exact = [base - HOUR, base, base + HOUR].filter(at => {
    const actual = localParts(at, zone);
    return actual.year === year && actual.month === month && actual.day === day && actual.hour === hour && actual.minute === minute;
  });
  return exact.length === 1 ? exact[0] : undefined;
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
  if (!gatheringDraftWindowAllowed(store.now(), startsAt, endsAt, localMonth(endsAt - 1) === month, capacity)) return;
  return { month, venue: { kind, id: venue }, startsAt, endsAt, capacity };
}

type Review = { id: string; revision: number; decision: "approve" | "reject" };

/** Monthly staff work stays in the real Network workspace and uses the service's exact revisions. */
export function GatheringConsole() {
  const s = useStore();
  if (!monthlyGatheringConsoleAllowed(s.mode === "real", s.app === "ntwrk", !s.authNeeded && s.isAdmin(), s.canAct())) return null;
  return <Gatherings key={`${s.authEpoch}:${s.me?.id ?? ""}`} />;
}

function Gatherings() {
  const [answer, setAnswer] = useState<Fetched<{ gatherings: GatheringView[] }>>();
  const [confirmation, setConfirmation] = useState<Review>();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const busy = useRef(false);
  const flow = useId();
  useEffect(() => {
    let current = true;
    void store.fetch<{ gatherings: GatheringView[] }>("/api/gatherings").then(result => { if (current) setAnswer(result); });
    return () => { current = false; };
  }, [reload]);

  const write = async (path: string, body: GatheringDraft | Omit<Review, "id">) => {
    if (busy.current) return false;
    busy.current = true;
    setSaving(true);
    setError(undefined);
    const result = await store.fetch<{ gathering: GatheringView }>(path, body);
    busy.current = false;
    setSaving(false);
    if (result.data) {
      const { gathering } = result.data;
      setConfirmation(undefined);
      setAnswer(previous => ({ status: 200, data: { gatherings: [gathering, ...(previous?.data?.gatherings ?? []).filter(row => row.id !== gathering.id)]
        .sort((a, b) => b.startsAt - a.startsAt) } }));
      return true;
    }
    setError(errors[result.error] ?? "The gathering could not be saved. Try again.");
    if (result.status === 403) {
      setAnswer(result);
      setConfirmation(undefined);
    } else if (result.status === 409) {
      setConfirmation(undefined);
      setReload(value => value + 1);
    }
    return false;
  };
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const draft = readDraft(form);
    if (!draft) { setError("Enter a future New York window within one month, lasting 30 minutes to six hours, and a capacity of 3 to 150."); return; }
    if (await write("/api/gatherings", draft)) form.reset();
  };

  const rows = answer?.data?.gatherings ?? [];
  const loaded: PanelAnswer = !answer ? "NotAnswered" : answer.status === 403 ? "AnswerForbidden" : answer.data ? "AnswerRows" : "AnswerFailed";
  return (
    <InspectorSection title="Monthly NYC gatherings">
      {answer?.data && <Disclosure summary="Create gathering draft">
        <GatheringDraftForm id={flow} disabled={saving} onSubmit={event => { void create(event); }} />
      </Disclosure>}
      {error && <Alert variant="destructive">{error}</Alert>}
      <StatusRow view={answer?.status === 503 ? "PanelUnavailable" : panelView("ConfigPanel", loaded, rows.length)} empty="No gatherings yet.">
        <DataTable columns={columns}>
          {rows.map(row => {
            const selected = confirmation?.id === row.id && confirmation.revision === row.revision ? confirmation : undefined;
            return (
              <TableRow key={row.id}>
                <DataCell>{row.month}</DataCell><DataCell>{row.venue.name}</DataCell>
                <DataCell>{dateTime.format(row.startsAt)} – {dateTime.format(row.endsAt)}</DataCell>
                <DataCell numeric>{row.capacity}</DataCell><DataCell>{row.status}</DataCell>
                <DataCell>
                  {monthlyGatheringReviewOffered(phase[row.status]) && <div className="flex flex-wrap gap-2">
                    {selected ? <>
                      <Button size="sm" disabled={saving} onClick={() => { void write(`/api/gatherings/${row.id}/review`, { revision: selected.revision, decision: selected.decision }); }}>
                        {selected.decision === "approve" ? "Confirm approval" : "Confirm rejection"}
                      </Button>
                      <Button size="sm" variant="outline" disabled={saving} onClick={() => setConfirmation(undefined)}>Cancel</Button>
                    </> : <>
                      <Button size="sm" variant="outline" disabled={saving} onClick={() => setConfirmation({ id: row.id, revision: row.revision, decision: "approve" })}>Approve</Button>
                      <Button size="sm" variant="outline" disabled={saving} onClick={() => setConfirmation({ id: row.id, revision: row.revision, decision: "reject" })}>Reject</Button>
                    </>}
                  </div>}
                </DataCell>
              </TableRow>
            );
          })}
        </DataTable>
      </StatusRow>
    </InspectorSection>
  );
}

function GatheringDraftForm({ id, disabled, onSubmit }: { id: string; disabled: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const [listed, setListed] = useState(false);
  const [venue, setVenue] = useState("");
  return (
    <form onSubmit={onSubmit} onReset={() => { setListed(false); setVenue(""); }} className="flex flex-col gap-3">
      <fieldset disabled={disabled} className="flex flex-wrap items-end gap-3">
        <Field label="Venue source" controlId={`${id}-source`}>
          <Select name="venueKind" value={listed ? "listing" : "curated"} disabled={disabled} onValueChange={value => setListed(value === "listing")}>
            <SelectItem value="curated">Curated venue</SelectItem><SelectItem value="listing">Published event</SelectItem>
          </Select>
        </Field>
        {listed ? <Field label="Published event ID" controlId={`${id}-listing`}><Input name="venue" maxLength={200} required /></Field> :
          <Field label="Public venue" controlId={`${id}-venue`}>
            <Select name="venue" value={venue} onValueChange={setVenue} placeholder="Choose a venue" disabled={disabled} required>
              {venues.map(place => <SelectItem key={place.id} value={place.id}>{place.name}</SelectItem>)}
            </Select>
          </Field>}
        <Field label="Start (New York time)" controlId={`${id}-start`}><Input type="datetime-local" name="startsAt" required /></Field>
        <Field label="End (New York time)" controlId={`${id}-end`}><Input type="datetime-local" name="endsAt" required /></Field>
        <Field label="Capacity" controlId={`${id}-capacity`}><Input type="number" name="capacity" min={gatheringMinCapacity} max={gatheringMaxCapacity} step={1} required /></Field>
        <Button type="submit" disabled={disabled}>Create draft</Button>
      </fieldset>
    </form>
  );
}
