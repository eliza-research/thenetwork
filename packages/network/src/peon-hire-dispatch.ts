import { createHash } from "node:crypto";
import { isBusinessDomain, type Facet, type Intent, type MemberId } from "@thenetwork/core";
import { hireEvidenceCurrent } from "../../core/src/generated/peonHireDispatch.ts";
import { standingIntentLive } from "../../core/src/standing-intent.ts";
import { JOB_INTENT, SAFETY, SEARCH_INTENT, T } from "../../engine/src/packs/peon/schema.ts";
import { isSeatId, postingIdOf } from "./jobs.ts";

export interface HireSeat {
  id: MemberId;
  manager: MemberId;
  /** Legacy reviews without this exact source cannot authorize new contact. */
  evidence?: Pick<HireEvidence, "search" | "posting">;
}

interface HireEvidence {
  search?: string;
  posting?: string;
  verified: boolean;
  companyAllowed: boolean;
}

type Records = { intents: readonly Intent[]; facets: readonly Facet[] };
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const ordered = (items: readonly string[]) => [...new Set(items)].sort();
const current = (fact: Facet, now: number) => (fact.validFrom === undefined || fact.validFrom <= now)
  && (fact.validTo === undefined || now <= fact.validTo);
const matchable = (fact: Facet) => fact.scope === "matchable" || fact.scope === "shareable";
const searchFields = [T.entity, T.family, T.seniority, T.skill, T.demonstrated, T.floor, T.mode, T.area, T.auth, T.needsSponsor, T.cred, T.start];
const postingFields = [T.family, T.seniority, T.pay, T.mode, T.market, T.area, T.must, T.nice, T.sponsors, T.credRequired, T.fillBy];

/** Project review evidence from either the job seat snapshot or the manager's persisted rows. */
export function readHireEvidence(records: Records, seat: HireSeat, candidate: MemberId, now: number, projected: boolean): HireEvidence {
  const absent = { verified: false, companyAllowed: false };
  if (!isSeatId(seat.id) || seat.manager === candidate) return absent;
  const postingId = postingIdOf(seat.id), postingOwner = projected ? seat.id : seat.manager;
  const exactApp = (row: Intent | Facet) => row.app === undefined || isBusinessDomain(row.app);
  const posting = records.intents.find(intent => intent.id === postingId && intent.memberId === postingOwner && exactApp(intent)
    && intent.category === "professional" && intent.details?.startsWith(JOB_INTENT) && standingIntentLive(intent, now));
  const searches = records.intents.filter(intent => intent.memberId === candidate && exactApp(intent)
    && intent.category === "professional" && intent.details?.startsWith(SEARCH_INTENT) && standingIntentLive(intent, now));
  const facts = records.facets.filter(fact => exactApp(fact) && current(fact, now));
  const candidateFacts = facts.filter(fact => fact.memberId === candidate);
  const candidateTags = candidateFacts.filter(matchable).flatMap(fact => fact.tags);
  const goal = searches.length === 1 && candidateTags.includes(`${T.entity}candidate`) ? searches[0] : undefined;
  const employerFacts = facts.filter(fact => fact.memberId === postingOwner);
  const employerTags = employerFacts.filter(matchable).flatMap(fact => fact.tags);
  const companies = ordered(employerTags.filter(tag => tag.startsWith(T.company)).map(tag => tag.slice(T.company.length)));
  const company = companies.length === 1 ? companies[0] : undefined;
  const approvedTerms = employerFacts.filter(fact => matchable(fact) && fact.tags.includes(`${T.posting}${postingId}`))
    .flatMap(fact => fact.tags).filter(tag => postingFields.some(prefix => tag.startsWith(prefix)));
  const openings = employerFacts.filter(fact => matchable(fact) && (projected ? fact.id === `${seat.id}:openings` : fact.tags.includes(`${T.posting}${postingId}`)))
    .flatMap(fact => fact.tags).filter(tag => tag.startsWith(T.openings));
  // A private boundary can block contact but is never itself part of the posting or reveal.
  const excluded = !!company && candidateFacts.some(fact => (matchable(fact) || (fact.kind === "boundary" && fact.scope === "agent_private"))
    && fact.tags.includes(`${T.exclude}${company}`));
  return {
    ...(goal ? { search: digest([goal.id, goal.createdAt, ordered(candidateTags.filter(tag => searchFields.some(prefix => tag.startsWith(prefix))))]) } : {}),
    ...(posting && approvedTerms.some(tag => tag.startsWith(T.pay)) ? {
      posting: digest([posting.id, posting.objective, posting.createdAt, company, ordered(approvedTerms), ordered(openings)]),
    } : {}),
    verified: !!company && employerTags.includes(T.verified)
      && !employerFacts.some(fact => (matchable(fact) || fact.scope === "agent_private") && fact.tags.includes(SAFETY.scam)),
    companyAllowed: !excluded,
  };
}

export function hireSeatCurrent(seat: HireSeat, current: HireEvidence): boolean {
  return hireEvidenceCurrent(!!current.search, !!seat.evidence?.search && seat.evidence.search === current.search,
    !!seat.evidence?.posting && seat.evidence.posting === current.posting, current.verified, current.companyAllowed);
}
