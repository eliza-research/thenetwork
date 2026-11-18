import type { Driver, Options } from "../../gen/webhookInbox.conformance.ts";
import type { Event, WebhookTurn } from "../../gen/webhookInbox.ts";
import { nodeJourney } from "./shared/nodeJourney.ts";

export const driver: Driver & AsyncDisposable = nodeJourney<Event, WebhookTurn, null>("webhookInboxWorker.ts");
export const options: Options = { keys: ["sender-a", "sender-b"], walks: 80, steps: 6 };
