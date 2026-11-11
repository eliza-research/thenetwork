# LemmaScript wave 3: platform (platform-w3)

Area: packages/platform (not phone.ts), packages/mcp (not pages.ts and `esc`), deploy, blooio, notify, capital, observatory src and db. Dafny: the release build with Z3 4.12.1 (the CI build), through the throttled shim. All commands ran under `heavy`.

## Proved

| File | Functions | Verified | Production call site | Mutation (in a copy of the .dfy) | Result |
|---|---|---|---|---|---|
| packages/platform/src/segments.ts (new) | `be16`, `byteAt`, `scanEnd`, `jpegSegments`, `typeIs`, `pngChunks` | 12, 0 errors | photos.ts `stripJpeg` and `stripPng` call `jpegSegments` and `pngChunks`; the old inline walks are gone | A: the JPEG walk goes on after EOI. B: the PNG walk steps `8 + len` (skips the CRC). C: a JPEG segment length below 2 is accepted. D: a 0xFF fill byte does not move the offset | A, B, C: an invariant fails. D: "decreases expression might not decrease" |
| deploy/backup/refusal.ts (new) | `targetRefused`, `maybeSource`, `restoreRefusal` | 1 (method) + 2 transparent functions, 0 errors | restore.ts `restore()` calls `targetRefused` before it reads the manifest and `restoreRefusal` after; the old inline checks are gone | `--roles` is refused only when `sameServer` (the unknown-source case dropped) | "a postcondition could not be proved" |

What the segments proof states (`jpegSegments`, `pngChunks`, `scanEnd`):
- Termination on any bytes: each step moves the offset forward (decreases `b.length - i`). This is the property the WebP walk lacked before wave 2.
- Bounds: every JPEG piece lies in `[2, b.length]`, is at least 2 bytes, and a piece with a length has its payload `[at + 4, end]` inside it. Pieces are in file order and do not overlap. Every PNG chunk starts at or after 8 and `at + 12 + len <= b.length`, and the chunks are back to back from byte 8.
- Nothing after the first EOI: a whole 0xD9 piece is only the last piece, and only when `eoi`. A good walk without EOI saw scan data (a ghost witness index in the .dfy, a proof addition only).
- PNG: a good walk starts with IHDR at byte 8 and ends with IEND; no chunk before the last is IEND (nothing after IEND is copied).

What the restore proof states: a restore that goes ahead has a safe, non-live target name; it is not into the backup's own database on a server that may be the source; `--roles` (roles.sql changes roles for the whole server) is never run on a server that may be the source; an encrypted backup has its plain dump. "May be the source" includes a backup that does not name its source (fail closed), and the ensures `roles && !sourceKnown ==> refused` pins that. It protects production in two ways: the live names (`railway`, `network`, `postgres`, templates) and the source server's roles. The "database already exists" check is SQL and stays in restore.ts.

Not covered: every fact is a trusted boolean (`safeDbName` is a regex, `LIVE_NAMES` a Set, `sameServer` compares host and port). The JPEG and PNG allowlists (`JPEG_KEEP`, the JFIF and Adobe rules, `PNG_KEEP`) stay in photos.ts: the proof says which pieces exist and where, not which are kept. The CRC is not checked (it was not before).

## Byte-identical check (JPEG and PNG)

The old `stripJpeg` and `stripPng` (from the file before the change) against the new `stripMetadata`, outputs and BadImage messages compared as strings: 4 real files (design/member-flows/preview.jpg, minimal-preview.jpg, plugins/openai/assets/icon.png, logo.png) with 300 random mutations each, and 20,000 mutations each of a generated JPEG (JFIF with thumbnail, EXIF, Adobe, DQT, SOF0, DHT, COM, two scans with stuffed bytes, a restart marker, fill, TEM, an image after EOI) and a generated PNG (IHDR, gAMA, tEXt, iCCP, PLTE, IDAT, IEND, a chunk after IEND). Mutations: byte changes, marker bytes, truncation, deletion, insertion. Result: 41,204 same, 0 different (6,134 stripped, 35,070 refused with the same message). The script is in the session scratchpad (w3platform/diff.ts), not in the repo (tests policy: no unit tests).

## Dead code removed

`dedupeKeysFor` (packages/blooio/src/blooio/webhook.ts) and `isE164` (packages/blooio/src/phone.ts). `grep -rn` over the whole worktree (packages, deploy, scripts, sites, tests, plugins, evals) found no caller; the only other hits are in docs/research. Both were exported through packages/blooio/src/index.ts only. Dedupe works through `inbox.receive`.

## Skipped

- `refreshUsable` and the bearer predicate (packages/mcp/src/handler.ts:632 and :742): skipped again. The refresh check is one conjunction of five token-row comparisons; the grant side (revoked, expired, banned, Cloud authority) is already proved in decisions.ts `grantVerdict`. "Another app's grant never refreshes" is not local to the predicate: it holds because `authClient` refuses a client whose `app` is not the site's app and the token must belong to that client, and a token is minted with its client's app (a store fact). A proof over these booleans would restate the conjunction and trust the store fact. The bearer predicate already checks `t.app` directly.

## Defects

None found. The extraction keeps behavior (see the differential check), so no before-failure case applies.

## Runs

- `lsc check --backend=dafny`: segments.ts 12 verified, refusal.ts 1 verified, riff.ts 5 verified, 0 errors each.
- `bunx tsc --noEmit -p .`: exit 0, 0 errors.
- bun test: photos.test.ts 17/17, deploy/backup/backup.test.ts 6/6 (Postgres, not skipped), deploy/backend/backend.test.ts 29/29, deploy/router.test.ts 31/31, packages/blooio/test/outbound-queue.test.ts 8/8, packages/platform/test/blooio-otp.integration.test.ts 7/7, packages/notify/test/store-contract.test.ts 10/10, wiring.test.ts 8/8.
- `bun run sim --only safety` 17/17 (the photo gates included), `ops` 11/11, `pipeline` 15/15.
- `bun run sim --only formal`: 38/39. My two files pass, "every proved file is imported by non-test code" and "trust does not grow" pass. The one failure is packages/network/src/transitions.ts (network-src area, being edited by another agent), not this area.

## Trust

assume 0, havoc 0, extern 0, axiom 0 in both new files. The .dfy proof additions in segments.dfy: one ghost variable `sos`, one invariant and one ghost assignment (witness for the scan-data invariant).

## Files changed

- New: packages/platform/src/segments.ts, deploy/backup/refusal.ts, proofs/packages/platform/src/segments.dfy(.gen), proofs/deploy/backup/refusal.dfy(.gen).
- Changed: packages/platform/src/photos.ts, deploy/backup/restore.ts, packages/blooio/src/blooio/webhook.ts, packages/blooio/src/phone.ts.
- LemmaScript-files.txt: 2 lines appended (segments.ts, refusal.ts).

## Changes needed outside my files

None. proofs/trust.json: no change (0 new trust).
