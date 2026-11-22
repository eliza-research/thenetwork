import type { Driver, Options } from "../../gen/travelPresenceJourney.conformance.ts";
import type { Event, TravelEffect, TravelPresenceJourney } from "../../gen/travelPresenceJourney.ts";
import { nodeJourney } from "./shared/nodeJourney.ts";

export const driver: Driver & AsyncDisposable = nodeJourney<Event, TravelPresenceJourney, TravelEffect[]>("travelPresenceWorker.ts");
export const options: Options = { keys: ["travel-member"], walks: 6, steps: 10 };
