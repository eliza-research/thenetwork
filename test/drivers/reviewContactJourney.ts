import type { Driver, Options } from "../../gen/reviewContactJourney.conformance.ts";
import type { Event, ReviewContactJourney, ReviewReply } from "../../gen/reviewContactJourney.ts";
import { nodeJourney } from "./shared/nodeJourney.ts";

export const driver: Driver & AsyncDisposable = nodeJourney<Event, ReviewContactJourney, ReviewReply[]>("reviewContactWorker.ts");
export const options: Options = { keys: ["climbing-introduction"], walks: 6, steps: 8 };
