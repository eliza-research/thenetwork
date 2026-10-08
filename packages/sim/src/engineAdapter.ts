// Adapter: plugs @thenetwork/engine (v1) into the simulator's Engine interface.
import { runEngine } from "@thenetwork/engine";
import type { Engine } from "@thenetwork/core";

export function createEngine(): Engine {
  return {
    name: "engine-v1",
    async propose(snapshot, opts) {
      const seed = typeof opts?.seed === "number" ? opts.seed : 1;
      // One city per run (as MatcherScheduler.tick does): the world calls once per city, so
      // running both cities each time doubled the work and let the first city's run spend
      // budget on configurations the second call then threw away.
      const { proposals } = await runEngine(snapshot, opts?.city ? { seed, cities: [opts.city] } : { seed });
      return opts?.city ? proposals.filter(p => p.city === opts.city) : proposals;
    },
  };
}
