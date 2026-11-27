import { type ComponentProps, type ReactNode, useState } from "react";
import { cn, focusRing } from "../../lib/cn.ts";
import { StatusMark, type StatusTone } from "./StatusMark.tsx";

/** Outcome status of a single trace span. */
export type TraceSpanStatus = "ok" | "fallback" | "leak_blocked" | "flagged" | "error";

/** One timed span inside a hierarchical trace waterfall. */
export type TraceSpan = {
  id: string;
  parentId?: string | null;
  name: string;
  service?: string;
  /** Span start timestamp in milliseconds (relative or epoch). */
  startMs: number;
  /** Span duration in milliseconds. */
  durationMs: number;
  status: TraceSpanStatus;
  tokens?: number;
  costUsd?: number;
  model?: string;
  /** Span input payload, or `"[crypto-shredded]"` when erased. */
  input?: unknown;
  /** Span output payload, or `"[crypto-shredded]"` when erased. */
  output?: unknown;
  attributes?: Record<string, string | number | boolean | null>;
};

export type TraceWaterfallProps = Omit<ComponentProps<"div">, "children"> & {
  /** Flat list of spans linked by `parentId`. */
  spans: TraceSpan[];
  /** Controlled selected span ID. */
  selectedSpanId?: string;
  /** Called when a user selects a span row to inspect its details. */
  onSelectSpan?: (span: TraceSpan) => void;
  /** Shown when `spans` is empty. */
  empty?: ReactNode;
};

type OrderedSpan = { span: TraceSpan; depth: number; hasChildren: boolean };

const statusMeta: Record<TraceSpanStatus, { tone: StatusTone; label: string; bar: string }> = {
  ok: { tone: "ok", label: "OK", bar: "bg-chart-1" },
  fallback: { tone: "warn", label: "Fallback", bar: "bg-warn" },
  leak_blocked: { tone: "destructive", label: "Leak blocked", bar: "bg-destructive" },
  flagged: { tone: "warn", label: "Flagged", bar: "bg-warn" },
  error: { tone: "destructive", label: "Error", bar: "bg-destructive" },
};

const SHREDDED_TOKEN = "[crypto-shredded]";

const formatMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`);
const formatUsd = (usd: number) => `$${usd.toFixed(4)}`;

function orderSpans(spans: TraceSpan[]): OrderedSpan[] {
  const byId = new Map(spans.map((span) => [span.id, span]));
  const children = new Map<string | null, TraceSpan[]>();
  for (const span of spans) {
    const key = span.parentId && byId.has(span.parentId) ? span.parentId : null;
    const list = children.get(key) ?? [];
    list.push(span);
    children.set(key, list);
  }
  for (const list of children.values()) {
    list.sort((a, b) => a.startMs - b.startMs);
  }
  const result: OrderedSpan[] = [];
  const visited = new Set<string>();
  const walk = (parentId: string | null, depth: number) => {
    for (const span of children.get(parentId) ?? []) {
      if (visited.has(span.id)) continue;
      visited.add(span.id);
      const kids = children.get(span.id) ?? [];
      result.push({ span, depth, hasChildren: kids.length > 0 });
      walk(span.id, depth + 1);
    }
  };
  walk(null, 0);
  for (const span of spans) {
    if (!visited.has(span.id)) {
      result.push({ span, depth: 0, hasChildren: false });
    }
  }
  return result;
}

function PayloadBlock({ title, value }: { title: string; value: unknown }) {
  if (value === undefined) return null;
  const shredded = value === SHREDDED_TOKEN;
  const serialized = shredded ? SHREDDED_TOKEN : typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const containsShredded = !shredded && serialized.includes(SHREDDED_TOKEN);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
        <span>{title}</span>
        {shredded || containsShredded ? (
          <span className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">Shredded</span>
        ) : null}
      </div>
      {shredded ? (
        <div className="flex items-center gap-2 rounded-sm border border-border bg-muted/60 px-2.5 py-2 font-mono text-xs text-muted-foreground">
          <svg aria-hidden viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-3.5 shrink-0">
            <rect x="3" y="7" width="10" height="7" rx="1.5" />
            <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
          </svg>
          <span>{SHREDDED_TOKEN}</span>
        </div>
      ) : (
        <pre className="max-h-40 overflow-auto rounded-sm border border-border bg-muted/40 p-2 font-mono text-xs whitespace-pre-wrap text-foreground">
          {serialized}
        </pre>
      )}
    </div>
  );
}

/** Hierarchical trace waterfall with proportional duration bars, token/cost readouts, status marks, and span payload inspector. */
export function TraceWaterfall({ spans, selectedSpanId, onSelectSpan, empty = "No spans recorded.", className, ...props }: TraceWaterfallProps) {
  const ordered = orderSpans(spans);
  const [internalId, setInternalId] = useState<string | null>(ordered[0]?.span.id ?? null);

  if (!ordered.length) {
    return (
      <div className={cn("rounded-md border border-border bg-card p-4 text-sm text-muted-foreground", className)} {...props}>
        {empty}
      </div>
    );
  }

  const activeId = selectedSpanId ?? (ordered.some((entry) => entry.span.id === internalId) ? internalId : ordered[0].span.id);
  const selectedSpan = ordered.find((entry) => entry.span.id === activeId)?.span ?? ordered[0].span;

  const minStart = Math.min(...ordered.map((entry) => entry.span.startMs));
  const maxEnd = Math.max(...ordered.map((entry) => entry.span.startMs + Math.max(0, entry.span.durationMs)));
  const totalDuration = Math.max(1, maxEnd - minStart);
  const totalTokens = ordered.reduce((acc, entry) => acc + (entry.span.tokens ?? 0), 0);
  const totalCost = ordered.reduce((acc, entry) => acc + (entry.span.costUsd ?? 0), 0);

  const handleSelect = (span: TraceSpan) => {
    setInternalId(span.id);
    onSelectSpan?.(span);
  };

  const selectedStatus = statusMeta[selectedSpan.status];

  return (
    <div className={cn("flex flex-col gap-3 rounded-md border border-border bg-card p-4 text-card-foreground", className)} {...props}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2 text-xs tabular-nums">
        <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
          <span className="font-medium text-foreground">{ordered.length} spans</span>
          <span>{formatMs(totalDuration)} total</span>
          {totalTokens > 0 ? <span>{totalTokens.toLocaleString("en-US")} tok</span> : null}
          {totalCost > 0 ? <span>{formatUsd(totalCost)}</span> : null}
        </div>
        <div className="flex items-center gap-3 text-muted-foreground">
          <span>0ms</span>
          <span>{formatMs(totalDuration / 2)}</span>
          <span>{formatMs(totalDuration)}</span>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div role="list" aria-label="Trace spans" className="flex flex-col gap-1">
          {ordered.map(({ span, depth }) => {
            const meta = statusMeta[span.status];
            const leftPct = ((span.startMs - minStart) / totalDuration) * 100;
            const widthPct = Math.max(1.5, (Math.max(0, span.durationMs) / totalDuration) * 100);
            const active = span.id === selectedSpan.id;

            return (
              <div key={span.id} role="listitem">
                <button
                  type="button"
                  aria-current={active ? "true" : undefined}
                  onClick={() => handleSelect(span)}
                  className={cn(
                    focusRing,
                    "grid w-full grid-cols-[minmax(10rem,15rem)_minmax(0,1fr)_4.5rem] items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs transition-colors duration-fast hover:bg-accent",
                    active && "bg-accent text-accent-foreground",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: `${Math.min(depth, 6) * 12}px` }}>
                    <StatusMark tone={meta.tone} label={meta.label} />
                    <span className="truncate font-medium text-foreground">{span.name}</span>
                  </span>

                  <span aria-hidden className="relative block h-4 w-full overflow-hidden rounded-sm bg-muted/70">
                    <span
                      className={cn("absolute top-0.5 bottom-0.5 rounded-sm", meta.bar)}
                      style={{ left: `${Math.min(98.5, leftPct)}%`, width: `${Math.min(100 - leftPct, widthPct)}%` }}
                    />
                  </span>

                  <span className="text-right font-mono tabular-nums text-muted-foreground">{formatMs(span.durationMs)}</span>
                </button>
              </div>
            );
          })}
        </div>

        <aside aria-label="Span details" className="flex flex-col gap-3 rounded-md border border-border bg-background p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-foreground">{selectedSpan.name}</div>
              {selectedSpan.service || selectedSpan.model ? (
                <div className="truncate text-xs text-muted-foreground">
                  {[selectedSpan.service, selectedSpan.model].filter(Boolean).join(" · ")}
                </div>
              ) : null}
            </div>
            <StatusMark tone={selectedStatus.tone} label={selectedStatus.label} showLabel />
          </div>

          <dl className="grid grid-cols-2 gap-2 border-y border-border py-2 text-xs tabular-nums">
            <div>
              <dt className="text-muted-foreground">Offset</dt>
              <dd className="font-mono font-medium text-foreground">+{formatMs(selectedSpan.startMs - minStart)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Duration</dt>
              <dd className="font-mono font-medium text-foreground">{formatMs(selectedSpan.durationMs)}</dd>
            </div>
            {selectedSpan.tokens !== undefined ? (
              <div>
                <dt className="text-muted-foreground">Tokens</dt>
                <dd className="font-mono font-medium text-foreground">{selectedSpan.tokens.toLocaleString("en-US")}</dd>
              </div>
            ) : null}
            {selectedSpan.costUsd !== undefined ? (
              <div>
                <dt className="text-muted-foreground">Cost</dt>
                <dd className="font-mono font-medium text-foreground">{formatUsd(selectedSpan.costUsd)}</dd>
              </div>
            ) : null}
          </dl>

          {selectedSpan.attributes && Object.keys(selectedSpan.attributes).length > 0 ? (
            <dl className="flex flex-col gap-1 text-xs">
              {Object.entries(selectedSpan.attributes).map(([key, val]) => (
                <div key={key} className="flex items-baseline justify-between gap-2">
                  <dt className="truncate font-mono text-muted-foreground">{key}</dt>
                  <dd className="truncate font-mono text-foreground">{val === null ? "null" : String(val)}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          <PayloadBlock title="Input" value={selectedSpan.input} />
          <PayloadBlock title="Output" value={selectedSpan.output} />
        </aside>
      </div>
    </div>
  );
}
