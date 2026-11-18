// The joined app reads a person's base-profile grants (SHARE after the link notice). Each grant names a
// source app; the joined app adds the source member's shareable interests that it does not hold yet and
// keeps its own first name and city. Nothing else crosses apps, and the copies keep the source scope.
import { createHash } from "node:crypto";
import { baseFieldCopy, baseInterestLimit, baseInterestShareable, baseProfileGrantUsable } from "../../core/src/generated/baseProfileShare.ts";
import type { AppId } from "../../platform/src/apps.ts";
import type { Membership, PeopleStore } from "../../platform/src/store.ts";
import type { NetworkRuntime } from "./runtime.ts";

const live = (m: Membership | undefined) => !!m && m.state !== "removed" && m.state !== "invited" && m.state !== "restricted";
const SCOPES = new Set(["matchable", "shareable"]);

interface SourceFacet { kind: string; value: string; tags: string[] | null; privacy_scope: string; status: string; sensitive: string | null; valid_from: Date | string | null; valid_to: Date | string | null }

export interface BaseProfileShareDeps {
  people: Pick<PeopleStore, "shareGrants" | "getMembership">;
  /** The phone's ban (accounts.banned), read again for this read. */
  banned(): Promise<boolean>;
  /** The runtime that owns an app's member rows (any city of the app: facets are per app). */
  runtimeFor(app: AppId): NetworkRuntime | undefined;
  now: number;
}

/** Copies the interests that the person's current grants into `target` allow. Returns how many were added. */
export async function applyBaseProfileGrants(d: BaseProfileShareDeps, personId: string, target: { app: AppId; memberId: string; runtime: NetworkRuntime }): Promise<number> {
  const into = await d.people.getMembership(personId, target.app);
  if (!into || into.memberId !== target.memberId) return 0;
  const banned = await d.banned();
  const held = new Set(((await target.runtime.scoped(tx => tx`select value from network.facets where app_id=${target.app} and member_id=${target.memberId}
    and kind='interest' and status<>'rejected'`)) as { value: string }[]).map(r => r.value.trim().toLowerCase()));
  let added = 0;
  for (const grant of await d.people.shareGrants(personId)) {
    if (grant.toApp !== target.app) continue;
    const from = await d.people.getMembership(personId, grant.fromApp);
    // spec/baseProfileShare.md, "A grant is usable only while it is current and both memberships are live"
    const usable = baseProfileGrantUsable(true, grant.revokedAt !== null, live(from), live(into), banned);
    const source = d.runtimeFor(grant.fromApp);
    if (!usable || !from || !source) continue;
    const facets = (await source.scoped(tx => tx`select kind,value,tags,privacy_scope,status,sensitive,valid_from,valid_to from network.facets
      where app_id=${grant.fromApp} and member_id=${from.memberId} and kind='interest' order by valid_from nulls first, id`)) as SourceFacet[];
    // spec/baseProfileShare.md, "An interest is shared only when the member confirmed it and it is not private"
    const shareable = facets.filter(f => baseInterestShareable(f.kind === "interest", f.status === "confirmed", !SCOPES.has(f.privacy_scope), f.sensitive !== null,
      (f.valid_from === null || new Date(f.valid_from).getTime() <= d.now) && (f.valid_to === null || new Date(f.valid_to).getTime() > d.now), f.value.trim().length))
      .slice(0, Math.max(0, baseInterestLimit - added));
    for (const f of shareable) {
      const value = f.value.trim(), seen = held.has(value.toLowerCase());
      // spec/baseProfileShare.md, "A shared value never replaces what the person told this app"
      if (baseFieldCopy("BaseInterest", usable, grant.fields.includes("interests"), true, seen) !== "AddSharedValue") continue;
      // The copy's id never names the source app: this app learns only that the person shared an interest.
      const id = `${target.memberId}:share:${createHash("sha256").update(`${grant.fromApp}\n${value.toLowerCase()}`).digest("hex").slice(0, 16)}`;
      const inserted = await target.runtime.scoped(tx => tx`insert into network.facets (app_id, id, member_id, kind, value, tags, privacy_scope, provenance, source, confidence, status, valid_from)
        values (${target.app}, ${id}, ${target.memberId}, 'interest', ${value}, ${tx.array((f.tags ?? []).filter(t => !t.includes(":")), "TEXT")}, ${f.privacy_scope}, 'said', 'share_grant', 0.8, 'confirmed', ${new Date(d.now)})
        on conflict (id) do nothing returning id`);
      held.add(value.toLowerCase());
      added += inserted.length;
    }
  }
  return added;
}
