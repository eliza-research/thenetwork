# Address a relay request to the intended match

## Story: Ask the agent to relay my own words

> As a member, I want a clear request such as “Could you tell them I won't be long?” to relay the words I chose.

### Separate a direct request from its message

The reader accepts a direct instruction or a polite request to tell,
ask, or let the recipient know something. The message can contain a
negation or a question of its own. The ordinary text leak and safety
checks still apply. A quoted or reported instruction does not direct
the agent. For a text, contact or photo request, a named recipient must
match the counterpart of the selected mutual match. The request keeps
the name of the selected directive. A trailing named recipient must be
complete. A longer unsupported name leaves a private request unapproved.
An affirmative reply that supplies a recipient uses that same check.

```quint
pure def relayRecipientAllowed(named: bool, counterpartMatches: bool): bool =
  not(named) or counterpartMatches

pure def lawNamedRelayRequiresTheSelectedCounterpart(named: bool): bool =
  named implies not(relayRecipientAllowed(named, false))
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
envelope, evaluate that directive's own recipient and consent. A reported
request cannot give consent. The directive must pass the same refusal,
condition, and timing checks as a standalone phone request. A separate
request to share a photo or other contact information uses the existing
text-envelope rules.

```quint
pure def relayEnvelopeTextAllowed(delegatedPrivateRequest: bool, directNumberRequest: bool): bool =
  not(delegatedPrivateRequest or directNumberRequest)

pure def lawDirectNumberRequestTakesPrecedence(delegatedPrivateRequest: bool): bool =
  not(relayEnvelopeTextAllowed(delegatedPrivateRequest, true))
```
