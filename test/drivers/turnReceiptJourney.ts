import type { Driver, Options } from "../../gen/turnReceiptJourney.conformance.ts";
import type { Event, ReceiptJourney, ReceiptJourneyResult } from "../../gen/turnReceiptJourney.ts";
import { nodeJourney } from "./shared/nodeJourney.ts";

export const driver: Driver & AsyncDisposable = nodeJourney<Event, ReceiptJourney, ReceiptJourneyResult[]>("turnReceiptWorker.ts");
export const options: Options = { keys: ["reply-a", "reply-b"], walks: 8, steps: 10 };
