// World calibration diagnostics (docs/results/2026-10-08-friends-pack.md "Oracle calibration").
//   bun run packages/worlds/src/friends/calibrate.ts --seeds 1-4
// For each arm: P(yes | probed), P(attend | booked), mean enjoyment, share of attendees who would
// do it again (e >= 0.6), share of meetups with at least one mutual "see again" pair (domain research
// C1 "Quality"), mutual see-again share of attendee pairs, and hours per pair per meetup.
import { BASELINES } from "./baselines.ts";
import { friendsPackMatcher } from "./packMatcher.ts";
import { isReal } from "./persona.ts";
import { runFriendsWorld, type FriendsMatcher, type FriendsWorld } from "./world.ts";

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1]! : d; };
const [a, b] = arg("seeds", "1-4").split("-").map(Number);
const seeds = Array.from({ length: (b ?? a!) - a! + 1 }, (_, i) => a! + i);
const arms: Record<string, FriendsMatcher | ((w: FriendsWorld) => FriendsMatcher)> = { random: BASELINES.random, pack: friendsPackMatcher(), oracle: BASELINES.oracle };
for (const [name, m] of Object.entries(arms)) {
  const acc = { probes: 0, yes: 0, booked: 0, came: 0, e: 0, n: 0, pos: 0, meet: 0, anyMutual: 0, pairs: 0, mutual: 0, selfPerWeek: 0 };
  for (const seed of seeds) {
    const r = runFriendsWorld({ seed, n: 400, weeks: 8, matcher: m });
    const O = r.world.oracle;
    for (const f of r.flows) { acc.probes += f.probed; acc.yes += f.yes; acc.booked += f.booked.length; acc.came += f.attended.length; }
    for (const mt of r.meetups.filter(x => x.kind !== "crew_self")) {
      const real = mt.attendees.filter(id => isReal(O.p(id)));
      acc.meet++;
      for (const id of real) { acc.e += mt.enjoy[id]!; acc.n++; if (mt.enjoy[id]! >= O.P.positive) acc.pos++; }
      let any = false;
      for (let i = 0; i < real.length; i++) for (let j = i + 1; j < real.length; j++) {
        acc.pairs++;
        const k = real[i]! < real[j]! ? `${real[i]}|${real[j]}` : `${real[j]}|${real[i]}`;
        if (r.world.mutual.has(k)) { acc.mutual++; any = true; }
      }
      if (any) acc.anyMutual++;
    }
    acc.selfPerWeek += r.world.selfHangouts / 8;
  }
  const pct = (x: number, y: number) => `${((100 * x) / Math.max(1, y)).toFixed(1)}%`;
  console.log(`${name.padEnd(7)} P(yes|probed) ${pct(acc.yes, acc.probes)}  P(came|booked) ${pct(acc.came, acc.booked)}  mean e ${(acc.e / acc.n).toFixed(3)}  would-do-again ${pct(acc.pos, acc.n)}  meetups with a mutual see-again ${pct(acc.anyMutual, acc.meet)}  attendee pairs mutual (ever) ${pct(acc.mutual, acc.pairs)}  own hangouts/week ${(acc.selfPerWeek / seeds.length).toFixed(1)}`);
}
