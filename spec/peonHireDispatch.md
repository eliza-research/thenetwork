# Keep a reviewed Peon introduction current

## Story: Stay in charge of a Peon job search

> As a candidate, I want my current job search and private company exclusions to apply until an introduction goes out.

### A review covers this candidate search and these posting terms

Bind each Hire review to the exact active search, the hiring company's verified identity and the posting terms used to prepare the candidate offer. A paused or expired search does not permit contact. Resuming the same search can use a review that is still current and whose opportunity is still open. A replaced or closed search, a changed posting or company, a lost verification, or a current company exclusion prevents contact. A new introduction requires its own review. Company exclusions stay private.

```quint
pure def hireEvidenceCurrent(searchActive: bool, sameSearch: bool, samePosting: bool,
    employerVerified: bool, companyAllowed: bool): bool =
  searchActive and sameSearch and samePosting and employerVerified and companyAllowed

pure def lawHireWithdrawalBlocksContact(sameSearch: bool, samePosting: bool, employerVerified: bool, companyAllowed: bool): bool =
  not(hireEvidenceCurrent(false, sameSearch, samePosting, employerVerified, companyAllowed))

pure def lawHireCompanyExclusionBlocksContact(searchActive: bool, sameSearch: bool, samePosting: bool, employerVerified: bool): bool =
  not(hireEvidenceCurrent(searchActive, sameSearch, samePosting, employerVerified, false))
```

### An employer hears only after the candidate accepts

Before a queued or collected probe leaves the service, recheck the exact reviewed evidence and the current stage. The candidate is offered the role first. The hiring manager's blind review requires the candidate's consent to that opportunity. Count a member's direct answer only after the exact question was accepted for delivery and before its deadline. Reveal needs fresh agreement from both sides to the same reviewed opportunity. The rule applies again before returning a stored signed reply. The service keeps other safety, delivery and review checks. After contact is accepted by the provider, normal meeting and cancellation logistics still apply.

```quint
pure def hireContactAllowed(evidenceCurrent: bool, reviewed: bool, phaseCurrent: bool,
    employerProbe: bool, reveal: bool, candidateYes: bool, employerYes: bool): bool =
  evidenceCurrent and reviewed and phaseCurrent
    and (not(employerProbe or reveal) or candidateYes)
    and (not(reveal) or employerYes)

pure def lawEmployerCannotBeContactedFirst(evidenceCurrent: bool, reviewed: bool, phaseCurrent: bool, employerYes: bool): bool =
  not(hireContactAllowed(evidenceCurrent, reviewed, phaseCurrent, true, false, false, employerYes))

pure def hireAnswerAllowed(direct: bool, delivered: bool, receivedAt: int, deliveredAt: int, at: int, deadline: int): bool =
  direct and delivered and receivedAt >= deliveredAt and receivedAt <= at and at < deadline

pure def lawHireAnswerRequiresDelivery(direct: bool, receivedAt: int, deliveredAt: int, at: int, deadline: int): bool =
  not(hireAnswerAllowed(direct, false, receivedAt, deliveredAt, at, deadline))
```

### A closed application keeps its recorded answers

Keep the candidate's and employer's own answers after the exact reply checks above. If a reviewed application closes before booking, attribute each recorded answer to its participant. An explicit no records a decline for the participant who answered. A timeout or an administrative closure supplies no answer on its own. Review rejection and expiry supply no application history.

```quint
type HireProbeHistory = HireProbeUnrecorded | HireProbeAccepted | HireProbeDeclined

pure def hireClosedProbeReply(answer: str): HireProbeHistory =
  if (answer == "yes") HireProbeAccepted
  else if (answer == "no") HireProbeDeclined
  else HireProbeUnrecorded

pure def hireProbeWasDeclined(existingDecline: bool, recordedDecline: bool): bool =
  existingDecline or recordedDecline

pure def lawUnrecordedHireReplyAddsNoAttribution(answer: str): bool =
  not(answer == "yes" or answer == "no") implies hireClosedProbeReply(answer) == HireProbeUnrecorded
```
