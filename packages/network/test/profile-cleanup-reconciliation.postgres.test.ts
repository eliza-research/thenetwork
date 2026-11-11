/** Real Bun SQL + canonical migrations on an explicitly supplied synthetic database.
 * Only Cloud owner/proof/currentness boundaries are controlled. No dev cluster bootstrap.
 * Actual Google revocation/reconnection authority remains the external Cloud proof boundary;
 * these tests do not prove that provider lifecycle, and V2 deliberately needs no OAuth grant. */
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { SQL } from "bun";
import { createHash, randomUUID } from "node:crypto";
import { applySchema } from "../../observatory/db/dev-pg.ts";
import {
	ProfileSuggestions,
	type SuggestionOwner,
} from "../service/profile-suggestions.ts";
import type {
	ProfileReviewDisconnectRequest,
	ProfileReviewDisconnectProof,
} from "../../core/src/svc/profile-review-disconnect.ts";
import type {
	ProfileReviewWithdrawalRequest,
	ProfileReviewWithdrawalProof,
} from "../../core/src/svc/profile-review-withdrawal.ts";

// The suite runs in every integration run. Without NETWORK_RETRY_POSTGRES_URL it makes its own empty
// database on the dev Postgres (127.0.0.1:54339) and removes it, and its synthetic login, at the end.
const cluster = `postgres://${process.env.USER ?? "postgres"}@127.0.0.1:54339`;
let owned: string | undefined;
const now = Date.UTC(2026, 9, 21, 12),
	cutoff = now - 1000;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
let admin: SQL, runtime: SQL, url: string, runtimeUrl: string;
let owner: SuggestionOwner, connectionId: string, memberId: string;
let role: string;

async function person(app: "friends" | "slop", suffix: string) {
	const value: SuggestionOwner = {
		app,
		personId: randomUUID(),
		userId: randomUUID(),
		organizationId: randomUUID(),
		chatId: `personal:${randomUUID()}`,
	};
	const member = `reconcile-${suffix}`;
	await admin`insert into platform.people(id,lowest_age,phone_hash) values(${value.personId},30,${`retry-phone-${suffix}`})`;
	await admin`insert into platform.memberships(person_id,app_id,member_id,state,first_name,profile)
    values(${value.personId},${app},${member},'active','Synthetic','{}')`;
	await admin`insert into network.members(id,app_id,person_id,name,age,home_city,account_status)
    values(${member},${app},${value.personId},'Synthetic',30,'nyc','active')`;
	return { owner: value, memberId: member };
}

async function seed(
	who = owner,
	conn = connectionId,
	retain = false,
	accepted = false,
	createdAt = now - 2000,
) {
	const storage = new ProfileSuggestions(admin, async () => true);
	const batch = await storage.propose(
		who,
		{
			windowStart: createdAt - 5000,
			windowEnd: createdAt,
			timezone: "UTC",
			expiresAt: now + 60000,
			retainOnDisconnect: retain,
			allowedKinds: ["interest"],
			suggestions: [
				{
					connectionId: conn,
					source: "gmail",
					observedAt: createdAt - 1000,
					kind: "interest",
					value: "I enjoy climbing",
					tags: ["climbing"],
					confidence: 0.8,
					scope: "agent_private",
				},
			],
		},
		createdAt,
	);
	expect(batch).not.toBeNull();
	if (!batch) throw Error("SYNTHETIC_BATCH_SETUP_FAILED");
	if (accepted)
		expect(
			(
				await storage.decide(
					who,
					{
						batchId: batch.id,
						revision: batch.revision,
						decisions: [
							{ suggestionId: batch.suggestions[0]!.id, action: "accept" },
						],
					},
					createdAt,
				)
			).kind,
		).toBe("saved");
	return batch;
}

