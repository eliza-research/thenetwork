import type { Event, MemberRequestJourney, RequestEffect } from "../../gen/memberRequestJourney.ts";
import { bunJourney } from "./shared/bunJourney.ts";

export const driver = bunJourney<Event, MemberRequestJourney, RequestEffect[]>("memberRequestWorker.ts");
export const options = { keys: ["climbing-request"], walks: 8, steps: 10 };
