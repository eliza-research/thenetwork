// spec/profileFactEdit.md, "Confirmation must match the current draft and the unchanged saved fact".
import { afterAll, beforeAll, expect, test } from "vitest";
import { profileFactEditTtlMs } from "../../core/src/generated/profileFactEdit.ts";
import { SQL } from "../../core/src/runtime/postgres.ts";
import type { AppId } from "../../core/src/types.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { ProfileFactEdits, type ProfileFactChange } from "../service/profile-fact-edits.ts";

const at = Date.UTC(2026, 10, 16, 16);
const personId = "00000000-0000-0000-0000-000000000071";
const batchId = "00000000-0000-0000-0000-000000000072";
const suggestionId = "00000000-0000-0000-0000-000000000073";
const owner = { app: "ntwrk", memberId: "ntwrk-fact-owner" } as const;
const alternate = { app: "friends", memberId: "friends-fact-owner" } as const;
const original = "Legacy climbing interest";
const replacement = "Organic community gardening";
const legacyId = `${owner.memberId}:join:${original}`;
const sourceId = `source-suggestion:${suggestionId}`;
let now = at;
let url: string;
let sql: SQL;
const store = new ProfileFactEdits("integration-profile-fact-edits", () => now);

function scoped<T>(app: AppId, work: (tx: SQL) => Promise<T>): Promise<T> {
  return sql.begin(async tx => {
    await tx`set local role network_service`;
    await tx`select set_config('app.app_id',${app},true)`;
    return work(tx);
  });
}

if (pgAvailable) {
  beforeAll(async () => {
    url = await migratedDb("profile_fact_edits");
    sql = new SQL(url);
    await sql`insert into platform.people(id,lowest_age) values (${personId},32)`;
    await sql`insert into network.members (app_id,id,name,home_city,person_id) values
      (${owner.app},${owner.memberId},'Ari','nyc',${personId}),(${alternate.app},${alternate.memberId},'Ari','nyc',${personId})`;
    await sql`insert into platform.memberships (app_id,member_id,person_id,state) values (${owner.app},${owner.memberId},${personId},'active')`;
    await sql`insert into network.facets (app_id,id,member_id,kind,value,privacy_scope,provenance,source,tags) values
      (${owner.app},${legacyId},${owner.memberId},'interest',${original},'matchable','said','web_join',array['climbing']),
      (${owner.app},${sourceId},${owner.memberId},'goal','Read more books','matchable','inferred','gmail',array['reading']),
      (${owner.app},'safe-fact',${owner.memberId},'fact','Member-authored private fact','agent_private','said','chat','{}'),
      (${owner.app},'safe-skill',${owner.memberId},'skill','Baking','matchable','said','chat','{}'),
      (${owner.app},'safe-trait',${owner.memberId},'trait','Curious','matchable','said','chat','{}'),
      (${owner.app},'safety-policy',${owner.memberId},'fact','Staff-only validation','agent_private','vouched','staff',array['verify:age:fail']),
      (${owner.app},'job-policy',${owner.memberId},'skill','Internal hiring evidence','matchable','said','chat',array['peon:posting:private']),
      (${owner.app},'opportunity-policy',${owner.memberId},'fact','One opportunity only','opportunity_specific','said','chat','{}'),
      (${alternate.app},'friends-fact',${alternate.memberId},'interest','A different app','matchable','said','chat','{}')`;
    await sql`insert into platform.profile_suggestion_batches
      (id,app_id,person_id,member_id,user_id,organization_id,chat_id,created_at,expires_at,window_start,window_end,timezone,allowed_kinds,retain_on_disconnect)
      values (${batchId},${owner.app},${personId},${owner.memberId},'test-user','test-org','test-chat',
      ${new Date(at)},${new Date(at + 3_600_000)},${new Date(at - 3_600_000)},${new Date(at)},'America/New_York',array['goal'],false)`;
    await sql`insert into platform.profile_suggestions
      (id,batch_id,app_id,connection_id,source,observed_at,kind,confidence,original_value_hash,privacy_scope,status,fact_id)
      values (${suggestionId},${batchId},${owner.app},'test-connection','gmail',${new Date(at)},'goal',0.9,'old-value-digest','matchable','accepted',${sourceId})`;
  }, 120_000);
  afterAll(async () => {
    await sql?.close();
    if (url) await dropDb(url);
  });
}

