import type { Event, MemberRequestJourney, RequestEffect } from "../../gen/memberRequestJourney.ts";
import { nodeJourney } from "./shared/nodeJourney.ts";

export const driver = nodeJourney<Event, MemberRequestJourney, RequestEffect[]>("memberRequestWorker.ts");
export const options = { keys: ["climbing-request"], walks: 8, steps: 10 };
