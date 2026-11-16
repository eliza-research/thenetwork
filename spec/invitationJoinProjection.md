# Invitation join projection

## Story: Hear when someone I invited joins in another city

> As an inviter, I want the same private join notice when the invitee lives in another supported city.

### The invitee's conversation owns its welcome

Only the verified join's conversation owner can start its welcome. The welcome and its completion marker commit together. The same runtime can project both actions when it owns both conversations.

```quint
pure def projectInvitationWelcome(verifiedJoin: bool, ownsInvitee: bool, welcomeProjected: bool): bool =
  verifiedJoin and ownsInvitee and not(welcomeProjected)

pure def lawInvitationWelcomeRequiresOwner(verifiedJoin: bool, welcomeProjected: bool): bool =
  not(projectInvitationWelcome(verifiedJoin, false, welcomeProjected))
```

### The inviter's conversation owns a notice after the welcome

A separate runtime can record the notice after the verified welcome commits. It uses an app-owned first-name view of the attributed invitee only for notice delivery. The view does not add the invitee to matching or the inviter's member state. Retry through the correct conversation owner until the notice is projected or the invitation attribution is erased. The normal outreach policy and the current authority of both participants govern disclosure.

```quint
pure def projectRemoteInvitationNotice(verifiedJoin: bool, ownsInviter: bool,
  welcomeProjected: bool, noticeProjected: bool): bool =
  verifiedJoin and ownsInviter and welcomeProjected and not(noticeProjected)

pure def lawInvitationNoticeRequiresWelcome(verifiedJoin: bool, ownsInviter: bool, noticeProjected: bool): bool =
  not(projectRemoteInvitationNotice(verifiedJoin, ownsInviter, false, noticeProjected))

pure def lawInvitationNoticeCannotProjectTwice(verifiedJoin: bool, ownsInviter: bool, welcomeProjected: bool): bool =
  not(projectRemoteInvitationNotice(verifiedJoin, ownsInviter, welcomeProjected, true))
```
