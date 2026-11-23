import { canBeMatched, DAY, HOUR, type MemberId, type WorldSnapshot } from "@thenetwork/core";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import { availabilityProb, canInterrupt, canSendLogistics, standingFromFacets } from "../../engine/src/attention.ts";
import { resolveConfig, type EngineConfigInput } from "../../engine/src/config.ts";
import { localEmbed } from "../../engine/src/embed.ts";
import { memberReason, pairReason } from "../../engine/src/filters.ts";
import { validityIncludes } from "../../engine/src/interval.ts";
import { buildWorld, pairKey } from "../../engine/src/world.ts";
import type { Accounts } from "../../platform/src/accounts.ts";
import type { AppId, AppInfo } from "../../platform/src/apps.ts";
import type { HomeHelpAuthority, HomeHelpDraft } from "../src/bounded-help.ts";
import { ALLOWED_CATEGORIES, presentInNyc, storedInviteNoticePartyCurrent, type NetworkState } from "../src/network.ts";
import { NY, OUTREACH } from "../src/outreach.ts";
import { effectiveParticipation, loadSnapshot } from "./snapshot.ts";

export interface BoundedHomeHelpAuthorityDeps {
  accountsFor(tx: SQL): Accounts;
  appInfo(app: AppId): AppInfo;
  routeOfMember(app: AppId, homeCity: string): string | undefined;
  reviewerAuthorized: HomeHelpAuthority["reviewerAuthorized"];
  engineConfig?(app: AppId): EngineConfigInput | undefined;
  now(): number;
}

type PartyRow = Parameters<typeof effectiveParticipation>[0] & {
  id: string;
  person_id: string;
  home_city: string;
  e164: string;
  prefs: unknown;
};
type Party = { row: PartyRow; state: NetworkState; member: NetworkState["members"][number] };

function readState(input: unknown): NetworkState | undefined {
  let value = input;
  if (typeof input === "string") {
    try { value = JSON.parse(input); } catch { return; }
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || !("members" in value) || !Array.isArray(value.members)
    || !("opps" in value) || !Array.isArray(value.opps) || !("interactions" in value) || !Array.isArray(value.interactions)
    || !("feedback" in value) || !Array.isArray(value.feedback)
    || !("declinedIds" in value) || !Array.isArray(value.declinedIds) || !("blocks" in value) || !Array.isArray(value.blocks)
    || !("avoid" in value) || !Array.isArray(value.avoid) || !("trust" in value) || !Array.isArray(value.trust)) return;
  return value as NetworkState; // canonical serialization written by the owning Network runtime
}

/** Resolve the exact signed sender before any direct owner command or response replay. */
export async function boundedHomeHelpSenderCurrent(
  accounts: Pick<Accounts, "activeMembership" | "lowestAge">, app: AppInfo, sender: { memberId: string; e164: string },
): Promise<boolean> {
  if (!ALLOWED_CATEGORIES[app.id]?.includes("help")) return false;
  const bound = await accounts.activeMembership(app, { e164: sender.e164, personId: null });
  return bound?.membership.memberId === sender.memberId && canBeMatched(await accounts.lowestAge(sender.e164, bound.person));
}

function permitsHelp(prefs: unknown): prefs is { categoriesOptIn: unknown[]; formats?: unknown; onlyWhenAsked?: unknown } {
  return !!prefs && typeof prefs === "object" && "categoriesOptIn" in prefs
    && Array.isArray(prefs.categoriesOptIn) && prefs.categoriesOptIn.includes("help");
}

