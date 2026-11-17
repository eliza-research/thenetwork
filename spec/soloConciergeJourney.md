# Ask for public events in a signed turn

The [solo recommendations](soloConcierge.md) rules check age, location and the requested time independently of matching. This journey exercises the Friends signup and signed conversation with two members aged 20 and 16. It publishes a fixture through the [Parks importer](publicEventCatalog.md) and observes the collected replies, stored catalog and app rows in Postgres.

## Story: Get current public ideas without involving other members

> As a member, I want useful public things to do on my own and a current answer when I retry my request.

### Rank public events and collect the result for the requesting member

The full fixture catalog has four options for the adult and one explicitly all-ages option for the younger member. The nature activity ranks first for both members because it fits their stated interest. Earlier start breaks ties between the remaining options. The adult receives the first three choices. The 21+ event and an event outside the requested period do not qualify. A reduced catalog retains the nature and history activities. A request with no eligible events receives an empty-result explanation. The signed turn collects the answer for the requesting member with no requests or opportunities for introductions.

```quint
type PublishedCatalog = NoPublishedEvents | FullCatalog | ReducedCatalog
type Audience = AdultMember | YoungerMember
type PublicListing = NatureWalk | ArtTour | HistoryTour
type CollectedAnswer = NoAnswer | Answered({ listings: List[PublicListing] })
type ConciergeReplay = NoReplay | ReplayedAnswer | RefusedStaleAnswer
type ConciergeEffect = Recommendations({ listings: List[PublicListing] }) | NoFittingEvent | ReplayObserved({ result: ConciergeReplay })
type SoloConciergeJourney = { catalog: PublishedCatalog, adultAnswer: CollectedAnswer, youngerAnswer: CollectedAnswer,
  lastReplay: ConciergeReplay, requests: int, opportunities: int }
type ConciergeStep = { state: SoloConciergeJourney, out: List[ConciergeEffect] }

pure val initial: SoloConciergeJourney = { catalog: NoPublishedEvents, adultAnswer: NoAnswer, youngerAnswer: NoAnswer,
  lastReplay: NoReplay, requests: 0, opportunities: 0 }

pure def eligibleListings(catalog: PublishedCatalog, who: Audience): List[PublicListing] =
  if (catalog == NoPublishedEvents) List()
  else if (who == YoungerMember) List(NatureWalk)
  else if (catalog == FullCatalog) List(NatureWalk, ArtTour, HistoryTour)
  else List(NatureWalk, HistoryTour)

pure def hasAnswer(a: CollectedAnswer): bool =
  match a {
    | NoAnswer => false
    | _ => true
  }

pure def answerListsAre(a: CollectedAnswer, listings: List[PublicListing]): bool =
  match a {
    | Answered(x) => x.listings == listings
    | _ => false
  }

pure def answerFor(s: SoloConciergeJourney, who: Audience): CollectedAnswer =
  if (who == AdultMember) s.adultAnswer else s.youngerAnswer

pure def canPublishCatalog(s: SoloConciergeJourney, catalog: PublishedCatalog): bool = true
pure def publishCatalog(s: SoloConciergeJourney, catalog: PublishedCatalog): ConciergeStep =
  { state: { ...s, catalog: catalog }, out: List() }

pure def canAskForIdeas(s: SoloConciergeJourney, who: Audience): bool = true
pure def askForIdeas(s: SoloConciergeJourney, who: Audience): ConciergeStep =
  val listings = eligibleListings(s.catalog, who)
  val answer = Answered({ listings: listings })
  { state: if (who == AdultMember) { ...s, adultAnswer: answer } else { ...s, youngerAnswer: answer },
    out: List(if (listings.length() == 0) NoFittingEvent else Recommendations({ listings: listings })) }

pure def alwaysSoloDoesNotRecruit(s: SoloConciergeJourney): bool = s.requests == 0 and s.opportunities == 0
pure def alwaysTheYoungerMemberOnlyReceivesAllAges(s: SoloConciergeJourney): bool =
  not(hasAnswer(s.youngerAnswer)) or answerListsAre(s.youngerAnswer, List()) or answerListsAre(s.youngerAnswer, List(NatureWalk))

pure def sometimesRecommendsThreeEventsToTheAdult(s: SoloConciergeJourney): bool =
  answerListsAre(s.adultAnswer, List(NatureWalk, ArtTour, HistoryTour))
pure def sometimesRecommendsAnAllAgesEvent(s: SoloConciergeJourney): bool =
  answerListsAre(s.youngerAnswer, List(NatureWalk))
pure def sometimesReportsNoFittingEvents(s: SoloConciergeJourney): bool =
  answerListsAre(s.adultAnswer, List())
```

### An exact retry must still have the same answer

Retry the original signed request without creating a new collected reply. If the member would still receive the same answer, return the previous answer and reply ID. A change in the public catalog can leave the younger member's answer intact while changing the adult's set. Refuse the stale answer. A new request can receive the current set.

```quint
import soloConcierge as Solo from "./soloConcierge"

pure def canRetryIdeas(s: SoloConciergeJourney, who: Audience): bool = hasAnswer(answerFor(s, who))
pure def retryIdeas(s: SoloConciergeJourney, who: Audience): ConciergeStep =
  val previous = answerFor(s, who)
  val same = answerListsAre(previous, eligibleListings(s.catalog, who))
  val result = if (Solo::soloReplyReplayAllowed(hasAnswer(previous), same)) ReplayedAnswer else RefusedStaleAnswer
  { state: { ...s, lastReplay: result }, out: List(ReplayObserved({ result: result })) }

pure def sometimesReplaysACurrentAnswer(s: SoloConciergeJourney): bool = s.lastReplay == ReplayedAnswer
pure def sometimesRefusesAStaleAnswer(s: SoloConciergeJourney): bool = s.lastReplay == RefusedStaleAnswer
```
