// Fix 5a: projections (members, opportunities, participations) rebuilt from the event log equal the live tables
// after a randomized workload, including plain deletes, cascades and erasures.
import type { Db } from "./db";
import { simInsertMember, simInsertOpportunity, simInsertParticipation } from "./sim";
import { rng } from "./suite";

const STATES = ["PROPOSED", "IN_REVIEW", "APPROVED", "INVITING", "SCHEDULED", "COMPLETED", "DECLINED", "EXPIRED", "CANCELLED"];
const P_STATES = ["invited", "accepted", "declined", "attended", "no_show"];

export async function projectionWorkload(db: Db, opts: { minEvents: number; seed: number }) {
  const rand = rng(opts.seed);
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
  const [{ n: startEvents }] = await db.q<{ n: number }>("SELECT count(*)::int AS n FROM network.events");
  const members: string[] = [], opps: string[] = [];
  const ops: Record<string, number> = {};
  const bump = (k: string) => (ops[k] = (ops[k] ?? 0) + 1);
  let events = 0;
  for (let i = 0; events < opts.minEvents; i++) {
    const r = rand();
    if (members.length < 20 || r < 0.15) {
      const id = await simInsertMember(db, { name: `persona ${i}`, home_city: rand() < 0.5 ? "sf" : "nyc",
        invited_by: members.length && rand() < 0.6 ? pick(members) : null, phone: `+1415555${String(i).padStart(4, "0")}` });
      if (id) members.push(id);
      bump("member.create");
    } else if (r < 0.30) {
      await db.q(`UPDATE network.members SET participation_state = $2, account_status = $3, name = name || '.' WHERE id = $1`,
        [pick(members), pick(["open", "normal", "quiet", "receiving", "paused"]), pick(["onboarding", "active", "paused"])]);
      bump("member.update");
    } else if (r < 0.50) {
      await db.tx(async (t) => {
        const ps = [...new Set(Array.from({ length: 2 + Math.floor(rand() * 2) }, () => pick(members)))];
        if (ps.length < 2) return;
        const id = await simInsertOpportunity(t, { kind: "intro", city: "sf", objective: `objective ${i % 7}`,
          objectiveHash: `h${i % 7}`, participants: ps });
        if (!id) return bump("opportunity.duplicate");
        opps.push(id);
        for (const m of ps) await simInsertParticipation(t, id, m);
        bump("opportunity.create");
      });
    } else if (r < 0.65 && opps.length) {
      // Terminal states stay terminal (re-activating could collide with a newer active duplicate).
      await db.q(`UPDATE network.opportunities SET state = $2, updated_at = now()
                   WHERE id = $1 AND network.is_active_state(state)`, [pick(opps), pick(STATES)]);
      bump("opportunity.transition");
    } else if (r < 0.82 && opps.length) {
      await db.q("UPDATE network.participations SET state = $2, updated_at = now() WHERE opportunity_id = $1", [pick(opps), pick(P_STATES)]);
      bump("participation.update");
    } else if (r < 0.88 && opps.length) {
      await db.q(`DELETE FROM network.participations WHERE (opportunity_id, member_id) IN
                    (SELECT opportunity_id, member_id FROM network.participations WHERE opportunity_id = $1 LIMIT 1)`, [pick(opps)]);
      bump("participation.delete");
    } else if (r < 0.93 && opps.length) {
      const o = opps.splice(Math.floor(rand() * opps.length), 1)[0]!;
      await db.q("DELETE FROM network.opportunities WHERE id = $1", [o]); // cascades to participations
      bump("opportunity.delete");
    } else if (r < 0.97) {
      const m = members.splice(Math.floor(rand() * members.length), 1)[0]!;
      await db.q("DELETE FROM network.members WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM network.opportunities WHERE participants @> ARRAY[$1::uuid])", [m]);
      bump("member.delete"); // cascades participations, nulls invited_by
    } else {
      const m = members.splice(Math.floor(rand() * members.length), 1)[0]!;
      await db.q("SELECT network.erase_member($1::uuid)", [m]);
      bump("member.erase");
    }
    if (i % 50 === 0 || events + 50 >= opts.minEvents) {
      const [{ n }] = await db.q<{ n: number }>("SELECT count(*)::int AS n FROM network.events");
      events = n - startEvents;
    }
  }
  const [{ n }] = await db.q<{ n: number }>("SELECT count(*)::int AS n FROM network.events");
  return { events: n - startEvents, ops };
}

export async function projectionDiff(db: Db) {
  return db.q<{ projection: string; only_live: number; only_rebuilt: number }>("SELECT * FROM network.projection_diff()");
}

export async function liveCounts(db: Db) {
  const [r] = await db.q(`SELECT (SELECT count(*)::int FROM network.members) AS members,
      (SELECT count(*)::int FROM network.opportunities) AS opportunities, (SELECT count(*)::int FROM network.participations) AS participations,
      (SELECT count(*)::int FROM network.events WHERE payload ? 'redacted') AS redacted_events`);
  return r;
}