test.skipIf(!pgAvailable)("fact edits need the exact owner and revision and clean private source evidence atomically", async () => {
  const first = await scoped(owner.app, tx => store.list(tx, owner));
  const tail = await scoped(owner.app, tx => store.list(tx, owner, 4));
  expect(first).toMatchObject({ hasMore: true });
  expect(first.facts).toHaveLength(4);
  expect(tail.facts.map(fact => fact.value)).toEqual(["Curious"]);
  expect(tail.hasMore).toBe(false);
  const ref = async (value: string) => {
    const seen = await scoped(owner.app, tx => store.list(tx, owner));
    const fact = seen.facts.find(row => row.value === value);
    if (!fact) throw new Error("Expected an editable profile fact");
    return fact.reference;
  };
  const stage = async (reference: string, change: ProfileFactChange) => {
    const draft = await scoped(owner.app, tx => store.stage(tx, owner, { reference, change }));
    if (!draft) throw new Error("Expected an edit draft");
    return draft;
  };
  const firstRef = await ref(original);
  expect(firstRef).toMatch(/^pfr_[a-p]{32}$/);
  expect(await scoped(alternate.app, tx => store.stage(tx, alternate, { reference: firstRef, change: { kind: "remove" } }))).toBeUndefined();

  const stale = await stage(firstRef, { kind: "correct", value: replacement });
  const [saved] = await sql<{ draft: string }[]>`select d::text as draft from platform.profile_fact_edit_drafts d`;
  expect(saved?.draft).toBeDefined();
  expect(saved?.draft).not.toContain(original);
  expect(saved?.draft).not.toContain(replacement);
  expect(saved?.draft).not.toContain(stale.code);
  expect(await scoped(alternate.app, tx => store.confirm(tx, alternate, stale.code))).toBeUndefined();
  await sql`update network.facets set revision=revision+1 where id=${legacyId}`;
  expect(await scoped(owner.app, tx => store.stageIsCurrent(tx, owner, stale.code))).toBe(false);
  expect(await scoped(owner.app, tx => store.confirm(tx, owner, stale.code))).toBeUndefined();
  expect(await sql`select member_id from platform.profile_fact_edit_drafts`).toHaveLength(0);

  const current = await stage(await ref(original), { kind: "correct", value: replacement });
  await expect(scoped(owner.app, async tx => {
    await store.confirm(tx, owner, current.code);
    throw new Error("Could not commit the signed receipt");
  })).rejects.toThrow("Could not commit the signed receipt");
  const applied = await scoped(owner.app, tx => store.confirm(tx, owner, current.code));
  expect(applied).toMatchObject({ fact: { id: legacyId, value: original, signupInterest: true }, previousTags: ["climbing"], change: { kind: "correct", value: replacement } });
  expect(await sql`select id from network.facets where id=${legacyId}`).toHaveLength(0);
  expect(await scoped(owner.app, tx => store.confirm(tx, owner, current.code))).toBeUndefined();
  const remove = await stage(await ref(replacement), { kind: "remove" });
  expect(await scoped(owner.app, tx => store.confirm(tx, owner, remove.code))).toMatchObject({ fact: { signupInterest: true, value: replacement }, previousTags: [] });
  expect(await sql`select id from network.facets where value=${replacement}`).toHaveLength(0);

  const narrow = await stage(await ref("Read more books"), { kind: "scope", scope: "agent_private" });
  expect(await scoped(owner.app, tx => store.confirm(tx, owner, narrow.code))).toMatchObject({ previousTags: ["reading"] });
  expect(await sql`select fact_id,status from platform.profile_suggestions where id=${suggestionId}`).toEqual([{ fact_id: sourceId, status: "accepted" }]);
  const editSource = await stage(await ref("Read more books"), { kind: "correct", value: "Bookbinding" });
  expect(await scoped(owner.app, tx => store.confirm(tx, owner, editSource.code))).toMatchObject({ previousTags: [] });
  expect(await sql`select fact_id,status,original_value_hash,value,tags from platform.profile_suggestions where id=${suggestionId}`)
    .toEqual([{ fact_id: null, status: "withdrawn", original_value_hash: "", value: null, tags: [] }]);
  expect(await sql`select revision from platform.profile_suggestion_batches where id=${batchId}`).toEqual([{ revision: 2 }]);
  expect(await sql`select privacy_scope,provenance,source from network.facets where value='Bookbinding'`)
    .toEqual([{ privacy_scope: "agent_private", provenance: "said", source: "chat" }]);

  const expired = await stage(await ref("Baking"), { kind: "remove" });
  now += profileFactEditTtlMs;
  expect(await scoped(owner.app, tx => store.confirm(tx, owner, expired.code))).toBeUndefined();
  const pending = await stage(await ref("Baking"), { kind: "remove" });
  await sql`update platform.memberships set state='removed' where app_id=${owner.app} and member_id=${owner.memberId}`;
  expect(await scoped(owner.app, tx => store.stageIsCurrent(tx, owner, pending.code))).toBe(false);
  expect(await sql`select member_id from platform.profile_fact_edit_drafts`).toHaveLength(0);
});
