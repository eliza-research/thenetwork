// spec/server.md, "Story: Change the list over HTTP"
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { createServer, TodoStore } from "../src/server.ts";

const store = new TodoStore();
const server = createServer(store);
let base = "";
before(async () => {
  await new Promise<void>((done) => server.listen(0, done));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const post = async (body: unknown) => {
  const res = await fetch(`${base}/api/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as { ok: boolean; seq: number; version: number; todos: { id: string; done: boolean; deleted: boolean }[] } };
};

test("a request is applied once, and a retry gets the same answer", async () => {
  const create = { type: "create", client: "ann", seq: 1, id: "ann-1", title: "milk" };
  const first = await post(create);
  assert.equal(first.status, 200);
  assert.equal(first.body.ok, true);
  assert.equal(first.body.version, 1);
  const again = await post(create);
  assert.equal(again.body.ok, true);
  assert.equal(again.body.version, 1);
  assert.equal(again.body.todos.length, 1);
});

test("an edit that does not make sense is refused and logged, and its retry is refused too", async () => {
  const tick = { type: "setDone", client: "ann", seq: 2, id: "nobody", done: true };
  const first = await post(tick);
  assert.equal(first.body.ok, false);
  assert.equal(first.body.version, 1);
  assert.equal((await post(tick)).body.ok, false);
  assert.equal(store.state.log.length, 2);
});

test("removing leaves a tombstone, so the id cannot be created again", async () => {
  assert.equal((await post({ type: "remove", client: "ben", seq: 1, id: "ann-1" })).body.ok, true);
  const again = await post({ type: "create", client: "ben", seq: 2, id: "ann-1", title: "milk" });
  assert.equal(again.body.ok, false);
  assert.deepEqual(again.body.todos.map((t) => [t.id, t.deleted]), [["ann-1", true]]);
});

test("a request that reuses a number for another edit is refused, not taken for a retry", async () => {
  // Someone squats on dan's first number with an edit of their own.
  assert.equal((await post({ type: "create", client: "dan", seq: 1, id: "dan-x", title: "forged" })).body.ok, true);
  const real = await post({ type: "create", client: "dan", seq: 1, id: "dan-1", title: "milk" });
  assert.equal(real.body.ok, false);
  assert.ok(!real.body.todos.some((t) => t.id === "dan-1"));
  // The squatter's own retry is still a retry.
  assert.equal((await post({ type: "create", client: "dan", seq: 1, id: "dan-x", title: "forged" })).body.ok, true);
});

test("a client cannot ask the server to refuse a request", async () => {
  const refuse = { type: "refuse", client: "eve", seq: 1, op: { kind: "create", id: "eve-1", title: "milk", done: false } };
  assert.equal((await post(refuse)).status, 400);
  assert.equal((await post({ type: "create", client: "eve", seq: 1, id: "eve-1", title: "milk" })).body.ok, true);
});

test("malformed input is rejected before it reaches the machine", async () => {
  assert.equal((await post({ type: "create", client: "ann", seq: 1.5, id: "x", title: "y" })).status, 400);
  assert.equal((await post({ type: "explode" })).status, 400);
  const res = await fetch(`${base}/api/events`, { method: "POST", body: "{not json" });
  assert.equal(res.status, 400);
});

test("the snapshot is the server's list and version", async () => {
  const s = (await (await fetch(`${base}/api/snapshot`)).json()) as { version: number; todos: unknown[] };
  assert.equal(s.version, store.state.version);
  assert.equal(s.todos.length, 3);
});

test("the frontend is served as JavaScript, with its types removed", async () => {
  const res = await fetch(`${base}/src/web/app.ts`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /javascript/);
  const js = await res.text();
  assert.doesNotMatch(js, /interface ReactLike/);
  assert.equal((await fetch(`${base}/src/../package.json`)).status, 404);
  assert.match(await (await fetch(`${base}/`)).text(), /importmap/);
});
