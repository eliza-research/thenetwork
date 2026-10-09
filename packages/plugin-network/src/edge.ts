import { assertNetworkMemberScope } from "./types.js";
/** Worker-safe Network plugin bound to host-owned stores and turn authority. */
import type { Plugin } from "@elizaos/core";
import { createGetUpdatesAction } from "./actions/get-updates.js";
import { createSetStateAction } from "./actions/set-state.js";
import { createNetworkSignalsEvaluator } from "./evaluators/network-signals.js";
import { createMemberContextProvider } from "./providers/member-context.js";
import { NETWORK_CONTEXT_DEFINITION } from "./routing/context.js";
import { createNetworkActionFieldEvaluator } from "./routing/structured-field.js";
import type { NetworkHostStore, NetworkStore, NetworkTurnAuthority } from "./types.js";

type GetUpdatesStore = NetworkHostStore & Required<Pick<NetworkStore, "readUpdates">>;

export const NETWORK_EDGE_COMPATIBILITY = {
  target: "edge",
  state: "host-injected",
  effects: ["network-store-read", "network-store-write"],
  requiredBindings: [],
  requiredSecrets: [],
} as const;

/** How a Network turn routes availability changes; see `routing` below. */
export type NetworkRouting = "planner" | "structured";

export interface NetworkEdgePluginOptions {
  store: NetworkHostStore;
  authority: NetworkTurnAuthority;
  /** Default true. Set false for system/lifecycle turns (zero actions). */
  actionsEnabled?: boolean;
  /**
   * How availability changes are routed. Both designs register the `network`
   * context so Stage 1 can route to it (Stage 1 only offers registered
   * contexts backed by an action or provider).
   * - "planner" (design A): Stage 1 routes to `network` and the planner calls
   *   SET_STATE; the host adds a must-call-SET_STATE requirement for detected
   *   availability intents, like REMINDERS and TODO.
   * - "structured" (design B): a `networkAction` field on the same Stage-1
   *   call proposes the change; deterministic code authorizes and executes it
   *   through the store and preempts the planner with a direct reply.
   */
  routing?: NetworkRouting;
  /** Clock for date resolution (tests and the simulator). Default: wall clock. */
  now?: () => Date;
}

export function createNetworkEdgePlugin(options: NetworkEdgePluginOptions): Plugin {
  assertNetworkMemberScope(options.authority);
  options = { ...options, authority: Object.freeze({ ...options.authority }) };
  const actionsEnabled = options.actionsEnabled ?? true;
  const routing = options.routing ?? "planner";
  const stateStore = typeof options.store.setState === "function"
    ? { setState: options.store.setState.bind(options.store) } : undefined;
  const signalStore = typeof options.store.recordSignals === "function"
    ? { recordSignals: options.store.recordSignals.bind(options.store) } : undefined;
  const context = stateStore ? NETWORK_CONTEXT_DEFINITION : {
    ...NETWORK_CONTEXT_DEFINITION,
    description: "The member's Network profile and current participation state. This host cannot change availability.",
    descriptionCompressed: "Read Network profile and current state",
  };
  return {
    name: "network-edge",
    description: "The Network: host-supported member context and capabilities.",
    contexts: ["network"],
    init: async (_config, runtime) => {
      runtime.contexts.tryRegister(context);
    },
    ...(actionsEnabled && stateStore && routing === "structured"
      ? {
          responseHandlerFieldEvaluators: [
            createNetworkActionFieldEvaluator({
              store: stateStore,
              authority: options.authority,
              now: options.now,
            }),
          ],
        }
      : {}),
    providers: [
      createMemberContextProvider({ store: options.store, authority: options.authority }),
    ],
    // In structured mode the field evaluator is the only path to a state change: a planner
    // SET_STATE there would bypass its authz (audit plugin-prototypes-1).
    // GET_UPDATES only reads (and marks seen), so it is offered in both routing modes.
    actions: actionsEnabled
      ? [
          ...(stateStore && routing === "planner"
            ? [createSetStateAction({ store: stateStore, authority: options.authority, now: options.now })]
            : []),
          ...(typeof options.store.readUpdates === "function"
            ? [createGetUpdatesAction({ store: options.store as GetUpdatesStore, authority: options.authority })]
            : []),
        ]
      : [],
    evaluators: signalStore ? [
      createNetworkSignalsEvaluator({
        store: signalStore,
        authority: options.authority,
      }),
    ] : [],
  };
}
