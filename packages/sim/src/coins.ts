import { hash32 } from "@thenetwork/core";

export function h01(...parts: (string | number)[]): number {
  let h = hash32(...parts);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export const signature = (ids: readonly string[]): string => [...ids].sort().join(",");

export class Coins {
  private readonly byInstance = new Map<string, string>();
  private readonly next = new Map<string, number>();

  key(meaning: string, instance: string): string {
    const id = `${meaning}\u0000${instance}`;
    const known = this.byInstance.get(id);
    if (known !== undefined) return known;
    const n = this.next.get(meaning) ?? 0;
    this.next.set(meaning, n + 1);
    const k = `${meaning}#${n}`;
    this.byInstance.set(id, k);
    return k;
  }
}
