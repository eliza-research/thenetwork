# Learn skills from profile text

[Story F6](product/stories.md#story-f6--answer-a-useful-follow-up) uses
facts from the member's profile answers to help the member.

## Story: Match me using skills I say I have

> As a member, I want the Network to learn the skills I say I have so a request for someone else's help does not become a claim about me.

### A sought, quoted or reported skill does not become the member's skill

When the profile reader recognizes a skill, exclude a quotation and a
statement about another person. A skill mentioned after a seeking phrase
needs a separate statement that the member has it. Outside those cases,
a recognized skill in a profile answer can include a short title without
a first-person pronoun. The text reader supplies the evidence about the
clause and the speaker.

```quint
pure def profileSkillMayLearn(quoted: bool, anotherPerson: bool, sought: bool, ownClaim: bool): bool =
  not(quoted or anotherPerson) and (not(sought) or ownClaim)

pure def lawQuotedOrReportedSkillsDoNotBind(quoted: bool, anotherPerson: bool, sought: bool, ownClaim: bool): bool =
  (quoted or anotherPerson) implies not(profileSkillMayLearn(quoted, anotherPerson, sought, ownClaim))

pure def lawSoughtSkillNeedsOwnClaim(ownClaim: bool): bool =
  profileSkillMayLearn(false, false, true, ownClaim) == ownClaim
```
