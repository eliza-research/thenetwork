// Browser-safe response types for the public platform API.
/**
 * The member's availability (GET /api/me). `state` uses the agent contract's words: open, busy,
 * traveling or paused. `from` and `until` are ISO times or null (null `until`: until the member says
 * otherwise). `quietHours` is [start hour, end hour] in the member's time, when the member set them.
 */
export interface MemberParticipation {
  state: "open" | "busy" | "traveling" | "paused";
  from: string | null;
  until: string | null;
  quietHours?: [number, number];
}