function availableForDraft(party: Party, draft: HomeHelpDraft, snapshot: WorldSnapshot, now: number): boolean {
  const { row, member, state } = party;
  if (!presentInNyc(snapshot, row.id, draft.startsAt, draft.endsAt)) return false;
  const { window } = effectiveParticipation(row, now);
  if (window && window.state !== "open" && (window.from === null || Date.parse(window.from) < draft.endsAt)
    && (window.until === null || Date.parse(window.until) > draft.startsAt)) return false;

  const booked = state.opps.filter(o => o.stage === "scheduled" && o.meetingAt !== undefined
    && o.status.some(([id, status]) => id === row.id && status === "yes"));
  const away = booked.flatMap(o => o.meetingAt === undefined ? [] : [{ start: o.meetingAt - 2 * HOUR, end: o.meetingAt + 3 * HOUR }]);
  const standing = standingFromFacets([
    ...snapshot.facets.filter(facet => facet.memberId === row.id),
    ...(member.standing ? [{ kind: "availability_pattern", tags: member.standing.tags, observedAt: member.standing.at }] : []),
    ...(member.availability ?? []).filter(a => now - a.at < 7 * DAY).map(a => ({ kind: "availability_pattern", tags: a.tags, observedAt: a.at })),
  ], now);
  // Availability evidence may rule out a window. It never records consent to this plan.
  return availabilityProb({ memberId: row.id, tz: NY, quietHours: member.quietHours, standing, history: member.availHistory, away },
    { start: draft.startsAt, end: draft.endsAt }, now) > 0;
}

function hasCapacity(party: Party, requester: boolean, now: number, ongoingConsent = false): boolean {
  const { row, member, state } = party;
  const conversation = { outboundSinceInbound: member.outbound ?? 0 };
  if (!ongoingConsent && !(requester ? canSendLogistics(conversation) : canInterrupt(conversation))) return false;
  if (state.opps.some(o => (o.stage === "review" || o.stage === "probing") && o.participants.includes(row.id)
    && !o.status.some(([id, status]) => id === row.id && ["unavailable", "no", "dropped"].includes(status)))) return false;
  if (requester || ongoingConsent) return true;
  const participation = effectiveParticipation(row, now).state;
  const budget = OUTREACH.budget[participation] ?? OUTREACH.budget.normal!;
  return !member.onlyWhenAsked && member.proactive.filter(at => now - at < budget.days * DAY).length < budget.n;
}

/** Require the attendance ledger to record both members at the same public meeting. */
async function attendedTogether(tx: SQL, app: AppId, requester: MemberId, helper: MemberId): Promise<boolean> {
  const rows = await tx<{ plan_id: string }[]>`select event->>'planId' as plan_id
    from network.capital_events where app_id=${app} and type='plan_attended' and event->'publicVenue'='true'::jsonb
    and event->>'planId' is not null and (
      (member_id=${requester} and event->'counterparts' @> jsonb_build_array(${helper}::text))
      or (member_id=${helper} and event->'counterparts' @> jsonb_build_array(${requester}::text))
    ) group by event->>'planId' having count(distinct member_id)=2 limit 1`;
  return rows.length > 0;
}

