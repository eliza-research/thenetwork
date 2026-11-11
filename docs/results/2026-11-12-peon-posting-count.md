# Peon posting count correction

Date: 2026-11-12. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.

## Requirement and reproduced defect

`docs/network.md` 1.4 specifies integer job openings from 1 to 50, text read-back before confirmation, and a persisted draft. PRD 40.6 covers the local Peon pilot. This fixes a reproduced defect in that existing flow.

On base, a signed HTTP message saying `2.5 openings` produces a read-back for five openings; `-2 openings` becomes two; `0 openings` and `51 openings` become one. A subsequent yes saves those counts in PostgreSQL. The parser searches for a short integer substring and discards values outside the range. Discarded values look like an omitted field, which defaults to one.

Read the complete numeric count token, retain invalid values in the draft, and require a correction before read-back. Non-finite or unparseable numeric tokens use zero as a serializable invalid marker. The existing 1-50 integer check also validates the draft. An omitted count still defaults to one. A direct numeric or one-to-ten word answer can correct the pending count question. The existing two-question limit remains.

Rounding or clamping silently changes requested capacity. Relying only on the final staff/API validator is too late: the parser has already changed the value to a valid but wrong count. The correction belongs before confirmation.

## Broken-flow videos and reproduction

[Before](media/2026-11-12-peon-posting-count-before.mp4) and [after](media/2026-11-12-peon-posting-count-after.mp4): transcript playbacks of the actual seed-1 signed HTTP/SQL case, after onboarding. They display recorded service text and stored posting/seat results, with timing adjusted for reading. They are not recordings of an SMS app or an external agent client. The displayed latest outbound message may precede the current step; the base does not recover a draft from a bare `3`.

1. From a clean base and candidate checkout, run `bun install --frozen-lockfile` and the same local PostgreSQL test environment on port 54339. Keep provider keys, live-send and deployment flags cleared.
2. Copy the candidate regression file to the base temporarily and run `bun test --conditions eliza-source packages/network/test/peon-posting-count.integration.test.ts` in each checkout. Base must fail because the first reply says five openings; candidate must pass.
3. To reproduce the paired videos, save and run the measurement program below in each checkout. It starts a real loopback HTTP server on an ephemeral port, joins fictional members through `POST /webhooks/blooio`, posts the job, restarts the service, answers the count question, confirms and restarts again. No clicks or browser are needed.
4. Inspect the `correct 2.5 openings` record for seed 1. Before: read-back says five, then the bare `3` does not recover the draft and no posting is saved. After: a count question, read-back for three, then a saved three-opening posting and seat. The separate premature-yes cases reproduce the base saving wrong counts.
5. Run the comparator. Every candidate workflow must be correct and all 36 controls must equal their base records.

The same regression file: **0 pass, 1 fail, 4 assertions** on base; **1 pass, 0 fail, 47 assertions** after. Suite durations: 2.43s before and 3.11s after. These are functional results, not a performance claim.

The regression also checks `x50`, changing a ready draft to an invalid count, bare digit and word corrections, the omitted-count default, declining a valid read-back, refusing premature yes, the two-question cap, minors, persisted drafts and restored seat capacity. Every outbound message is dry-run. No parser, service or database mocks.

## measurement

| Observation | Before | After |
| --- | --- | --- |
| Correct complete workflows | 36/96 | 96/96 |
| Invalid-count workflows recovered and saved after correction | 16/48 | 48/48 |
| Postings saved by premature yes to an invalid count | 8 | 0 |
| Expected confirmed postings restored with correct capacity | 48/80 | 80/80 |
| Two-question limit cases correctly dropped | 0/4 | 4/4 |
| Postings by minors | 0 | 0 |

Counts overlap. All 36 already-correct controls remain identical.

The same program runs 24 native HTTP/PostgreSQL workflows on each service seed 1, 7, 13, 16: 96 per revision. Twelve cases per seed correct fractional, signed, zero, over-limit, grouped-digit, multiplier and overflow counts. Eight preserve valid/omitted counts; two try premature yes; one is a minor; one reaches the two-question limit. All drafts and final postings are checked across service restarts.

