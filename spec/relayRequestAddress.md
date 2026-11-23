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

### A separate direct phone request can take the place of a text envelope

When the sender gives an independent direct request to send their number after the text
envelope, evaluate that directive's own recipient and consent. Quoted words or words
introduced as the body by a colon stay in the message. A complete quoted body can
end before a separate directive. When a colon can still be part of a longer
unresolved address, leave the request unapproved. The directive must pass the same refusal,
condition, and timing checks as a standalone phone request. If the separate
phone request is uncertain, retain only the preceding ordinary message addressed
by the sender. A condition that begins the separate phone clause does not give
consent. The retained message must contain no private transfer instruction or unfinished prior assent.
A refusal keeps
the existing withdrawal path. A separate request to share a photo or other
contact information uses the existing text-envelope rules.

```quint
pure def relayEnvelopeTextAllowed(delegatedPrivateRequest: bool, directNumberRequest: bool, uncertain: bool, refused: bool, bodyContainsPrivateInstruction: bool): bool =
  not(delegatedPrivateRequest) and
    (not(directNumberRequest) or (uncertain and not(refused or bodyContainsPrivateInstruction)))

pure def lawDirectNumberRequestTakesPrecedence(delegatedPrivateRequest: bool): bool =
  not(relayEnvelopeTextAllowed(delegatedPrivateRequest, true, false, false, false))

pure def lawUncertainNumberRequestKeepsOnlyOrdinaryText(refused: bool, bodyContainsPrivateInstruction: bool): bool =
  relayEnvelopeTextAllowed(false, true, true, refused, bodyContainsPrivateInstruction) == not(refused or bodyContainsPrivateInstruction)
```