export function createBoundedHomeHelpAuthority(deps: BoundedHomeHelpAuthorityDeps): HomeHelpAuthority {
  async function currentParties(tx: SQL, app: AppId, ids: MemberId[], now: number): Promise<Party[] | undefined> {
    if (!ALLOWED_CATEGORIES[app]?.includes("help")) return;
    const rows = await tx<PartyRow[]>`select m.id,m.person_id,m.home_city,m.prefs,m.participation_state,m.participation_window,m.opted_out,
      (select ph.e164 from platform.phone_identities ph where ph.person_id=m.person_id and ph.hold is null
        order by ph.last_seen_at desc nulls last,ph.e164 limit 1) as e164
      from network.members m where m.app_id=${app} and m.id in ${tx(ids)} and m.account_status='active' and not m.opted_out`;
    if (rows.length !== ids.length) return;
    const routes = rows.map(row => row.home_city && deps.routeOfMember(app, row.home_city));
    if (routes.some(route => !route)) return;
    const stored = await tx<{ id: string; state: unknown }[]>`select id,state from network.network_state where id in ${tx([...new Set(routes)])}`;
    const states = new Map(stored.map(row => [row.id, readState(row.state)]));
    const accounts = deps.accountsFor(tx), info = deps.appInfo(app);
    const parties: Party[] = [];
    for (const [index, row] of rows.entries()) {
      const state = states.get(routes[index] ?? "");
      const member = state?.members.find(candidate => candidate.id === row.id);
      if (!state || !member || !row.person_id || !row.e164 || !permitsHelp(row.prefs)
        || effectiveParticipation(row, now).state === "paused" || member.stage === "new"
        || !storedInviteNoticePartyCurrent(state, row.id, now) || state.trust.some(trust => trust.id === row.id && trust.level !== "ok")) return;
      const binding = await accounts.activeMembership(info, { e164: row.e164, personId: row.person_id });
      if (binding?.membership.memberId !== row.id || !canBeMatched(await accounts.lowestAge(row.e164, binding.person))) return;
      parties.push({ row, state, member });
    }
    return parties;
  }

  return {
    ownerEligible: async (tx, owner) => !!await currentParties(tx, owner.app, [owner.requesterId], deps.now()),
    reviewerAuthorized: deps.reviewerAuthorized,
    rosterEligibility: async (tx, { owner, draft, helperIds, ongoingConsent }) => {
      const ineligible = { everyoneEligible: false, singletonPreviouslyMet: false };
      const ids = [owner.requesterId, ...helperIds];
      if (helperIds.length < 1 || helperIds.length > 3 || new Set(ids).size !== ids.length) return ineligible;
      const now = deps.now();
      const parties = await currentParties(tx, owner.app, ids, now);
      if (!parties || parties.some(party => !party.state.matchingEnabled)) return ineligible;
      const format = helperIds.length === 1 ? "one_to_one" : "small_group";
      const snapshot = await loadSnapshot(tx, now, { app: owner.app });
      const picked = new Set(ids);
      const members = snapshot.members.filter(member => picked.has(member.id));
      const facets = snapshot.facets.filter(facet => picked.has(facet.memberId));
      const edges = snapshot.edges.filter(edge => picked.has(edge.from) && picked.has(edge.to));
      const states = [...new Set(parties.map(party => party.state))];
      const interactions = states.flatMap(state => state.interactions);
      const feedback = states.flatMap(state => state.feedback).filter(entry => picked.has(entry.from) && picked.has(entry.about));
      const reliability = Object.fromEntries(parties.map(({ member }) => [member.id,
        { noShows: member.noShows, completedSinceLastNoShow: member.completedSinceNoShow }]));
      const world = buildWorld({ ...snapshot, members, facets, edges, interactions, feedback, reliability, intents: [], events: [] },
        resolveConfig(deps.engineConfig?.(owner.app)), localEmbed);

      for (const party of parties) {
        const id = party.row.id, requester = id === owner.requesterId;
        const member = world.get(id)?.m;
        if (!member || !Array.isArray(member.prefs.formats) || !member.prefs.formats.includes(format) || !availableForDraft(party, draft, snapshot, now)
          || !hasCapacity(party, requester, now, ongoingConsent)
          || memberReason(world, id, { category: "help", role: requester ? "seeker" : "helper", format, timeSensitive: true,
            ...(requester ? { ownIntentCreatedAt: now } : {}) })) return ineligible;
        // A skill or an inferred interest is not an offer to help with moving into or out of a home.
        if (!requester && !facets.some(facet => facet.memberId === id && facet.kind === "offer" && facet.provenance === "said"
          && facet.confirmedByMember && (facet.scope === "matchable" || facet.scope === "shareable")
          && facet.tags.includes("moving_help") && validityIncludes(facet, now))) return ineligible;
      }

      for (const [i, first] of ids.entries()) for (const second of ids.slice(i + 1)) {
        const key = pairKey(first, second);
        if (parties.some(party => party.state.blocks.includes(key) || party.state.avoid.includes(key))
          || pairReason(world, first, second, "help")) return ineligible;
      }
      const singleton = helperIds.length === 1 ? helperIds[0] : undefined;
      const singletonPreviouslyMet = !!singleton && (world.edgeHas(owner.requesterId, singleton, "met")
        || await attendedTogether(tx, owner.app, owner.requesterId, singleton));
      return { everyoneEligible: true, singletonPreviouslyMet };
    },
  };
}
