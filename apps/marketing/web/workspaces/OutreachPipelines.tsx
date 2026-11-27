import { useState } from "react";
import {
  Button,
  DataCell,
  DataTable,
  Dialog,
  DialogContent,
  DialogTitle,
  Input,
  Kpi,
  KpiGrid,
  Progress,
  Segments,
  Select,
  SelectItem,
  StatusMark,
  TableRow,
  Textarea,
} from "@thenetwork/ui";
import type { BdDeal, VideoAsset } from "../../src/types.ts";
import { formatUsdCents, humanize } from "../format.ts";
import { marketingStore, useMarketingStore } from "../store.ts";
import type { VideoLintResult } from "../types.ts";

type SubView = "bd" | "vip" | "video" | "inbox";

const subViews: { value: SubView; label: string }[] = [
  { value: "bd", label: "Venues & BD" },
  { value: "vip", label: "VIP Salons" },
  { value: "video", label: "Video Factory" },
  { value: "inbox", label: "Outreach Inbox" },
];

const nextBdStage: Record<string, string> = {
  prospect: "enriched",
  enriched: "pitched",
  pitched: "negotiating",
  negotiating: "contracted",
  contracted: "kit_shipped",
  kit_shipped: "live",
  live: "audited",
};

const nextVideoStage: Record<string, string> = {
  trend: "script",
  script: "voice_render",
  voice_render: "qa",
  qa: "published",
  published: "measured",
};

const outreachChannels = [
  { value: "email", label: "Email" },
  { value: "venue", label: "Venue" },
  { value: "x", label: "X" },
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube", label: "YouTube" },
];

