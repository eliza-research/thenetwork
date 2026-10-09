# Paused Eliza-based Network prototype — review archive

This branch preserves an earlier local experiment for Shaw/lalalune to inspect. It is **not the current Network implementation, not release-ready, and not a proposal to merge this branch into main**. The current work starts from the latest `eliza-research/thenetwork` source. No application or deployment configuration changes on this branch.

## What is saved

`archives/eliza-prototype-20261008/` contains:

- `changes.patch`: the complete final source delta against the exact Eliza base.
- `history.bundle`: the incremental Git history, preserving all 23 local commits.
- `manifest.json`: base/head, all commits, all 199 changed paths, checksums and archive checks.

Base: `65621da3a424f8fcdce760db5c9c414117082e18`.
Prototype head: `f172717ef49f429141549e197fbf5b32cb561daa`.
Local preservation tag in the Eliza checkout: `codex/network-eliza-prototype-20261008`.

The archive includes the accumulated domain/matching/consent prototype; native Eliza plugin, graph, scheduling and approval integration; local synthetic admin/workbench and simulations; privacy/full-history checks; and experimental Cloud phone-login/personal-chat surfaces. The final patch is about 49,765 added / 473 removed lines. Size is scope, not evidence of quality.

It intentionally excludes ignored reports/logs, local databases, browser sessions, attachments, installed dependencies and runtime state. Those remain local. The fresh Network-site and app-scope work after this pivot is **not** in this old-prototype archive; it stays on `codex/local-sites-review-20261008` in the local Network checkout.

## Why it was paused

The Network repository advanced substantially while this prototype was being developed. Its platform, engine, service and Observatory overlap much of the experiment. Reuse should be selective and behavior-based: privacy/consent safeguards, history ownership, trusted plugin authority, integration evidence, or another demonstrated missing capability. Do not introduce duplicate platform identities, competing state stores or a second iMessage responder.

The current user direction is Eliza Cloud as backend and Eliza Shared as agent, preserving the existing iMessage ingress. The old prototype's personal Cloud chat is not a completed Network app-membership binding. Brand aliases `slop.love` and `friend.help` in that experiment are not the current `slop.date` and `friends.help` apps.

## Evidence and limits

Saved local evidence at this prototype head reported 89 focused checks, 300 repository verification tasks, and a passing production renderer build. The five focused browser-audit cases covered the existing Eliza shell/ChatOverlay, **not** authenticated Network chat. Long simulations were stopped and remained partial. None of these counts establish real member value or live acceptance.

Actual hosted sign-in/history, real iMessage continuity, Network app isolation/membership binding, a live staff graph and the full visual audit were not accepted. The later app-scope and canonical-membership resolver commits belong to the new local Network branch, not this archive.

## Inspect or restore in an Eliza clone

Use a separate checkout; do not apply the patch to this Network repository. Obtain the base from the public Eliza history, then verify the bundle and fetch its preserved branch:

```sh
git clone --filter=blob:none https://github.com/elizaOS/eliza.git eliza-prototype-review
cd eliza-prototype-review
git fetch origin 65621da3a424f8fcdce760db5c9c414117082e18
git bundle verify /absolute/path/to/history.bundle
git fetch /absolute/path/to/history.bundle refs/heads/codex/network-phone-portal-20261007:refs/heads/review/paused-network-prototype
git switch review/paused-network-prototype
```

Alternatively, at the exact base, use `git apply --check /absolute/path/to/changes.patch` before applying it. Read the checked-out repository/package instructions before installing or running anything. The bundle is incremental and requires the base history; it is not a standalone Eliza distribution.

Archive preparation verified bundle integrity, exact-base patch applicability, and known credential patterns across the added history objects. That screen is not a complete security guarantee. This branch is for human review only; publishing it does not authorize deployment or merging.
