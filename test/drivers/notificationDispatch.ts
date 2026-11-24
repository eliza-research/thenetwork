import type { Driver, Options } from "../../gen/notificationDispatch.conformance.ts";
import type { DigestFlow, Event } from "../../gen/notificationDispatch.ts";
import { nodeJourney } from "./shared/nodeJourney.ts";

export const driver: Driver & AsyncDisposable = nodeJourney<Event, DigestFlow, null>("notificationDispatchWorker.ts");
export const options: Options = { keys: ["person-a", "person-b"], walks: 40, steps: 6 };