All 36 controls retain identical read-backs, final replies, posting fields, restored fields and seat tags. IDs and storage timestamps are omitted from comparison because they identify different test databases; posting content is preserved. No posting is written before confirmation, and no minor creates one. All 80 expected postings after correction/valid confirmation survive restart with their exact seat capacity.

These are deterministic repeated workflows, not independent hiring populations or a production-frequency estimate. They qualify count intake and persistence, not matching quality or live delivery.

## safety_gates and validation

The same `bun run sim --only peon,peon-seats,safety,audit --json <output>` passes **69/69 blocking gates before and after**, with PostgreSQL and `REQUIRE_PG=1`. All **70 complete gate records** match after excluding execution duration, including the tracked Peon matching fingerprint. No tracked gate is off target. Runtime: 64.7s before and 62.9s after.

All four TypeScript configurations pass. Integration, including security:

```text
 676 pass
 8 skip
 6 fail
 13788 expect() calls
Ran 690 tests across 69 files. [453.55s]
```

The six failure names and causes match the clean-base Windows reproduction: missing `/bin/bash`, backend SIGTERM exit 143 versus 0, and four site path assertions. Integration is not green; eight optional cases remain skipped.

E2E:

```text
 42 pass
 1 skip
 0 fail
 654 expect() calls
Ran 43 tests across 3 files. [42.67s]
```

The optional SDK/browser case remains skipped.

The integration suite includes the security files. No full simulation rerun: AGENTS.md's one-full-run allowance was used earlier in this contribution session; these are fresh affected-block results.

Commands from the relevant checkout:

```text
bun install --frozen-lockfile
bun test --conditions eliza-source packages/network/test/peon-posting-count.integration.test.ts
bun run --conditions eliza-source ../posting-count-measure.ts . ../posting-count-before.json
bun run --conditions eliza-source ../posting-count-measure.ts . ../posting-count-after.json
bun run ../posting-count-compare.ts
bun run sim --only peon,peon-seats,safety,audit --json ../posting-count-gates-before.json
bun run typecheck
bun run sim --only peon,peon-seats,safety,audit --json ../posting-count-gates-after.json
bun run test:integration
bun run test:e2e
python ../posting-count-video.py
```

Before commands use clean base; after commands use this branch. `REQUIRE_PG=1`, PostgreSQL 16.15, Bun 1.4.2, fictional 555-01xx phone numbers. The renderer uses only the recorded JSON, Pillow and FFmpeg; its output frames were visually inspected.

## llm_evidence, agent_clients and limits

N/A for real-model evidence: this is the documented rules-only handled-turn intake and never consumes an open-turn model response. Validation model calls: zero; cost: zero. No matching, consent, age, pay, skill or safety-threshold changes.

Codex desktop 26.1103.7773.0, PowerShell, GitHub connector and Git/gh. Authoring provider OpenAI; exact model identifier unavailable. No browser/computer use, real SMS app or external agent-client acceptance run. No untested client claims.

The new count question repairs the broken flow under CONTRIBUTING section 9; the videos above are explicitly transcript playbacks. No site or console layout changes. Recognized numeric count clauses are validated; this is not a general natural-language count parser. Existing persisted postings are not rewritten. The ordinary default of one applies only when the parser sees no count clause.

AI assistance authored the fix, regression, measurement and renderer. The real service and PostgreSQL generated the observed responses and stored results.

## Reproduction programs

Save these beside the base and candidate checkouts. The measurement takes a checkout root and output path. The comparator and renderer read the named output files beside themselves.

### posting-count-measure.ts

