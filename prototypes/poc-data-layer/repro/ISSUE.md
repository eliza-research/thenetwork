<!-- DRAFT: not filed. Target: github.com/electric-sql/pglite issues. -->

# Instance permanently fails after ~1.5k–3k caught SQL errors (54001 "stack depth limit exceeded", or a wasm OOB crash)

## Summary

A single PGlite instance that has raised a few thousand ordinary SQL errors stops working. The application catches every error, and no error is left unhandled. After the threshold, every later query fails, including `SELECT 1`. The failure takes one of two forms:

- `54001 stack depth limit exceeded`, every time from then on (`25P02` inside a transaction), or
- for syntax errors, a wasm trap: `Out of bounds memory access (evaluating 'a._PostgresMainLongJmp()')`, followed by `Aborted()`.

The threshold depends on the kind of error, but for a given kind it is the same on every run. This suggests that each error recovery (the `longjmp` back to `PostgresMain`) leaks a fixed amount of C stack, or of a stack-depth counter, that is never reclaimed.

## Environment

- `@electric-sql/pglite` 0.5.8 (latest on npm as of 2026-10-06), reporting PostgreSQL 18.3 on wasm32-emscripten
- Reproduced on Bun 1.4.2 and on Node 24.15.0 (macOS 26.2, Apple Silicon)
- No extensions loaded. The default `PGlite.create()`.

## Reproduction

`repro/pglite-error-limit.ts`. It needs only `@electric-sql/pglite`. Run it with `node repro/pglite-error-limit.ts` or `bun repro/pglite-error-limit.ts`:

```ts
import { PGlite } from "@electric-sql/pglite";
const db = await PGlite.create();
await db.exec("CREATE TABLE t (k int PRIMARY KEY); INSERT INTO t VALUES (1)");
let n = 0;
for (;; n++) {
  try { await db.query("INSERT INTO t VALUES (1)"); }
  catch (e: any) { if (e.code !== "23505") { console.log(n, e.code, e.message); break; } }
}
await db.query("SELECT 1"); // throws 54001 from now on
```

## Observed (identical on Bun and Node)

| Error raised repeatedly (and caught) | Errors survived | Then |
|---|---|---|
| `INSERT` duplicate key (`23505`) | 2,978 | `54001 stack depth limit exceeded` on every query |
| `SELECT 1/0` (`22012`) | 1,872 | `54001` on every query |
| `DO $$ BEGIN RAISE EXCEPTION 'boom'; END $$` (`P0001`) | 2,978 | `54001` on every query |
| `SELEC 1` (`42601`) | 1,511 | `Out of bounds memory access (... _PostgresMainLongJmp())`, then `Aborted()` |

Other observations:

- `db.exec()` instead of `db.query()`: 2,569 duplicate-key errors.
- `db.transaction()` that fails inside: 2,977.
- Successful queries between the failures do not reset the count.

## Expected

Error recovery should not leak memory, so an instance should survive any number of caught errors, as a native backend does. If there is a hard limit, PGlite should document it, and should fail with a clear error that says the instance must be recreated.

## Impact

We use PGlite as a local stand-in for Postgres in long-running simulations. Those code paths rely on catching unique violations, and the instance stops working after a few simulated weeks. Our workaround is to use `INSERT ... ON CONFLICT DO NOTHING RETURNING` everywhere duplicates are expected, and to recycle the instance. Syntax errors leave the wasm module in a crashed state, so `close()` may also fail.

## Possibly related

The number of errors survived depends on the error path, and the syntax-error path crashes inside `_PostgresMainLongJmp`. Both point to the emscripten `setjmp`/`longjmp` error recovery in the single-user main loop, which does not restore the stack pointer or `stack_base_ptr`. The value checked by `check_stack_depth()` may keep growing.