function store(
	authorizeOwner: (who: SuggestionOwner) => Promise<boolean> = async () => true,
) {
	return new ProfileSuggestions(
		runtime,
		async () => {
			throw Error("ACTIVE_SOURCE_AUTH_MUST_NOT_RUN");
		},
		authorizeOwner,
		{ now: () => now, valid: () => true },
	);
}
function v1(
	who = owner,
	member = memberId,
	conn = connectionId,
	nonce = randomUUID(),
) {
	const request: ProfileReviewDisconnectRequest = {
		version: 1,
		operation: "disconnect",
		app: who.app,
		personId: who.personId,
		memberId: member,
		connectionId: conn,
		revokedEventId: `fixture-revoked:${randomUUID()}`,
		requestNonce: nonce,
	};
	const proof: ProfileReviewDisconnectProof = {
		...request,
		purpose: "network-profile-review-revoked-owner-v1",
		requestSha256: sha(JSON.stringify(request)),
		userId: who.userId,
		organizationId: who.organizationId,
		chatId: who.chatId,
		connectionState: "revoked",
		revokedAt: cutoff,
		issuedAt: now,
		expiresAt: now + 10000,
	};
	return { request, proof };
}
async function v2(operation: "withdraw" | "delete" = "withdraw") {
	const messageId = `fixture-${randomUUID()}`,
		text =
			operation === "withdraw"
				? "stop google learning"
				: "delete google learning";
	const request: ProfileReviewWithdrawalRequest = {
		version: 2,
		operation,
		app: owner.app,
		personId: owner.personId,
		memberId,
		connectionId,
		withdrawalId: randomUUID(),
		requestNonce: randomUUID(),
	};
	await admin`insert into platform.inbound(id,received_at,arrived_at,status,sender_hash,response,request_hash)
    values(${`msg:blooio:${messageId}`},${new Date(now - 4000)},${new Date(now - 3000)},'done','retry-phone-one',
      ${{ outcome: "open", app: owner.app, memberId }}::jsonb,${sha(`original:${messageId}`)})`;
	await admin`insert into network.messages(id,app_id,member_id,direction,body,ts)
    values(${`in:blooio:${messageId}`},${owner.app},${memberId},'inbound',${text},${new Date(now - 4000)})`;
	const proof: ProfileReviewWithdrawalProof = {
		...request,
		purpose: "network-profile-review-withdrawal-v2",
		requestSha256: sha(JSON.stringify(request)),
		userId: owner.userId,
		organizationId: owner.organizationId,
		chatId: owner.chatId,
		cutoffAt: cutoff,
		issuedAt: now,
		expiresAt: now + 10000,
		channel: "blooio",
		messageId,
		commandSha256: sha(text),
	};
	return {
		request,
		proof,
		turnId: `msg:blooio:${messageId}`,
		receiptKey: `profile-withdrawal-v2:${request.withdrawalId}`,
	};
}
async function snapshot() {
	// PostgreSQL encodes complete rows and physical REAL bits before the driver
	// decodes them, so text/binary wire formats cannot change an unchanged snapshot.
	const [row] = await admin`select jsonb_build_object(
		'batches', (select coalesce(jsonb_agg(to_jsonb(b) order by b.id), '[]'::jsonb)
			from platform.profile_suggestion_batches b),
		'suggestions', (select coalesce(jsonb_agg(to_jsonb(s) order by s.id), '[]'::jsonb)
			from platform.profile_suggestions s),
		'facets', (select coalesce(jsonb_agg(to_jsonb(f) order by f.app_id,f.id), '[]'::jsonb)
			from network.facets f),
		'receipts', (select coalesce(jsonb_agg(to_jsonb(r) order by r.request_nonce), '[]'::jsonb)
			from platform.profile_suggestion_connection_receipts r),
		'inbound', (select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'action_receipts',i.action_receipts)
			order by i.id), '[]'::jsonb) from platform.inbound i),
		'confidence_bits', jsonb_build_object(
			'suggestions', (select coalesce(jsonb_agg(jsonb_build_object('id',s.id,
				'bits',encode(float4send(s.confidence),'hex')) order by s.id), '[]'::jsonb)
				from platform.profile_suggestions s),
			'facets', (select coalesce(jsonb_agg(jsonb_build_object('app_id',f.app_id,'id',f.id,
				'bits',encode(float4send(f.confidence),'hex')) order by f.app_id,f.id), '[]'::jsonb)
				from network.facets f)
		)
	)::text as snapshot`;
	return row.snapshot as string;
}

