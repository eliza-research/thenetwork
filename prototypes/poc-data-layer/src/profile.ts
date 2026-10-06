// Fix 5b: profile sync writes only member contact fields and network.profiles. Engine-learned state lives in
// separate tables (engine_member_state, facets, intents, edges) whose statement triggers reject writes from a
// transaction that declared network.writer = 'profile_sync'.
import type { Db } from "./db";

export interface ProfileSnapshot {
  name: string; email?: string | null; phone?: string | null; time_zone?: string;
  headline?: string | null; bio?: string | null; links?: string[]; source: string; source_rev: string;
}

export async function syncProfile(db: Db, memberId: string, p: ProfileSnapshot) {
  return db.tx(async (t) => {
    await t.q("SELECT set_config('network.writer', 'profile_sync', true)");
    await t.q(`UPDATE network.members SET name = $2, email = $3, phone = $4, time_zone = coalesce($5, time_zone)
                WHERE id = $1 AND (name, email, phone, time_zone) IS DISTINCT FROM ($2, $3, $4, coalesce($5, time_zone))`,
      [memberId, p.name, p.email ?? null, p.phone ?? null, p.time_zone ?? null]);
    const r = await t.q(`INSERT INTO network.profiles (member_id, headline, bio, links, source, source_rev, synced_at)
        VALUES ($1, $2, $3, $4::text::jsonb, $5, $6, now())
        ON CONFLICT (member_id) DO UPDATE SET headline = excluded.headline, bio = excluded.bio, links = excluded.links,
          source = excluded.source, source_rev = excluded.source_rev, synced_at = excluded.synced_at
        WHERE network.profiles.source_rev IS DISTINCT FROM excluded.source_rev
        RETURNING member_id`, [memberId, p.headline ?? null, p.bio ?? null, JSON.stringify(p.links ?? []), p.source, p.source_rev]);
    return { changed: r.length > 0 };
  });
}

/** Content + row-version fingerprint of every engine-owned table. xmin changes even on a no-op UPDATE. */
export async function engineFingerprint(db: Db) {
  const out: Record<string, string> = {};
  for (const t of ["engine_member_state", "facets", "intents", "edges"]) {
    const [{ h }] = await db.q<{ h: string }>(
      `SELECT count(*) || ':' || coalesce(md5(string_agg(x::text || '@' || x.xmin::text, '|' ORDER BY x::text)), '-') AS h FROM network.${t} x`);
    out[t] = h;
  }
  return out;
}
