# Paraphrase arm: an ask stays an ask (2026-11-13)

The paraphrase arm (`packages/network/harness/paraphrase.ts`) rewrites a persona's words. The persona's decision stays the same. Two ask templates lost the request after the rewrite, so the Network did not search.

The templates are the ones personas send on their own:

- `Anyone around who'd want to <want>? I'm near <area>.`
- `Still hoping to <want>. Anything come up?`

The want text is replaced first. The old frames then said `looking to <want>` or `any luck finding someone?`. Those lines are not read as a people request when the new want words are not a known want. The Network treats the message as other chat.

The new frames keep the same want words and add an ask the reader already accepts: `know anyone?`, `anyone up for it?`, and `find someone?`.

## Numbers

Same 960 sentences. 20 wants, 3 areas (Park Slope, Astoria, Harlem), 8 persona ids, 2 templates. No model calls. `classify` from `packages/network/src/classify.ts`.

| Measure | Before | After |
|---|---|---|
| Read as a people request | 897 / 960 (93.4%) | 960 / 960 (100%) |
| Requests that were lost | 63 | 0 |
| Right want id kept | 873 / 960 | 873 / 960 |
| Yes replies still read as yes | 35 / 35 | 56 / 56 |
| No replies still read as no | 30 / 30 | 48 / 48 |

The yes and no lines were not edited. The before check used 5 persona ids. The after check used 8.

The 63 lost requests were only these wants: start a band (15), learn to sail (12), try ceramics (18), a hardware collaborator (18).

The right want id did not change. This fix does not teach the reader new want words.

## Command

```bash
bun run sim --only network
```

The new gate is `paraphrase asks stay requests (n 960)`. It is the first gate in the network block. The simulated reviewer is `review: "auto"`.
