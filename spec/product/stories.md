# Member and staff stories

The `F1`–`F29` identifiers retain the original [PRD flow IDs](source/prd.md#29-user-flows-and-interactions-mvp-and-later). Later stories carry separate IDs. A named model is a starting point for the state and rules of the flow. Check its coverage before relying on it as evidence for a complete journey.

## Story F1 — Invite and vouch

> As a member, I want to invite someone I can vouch for so they can decide whether to join.

### An invitation has provenance, allowance and an end

Check the member's invite allowance, normally three per month. Save their vouch as invite evidence with the relationship and its strength. Flag a weak or unusual invite for a human. By default, the inviter forwards the invitation. The service can send one when the inviter confirms it is expected, with attribution and opt-out. An unanswered invitation gets no follow-up.

Keep vouch notes outside matching until the invitee joins and consents. Clear notes when declined or after 30 days. An existing member's status and onboarding details stay private. A decline stops contact, and age policy applies at acceptance.

When someone joins through the invitation, tell the inviter using their first name and join status. Apply the delivery rules and carry the notice on a genuine reply when it cannot go out separately. [Invite join notice](../outreachPolicy.md#an-eligible-join-receipt-can-ride-on-a-current-reply).

[Member invitation rules](../memberInvitation.md) cover the confirmation, allowance, private vouch, and referral. [Expected invitation delivery](../expectedMemberInvitation.md) covers the separately confirmed service send. [Join projection](../invitationJoinProjection.md) covers welcome and notice ownership when the two members live in different cities.

## Story F2 — Seed a cohort

> As an operator, I want to seed the first cohort with attributed invitations so we can establish a useful local network.

### Seed invitations use the same acceptance rules

Authorize a staff member to create individually attributable invites with city and vouch context. F1 and F3 still govern who can be contacted and how an invite becomes a membership. The cohort receives no permanent rank or special member status. [Seed invitation rules](../seedInvitation.md) cover the batch and its verified recipient binding.

## Story F3 — Accept an invite and verify identity

> As an invitee, I want to verify my own phone and accept an invitation without losing an existing account.

### A membership belongs to a verified, eligible person

Require phone verification, current app consent, age and a valid invite where required. Joining from a new verified number goes through identity linking or staff recovery. Duplicate joins attach to the existing person without exposing other memberships. A banned number cannot join, and an under-13 join creates no membership.

Models: [generated site enrollment](../siteEnrollment.md), [join and age](../models/join_age.md), [historical browser join](../models/join_flow.md), [identity lifecycle](../models/identity_sagas.md), [phone identity](../models/phone_identity.md), [member age rules](../memberAge.md), [phone verification limits](../otpLimits.md).

## Story F4 — Onboard in conversation

> As a new member, I want to tell the agent enough to help me and correct what it understood.

### The member confirms what the app learns

Use a short, resumable conversation. Explain consent and where facts came from. Ask what the person wants, enjoys giving, where and when they can participate, and what kinds of messages are worth receiving. Record app-specific preferences and provenance. Read back the draft. Confirm and save only what the person approved. Offer an immediate single-player answer or useful suggestion where possible. Apply adult eligibility before dating or photo intake.

The site entry stays in the person's current agent where direct signup is supported. Use the separate [agent signup rules](policies.md#age-identity-and-enrollment). A person can also choose the shared text line as their entry.

Models: [join flow](../models/join_flow.md), [profile learning](../models/profile_learning.md), [Peon job search](../peonCandidateSearch.md), [agent loop](../models/chatjson_loop.md), [authorization](../models/auth_edge.md).

## Story F5 — Review and correct my profile

> As a member, I want to see and correct what the agent knows about me.

### A read is private and creates no new onboarding turn

Return the person's own app profile, with source and scope as applicable. Ask for explicit approval to correct, remove or change how a fact may be used. Remove its derived data where required and apply the change at the next relevant engine read. A saved-profile readback must not advance onboarding or claim a pending draft was saved.

In the signed text conversation, `SHOW MY FACTS` shows saved facts for the current app. The member can use a fact reference to request a correction, removal, or scope change. The member confirms the exact edit using a short-lived code. A stale fact or a different app or member cannot use that code.

In an authorized assistant, `read_profile` shows safe fields saved in the requesting member's current app. The person grants profile read access separately in their browser. Reading a profile makes no profile edits and starts no new onboarding.

Models: [generated saved-profile read](../savedProfileRead.md), [connector tools](../connectorTools.md#read-saved-profile-fields-only-for-this-apps-active-member), [profile fact review and edits](../profileFactEdit.md), [profile isolation and app leave](../savedProfileJourney.md), [profile read flow](../models/profile_read.md), [profile learning](../models/profile_learning.md).

## Story F6 — Answer a useful follow-up

> As a member, I want the agent to ask a short follow-up when the answer would materially improve its help.

### At most one profiling question is open

Prefer confirming a stated fact or specific guess to a broad questionnaire. Ask when timely, respect delivery and one-question constraints, and accept a correction. A message with a new opportunity also spends the relevant initial-invite allowance. Learned signals can make outreach quieter. More outreach requires the member's choice.

Models: [profile learning](../models/profile_learning.md), [outbound queue](../models/outbound_queue.md).

## Story F7 — Connect my own information

> As a member, I want to approve useful facts from a source I control.

### Imports are limited to the member and require confirmation

Offer authorized Google Calendar free/busy, pasted LinkedIn profile text, an allowed X profile or approved connection, or a summary from the member's agent. Mark proposed facts with source, confidence and scope. Persist confirmed facts, remove raw pasted summaries after confirmation, and support revocation. Exclude sensitive inferences and other people's private details.

Models: [calendar free/busy](../calendarFreeBusy.md), [OAuth and MCP](../models/oauth_mcp.md), [profile learning](../models/profile_learning.md), [source collection and cleanup](../profileSuggestionSource.md), [suggestion review](../profileSuggestionReview.md).

## Story F8 — Ask for something

> As a member, I want to ask a question or ask for help without learning the system's categories.

### Search and tools come before asking another person

Classify the request into an answer, a recommendation, a standing intent, or a draft member opportunity. Use available knowledge before spending a person's attention. Explain what will happen and give a likely time when creating a draft. Avoid promising a match. A draft that would contact a person passes review and consent.

Models: [agent loop](../models/chatjson_loop.md), [member request admission](../memberRequest.md), [request and review journey](../memberRequestJourney.md), [opportunity](../models/opportunity.md), [review desk](../models/review_desk.md).

## Story F9 — Keep a standing intent

> As a member, I want the agent to keep looking for a thing I want and stop when I ask.

### A standing intent can be managed and goes stale

Record the objective, essential constraints, source and time horizon. List, pause or close it on request. Re-evaluate when relevant evidence or supply changes. Expire or reconfirm at 60 days. A later suggestion still needs current eligibility and consent.

Models: [profile learning](../models/profile_learning.md), [standing intent freshness](../standingIntent.md), [standing intent management](../standingIntentManagement.md), [cofounder standing intent](../cofounderIntent.md), [public event supply](../publicEventCatalog.md), [request retry and withdrawal](../memberRequest.md), [matching engine](../models/matching_engine.md).

## Story F10 — Get concierge value

> As a member, I want useful suggestions even when the Network knows nobody who fits.

### Recommendations come from fresh, permitted sources

Return 1–3 options with a useful reason based on interests, location, availability and age. Use permitted public sources and do not imply another member is involved. Minors may receive age-appropriate solo suggestions. A resulting co-attendance proposal follows F13.

The signed conversation answers a direct request such as “Anything fun this weekend?” from current NYC Parks listings. An event must carry an explicit all-ages label for a minor to receive it. A separate process publishes fresh data. With no eligible listing, the reply says it found none. A recommendation does not create a match or booking.

Models: [solo event recommendations](../soloConcierge.md), [signed solo concierge journey](../soloConciergeJourney.md), [public event supply](../publicEventCatalog.md), [matching engine](../models/matching_engine.md).

## Story F11 — Consider a one-to-one introduction

> As an eligible member, I want enough information to decide whether I want an introduction while my identity stays private.

### Review, anonymous probe and independent consent precede reveal

Approve a proposal before any contact. Check budget and eligibility again at dispatch. The first person gets an anonymous text-only probe with a shareable reason, time or effort and an easy decline. Ask the second person only after the first says yes. Both must opt in independently before first names or a relay are revealed. A decline stays private. Expire generic probes after the configured window, normally 48 hours. Slop probes and scheduling each use a 24-hour window.

Models: [opportunity lifecycle](../opportunityLifecycle.md), [opportunity](../models/opportunity.md), [matching engine](../models/matching_engine.md), [review desk](../models/review_desk.md), [outbound queue](../models/outbound_queue.md).

### A proposed pair is a good exchange in both directions

Propose a pair only when its lane gives it a pair value: both members reach the lane's utility floor, their private standing gap after the lane's offset stays inside the lane's band plus both uncertainties, and a lane that requires balance has a balanced exchange.

Models: [reciprocal pair value](../pairValue.md), [relationship lanes](../matchLane.md), [exact cofounder consent](../cofounderDispatch.md), [Peon cofounder matching](../peonCofounder.md), [matching engine](../models/matching_engine.md).

### Standing stays private and earned

Compute standing only from evidence points (unreviewed points at half weight) and private ratings for an adult with the lane's consent, never from acceptance, reply or popularity counts, and never show it to a member or put it in a reason, probe or relay text.

Models: [private member standing](../memberStanding.md), [matching engine](../models/matching_engine.md).

### Candidate search is bounded and exact when it says so

Use the lane's limits on pair checks and index entries visited for each search. When the search closes as exact, keep the same best candidates that a full scan of the eligible members would keep.

Models: [bounded candidate search](../candidateSearch.md), [candidate pool](../models/candidate_pool.md).

### Greedy selection leaves no blocking pair

Reserve greedy choices in order of non-increasing pair value, never pass a pack refusal in any phase, and refuse a greedy choice only when one of its members has no room left, so every reservation that filled that member has a value at least as high as the refused choice.

Models: [global selection](../selectionRun.md), [matching engine](../models/matching_engine.md).

## Story F12 — Join a small group

> As a member, I want to join a public activity if enough eligible people accept.

### A reviewed group needs quorum

Anchor a group of 3–6 to a public activity, place or event and add a host when needed. Probe anonymously under review. Enforce the approved deadline and quorum, typically three for a plan. Use eligible alternates under review and release members without revealing declines if quorum fails. Book and relay only for consenting participants.

Models: [reviewed group journey](../reviewedGroupJourney.md), [plan run](../models/plan_run.md), [opportunity](../models/opportunity.md), [plan crew](../models/plan_crew.md).

### Every pair in a circle fits

Admit a circle only when its size is inside the lane's circle bounds, every pair in it has a pair value at or above the lane's circle floor, and the spread of private standing stays inside the lane's band plus the members' uncertainties.

Models: [group formation](../groupFormation.md), [reciprocal pair value](../pairValue.md), [relationship lanes](../matchLane.md), [candidate pool](../models/candidate_pool.md).

## Story F13 — Meet at an event

> As a member already interested in an event, I want the option to meet others there.

### An event suggestion and a member introduction are different actions

Suggest public events independently. When connecting members at the event, check compatible plans, review the proposal and ask each participant independently before disclosing identities. A minor's event suggestion is solo.

Use a current listing from an accepted source. If the listed place or time changes during review or consent, retire the pending proposal. A booking uses the reviewed listing's place and time.

Models: [public event catalog](../publicEventCatalog.md), [matching engine](../models/matching_engine.md), [opportunity](../models/opportunity.md).

## Story F14 — Ask for bounded help

> As a member, I want a specific, manageable form of help when a tool or service cannot solve it.

### A help request names its effort and passes safety review

Try information and services first. Consider adults who opted into that kind of help and have capacity. State the request, time and effort clearly, review it before contacting anyone, and collect feedback afterwards. Requests requiring entry to a home are medium-risk exceptions to the public venue default. Require two or more helpers or a helper already known to the requester, plus review and consent from everyone before revealing an address. Route a request with a single unfamiliar helper to safety review.

Models: [bounded help admission](../boundedHelp.md), [reviewed roster consent](../homeHelpConsent.md), [private address release](../privateHomeHelpVenue.md), [matching engine](../models/matching_engine.md), [review desk](../models/review_desk.md), [safety and trust](../models/safety_trust.md).

## Story F15 — Ask for an introduction

> As a member, I want to suggest or request an introduction that people can decline privately.

### A member request follows the same review and consent path

Route the request to a reviewed member opportunity. Probe the two adults independently and connect them only on mutual yes. If the person is outside the Network, use the invitation rules. Keep information about their enrollment and their reply private.

Models: [opportunity](../models/opportunity.md), [review desk](../models/review_desk.md).

## Story F16 — Relay what I choose

> As a matched member, I want to send a message, a chosen photo or my number through the agent while keeping control of what is shared.

### Every relay item has consent and a dispatch check

Open the thread after the required match consent. Identify the sender and share only approved content. Optional number exchange requires both sides to agree. A withdrawal stops the pending request and any share that has yet to pass final dispatch admission. Forward a photo only when a member selects it and per-item policy allows it. Apply moderation and leak checks, hold risk for staff, and close affected access on STOP, leave, block, hold or match closure. Announce delivery only when the sender system confirms it.

Models: [relay](../models/relay.md), [photo relay item](../models/photo_relay_item.md), [outbound queue](../models/outbound_queue.md), [safety and trust](../models/safety_trust.md).

## Story F17 — Schedule a meeting

> As a participant, I want the agent to help choose a time and place that work for everyone.

### An agreed slot and venue make the plan

Use stated availability or authorized calendar free/busy, travel constraints and a public venue. Offer 2–3 viable times when a slot is unsettled. If consenting probe answers select a shared slot, the reveal can carry the booked plan. A changed time requires renewed consent. A cancellation notifies participants with minimal detail. The agent suggests booking links and gives requested calendar invites. It holds no money.

Models: [calendar free/busy](../calendarFreeBusy.md), [activity formation and check-in availability](../planFormation.md), [plan dispatch](../planDispatch.md), [Friends partner time choices](../friendsPlanTimeChoice.md), [meeting rescheduling](../meetingReschedule.md), [requested calendar invite](../calendarInvite.md), [venue booking link](../venueBookingLink.md), [opportunity](../models/opportunity.md), [plan run](../models/plan_run.md).

## Story F18 — Keep a meeting on track

> As a participant, I want reminders and a way to tell the other people I'm meeting when plans change.

### Logistics follow the accepted opportunity and sending rules

Send permitted reminders and a day-of check-in. Relay a late arrival. Offer a reviewed, eligible replacement or reschedule when someone drops, or cancel gracefully if minimum participation fails. A booked group cannot continue with fewer than three people. Record attendance and apply the contextual no-show rule. STOP, bans, blocks and quiet hours still apply.

Models: [meeting settlement](../meetingSettlement.md), [booked group replacement](../bookedGroupReplacement.md), [late arrival in a booked meeting](../groupLateArrival.md), [reviewed group journey](../reviewedGroupJourney.md), [plan run](../models/plan_run.md), [outbound queue](../models/outbound_queue.md).

## Story F19 — Give feedback and meet again

> As a participant, I want to say how it went without forcing a conversation with the other person.

### Feedback changes future context privately

Ask factual questions first, then whether it was worthwhile and whether the person wants to meet again. Update contextual reliability, intent and edges. Offer a second encounter when mutual evidence and current policy support it. Keep negative feedback private. Sample whether an interruption was worthwhile under the one-open-question rule.

Models: [interruption feedback](../interruptionFeedback.md), [repeat encounters](../repeatEncounter.md), [opportunity](../models/opportunity.md), [profile learning](../models/profile_learning.md), [notification and capital](../models/notify_capital.md).

## Story F20 — Set my participation

> As a member, I want to say when and about what the agent may contact me.

### Text controls change permission before later sends

Interpret plain-language categories, quiet hours, pause and resume. Confirm the new setting briefly. STOP and STOP ALL stop the shared line across apps. Leave removes one app. START and HELP have their own consent-aware path. Preserve the member's control across channels and prevent ordinary sends during an opt-out.

Commands such as “pause matching”, “quiet hours 10 pm to 8 am”, and “turn off hobby suggestions” apply to the app that receives the signed text.

Models: [participation controls](../participationControls.md), [shared-line consent journey](../sharedLineConsentJourney.md), [turn consent](../models/turn_consent.md), [outbound queue](../models/outbound_queue.md), [safety and trust](../models/safety_trust.md).

## Story F21 — Hear when nothing fits

> As a member, I want an honest response when the Network has nothing useful yet.

### Explain the next available step without sending filler

If nothing clears the bar for an intent after the configured interval, normally ten days, record the reason. Offer a short relevant question, an outside-world suggestion, another format or a vouch invitation where permitted. Respect category and interruption settings.

Models: [empty intent follow-up](../emptyIntentFollowup.md), [matching engine](../models/matching_engine.md), [profile learning](../models/profile_learning.md).

### An empty or budgeted search is a recorded reason

When a member's candidate search keeps no candidate or reaches either search limit before it is exact, record the result and its bound on missed value in the staff-only matching run log. Only pairs with a value can fill a candidate slot.

Models: [bounded candidate search](../candidateSearch.md), [empty intent follow-up](../emptyIntentFollowup.md), [matching engine](../models/matching_engine.md).

## Story F22 — Attend a Network gathering

> As a Network member, I want a periodic local gathering where I can meet people without managing the logistics.

### A gathering has invitations, opt-in and follow-up

An admin creates the monthly public city gathering and approves eligible invitation priority. Collect RSVPs, suggest small groupings, remind as permitted and ask whom members would like to see again. Apply adult eligibility and review to member connections. This follows the slop pilot in the NYC Network rollout.

Models: [gathering review](../monthlyGathering.md), [invitation review](../monthlyGatheringInvitationReview.md), [invitation delivery](../monthlyGatheringDelivery.md), [RSVP](../monthlyGatheringRsvp.md), [grouping](../monthlyGatheringGrouping.md), [notices](../monthlyGatheringNotices.md), [attendance and follow-up](../monthlyGatheringFollowup.md), [reviewed second encounter](../gatheringRepeat.md), [second-encounter delivery checks](../gatheringRepeatDelivery.md), [plan run](../models/plan_run.md), [review desk](../models/review_desk.md), [matching engine](../models/matching_engine.md).

## Story F23 — Block or report

> As a member, I want to stop contact and tell safety staff about a concern.

### A block takes effect now and a report has an accountable owner

A block stops pair contact across apps and invalidates queued work for the pair. When another app reads the block, it closes an open opportunity that still includes both people before messages or settlement proceed. Record a report with necessary evidence and route by severity. Authorized safety staff can impose a hold or ban, triage urgent cases and process a decision with a recorded reason. For immediate danger, tell the person to contact emergency services.

Models: [safety and trust](../models/safety_trust.md), [opportunity lifecycle](../opportunityLifecycle.md#a-block-closes-an-open-opportunity-for-the-active-pair), [outbound admission](../outboundAdmission.md#recheck-blocks-between-the-participants-before-contact), [outbound queue](../models/outbound_queue.md), [console privacy](../models/console_privacy.md).

## Story F24 — Export or delete my data

> As a member, I want to get a copy of my data or remove it.

### Data requests use the support path and reach derived data

Direct the person to help@ntwrk.party for formal export and erasure requests. Verify ownership and scope. An authorized agent can read the person's own profile on the current app for confirmation. Export includes stored and derived data where permitted. Erasure closes open opportunities, clears affected records and derived state, and propagates through restore. Preserve only retained safety and suppression evidence under policy. A per-app leave affects that app alone.

Models: [account privacy and export](../accountPrivacy.md), [identity lifecycle](../models/identity_sagas.md), [profile read](../models/profile_read.md), [backup and restore](../models/backup_restore.md).

## Story F25 — Keep my account when my number changes

> As a member, I want my new number to keep my profile, grants and history without handing them to the next owner of my old number.

### Change possession without changing the person

Verify the new number and confirm from the old number or use steward recovery. Update authorized identity mappings and grants. End stale sessions. Preserve the person ID and membership history. Reusing a released number must not expose the former person's account.

Models: [phone change](../phoneChange.md), [phone identity](../models/phone_identity.md), [identity lifecycle](../models/identity_sagas.md), [OAuth and MCP](../models/oauth_mcp.md).

## Story F26 — Set travel and presence

> As a member, I want to tell the agent where I will be and when I am available there.

### Presence is time-bounded and coarse

Store confirmed city and time windows. Use travel tolerance and any visitor opt-in in the relevant app. Expire the travel window automatically. A supported signup or presence region does not enable live matching there. Expose only coarse area or travel bands.

Temporary presence needs a start and an end. Matching uses a valid trip only during that window. When the window ends, future matching uses other eligible presence, such as the member's home city.

On the signed conversation, a member can state the city and two exact dates to record a trip for the current app. The end date is the first day away from that city. The member sees the saving app in the reply. If a date lacks its month or year, the Network asks for the dates before saving anything.

Models: [live travel windows](../travelPresence.md), [signed travel journey](../travelPresenceJourney.md), [matching engine](../models/matching_engine.md), [candidate pool](../models/candidate_pool.md).

## Story F27 — Review before contact

> As a reviewer, I want enough safe context to approve, edit, swap, re-roll or reject a proposal.

### Review is authorized, current and recorded

Show the app, origin, scrubbed context, reasons, proposed copy, timeline and deadline to the assigned reviewer. Store the decision, reviewer, reason and evidence as audit data. Recheck all participants on approval and dispatch. A materially changed proposal must pass review again. Expiry prevents a late send. Simulated review is confined to the simulation.

Models: [staff review and plan preview](../staffReview.md), [review desk](../models/review_desk.md), [staff console](../models/staff_console.md), [console privacy](../models/console_privacy.md).

## Story F28 — Stop asking when I do not answer

> As a member, I want the agent to stop offering things when I leave messages unanswered.

### Two unanswered invitations pause new offers

Count an invitation when it expires or reaches 72 hours unanswered. After two in succession, accept only requested opportunities and permitted notices or logistics. An eligible later inbound turn may offer to resume. A tightly limited high-value re-engagement follows carrier rules and the [delivery policy](policies.md#interruption-and-delivery).

Models: [unanswered outreach and re-engagement](../outreachPolicy.md#pause-new-offers-after-two-unanswered-invitations), [outbound queue](../models/outbound_queue.md), [turn consent](../models/turn_consent.md).

## Story F29 — Close an expired or underfilled opportunity

> As a participant, I want the agent to release my time if an offer expires or a group cannot reach quorum.

### Expiry is terminal for that invitation

Expire with the Clock. Use eligible reviewed alternates only within the permitted window. Once expiry or quorum failure is final, close all affected pending work and notify participating members without exposing other replies.

Models: [opportunity](../models/opportunity.md), [plan run](../models/plan_run.md), [outbound queue](../models/outbound_queue.md).

## Story F30 — Join the app I asked for

> As someone already using an agent or the shared line, I want to join the right app with my own approved information.

### Routing and authorization are app-bound

A named app or domain selects that app. A no-keyword text join starts at The Network and asks what the person seeks. Keep the invite boundary on app-bound Network signup. Check consent version and approved profile before submitting, then read back the app and the profile. Join mode, matching activation and send approval are separate states. A different app cannot see that the person already has another membership.

Models: [generated site enrollment](../siteEnrollment.md), [agent-assisted signup draft](../mcpSignupDraft.md), [Cloud authentication](../models/cloud_auth.md), [OAuth and MCP](../models/oauth_mcp.md), [turn consent](../models/turn_consent.md), [profile read](../models/profile_read.md).

## Story F31 — Add my adult dating photos privately

> As an adult Slop member, I want to choose photos for matching and retain control of sharing them.

### Private rating eligibility is checked again after rating

Confirm adult age, consent, app and ban status before fetching or processing a photo. Store it privately, remove unneeded metadata, and never include a photo in a probe. Clef ratings can affect matching as soft inputs. Scores stay private and are removed when the member, age or photo is no longer eligible. A member can choose an item to share only through F16.

Models: [photos and rating](../models/photos_rating.md), [photo relay item](../models/photo_relay_item.md), [member age rules](../memberAge.md).

## Story F32 — Keep meeting a public activity group

> As a member of a group that went well, I want to meet again without starting over.

### Recurrence uses a fresh session with its own consent

Build a new session around the shared activity, overlapping availability, travel limits and a rotating host. Recheck membership, blocks and eligibility before each session. When a group is ready for its own chat, let its consenting members take it forward. Friends targets the same members meeting again.

Models: [Friends weekly repeats](../friendsWeek.md#a-friends-repeat-uses-its-own-completed-table-and-a-fresh-review), [plan crew](../models/plan_crew.md), [plan run](../models/plan_run.md).

## Story F33 — Choose a hiring introduction

> As a candidate or hiring team, I want an introduction I can evaluate without being ranked for an employer by the service.

### The candidate consents first and hiring stays human

Only verified employers with pay ranges can reach a candidate. Exclude protected traits and proxies from automated matching. Respect current-employer blocks and qualification filters. Ask candidates first and send unranked slates with must-have checks after consent. Staff review introductions. Hiring teams make the decisions.

Models: [Peon job search](../peonCandidateSearch.md), [Peon hiring dispatch](../peonHireDispatch.md), [matching engine](../models/matching_engine.md), [candidate pool](../models/candidate_pool.md), [review desk](../models/review_desk.md).

### Role level and candidate level fit both ways

Pair an employer seat with a candidate in the `Hire` lane only when each side reaches the lane's utility floor for the other and the gap between role level and candidate level stays inside the lane's band plus both uncertainties, so a slate holds neither a role far above the candidate nor a candidate far above the role; the role level is a staff-reviewed property of the posting, and the level gap is a pass-or-fail filter that never orders the slate.

Models: [relationship lanes](../matchLane.md), [reciprocal pair value](../pairValue.md), [private member standing](../memberStanding.md), [candidate pool](../models/candidate_pool.md).

## Story F34 — See my contribution history

> As an adult member, I want to know what I have contributed without competing for a visible rank.

### Contributions have evidence and limited effects

Record vouches, attendance, feedback, confirmed help and organizing. Show the member their itemized history in conversation. Apply effort, invite and organizing limits privately. Maintain a baseline of access and separate contextual reliability. Do not penalize declines, pause or inactivity.

Models: [private contribution history](../contributionHistory.md), [notification and capital](../models/notify_capital.md).

## Story F35 — Inspect a member's experience as staff

> As authorized staff, I want to inspect a flow and its evidence in the Observatory without seeing unrelated private data.

### The console limits scope and audits access

Provide app-scoped member history, review, proposal and match evidence, safety, demand, costs, growth, fairness, event, health and simulation views. Show messages, prior decisions, send or suppress reasons and leak results within two clicks from a member. Keep real and simulated environments explicit. Scrub data by default, write the access audit before a sensitive read and use the admin API for actions. Require a reason for a limited reveal.

Models: [staff console](../models/staff_console.md), [console views](../models/console_views.md), [console privacy](../models/console_privacy.md), [Observatory synchronization](../models/observatory_sync.md), [opportunity rosters](../observatoryRoster.md), [member consent view](../observatoryMemberConsent.md).

## Story F36 — Recover service without duplicate sends or lost data

> As an operator, I want a retry, restart, restore or cutover to keep member state and send authority consistent.

### Durable identity and dispatch survive handoff

Persist jobs, message IDs, provider outcomes, consent, app scope and erasure evidence. Claim work with ownership and expiry, recheck eligibility at dispatch and reconcile unknown provider outcomes. Restore in isolation and replay erasures before activation. Keep only one live owner of inbound turns and delivery. Inspect build identity, logs, budget, heartbeat, queue age, failures and safety alerts.

Models: [runtime operations](../models/runtime_ops.md), [backup and restore](../models/backup_restore.md), [boot configuration](../models/boot_config.md), [outbound queue](../models/outbound_queue.md).

## Story F37 — Know which app I am joining

> As a person who opens one of the four sites, I want the name, domain, logo, color and headline to show one app, so that I give my number to the app that I chose.

### Each site shows its own brand and names no other app

One brand record per site holds the only data that differs between the sites: the name, domain, app, join keyword, join mode, accent, logo, headline and skill name. A site never tells a person which other apps a number uses.

Acceptance:

- No two sites share a name, a domain, a join keyword, an accent, a logo or a skill.
- Only ntwrk.party asks for an invitation. slop.date, peon.biz and friends.help are open to each person at or above the join age.
- slop.date, peon.biz and friends.help never name The Network or another app on a page, in their skill or in their skill catalog. The support address help@ntwrk.party is the one exception.
- The ntwrk.party landing page, not-found page and own skill name no app. Only its legal pages and its skill catalog list the apps.
- Each accent has one value for light mode and one for dark mode. The ink on the accent is a different color from the accent.

Spec: [brand identity](../brandIdentity.md).

## Story F38 — Take the signup prompt to my agent

> As a person on a landing page, I want to copy one short prompt or press the logo of my agent, so that my agent opens and signs me up for this app.

### The landing page has one prompt, the agent tiles and nothing else to read

The page sends the person to their own agent. The agent skill does the signup after the person leaves the page.

Acceptance:

- The prompt is `Read https://<domain>/SKILL.md?version=<version> and follow it.` The slop.date prompt has no version query. A person can select the prompt without the page script.
- The Copy button shows only when the page script runs. A press shows "Copied". When the clipboard refuses, the page selects the prompt and the button shows "Selected: press copy".
- The agent row shows logos only, in this order: ChatGPT, Claude, Grok, Muse, Gemini, Perplexity, Cursor, OpenClaw, Hermes. The agent's name is the hover label of its logo. The accessible name of a tile with a link is "Open in <name>", and of a copy-only tile "Copy the prompt for <name>".
- The row never shows an agent that the app's connector refuses. The OpenAI surface of the connector serves the endpoint of every app, so each page shows the ChatGPT tile, slop.date included. Only the slop.date endpoint of that surface names slop.date.
- A phone, or a Mac with more than one touch point, does not show Cursor. Without the page script, the Muse tile (copy only) does not show.
- A press on a tile follows its link, if it has one, and copies the prompt. The status line then says that the agent opens, where to paste the prompt, or "Copy the prompt, then paste it into your agent." when the copy fails. Without the page script the status line stays empty.
- The page shows, in this order: the brand mark, the headline, the prompt, the Copy button, the agent row, the Messages entry, the status line, and the Privacy and Terms links. It has fewer than 45 words and one heading.
- The page has no sign-in link, settings link, member dashboard, safety notice, compliance text or explanation block.

Spec: [landing entry](../landingEntry.md).

## Story F39 — Start in Messages instead

> As a person who prefers text messages, I want one button that starts a text to the shared line, so that I can join this app without an agent.

### The Messages entry writes the join message and shows the number when Messages does not open

Acceptance:

- The entry says "Use in iMessage" and is not in the agent row. Its link opens the shared line with the body `join <keyword>`, and the keyword routes the text to this app.
- On a phone or a Mac, the page copies the join message and waits 1.5 seconds for Messages. When the page stays visible, the status line shows the number and the message. While the page waits, a new press does nothing.
- On another desktop, the page does not follow the link. The status line at once shows "Message copied. Text it to <number> if iMessage did not open.", or `Text "join <keyword>" to <number>.` when the copy fails.
- Without the page script, the browser follows the link each time and the status line stays empty.

Spec: [landing entry](../landingEntry.md), "Story: Start in Messages instead".

## Story F40 — Find the legal text and never open a retired page

> As a person who opens a site or follows an old link, I want a small set of pages with the legal links on each, so that I can find the terms from any page and never see an old account page or signup form.

### Each site serves the same small page set and refuses retired paths

Acceptance:

- Each site has a landing page, a privacy page, terms and a not-found page. Only peon.biz has a join page.
- The footer of each page has two links: Privacy, then Terms. Both pages exist on each site.
- The terms page has a text messaging section at `#sms`. It describes the program, the opt-in, the message frequency, STOP for every app on the number, `leave` for one app, START, HELP, the costs, and that no number is shared for marketing.
- On peon.biz, the terms name the join page and a text as the ways to opt in. On the other sites, the terms name the agent skill and a text, and never name or link a join page.
- A settings path answers 404 with a short text on each site. On a site without a browser join, a GET or HEAD to a join path answers 302 to the landing page, and another method answers 405. Each retired answer carries `no-store` and never reaches the backend.
- An unknown path shows the not-found page with status 404.

Spec: [site pages](../sitePages.md).

## Story F41 — Let my agent read the signup skill from the site

> As an agent that a person asked for a signup, I want each site to serve its skill and a skill catalog at fixed paths, so that I read the exact instructions for the app that the person chose.

### Each site serves its own skill as plain text that any origin can read

Acceptance:

- `/SKILL.md` and `/.well-known/agent-skills/<skill>/SKILL.md` return the same bytes. A `version` query does not change the bytes.
- `/.well-known/agent-skills/index.json` lists each skill with its path and a SHA-256 digest of its bytes. An app site lists only its own skill. A request for the skill path of another app shows the not-found page. The ntwrk.party catalog lists and serves the skill of each app.
- A skill file has the type `text/plain; charset=utf-8`, and the catalog has the type `application/json`. Each origin can read both, and a cache keeps them for 300 seconds.
- Each site forwards `/api`, `/mcp`, `/oauth/` and `/.well-known/oauth-` paths to the shared backend.

Spec: [site pages](../sitePages.md), "Story: Let my agent read the signup skill from the site".

## Story F42 — Join peon.biz in the browser

> As a person whose agent sent me to the peon.biz join page, I want to confirm my own phone, check my first name and age and agree to the texts, so that I join with the details that I approved and nobody else confirms my phone.

### The page shows the step that the session allows and sends each form once

The server owns the join rules and the code limits ([site enrollment](../siteEnrollment.md), [phone verification limits](../otpLimits.md)). The page has no sign-in link, settings page or member dashboard. It is only for the join.

Acceptance:

- The link `https://peon.biz/join?via=agent#firstName=..&age=..` fills the form. The page keeps at most 50 characters of the name, and keeps the age only when it has one to three digits and is not more than 120. The page removes the fragment from the address before it loads anything.
- After a loading step, a signed-out person, or a session that the page cannot read, sees the phone step. A person who can join sees the profile step. A member sees the "already in" step. A person who cannot join sees the blocked step with a reason. "Invite only" is the reason for an invite-only app when the server gives none.
- When the server answers "cloud", the phone step shows one "Continue with your phone" button and no number field. With any other answer, or a failed lookup, the page uses text codes. The security check shows only with text codes and only when the site has a check key.
- The page refuses a number that is not a 10-digit US mobile number. It sends no number while the security check runs or after it failed. Each server answer uses up the check.
- The page refuses a code with fewer than 4 or more than 8 digits. A wrong code keeps the code step and shows why.
- The page sends the profile only with a first name, a whole age from 1 to 120 and the text consent ticked. The server decides the join age. "Under age", "invite only" and "review" show the blocked step with that reason.
- The approved name and age stay through the first sign-in. The page clears them when it loses or replaces the account that it shows.
- The done step shows only after a saved profile with consent. When the person came from an agent link, it tells the person to go back to the same chat.
- A form that waits for an answer refuses a second submit. One request runs at a time.

Spec: [join in the browser](../browserJoin.md).

## Story F43 — Connect my assistant on the app's page

> As a person who connects my assistant to an app, I want one clear page at each step, so that I confirm my own phone, see who asks for access and give access only on purpose.

### The server reply selects one page, and only Allow returns a code

The server flow and the grant are in [connector browser authorization](../oauthBrowserAuthorization.md) and [connector grant issuance](../oauthGrantIssuance.md).

Acceptance:

- The connection link opens the phone page, the consent page for an existing session, the hand-off to Cloud sign-in, or a message: "This link does not work", "Too many tries", "Not available", "Please try again" or "Sign-in unavailable".
- The phone page shows a security check only when the site has one. It sends a code only when the check is off or solved. It refuses a number that is not a US or Canada number. A field error shows only on the page of its field.
- The code page shows only after this request sent a code. It shows the last four digits of the number.
- A consent page shows only after the site knows the person: an existing session, the return from Cloud sign-in or a correct code. It shows the client's name, or "An unnamed assistant", says that the name is the client's own claim, shows the return host and lists every requested scope. No other page names a client.
- Only "Allow", or "Try again" on the retry consent page, returns a code to the assistant. "Cancel" and "Don't allow" return a refusal.
- A message page shows no phone field and no code field. Only "Please try again" has a link, and it retries the same request.
- Each page that the site renders shows the brand mark, which links to the home page, and the Privacy and Terms links.

Spec: [connector authorization pages](../authorizationPages.md).

## Story F44 — See and remove my connected assistants

> As a person who connected an assistant to an app, I want to see each assistant that can use my account in this app and remove its access, so that it cannot act for me any more.

### The list shows live grants for a session, and removal needs a confirmation

The page is at `/oauth/consents` on each app's site. It is not an account portal: no public site links to it, and it has no sign-in form or sign-in link.

Acceptance:

- Without a session, the page shows "Sign in first" and tells the person to connect the app in the agent and confirm the phone there. It offers no control.
- When the session check is not available, the page shows "Please try again" with one link that loads the page again. "Not allowed" offers no control.
- Only the current person's live grants appear. Each grant card shows the assistant's name or an unnamed label, says that the name is the assistant's own claim, and shows the approval date, the approved scopes and "Remove access".
- "Remove access" asks for a confirmation. "Keep access" shows the list with no change.
- A confirmed removal shows the grants that stay and "Access removed.". The server requires a current confirmation for the exact grant and session. A missing or expired confirmation, or a grant that was already gone, shows the list with no notice. The empty state shows after the last removal.
- Each view after the first load shows the brand mark and the Privacy and Terms links.

Spec: [connected assistants page](../connectedAssistants.md).

## Story F45 — Sign up in my agent's conversation

> As a person who asked my agent for a signup, I want the agent to draft my profile, get my approval, confirm my own phone and save the profile, so that I join the app in one conversation and know the true result.

### Nothing leaves the conversation without approval, and only a confirmed save is reported as saved

The agent follows the app's SKILL.md. The site supplies app facts, the person's browser handles phone verification and signup, and the MCP server confirms the submitted profile and membership status.

Acceptance:

- The agent drafts for the selected app and hands one link to the person after approval. The person's browser confirms their phone and authorizes the app's connector. The peon.biz skill also supports a prepared text the person sends from Messages. The Peon transport needs separate qualification ([product policies](policies.md#age-identity-and-enrollment)).
- An agent without a supported signup transport explains its capability limit before collecting a profile. The verification code stays in the person's browser. A prepared text is available only where the app supports that signup path.
- Read the app facts from the skill's own origin before drafting. Facts for another app stop the flow.
- The agent asks for the person's birthday in the conversation only to explain what the person gets. No tool receives a birthday or an age; the person types the birthday on the signup page. The lowest stated age applies. Under 13, the agent stops before it asks for a number. At 13 to 17, the agent tells the person what they get today (their own help: answers, public events and plans for themselves), that they are never matched on dates or for work, and that friendship is the only kind of introduction that can open to people under 18, only with people within 2 years of their own age. The agent offers a person aged 13 to 17 neither dating nor work matching, and never promises them an introduction. Today nobody under 18 is introduced to anyone ([founder decision 2026-11-22](source/founder-decisions.md)).
- The agent shows a short draft and the current text consent: recurring texts, variable frequency, message and data rates, STOP and HELP, and links to the text terms, the terms and the privacy policy. Only an explicit approval of this profile and this wording continues. A code, a draft or silence is not approval.
- The site's authorized signup flow may reuse its live verified browser session. The person enters the number and code on the app's site and controls retries. The agent collects neither credential.
- An account of another app stops the flow. An existing member is read back, and the agent does not send Join again. An invite-only app without an invitation and an account on hold stop the flow.
- The site's signup flow checks the enrollment fields, home region and current consent. The person confirms those details match the approved draft and separately authorizes the connector. After the app-bound grant becomes active, the agent submits the approved profile once through MCP.
- The agent reports "saved" only after the service confirms the approved profile submission and the same connector confirms an eligible membership. It reports a difference as a difference. It reports a prepared text as waiting for the person to send it. It never reports a save as a match.

See the [browser phone confirmation and connector handoff](../agentPhoneHandoff.md) and [signup conversation](../agentSignup.md).

## Story F46 — Use my app's connector from my agent

> As a person who connected my agent to an app, I want the agent to see only the tools that fit my app and my status, so that it can check my status, send my approved profile once and read my own updates without seeing my phone number or code.

### Each tool call answers for one app, one grant and one member status

Acceptance:

- ntwrk.party serves the connector of every app: `https://ntwrk.party/mcp` for The Network and `https://ntwrk.party/mcp/<app>` for each other app. ChatGPT and Codex use the OpenAI surface, with `/openai` added. Each surface serves the endpoint of each app, slop.date included. On the OpenAI surface, only the slop.date endpoint names slop.date: the endpoint of another app, which the OpenAI plugin uses, never lists slop.date or dating. The slop.date site keeps no OpenAI surface of its own.
- A grant covers only the app of its endpoint path. A token for one app is refused at the endpoint of another app.
- `app_info` and `start_signup` need no sign-in and return public facts only. `check_status` and `get_updates` need the membership read scope. `submit_profile` and `prepare_signup` need the profile write scope. A call without the right grant tells the person to sign in on the app's page and allow access.
- `read_profile` needs explicit profile read permission and a current active membership for the same app. It returns only safe saved fields and makes no profile change.
- `check_status` shows one of six statuses (not joined, invited, onboarding, active, stopped, on hold) for the host app only, with one next step.
- `submit_profile` sends an approved profile once, and only for an onboarding or active member. For another status it sends nothing and gives the next step. A grant can make at most five profile or draft calls in one day, and a refused call counts.
- `prepare_signup` shows only on friends.help and ntwrk.party. It saves only an approved first name and an optional home city, at most once per grant. It creates no person, membership or text consent. Those sites have no Join page now, so the person cannot use the draft yet.
- `get_updates` shows the person's unseen updates for the host app and marks them seen. An update reference of another person, or an unknown or expired one, shows nothing and marks nothing.
- When the phone's owner changed, the next member tool call ends the grant and asks the person to sign in again.

Spec: [connector tools](../connectorTools.md).

## Story F47 — Reach my agent from a plugin, a catalog or an update text

> As a person who found an app or got an update text, I want one prompt or one link to open my own agent with the right app's skill or my update, so that I need no website account.

### Each entry resolves to one app skill or to the updates tool

Acceptance:

- Each skill names the ntwrk.party endpoint of its own app: `https://ntwrk.party/mcp` for The Network and `https://ntwrk.party/mcp/<app>` for each other app, with `/openai` added in ChatGPT. The Claude plugin lists the skills of all four apps. The OpenAI plugin, for ChatGPT and Codex, lists the ntwrk.party, peon.biz and friends.help skills only, and its manifest lists `https://ntwrk.party/mcp/openai`. A person who uses slop.date in ChatGPT starts from the slop.date page and adds `https://ntwrk.party/mcp/slop/openai` as a connector.
- A site prompt starts signup. A plugin skill or a catalog entry starts signup only when the person asks for it. Otherwise the agent explains the app.
- An update link opens the agent with `Ask The Network for update T-7F3K9Q`. The agent loads no skill, passes the reference to the updates tool on the person's own connection and never asks for a reference. Without a connection, the agent asks the person to sign in on the app's page and allow access.
- An update text carries only the reference. When the person uses no assistant that the service can link to (ChatGPT, Claude or Grok), the update goes in the text thread.
- On iMessage the text links straight to the assistant. On SMS and Telegram it links to one ntwrk.party page with a button for each assistant. Each link fills the prompt and never sends it. The ChatGPT link uses `?prompt=`.

Spec: [agent entry](../agentEntry.md). The landing prompt is in [F38](#story-f38--take-the-signup-prompt-to-my-agent).

## Story F48 — Sign in to the staff console as myself

> As a staff member, I want to sign in with my own identity and a second factor, so that every read and action in the console is mine.

### The server answer decides the sign-in phase, and real data needs single sign-on

Acceptance:

- The console removes a token after `#token=`, or an old `?token=`, from the address bar and the history entry before it asks who the viewer is. It keeps the token for this browser tab only.
- A token server shows a token form with a password field. Its submit control works only when the field holds text. A Cloudflare Access server shows the single sign-on link, never the token form, and refuses every staff token.
- A single sign-on identity without a second factor sees the second-factor request. An identity without a staff role sees the no-role panel. A refused Host or Origin shows the refused-site panel with no retry. A server that does not answer shows a retry.
- A 401 answer or socket code 4401 ends the session and asks again by the same method. Socket code 4403 checks the identity again, and the console shows a page that the remaining roles cover.
- A console that reads real data outside a local development setup does not start without Cloudflare Access and a known platform environment.

Spec: [staff sign-in](../staffSignIn.md).

## Story F49 — Find my way in the staff console

> As a staff member, I want the console to show only the pages, tabs and filters that my roles and mode cover, so that I never land on an empty or refused view.

### The viewer selects the page, and one subject drives the inspector and the drawer

Acceptance:

- The console shows a loading view until the server names the viewer. A viewer with no role sees the no-role page. A viewer with only the cross-app role sees the all-apps page.
- The app switcher and its "all" choice show only to a viewer with roles for two or more apps or with the cross-app role. The person page opens only for a cross-app viewer in real mode, and Close returns to the all-apps page.
- Only a global admin on a server that is not real-only can switch between the simulated world and real data. A mode change shows the overview with no picks.
- The inspector history keeps at most 20 subjects. Back shows only while the history holds a subject. Escape closes, in this order, an open menu, the search text, the picks and the subject.
- Search offers members and neighborhoods from two characters and opportunity ids from three. A safety viewer can also search the Network's own messages and system events from two characters, never the words of a member.
- In the simulated world, a viewer with a simulation role picks two to six members. A member under 18 cannot be picked. A seventh pick drops the oldest.
- A drawer tab shows only where it applies, and a tab that does not apply falls back to the feed. A click on the open tab collapses the drawer. While the drawer is open, the filter bar dims each filter that the open tab does not use.

Spec: [console navigation](../consoleNavigation.md).

## Story F50 — Do staff work in the console panels

> As a staff member, I want each panel to show its controls only to the roles and modes that can use them, and each decision to need a reason or a confirmation, so that I never press a control that the server must refuse and every decision is deliberate.

### Each panel follows the role, the mode and the server answer

The [safety case spec](../safetyCase.md) owns what a decision does. The server writes an audit row before each staff read and action.

Acceptance:

- Each panel shows a loading, refused, unavailable, failed, empty or full view. A refused panel never shows rows.
- Held texts, safety cases and reports need the safety role. The matching switch and the lab need the analyst role. The audit log needs the admin role. The bias monitor needs the analyst role and real data. Member requests are open to each staff role.
- A held text needs a reason of five characters or more. The text of a member under 18, or of unknown age, stays hidden. A held photo is released only after staff load it and confirm the review.
- A report decision needs a note of five characters or more. Hold, ban and dismiss need the Network service. The row shows the new status only after the server accepts the decision.
- The request list starts on the open segment. The fulfilled segment shows fulfilled and booked requests.
- Only an admin who can change the matching switch sees it. The first press asks for a confirmation, which ends after a short time. The second press saves. A refused save keeps the old setting.
- The propose tray and the world menu show only in the simulated world. A proposal needs two to six adults, a spark left and a game that is not over.
- A reveal needs real data, the safety role, a reason of five characters or more and a length of 5, 10 or 15 minutes. It shows only after the server grants it, and it ends on request or when its time passes.
- A new viewer, a mode change or a credential change closes each draft, form and menu.

Spec: [console workspace](../consoleWorkspace.md). The review card is in [staff review](../staffReview.md), and the member detail reads are in [member inspector](../consoleMemberView.md).

## Story F51 — Use one design system for every brand

> As the owner of the four sites, the connector pages and the staff console, I want every screen to use one set of components with brand tokens, so that a fix or a design change reaches every brand at the same time and the brands differ only by colors, logos and text.

### One component set renders four brands in light and dark

The tokens are in `@thenetwork/design-system` (`packages/design-system`). The components are in `@thenetwork/ui` (`packages/ui`).

Acceptance:

- Every web interface uses React components from `@thenetwork/ui`. No component holds a color of its own for one brand.
- `data-brand` (`network`, `slop`, `friends` or `peon`) on an ancestor sets the brand. A `light` or `dark` class sets the theme, and without a class the theme follows the system.
- The four sites use the same header mark, headline, prompt field, agent row, Messages entry, status line, footer, legal text and not-found notice. Only peon.biz adds the browser join flow.
- Each text and fill pair meets WCAG AA in both themes. The edge of a control has a contrast of 3:1 or more. `pnpm run design:check` checks the contrast of the tokens.
- Each component has a story. Storybook has a theme switch and a brand switch. `pnpm run ui:test` mounts each story and runs its play, and the browser run checks each story with axe.
- Each view, notice and error that the specs of F38–F50 can reach has a component state.

Spec: [brand identity](../brandIdentity.md), "Story: One component set for every brand". Tokens: the [brand design notes](../../packages/design-system/brands/network/design.md).

## Story F52 — Read and run the console analysis panels

> As a staff member, I want the lab, runs, metrics, feed, pipeline and game panels to show each data state and to offer a control only in the mode and to the role that can use it, so that I read the numbers that need me and never change the world from real data.

### Each analysis panel follows the mode, the role and the data

The [workspace spec](../consoleWorkspace.md) owns the loading, refused and failed rows. The [navigation spec](../consoleNavigation.md) owns which tab shows.

Acceptance:

- A lab run, a world reset, a level choice and a level check exist only in the simulated world. Real data, with or without the Network service, gets no write from these panels.
- The lab says when it is off on the server. A lab run starts only for an analyst, with one to three arms, one to five seeds and one to sixty days. A refused start keeps the form. A safety count above zero shows as an alarm.
- The runs tab shows one run, or asks for two runs in compare. Compare shows only with two runs or more. A third pick drops the oldest. The difference loads once two runs are picked, and it hides a measure that is zero in both runs.
- The metrics tab shows truth numbers only in the simulated world, and the bias monitor and the cost only on real data to an analyst. A bias ratio under 0.8x is an alert. A cost budget is amber from 80 percent and red from 100 percent. A proactive rate above two messages per member a week is a warning. An inviter share of 30 percent or more meets its target.
- The feed segments group the event kinds. The mine segment shows only in the simulated world. An empty feed says why.
- The pipeline shows the columns of the state filter. A stub network says that it has no consent data.
- The game tab shows only in the simulated world. Only an admin resets the world, chooses a level or chooses the reviewer.

Spec: [console analysis panels](../consolePanels.md).

## Later stories

Original later IDs stay attached to their prerequisites. They do not enter launch scope merely because a shared state machine supports them.

| ID | Story | Prerequisite |
|---|---|---|
| L1 | As a member, I want fuller tools in my chosen assistant for updates, asks and responses. | Approved onboarding and app-scoped authorization. |
| L2 | As a member, I want to forward an opportunity by private link. | Validate what the recipient and other participants can learn. |
| L3 | As a member, I want to use another channel or invite the agent to an existing group chat. | Channel policy, identity linking and permission checks. |
| L4 | As a member, I want to share ephemeral presence or use a native app. | Location privacy, retention and notification review. |
| L5 | As a participant, I want to split costs or pay for a service. | Approved commercial scope, custody and dispute policy. |
| L6 | As an event host, I want an optional commitment deposit. | Payment readiness and measured no-show policy. |
| L7 | As a qualified host, I want to hold an event at home. | Verified host identity and new safety rules. |
| L8 | As a member facing a barrier, I want to request help from the Commons. | Approved revenue and stewardship. |
| L9 | As a partner, I want to fund additional useful capacity. | Recommendation integrity and independent member consent. |
| L10 | As a member, I want a voice in decisions about the Network. | Ownership and governance after product-market fit. |
