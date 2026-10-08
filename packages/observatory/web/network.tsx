// Levels: the NYC scenarios a game world can be reset into. The consent ladder, requests, trust and
// growth that lived here moved to Pipeline, Metrics and Safety (drawer.tsx).
import { useEffect, useState } from "react";
import { store, useStore } from "./store.ts";
import { Section } from "./ui.tsx";

interface Level { id: string; title: string; description: string; days: number }
export function Levels() {
  const s = useStore();
  const [levels, setLevels] = useState<Level[]>([]);
  const [result, setResult] = useState<{ pass: boolean; checks: { name: string; pass: boolean; detail: string }[] } | null>(null);
  useEffect(() => { store.getJSON<Level[]>("/api/levels").then(setLevels).catch(() => {}); }, []);
  const current = s.network?.scenario;
  return (
    <Section title="Levels" right={current && s.canSim() ? <button className="btn" onClick={async () => { const r = await store.control({ type: "check_scenario" }); if (r.ok) setResult(r.data as typeof result); }}>Check level</button> : undefined}>
      {current && <div className="callout small" title={current.description}>Playing <b>{current.title}</b></div>}
      {result && (
        <div className={`callout small ${result.pass ? "good" : "bad"}`}>
          {result.pass ? "Level passed." : "Not yet."} {result.checks.map(c => `${c.pass ? "✓" : "✗"} ${c.name}`).join(" · ")}
        </div>
      )}
      {s.isAdmin() && <div className="levels">
        {levels.map(l => (
          <button key={l.id} className={current?.id === l.id ? "level active" : "level"} title={l.description} onClick={() => { setResult(null); store.control({ type: "reset", scenario: l.id, network: "consent" }); }}>
            <b>{l.title}</b><span className="small muted clamp2">{l.description}</span><span className="small">{l.days} days</span>
          </button>
        ))}
        <button className="level" onClick={() => { setResult(null); store.control({ type: "reset", scenario: null, network: "consent" }); }}><b>Free play</b></button>
      </div>}
    </Section>
  );
}
