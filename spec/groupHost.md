# Eligible host for a group

## Story: A group that needs a host gets an eligible host

> As an invitee, I want a group with a required host to include someone eligible to serve in that role.

### Use the same eligibility to choose and assign the host

A host designation can count only when the member is eligible for the
host role in the current group. A member assigned another role does not
count as its host. Search for an eligible alternative if the preferred
member cannot host. A group with a required host cannot proceed without
one. An explicit host assignment needs the same eligibility.

```quint
pure def groupHostEligible(designated: bool, otherRole: bool, roleAllowed: bool): bool =
  designated and not(otherRole) and roleAllowed

pure def lawAHostPassesCurrentRoleEligibility(designated: bool, otherRole: bool, roleAllowed: bool): bool =
  groupHostEligible(designated, otherRole, roleAllowed) implies roleAllowed and not(otherRole)
```
