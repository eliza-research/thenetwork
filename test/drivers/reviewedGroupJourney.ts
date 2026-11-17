import type { Driver, Options } from "../../gen/reviewedGroupJourney.conformance.ts";
import type { Event, GroupEffect, ReviewedGroupJourney } from "../../gen/reviewedGroupJourney.ts";
import { nodeJourney } from "./shared/nodeJourney.ts";

export const driver: Driver & AsyncDisposable = nodeJourney<Event, ReviewedGroupJourney, GroupEffect[]>("reviewedGroupWorker.ts");
export const options: Options = { keys: ["reviewed-public-hike"], walks: 8, steps: 12 };
