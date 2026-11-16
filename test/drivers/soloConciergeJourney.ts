import type { Driver, Options } from "../../gen/soloConciergeJourney.conformance.ts";
import type { ConciergeEffect, Event, SoloConciergeJourney } from "../../gen/soloConciergeJourney.ts";
import { nodeJourney } from "./shared/nodeJourney.ts";

export const driver: Driver & AsyncDisposable = nodeJourney<Event, SoloConciergeJourney, ConciergeEffect[]>("soloConciergeWorker.ts");
export const options: Options = { keys: ["friends-solo"], walks: 6, steps: 10 };
