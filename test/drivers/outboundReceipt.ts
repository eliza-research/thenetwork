import type { Driver, Options } from "../../gen/outboundReceipt.conformance.ts";
import type { Event, ReceiptLifecycle } from "../../gen/outboundReceipt.ts";
import { nodeJourney } from "./shared/nodeJourney.ts";

export const driver: Driver & AsyncDisposable = nodeJourney<Event, ReceiptLifecycle, null>("outboundReceiptWorker.ts");
export const options: Options = { keys: ["text-a", "text-b"], walks: 8, steps: 8 };
