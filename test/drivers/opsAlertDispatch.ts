import type { Driver, Options } from "../../gen/opsAlertDispatch.conformance.ts";
import type { AlertDispatch, Event } from "../../gen/opsAlertDispatch.ts";
import { nodeJourney } from "./shared/nodeJourney.ts";

export const driver: Driver & AsyncDisposable = nodeJourney<Event, AlertDispatch, null>("opsAlertDispatchWorker.ts");
export const options: Options = { keys: ["round-a", "round-b"], walks: 12, steps: 6 };
