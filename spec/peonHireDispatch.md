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

### A manager answers one hiring question at a time

A posting draft or an open probe owns the manager's next answer. When an applicant consents while such a question is open, keep the reviewed introduction waiting. Offer the longest-waiting manager question first when there is room. If the manager starts a posting draft, the current manager question can return afterward while the same reviewed introduction and its original deadline still allow it. Send a new copy and require the receipt for that copy before accepting an answer. A displaced copy cannot leave the outbound queue or return as a stored reply.

```quint
pure def managerQuestionMayOpen(postingOwnsSlot: bool, otherProbeOwnsSlot: bool, olderManagerProbeWaiting: bool): bool =
  not(postingOwnsSlot or otherProbeOwnsSlot or olderManagerProbeWaiting)

pure def managerQuestionDeliveryCurrent(managerProbe: bool, sameOpportunity: bool, sameDelivery: bool): bool =
  not(managerProbe) or (sameOpportunity and sameDelivery)

pure def managerQuestionDeadline(opportunityDeadline: int, originalStaged: bool, originalStageAt: int, responseMs: int): int =
  val originalDeadline = originalStageAt + responseMs
  if (originalStaged and originalDeadline < opportunityDeadline) originalDeadline else opportunityDeadline

pure def lawPostingOwnsManagerAnswer(otherProbeOwnsSlot: bool, olderManagerProbeWaiting: bool): bool =
  not(managerQuestionMayOpen(true, otherProbeOwnsSlot, olderManagerProbeWaiting))

pure def lawDisplacedManagerProbeCannotLeave(sameOpportunity: bool): bool =
  not(managerQuestionDeliveryCurrent(true, sameOpportunity, false))

pure def lawManagerQuestionKeepsDeadline(opportunityDeadline: int, originalStageAt: int, responseMs: int): bool =
  managerQuestionDeadline(opportunityDeadline, true, originalStageAt, responseMs) <= opportunityDeadline
    and managerQuestionDeadline(opportunityDeadline, true, originalStageAt, responseMs) <= originalStageAt + responseMs
```
