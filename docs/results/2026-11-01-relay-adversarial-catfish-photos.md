# A catfish with someone else's photos: a blocking adversarial gate for the relay photo path

Date: 2026-11-01. Hand-written by the contributor. No model output is in this report. The
scenario suite is deterministic (seeded; the same seed replays the same cases).

## The requirement

The MVP plan (docs/mvp-plan.md, "Still missing in sim") and mvp-gaps 4.1 ("Adversarial scenarios
against the live agent", missing column) both require adversarial scenarios against the relay,
among them "a catfish with someone else's photos"; mvp-plan's P8 row carries "age-liar and catfish
signals" as a pilot risk, and the tracked gate list keeps an adversary-contact cut. The relay slice
of that requirement is the policy suite that already gates a scam after the reveal, a number swap
before both yeses, a leak of the other member's details, a minor in the relay, and the probe
photo (`packages/sim/src/apps/slop/adversarial.ts`, blocking in `bun run sim --only relay`; merged
in 06ec520 and d61e59a, which added the suite and its scenarios). The catfish entry was missing.

## The scenario

`catfish_photos` drives the real policy (`relayItem`, the function the live RelayDesk calls) with
photo items whose ids are not the sender's own:

- the recipient's own photo sent back to them (the re-relay of a photo the victim shared);
- a third member's photo (the true catfish: someone else's photos);
- an id nobody owns;
- one stolen id smuggled among the sender's own photos.

Every sender carries photo consent and a well-formed per-item consent that names exactly the ids
being sent, so the only rule under test is ownership. The gate asserts: never delivered, no
rendered text, no photo ids, no partial set (the item is withheld whole), and the reason is
`photo:not_owned`. The control (the sender's own photo, the same consent shape) must pass and carry
the photo, so the gate can never pass vacuously.

## The evidence

`bun run sim --only relay` on the base revision without this change runs 60 blocking gates; with
this change 61, the new gate first:

```text
PASS relay adversarial (slop world, seeds 13,14,15,16): catfish photos (the match's, a third
  member's, an unowned id, one smuggled among the sender's own): never delivered, never a partial
  set; the sender's own photo passes (n 1536): 0 failures; controls 480/480;
  catfish 48, recipientStolen 528, thirdStolen 48, mixed 480, foreign 480, blocked 1536, held 0
```

All 1536 attempts are blocked by `photo:not_owned` (a block family, so no partial hold path exists);
the 480 controls pass. The population generated 48 catfish-typed adversaries across the four
seeds, and every seed ran them.

Model evidence: none; the scenario is rules-only and deterministic. Agent clients: not applicable;
nothing member-facing changes, no production path changes - the change adds a blocking gate to the
validation layer.

## Validation

Same machine, Bun 1.4.4, dev PostgreSQL 16 on :54339. `bun run typecheck` clean on all four
projects; `bun run sim` (full) summary pasted in the pull request; the relay block runs 61/61
blocking gates.

## Limits

- This gates the relay policy slice, the same slice as the suite's other scenarios. The plan's
  end-to-end worlds (the 30-day slop world of pull request #156) remain the home of the
  full-pipeline catfish path; this gate holds the policy beneath them.
- The typed catfish personas are exercised when the population generates them (48 of them across
  the four seeds this run); the ownership rule itself is exercised on every pair, so the gate never
  depends on the population's adversary draw.
