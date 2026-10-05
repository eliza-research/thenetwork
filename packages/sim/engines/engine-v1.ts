// Adapter: plugs @thenetwork/engine (v1) into the simulator's Engine interface.
import { runEngine } from "../../engine/src/index.ts";
import type { Engine } from "../src/network.ts";

export function createEngine(): Engine {
  return {
    name: "engine-v1",
    async propose(snapshot, opts) {
      const seed = typeof opts?.seed === "number" ? opts.seed : 1;
      const { proposals } = await runEngine(snapshot, { seed });
      return opts?.city ? proposals.filter(p => p.city === opts.city) : proposals;
    },
  };
}