```ts
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { SQL } from "bun";
const root = resolve(process.argv[2]!), output = resolve(process.argv[3]!);
const from = (p: string) => import(pathToFileURL(resolve(root, p)).href);
const { MINUTE, DAY, SimClock } = await from("packages/core/src/index.ts");
const { signBlooioPayload } = await from("packages/blooio/src/blooio/webhook.ts");
const { testDb, dropTestDb } = await from("packages/observatory/test/pg.ts");
const { NetworkService, WEBHOOK_PATH } = await from("packages/network/service/service.ts");
const { DryRunAdapter } = await from("packages/network/service/channel.ts");
const { loadPostings } = await from("packages/network/service/postings.ts");
const { loadSnapshot } = await from("packages/network/service/snapshot.ts");
const { START } = await from("packages/network/test/mini.ts");
const question = "How many openings are there? Please give a whole number from 1 to 50.";
const cases: any[] = ["2.5 openings", "-2 openings", "0 openings", "51 openings", "1000 openings", "2,000 openings", "x2.5", "x-2", "x0", "x51", "x100", "1e999 openings"]
  .map((count, i) => ({ name: `correct ${count}`, count, kind: "correct", correction: ["3", "three", "3 openings"][i%3], expectedCount: 3 }));
for (const [count, expectedCount] of [["1 opening",1],["2 openings",2],["50 openings",50],["two openings",2],["x1",1],["x2",2],["x50",50],["",1]])
  cases.push({ name: `control ${count || "omitted"}`, count, kind: "control", expectedCount, control: true });
for (const count of ["0 openings", "2.5 openings"]) cases.push({ name: `premature yes ${count}`, count, kind: "premature" });
cases.push({ name: "minor", count: "2.5 openings", kind: "minor", control: true });
cases.push({ name: "two-question limit", count: "-2 openings", kind: "discard" });
if (cases.length !== 24) throw Error("Case count changed");
const url = await testDb(), sql = new SQL({ url, max: 2 }), rows: any[] = [];
let svc: any, http: any, seq = 0;
const secret = "synthetic-posting-count", clean = (p: any) => { const { id, managerId, createdAt, updatedAt, ...fields } = p; return fields; };
try {
  for (const [si, seed] of [1,7,13,16].entries()) {
    const clock = new SimClock(START + si*DAY);
    const make = () => new NetworkService({ url, clock, env: { PLATFORM_ENV: "dev" }, networks: [{ id: "peon:nyc" }],
      webhookSecret: secret, network: { seed }, photoStorage: null, notify: false, adapter: () => new DryRunAdapter(() => {}), log: () => {} });
    svc = make(); await svc.start(); http = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (r: Request) => svc.fetch(r) });
    const say = async (phone: string, text: string) => {
      const id = `count_${++seq}`, body = JSON.stringify({ id, type: "message.received", api_version: "2026-10-01", created_at: clock.now(), organization_id: "org_test",
        data: { message_id: id, sender: phone, chat_id: phone, text, protocol: "imessage" } });
      const r = await fetch(new URL(WEBHOOK_PATH, http.url), { method: "POST", headers: { "content-type": "application/json",
        "x-blooio-signature": signBlooioPayload(secret, body, Math.floor(clock.now()/1000)) }, body });
      if (r.status !== 200) throw Error(`HTTP ${r.status}`); await r.text(); clock.advance(MINUTE);
    };
    const last = async (id: string) => (await sql`select body from network.messages where app_id='peon' and member_id=${id} and direction='outbound' order by ts desc,id desc limit 1`)[0].body;
    const cohort: any[] = [];
    for (const [ci, c] of cases.entries()) {
      const phone = `+121255501${String(si*24+ci).padStart(2,"0")}`;
      await say(phone, "peon"); await say(phone, `Rowan, ${c.kind === "minor" ? 15 : 34}`);
      const [member] = await sql`select m.id from network.members m join platform.phone_identities p on p.person_id=m.person_id where m.app_id='peon' and p.e164=${phone}`;
      await say(phone, `We're hiring a data analyst, ${c.count ? `${c.count}, ` : ""}$90k-$120k, hybrid in Brooklyn, must have SQL`);
      const before = await loadPostings(sql,"peon",member.id);
      if (before.length) throw Error("Posting saved before confirmation");
      cohort.push({ c, phone, member: member.id, initial: await last(member.id) });
    }
    await svc.close(); svc = make(); await svc.start();
    for (const v of cohort) {
      const { c, phone, member } = v;
      let correctionReply: string | null = null;
      if (c.kind === "correct") { await say(phone,c.correction); correctionReply = await last(member); }
      if ((await loadPostings(sql,"peon",member)).length) throw Error("Posting saved before confirmation after restart");
      if (c.kind === "discard") { await say(phone,"51 openings"); await say(phone,"2.5 openings"); }
      else await say(phone,"yes");
      const posts = await loadPostings(sql,"peon",member), afterReply = await last(member);
      const expectedSaved = c.expectedCount === undefined ? 0 : 1;
      const expectedInitial = c.kind === "minor" ? v.initial === "Job posts are for adults (18+) only."
        : c.kind === "control" ? v.initial.includes(`Data analyst, ${c.expectedCount} opening${c.expectedCount === 1 ? "" : "s"},`) : v.initial === question;
      const corrected = c.kind !== "correct" || correctionReply!.includes("Data analyst, 3 openings, $90k-$120k a year");
      const fieldsOk = posts.length === expectedSaved && posts.every((p:any) => p.openings === c.expectedCount && p.title === "data analyst"
        && p.payMin === 90 && p.payMax === 120 && p.mode === "hybrid" && p.must.length === 1 && p.must[0].skill === "sql");
      const r = { seed, name:c.name, kind:c.kind, control:!!c.control, expectedSaved, expectedCount:c.expectedCount ?? null,
        initial:v.initial, correctionReply, afterReply, initialCorrect:expectedInitial, correctionCorrect:corrected,
        correct:expectedInitial && corrected && fieldsOk && (c.kind !== "discard" || afterReply === "OK, I didn't post anything."),
        posts:posts.map(clean), member, ids:posts.map((p:any)=>p.id) };
      rows.push(r); v.result = r;
    }
    await svc.close(); svc = make(); await svc.start();
    const snap = await loadSnapshot(sql,clock.now(),{app:"peon",city:"nyc"});
    for (const { result:r } of cohort) {
      const restored = await loadPostings(sql,"peon",r.member);
      r.restored = restored.map(clean);
      r.seats = r.ids.map((id:string)=>({exists:snap.members.some((m:any)=>m.id===`job:${id}`), tags:snap.facets.find((f:any)=>f.id===`job:${id}:openings`)?.tags}));
      if (JSON.stringify(r.posts)!==JSON.stringify(r.restored) || r.seats.some((s:any,i:number)=>!s.exists || JSON.stringify(s.tags)!==JSON.stringify([`peon:openings:${r.posts[i].openings}`]))) throw Error("Restart lost posting capacity");
      delete r.member; delete r.ids;
    }
    const statuses = await sql`select distinct status from network.messages where direction='outbound'`;
    if(statuses.some((r:any)=>r.status!=="dry_run")) throw Error("Non-dry-run message");
    await svc.close(); svc = undefined; http.stop(true); http = undefined;
    console.log(JSON.stringify({seed,cases:cohort.length,correct:cohort.filter(v=>v.result.correct).length,posts:cohort.reduce((n,v)=>n+v.result.posts.length,0)}));
  }
  await Bun.write(output,JSON.stringify(rows,null,2));
} finally { http?.stop(true); await svc?.close(); await sql.close(); await dropTestDb(); }
```

### posting-count-compare.ts

```ts
import { strict as assert } from "node:assert";
const dir = import.meta.dir;
const a = await Bun.file(`${dir}/posting-count-before.json`).json();
const b = await Bun.file(`${dir}/posting-count-after.json`).json();
assert.equal(a.length,96); assert.equal(b.length,96);
for(let i=0;i<a.length;i++) {
  assert.equal(a[i].seed,b[i].seed); assert.equal(a[i].name,b[i].name); assert.equal(b[i].correct,true);
  if(a[i].control) assert.deepEqual(a[i],b[i],`control: ${a[i].seed} ${a[i].name}`);
  assert.deepEqual(b[i].posts,b[i].restored);
}
const counts = (rs:any[]) => ({
  correct:rs.filter(r=>r.correct).length,
  controls:rs.filter(r=>r.control).length,
  recoveryReadbacks:rs.filter(r=>r.kind==="correct"&&r.correctionCorrect).length,
  savedRecoveries:rs.filter(r=>r.kind==="correct"&&r.posts.length===1&&r.posts[0].openings===3).length,
  savedPremature:rs.filter(r=>r.kind==="premature").reduce((n,r)=>n+r.posts.length,0),
  savedMinor:rs.filter(r=>r.kind==="minor").reduce((n,r)=>n+r.posts.length,0),
  expectedPostsRestored:rs.filter(r=>r.expectedSaved===1&&r.posts.length===1&&r.posts[0].openings===r.expectedCount).length,
  questionLimit:rs.filter(r=>r.kind==="discard"&&r.afterReply==="OK, I didn't post anything.").length,
});
const before=counts(a),after=counts(b);
assert.deepEqual([before.correct,after.correct,after.controls],[36,96,36]);
assert.deepEqual([before.savedRecoveries,after.savedRecoveries,before.savedPremature,after.savedPremature],[16,48,8,0]);
assert.deepEqual([before.expectedPostsRestored,after.expectedPostsRestored],[48,80]);
await Bun.write(`${dir}/posting-count-comparison.json`,JSON.stringify({cases:96,before,after},null,2));
console.log(JSON.stringify({cases:96,before,after}));
```

### posting-count-video.py

```python
import json, pathlib, subprocess, textwrap
from PIL import Image, ImageDraw, ImageFont

