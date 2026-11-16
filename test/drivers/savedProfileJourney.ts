import type { Driver, Options } from "../../gen/savedProfileJourney.conformance.ts";
import type { Event, ProfileMemberships, ProfileShown } from "../../gen/savedProfileJourney.ts";
import { bunJourney } from "./shared/bunJourney.ts";

export const driver: Driver & AsyncDisposable = bunJourney<Event, ProfileMemberships, ProfileShown[]>("savedProfileWorker.ts");
export const options: Options = { keys: ["member-a", "member-b"], walks: 6, steps: 9 };
