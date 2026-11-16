import { useEffect, useState } from "react";
import { Alert, Button, InspectorSection } from "@thenetwork/ui";
import { store, useStore } from "./store.ts";

interface Level { id: string; title: string; description: string; days: number }

/** The New York scenarios that a game world can start again from, and the check of the current one. */
export function Levels() {
  const s = useStore();
  const [levels, setLevels] = useState<Level[]>([]);
  const [result, setResult] = useState<{ pass: boolean; checks: { name: string; pass: boolean; detail: string }[] } | null>(null);
  useEffect(() => { store.getJSON<Level[]>("/api/levels").then(setLevels).catch(() => {}); }, []);
  const current = s.network?.scenario;
  const reset = (scenario: string | null) => { setResult(null); store.control({ type: "reset", scenario, network: "consent" }); };
  const choice = "h-auto flex-col items-start gap-1 whitespace-normal p-2 text-left";
  return (
    <InspectorSection
      title="Levels"
      action={current && s.canSim() ? <Button variant="outline" size="sm" onClick={async () => { const r = await store.control({ type: "check_scenario" }); if (r.ok) setResult(r.data as typeof result); }}>Check level</Button> : undefined}
    >
      {current && <Alert title={current.description}>Playing <span className="font-semibold">{current.title}</span></Alert>}
      {result && (
        <Alert variant={result.pass ? "ok" : "destructive"}>
          {result.pass ? "Level passed." : "Not yet."} {result.checks.map(c => `${c.pass ? "✓" : "✗"} ${c.name}`).join(" · ")}
        </Alert>
      )}
      {s.isAdmin() && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {levels.map(l => (
            <Button key={l.id} variant={current?.id === l.id ? "secondary" : "outline"} aria-current={current?.id === l.id || undefined} className={choice} title={l.description} onClick={() => reset(l.id)}>
              <span className="font-semibold">{l.title}</span>
              <span className="line-clamp-2 text-muted-foreground">{l.description}</span>
              <span>{l.days} days</span>
            </Button>
          ))}
          <Button variant="outline" className={choice} onClick={() => reset(null)}><span className="font-semibold">Free play</span></Button>
        </div>
      )}
    </InspectorSection>
  );
}
