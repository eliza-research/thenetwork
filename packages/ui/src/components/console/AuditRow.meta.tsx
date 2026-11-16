import type { ComponentMeta } from "../../lib/meta.ts";
import { auditColumns, type AuditRowProps } from "./AuditRow.tsx";
import { DataTable } from "./DataTable.tsx";

export const meta: ComponentMeta<AuditRowProps> = {
  args: { at: "Nov 14, 3:20 PM", actor: "dana", roles: "safety", action: "reveal", target: "member m_102", ok: true },
  examples: { Refused: { ok: false, detail: "· role" } },
  decorator: (story) => <DataTable columns={auditColumns}>{story()}</DataTable>,
};
