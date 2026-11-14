// STOP/START uses the real channel and Network before either Observatory view is read.
import { expect, test } from "bun:test";
import { SQL } from "bun";
import { DAY, HOUR } from "@thenetwork/core";
import { rowsFromGame, writeRows } from "../db/writer.ts";
import { GameSource } from "../src/sources/game.ts";
import { RealSource } from "../src/sources/real.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

test.skipIf(!pgAvailable)("resumed members retain their participation state in both Observatory views", async () => {
  const url = await testDb(), sql = new SQL(url);
  try {
    for (const network of ["consent", "stub"] as const) {
      const game = new GameSource({ seed: 4, personas: 80, days: 14, network, engine: "off", city: "all", pushMs: HOUR, tickMs: HOUR });
      try {
        await game.init();
        expect(await game.control({ type: "step", ms: 8 * DAY })).toMatchObject({ ok: true });
        const members = ["normal", "quiet"].map(state => game.state().members.find(m => m.joined && !m.minor && m.state === state)!);
        expect(members.every(Boolean)).toBe(true);
        const initial = members.map(m => ({ id: m.id, state: m.state }));
        const stopped = game.state().members.find(m => m.joined && !m.minor && m.state === "normal" && !initial.some(x => x.id === m.id))!;
        expect(stopped).toBeDefined();
        const selected = [...initial, { id: stopped.id, state: stopped.state }];
        const observations: unknown[] = [], expected: unknown[] = [];
        const snapshot = async (phase: string) => {
          await writeRows(sql, rowsFromGame(game), { truncate: true });
          const real = new RealSource({ url, service: false, pollMs: HOUR, pushMs: HOUR });
          try {
            await real.init();
            if (real.state().env.error) throw Error(real.state().env.error);
            const optedOut = game.state().members.filter(m => game.world.channel.isOptedOut(m.id)).length;
            const states = selected.map(m => ({ id: m.id, state: game.world.channel.isOptedOut(m.id) ? "opted_out" : m.state }));
            for (const view of [game.state(), real.state()]) {
              observations.push({ phase, mode: view.env.mode, optedOut: view.stats.optOuts, states: selected.map(m => ({ id: m.id, state: view.members.find(x => x.id === m.id)!.state })) });
              expected.push({ phase, mode: view.env.mode, optedOut, states });
            }
          } finally { await real.dispose(); }
        };
        const say = async (id: string, text: string) => {
          const result = await game.control({ type: "say", memberId: id, text });
          if (!result.ok) throw Error(result.error);
        };
        await snapshot("initial");
        for (const m of selected) await say(m.id, "STOP");
        await snapshot("stopped");
        await say(initial[0]!.id, "start later");
        await snapshot("not a resume");
        await say(initial[0]!.id, "START");
        await snapshot("normal resumed");
        await say(initial[0]!.id, "START");
        await snapshot("repeated START");
        await say(initial[1]!.id, "START");
        await snapshot("quiet resumed");
        await say(initial[0]!.id, "STOP");
        await snapshot("stopped again");
        await say(initial[0]!.id, "START");
        await snapshot("resumed again");
        expect(selected.map(m => game.world.memories.get(m.id)!.optedOut)).toEqual([false, false, true]);
        if (game.consent) expect(selected.map(m => game.consent!.exportState().members.find(x => x.id === m.id)!.optedOut)).toEqual([false, false, true]);
        expect(observations).toEqual(expected);
      } finally { await game.dispose(); }
      const waitingGame = new GameSource({ seed: 4, personas: 80, days: 14, network, engine: "off", city: "all", pushMs: HOUR, tickMs: HOUR });
      let waitingReal: RealSource | undefined;
      try {
        await waitingGame.init();
        const waiting = waitingGame.state().members.find(m => !m.joined && !m.minor)!;
        expect(waiting).toBeDefined();
        await waitingGame.control({ type: "say", memberId: waiting.id, text: "STOP" });
        await waitingGame.control({ type: "say", memberId: waiting.id, text: "START" });
        await writeRows(sql, rowsFromGame(waitingGame), { truncate: true });
        waitingReal = new RealSource({ url, service: false, pollMs: HOUR, pushMs: HOUR });
        await waitingReal.init();
        expect(waitingReal.state().env.error).toBeUndefined();
        expect([waitingGame.state(), waitingReal.state()].map(s => {
          const member = s.members.find(m => m.id === waiting.id)!;
          return { joined: member.joined, state: member.state, optOuts: s.stats.optOuts };
        })).toEqual([{ joined: false, state: "not_joined", optOuts: 0 }, { joined: false, state: "not_joined", optOuts: 0 }]);
      } finally { await waitingReal?.dispose(); await waitingGame.dispose(); }
    }
  } finally { await sql.close(); await dropTestDb(); }
}, 120_000);
