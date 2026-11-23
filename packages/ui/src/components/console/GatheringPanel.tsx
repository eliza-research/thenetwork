// spec/monthlyGathering.md, "The gathering panel offers the draft form and one confirmation at a time"
import { type ComponentProps, type FormEvent, useId, useState } from "react";
import type { PanelView } from "../../../../core/src/generated/consoleWorkspace.ts";
import { type GatheringPhase, gatheringConfirmShown, gatheringMaxCapacity, gatheringMinCapacity, monthlyGatheringReviewOffered } from "../../../../core/src/generated/monthlyGathering.ts";
import { Alert } from "../Alert.tsx";
import { Button } from "../Button.tsx";
import { Disclosure } from "../Disclosure.tsx";
import { Field } from "../Field.tsx";
import { Input } from "../Input.tsx";
import { Select, SelectItem } from "../Select.tsx";
import { TableRow } from "../Table.tsx";
import { DataCell, type DataColumn, DataTable } from "./DataTable.tsx";
import { InspectorSection } from "./InspectorSection.tsx";
import { StatusRow } from "./StatusRow.tsx";

/** One gathering as the server sent it, with its window already written in New York time. */
export type GatheringRow = { id: string; revision: number; month: string; venue: string; window: string; capacity: number; phase: GatheringPhase };

/** The review decision that waits for its confirmation, for one row and one revision. */
export type GatheringChoice = { id: string; revision: number; decision: "approve" | "reject" };

export type GatheringPanelProps = Omit<ComponentProps<"section">, "title" | "children"> & {
  /** The view of the panel: the generated `panelView("GatheringPanel", gatheringPanelAnswer(...), rows.length)`. */
  view: PanelView;
  /** The draft form shows: the generated `gatheringDraftFormShown`. */
  formShown: boolean;
  rows: GatheringRow[];
  /** The curated public venues, in the order to show. */
  venues: { id: string; name: string }[];
  /** A write is on its way: every control is off. */
  saving?: boolean;
  /** Why the last write failed, or why the form did not send. */
  error?: string;
  /** The decision that waits for its confirmation. */
  choice?: GatheringChoice;
  /** The form of a new draft was sent. The owner reads the fields and resets the form when the server saves the draft. */
  onCreate: (form: HTMLFormElement) => void;
  /** A staff member chose a decision, or cancelled it with `undefined`. */
  onChoose: (choice: GatheringChoice | undefined) => void;
  /** A staff member confirmed the chosen decision. */
  onConfirm: (choice: GatheringChoice) => void;
};

const columns: DataColumn[] = [
  { key: "month", label: "Month" },
  { key: "venue", label: "Venue" },
  { key: "window", label: "New York time" },
  { key: "capacity", label: "Capacity", numeric: true },
  { key: "status", label: "Status" },
  { key: "review", label: "Review" },
];

const statusText: Record<GatheringPhase, string> = { GatheringDraft: "draft", GatheringApproved: "approved", GatheringRejected: "rejected" };

/**
 * The monthly New York gatherings of the real Network workspace: the list, the draft form and the review of a draft with one confirmation.
 * @model spec/consoleWorkspace.md
 */
export function GatheringPanel({ view, formShown, rows, venues, saving = false, error, choice, onCreate, onChoose, onConfirm, ...props }: GatheringPanelProps) {
  return (
    <InspectorSection title="Monthly NYC gatherings" {...props}>
      {formShown ? (
        <Disclosure summary="Create gathering draft">
          <GatheringDraftForm venues={venues} disabled={saving} onCreate={onCreate} />
        </Disclosure>
      ) : null}
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <StatusRow view={view} empty="No gatherings yet.">
        <DataTable columns={columns}>
          {rows.map((row) => {
            const confirming = choice && gatheringConfirmShown(row.phase, choice.id === row.id, choice.revision, row.revision) ? choice : undefined;
            return (
              <TableRow key={row.id}>
                <DataCell>{row.month}</DataCell>
                <DataCell>{row.venue}</DataCell>
                <DataCell>{row.window}</DataCell>
                <DataCell numeric>{row.capacity}</DataCell>
                <DataCell>{statusText[row.phase]}</DataCell>
                <DataCell>
                  {monthlyGatheringReviewOffered(row.phase) ? (
                    <div className="flex flex-wrap gap-2">
                      {confirming ? (
                        <>
                          <Button size="sm" disabled={saving} onClick={() => onConfirm(confirming)}>
                            {confirming.decision === "approve" ? "Confirm approval" : "Confirm rejection"}
                          </Button>
                          <Button size="sm" variant="outline" disabled={saving} onClick={() => onChoose(undefined)}>
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button size="sm" variant="outline" disabled={saving} onClick={() => onChoose({ id: row.id, revision: row.revision, decision: "approve" })}>
                            Approve
                          </Button>
                          <Button size="sm" variant="outline" disabled={saving} onClick={() => onChoose({ id: row.id, revision: row.revision, decision: "reject" })}>
                            Reject
                          </Button>
                        </>
                      )}
                    </div>
                  ) : null}
                </DataCell>
              </TableRow>
            );
          })}
        </DataTable>
      </StatusRow>
    </InspectorSection>
  );
}

function GatheringDraftForm({ venues, disabled, onCreate }: { venues: GatheringPanelProps["venues"]; disabled: boolean; onCreate: (form: HTMLFormElement) => void }) {
  const id = useId();
  const [listed, setListed] = useState(false);
  const [venue, setVenue] = useState("");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onCreate(event.currentTarget);
  };
  return (
    <form onSubmit={submit} onReset={() => { setListed(false); setVenue(""); }} className="flex flex-col gap-3">
      <fieldset disabled={disabled} className="flex flex-wrap items-end gap-3">
        <Field label="Venue source" controlId={`${id}-source`}>
          <Select name="venueKind" value={listed ? "listing" : "curated"} disabled={disabled} onValueChange={(value) => setListed(value === "listing")}>
            <SelectItem value="curated">Curated venue</SelectItem>
            <SelectItem value="listing">Published event</SelectItem>
          </Select>
        </Field>
        {listed ? (
          <Field label="Published event ID" controlId={`${id}-listing`}>
            <Input name="venue" maxLength={200} required />
          </Field>
        ) : (
          <Field label="Public venue" controlId={`${id}-venue`}>
            <Select name="venue" value={venue} onValueChange={setVenue} placeholder="Choose a venue" disabled={disabled} required>
              {venues.map((place) => (
                <SelectItem key={place.id} value={place.id}>
                  {place.name}
                </SelectItem>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Start (New York time)" controlId={`${id}-start`}>
          <Input type="datetime-local" name="startsAt" required />
        </Field>
        <Field label="End (New York time)" controlId={`${id}-end`}>
          <Input type="datetime-local" name="endsAt" required />
        </Field>
        <Field label="Capacity" controlId={`${id}-capacity`}>
          <Input type="number" name="capacity" min={gatheringMinCapacity} max={gatheringMaxCapacity} step={1} required />
        </Field>
        <Button type="submit" disabled={disabled}>
          Create draft
        </Button>
      </fieldset>
    </form>
  );
}
