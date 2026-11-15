// spec/system.md, "Story: Edit together, online or not"; spec/system.md, "Story: Editing alone is never refused"
// Two tabs and the real HTTP server: the convergence the system spec says is
// possible, checked on the running application.
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { view } from "../gen/client.ts";
import { sameTodos } from "../gen/todo.ts";
import { createServer, TodoStore } from "../src/server.ts";
import { Tab, fetchSnapshot, newId } from "../src/web/sync.ts";

async function until(ok: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

test("two tabs, one of them offline for a while, end up with the server's list", async () => {
  const store = new TodoStore();
  const server = createServer(store);
  await new Promise<void>((done) => server.listen(0, done));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  const a = new Tab(base, "a");
  const b = new Tab(base, "b");
  void a.listen();
  void b.listen();
  try {
    // a adds milk; b hears about it through the push stream.
    const milk = newId("a", a.state);
    await a.edit({ kind: "create", id: milk, title: "milk", done: false });
    await until(() => b.state.seen === 1);

    // a goes offline and keeps editing; b ticks milk off meanwhile.
    a.goOffline();
    const eggs = newId("a", a.state);
    await a.edit({ kind: "create", id: eggs, title: "eggs", done: false });
    await a.edit({ kind: "rename", id: milk, title: "oat milk", done: false });
    assert.equal(a.state.pending.length, 2);
    await b.edit({ kind: "done", id: milk, title: "", done: true });
    assert.equal(store.state.version, 2);

    // A request that arrives twice is applied once.
    await a.send(a.state.pending[0]!);
    await a.send({ seq: 2, op: { kind: "create", id: eggs, title: "eggs", done: false } });
    assert.equal(store.state.version, 3);

    // Back online: the queue is sent again and the tab catches up.
    await a.goOnline();
    await until(() => b.state.seen === store.state.version);
    b.dispatch(await fetchSnapshot(base));

    assert.equal(a.state.pending.length, 0);
    assert.equal(b.state.pending.length, 0);
    assert.equal(a.state.seen, store.state.version);
    assert.equal(b.state.seen, store.state.version);
    assert.ok(sameTodos(view(a.state), view(b.state)));
    assert.ok(sameTodos(view(a.state), store.state.todos));
    assert.deepEqual(view(a.state).map((t) => [t.title, t.done]), [["oat milk", true], ["eggs", false]]);
  } finally {
    a.close();
    b.close();
    server.closeAllConnections();
    server.close();
  }
});

test("a lone user's queued edits reach the server in order, and none is refused", async () => {
  const server = createServer(new TodoStore());
  await new Promise<void>((done) => server.listen(0, done));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  const a = new Tab(base, "a");
  try {
    a.goOffline();
    const milk = newId("a", a.state);
    await a.edit({ kind: "create", id: milk, title: "milk", done: false });
    await a.edit({ kind: "done", id: milk, title: "", done: true });
    await a.edit({ kind: "rename", id: milk, title: "oat milk", done: false });
    await a.goOnline();
    assert.equal(a.state.pending.length, 0);
    assert.equal(a.state.refusals, 0);
    assert.deepEqual(view(a.state).map((t) => [t.title, t.done]), [["oat milk", true]]);
  } finally {
    a.close();
    server.closeAllConnections();
    server.close();
  }
});
