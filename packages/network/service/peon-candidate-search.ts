import { createHash, randomBytes } from "node:crypto";
import { canBeMatched } from "@thenetwork/core";
import {
  peonSearchAreas, peonSearchConfirmable, peonSearchDraftMs, peonSearchHorizonDays, peonSearchModes, peonSearchOwner,
  peonSearchRoles, peonSearchSkillAllowed, peonSearchSkills, peonSearchStartAllowed, peonSearchTermsAllowed,
  peonSearchTurnCurrent,
} from "../../core/src/generated/peonCandidateSearch.ts";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import { peonCompanyKey, SEARCH_INTENT, T } from "../../engine/src/packs/peon/schema.ts";
import type { Accounts } from "../../platform/src/accounts.ts";
import { memberCommandOwner, type MemberCommandOwner } from "./member-command.ts";
import { currentStaffHold } from "./staff-safety-holds.ts";

type Skill = { id: string; level: number };
interface CandidateTerms {
  role: string;
  level: number;
  floorCents: number;
  modes: string[];
  areas: string[];
  skills: Skill[];
  exclude: string[];
  sponsor?: boolean;
  startWeeks?: number;
}
type SearchCommand = { kind: "draft"; terms?: CandidateTerms } | { kind: "confirm" | "cancel"; reference: string };
type SearchAccounts = Pick<Accounts, "activeMembership" | "lowestAge">;
type DraftRow = { reference: string; terms: CandidateTerms; staged_at: Date };

const candidateSearchTag = "peon:candidate_search";
const newReference = () => `search_${Array.from(randomBytes(8).toString("hex"), digit => "abcdefghijklmnop"[Number.parseInt(digit, 16)]).join("")}`;
const idOf = (value: string) => value.trim().toLowerCase().replaceAll(/\s+/g, "_");
const label = (id: string) => id.replaceAll("_", " ");
const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function annualPayFloorCents(value: string): number | undefined {
  if (value === "none") return 0;
  const amount = /^\$(\d{1,6}|\d{1,3}(?:,\d{3}){1,2})(?:\.(\d{1,3}))?(k)?$/.exec(value);
  if (!amount || (!amount[3] && (amount[2]?.length ?? 0) > 2)) return;
  const number = Number([amount[1]!.replaceAll(",", ""), amount[2]].filter(Boolean).join("."));
  return Math.round(number * (amount[3] ? 100_000 : 100));
}

