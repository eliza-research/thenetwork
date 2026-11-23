# Keep an unresolved age report through app leave

An exact minor report from a person who never met the subject could set a local age signal without setting a trust hold. The old app leave path archived urgent reports from people who met the subject and durable trust holds. It dropped this separate local signal when it forgot the membership. Rejoining the same app with a new membership ID then lost the matching restriction.

The forget transaction now carries exact open minor reports when the membership has an active report-induced age signal. The existing archive keeps the restriction in the report's app and origin runtime. An authorized dismissal of that report can remove it. The same report sent to a different app's staff endpoint cannot do so. Ordinary leave and account erasure retain their existing distinct authority. The member's own stated age continues through the person-level age policy.

Turning the signal into a generic trust hold would detach it from the moderator's exact report decision. Writing the reported age onto the person's profile would treat a third-party statement as their own verified age. The selected change reuses the existing exact report archive.

## Reproduce the result

Use PostgreSQL on port 54339 and Node 26.13.0. Run the same integration file on `366419ec` and the candidate. To reproduce on the baseline, copy the new native fixture to that revision.

```sh
REQUIRE_PG=1 node node_modules/vitest/vitest.mjs run --project integration \
  packages/network/test/service-safety.test.ts
pnpm run quint:check safety_trust
pnpm run spec:check-generated
```

The native fixture signs a stranger's report and an ordinary app leave, restarts the service, and rejoins the same adult record under a different member ID. The baseline returns `report_held = false` where the originating app requires `true`. The candidate passes all 24 service-safety cases. Its fixture checks the exact archive identity, the independent Peon membership, the wrong-app dismissal refusal, and the correct dismissal releasing the matching restriction.

The whole-flow test adds the report after leave consent and before the forget transaction. It reaches the same former failure in four actions, including rejoin. All 18 Quint jobs passed with the change, and the original counterexample seed `0x265d02d` produced no violation. The generated safety rule passed 12,000 traces, 403 TypeScript replays and all 24 Dafny obligations. The fixture and model scenario are hand-written. The sampled traces are generated. The run uses synthetic members and no inference calls.
