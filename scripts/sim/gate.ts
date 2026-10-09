// Gates for `bun run sim`: every check is a named gate that passes or fails, blocking or tracked.
// `expect` is a small assertion helper (the subset of matchers the ported simulation checks use):
// a failed expectation throws, and `Block.run` turns the throw into a failed gate with its message.
// No bun:test: the validation layer is the simulation CLI (founder decision 2026-10-08).

/**
 * The blocking gates each block runs on the pinned seeds (counted 2026-10-08, after the as-launched,
 * adversary, slop-live, two-app and scale gates). scripts/sim.ts fails a block that runs fewer. Raise a
 * number when gates are added; lower one only with the founder's written waiver.
 */
export const MIN_BLOCKING: Record<string, number> = {};
/** The same for --quick (one seed, shorter runs: quality gates are tracked there). */
export const MIN_BLOCKING_QUICK: Record<string, number> = {};

export interface Gate { block: string; name: string; pass: boolean; blocking: boolean; detail?: string; ms?: number }

const show = (x: unknown) => { try { const s = JSON.stringify(x); return s === undefined ? String(x) : s.length > 400 ? `${s.slice(0, 400)}...` : s; } catch { return String(x); } };

class ExpectError extends Error {}

function matchers(actual: unknown, negate: boolean) {
  const check = (ok: boolean, what: string, expected?: unknown) => {
    if (ok === negate) throw new ExpectError(`expected ${show(actual)} ${negate ? "not " : ""}${what}${expected === undefined ? "" : ` ${show(expected)}`}`);
  };
  const num = () => actual as number;
  return {
    toBe: (e: unknown) => check(Object.is(actual, e), "to be", e),
    toEqual: (e: unknown) => check(Bun.deepEquals(actual, e), "to equal", e),
    toMatchObject: (e: object) => check(Bun.deepMatch(e, actual as object), "to match", e),
    toBeGreaterThan: (e: number) => check(num() > e, "to be >", e),
    toBeGreaterThanOrEqual: (e: number) => check(num() >= e, "to be >=", e),
    toBeLessThan: (e: number) => check(num() < e, "to be <", e),
    toBeLessThanOrEqual: (e: number) => check(num() <= e, "to be <=", e),
    toBeCloseTo: (e: number, digits = 2) => check(Math.abs(num() - e) < 10 ** -digits / 2, "to be close to", e),
    toContain: (e: unknown) => check((actual as { includes(x: unknown): boolean }).includes(e), "to contain", e),
    toMatch: (e: RegExp | string) => check(typeof e === "string" ? String(actual).includes(e) : e.test(String(actual)), "to match", String(e)),
    toBeNull: () => check(actual === null, "to be null"),
    toBeUndefined: () => check(actual === undefined, "to be undefined"),
    toBeTruthy: () => check(!!actual, "to be truthy"),
    toThrow: () => { let threw = false; try { (actual as () => unknown)(); } catch { threw = true; } check(threw, "to throw"); },
  };
}

export function expect(actual: unknown) {
  return { ...matchers(actual, false), not: matchers(actual, true) };
}

/** A block of gates (one app or concern). `run` registers a gate whose body asserts with `expect`. */
export class Block {
  readonly gates: Gate[] = [];
  constructor(readonly name: string, private log = true) {}

  /** A gate from a computed value. */
  gate(name: string, pass: boolean, detail?: string, blocking = true): Gate {
    const g: Gate = { block: this.name, name, pass, blocking, ...(detail ? { detail } : {}) };
    this.gates.push(g);
    if (this.log) print(g);
    return g;
  }
  /** A tracked (non-blocking) metric: printed, never fails the run. */
  track(name: string, pass: boolean, detail?: string): Gate { return this.gate(name, pass, detail, false); }

  /** A gate whose body asserts with `expect` (or throws): it passes when the body returns. */
  async run(name: string, body: () => unknown | Promise<unknown>, blocking = true): Promise<boolean> {
    const t = performance.now();
    let pass = true, detail: string | undefined;
    try { await body(); } catch (e) { pass = false; detail = e instanceof ExpectError ? e.message : (e as Error)?.stack ?? String(e); }
    const g = this.gate(name, pass, detail, blocking);
    g.ms = Math.round(performance.now() - t);
    return pass;
  }
}

/** A short digest of a run's outputs: `bun run sim --json` before and after a refactor must match. */
export function digest(x: unknown): string {
  return new Bun.CryptoHasher("sha256").update(JSON.stringify(x)).digest("hex").slice(0, 16);
}

export function print(g: Gate): void {
  const tag = g.pass ? "PASS " : g.blocking ? "FAIL " : "track";
  const line = `  ${tag} ${g.name}${g.detail && (!g.pass || !g.blocking || g.detail.length < 160) ? `: ${g.detail}` : ""}`;
  (g.pass || !g.blocking ? console.log : console.error)(line);
}
