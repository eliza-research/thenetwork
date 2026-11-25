import type { Event, RuntimeUnit, UnitPhase } from "../../packages/core/src/generated/runtimeUnit.ts";
import { ConsentNetwork, type NetworkState } from "../../packages/network/src/network.ts";
import { PgStore, runStored, type NetworkStore } from "../../packages/network/src/store.ts";
import { withConformanceDatabase } from "./conformanceDatabase.ts";
import { serveJourney } from "./serveJourney.ts";
import { deferred } from "./deferred.ts";

type Gate = "load" | "run" | "save";
type Unit = {
  id: string;
  store: PgStore;
  waiting?: { gate: Gate; release(): void; fail(error: Error): void };
  arrived?: () => void;
  restores: number;
  restoresNamed: number;
  done?: "saved" | Error;
  result: Promise<void>;
};

await withConformanceDatabase("runtime_unit_conformance", async sql => {
  const units = new Map<string, Unit>();
  let counter = 0;

  function gate(unit: Unit, name: Gate): Promise<void> {
    return new Promise<void>((release, reject) => {
      unit.waiting = { gate: name, release, fail: reject };
      unit.arrived?.();
    });
  }

  async function progress(unit: Unit) {
    const arrived = new Promise<void>(resolve => { unit.arrived = resolve; });
    const waiting = unit.waiting!;
    unit.waiting = undefined;
    waiting.release();
    await Promise.race([arrived, unit.result]);
    unit.arrived = undefined;
  }

  async function unitFor(key: string): Promise<Unit> {
    const existing = units.get(key);
    if (existing) return existing;
    const id = `ntwrk:conformance${++counter}`;
    const store = new PgStore(sql, id);
    const net = new ConsentNetwork({ seed: 1, engine: { cities: ["nyc"] } });
    const finished = deferred<void>();
    const unit: Unit = { id, store, restores: 0, restoresNamed: 0, result: finished.promise };
    const importState = net.importState.bind(net);
    net.importState = (state: NetworkState) => { unit.restores++; return importState(state); };
    const gated: NetworkStore = {
      load: async () => { await gate(unit, "load"); return store.load(); },
      save: async state => { await gate(unit, "save"); return store.save(state); },
      withTickLock: work => store.withTickLock(work),
      withLock: work => store.withLock(work),
    };
    units.set(key, unit);
    const arrived = new Promise<void>(resolve => { unit.arrived = resolve; });
    void runStored(net, gated, async () => { await gate(unit, "run"); return "ran"; })
      .then(() => { unit.done = "saved"; }, (error: Error) => { unit.done = error; })
      .then(finished.resolve);
    await Promise.race([arrived, unit.result]);
    unit.arrived = undefined;
    return unit;
  }

  function phaseOf(unit: Unit): UnitPhase {
    if (unit.done === "saved") return "StateSaved";
    if (unit.done) throw unit.done;
    switch (unit.waiting?.gate) {
      case "load": return "LoadingSnapshot";
      case "run": return unit.restores > unit.restoresNamed ? "RestoringSnapshot" : "RunningAction";
      case "save": return "SavingState";
      default: throw new Error(`Unit ${unit.id} waits on no effect`);
    }
  }

  async function abandonAll() {
    for (const unit of units.values()) {
      unit.waiting?.fail(new Error("journey reset"));
      await unit.result;
    }
    units.clear();
    return null;
  }

  await serveJourney<Event>({
    reset: abandonAll,
    async dispatch(key, event) {
      const unit = await unitFor(key);
      const phase = phaseOf(unit);
      switch (event.type) {
        case "recordLoad": {
          if (phase !== "LoadingSnapshot") return "refused";
          if (event.snapshotFound) await unit.store.save(new ConsentNetwork({ seed: 2, engine: { cities: ["nyc"] } }).exportState());
          else await sql`delete from network.network_state where id = ${unit.id}`;
          await progress(unit);
          return "accepted";
        }
        case "recordRestore": {
          if (phase !== "RestoringSnapshot") return "refused";
          unit.restoresNamed = unit.restores;
          return "accepted";
        }
        case "recordAction": {
          if (phase !== "RunningAction") return "refused";
          await progress(unit);
          return "accepted";
        }
        case "recordSave": {
          if (phase !== "SavingState") return "refused";
          await progress(unit);
          return "accepted";
        }
      }
    },
    async observe(key): Promise<RuntimeUnit> {
      return { phase: phaseOf(await unitFor(key)) };
    },
    observeOutput: () => null,
  });
  await abandonAll();
});
