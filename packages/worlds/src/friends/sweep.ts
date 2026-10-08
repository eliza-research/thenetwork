// Dev sweep: friendsPack variants on seeds (tuning seeds only).
import { friendsMetrics } from "./metrics.ts";
import { friendsPackMatcher } from "./packMatcher.ts";
import { runFriendsWorld } from "./world.ts";
const variants: Record<string, Parameters<typeof friendsPackMatcher>[0]> = JSON.parse(process.argv[2] ?? '{"base":{}}');
const seeds = (process.argv[3] ?? "1,2").split(",").map(Number);
const weeks = Number(process.argv[4] ?? 8);
for (const [name, v] of Object.entries(variants)) {
  const ms = seeds.map(seed => friendsMetrics(runFriendsWorld({ seed, n: 400, weeks, matcher: friendsPackMatcher({ ...v, name }) })));
  const avg = (f: (m: (typeof ms)[0]) => number) => ms.map(f).reduce((a, b) => a + b, 0) / ms.length;
  console.log(`${name.padEnd(14)} meet ${avg(m => m.meetups).toFixed(1)} quorum ${(avg(m => m.quorumRate) * 100).toFixed(0)}% size ${avg(m => m.meanGroupSize).toFixed(2)} good ${(avg(m => m.goodRate) * 100).toFixed(0)}% enjoy ${avg(m => m.meanEnjoy).toFixed(3)} repeat ${(avg(m => m.repeatRate) * 100).toFixed(0)}% crews ${avg(m => m.crewsFormed).toFixed(1)} sess ${avg(m => m.crewSessions).toFixed(1)} V14 ${(avg(m => m.v14) * 100).toFixed(1)}% track ${(avg(m => m.friendshipTrackShare) * 100).toFixed(1)}% pace ${(avg(m => m.hallPaceShare) * 100).toFixed(1)}% hrsTop ${avg(m => m.topPairHours).toFixed(1)} trav ${avg(m => m.travel.medianGroupMax).toFixed(1)} boro ${avg(m => m.boroughRatioMin).toFixed(2)} adv ${avg(m => m.safety.adversaryContacts).toFixed(1)}/${avg(m => m.safety.knownAdversaryContacts).toFixed(1)} hmin ${avg(m => m.safety.hiddenMinorContacts).toFixed(1)} withMeet ${(avg(m => m.timeToFirstMeetup.shareWithMeetup) * 100).toFixed(0)}%`);
}
