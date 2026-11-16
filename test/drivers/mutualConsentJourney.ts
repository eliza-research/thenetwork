import type { Driver, Options } from "../../gen/mutualConsentJourney.conformance.ts";
import type { Event, MutualConsentJourney, ReceiptResult } from "../../gen/mutualConsentJourney.ts";
import { nodeJourney } from "./shared/nodeJourney.ts";

export const driver: Driver & AsyncDisposable = nodeJourney<Event, MutualConsentJourney, ReceiptResult[]>("mutualConsentWorker.ts");
export const options: Options = { keys: ["climbing-introduction"], walks: 6, steps: 10 };
