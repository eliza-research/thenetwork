// peon job postings on Postgres (#9): the rows a posting leaves, and the staff API.
//
//   savePosting      a posting's intent and its tagged facets on the hiring manager (src/jobs.ts
//                    postingFacts), written in the unit's save transaction (runtime.ts writeUnit). The
//                    snapshot (snapshot.ts, engine peonSeats) makes each active posting a job seat. No new
//                    table: postings persist with the member's other rows (network.intents, network.facets),
//                    under the same row-level security, and go with the member on the forget path.
//   verifyEmployer   staff mark a manager as a verified employer (company id and `peon:verified`): peonPack
//                    proposes no job of an unverified employer.
//   jobPostingRoutes the staff API (one handler, registered by the service; see the README line below):
//                      GET  /postings?managerId=<id>           the postings (one manager, or all)
//                      POST /postings                          create or update one ({managerId, title, payMin, payMax, ...})
//                      POST /postings/:id/close                close ({reason: "closed" | "filled"})
//                      POST /employers/:memberId/verify        {company, note}
//                    Every write goes through the Network (ConsentNetwork.applyPosting) in a unit of work, so
//                    the same checks run as for a text (an adult, active, opted-in peon member) and a closed
//                    posting ends its open seat items at once. Each call writes network.staff_audit.
import type { SQL } from "bun";
import type { Facet, Intent, MemberId } from "@thenetwork/core";
import { postingFacts, postingFromFacts, postingProblem, type JobPosting } from "../src/jobs.ts";
import type { NetworkRuntime } from "./runtime.ts";

const ID = /^[A-Za-z0-9_.:-]{1,200}$/;

/** Upsert a posting's rows (inside an app-scoped transaction). The facets tagged with its id are replaced. */
export async function savePosting(tx: SQL, app: string, p: JobPosting): Promise<void> {
  const { intent, facets } = postingFacts(p);
  await tx`insert into network.intents (app_id, id, member_id, objective, category, details, horizon_days, status, created_at)
    values (${app}, ${intent.id}, ${intent.memberId}, ${intent.objective}, ${intent.category}, ${intent.details ?? null}, ${intent.horizonDays}, ${intent.status}, ${new Date(intent.createdAt)})
    on conflict (id) do update set objective = excluded.objective, details = excluded.details, status = excluded.status
    where network.intents.app_id = excluded.app_id and network.intents.member_id = excluded.member_id`;
  await tx`delete from network.facets where app_id = ${app} and member_id = ${p.managerId} and ${`peon:posting:${p.id}`} = any(tags)`;
  for (const f of facets) {
    await tx`insert into network.facets (app_id, id, member_id, kind, value, tags, privacy_scope, provenance, source, confidence, status, valid_from)
      values (${app}, ${f.id}, ${f.memberId}, ${f.kind}, ${f.value}, ${tx.array(f.tags, "TEXT")}, ${f.scope}, ${f.provenance}, ${f.source ?? "chat"}, ${f.confidence}, 'confirmed', ${new Date(f.validFrom ?? p.updatedAt)})`;
  }
}

/** The postings stored for this app (one manager, or all), newest first. */
export async function loadPostings(tx: SQL, app: string, managerId?: MemberId): Promise<JobPosting[]> {
  const intents = managerId
    ? await tx`select * from network.intents where app_id = ${app} and member_id = ${managerId} and details like 'peon:job%' order by created_at desc, id`
    : await tx`select * from network.intents where app_id = ${app} and details like 'peon:job%' order by created_at desc, id`;
  if (!intents.length) return [];
  const facets = await tx`select * from network.facets where app_id = ${app} and exists (select 1 from unnest(tags) t where t like 'peon:posting:%') order by id`;
  return (intents as any[]).map(r => {
    const intent: Intent = { id: r.id, memberId: r.member_id, objective: r.objective, category: r.category, details: r.details ?? undefined, horizonDays: r.horizon_days, status: r.status, createdAt: new Date(r.created_at).getTime() };
    const fs = (facets as any[]).filter(f => f.member_id === r.member_id).map((f): Facet => ({ id: f.id, memberId: f.member_id, kind: f.kind, value: f.value, tags: f.tags, scope: f.privacy_scope, provenance: f.provenance, confidence: f.confidence }));
    return postingFromFacts(intent, fs);
  });
}

