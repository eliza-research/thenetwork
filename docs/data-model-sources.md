# Data model: profile richness and connected sources

Added 2026-10-06 (synthetic generator 1.2.0). The code is in `packages/core/src/types.ts` (the contract), `packages/sim/src/sources.ts` (the simulation) and `scripts/synthetic/` (the dataset).

## Why

The founder asked for two things:
- a range of profile quality, from members the Network barely knows to members it knows well;
- simulated Gmail, connected sources and found social profiles, plus what the Network learns from them.

Every persona still has **complete hidden truth**, so the oracle still knows true compatibility. What the Network *knows* is a separate view. It is tiered and noisy, and matching genuinely gets harder when a profile is sparse.

## Contract (`packages/core/src/types.ts`, additive and optional)

```ts
type SourceKind = "chat" | "vouch" | "ai_memory" | "gmail" | "google_calendar" | "linkedin" | "x"
  | "instagram" | "github" | "strava" | "spotify" | "eventbrite" | "partiful" | "luma" | "personal_website";
type SensitiveCategory = "health" | "finances" | "religion" | "sexuality" | "relationship" | "children";

interface Facet {                       // existing fields unchanged; confidence was already required
  source?: SourceKind;                  // the channel it came from ("chat" = the member said it)
  observedAt?: number;                  // ms; when the evidence was observed. Staleness = now - observedAt
  inferred?: boolean;                   // derived or guessed, as opposed to stated
  confirmedByMember?: boolean;          // the member confirmed it ("What the Network knows about me")
  sensitive?: SensitiveCategory;        // set only on sensitive inferences, which are always agent_private
}

type SourceLink = "oauth" | "profile_url" | "paste" | "found_profile";
type SourceStatus = "connected" | "confirmed" | "pending_confirmation" | "rejected" | "revoked";
interface ConnectedSourceSummary {
  source: Exclude<SourceKind, "chat" | "vouch">;
  link: SourceLink; status: SourceStatus;
  subject: "self";                      // a source only ever describes the member
  connectedAt: number; lastSyncAt?: number;
  observations: number;                 // facets currently derived from it (0 unless connected/confirmed)
}
interface Member { connectedSources?: ConnectedSourceSummary[] }
```

- `provenance` keeps its meaning. Source-derived facets use `"connected_source"`, and `inferred` carries the inferred-versus-stated distinction. `provenanceWeight` in the engine already discounts by `confidence`.
- Statuses:
  - `connected` and `confirmed` are active and produce facets. `confirmed` applies only to a `found_profile` the member said is theirs.
  - `pending_confirmation` produces no facets.
  - `rejected` means a namesake: nothing about that profile is kept.
  - `revoked` means the member disconnected it, and its facets are gone.
- The richness tier is **hidden**. It is not on `Member`.

## Hidden side (harness only)

| Where | Field | Shape |
|---|---|---|
| sim `HiddenTruth` | `richness?` | `"minimal" \| "light" \| "medium" \| "rich" \| "very_rich"` |
| sim `Persona` | `knowledge?` | `Knowledge` = `{ richness, chat: ChatCoverage, sources: ConnectedSourceSummary[], observations: { facet: FacetDraft; truth: "correct" \| "stale" \| "wrong_inference"; note? }[] }` |
| `hidden_truth.jsonl` | `knowledge` | `{ richness, chat, sources, observationTruth: { [facetId]: { truth, note? } } }` |
| `hidden_truth.jsonl` | `personaTexture` | the full LLM prose (occupation, routine, availability, voiceSamples, offers), whether or not it is known |

`ChatCoverage` records what the member actually told the agent. Its fields are `messages`, `interests`, `skills`, `intents`, `intentMode`, `neighborhood`, `occupation`, `availability`, `boundaries`, `disclosure`, `offers`, `voiceSamples` and `bio`. `intentMode` is one of `"none"`, `"vague"`, `"objective"` or `"detailed"`.

**For evals:** stratify by `persona.hidden.richness`. `packages/evals/src/richness.ts` already reads that path. Sim worlds get tiers only when the generator is asked for them: `generatePersonas({ ..., richness: true })` uses the default mix, an object such as `{ minimal: 0.3, ... }` sets a custom mix, and `knowledgeNow` sets the staleness reference time. The option uses its own RNG forks, so every other draw, and hidden truth itself, is identical with it on or off. Scenarios can opt in through `background.richness`. `buildSnapshot` then emits only the known facets and intents, plus `Member.connectedSources`. Truth labels never reach the snapshot.

