// The JPEG segment walk and the PNG chunk walk of the metadata strip (photos.ts), free of imports so
// that they can be proved, like the RIFF walk in riff.ts. Every length comes straight from the
// upload, so each walk must end on any bytes, and each piece it returns must lie inside the file.
// The walks only find the pieces; photos.ts decides which pieces to keep (the allowlist).

/** Walk errors. photos.ts throws BadImage with the message for each. */
export const WALK_OK = 0;
export const JPEG_NO_MARKER = 1;
export const JPEG_TRUNCATED = 2;
export const JPEG_BAD_SEGMENT = 3;
export const JPEG_NO_IMAGE = 4;
export const PNG_BAD_CHUNK = 5;
export const PNG_IHDR_NOT_FIRST = 6;
export const PNG_NO_IEND = 7;

/**
 * One JPEG piece: the bytes from `at` to `end`, with marker `marker`. `whole` pieces are copied as
 * they are (SOS with its scan data, EOI, the bare markers); the others are a marker with a length
 * and a payload from at + 4, and the allowlist decides on them.
 */
export interface JpegSeg { at: number; end: number; marker: number; whole: boolean }
export interface JpegWalk { segs: JpegSeg[]; error: number; eoi: boolean }

/** A big-endian 16-bit length. */
//@ verify
//@ requires b0 >= 0 && b0 < 256 && b1 >= 0 && b1 < 256
//@ ensures \result >= 0 && \result < 65536
export function be16(b0: number, b1: number): number {
  return b0 * 256 + b1;
}

/** The byte at `k`, or -1 past the end (a Uint8Array gives undefined there, which equals no marker). */
//@ verify
//@ requires k >= 0
//@ requires forall(j: nat, j < b.length ==> b[j] >= 0 && b[j] < 256)
//@ ensures k < b.length ==> \result === b[k]
//@ ensures k >= b.length ==> \result === -1
export function byteAt(b: readonly number[], k: number): number {
  if (k < b.length) return b[k]!;
  return -1;
}

/**
 * The end of the entropy-coded data of a scan that starts at `j`: the next real marker (0xFF00 is a
 * stuffed byte, 0xFFD0-0xFFD7 are restart markers, 0xFFFF is fill), or the end of the file.
 */
//@ verify
//@ requires j >= 0 && j <= b.length
//@ requires forall(k: nat, k < b.length ==> b[k] >= 0 && b[k] < 256)
//@ ensures \result >= j && \result <= b.length
export function scanEnd(b: readonly number[], j: number): number {
  let i = j;
  while (i < b.length) {
    //@ invariant i >= j && i <= b.length
    //@ decreases b.length - i
    if (b[i] !== 0xff) { i++; continue; }
    const n = byteAt(b, i + 1);
    if (n === -1) { i++; break; }
    if (n === 0x00 || (n >= 0xd0 && n <= 0xd7)) { i += 2; continue; }
    if (n === 0xff) { i++; continue; }
    break;
  }
  return i;
}

/**
 * The JPEG pieces after SOI (from byte 2), in file order and without overlap, up to the first EOI.
 * Nothing after the first EOI is returned: phones append whole second images there with their own
 * EXIF and GPS. With no EOI the walk is good only when it saw scan data.
 */
//@ verify
//@ requires forall(k: nat, k < b.length ==> b[k] >= 0 && b[k] < 256)
//@ ensures \result.error === 0 ==> forall(k: nat, k < \result.segs.length ==> \result.segs[k].at >= 2 && \result.segs[k].at + 2 <= \result.segs[k].end && \result.segs[k].end <= b.length)
//@ ensures \result.error === 0 ==> forall(k: nat, k < \result.segs.length ==> (\result.segs[k].whole || \result.segs[k].at + 4 <= \result.segs[k].end))
//@ ensures \result.error === 0 ==> forall(k: nat, k + 1 < \result.segs.length ==> \result.segs[k].end <= \result.segs[k + 1].at)
//@ ensures \result.error === 0 ==> forall(k: nat, k < \result.segs.length ==> (\result.segs[k].marker === 0xd9 && \result.segs[k].whole ==> \result.eoi && k === \result.segs.length - 1))
//@ ensures \result.error === 0 && \result.eoi ==> \result.segs.length > 0 && \result.segs[\result.segs.length - 1].marker === 0xd9 && \result.segs[\result.segs.length - 1].whole
//@ ensures \result.error === 0 && !\result.eoi ==> exists(k: nat, k < \result.segs.length && \result.segs[k].marker === 0xda && \result.segs[k].whole)
export function jpegSegments(b: readonly number[]): JpegWalk {
  const segs: JpegSeg[] = [];
  let i = 2;
  let scanned = false;
  while (i < b.length) {
    //@ invariant i >= 2
    //@ invariant forall(k: nat, k < segs.length ==> segs[k].at >= 2 && segs[k].at + 2 <= segs[k].end && segs[k].end <= i && segs[k].end <= b.length)
    //@ invariant forall(k: nat, k < segs.length ==> (segs[k].whole || segs[k].at + 4 <= segs[k].end))
    //@ invariant forall(k: nat, k + 1 < segs.length ==> segs[k].end <= segs[k + 1].at)
    //@ invariant forall(k: nat, k < segs.length ==> !(segs[k].marker === 0xd9 && segs[k].whole))
    //@ invariant scanned ==> exists(k: nat, k < segs.length && segs[k].marker === 0xda && segs[k].whole)
    //@ decreases b.length - i
    if (b[i] !== 0xff) return { segs, error: JPEG_NO_MARKER, eoi: false };
    const m = byteAt(b, i + 1);
    if (m === 0xd9) {
      segs.push({ at: i, end: i + 2, marker: m, whole: true });
      return { segs, error: WALK_OK, eoi: true };
    }
    // Bare markers (no length): TEM, restart markers; 0xFF is fill before a marker.
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      segs.push({ at: i, end: i + 2, marker: m, whole: true });
      i += 2;
      continue;
    }
    if (m === 0xff) { i += 1; continue; }
    if (i + 4 > b.length) return { segs, error: JPEG_TRUNCATED, eoi: false };
    const len = be16(b[i + 2]!, b[i + 3]!);
    if (len < 2 || i + 2 + len > b.length) return { segs, error: JPEG_BAD_SEGMENT, eoi: false };
    if (m === 0xda) {
      // SOS: its header, then the entropy-coded data up to the next real marker.
      const j = scanEnd(b, i + 2 + len);
      segs.push({ at: i, end: j, marker: m, whole: true });
      i = j;
      scanned = true;
      continue;
    }
    segs.push({ at: i, end: i + 2 + len, marker: m, whole: false });
    i += 2 + len;
  }
  if (scanned) return { segs, error: WALK_OK, eoi: false };
  return { segs, error: JPEG_NO_IMAGE, eoi: false };
}

