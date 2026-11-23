# Address a relay request to the intended match

## Story: Ask the agent to relay my own words

> As a member, I want a clear request such as “Could you tell them I won't be long?” to relay the words I chose.

### Separate a direct request from its message

The reader accepts a direct instruction or a polite request to tell,
ask, or let the recipient know something. The message can contain a
negation or a question of its own. The ordinary text leak and safety
checks still apply. A quoted or reported instruction does not direct
the agent. A named recipient must match the counterpart of the selected
mutual match.

```quint
pure def relayTextRecipientAllowed(named: bool, counterpartMatches: bool): bool =
  not(named) or counterpartMatches

pure def lawNamedRelayRequiresTheSelectedCounterpart(named: bool): bool =
  named implies not(relayTextRecipientAllowed(named, false))
```

### Use a named recipient only when one counterpart has that name

When the member names a recipient without selecting a match, look for the
name in the member's open mutual matches. If exactly one counterpart has
that name, use the newest open match with that person. Several open matches
with the same person still name one counterpart. If zero or more than one
counterpart has that name, refuse the request. A selected match must still
be open and its counterpart's name must agree. If the request does not name
a recipient or select a match, use the newest open match as before. Use the
same match to check both accounts, a selected photo, and delivery.

```quint
pure def relayNamedCandidateAllowed(distinctCounterparts: int): bool =
  distinctCounterparts == 1

pure def lawNamedRelayAcceptsExactlyOneDistinctCounterpart(distinctCounterparts: int): bool =
  relayNamedCandidateAllowed(distinctCounterparts) == (distinctCounterparts == 1)
```

### An unnamed number request leaves a different pending match alone

A number swap needs a request from each person on the same match. The swap
notice asks the recipient to name the person who requested the swap, using
only the first name already shown in the match. When a number request has
no name or selected match, do not use the newest match if a different open
match has a live incoming swap for that member. Ask the member to name the
recipient. Open no swap and expose no number. An expired request or a closed
match cannot prevent using the newest match. A named or selected request
still uses the same current-match, consent and safety checks.

```quint
pure def relayBarePhoneRequestAllowed(barePhoneRequest: bool, competingIncoming: bool): bool =
  not(barePhoneRequest and competingIncoming)

pure def lawCompetingIncomingSwapNeedsARecipient(barePhoneRequest: bool): bool =
  relayBarePhoneRequestAllowed(barePhoneRequest, true) == not(barePhoneRequest)
```

### Polite wording still needs a direct request to send a private item

A modal question can request a private item only if it directly asks the
agent to send that item. Asking about whether to send it leaves it
unapproved. Existing refusal, condition and timing rules still apply.

```quint
pure def relayIsIndirectQuestion(question: bool, modalRequest: bool, directAction: bool, adviceQuestion: bool): bool =
  question and (adviceQuestion or (modalRequest and not(directAction)))

pure def lawIndirectPrivateRelayQuestionLeavesUncertainty(question: bool, adviceQuestion: bool): bool =
  question implies relayIsIndirectQuestion(question, true, false, adviceQuestion)
```
