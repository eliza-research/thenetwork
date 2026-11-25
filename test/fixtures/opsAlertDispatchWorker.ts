import type { AlertDispatch, DispatchPhase, Event } from "../../packages/core/src/generated/opsAlertDispatch.ts";
import { HOUR, MINUTE } from "../../packages/core/src/clock.ts";
import type { SQL } from "../../packages/core/src/runtime/postgres.ts";
import { AlertDispatcher, PgAlertStore, type Alert, type DispatchResult } from "../../deploy/backend/ops.ts";
import { withConformanceDatabases } from "./conformanceDatabase.ts";
import { serveJourney } from "./serveJourney.ts";

const START = Date.UTC(2026, 9, 9, 16);
const LANES = 2;

type Round = {
  sql: SQL;
  result?: Promise<void>;
  done?: DispatchResult | Error;
  post?: { resolve(accepted: boolean): void };
  posted?: () => void;
};

await withConformanceDatabases("ops_alert_conformance", LANES, async databases => {
  const rounds = new Map<string, Round>();

  function roundFor(key: string): Round {
    const existing = rounds.get(key);
    if (existing) return existing;
    const sql = databases[rounds.size];
    if (!sql) throw new Error(`The worker has ${LANES} databases; ${key} needs another`);
    const round: Round = { sql };
    rounds.set(key, round);
    return round;
  }

  async function prepare(round: Round, event: Extract<Event, { type: "prepareDispatch" }>) {
    for (let n = 0; n < event.postsLastHour; n++) {
      await round.sql`insert into network.ops_alert_posts (at, alerts, ok) values (${new Date(START - MINUTE * (n + 1))}, 1, true)`;
    }
    const alerts: Alert[] = Array.from({ length: event.noticeCount }, (_, n) => ({
      key: `conformance_alert_${n}`, level: "warn", count: n + 1, text: `Conformance alert ${n}`,
    }));
    const dispatcher = new AlertDispatcher({
      store: new PgAlertStore(round.sql),
      post: () => new Promise<boolean>(resolve => { round.post = { resolve }; round.posted?.(); }),
      now: () => START, repeatMs: HOUR, maxPostsPerHour: event.hourlyLimit, format: "json", env: "conformance", build: "conformance",
    });
    const posted = new Promise<void>(resolve => { round.posted = resolve; });
    round.result = dispatcher.dispatch(alerts).then(result => { round.done = result; }, (error: Error) => { round.done = error; });
    await Promise.race([posted, round.result]);
    round.posted = undefined;
    if (round.post === undefined) await settled(round);
  }

  async function settled(round: Round): Promise<DispatchResult> {
    await round.result;
    if (round.done instanceof Error) throw round.done;
    if (round.done === undefined) throw new Error("Another round held the alert lock");
    return round.done;
  }

  async function phaseOf(round: Round): Promise<DispatchPhase> {
    if (!round.result) return "AwaitingNotices";
    if (round.post) return "PostingNotices";
    const result = await settled(round);
    const posts = await round.sql<{ ok: boolean }[]>`select ok from network.ops_alert_posts where at = ${new Date(START)}`;
    const episodes = await round.sql<{ open: boolean; sent: boolean }[]>`
      select open, last_sent_at = ${new Date(START)} as sent from network.ops_alerts`;
    if (episodes.some(episode => !episode.open)) throw new Error("A new alert was stored closed");
    const sent = episodes.filter(episode => episode.sent).length;
    if (posts.length > 1) throw new Error("One round recorded more than one post");
    if (posts.length === 1) {
      if (!result.posted || result.ok !== posts[0]!.ok) throw new Error(`The stored post disagrees with the round result ${JSON.stringify(result)}`);
      if (sent !== (result.ok ? episodes.length : 0)) throw new Error("The stored alerts disagree with the post's acceptance");
      return result.ok ? "NoticesAccepted" : "PostRejected";
    }
    if (result.posted || sent > 0) throw new Error("A round that recorded no post marked notices sent");
    if (episodes.length === 0) {
      if (result.notices.length || result.held) throw new Error("A round with no stored alert reported notices");
      return "NoNotices";
    }
    if (result.held !== result.notices.length || result.held !== episodes.length) throw new Error(`A held round reported ${JSON.stringify(result)}`);
    return "HeldByLimit";
  }

  async function reset() {
    const failures: Error[] = [];
    for (const round of rounds.values()) {
      round.post?.resolve(false);
      round.post = undefined;
      await round.result;
      if (round.done instanceof Error) failures.push(round.done);
      await round.sql`delete from network.ops_alert_posts`;
      await round.sql`delete from network.ops_alerts`;
    }
    rounds.clear();
    if (failures.length > 0) throw new AggregateError(failures, "An alert round failed during the journey");
    return null;
  }

  await serveJourney<Event>({
    reset,
    async dispatch(key, event) {
      const round = roundFor(key);
      const phase = await phaseOf(round);
      switch (event.type) {
        case "prepareDispatch":
          if (phase !== "AwaitingNotices") return "refused";
          await prepare(round, event);
          return "accepted";
        case "recordDelivery": {
          if (phase !== "PostingNotices") return "refused";
          const post = round.post!;
          round.post = undefined;
          post.resolve(event.accepted);
          await settled(round);
          return "accepted";
        }
      }
    },
    async observe(key): Promise<AlertDispatch> {
      return { phase: await phaseOf(roundFor(key)) };
    },
    observeOutput: () => null,
  });
  await reset();
});
