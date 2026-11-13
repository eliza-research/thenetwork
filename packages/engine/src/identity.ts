import type { MemberId } from "@thenetwork/core";

/** Resolve the input's alias chains into its member IDs; retain unknown IDs. */
export function memberIdResolver(memberIds: ReadonlySet<MemberId>, aliases: Readonly<Record<MemberId, MemberId>> = {}): (id: MemberId) => MemberId {
  return (id: MemberId) => {
    let cur = id; let hops = 0;
    while (!memberIds.has(cur) && aliases[cur] !== undefined && hops++ < 8) cur = aliases[cur]!;
    return cur;
  };
}
