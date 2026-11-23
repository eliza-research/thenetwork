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

### A name identifies one recipient on an unselected relay

If a signed relay does not select an item, the service keeps its newest open
mutual match. For a named request to that counterpart, refuse the relay when a
different person in another open mutual match has the same name. Multiple
opportunities with the same person do not make their name ambiguous. A
selected item must still come from the original turn and keeps its exact
match. The name must match that counterpart. A photo also needs the current
consent and review for that match. A refusal leaves any existing swap or photo
selection in place.

```quint
pure def relayNameCollisionRefuses(selectedItem: bool, otherCounterpartMatches: bool): bool =
  not(selectedItem) and otherCounterpartMatches

pure def lawNameCollisionRefusesOnlyAnUnselectedRelay(selectedItem: bool, otherCounterpartMatches: bool): bool =
  relayNameCollisionRefuses(selectedItem, otherCounterpartMatches) == (not(selectedItem) and otherCounterpartMatches)
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
