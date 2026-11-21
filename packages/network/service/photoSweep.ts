import type { SQL } from "../../core/src/runtime/postgres.ts";
import { ADULT_AGE } from "../../core/src/policy.ts";
import type { AppId } from "../../platform/src/apps.ts";
import { PHOTO_APPS, type PhotoHolder, type PhotoService } from "../../platform/src/photos.ts";

export interface PhotoSweepRuntime { app: { id: AppId }; scoped<T>(fn: (tx: SQL) => Promise<T>): Promise<T> }

export interface PhotoSweepDeps {
  photos: PhotoService;
  runtimes: readonly PhotoSweepRuntime[];
  dropRatings: (personId: string, app: AppId) => Promise<void>;
  log: (s: string) => void;
}

const LIVE = ["active", "paused", "onboarding"];

export async function sweepPhotos(d: PhotoSweepDeps): Promise<void> {
  const apps = new Map<AppId, PhotoSweepRuntime>();
  for (const rt of d.runtimes) if (PHOTO_APPS.includes(rt.app.id) && !apps.has(rt.app.id)) apps.set(rt.app.id, rt);
  const failedChecks: PhotoHolder[] = [];
  for (const [app, rt] of apps) {
    const rows = await rt.scoped(tx => tx<{ person_id: string }[]>`select distinct m.person_id::text as person_id from network.facets f
      join network.members m on m.app_id = f.app_id and m.id = f.member_id
      where f.app_id = ${app} and f.id = m.id || ':verify:age' and 'verify:age:fail' = any(f.tags) and m.person_id is not null
        and exists (select 1 from platform.photos ph where ph.person_id = m.person_id and ph.app_id = ${app} and ph.deleted_at is null)
      order by 1 limit 64`);
    failedChecks.push(...rows.map(r => ({ personId: r.person_id, app })));
  }
  await d.photos.sweep(failedChecks);
  for (const [app, rt] of apps) {
    const rated = await rt.scoped(tx => tx<{ person_id: string }[]>`select distinct m.person_id::text as person_id from network.facets f
      join network.members m on m.app_id = f.app_id and m.id = f.member_id
      left join platform.people p on p.id = m.person_id
      left join platform.memberships ms on ms.person_id = m.person_id and ms.app_id = f.app_id
      where f.app_id = ${app} and m.person_id is not null
        and (f.id = m.id || ':appearance' or (f.source = 'photo_rater' and f.privacy_scope = 'agent_private'))
        and (p.id is null or p.deleted_at is not null or p.lowest_age is null or p.lowest_age < ${ADULT_AGE} or m.age is null or m.age < ${ADULT_AGE}
          or ms.state is null or not (ms.state = any(${LIVE}))
          or not exists (select 1 from platform.photos ph where ph.person_id = m.person_id and ph.app_id = ${app} and ph.stored_at is not null and ph.deleted_at is null)
          or exists (select 1 from network.facets v where v.app_id = ${app} and v.id = m.id || ':verify:age' and 'verify:age:fail' = any(v.tags)))
      order by 1 limit 64`);
    for (const r of rated) {
      try {
        if (!(await d.photos.ratingAllowed(r.person_id, app))) await d.dropRatings(r.person_id, app);
      } catch (e) {
        d.log(`[photos] sweep: the rating of ${r.person_id} on ${app} failed and waits for the next tick: ${(e as Error).message}`);
      }
    }
  }
}