root = pathlib.Path(__file__).resolve().parent
media = root / 'thenetwork/docs/results/media'
media.mkdir(exist_ok=True)
font = ImageFont.truetype('C:/Windows/Fonts/consola.ttf', 23)
title_font = ImageFont.truetype('C:/Windows/Fonts/consolab.ttf', 31)
small = ImageFont.truetype('C:/Windows/Fonts/consola.ttf', 18)
first = "We're hiring a data analyst, 2.5 openings, $90k-$120k, hybrid in Brooklyn, must have SQL"
for phase in ['before', 'after']:
    cases = json.loads((root / f'posting-count-{phase}.json').read_text(encoding='utf-8'))
    case = next(c for c in cases if c['seed'] == 1 and c['name'] == 'correct 2.5 openings')
    out = root / 'posting-count-video' / phase
    out.mkdir(parents=True, exist_ok=True)
    steps = [
        [('MEMBER -> signed HTTP webhook', first), ('SQL: latest stored outbound reply', case['initial']), ('SQL: saved job posts', '0 (confirmation has not happened)')],
        [('RESTART', 'A new NetworkService loads the stored draft from PostgreSQL.'), ('MEMBER -> signed HTTP webhook', '3'), ('SQL: latest stored outbound reply (may precede this step)', case['correctionReply']), ('SQL: saved job posts', '0 (confirmation has not happened)')],
        [('MEMBER -> signed HTTP webhook', 'yes'), ('SQL: latest stored outbound reply (may precede this step)', case['afterReply']), ('SQL: saved job posts after confirmation', json.dumps([{'title':p['title'],'openings':p['openings']} for p in case['posts']])), ('SECOND RESTART: job-seat capacity', json.dumps(case['seats']))],
    ]
    for i, sections in enumerate(steps):
        im = Image.new('RGB', (1440, 900), '#101827')
        d = ImageDraw.Draw(im)
        d.text((48,34), f'PEON POSTING COUNT | {phase.upper()} | STEP {i+1}/3', font=title_font, fill='#f3f7ff')
        d.text((48,88), 'Actual local HTTP/SQL transcript | seed 1 | Bun 1.4.2 | PostgreSQL 16.15', font=small, fill='#9fb1c8')
        y = 148
        for label, body in sections:
            d.text((48,y), label, font=small, fill='#62cfda'); y += 31
            for line in textwrap.wrap(body, width=91, replace_whitespace=False) or ['']:
                d.text((48,y), line, font=font, fill='#e5ecf7'); y += 31
            y += 22
        if y > 810:
            raise RuntimeError(f'Text overflows frame: {phase} {i} {y}')
        d.line((48,822,1392,822), fill='#3c4961', width=2)
        d.text((48,844), 'Transcript playback; timing adjusted for reading. Synthetic members; every send is dry-run.', font=small, fill='#9fb1c8')
        im.save(out / f'frame-{i}.png')
    concat = out / 'frames.txt'
    concat.write_text(''.join(f"file '{(out/f'frame-{i}.png').as_posix()}'\nduration {seconds}\n" for i,seconds in enumerate([8,7,8])) + f"file '{(out/'frame-2.png').as_posix()}'\n", encoding='utf-8')
    target = media / f'2026-11-12-peon-posting-count-{phase}.mp4'
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',str(concat),'-vf','format=yuv420p','-t','23','-r','24','-c:v','libx264','-crf','23','-movflags','+faststart',str(target)],check=True)
    result = subprocess.run(['ffprobe','-v','error','-show_entries','format=duration,size','-of','json',str(target)],check=True,capture_output=True,text=True)
    print(phase, result.stdout.strip())
```
