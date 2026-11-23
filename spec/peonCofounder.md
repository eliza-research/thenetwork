# Peon cofounder matching

## Story: Meet another member who wants a cofounder

> As a Peon member, I want to meet an eligible peer who also asked for a cofounder.

### Two eligible peers must share a home market

Peon admits a peer to the [Cofounder lane](matchLane.md) from a current, explicit cofounder intent in that member's Peon membership. Job postings and general professional goals do not give this permission. Each peer must permit professional introductions and one-to-one meetings, have room for contact, and have no open opportunity. Peers must be in the same home market. The engine also applies its shared adult, hold, pause, block, and reciprocal fit rules.

```quint
pure def peonCofounderMayProfile(appMember: bool, jobSeat: bool, currentIntent: bool, professionalOptIn: bool, acceptsOneToOne: bool, contactOpen: bool, noOpenOpportunity: bool): bool =
  appMember and not(jobSeat) and currentIntent and professionalOptIn and acceptsOneToOne and contactOpen and noOpenOpportunity

pure def peonCofounderMayPair(firstEligible: bool, secondEligible: bool, sameMarket: bool): bool =
  firstEligible and secondEligible and sameMarket

pure def lawCofounderRequiresTwoEligiblePeers(appMember: bool, jobSeat: bool, currentIntent: bool, professionalOptIn: bool, acceptsOneToOne: bool, contactOpen: bool, noOpenOpportunity: bool, secondEligible: bool, sameMarket: bool): bool =
  peonCofounderMayPair(peonCofounderMayProfile(appMember, jobSeat, currentIntent, professionalOptIn, acceptsOneToOne, contactOpen, noOpenOpportunity), secondEligible, sameMarket)
    implies (appMember and not(jobSeat) and currentIntent and professionalOptIn and acceptsOneToOne and contactOpen and noOpenOpportunity and secondEligible and sameMarket)
```

The bounded search reads same-app, matchable work context. Job-intake data stays in Hire. Only [permitted lane evidence](memberStanding.md) affects standing. A shared goal alone supplies no skill or offer. The engine's reciprocal fit rule, not this definition, lets a pair pass only when both peers receive useful work from the other.

A proposal retains both source intent references for revalidation. It has no job seat, employer summary, warm-path intermediary, or alternate participant. It goes to review by the judge, or by staff for an exception, before any probe. Changed (owner decision 2026-11-22, D15 to D17): it went to human review; now the review judge decides and staff decide only the items that the judge holds. Each peer must agree to the proposed introduction before reveal. The hiring rubric applies to Hire.
