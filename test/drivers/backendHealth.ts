import type { Driver, Options } from "../../gen/backendHealth.conformance.ts";
import type { BackendHealth, Event } from "../../gen/backendHealth.ts";
import { nodeJourney } from "./shared/nodeJourney.ts";

export const driver: Driver & AsyncDisposable = nodeJourney<Event, BackendHealth, null>("backendHealthWorker.ts");
export const options: Options = { keys: ["check-a", "check-b"], walks: 12, steps: 6 };
