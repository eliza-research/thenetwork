// spec/consolePanels.md, "The game tab shows the score of the simulated world"
// spec/consolePanels.md, "Only an admin resets the world, chooses a level or chooses the reviewer"
// spec/consolePanels.md, "A player checks the level that plays"
import { useEffect, useRef, useState } from "react";
import { Alert, Button, InspectorSection } from "@thenetwork/ui";
import {
  canCheckLevel, canReceiveGame, canResetWorld, checkLevel, gameControlsShown, initial as initialPanels, levelCheckShown, receiveGame, resetWorld,
  type ConsolePanels,
} from "../../../packages/core/src/generated/consolePanels.ts";
import { panelStaffOf } from "./ops.tsx";
import { store, useStore } from "./store.ts";

interface Level { id: string; title: string; description: string; days: number }

/**
 * The analysis panels of the game tab, from the store: the viewer through `panelStaffOf`, then the game through the generated `receiveGame`.
 * `levelChecked` is true when the shell holds the result of a level check.
 */
export function gamePanelsOf(s: typeof store, levelChecked = false): ConsolePanels {
  const base: ConsolePanels = { ...initialPanels, staff: panelStaffOf(s), game: { ...initialPanels.game, levelChecked } };
  return canReceiveGame(base) ? receiveGame(base, !!s.game, !!s.game?.over, !!s.network?.scenario) : base;
}

/** The New York scenarios that a game world can start again from, and the check of the current one. */
export function Levels() {
  const s = useStore();
  const [levels, setLevels] = useState<Level[]>([]);
  const [result, setResult] = useState<{ pass: boolean; checks: { name: string; pass: boolean; detail: string }[] } | null>(null);
  useEffect(() => { store.getJSON<Level[]>("/api/levels").then(setLevels).catch(() => {}); }, []);
  const checkGeneration = useRef(0);
  const current = s.network?.scenario;
  const panels = gamePanelsOf(s, result !== null && !!current);
  const reset = (scenario: string | null) => {
    if (!canResetWorld(panels, scenario !== null)) return;
    if (!resetWorld(panels, scenario !== null).game.levelChecked) {
      checkGeneration.current++;
      setResult(null);
    }
    store.control({ type: "reset", scenario, network: "consent" });
  };
  const check = async () => {
    if (!canCheckLevel(panels)) return;
    const generation = ++checkGeneration.current;
    const r = await store.control({ type: "check_scenario" });
    if (generation === checkGeneration.current && r.ok && checkLevel(panels).game.levelChecked) setResult(r.data as typeof result);
  };
  const choice = "h-auto flex-col items-start gap-1 whitespace-normal p-2 text-left";
  return (
    <InspectorSection
      title="Levels"
      action={levelCheckShown(panels) ? <Button variant="outline" size="sm" onClick={check}>Check level</Button> : undefined}
    >
      {current && <Alert title={current.description}>Playing <span className="font-semibold">{current.title}</span></Alert>}
      {result && (
        <Alert variant={result.pass ? "ok" : "destructive"}>
          {result.pass ? "Level passed." : "Not yet."} {result.checks.map(c => `${c.pass ? "✓" : "✗"} ${c.name}`).join(" · ")}
        </Alert>
      )}
      {gameControlsShown(panels) && (
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
