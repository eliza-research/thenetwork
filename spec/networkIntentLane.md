# The Network intent lanes

The Network uses a member's current [standing intent](standingIntent.md) to choose one [relationship lane](matchLane.md). The app shell recognizes an explicit lane tag or the wording of the ask. Adult eligibility, category consent, reciprocal fit and human review still apply before a proposal can reach anyone.

## Story: Use my request as the purpose of the introduction

> As a member seeking mentorship, funding or a cofounder, I want the search for that request to use the relationship I asked for.

### One request can open one lane

An investment, mentorship or cofounder request routes only to its specific lane and side. Intro serves professional requests without a specific relationship. Other eligible asks may open Friend. This path excludes romance and Network growth. The shell can use a saved matching goal's explicit lane tag for the ordinary lanes.

```quint
type NetworkIntentRoute =
  NoRoute | FriendRoute | IntroRoute | CofounderRoute | MentorOfferRoute | MentorSeekRoute | InvestOfferRoute | InvestSeekRoute

pure def networkIntentRoute(eligibleCategory: bool, specific: NetworkIntentRoute, professional: bool): NetworkIntentRoute =
  if (not(eligibleCategory)) NoRoute
  else if (specific != NoRoute) specific
  else if (professional) IntroRoute else FriendRoute

pure def lawExplicitNetworkIntentKeepsItsRoute(specific: NetworkIntentRoute, professional: bool): bool =
  (specific != NoRoute) implies networkIntentRoute(true, specific, professional) == specific

pure def lawNetworkIntentDefaultsOnlyWithNoSpecificRoute(professional: bool): bool =
  networkIntentRoute(true, NoRoute, professional) == (if (professional) IntroRoute else FriendRoute)

pure def lawExcludedNetworkIntentHasNoRoute(specific: NetworkIntentRoute, professional: bool): bool =
  networkIntentRoute(false, specific, professional) == NoRoute
```

### Each cofounder peer explicitly opts in under their app account

The [Cofounder introduction authority](cofounderDispatch.md) requires a live signed standing intent from each peer. That intent is the only source of consent for a cofounder introduction. The direct one-to-one proposal carries both exact intent IDs as internal authorization facts. Events, repeat encounters, warm paths and recruiting prompts use their own purposes. Closing or expiring either intent removes that peer from the next matching run.
