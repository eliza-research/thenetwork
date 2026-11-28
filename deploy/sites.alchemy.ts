import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import {
  provisionPagesSites,
  resolveDeployPolicy,
  resolveStateLayer,
} from "./alchemy-sites.ts";

export default Alchemy.Stack(
  "TheNetworkSites",
  {
    providers: Cloudflare.providers(),
    state: resolveStateLayer("alchemy/thenetwork-sites/"),
  },
  Effect.gen(function* () {
    const stageName = yield* Alchemy.Stage;
    const { stageTarget, stageSlug, backendOrigin, commitSha } = resolveDeployPolicy(stageName);
    const sites = yield* provisionPagesSites({ stageTarget, stageSlug, commitSha, backendOrigin });
    return {
      stage: stageTarget.stage,
      backendOrigin,
      commitSha,
      sites,
    };
  }),
);
