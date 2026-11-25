import type { Driver, Options } from "../../gen/runtimeUnit.conformance.ts";
import type { Event, RuntimeUnit } from "../../gen/runtimeUnit.ts";
import { nodeJourney } from "./shared/nodeJourney.ts";

export const driver: Driver & AsyncDisposable = nodeJourney<Event, RuntimeUnit, null>("runtimeUnitWorker.ts");
export const options: Options = { keys: ["unit-a", "unit-b"], walks: 12, steps: 8 };
