# Warm model generation on The Network

The Network generator now uses the type lookup and compact Quint receipt changes from VibeStack. A receipt for generation keeps the checked module and the inferred types reachable from its declarations. The compact and full receipts have different keys. A caller that needs the entire Quint import graph can still get it. [Type lookup change](https://github.com/lalalune/vibestack/pull/195) and [receipt change](https://github.com/lalalune/vibestack/pull/198).

| Measurement | Previous | Revised |
| --- | ---: | ---: |
| Gzipped typecheck receipts, 150 models | 3,377,442 bytes | 1,186,598 bytes |
| Snapshot check, median CPU | 2.57 s | 2.15 s |
| Snapshot check, median elapsed | 1.47 s | 1.17 s |
| Snapshot check, median peak resident memory | 530 MiB | 393 MiB |

The reference was `6664f931` on macOS arm64 with Node 26.13.0, pnpm 10.24.0 and the pinned Quint installation. Run `node scripts/spec-snapshots.ts --check` in fresh processes with the 150 native receipts for each revision. The command creates a new generation directory. After one warm-up per side, five pairs alternated order. The CPU samples were 2.67, 2.50, 2.78, 2.57 and 2.48 seconds for the reference and 2.04, 2.14, 2.20, 2.15 and 2.29 seconds for the revision. These results measure the whole snapshot command, including the VibeLang compilation.

All 691 generated files matched byte for byte, and serialization of every field of each of the 150 proof units had the same digest. Each snapshot check compared all 232 published artifacts. A native type error retained its original source diagnostic and created no receipt.

The generator used zero native typechecks with only compact receipts, only legacy receipts, or both. A truncated compact entry fell back to the intact full entry. Removing both forms for one module ran exactly one native typecheck and recreated its compact entry. A caller that requested the complete graph ran one native typecheck on a compact-only store. Its next full request reused its own receipt.