/** Staff verified this hiring manager's company (an id like "acme"): the company facts every seat of theirs carries. */
export async function verifyEmployer(tx: SQL, app: string, memberId: MemberId, company: string, at: number): Promise<void> {
  const co = company.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  await tx`delete from network.facets where app_id = ${app} and member_id = ${memberId} and id in (${`${memberId}-peon-company`}, ${`${memberId}-peon-verified`})`;
  await tx`insert into network.facets (app_id, id, member_id, kind, value, tags, privacy_scope, provenance, source, confidence, status, valid_from) values
    (${app}, ${`${memberId}-peon-company`}, ${memberId}, 'fact', ${`Company: ${company.slice(0, 80)}`}, ${tx.array([`peon:company:${co}`], "TEXT")}, 'shareable', 'vouched', 'staff', 1, 'confirmed', ${new Date(at)}),
    (${app}, ${`${memberId}-peon-verified`}, ${memberId}, 'fact', 'Employer verified', ${tx.array(["peon:verified"], "TEXT")}, 'matchable', 'vouched', 'staff', 1, 'confirmed', ${new Date(at)})`;
}

export interface PostingRouteDeps {
  rt: NetworkRuntime;
  /** The staff member (network.staff_audit actor) and their roles. */
  user: { id: string; roles: string[] };
  /** Refuse unless the staff member has one of these roles for this app (service.ts `need`). */
  need(roles: ("admin" | "reviewer" | "safety" | "analyst")[]): Response | undefined;
  /** network.staff_audit. */
  audit(e: { at: number; actor: string; roles: any[]; action: string; mode: "real"; ok: boolean; app: string; targetType?: "member"; targetId?: string; detail?: Record<string, unknown> }): Promise<void>;
  now(): number;
}

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
async function readJson(req: Request): Promise<Record<string, any> | undefined> {
  try { const b = await req.json(); return b && typeof b === "object" && !Array.isArray(b) ? b as Record<string, any> : undefined; } catch { return undefined; }
}
const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : undefined);
const skills = (v: unknown): { skill: string; level: number }[] | undefined => {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 12) return undefined;
  const out: { skill: string; level: number }[] = [];
  for (const x of v) {
    const skill = typeof x === "string" ? x : x?.skill, level = typeof x === "string" ? 2 : x?.level ?? 2;
    if (typeof skill !== "string" || !/^[a-z0-9_]{1,40}$/.test(skill) || !Number.isInteger(level)) return undefined;
    out.push({ skill, level });
  }
  return out;
};

/**
 * The staff API for peon postings: a handler for the service's staff router (after its auth, with the
 * app's runtime). Undefined: not a postings path (the router goes on). Only the peon network has postings.
 */
