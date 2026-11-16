// spec/consoleNavigation.md, "The console view follows the page"
// spec/consoleNavigation.md, "Only a cross-app viewer in real mode opens one person across apps"
import { useEffect, useState } from "react";
import {
  Alert, Button, DataCell, DataTable, Disclosure, EmptyState, FactLine, InspectorSection, Input, Select, SelectItem, Spinner, StatusMark, TableRow,
  type DataColumn, type StatusTone,
} from "@thenetwork/ui";
import { canOpenPerson, type ConsoleView, personLookupShown } from "../../core/src/generated/consoleNavigation.ts";
import type { AppHealth, PersonAppPanel, PersonSummary } from "../src/types.ts";
import { store, useStore } from "./store.ts";
import { ago, consoleNav, humanize, localDate } from "./ui.tsx";

/** The page that covers the stage: the health of every app, one person across apps, or no role. */
export function AppPage({ view }: { view: ConsoleView }) {
  const s = useStore();
  if (view === "AllAppsView") return <AllApps />;
  if (view === "PersonView" && s.page.kind === "person") return <PersonView id={s.page.id} />;
  if (view === "NoRoleView") return <EmptyState title="You have no role for an app." />;
  return null;
}

const MATCHING_TEXT: Record<AppHealth["matching"], string> = { on: "on", off: "off", locked: "off until pack" };
const LEVEL_TONE: Record<string, StatusTone> = { bad: "destructive", warn: "warn", info: "primary", none: "ok" };
const APP_COLUMNS: DataColumn[] = [
  { key: "app", label: "App" }, { key: "members", label: "Members", numeric: true }, { key: "backlog", label: "Review backlog", numeric: true },
  { key: "sla", label: "SLA misses", numeric: true }, { key: "failures", label: "Send failures", numeric: true }, { key: "matching", label: "Matching" },
];

function AllApps() {
  const s = useStore();
  const [rows, setRows] = useState<AppHealth[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => store.appsHealth().then(r => { if (!live) return; if (r.data) { setRows(r.data.apps); setError(null); } else setError(r.error); });
    load();
    const t = setInterval(load, 10_000);
    return () => { live = false; clearInterval(t); };
  }, [s.mode]);
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      {!!s.apps().length && (
        <DataTable columns={APP_COLUMNS}>
          {(rows ?? []).map(r => (
            <TableRow key={r.app} className="cursor-pointer" title={r.error ?? `Open ${r.app}`} onClick={() => store.setApp(r.app)}>
              <DataCell>
                <span className="flex items-center gap-2">
                  <StatusMark tone={LEVEL_TONE[r.worst ?? "none"] ?? "neutral"} label={r.worst ?? "ok"} />
                  <Button variant="ghost" size="sm" className="h-auto px-1 font-medium hover:underline" onClick={e => { e.stopPropagation(); store.setApp(r.app); }}>{r.app}</Button>
                </span>
              </DataCell>
              {r.available ? (
                <>
                  <DataCell numeric>{r.members}</DataCell>
                  <DataCell numeric>{r.reviewBacklog}</DataCell>
                  <DataCell numeric className={r.slaMisses ? "text-destructive" : undefined}>{r.slaMisses} <span className="text-muted-foreground">/ {r.slaHours} h</span></DataCell>
                  <DataCell numeric className={r.sendFailures ? "text-warn" : undefined}>{r.sendFailures}</DataCell>
                  <DataCell>{MATCHING_TEXT[r.matching]}</DataCell>
                </>
              ) : <DataCell colSpan={5} muted>{r.error ?? "unavailable"}</DataCell>}
            </TableRow>
          ))}
        </DataTable>
      )}
      {error && <Alert variant="destructive">{error}</Alert>}
      {personLookupShown(consoleNav(s)) && <PersonLookup />}
    </div>
  );
}

/** Finds a person by a member id in one app, or opens a person id. */
function PersonLookup() {
  const s = useStore();
  const [app, setApp] = useState(s.app);
  const [member, setMember] = useState("");
  const [error, setError] = useState<string | null>(null);
  const find = async () => {
    const q = member.trim();
    if (!q) return;
    if (/^[0-9a-f-]{36}$/i.test(q)) { store.openPerson(q); return; }
    const r = await store.findPerson(q, app);
    if (r.data) store.openPerson(r.data.personId); else setError(r.error);
  };
  return (
    <form className="flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); find(); }}>
      <span className="text-sm text-muted-foreground">Cross-app view</span>
      <Select className="w-32" value={app} onValueChange={setApp} aria-label="App of the member">
        {(s.me?.appInfo ?? []).map(a => <SelectItem key={a.id} value={a.id}>{a.id}</SelectItem>)}
      </Select>
      <Input className="min-w-40 flex-1" placeholder="Member id or person id" value={member} onChange={e => { setMember(e.target.value); setError(null); }} aria-label="Member id or person id" />
      <Button variant="outline" type="submit">Open</Button>
      {error && <span role="alert" className="text-sm text-destructive">{error}</span>}
    </form>
  );
}

