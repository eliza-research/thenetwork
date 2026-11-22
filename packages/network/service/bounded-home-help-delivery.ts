import type { SQL } from "../../core/src/runtime/postgres.ts";
import type { AppId } from "../../platform/src/apps.ts";
import type { BoundedHomeHelpConsent, HomeHelpConsentKey } from "../src/bounded-home-help-consent.ts";
import { boundedHomeHelpConsentCard } from "./bounded-home-help-consent-command.ts";
import { BlooioAdapter } from "./channel.ts";
import type { NetworkRuntime } from "./runtime.ts";

const NOTICE_PREFIX = "home-help-consent:";
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

export function homeHelpNoticeId(deliveryId: string): string | undefined {
  if (!deliveryId.startsWith(NOTICE_PREFIX)) return;
  const id = deliveryId.slice(NOTICE_PREFIX.length);
  if (UUID.test(id)) return id;
}

/** Lock the plan's people in the same order as approval before the queue locks the recipient. */
export async function lockHomeHelpNoticeRoster(tx: SQL, app: AppId, noticeId: string, recipient: string): Promise<void> {
  await tx`select person.id from network.bounded_home_help_consent notice
    join network.bounded_home_help plan on plan.app_id=notice.app_id and plan.id=notice.plan_id and plan.revision=notice.revision
    join platform.memberships member on member.app_id=plan.app_id and (member.member_id=plan.requester_id or member.member_id=any(plan.helper_ids))
    join platform.people person on person.id=member.person_id
    where notice.app_id=${app} and notice.notice_id=${noticeId} and notice.recipient_id=${recipient}
    order by person.id for update of person`;
}

/** Restore accepted deliveries from the durable provider receipt, including a worker restart. */
export async function reconcileHomeHelpDelivery(tx: SQL, store: BoundedHomeHelpConsent, app: AppId, recipient?: string, plan?: HomeHelpConsentKey): Promise<void> {
  const rows = await tx<{ notice_id: string; recipient_id: string; sent_at: Date }[]>`select c.notice_id,c.recipient_id,o.sent_at
    from network.bounded_home_help_consent c join platform.outbound o on o.app_id=c.app_id and o.member_id=c.recipient_id
      and o.id=${NOTICE_PREFIX} || c.notice_id::text
    where c.app_id=${app} and c.phase='Pending' and o.sent_at is not null
      and o.status in ('accepted','sent','delivered','read') and jsonb_typeof(o.provider_message_ids)='array' and o.provider_message_ids<>'[]'::jsonb
      and (${recipient ?? null}::text is null or c.recipient_id=${recipient ?? null})
      and (${plan?.id ?? null}::uuid is null or (c.plan_id=${plan?.id ?? null} and c.revision=${plan?.revision ?? null}))
    order by o.sent_at,o.id limit 20`;
  for (const row of rows) await store.recordSentById(tx, app, row.notice_id, row.recipient_id, row.sent_at.getTime());
}

/** An approval from before this worker started gets the same consent cycle as a new approval. */
export async function stageApprovedHomeHelp(rt: NetworkRuntime, store: BoundedHomeHelpConsent, now: number): Promise<void> {
  const app = rt.app.id;
  const keys = await rt.scoped(tx => tx<{ id: string; revision: number }[]>`select p.id,p.revision from network.bounded_home_help p
    where p.app_id=${app} and p.phase='Approved' and p.expires_at>${new Date(now)} and not exists (
      select 1 from network.bounded_home_help_consent c where c.app_id=p.app_id and c.plan_id=p.id and c.revision=p.revision)
    order by p.expires_at,p.id limit 20`);
  for (const key of keys) await rt.scoped(tx => store.stage(tx, { app, ...key }));
}

/** The actual recipient runtime is the sole owner of its outreach counters and stable queue row. */
export async function queueReviewedHomeHelp(rt: NetworkRuntime, store: BoundedHomeHelpConsent, homes: readonly string[], now: number): Promise<void> {
  if (!(rt.adapter instanceof BlooioAdapter) || !rt.adapter.live) return;
  const app = rt.app.id;
  const candidates = await rt.scoped(tx => tx<{ notice_id: string; recipient_id: string }[]>`select c.notice_id,c.recipient_id
    from network.bounded_home_help_consent c join network.bounded_home_help p on p.app_id=c.app_id and p.id=c.plan_id and p.revision=c.revision
    join network.members member on member.app_id=c.app_id and member.id=c.recipient_id
    where c.app_id=${app} and c.phase='Pending' and p.phase='Approved' and p.expires_at>${new Date(now)} and member.home_city in ${tx([...homes])}
      and (c.recipient_id=p.requester_id or exists (select 1 from network.bounded_home_help_consent owner
        where owner.app_id=c.app_id and owner.plan_id=c.plan_id and owner.revision=c.revision and owner.recipient_id=p.requester_id and owner.phase='Accepted'))
      and not exists (select 1 from network.messages m where m.app_id=c.app_id and m.id=${NOTICE_PREFIX} || c.notice_id::text)
    order by p.expires_at,c.notice_id limit 20`);
  for (const { notice_id: id, recipient_id: recipient } of candidates) await rt.unitOfWork(async net => {
    const deliveryId = `${NOTICE_PREFIX}${id}`;
    const notice = await rt.scoped(async tx => {
      const [stored] = await tx`select 1 from network.messages where app_id=${app} and id=${deliveryId}`;
      if (!stored) return store.pendingNoticeById(tx, app, id, recipient);
    });
    if (!notice || !rt.addressOf(recipient)) return;
    net.askReviewedHomeHelpConsent({ recipientId: recipient, role: notice.role, deliveryId, body: boundedHomeHelpConsentCard(notice) });
  });
}
