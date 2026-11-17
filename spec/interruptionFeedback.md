# Feedback on a proactive invitation

## Story: Tell the Network whether an invitation was worth a text

> As a member, I want to give private feedback on an invitation without changing my answer to it.

### Sample a confirmed invitation after its own answer

Sample one in ten initial invitations by a stable bucket for the app, member and opportunity. Include explicit acceptance and decline. An invitation qualifies when its provider accepted the send and the member answered the original probe. Keep one pending survey per member. The survey can go out from 24 to 72 hours after the answer, when the member has no open question and the ordinary interruption and transport rules allow it. A survey uses the state interruption budget and the shared person cap.

```quint
pure val interruptionSampleBuckets = 10
pure val interruptionAskWaitMs = 24 * 3600000
pure val interruptionAskUntilMs = 72 * 3600000
pure val interruptionAnswerMs = 48 * 3600000

pure def interruptionFeedbackSample(sampleBucket: int, acceptedDelivery: bool, directReply: bool, pendingSurvey: bool): bool =
  sampleBucket == 0 and acceptedDelivery and directReply and not(pendingSurvey)

pure def interruptionFeedbackAskDue(ageMs: int, eligible: bool, openQuestion: bool): bool =
  ageMs >= interruptionAskWaitMs and ageMs < interruptionAskUntilMs and eligible and not(openQuestion)

pure def lawSurveyNeedsDelivery(sampleBucket: int, directReply: bool, pendingSurvey: bool): bool =
  not(interruptionFeedbackSample(sampleBucket, false, directReply, pendingSurvey))
```

### A direct answer measures the interruption once

Bind the survey code to the same app, member and invitation. Include the app in the reply command so it reaches the correct app on the shared line. Accept a direct affirmative or negative code received after the provider accepts the exact survey and while the survey is current. STOP and a hold invalidate it. A valid answer consumes the survey. Save only its yes or no value for the app scorecard. Count one response per answered survey. Keep the response out of matching and the other participants' messages.

```quint
pure def interruptionFeedbackCurrent(ageMs: int, eligible: bool): bool =
  eligible and ageMs >= 0 and ageMs < interruptionAnswerMs

pure def interruptionFeedbackReply(direct: bool, exactCode: bool, surveyCurrent: bool, reachedMember: bool): bool =
  direct and exactCode and surveyCurrent and reachedMember

pure def lawSurveyReplyNeedsExactCode(direct: bool, surveyCurrent: bool, reachedMember: bool): bool =
  not(interruptionFeedbackReply(direct, false, surveyCurrent, reachedMember))

pure def lawSurveyReplyNeedsDelivery(direct: bool, exactCode: bool, surveyCurrent: bool): bool =
  not(interruptionFeedbackReply(direct, exactCode, surveyCurrent, false))
```