export function jobPostingRoutes(deps: PostingRouteDeps): (req: Request, path: string) => Promise<Response | undefined> {
  const { rt } = deps;
  const audit = (action: string, ok: boolean, targetId?: string, detail?: Record<string, unknown>) =>
    deps.audit({ at: deps.now(), actor: deps.user.id, roles: deps.user.roles, action, mode: "real", ok, app: rt.app.id, ...(targetId ? { targetType: "member" as const, targetId } : {}), ...(detail ? { detail } : {}) });
  return async (req, path) => {
    const close = path.match(/^\/postings\/([^/]+)\/close$/);
    const verify = path.match(/^\/employers\/([^/]+)\/verify$/);
    if (path !== "/postings" && !close && !verify) return undefined;
    if (rt.app.id !== "peon") return json({ ok: false, error: "not_found" }, 404);
    if (req.method === "GET" && path === "/postings") {
      const no = deps.need(["admin", "reviewer"]); if (no) return no;
      const managerId = new URL(req.url).searchParams.get("managerId") ?? undefined;
      if (managerId !== undefined && !ID.test(managerId)) return json({ ok: false, error: "invalid_id" }, 400);
      await audit("read_postings", true, managerId);
      return json({ ok: true, network: rt.id, postings: await rt.scoped(tx => loadPostings(tx, rt.app.id, managerId)) });
    }
    if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
    const no = deps.need(["admin"]); if (no) return no;
    const b = await readJson(req);
    if (!b) return json({ ok: false, error: "invalid_json" }, 400);
    if (verify) {
      let memberId: string;
      try { memberId = decodeURIComponent(verify[1]!); } catch { return json({ ok: false, error: "invalid_id" }, 400); }
      const company = str(b.company, 80), note = str(b.note, 2000);
      if (!ID.test(memberId) || !company || !note || note.length < 5) return json({ ok: false, error: "company_and_note_required" }, 400);
      const why = await rt.readState(n => n.managerProblem(memberId));
      if (why) { await audit("verify_employer", false, memberId, { reason: why }); return json({ ok: false, reason: why }, 409); }
      await rt.scoped(tx => verifyEmployer(tx, rt.app.id, memberId, company, deps.now()));
      await audit("verify_employer", true, memberId, { company });
      return json({ ok: true });
    }
    let posting: JobPosting;
    const now = deps.now();
    const stored = async (id: string) => (await rt.scoped(tx => loadPostings(tx, rt.app.id))).find(p => p.id === id);
    if (close) {
      let id: string;
      try { id = decodeURIComponent(close[1]!); } catch { return json({ ok: false, error: "invalid_id" }, 400); }
      const reason = b.reason === "filled" ? "filled" : "closed";
      const prev = ID.test(id) ? await stored(id) : undefined;
      if (!prev) return json({ ok: false, error: "unknown_posting" }, 404);
      posting = { ...prev, status: "closed", closedReason: reason, updatedAt: now };
    } else {
      const managerId = str(b.managerId, 200);
      const id = b.id === undefined ? `post-${crypto.randomUUID().slice(0, 12)}` : str(b.id, 80);
      const must = skills(b.must), nice = skills(b.nice);
      if (!managerId || !ID.test(managerId) || !id || !must || !nice) return json({ ok: false, error: "invalid_posting" }, 400);
      const prev = await stored(id);
      if (prev && prev.managerId !== managerId) return json({ ok: false, reason: "not_owner" }, 409);
      posting = {
        id, managerId, title: str(b.title, 80) ?? prev?.title ?? "", family: str(b.family, 48)?.toLowerCase().replace(/[^a-z0-9]+/g, "_") ?? prev?.family ?? (str(b.title, 80) ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_"),
        ...(Number.isInteger(b.seniority) ? { seniority: b.seniority } : prev?.seniority ? { seniority: prev.seniority } : {}),
        openings: b.openings ?? prev?.openings ?? 1, payMin: b.payMin ?? prev?.payMin, payMax: b.payMax ?? prev?.payMax,
        mode: b.mode ?? prev?.mode ?? "onsite", ...(str(b.area, 40) ?? prev?.area ? { area: (str(b.area, 40) ?? prev!.area)!.toLowerCase().replace(/[^a-z0-9]+/g, "_") } : {}),
        must: b.must === undefined && prev ? prev.must : must, nice: b.nice === undefined && prev ? prev.nice : nice.map(x => x.skill),
        ...(typeof b.sponsors === "boolean" ? { sponsors: b.sponsors } : prev?.sponsors !== undefined ? { sponsors: prev.sponsors } : {}),
        status: "active", createdAt: prev?.createdAt ?? now, updatedAt: now,
      };
      const bad = postingProblem(posting);
      if (bad) return json({ ok: false, error: bad }, 400);
    }
    const r = await rt.unitOfWork(n => n.applyPosting(posting, deps.user.id));
    await audit(close ? "close_posting" : "save_posting", r.ok, posting.managerId, { postingId: posting.id, status: posting.status, ...(r.ok ? {} : { reason: r.reason }) });
    return r.ok ? json({ ok: true, posting }) : json({ ok: false, reason: r.reason }, 409);
  };
}
