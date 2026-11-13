# The per-app snapshot template: Bun 1.4.4 refuses the rewoven rows view select

Date: 2026-10-31. Hand-written by the contributor. No model output is in this report. Both
reproductions are deterministic (the same test file, the same dev Postgres cluster on :54339).

## The problem

`appSnapshotSql` (`packages/observatory/src/sources/real.ts`) wraps the snapshot builder's SQL client
so a query that names `platform.person_blocks` or `platform.matching_ages` reads the app's own
restricted views instead. To reweave the select it fabricated a `TemplateStringsArray`:

```ts
return (sql as any)(Object.assign(swapped, { raw: swapped }) as unknown as TemplateStringsArray, ...values);
```

`Object.assign` puts `raw` on the array as an ENUMERABLE property. A real tagged template array
carries `raw` as a frozen, non-enumerable property (the language spec). Bun 1.4.2 accepted the
fabricated array by accident; Bun 1.4.4 validates it and refuses the query:

```text
The argument 'strings' has an enumerable 'raw' property, so it is not a template object.
Use sql.unsafe(), or define 'raw' with Object.defineProperty().
```

Every query that hits the rewrite branch then throws: the peon shadow run ends with
`a.ok = false, b.ok = false`, and this fails in the validation suite:

```text
(fail) real mode fixes and per-app panels (Postgres) > an app login outside the app's role is refused;
the global reveal needs a dev database; shadow runs are one at a time and read the app's blocks view
```

CI stays green because `.github/workflows/ci.yml` pins `bun-version: 1.4.2`. But CONTRIBUTING
section 4 tells the contributor to `brew install bun`, and brew ships 1.4.4 today: the documented
setup runs the repository's own validation suite and it fails on the machine that follows the
documentation.

## The reproduction (before, on a0ed7bc)

`bun test --conditions eliza-source packages/observatory/test/real-fixes.test.ts` (dev Postgres on
:54339 up):

| Bun | Result on a0ed7bc (base) | Result with this change |
|---|---|---|
| 1.4.2 (the pinned version; `~/.bun/bin/bun`, installed from bun.sh) | 8 pass, 0 fail | 8 pass, 0 fail |
| 1.4.4 (brew; the documented install today) | 7 pass, 1 fail (the test above) | 8 pass, 0 fail |

The full suite `bun run test:integration` on Bun 1.4.4 on the base revision shows the same one
failure (`680 pass, 8 skip, 1 fail`); with the change it is green (summary lines pasted in the pull
request).

## The fix

Build the rewoven template the way the parser builds every template: `raw` becomes a frozen,
non-enumerable property through `Object.defineProperty`, and the array is frozen like a real
template array. The values pass through unchanged, the underlying client keeps interpreting them
the same way, and both Bun versions accept the query.

## Validation

Same machine, dev PostgreSQL 16 on :54339.

- `bun run typecheck`: clean on all four projects.
- `bun run test:integration` (Bun 1.4.4): see the pull request for the summary line (green, the
  pre-existing failure above gone).
- `bun run test:e2e`: see the pull request for the summary line.
- Bun 1.4.2: the file and the suite stay green (no change for the pinned version; verified with
  the side-by-side 1.4.2 binary).

## Limits

- The woven path rewrites only the two platform views; any future client-side check that is more
  strict than "enumerable raw" would need its own conformance, but this fix builds the array to
  the spec, so tighter spec checks pass it.
- `bun run sim` is not affected: the simulation never imports the observatory's real-mode
  sources; the changed file runs only inside the console.
