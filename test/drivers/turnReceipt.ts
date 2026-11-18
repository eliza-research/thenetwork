import type { Driver, Options } from "../../gen/turnReceipt.conformance.ts";
import type { Event, TurnReceipt } from "../../gen/turnReceipt.ts";
import { nodeJourney } from "./shared/nodeJourney.ts";

export const driver: Driver & AsyncDisposable = nodeJourney<Event, TurnReceipt, null>("turnReceiptMachineWorker.ts");
export const options: Options = { keys: ["receipt-a", "receipt-b"], walks: 12, steps: 8 };
