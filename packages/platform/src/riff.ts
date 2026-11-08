// The RIFF chunk walk of the WebP strip (photos.ts), free of imports so that it can be proved.
// A chunk length comes straight from the upload, so the walk must end on any bytes.

/** A little-endian unsigned 32-bit length. `|` would give a signed value: a top bit turns it negative. */
//@ verify
//@ requires b0 >= 0 && b0 < 256 && b1 >= 0 && b1 < 256 && b2 >= 0 && b2 < 256 && b3 >= 0 && b3 < 256
//@ ensures \result >= 0 && \result < 4294967296
export function le32(b0: number, b1: number, b2: number, b3: number): number {
  return b0 + b1 * 256 + b2 * 65536 + b3 * 16777216;
}

/** One chunk: its header at `at`, `len` bytes of data after the 8-byte header. */
export interface RiffSpan { at: number; len: number }

/** The chunks from `at` to `end`, each fully inside the range, or null at a chunk that claims more bytes than there are. */
//@ verify
//@ requires at >= 0 && end >= at && end <= b.length
//@ requires forall(k: nat, k < b.length ==> b[k] >= 0 && b[k] < 256)
//@ ensures \result !== null ==> forall(k: nat, k < \result.length ==> \result[k].at >= at && \result[k].len >= 0 && \result[k].at + 8 + \result[k].len <= end)
export function riffSpans(b: readonly number[], at: number, end: number): RiffSpan[] | null {
  const spans: RiffSpan[] = [];
  let i = at;
  while (i + 8 <= end) {
    //@ invariant i >= at
    //@ invariant forall(k: nat, k < spans.length ==> spans[k].at >= at && spans[k].len >= 0 && spans[k].at + 8 + spans[k].len <= end)
    //@ decreases end - i
    const len = le32(b[i + 4]!, b[i + 5]!, b[i + 6]!, b[i + 7]!);
    if (i + 8 + len > end) return null;
    spans.push({ at: i, len });
    i += 8 + len + len % 2;
  }
  return spans;
}
