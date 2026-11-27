import { useState } from "react";
import {
  Button,
  Checkbox,
  DataCell,
  DataTable,
  Input,
  Label,
  StatusMark,
  TableRow,
} from "@thenetwork/ui";
import { formatUsdCents, humanize } from "../format.ts";
import { marketingStore, useMarketingStore } from "../store.ts";

export function FieldTrustWorkspace() {
  const s = useMarketingStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [sybilClusters, setSybilClusters] = useState<Array<{ clusterId: string; claimIds: string[]; reasons: string[] }>>([]);

  const [supEmail, setSupEmail] = useState("");
  const [supReason, setSupReason] = useState("operator_stop");
  const [supMinor, setSupMinor] = useState(false);

  const { proofs, claims, humans, suppressions } = s.datasets;
  const compliance = s.compliance ?? s.summary?.overview.compliance;
  const gateEntries = Object.entries(compliance?.gates ?? {});
  const breakerEntries = Object.entries(compliance?.breakers ?? {});

  const handleReviewProof = async (proofId: string, verdict: "verified" | "rejected") => {
    setBusy(`proof-${proofId}-${verdict}`);
    try {
      await marketingStore.api.reviewProof(proofId, verdict);
      marketingStore.pushToast("ok", `Proof marked ${verdict}`);
      await marketingStore.loadWorkspaceData("trust");
    } catch (err) {
      marketingStore.pushToast("destructive", err instanceof Error ? err.message : "Proof review failed");
    } finally {
      setBusy(null);
    }
  };

  const handleSybilScan = async () => {
    setBusy("sybil");
    try {
      const res = await marketingStore.api.scanSybilRings(s.selectedCampaignId || undefined);
      const clusters = res.scan?.clusters ?? [];
      setSybilClusters(clusters);
      marketingStore.pushToast(
        clusters.length > 0 ? "destructive" : "ok",
        clusters.length > 0
          ? `Quarantined ${res.quarantinedClaimIds?.length ?? 0} claims across ${clusters.length} Sybil rings`
          : "No Sybil rings detected",
      );
      await marketingStore.loadWorkspaceData("trust");
    } catch (err) {
      marketingStore.pushToast("destructive", err instanceof Error ? err.message : "Sybil scan failed");
    } finally {
      setBusy(null);
    }
  };

  const handleAddSuppression = async () => {
    if (!supEmail.trim()) return;
    setBusy("add-sup");
    try {
      const isPhone = /^\+?[0-9\s()-]{7,}$/.test(supEmail.trim());
      await marketingStore.api.addSuppression({
        ...(isPhone ? { phone: supEmail.trim() } : { email: supEmail.trim() }),
        reason: supReason.trim() || "operator_stop",
        sourceChannel: "email",
        isMinor: supMinor,
      });
      setSupEmail("");
      setSupMinor(false);
      marketingStore.pushToast("ok", "Added to global STOP suppression registry");
      await marketingStore.loadWorkspaceData("trust");
    } catch (err) {
      marketingStore.pushToast("destructive", err instanceof Error ? err.message : "Suppression failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2 rounded-md border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">Fail-Closed ComplianceGate & Breakers</h2>
          <span className="text-xs text-muted-foreground">
            {`${compliance?.env ?? "local"} · ${compliance?.liveBillingEnabled ? "Live billing" : "Dry-run"}`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {gateEntries.length > 0 ? (
            gateEntries.map(([mode, gate]) => (
              <div key={mode} className="flex items-center gap-2 rounded-sm border border-border bg-background px-2.5 py-1.5 text-xs">
                <StatusMark
                  tone={gate.status === "RED" || gate.allowed === false ? "destructive" : gate.status === "AMBER" ? "warn" : "ok"}
                  label={gate.status ?? (gate.allowed === false ? "RED" : "GREEN")}
                />
                <span className="font-medium text-foreground">{humanize(mode)}</span>
              </div>
            ))
          ) : (
            <StatusMark tone="ok" label="All default compliance gates armed (fail-closed in prod)" showLabel />
          )}
          {breakerEntries.map(([name, breaker]) => (
            <div key={name} className="flex items-center gap-2 rounded-sm border border-border bg-background px-2.5 py-1.5 text-xs">
              <StatusMark tone={breaker.state === "open" ? "destructive" : breaker.state === "half_open" ? "warn" : "ok"} label={breaker.state ?? "closed"} />
              <span className="font-mono text-muted-foreground">{name}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-foreground">Proof Review Queue</h2>
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <DataTable
            columns={[
              { key: "kind", label: "Proof Kind" },
              { key: "checks", label: "FTC / Geo / Release" },
              { key: "signups", label: "Verified 18+", numeric: true },
              { key: "verdict", label: "Verdict" },
              { key: "actions", label: "Decision" },
            ]}
            empty={proofs.length === 0 ? "No submitted proofs awaiting review." : undefined}
          >
            {proofs.map((proof) => (
              <TableRow key={proof.id}>
                <DataCell>{humanize(proof.proofKind)}</DataCell>
                <DataCell>
                  <div className="flex items-center gap-2">
                    <StatusMark tone={proof.ftcDisclosed ? "ok" : "destructive"} label="FTC" showLabel />
                    <StatusMark tone={proof.geoTimeValid ? "ok" : "warn"} label="Geo" showLabel />
                    <StatusMark tone={proof.likenessReleaseOk ? "ok" : "warn"} label="Release" showLabel />
                  </div>
                </DataCell>
                <DataCell numeric>{proof.verifiedSignupsCount}</DataCell>
                <DataCell>
                  <StatusMark
                    tone={proof.verdict === "verified" ? "ok" : proof.verdict === "rejected" ? "destructive" : "warn"}
                    label={humanize(proof.verdict)}
                    showLabel
                  />
                </DataCell>
                <DataCell>
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={proof.verdict === "verified"}
                      loading={busy === `proof-${proof.id}-verified`}
                      onClick={() => void handleReviewProof(proof.id, "verified")}
                    >
                      Verify
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={proof.verdict === "rejected"}
                      loading={busy === `proof-${proof.id}-rejected`}
                      onClick={() => void handleReviewProof(proof.id, "rejected")}
                    >
                      Reject
                    </Button>
                  </div>
                </DataCell>
              </TableRow>
            ))}
          </DataTable>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">Anti-Fraud & Sybil Ring Detection</h2>
          <Button variant="primary" size="sm" loading={busy === "sybil"} onClick={() => void handleSybilScan()}>
            Scan Sybil Rings
          </Button>
        </div>
        {sybilClusters.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {sybilClusters.map((cluster) => (
              <div key={cluster.clusterId} className="flex flex-col gap-1 rounded-md border border-destructive bg-card p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-semibold text-destructive">{cluster.clusterId}</span>
                  <span className="tabular-nums text-muted-foreground">{`${cluster.claimIds.length} claims`}</span>
                </div>
                <div className="text-muted-foreground">{cluster.reasons.join(", ")}</div>
              </div>
            ))}
          </div>
        ) : null}
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <DataTable
            columns={[
              { key: "person", label: "Claimant" },
              { key: "line", label: "Phone Line" },
              { key: "cluster", label: "Cluster" },
              { key: "amount", label: "Amount", numeric: true },
              { key: "status", label: "Status" },
            ]}
            empty={claims.length === 0 ? "No anti-fraud claims recorded." : undefined}
          >
            {claims.map((claim) => (
              <TableRow key={claim.id}>
                <DataCell>{claim.personKey}</DataCell>
                <DataCell muted>{humanize(claim.phoneLineType)}</DataCell>
                <DataCell muted>{claim.clusterId ?? "—"}</DataCell>
                <DataCell numeric>{formatUsdCents(claim.amountCents)}</DataCell>
                <DataCell>
                  <StatusMark
                    tone={claim.status === "approved" ? "ok" : claim.status === "quarantined" || claim.status === "rejected" ? "destructive" : "warn"}
                    label={humanize(claim.status)}
                    showLabel
                  />
                </DataCell>
              </TableRow>
            ))}
          </DataTable>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-foreground">Human Partners</h2>
          <div className="overflow-x-auto rounded-md border border-border bg-card">
            <DataTable
              columns={[
                { key: "label", label: "Partner" },
                { key: "role", label: "Role" },
                { key: "age", label: "Age", numeric: true },
                { key: "status", label: "Fence" },
              ]}
              empty={humans.length === 0 ? "No human partners registered." : undefined}
            >
              {humans.map((human) => (
                <TableRow key={human.id}>
                  <DataCell>{human.displayLabel}</DataCell>
                  <DataCell muted>{humanize(human.role)}</DataCell>
                  <DataCell numeric>{human.lowestAge ?? "—"}</DataCell>
                  <DataCell>
                    {human.stopped ? (
                      <StatusMark tone="destructive" label="STOP" showLabel />
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        loading={busy === `stop-${human.id}`}
                        onClick={() => {
                          void (async () => {
                            setBusy(`stop-${human.id}`);
                            try {
                              await marketingStore.api.stopHuman(human.id, "operator_stop");
                              marketingStore.pushToast("ok", `Marked STOP for ${human.displayLabel}`);
                              await marketingStore.loadWorkspaceData("trust");
                            } catch (err) {
                              marketingStore.pushToast("destructive", err instanceof Error ? err.message : "STOP failed");
                            } finally {
                              setBusy(null);
                            }
                          })();
                        }}
                      >
                        Mark STOP
                      </Button>
                    )}
                  </DataCell>
                </TableRow>
              ))}
            </DataTable>
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-foreground">Global STOP Suppression Registry</h2>
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card p-3">
            <Input
              aria-label="Email or phone to suppress"
              placeholder="Email or E.164 phone"
              value={supEmail}
              onChange={(e) => setSupEmail(e.target.value)}
              className="h-8 flex-1 text-xs"
            />
            <Input aria-label="Suppression reason" value={supReason} onChange={(e) => setSupReason(e.target.value)} className="h-8 w-36 text-xs" />
            <div className="flex items-center gap-1.5">
              <Checkbox id="sup-minor" checked={supMinor} onCheckedChange={(v) => setSupMinor(v === true)} />
              <Label htmlFor="sup-minor" className="text-xs">Minor</Label>
            </div>
            <Button variant="destructive" size="sm" loading={busy === "add-sup"} onClick={() => void handleAddSuppression()}>
              Suppress
            </Button>
          </div>
          <div className="overflow-x-auto rounded-md border border-border bg-card">
            <DataTable
              columns={[
                { key: "hash", label: "Contact Hash" },
                { key: "reason", label: "Reason" },
                { key: "minor", label: "Age Flag" },
              ]}
              empty={suppressions.length === 0 ? "No global suppressions recorded." : undefined}
            >
              {suppressions.map((item) => (
                <TableRow key={item.contactHash}>
                  <DataCell className="font-mono text-xs">{item.contactHash.slice(0, 16)}</DataCell>
                  <DataCell muted>{item.reason}</DataCell>
                  <DataCell>
                    <StatusMark tone={item.isMinor ? "destructive" : "neutral"} label={item.isMinor ? "Minor blocked" : "Adult STOP"} showLabel />
                  </DataCell>
                </TableRow>
              ))}
            </DataTable>
          </div>
        </section>
      </div>
    </div>
  );
}