/** One person across apps. Each app panel stays closed until staff type a reason (the server logs it first). */
function PersonView({ id }: { id: string }) {
  const [p, setP] = useState<PersonSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setP(null); setError(null);
    store.person(id).then(r => { if (r.data) setP(r.data); else setError(r.status === 403 ? "Your role cannot open the cross-app view." : r.error); });
  }, [id]);
  const blocks = p ? [...p.blocks.made.map(b => `→ ${b.person.slice(0, 8)}${b.originApp === "*" ? "" : ` (${b.originApp})`}`), ...p.blocks.received.map(b => `← ${b.person.slice(0, 8)}${b.originApp === "*" ? "" : ` (${b.originApp})`}`)] : [];
  return (
    <InspectorSection className="mx-auto w-full max-w-4xl" title={`Person ${id.slice(0, 8)}`} action={<Button variant="outline" size="sm" onClick={() => store.setApp("all")}>Close</Button>}>
      {error && <Alert variant="destructive">{error}</Alert>}
      {!p && !error && <Spinner label="Loading" />}
      {p && (
        <>
          <FactLine parts={[`Lowest age ${p.lowestAge ?? "unknown"}`, `since ${localDate(p.createdAt)}`, p.deletedAt ? `deleted ${localDate(p.deletedAt)}` : null]} />
          {p.holds.length > 0 && (
            <Alert variant="destructive">
              Hold on every app: {p.holds.map(h => (h.app === "*" ? "account restricted (on an app not shown)" : `${humanize(h.level)} (${h.app})`)).join(", ")}
            </Alert>
          )}
          <FactLine parts={[`Blocks made ${p.blocks.made.length}`, `received ${p.blocks.received.length}`, blocks.length ? blocks.join(", ") : null]} />
          {p.memberships.map(m => <AppPanel key={m.app} personId={p.personId} m={m} />)}
          {!p.memberships.length && <p className="text-sm text-muted-foreground">No memberships shown.</p>}
          {(p.privateApps ?? []).map(app => <AppPanel key={app} personId={p.personId} m={{ app, state: "", hold: false }} hidden />)}
        </>
      )}
    </InspectorSection>
  );
}

function AppPanel({ personId, m, hidden }: { personId: string; m: PersonSummary["memberships"][number]; hidden?: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [panel, setPanel] = useState<PersonAppPanel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const read = async () => {
    const r = await store.openPersonApp(personId, m.app, reason.trim());
    if (r.data) { setPanel(r.data); setError(null); } else setError(r.error);
  };
  const summary = (
    <span className="flex flex-wrap items-center gap-2">
      <span className="font-semibold">{m.app}</span>
      <span className="font-normal text-muted-foreground">
        {hidden ? "private app: membership not shown · open with a reason" : `${humanize(m.state)}${m.joinedAt ? ` · joined ${localDate(m.joinedAt)}` : ""}${m.leftAt ? ` · left ${localDate(m.leftAt)}` : ""}`}
      </span>
      {m.hold && <StatusMark tone="destructive" label="hold" />}
      {m.review && <StatusMark tone="warn" label={humanize(m.review)} showLabel />}
    </span>
  );
  return (
    <Disclosure className="rounded-lg border border-border bg-card p-3 text-card-foreground" summary={summary} open={open} onOpenChange={setOpen}>
      {open && !panel && (
        <form className="flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); read(); }}>
          <Input className="min-w-40 flex-1" autoFocus placeholder="Reason (logged)" value={reason} onChange={e => setReason(e.target.value)} aria-label={`Reason to open ${m.app}`} />
          <Button variant="outline" type="submit" disabled={reason.trim().length < 5}>Open</Button>
          {error && <span role="alert" className="text-sm text-destructive">{error}</span>}
        </form>
      )}
      {open && panel && (
        <div className="flex flex-col gap-1">
          <p>Member {panel.memberId} · {humanize(panel.state)} · trust {panel.trust}</p>
          <FactLine parts={[`Messages in ${panel.messages.in}`, `out ${panel.messages.out}`, panel.messages.last ? `last ${ago(panel.messages.last, Date.now())}` : null, `opportunities ${panel.opportunities}`]} />
          {panel.cases.map(c => <p key={c.id}>Case {c.id} · {c.level} · {c.status} · opened {localDate(c.opened)}</p>)}
        </div>
      )}
    </Disclosure>
  );
}

/** In a member panel: opens the person across apps (cross_app_safety or admin, real data). */
export function CrossAppButton({ memberId }: { memberId: string }) {
  const s = useStore();
  const [error, setError] = useState<string | null>(null);
  if (!canOpenPerson(consoleNav(s))) return null;
  return (
    <>
      <Button variant="outline" size="sm" onClick={async () => { const r = await store.findPerson(memberId); if (r.data) store.openPerson(r.data.personId); else setError(r.error); }}>Cross-app view</Button>
      {error && <span className="text-sm text-muted-foreground">{error}</span>}
    </>
  );
}