describe("isolated PostgreSQL completed cleanup reconciliation", () => {
	beforeAll(async () => {
		let raw = process.env.NETWORK_RETRY_POSTGRES_URL;
		if (!raw) {
			owned = `network_retry_${randomUUID().replaceAll("-", "")}`;
			const root = new SQL({ url: `${cluster}/postgres`, max: 1 });
			await root.unsafe(`create database ${owned}`);
			await root.close();
			raw = `${cluster}/${owned}`;
		}
		const parsed = new URL(raw);
		if (
			!["postgres:", "postgresql:"].includes(parsed.protocol) ||
			parsed.hostname !== "127.0.0.1" ||
			!/^\/network_retry_[a-f0-9]{8,40}$/.test(parsed.pathname)
		)
			throw Error("Refusing non-isolated retry database");
		url = parsed.href;
		admin = new SQL({
			url,
			max: 6,
			connection: { application_name: "network-retry-admin" },
		});
		if (
			(
				await admin`select tablename from pg_tables where schemaname in ('platform','network','notify')`
			).length
		)
			throw Error("Retry fixture database must start empty");
		await applySchema(url, { reset: false, lockTimeout: "5s" });
		role = `network_retry_${parsed.pathname.slice("/network_retry_".length)}`;
		// Canonical network_service grants/RLS are inherited by a synthetic login, never a superuser.
		await admin.unsafe(
			`create role ${role} login password 'synthetic_retry_only' nosuperuser nobypassrls inherit; grant network_service to ${role}`,
		);
		parsed.username = role;
		parsed.password = "synthetic_retry_only";
		runtimeUrl = parsed.href;
	}, 30000);
	beforeEach(async () => {
		if (runtime) await runtime.close();
		await applySchema(url, { reset: true, lockTimeout: "5s" });
		runtime = new SQL({
			url: runtimeUrl,
			max: 4,
			connection: { application_name: "network-retry-runtime" },
		});
		({ owner, memberId } = await person("friends", "one"));
		connectionId = randomUUID();
	}, 30000);
	afterAll(async () => {
		const results = await Promise.allSettled([
			runtime?.close(),
			admin?.close(),
		]);
		const failed = results.filter((result) => result.status === "rejected");
		if (failed.length)
			throw new AggregateError(
				failed,
				"Retry fixture connections did not close",
			);
		if (owned) {
			const root = new SQL({ url: `${cluster}/postgres`, max: 1 });
			await root.unsafe(`drop database ${owned}`);
			await root.unsafe(`drop role if exists ${role}`);
			await root.close();
		}
	});

	test("V2 exact retry returns the original counts after profile removal and newer batches without any mutation", async () => {
		const accepted = await seed(owner, connectionId, true, true);
		await seed();
		const f = await v2();
		const storage = store();
		const first = await storage.applyOwnerWithdrawal(
			owner,
			f.request,
			f.proof,
			() => true,
		);
		expect(first).toEqual({ pending: 0, retainedAccepted: 1, linkedFacts: 1 });
		await admin`delete from network.facets where id=${`source-suggestion:${accepted.suggestions[0]!.id}`}`;
		await seed(owner, connectionId, false, false, now + 1000);
		const before = await snapshot();
		expect(
			await storage.applyOwnerWithdrawal(owner, f.request, f.proof, () => true),
		).toEqual(first);
		expect(await snapshot()).toBe(before);
	});

	test("V1 exact retry returns its original retention result after later edits without rerunning cleanup", async () => {
		const retained = await seed(owner, connectionId, true, true);
		await seed(owner, connectionId, false, true);
		await seed();
		const f = v1(),
			storage = store();
		const first = await storage.applyRevokedConnection(
			owner,
			f.request,
			f.proof,
			() => true,
		);
		expect(first).toEqual({ pending: 0, retainedAccepted: 1, linkedFacts: 1 });
		await admin`delete from network.facets where id=${`source-suggestion:${retained.suggestions[0]!.id}`}`;
		await seed(owner, connectionId, false, true, now + 1000);
		const before = await snapshot();
		expect(
			await storage.applyRevokedConnection(
				owner,
				f.request,
				f.proof,
				() => true,
			),
		).toEqual(first);
		expect(await snapshot()).toBe(before);
		// A distinct, freshly authorized readback is a new operation, not another
		// nonce's cached response. Repeating readback with another nonce stays valid.
		for (let index = 0; index < 2; index++) {
			const request = {
				...f.request,
				operation: "readback" as const,
				requestNonce: randomUUID(),
			};
			const proof = {
				...f.proof,
				...request,
				requestSha256: sha(JSON.stringify(request)),
			};
			expect(
				await storage.applyRevokedConnection(owner, request, proof, () => true),
			).toEqual({ pending: 0, retainedAccepted: 1, linkedFacts: 0 });
		}
	});

	test("changed completed identity hash operation cutoff nonce and stale proof deny without touching either protocol", async () => {
		await seed(owner, connectionId, true, true);
		await seed();
		const one = v1(),
			two = await v2(),
			storage = store();
		expect(
			await storage.applyRevokedConnection(
				owner,
				one.request,
				one.proof,
				() => true,
			),
		).not.toBeNull();
		expect(
			await storage.applyOwnerWithdrawal(
				owner,
				two.request,
				two.proof,
				() => true,
			),
		).not.toBeNull();
		const before = await snapshot();
		for (const patch of [
			{ requestSha256: sha("changed body") },
			{ revokedAt: cutoff + 1 },
			{ expiresAt: now - 1 },
		])
			expect(
				await storage.applyRevokedConnection(
					owner,
					one.request,
					{ ...one.proof, ...patch },
					() => true,
				),
			).toBeNull();
		const differentOperation = { ...one.request, operation: "delete" as const };
		expect(
			await storage.applyRevokedConnection(
				owner,
				differentOperation,
				{
					...one.proof,
					...differentOperation,
					requestSha256: sha(JSON.stringify(differentOperation)),
				},
				() => true,
			),
		).toBeNull();
		const differentOwner = { ...owner, userId: randomUUID() };
		expect(
			await storage.applyRevokedConnection(
				differentOwner,
				one.request,
				{ ...one.proof, userId: differentOwner.userId },
				() => true,
			),
		).toBeNull();
		const differentNonce = { ...two.request, requestNonce: randomUUID() };
		expect(
			await storage.applyOwnerWithdrawal(
				owner,
				differentNonce,
				{
					...two.proof,
					...differentNonce,
					requestSha256: sha(JSON.stringify(differentNonce)),
				},
				() => true,
			),
		).toBeNull();
		for (const patch of [
			{ requestSha256: sha("changed V2 body") },
			{ cutoffAt: cutoff + 1 },
			{ expiresAt: now - 1 },
		])
			expect(
				await storage.applyOwnerWithdrawal(
					owner,
					two.request,
					{ ...two.proof, ...patch },
					() => true,
				),
			).toBeNull();
		const ownerUnavailable = store(async () => false);
		expect(
			await ownerUnavailable.applyRevokedConnection(
				owner,
				one.request,
				one.proof,
				() => true,
			),
		).toBeNull();
		expect(
			await ownerUnavailable.applyOwnerWithdrawal(
				owner,
				two.request,
				two.proof,
				() => true,
			),
		).toBeNull();
		expect(await snapshot()).toBe(before);
		await admin`update network.messages set body='changed stored command' where id=${`in:blooio:${two.proof.messageId}`}`;
		const afterBodyChange = await snapshot();
		expect(
			await storage.applyOwnerWithdrawal(
				owner,
				two.request,
				two.proof,
				() => true,
			),
		).toBeNull();
		expect(await snapshot()).toBe(afterBodyChange);
	});

	test("legacy and partial completions deny while the canonical runtime receipt ACL remains SELECT INSERT only", async () => {
		const [acl] =
			await runtime`select current_user as role, has_table_privilege(current_user,'platform.profile_suggestion_connection_receipts','SELECT') as can_select,
      has_table_privilege(current_user,'platform.profile_suggestion_connection_receipts','INSERT') as can_insert,
      has_table_privilege(current_user,'platform.profile_suggestion_connection_receipts','UPDATE') as can_update`;
		expect(acl).toMatchObject({
			role,
			can_select: true,
			can_insert: true,
			can_update: false,
		});
		await seed();
		const one = v1(),
			two = await v2(),
			storage = store();
		await admin`insert into platform.profile_suggestion_connection_receipts(request_nonce,request_hash,event_id,operation,app_id,person_id,member_id,user_id,organization_id,chat_id,connection_id,revoked_at)
      values(${one.request.requestNonce},${one.proof.requestSha256},${one.request.revokedEventId},'disconnect',${owner.app},${owner.personId},${memberId},${owner.userId},${owner.organizationId},${owner.chatId},${connectionId},${new Date(cutoff)})`;
		let before = await snapshot();
		expect(
			await storage.applyRevokedConnection(
				owner,
				one.request,
				one.proof,
				() => true,
			),
		).toBeNull();
		expect(await snapshot()).toBe(before);
		for (const counts of [
			{ pending: 0 },
			{ pending: -1, retainedAccepted: 0, linkedFacts: 0 },
			{ pending: 0.5, retainedAccepted: 0, linkedFacts: 0 },
			{ pending: 0, retainedAccepted: 0, linkedFacts: 0, unexpected: 0 },
		]) {
			await admin`update platform.profile_suggestion_connection_receipts set result=${{ version: 1, purpose: "network-profile-review-revoked-owner-v1", counts }}::jsonb where request_nonce=${one.request.requestNonce}`;
			before = await snapshot();
			expect(
				await storage.applyRevokedConnection(
					owner,
					one.request,
					one.proof,
					() => true,
				),
			).toBeNull();
			expect(await snapshot()).toBe(before);
		}
		await admin`update platform.inbound set action_receipts=${{ [two.receiptKey]: { state: "completed", version: 2 } }}::jsonb where id=${two.turnId}`;
		before = await snapshot();
		expect(
			await storage.applyOwnerWithdrawal(
				owner,
				two.request,
				two.proof,
				() => true,
			),
		).toBeNull();
		expect(await snapshot()).toBe(before);
	});

	test("post-write owner loss rolls profile data and completion receipts back together for V1 and V2", async () => {
		await seed(owner, connectionId, false, true);
		await seed();
		const one = v1(),
			two = await v2("delete");
		for (const protocol of [1, 2]) {
			let calls = 0;
			const storage = store(async () => ++calls === 1);
			const before = await snapshot();
			const result =
				protocol === 1
					? await storage.applyRevokedConnection(
							owner,
							one.request,
							one.proof,
							() => true,
						)
					: await storage.applyOwnerWithdrawal(
							owner,
							two.request,
							two.proof,
							() => true,
						);
			expect(result).toBeNull();
			expect(calls).toBe(2);
			expect(await snapshot()).toBe(before);
		}
	});

	test("concurrent cross-app owners sharing one V1 nonce commit once and roll the losing profile back", async () => {
		const other = await person("slop", "two"),
			otherConnection = randomUUID();
		const firstBatch = await seed(owner, connectionId, false, true),
			secondBatch = await seed(other.owner, otherConnection, false, true);
		const nonce = randomUUID(),
			one = v1(owner, memberId, connectionId, nonce),
			two = v1(other.owner, other.memberId, otherConnection, nonce);
		let admitted = 0,
			release!: () => void;
		const barrier = new Promise<void>((resolve) => {
			release = resolve;
		});
		const storage = store(async () => {
			if (++admitted <= 2) {
				if (admitted === 2) release();
				await barrier;
			}
			return true;
		});
		const results = await Promise.all([
			storage.applyRevokedConnection(owner, one.request, one.proof, () => true),
			storage.applyRevokedConnection(
				other.owner,
				two.request,
				two.proof,
				() => true,
			),
		]);
		expect(results.filter((value) => value !== null)).toHaveLength(1);
		expect(
			await admin`select request_nonce from platform.profile_suggestion_connection_receipts`,
		).toHaveLength(1);
		const losing = results[0] === null ? firstBatch : secondBatch;
		expect(
			(
				await admin`select status from platform.profile_suggestions where batch_id=${losing.id}`
			)[0].status,
		).toBe("accepted");
		expect(
			await admin`select id from network.facets where id=${`source-suggestion:${losing.suggestions[0]!.id}`}`,
		).toHaveLength(1);
		expect(
			(
				await admin`select revision from platform.profile_suggestion_batches where id=${losing.id}`
			)[0].revision,
		).toBe(losing.revision + 1);
	}, 15000);
});
