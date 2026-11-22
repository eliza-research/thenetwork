// spec/consoleWorkspace.md, "Only an admin loads the audit log"
import type { ComponentProps, ReactNode } from "react";
import type { AuditPhase } from "../../../../core/src/generated/consoleWorkspace.ts";
import { cn } from "../../lib/cn.ts";
import { Button } from "../Button.tsx";
import { Input } from "../Input.tsx";
import { TableRow } from "../Table.tsx";
import { DataCell, type DataColumn } from "./DataTable.tsx";
import { StatusMark } from "./StatusMark.tsx";

/** The columns of the audit log, for `DataTable`. */
export const auditColumns: DataColumn[] = [
  { key: "at", label: "When" },
  { key: "actor", label: "Who" },
  { key: "action", label: "Action" },
  { key: "target", label: "Target" },
  { key: "result", label: "Result" },
];

export type AuditRowProps = Omit<ComponentProps<"tr">, "children"> & {
  /** When the staff member read or acted. */
  at: string;
  /** The staff id. */
  actor: string;
  /** The roles of the staff member, shown on hover. */
  roles?: string;
  /** What the staff member did. */
  action: string;
  /** The target, as a `MemberLink` or as an id. */
  target?: ReactNode;
  /** True when the server allowed it. */
  ok: boolean;
  /** The reason and the code after the result. */
  detail?: string;
  /** The raw detail, shown on hover. */
  detailTitle?: string;
};

/**
 * One staff read or action in a `DataTable` with `auditColumns`. A refused row is marked red.
 * @model spec/consoleWorkspace.md
 */
export function AuditRow({ at, actor, roles, action, target, ok, detail, detailTitle, ...props }: AuditRowProps) {
  return (
    <TableRow {...props}>
      <DataCell muted>{at}</DataCell>
      <DataCell title={roles}>{actor}</DataCell>
      <DataCell>{action}</DataCell>
      <DataCell>{target}</DataCell>
      <DataCell title={detailTitle}>
        <span className="flex flex-wrap items-center gap-1">
          <StatusMark tone={ok ? "ok" : "destructive"} label={ok ? "ok" : "refused"} showLabel />
          {detail ? <span className="text-muted-foreground">{detail}</span> : null}
        </span>
      </DataCell>
    </TableRow>
  );
}

export type AuditQueryProps = Omit<ComponentProps<"form">, "children" | "onSubmit"> & {
  /** The phase of the audit log; `AuditLoading` shows the button busy. */
  phase: AuditPhase;
  /** The generated `canLoadAudit(w)`. */
  canLoad: boolean;
  actor: string;
  onActorChange: (actor: string) => void;
  target: string;
  onTargetChange: (target: string) => void;
  /** Loads the rows: the generated `loadAudit`. The server logs each load. */
  onLoad: () => void;
};

/** The actor and target fields of the audit log, and its Load button. */
export function AuditQuery({ phase, canLoad, actor, onActorChange, target, onTargetChange, onLoad, className, ...props }: AuditQueryProps) {
  return (
    <form
      className={cn("flex flex-wrap items-center gap-2", className)}
      onSubmit={(event) => {
        event.preventDefault();
        if (canLoad) onLoad();
      }}
      {...props}
    >
      <Input className="w-40" aria-label="Actor" placeholder="Actor" value={actor} onChange={(event) => onActorChange(event.target.value)} />
      <Input className="w-40" aria-label="Target id" placeholder="Target id" value={target} onChange={(event) => onTargetChange(event.target.value)} />
      <Button type="submit" variant="outline" disabled={!canLoad} loading={phase === "AuditLoading"}>
        Load
      </Button>
    </form>
  );
}