## Tiers

The tiers are assigned as exact quotas, by rank of a noisy engagement score (archetype plus tenure). Newcomers and never-repliers skew minimal; connectors and very active members skew rich.

| Tier | Share | Chat coverage | Active sources |
|---|---|---|---|
| minimal | 15% | 1-4 messages; name, city, age; 60% have one vague intent (category-level text, no details) | none |
| light | 25% | 4-12 messages; ~35% of stated interests (at least 1), first intent objective only | 0 (55%) or 1 |
| medium | 30% | 12-40 messages; ~60% of interests and skills, all intents with details | 0-2 |
| rich | 20% | 40-120 messages; ~85% of interests and skills, own bio | 1-3 |
| very_rich | 10% | 120-400 messages; everything stated | 3-6 |

## Sources and what they yield

The observations are a deterministic function of hidden truth plus seeded noise. Each source covers only part of a member's interests.

| Source | Yields |
|---|---|
| Gmail | Newsletter, receipt and ticket interests; a work-domain hint about the employer type; calendar-invite evenings |
| Google Calendar | Free evenings and a weekday busy block |
| LinkedIn | Role, employer type, seniority and professional skills |
| Instagram | Visual hobbies, places (coarse neighborhood) and aesthetic |
| GitHub | Tech skills and interests |
| Strava | Sports, the neighborhood where routes start, and workout times |
| Spotify | Music taste |
| Eventbrite, Partiful, Luma | Event attendance by topic |
| Personal website | Skills and portfolio topics |
| X | Topics they post about |
| AI-memory paste | Interests, skills and non-romance goals |

**Noise:**
- **Stale facts:** a LinkedIn or website job that is years old, or an old goal in the AI memory. These carry high confidence and an old `observedAt`.
- **Wrong inferences:** a gift purchase read as the member's own hobby, a partner's Spotify on a shared account, an Instagram post about a friend's hobby, a colleague's endorsement, a calendar that looks free.
- **Partial coverage** of the member's interests.
- **No sources at all:** 189 of the 500 members connected nothing.

**Member confirmation:** members confirm only *correct*, non-sensitive facets. The rate rises with tier.

**Default visibility:**
- Sensitive inferences and anything about a minor are `agent_private`.
- A confirmed interest, availability or offer is `shareable`.
- Everything else is `matchable`.
- An unconfirmed inference is never `shareable`. This now holds for chat-inferred interests too.

**Sensitive inferences** come from Gmail only. They cover health (pharmacy or clinic receipts), finances (overdraft notices), religion (donations), sexuality (community newsletters), relationship (a breakup in email) and children (school newsletters, with the school withheld). They are always `agent_private` and tagged `sensitive` and `sensitive:<cat>`. They never name anyone, and they are never confirmed.

**Minors (honest, stated age < 18):**
- They may connect only Google Calendar, Spotify or GitHub.
- There is no Gmail, no social sources, no location sources and no profile discovery.
- Every facet is `agent_private`.

**Non-members:**
- Sources and found profiles always describe the member (`subject: "self"`).
- Rejected namesakes keep no data.
- No source facet names another person, a handle or a URL.

## Dataset numbers (data/synthetic/v1, 1.2.0)

**Tiers:** minimal 75, light 125, medium 150, rich 100, very_rich 50.

| Tier | Facets per member | Coverage of true interests | Active sources (mean) | Median chat messages |
|---|---:|---:|---:|---:|
| minimal | 0.21 (policy facets only) | 0% | 0 | 2 |
| light | 5.5 | 41% | 0.46 | 8 |
| medium | 10.2 | 65% | 0.92 | 26 |
| rich | 17.5 | 84% | 2.09 | 75 |
| very_rich | 24.9 | 98% | 4.38 | 208 |

**Sources:**
- **Entries:** 529 connected, 95 confirmed found profiles, 32 pending, 22 rejected namesakes, 21 revoked.
- **Active sources by kind:** Calendar 101, Gmail 92, LinkedIn 73, Spotify 68, Instagram 62, GitHub 49, AI memory 33, X 33, Strava 26, website 23, Luma 22, Partiful 21, Eventbrite 21.
- **Source facets:** 1,501 in total: 1,314 correct, 148 wrong inferences and 39 stale. 553 of them are member-confirmed.
- **Sensitive inferences:** 58, all `agent_private`.
