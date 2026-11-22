import type { Driver, Options } from "../../gen/savedProfileJourney.conformance.ts";
import type { Event, ProfileMemberships, ProfileShown } from "../../gen/savedProfileJourney.ts";
import { nodeJourney } from "./shared/nodeJourney.ts";

export const driver: Driver & AsyncDisposable = nodeJourney<Event, ProfileMemberships, ProfileShown[]>("savedProfileWorker.ts");
export const options: Options = { keys: ["member-a", "member-b"], walks: 6, steps: 9 };