function fieldsOf(text: string): CandidateTerms | undefined {
  const [title, ...inputs] = text.split(";").map(part => part.trim());
  if (!title || inputs.length > 8) return;
  const role = idOf(title), fields = new Map<string, string>();
  for (const field of inputs) {
    const match = /^(level|minimum|mode|areas|skills|exclude|sponsorship|start) (.+)$/.exec(field);
    if (!match || fields.has(match[1]!)) return;
    fields.set(match[1]!, match[2]!);
  }
  const levelText = fields.get("level"), payText = fields.get("minimum");
  const level = levelText && /^\d$/.test(levelText) ? Number(levelText) : NaN;
  const floorCents = payText === undefined ? undefined : annualPayFloorCents(payText);
  const list = (key: string) => fields.get(key)?.split(",").map(idOf) ?? [];
  const modes = [...new Set(list("mode"))], areas = [...new Set(list("areas"))];
  const companies = fields.get("exclude")?.split("|").map(company => company.trim()) ?? [];
  const exclude = [...new Set(companies.map(peonCompanyKey))];
  if (!Number.isInteger(level) || floorCents === undefined || !modes.every(mode => peonSearchModes.includes(mode))
    || !areas.every(area => peonSearchAreas.includes(area)) || companies.length > 3
    || !companies.every(company => /^[\p{L}\p{N} .,&'/_-]{1,80}$/u.test(company)) || exclude.some(company => !company)) return;
  if (!peonSearchTermsAllowed(peonSearchRoles.includes(role), level, floorCents, modes.length > 0,
    modes.some(mode => mode !== "remote"), areas.length > 0)) return;
  const skills = new Map<string, Skill>();
  for (const field of list("skills")) {
    const match = /^([a-z_]+)=(\d)$/.exec(field);
    if (!match) return;
    const id = match[1]!, level = Number(match[2]);
    if (skills.has(id) || !peonSearchSkillAllowed(peonSearchSkills.includes(id), level)) return;
    skills.set(id, { id, level });
  }
  if (skills.size > 6) return;
  const sponsorText = fields.get("sponsorship");
  if (sponsorText !== undefined && sponsorText !== "yes" && sponsorText !== "no") return;
  const startText = fields.get("start");
  const start = startText !== undefined ? (/^\d{1,2}$/.test(startText) ? Number(startText) : NaN) : undefined;
  if (start !== undefined && (!Number.isInteger(start) || !peonSearchStartAllowed(start))) return;
  return { role, level, floorCents, modes, areas, skills: [...skills.values()], exclude,
    ...(sponsorText !== undefined ? { sponsor: sponsorText === "yes" } : {}), ...(start !== undefined ? { startWeeks: start } : {}) };
}

/** The profile supplied by a connected assistant is never a job-search approval. */
export function peonSearchCommand(text: string): SearchCommand | undefined {
  const normalized = text.normalize("NFKC").trim().toLowerCase().replaceAll(/\s+/g, " ")
    .replace(/^((?:confirm |cancel )?)peon job search(?=\s|$)/, "$1job search");
  const action = /^(confirm|cancel) job search (search_[a-p]{16})\.?$/.exec(normalized);
  if (action) return { kind: action[1] === "confirm" ? "confirm" : "cancel", reference: action[2]! };
  if (normalized === "job search") return { kind: "draft" };
  if (normalized.startsWith("job search ")) return { kind: "draft", terms: fieldsOf(normalized.slice("job search ".length)) };
}

/** The shared line recognizes the app name only as part of an explicit Peon command. */
export const namesPeonSearch = (text: string) => /^(?:(?:confirm|cancel) )?peon job search(?:\s|$)/i.test(text.trim()) && !!peonSearchCommand(text);

export async function peonSearchCurrentOwner(tx: SQL, accounts: SearchAccounts, owner: MemberCommandOwner): Promise<boolean> {
  if (owner.app.id !== "peon") return false;
  // The signed runtime already holds the app state lock. Match the staff hold and phone-change owner order.
  const [locked] = await tx<{ id: string }[]>`select person.id::text as id from platform.people person
    join platform.phone_identities phone on phone.person_id=person.id and phone.e164=${owner.e164} and phone.hold is null
    where person.deleted_at is null for update of person for share of phone`;
  if (!locked) return false;
  const binding = await memberCommandOwner(tx, accounts, owner);
  if (!binding?.member || binding.person.id !== locked.id) return false;
  const hold = await currentStaffHold(tx, owner.app.id, binding.person.id);
  return peonSearchOwner(owner.app.id, true, !hold.local && !hold.global,
    canBeMatched(await accounts.lowestAge(owner.e164, binding.person)), binding.member.prefs.categoriesOptIn?.includes("professional") === true);
}

const help = "To draft a Peon job search, send something like PEON JOB SEARCH data analyst; level 2; minimum $85k; mode remote; skills sql=3. Add areas for onsite or hybrid work. You can also include start in weeks, sponsorship yes or no, and a private company to exclude.";
const stale = "That job search draft is no longer available. Send PEON JOB SEARCH to start again.";

function readBack(terms: CandidateTerms, reference: string): string {
  const lines = [
    `Job search: ${label(terms.role)}, level ${terms.level}.`,
    terms.floorCents ? `Minimum annual pay: ${dollars.format(terms.floorCents / 100)} USD.` : "No minimum annual pay.",
    `Work modes: ${terms.modes.join(", ")}.`,
  ];
  if (terms.areas.length) lines.push(`Commute areas: ${terms.areas.map(label).join(", ")}.`);
  if (terms.skills.length) lines.push(`Stated skills: ${terms.skills.map(skill => `${label(skill.id)} level ${skill.level}`).join(", ")}.`);
  // The recipient is the verified owner. Never put these labels in a match explanation or another person's text.
  if (terms.exclude.length) lines.push(`Private company exclusions: ${terms.exclude.map(label).join(", ")}.`);
  if (terms.sponsor !== undefined) lines.push(`Needs sponsorship: ${terms.sponsor ? "yes" : "no"}.`);
  if (terms.startWeeks !== undefined) lines.push(`Can start in ${terms.startWeeks} weeks.`);
  lines.push(`To save these details for matching, reply CONFIRM PEON JOB SEARCH ${reference}.`);
  return lines.join("\n");
}

async function saveSearch(tx: SQL, memberId: string, draft: DraftRow, now: number): Promise<void> {
  const at = new Date(now);
  const terms = draft.terms;
  const digest = createHash("sha256").update(draft.reference).digest("hex");
  await tx`update network.intents set status='closed' where app_id='peon' and member_id=${memberId}
    and details=${SEARCH_INTENT} and status<>'closed'`;
  await tx`insert into network.intents (app_id,id,member_id,objective,category,details,horizon_days,status,created_at)
    values ('peon',${`${memberId}:peon:search:${digest}`},${memberId},${`Find work as a ${label(terms.role)}`},'professional',${SEARCH_INTENT},${peonSearchHorizonDays},'active',${at})`;
  await tx`delete from network.facets where app_id='peon' and member_id=${memberId} and ${candidateSearchTag}=any(tags)`;
  const fact = (key: string, kind: string, value: string, tags: string[], scope = "matchable") => tx`insert into network.facets
    (app_id,id,member_id,kind,value,tags,privacy_scope,provenance,source,confidence,status,valid_from)
    values ('peon',${`${memberId}:peon:candidate:${key}`},${memberId},${kind},${value},${tx.array([...tags, candidateSearchTag], "TEXT")},${scope},'said','chat',0.9,'confirmed',${at})`;
  await fact("role", "goal", `Work as a ${label(terms.role)}, level ${terms.level}`, [`${T.entity}candidate`, `${T.family}${terms.role}`, `${T.seniority}${terms.level}`]);
  await fact("preference", "preference", "Confirmed work preferences", [
    `${T.floor}${terms.floorCents / 100_000}`,
    ...terms.modes.map(mode => `${T.mode}${mode}`), ...terms.areas.map(area => `${T.area}${area}`),
    ...(terms.sponsor === undefined ? [] : [`${T.needsSponsor}${terms.sponsor ? "yes" : "no"}`]),
    ...(terms.startWeeks === undefined ? [] : [`${T.start}${terms.startWeeks}`]),
  ]);
  for (const skill of terms.skills) await fact(skill.id, "skill", `${label(skill.id)} level ${skill.level}`, [`${T.skill}${skill.id}:${skill.level}`]);
  if (terms.exclude.length) await fact("companies", "boundary", "Private companies to exclude", terms.exclude.map(company => `${T.exclude}${company}`), "agent_private");
}

/** Runs in the signed reply transaction after acquiring the app's runtime lock. */
export async function applyPeonSearchCommand(tx: SQL, accounts: SearchAccounts, owner: MemberCommandOwner,
  command: SearchCommand, received: number, now: number): Promise<string | undefined> {
  if (!peonSearchTurnCurrent(received, now) || !await peonSearchCurrentOwner(tx, accounts, owner)) return;
  const id = owner.memberId;
  if (command.kind === "draft") {
    if (!command.terms) return help;
    const reference = newReference();
    await tx`insert into network.peon_candidate_search_drafts (app_id,member_id,reference,terms,staged_at)
      values ('peon',${id},${reference},${command.terms}::jsonb,${new Date(now)})
      on conflict (app_id,member_id) do update set reference=excluded.reference,terms=excluded.terms,staged_at=excluded.staged_at`;
    return readBack(command.terms, reference);
  }
  const [draft] = await tx<DraftRow[]>`select reference,terms,staged_at from network.peon_candidate_search_drafts
    where app_id='peon' and member_id=${id} for update`;
  if (!draft || !peonSearchConfirmable(draft.reference === command.reference, new Date(draft.staged_at).getTime(), received, now)) return stale;
  await tx`delete from network.peon_candidate_search_drafts where app_id='peon' and member_id=${id}`;
  if (command.kind === "cancel") return "I discarded that job search draft.";
  await saveSearch(tx, id, draft, now);
  return "I saved your Peon job search. I'll ask you before any introduction.";
}

export async function peonSearchReplyCurrent(tx: SQL, accounts: SearchAccounts, owner: MemberCommandOwner,
  command: SearchCommand, reply: string, now: number): Promise<boolean> {
  if (!await peonSearchCurrentOwner(tx, accounts, owner)) return false;
  if (command.kind !== "draft" || !command.terms) return true;
  const [draft] = await tx<DraftRow[]>`select reference,terms,staged_at from network.peon_candidate_search_drafts
    where app_id='peon' and member_id=${owner.memberId}`;
  return !!draft && peonSearchConfirmable(true, new Date(draft.staged_at).getTime(), now, now)
    && reply === readBack(draft.terms, draft.reference);
}

export async function purgePeonSearchDrafts(tx: SQL, now: number): Promise<void> {
  await tx`delete from network.peon_candidate_search_drafts where app_id='peon' and staged_at<=${new Date(now - peonSearchDraftMs)}`;
}