export function OutreachPipelinesWorkspace() {
  const s = useMarketingStore();
  const [view, setView] = useState<SubView>("bd");
  const [busy, setBusy] = useState<string | null>(null);

  const [dtmfDeal, setDtmfDeal] = useState<BdDeal | null>(null);
  const [dtmfPhone, setDtmfPhone] = useState("");
  const [dtmfChallengePinHint, setDtmfChallengePinHint] = useState<string | null>(null);
  const [dtmfPin, setDtmfPin] = useState("");

  const [qrCode, setQrCode] = useState("");
  const [qrDest, setQrDest] = useState("https://ntwrk.party/?ref=venue");
  const [qrQty, setQrQty] = useState("250");

  const [vipHooks, setVipHooks] = useState<Record<string, string>>({});
  const [videoLints, setVideoLints] = useState<Record<string, VideoLintResult>>({});

  const [outreachHumanId, setOutreachHumanId] = useState("");
  const [outreachChannel, setOutreachChannel] = useState("email");
  const [outreachSubject, setOutreachSubject] = useState("");
  const [outreachBody, setOutreachBody] = useState("");
  const [simReplyText, setSimReplyText] = useState("");
  const [simReplyTarget, setSimReplyTarget] = useState<string | null>(null);

  const { campaigns, agents, deals, qrBatches, vips, videos, outreach, humans } = s.datasets;
  const activeCampaignId = s.selectedCampaignId || campaigns[0]?.id || "";
  const defaultAgentId = agents[0]?.id ?? "";

  const openDtmfModal = (deal: BdDeal) => {
    setDtmfDeal(deal);
    setDtmfPhone(deal.businessPhone ?? "+12125550199");
    setDtmfChallengePinHint(null);
    setDtmfPin("");
  };

  const handleIssueDtmf = async () => {
    if (!dtmfDeal || !dtmfPhone.trim()) return;
    setBusy("dtmf-issue");
    try {
      const res = await marketingStore.api.startBdCallback(dtmfDeal.id, dtmfPhone.trim());
      setDtmfChallengePinHint(res.expectedPin ?? null);
      marketingStore.pushToast("info", "DTMF callback challenge issued");
    } catch (err) {
      marketingStore.pushToast("destructive", err instanceof Error ? err.message : "Challenge failed");
    } finally {
      setBusy(null);
    }
  };

  const handleVerifyDtmf = async () => {
    if (!dtmfDeal || !dtmfPin.trim()) return;
    setBusy("dtmf-verify");
    try {
      await marketingStore.api.verifyBdCallbackPin(dtmfDeal.id, dtmfPin.trim());
      marketingStore.pushToast("ok", `Verified callback for ${dtmfDeal.venueName}`);
      setDtmfDeal(null);
      await marketingStore.loadWorkspaceData("outreach");
    } catch (err) {
      marketingStore.pushToast("destructive", err instanceof Error ? err.message : "PIN verification failed");
    } finally {
      setBusy(null);
    }
  };

  const handleCreateQr = async () => {
    if (!activeCampaignId || !qrCode.trim()) return;
    setBusy("create-qr");
    try {
      await marketingStore.api.createQrBatch({
        campaignId: activeCampaignId,
        city: s.selectedCity,
        batchCode: qrCode.trim(),
        destinationUrl: qrDest.trim() || "https://ntwrk.party",
        printQty: Math.max(10, Number.parseInt(qrQty, 10) || 250),
      });
      setQrCode("");
      marketingStore.pushToast("ok", "QR batch created");
      await marketingStore.loadWorkspaceData("outreach");
    } catch (err) {
      marketingStore.pushToast("destructive", err instanceof Error ? err.message : "QR batch failed");
    } finally {
      setBusy(null);
    }
  };

  const handleLintVideo = async (asset: VideoAsset) => {
    setBusy(`lint-${asset.id}`);
    try {
      const res = await marketingStore.api.lintVideo({
        id: asset.id,
        title: asset.title,
        hookText: asset.hook,
        dialogue: asset.script,
        ftcDisclosureText: asset.ftcDisclosed ? "#Ad" : null,
      });
      setVideoLints((prev) => ({ ...prev, [asset.id]: res.lint }));
    } catch (err) {
      marketingStore.pushToast("destructive", err instanceof Error ? err.message : "Lint failed");
    } finally {
      setBusy(null);
    }
  };

  const handleQueueOutreach = async () => {
    const humanId = outreachHumanId || humans[0]?.id;
    if (!activeCampaignId || !defaultAgentId || !humanId || !outreachBody.trim()) {
      marketingStore.pushToast("destructive", "Select a contact and enter message body.");
      return;
    }
    setBusy("queue-outreach");
    try {
      await marketingStore.api.queueOutreach({
        campaignId: activeCampaignId,
        agentId: defaultAgentId,
        humanId,
        channel: outreachChannel,
        tier: 1,
        subject: outreachSubject.trim() || "Partnership inquiry",
        bodyText: outreachBody.trim(),
      });
      setOutreachSubject("");
      setOutreachBody("");
      marketingStore.pushToast("ok", "Outreach message queued");
      await marketingStore.loadWorkspaceData("outreach");
    } catch (err) {
      marketingStore.pushToast("destructive", err instanceof Error ? err.message : "Queue blocked");
    } finally {
      setBusy(null);
    }
  };

  const sentCount = outreach.filter((m) => m.status === "sent" || m.status === "delivered").length;
  const repliedCount = outreach.filter((m) => m.status === "replied").length;
  const blockedCount = outreach.filter((m) => m.status === "blocked_stop" || m.status === "blocked_policy").length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segments aria-label="Outreach pipeline section" value={view} onValueChange={(v) => setView(v as SubView)} options={subViews} />
        <Button
          variant="outline"
          size="sm"
          loading={busy === "dispatch"}
          onClick={() => {
            void (async () => {
              setBusy("dispatch");
              try {
                const res = await marketingStore.api.dispatchOutreach(activeCampaignId || undefined);
                marketingStore.pushToast("ok", `Dispatched ${res.sent ?? 0} live · ${res.dryRun ?? 0} dry-run`);
                await marketingStore.loadWorkspaceData("outreach");
              } catch (err) {
                marketingStore.pushToast("destructive", err instanceof Error ? err.message : "Dispatch failed");
              } finally {
                setBusy(null);
              }
            })();
          }}
        >
          Dispatch Pending
        </Button>
      </div>

      {view === "bd" ? (
        <div className="flex flex-col gap-4">
          <div className="overflow-x-auto rounded-md border border-border bg-card">
            <DataTable
              columns={[
                { key: "venue", label: "Venue" },
                { key: "stage", label: "Stage" },
                { key: "offer", label: "Offer", numeric: true },
                { key: "callback", label: "DTMF Callback" },
                { key: "contract", label: "Contract" },
                { key: "actions", label: "Actions" },
              ]}
              empty={deals.length === 0 ? "No venue BD deals yet." : undefined}
            >
              {deals.map((deal) => {
                const next = nextBdStage[deal.stage];
                return (
                  <TableRow key={deal.id}>
                    <DataCell>{deal.venueName}</DataCell>
                    <DataCell muted>{humanize(deal.stage)}</DataCell>
                    <DataCell numeric>{formatUsdCents(deal.offeredCents)}</DataCell>
                    <DataCell>
                      {deal.phoneCallbackVerified ? (
                        <StatusMark tone="ok" label="Verified" showLabel />
                      ) : (
                        <Button variant="outline" size="sm" onClick={() => openDtmfModal(deal)}>
                          DTMF Verify
                        </Button>
                      )}
                    </DataCell>
                    <DataCell>
                      {deal.contractHash ? (
                        <span className="font-mono text-xs text-muted-foreground">{deal.contractHash.slice(0, 10)}</span>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          loading={busy === `contract-${deal.id}`}
                          onClick={() => {
                            void (async () => {
                              setBusy(`contract-${deal.id}`);
                              try {
                                await marketingStore.api.generateBdContract(deal.id, "venue_placement");
                                marketingStore.pushToast("ok", `Clickwrap contract generated for ${deal.venueName}`);
                                await marketingStore.loadWorkspaceData("outreach");
                              } catch (err) {
                                marketingStore.pushToast("destructive", err instanceof Error ? err.message : "Contract failed");
                              } finally {
                                setBusy(null);
                              }
                            })();
                          }}
                        >
                          Generate
                        </Button>
                      )}
                    </DataCell>
                    <DataCell>
                      {next ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={busy === `stage-${deal.id}`}
                          onClick={() => {
                            void (async () => {
                              setBusy(`stage-${deal.id}`);
                              try {
                                await marketingStore.api.advanceBdStage(deal.id, next);
                                marketingStore.pushToast("ok", `Advanced ${deal.venueName} to ${humanize(next)}`);
                                await marketingStore.loadWorkspaceData("outreach");
                              } catch (err) {
                                marketingStore.pushToast("destructive", err instanceof Error ? err.message : "Stage blocked");
                              } finally {
                                setBusy(null);
                              }
                            })();
                          }}
                        >
                          {`→ ${humanize(next)}`}
                        </Button>
                      ) : (
                        <StatusMark tone="ok" label="Complete" showLabel />
                      )}
                    </DataCell>
                  </TableRow>
                );
              })}
            </DataTable>
          </div>

          <section className="flex flex-col gap-3 rounded-md border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">Serialized QR Batches</h3>
              <div className="flex flex-wrap items-center gap-2">
                <Input aria-label="QR batch code" placeholder="NYC-SOHO-01" value={qrCode} onChange={(e) => setQrCode(e.target.value)} className="h-8 w-36 text-xs" />
                <Input aria-label="QR destination URL" value={qrDest} onChange={(e) => setQrDest(e.target.value)} className="h-8 w-52 text-xs" />
                <Input aria-label="Print quantity" value={qrQty} onChange={(e) => setQrQty(e.target.value)} className="h-8 w-20 text-xs" />
                <Button variant="primary" size="sm" loading={busy === "create-qr"} onClick={() => void handleCreateQr()}>
                  New QR Batch
                </Button>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {qrBatches.map((batch) => (
                <div key={batch.id} className="flex flex-col gap-2 rounded-md border border-border bg-background p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-semibold text-foreground">{batch.batchCode}</span>
                    <span className="tabular-nums text-muted-foreground">{`${batch.printQty} printed`}</span>
                  </div>
                  <div className="flex items-baseline justify-between tabular-nums">
                    <span className="text-muted-foreground">{`${batch.scans} scans`}</span>
                    <span className="font-semibold text-ok">{`${batch.verifiedSignups} verified 18+`}</span>
                  </div>
                  <Progress value={batch.verifiedSignups} max={Math.max(1, batch.scans)} aria-label={`QR conversion for ${batch.batchCode}`} className="h-1.5" />
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {view === "vip" ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {vips.map((vip) => {
            const hook = vipHooks[vip.id] ?? "";
            return (
              <div key={vip.id} className="flex flex-col gap-3 rounded-md border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-foreground">{vip.name}</div>
                    <div className="text-xs text-muted-foreground">{`${humanize(vip.archetype)} · ${vip.organization ?? vip.city.toUpperCase()}`}</div>
                  </div>
                  <div className="flex items-center gap-2 text-xs tabular-nums">
                    <span className="font-semibold text-chart-1">{`Score ${vip.prestigeScore}`}</span>
                    <StatusMark tone={vip.status === "onboarded" || vip.status === "replied" ? "ok" : "primary"} label={humanize(vip.status)} showLabel />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    aria-label={`Proof-of-work hook for ${vip.name}`}
                    placeholder="Specific 1-line public achievement hook (14+ chars)"
                    value={hook}
                    onChange={(e) => setVipHooks((prev) => ({ ...prev, [vip.id]: e.target.value }))}
                    className="h-8 text-xs"
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    loading={busy === `vip-${vip.id}`}
                    onClick={() => {
                      void (async () => {
                        setBusy(`vip-${vip.id}`);
                        try {
                          await marketingStore.api.draftVipInvite(vip.id, hook);
                          marketingStore.pushToast("ok", `Drafted salon invite for ${vip.name}`);
                          await marketingStore.loadWorkspaceData("outreach");
                        } catch (err) {
                          marketingStore.pushToast("destructive", err instanceof Error ? err.message : "Invite validation failed");
                        } finally {
                          setBusy(null);
                        }
                      })();
                    }}
                  >
                    Draft Invite
                  </Button>
                </div>
                {vip.inviteDraft ? (
                  <p className="rounded-sm bg-muted/50 p-2 text-xs text-foreground">{vip.inviteDraft}</p>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {view === "video" ? (
        <div className="flex flex-col gap-3">
          {videos.map((asset) => {
            const lint = videoLints[asset.id];
            const next = nextVideoStage[asset.stage];
            return (
              <div key={asset.id} className="flex flex-col gap-2 rounded-md border border-border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground">{asset.title}</div>
                    <div className="text-xs text-muted-foreground">{asset.hook}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs tabular-nums text-muted-foreground">{`${asset.views.toLocaleString("en-US")} views · ${asset.retention3sPct}% 3s · ${asset.signups} signups`}</span>
                    <StatusMark tone={asset.ftcDisclosed ? "ok" : "warn"} label={asset.ftcDisclosed ? "FTC #Ad" : "Missing FTC"} showLabel />
                    <Button variant="outline" size="sm" loading={busy === `lint-${asset.id}`} onClick={() => void handleLintVideo(asset)}>
                      Lint Script
                    </Button>
                    {next ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={busy === `vstage-${asset.id}`}
                        onClick={() => {
                          void (async () => {
                            setBusy(`vstage-${asset.id}`);
                            try {
                              await marketingStore.api.advanceVideoStage(asset.id, next);
                              marketingStore.pushToast("ok", `Advanced "${asset.title}" to ${humanize(next)}`);
                              await marketingStore.loadWorkspaceData("outreach");
                            } catch (err) {
                              marketingStore.pushToast("destructive", err instanceof Error ? err.message : "Stage advance blocked");
                            } finally {
                              setBusy(null);
                            }
                          })();
                        }}
                      >
                        {`→ ${humanize(next)}`}
                      </Button>
                    ) : null}
                  </div>
                </div>
                {lint ? (
                  <div className="flex flex-col gap-1 rounded-sm border border-border bg-background p-2 text-xs">
                    <StatusMark tone={lint.pass ? "ok" : "destructive"} label={lint.pass ? "Script lint passed" : "Script lint failed"} showLabel />
                    {lint.errors.map((err) => (
                      <div key={err} className="text-destructive">{err}</div>
                    ))}
                    {lint.warnings.map((warn) => (
                      <div key={warn} className="text-warn">{warn}</div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {view === "inbox" ? (
        <div className="flex flex-col gap-4">
          <KpiGrid>
            <Kpi label="Total Outreach" value={outreach.length} />
            <Kpi label="Sent & Delivered" value={sentCount} tone="ok" />
            <Kpi label="Replies" value={repliedCount} tone={repliedCount > 0 ? "ok" : undefined} />
            <Kpi label="Blocked (STOP/Policy)" value={blockedCount} tone={blockedCount > 0 ? "warn" : undefined} />
          </KpiGrid>

          <section className="flex flex-col gap-2 rounded-md border border-border bg-card p-4">
            <h3 className="text-sm font-semibold text-foreground">Compose & Queue Outreach</h3>
            <div className="grid gap-2 sm:grid-cols-3">
              <Select aria-label="Contact" value={outreachHumanId || humans[0]?.id || ""} onValueChange={setOutreachHumanId} className="h-8 text-xs">
                {humans.map((human) => (
                  <SelectItem key={human.id} value={human.id}>
                    {`${human.displayLabel} (${human.role})`}
                  </SelectItem>
                ))}
              </Select>
              <Select aria-label="Channel" value={outreachChannel} onValueChange={setOutreachChannel} className="h-8 text-xs">
                {outreachChannels.map((ch) => (
                  <SelectItem key={ch.value} value={ch.value}>
                    {ch.label}
                  </SelectItem>
                ))}
              </Select>
              <Input aria-label="Subject" placeholder="Subject" value={outreachSubject} onChange={(e) => setOutreachSubject(e.target.value)} className="h-8 text-xs" />
            </div>
            <Textarea aria-label="Outreach message body" placeholder="Draft compliant outreach with clear brand identity and opt-out..." value={outreachBody} onChange={(e) => setOutreachBody(e.target.value)} />
            <div className="flex justify-end">
              <Button variant="primary" size="sm" loading={busy === "queue-outreach"} onClick={() => void handleQueueOutreach()}>
                Queue Message
              </Button>
            </div>
          </section>

          <div className="overflow-x-auto rounded-md border border-border bg-card">
            <DataTable
              columns={[
                { key: "channel", label: "Channel" },
                { key: "subject", label: "Subject & Summary" },
                { key: "status", label: "Status" },
                { key: "sim", label: "Sim Reply" },
              ]}
              empty={outreach.length === 0 ? "No outreach messages yet." : undefined}
            >
              {outreach.map((msg) => (
                <TableRow key={msg.id}>
                  <DataCell>{humanize(msg.channel)}</DataCell>
                  <DataCell>
                    <div className="font-medium text-foreground">{msg.subject ?? "(no subject)"}</div>
                    <div className="truncate text-xs text-muted-foreground">{msg.bodySummary}</div>
                  </DataCell>
                  <DataCell>
                    <StatusMark
                      tone={msg.status === "replied" || msg.status === "delivered" ? "ok" : msg.status.startsWith("blocked") || msg.status === "failed" ? "destructive" : "neutral"}
                      label={humanize(msg.status)}
                      showLabel
                    />
                  </DataCell>
                  <DataCell>
                    {simReplyTarget === msg.id ? (
                      <div className="flex items-center gap-1.5">
                        <Input aria-label="Brand reply text" value={simReplyText} onChange={(e) => setSimReplyText(e.target.value)} className="h-7 w-44 text-xs" />
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => {
                            void (async () => {
                              await marketingStore.sendSimCommand({ type: "reply_as_brand", messageId: msg.id, body: simReplyText }, "Sent simulated brand reply");
                              setSimReplyTarget(null);
                              setSimReplyText("");
                            })();
                          }}
                        >
                          Send
                        </Button>
                      </div>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => setSimReplyTarget(msg.id)}>
                        Reply as Brand
                      </Button>
                    )}
                  </DataCell>
                </TableRow>
              ))}
            </DataTable>
          </div>
        </div>
      ) : null}

      <Dialog open={dtmfDeal !== null} onOpenChange={(open) => !open && setDtmfDeal(null)}>
        <DialogContent>
          <DialogTitle>{dtmfDeal ? `DTMF Callback: ${dtmfDeal.venueName}` : "DTMF Callback"}</DialogTitle>
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Input aria-label="Venue business phone" value={dtmfPhone} onChange={(e) => setDtmfPhone(e.target.value)} className="h-9 text-sm" />
              <Button variant="outline" size="sm" loading={busy === "dtmf-issue"} onClick={() => void handleIssueDtmf()}>
                Call & Issue PIN
              </Button>
            </div>
            {dtmfChallengePinHint ? (
              <div className="rounded-sm bg-muted/60 px-2.5 py-1.5 font-mono text-xs text-muted-foreground">
                {`Sandbox DTMF PIN: ${dtmfChallengePinHint}`}
              </div>
            ) : null}
            <div className="flex items-center gap-2">
              <Input aria-label="DTMF PIN" placeholder="Enter spoken 6-digit PIN" value={dtmfPin} onChange={(e) => setDtmfPin(e.target.value)} className="h-9 text-sm" />
              <Button variant="primary" size="sm" loading={busy === "dtmf-verify"} onClick={() => void handleVerifyDtmf()}>
                Verify PIN
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
