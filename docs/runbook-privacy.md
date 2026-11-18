# Runbook: export and erasure requests, and the privacy replay after a restore

This runbook is for staff who answer help@ntwrk.party ([Story F24](../spec/product/stories.md#story-f24--export-or-delete-my-data)). The sites have no account page. A member asks for an export or an erasure by email, and staff carry it out through the staff API on the staff port (`backend.railway.internal:4848`, the same port as `/review` and `/holds`). The rules are in [spec/accountPrivacy.md](../spec/accountPrivacy.md), "Story: Staff carry out an export or erasure request sent to support", and [spec/databaseRestore.md](../spec/databaseRestore.md), "Story: Carry privacy changes made after the backup into the restored database".

## 1. Who may do it

- Only a staff token or SSO grant with `admin@*` (an admin for every app). An admin of one app, a reviewer or a safety role gets 403.
- Each call states a reason of 5 to 500 characters. Use the support ticket reference, for example `help@ request 2026-11-17 #42`. The reason goes to the staff audit log, not to the request record.
- Every call writes an audit row before the step (`phase: "requested"`) and a result row after it (`phase: "result"`), with the actions `privacy_request`, `privacy_confirm` and `privacy_replay`.

## 2. Export or erasure for one member

The member must prove that they hold the number. Staff never act on an email alone.

1. Ask the member for the phone number and, for an export, the app (`ntwrk`, `slop`, `peon` or `friends`) or all apps.
2. Open the request. A code goes to that number by text.

   ```bash
   curl -sS -X POST http://backend.railway.internal:4848/privacy/requests \
     -H "authorization: Bearer $STAFF_TOKEN" -H 'content-type: application/json' \
     -d '{"phone":"+12125550100","operation":"erase","app":"slop","reason":"help@ request #42"}'
   # export of one app:  "operation":"export","app":"slop","scope":"app"
   # export of all apps: "operation":"export","app":"slop","scope":"all"  (app names the brand of the code text)
   ```

   The answer gives `requestId`, `personId` (or `null` when the number has no account), the masked number and the live memberships. Check that the masked number matches the email. `409 phone_held`: the number is on hold, decide it first with `/holds`.
3. Ask the member to reply with the code. Never ask for the code in any other way, and never send it back.
4. Confirm within 30 minutes. Send the same phone, echo the `personId` from step 2, and add the code.

   ```bash
   curl -sS -X POST http://backend.railway.internal:4848/privacy/requests/$REQUEST_ID/confirm \
     -H "authorization: Bearer $STAFF_TOKEN" -H 'content-type: application/json' \
     -d '{"phone":"+12125550100","personId":"<personId from step 2>","code":"123456","reason":"help@ request #42"}'
   ```

   | Answer | Meaning |
   |---|---|
   | `200 {"outcome":"erased"}` | The member's own account erasure ran: every app's membership, Network data, photos, connector grants, sessions, shares, pending texts, consent and phone binding. The tombstone, suppression, lowest age, bans and safety records stay. |
   | `200 {"outcome":"exported","exports":{...}}` | The member export of each app in scope. Send the JSON to the member as an attachment, then delete your copy. |
   | `200 {"already":true}` | The request completed before. Nothing ran again. |
   | `404 request_unavailable` | Wrong request ID or phone, or more than 30 minutes passed. Open a new request. |
   | `409 target_changed` | The echoed person ID is wrong, or the number changed owner since step 2. Check the email again. The code was not used. |
   | `403 code_refused` | Wrong or expired code. Ask the member again, or open a new request. |
   | `409 erasure_refused` | The account changed during the erasure. Open a new request. |

5. Reply to the member: the export, or that the erasure is done. A per-app leave is a text command (`leave <app>`) and needs no staff.

## 3. A restore for real: replay the privacy changes

A backup is one snapshot. Erasures, STOPs, leaves and bans made after it are in the source database only. `deploy/backup/restore.ts` replays them when it can read the source database.

1. Set `RESTORE_SOURCE_DATABASE_URL` to a login that can read the source database (the damaged one). Run the restore of runbook-real.md 8.3 step 2 with `--keep-privileges --replay`. A recovery without `--replay` or `--source-lost` is refused.
2. The command copies the missing consent events, bans and suppressions into the restored database at once. For each copied ban it also deletes the banned number's queued texts and revokes the banned person's live shares. It queues each erasure, leave, STOP and ban projection in `platform.privacy_replay`. The log line `restore checked` shows `privacyReplay` with the counts.
3. Start the backend on the restored database (runbook-real.md 8.3 step 5). The backend runs the queue when it starts, before its first tick and before it serves a request. The audit log shows `privacy_replay` rows with the actor `system:restore-replay`. Each item gets an outcome: `applied`, `already` (the change was already in place; `already:no_member` for a ban with no live membership, where the ban row already refuses the number), or `held`, `no_phone` and `refused:<reason>`. These last three stay open. The backend logs `[alert] privacy replay: N item(s) stay open`. Fix the cause (for example, decide the hold with `/holds`), then run the open items again:

   ```bash
   curl -sS -X POST http://backend.railway.internal:4848/privacy/replay \
     -H "authorization: Bearer $STAFF_TOKEN" -H 'content-type: application/json' \
     -d '{"reason":"restore 2026-11-17 replay"}'
   ```

   Each runner claims an item before it runs it, so two calls never run one item twice. A completed item never runs again. To see what stays open: `select kind, person_id, app_id, outcome from platform.privacy_replay where replayed_at is null`.
4. If the source database cannot be read at all, run the restore with `--keep-privileges --source-lost`. Nothing after the backup can be replayed: write down the backup time, and treat every erasure email of that window again with section 2.

What the replay does not carry forward: anything else written after the backup (messages, new members, ages stated after the backup). It also does not remove outbound texts that the backup holds as pending. Runbook-real.md 8.3 step 6 covers the lost window.
