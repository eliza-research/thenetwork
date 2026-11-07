# LemmaScript research: frontend summary

Date: 2026-11-07. Commit: a0ed7bc. Toolchain: lemmascript 0.6.6, Dafny 4.11.0. Hand-written from the five slice reports. The reports were written by research agents, and a second agent then tried to refute each one.

## Result

LemmaScript is useful for the frontend, but only for the pure decisions inside it. It cannot prove a React component, the DOM, `fetch`, `await`, `Date` or a regex. The worst frontend bugs are about timing and state, so each proof must be a reducer or a decision that the shell calls.

| Slice | Report | Files | Bugs reproduced | Candidates kept |
|---|---|---:|---:|---:|
| Public sites | [frontend-sites.md](frontend-sites.md) | 52 | 9 | 3 |
| Observatory state | [frontend-observatory-state.md](frontend-observatory-state.md) | 6 | 19 | 7 |
| Observatory staff work | [frontend-observatory-staff.md](frontend-observatory-staff.md) | 5 | 17 | 6 |
| Observatory views | [frontend-observatory-views.md](frontend-observatory-views.md) | 4 | 12 | 8 |
| Server-rendered and tool UIs | [frontend-server-ui.md](frontend-server-ui.md) | 62 | 13 | 8 |
| Total | | 129 | 70 (about 67 after 3 overlaps) | 32 |

Each kept candidate has a contract that proved on a corrected extract and that failed on the shipped logic or on a mutant. One exception: a kept candidate with "no bug today" guards a table against drift. All trial proofs cover copies, not the shipped files. Wave 2 must make the shipped code call the proved code.

Many candidates were rejected. The usual reason is that the contract repeated the code. A contract that repeats the code proves nothing a reader cannot already see. One first-pass contract was worse: it proved, and it wrote a real bug into the specification (`reviewLine`, staff report).

## The bugs that matter most

Severity is the judgment of this summary. Each item is reproduced in the slice report, with its input.

| Effect | Where |
|---|---|
| Decision goes to an item the reviewer did not choose. One held key approved four items. A new item can be approved unread. | `review.tsx:190,207,218` |
| The confirm press can turn matching on when the admin pressed Turn off. | `admin.tsx:381,387-391` |
| A phone-banned person gets a code, a session, and `/api/me/export`, when the Cloud flags are off. This breaks founder decision 3. Sent to the backend session. | `platform/src/api.ts:471,485-491` |
| One app's review queue shows under another app's name after a load race. | `store.ts:318-346` |
| A person who states 16 still shows as Adult, with the photo form, after an older read lands last. | `panels.tsx:48-54,599` |
| Header shows person B with the lowest age of person A. | `apps.tsx:108-111` |
| Safety events are hidden by a filter that says it does not apply. | `store.ts:707-710`, `drawer.tsx:26,322` |
| A foreign number is changed to a different US number and receives a text. | `sites/shared/api.ts:167-174` |
| A photo flagged "may be under 18" is shown again in the label tool. | `tools/clef-label/index.html:143,158-164` |
| OAuth Cancel: the server records the denial, but the CSP blocks the redirect, so the client never hears it. | `packages/mcp/src/pages.ts:54,55,67` |

## Limits

- `number` is an ideal integer or real. NaN, Infinity and fractions are outside every proof, so a guard must stay at the boundary.
- A proof covers one function on its inputs. A claim about a journey needs every seam of that journey to call the proved function.
- Async order is not modelled. A generation gate can be proved. That the shell calls it on every path cannot be proved, so a wiring test must cover it.
- A proof that compares the client with a hand copy of a server table is only as good as the copy. One shared rule is better.
- Files that are not applicable: fonts, images, CSS, static legal pages, SKILL.md files, React layout and Leaflet or canvas drawing. Each slice report lists every file and the reason.

## Quint and LemmaScript

| Level | Tool | What it holds |
|---|---|---|
| High | Quint | The journey: states, transitions and invariants across the browser and the server, for example the join flow and review to probe |
| Low | LemmaScript | The function that takes one step of that journey, in the shipping code |

Keep the invariant names the same at both levels, so a reader can follow one rule from the model to the proof. The Quint session owns the `.qnt` files.

## Wave 2 plan

Rules are in docs/formal-verification.md (backend session): an import-free core that shipping code imports, no `assume`, one mutation check per spec, and each file listed in `LemmaScript-files.txt`.

| Core | Replaces logic in | Bugs fixed |
|---|---|---|
| `packages/observatory/web/logic/sync.ts` | `store.ts`, `map.ts` | delta rewind, duplicate feed, load race, stale app data, stale markers, reveal badge |
| `packages/observatory/web/logic/filters.ts` | `store.ts`, `drawer.tsx` | filters that do not apply but still hide items |
| `packages/observatory/web/logic/review.ts` | `review.tsx`, `admin.tsx` | wrong-item decisions, held key, flip, report actions, closed-item countdown |
| `packages/observatory/web/logic/views.ts` | `panels.tsx`, `drawer.tsx`, `main.tsx`, `ui.tsx` | adult photos only, stale reads, percent and duration rules |
| `packages/core/src/phone-core.ts` | `sites/shared/api.ts`, `platform/src/phone.ts` | client and server phone parity |
| `sites/shared/join-core.ts` | `sites/shared/join.ts`, `auth.ts` | erased prefill, name limit |
| `packages/mcp/src/html-core.ts` | `util.ts`, `pages.ts` | escape round trip, CSP targets |
| `tools/clef-label` core | `index.html` | flagged photos shown again |
