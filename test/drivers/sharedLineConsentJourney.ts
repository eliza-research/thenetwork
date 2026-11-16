import type { Driver, Options } from "../../gen/sharedLineConsentJourney.conformance.ts";
import type { ConsentUpdate, Event, LineConsent } from "../../gen/sharedLineConsentJourney.ts";
import { nodeJourney } from "./shared/nodeJourney.ts";

export const driver: Driver & AsyncDisposable = nodeJourney<Event, LineConsent, ConsentUpdate[]>("sharedLineConsentWorker.ts");
export const options: Options = { keys: ["member-a", "member-b"], walks: 6, steps: 9 };
