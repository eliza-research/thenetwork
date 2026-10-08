// networkPack passes the per-pack conformance suite (test/conformance.ts).
import { networkPack } from "../src/packs/network/index.ts";
import { runConformance } from "./conformance.ts";

runConformance(networkPack);
