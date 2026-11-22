// GENERATED from spec/labQueue.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny



/** Story: Submit an experiment when queue capacity is available / Check capacity again before reserving queued seeds (spec/labQueue.md) */
//@ pure
export function labHasQueueCapacity(waitingSeeds: number, requestedSeeds: number, capacity: number): boolean {
  return exact_labQueue(waitingSeeds + requestedSeeds) <= capacity;
}

/** Story: Submit an experiment when queue capacity is available / Check capacity again before reserving queued seeds (spec/labQueue.md) */
//@ pure
export function lawExceedingLabCapacityRefuses(waitingSeeds: number, requestedSeeds: number, capacity: number): boolean {
  //@ ensures \result === true
  return !(exact_labQueue(waitingSeeds + requestedSeeds) > capacity) || !labHasQueueCapacity(waitingSeeds, requestedSeeds, capacity);
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_labQueue(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