/** One PNG chunk: 4 length bytes at `at`, the type, `len` bytes of data, the CRC. */
export interface PngChunk { at: number; len: number }
export interface PngWalk { chunks: PngChunk[]; error: number }

/** The four type bytes at `k` are c0..c3. */
//@ verify
//@ requires k >= 0 && k + 4 <= b.length
export function typeIs(b: readonly number[], k: number, c0: number, c1: number, c2: number, c3: number): boolean {
  return b[k] === c0 && b[k + 1] === c1 && b[k + 2] === c2 && b[k + 3] === c3;
}

/**
 * The PNG chunks after the 8-byte signature, each fully inside the file, back to back, up to and
 * including IEND. A good walk starts with IHDR and ends with IEND; nothing after IEND is returned.
 */
//@ verify
//@ requires forall(k: nat, k < b.length ==> b[k] >= 0 && b[k] < 256)
//@ ensures \result.error === 0 ==> forall(k: nat, k < \result.chunks.length ==> \result.chunks[k].at >= 8 && \result.chunks[k].len >= 0 && \result.chunks[k].at + 12 + \result.chunks[k].len <= b.length)
//@ ensures \result.error === 0 ==> forall(k: nat, k + 1 < \result.chunks.length ==> \result.chunks[k].at + 12 + \result.chunks[k].len === \result.chunks[k + 1].at)
//@ ensures \result.error === 0 ==> \result.chunks.length > 0 && \result.chunks[0].at === 8 && b.length >= 20 && typeIs(b, 12, 0x49, 0x48, 0x44, 0x52)
//@ ensures \result.error === 0 ==> \result.chunks.length > 0 && \result.chunks[\result.chunks.length - 1].at >= 8 && \result.chunks[\result.chunks.length - 1].at + 12 <= b.length && typeIs(b, \result.chunks[\result.chunks.length - 1].at + 4, 0x49, 0x45, 0x4e, 0x44)
//@ ensures \result.error === 0 ==> forall(k: nat, k + 1 < \result.chunks.length ==> \result.chunks[k].at >= 8 && \result.chunks[k].at + 12 <= b.length && !typeIs(b, \result.chunks[k].at + 4, 0x49, 0x45, 0x4e, 0x44))
export function pngChunks(b: readonly number[]): PngWalk {
  const chunks: PngChunk[] = [];
  let i = 8;
  while (i + 12 <= b.length) {
    //@ invariant i >= 8
    //@ invariant forall(k: nat, k < chunks.length ==> chunks[k].at >= 8 && chunks[k].len >= 0 && chunks[k].at + 12 + chunks[k].len <= i && chunks[k].at + 12 + chunks[k].len <= b.length)
    //@ invariant forall(k: nat, k + 1 < chunks.length ==> chunks[k].at + 12 + chunks[k].len === chunks[k + 1].at)
    //@ invariant chunks.length === 0 ==> i === 8
    //@ invariant chunks.length > 0 ==> chunks[0].at === 8 && chunks[0].at + 12 + chunks[0].len <= b.length && typeIs(b, 12, 0x49, 0x48, 0x44, 0x52) && chunks[chunks.length - 1].at + 12 + chunks[chunks.length - 1].len === i
    //@ invariant forall(k: nat, k < chunks.length ==> chunks[k].at >= 8 && chunks[k].len >= 0 && chunks[k].at + 12 + chunks[k].len <= b.length && !typeIs(b, chunks[k].at + 4, 0x49, 0x45, 0x4e, 0x44))
    //@ decreases b.length - i
    const len = (b[i]! * 16777216) + (b[i + 1]! * 65536) + be16(b[i + 2]!, b[i + 3]!);
    if (i + 12 + len > b.length) return { chunks, error: PNG_BAD_CHUNK };
    if (chunks.length === 0 && !typeIs(b, i + 4, 0x49, 0x48, 0x44, 0x52)) return { chunks, error: PNG_IHDR_NOT_FIRST };
    chunks.push({ at: i, len });
    if (typeIs(b, i + 4, 0x49, 0x45, 0x4e, 0x44)) return { chunks, error: WALK_OK };
    i += 12 + len;
  }
  return { chunks, error: PNG_NO_IEND };
}
