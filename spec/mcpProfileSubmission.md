# Send an approved connector profile once

## Story: Recover an agent profile submission without sending it again

> As a member who approved a profile in my agent, I want serialized and retried requests under the same connection to apply the same profile once.

### Only the first claim can invoke intake for the exact profile and grant

Validate the current grant, verified phone owner, host app, profile write scope, live membership and daily limit as for any profile call. After those checks, key one claim by the grant and a server-keyed fingerprint of the validated, trimmed profile. Retain only that fingerprint and whether intake confirmed acceptance. Corrected text can take a different claim under the same daily limit. Reusing a fingerprint with a live claim cannot invoke intake again.

```quint
type ProfileClaim = ProfileClaimRefused | ProfileClaimStart | ProfileClaimAccepted | ProfileClaimPending

pure def decideProfileClaim(liveGrant: bool, storedClaim: bool, accepted: bool): ProfileClaim =
  if (not(liveGrant)) ProfileClaimRefused
  else if (not(storedClaim)) ProfileClaimStart
  else if (accepted) ProfileClaimAccepted
  else ProfileClaimPending

pure def lawExistingClaimCannotSendAgain(liveGrant: bool, accepted: bool): bool =
  decideProfileClaim(liveGrant, true, accepted) != ProfileClaimStart

pure def lawEndedProfileGrantCannotSend(storedClaim: bool, accepted: bool): bool =
  decideProfileClaim(false, storedClaim, accepted) == ProfileClaimRefused
```

### A retry returns confirmed acceptance or holds an unresolved intake

Return a successful result only after intake confirms acceptance and the store saves the receipt. On retry, return the saved successful result for the exact profile and grant when the member remains eligible. Leave the claim in place after an exception or lost acceptance receipt. Later requests with that fingerprint report unresolved status, without invoking intake again. When intake explicitly confirms it did nothing because membership is unavailable, release the claim so a later valid request can try again. Remove the claim on grant revocation, expiry cleanup or erasure.

```quint
pure def profileSubmissionAccepted(claim: ProfileClaim, intakeAccepted: bool, receiptStored: bool): bool =
  claim == ProfileClaimAccepted or (claim == ProfileClaimStart and intakeAccepted and receiptStored)

pure def lawUnresolvedProfileNeverReportsAcceptance(intakeAccepted: bool, receiptStored: bool): bool =
  not(profileSubmissionAccepted(ProfileClaimPending, intakeAccepted, receiptStored))

pure def lawIntakeMustRecordReceipt(intakeAccepted: bool): bool =
  not(profileSubmissionAccepted(ProfileClaimStart, intakeAccepted, false))
```

### The Network keeps no copy of the agent's profile text

The member approved the profile in their own agent before the agent submits it. The Network learns the facts from the text in the unit of work that stores the inbound row. The row of profile text from the agent ("mcp") keeps a fixed placeholder body and the type agent_profile, never the raw text. A text that the member wrote in the thread ("thread") keeps its body, except an answer to an invitation feedback question, which keeps a fixed feedback body and the type interruption_feedback. A source that is not known keeps no text. Changed 2026-11-22: the stored row kept the full agent summary with no limit, against the policy to delete raw pasted summaries after confirmation (stories-b-6, stories-a-3). Changed 2026-11-22 after review: the rule now decides the stored body kind, so the shell maps the kind to the body and type and does not choose them itself.

```quint
type InboundBody = InboundBodyAgentProfile | InboundBodyFeedback | InboundBodyText

pure def inboundBody(source: str, feedbackAnswer: bool): InboundBody =
  if (source != "thread") InboundBodyAgentProfile
  else if (feedbackAnswer) InboundBodyFeedback
  else InboundBodyText

pure val sourceValues = Set("thread", "mcp", "")

pure def lawAgentProfileTextNotKept(source: str, feedbackAnswer: bool): bool =
  source != "thread" implies inboundBody(source, feedbackAnswer) == InboundBodyAgentProfile

pure def lawFeedbackAnswerTextNotKept(feedbackAnswer: bool): bool =
  feedbackAnswer implies inboundBody("thread", feedbackAnswer) == InboundBodyFeedback

pure def lawThreadTextKept(feedbackAnswer: bool): bool =
  not(feedbackAnswer) implies inboundBody("thread", feedbackAnswer) == InboundBodyText
```
