# Member and staff stories

The `F1`–`F29` identifiers retain the original [PRD flow IDs](source/prd.md#29-user-flows-and-interactions-mvp-and-later). Later stories carry separate IDs. A named model is a starting point for the state and rules of the flow. Check its coverage before relying on it as evidence for a complete journey.

## Story F1 — Invite and vouch

> As a member, I want to invite someone I can vouch for so they can decide whether to join.

### An invitation has provenance, allowance and an end

Check the member's invite allowance, normally three per month. Save their vouch as invite evidence with the relationship and its strength. Flag a weak or unusual invite for a human. By default, the inviter forwards the invitation. The service can send one when the inviter confirms it is expected, with attribution and opt-out. An unanswered invitation gets no follow-up.

Keep vouch notes outside matching until the invitee joins and consents. Clear notes when declined or after 30 days. An existing member's status and onboarding details stay private. A decline stops contact, and age policy applies at acceptance.

## Story F2 — Seed a cohort

> As an operator, I want to seed the first cohort with attributed invitations so we can establish a useful local network.

### Seed invitations use the same acceptance rules

Authorize a staff member to create individually attributable invites with city and vouch context. F1 and F3 still govern who can be contacted and how an invite becomes a membership. The cohort receives no permanent rank or special member status.

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

Models: [join flow](../models/join_flow.md), [profile learning](../models/profile_learning.md), [agent loop](../models/chatjson_loop.md), [authorization](../models/auth_edge.md).

## Story F5 — Review and correct my profile

> As a member, I want to see and correct what the agent knows about me.

### A read is private and creates no new onboarding turn

Return the person's own app profile, with source and scope as applicable. Ask for explicit approval to correct, remove or change how a fact may be used. Remove its derived data where required and apply the change at the next relevant engine read. A saved-profile readback must not advance onboarding or claim a pending draft was saved.

Models: [generated saved-profile read](../savedProfileRead.md), [profile read flow](../models/profile_read.md), [profile learning](../models/profile_learning.md).

## Story F6 — Answer a useful follow-up

> As a member, I want the agent to ask a short follow-up when the answer would materially improve its help.

### At most one profiling question is open

Prefer confirming a stated fact or specific guess to a broad questionnaire. Ask when timely, respect delivery and one-question constraints, and accept a correction. A message with a new opportunity also spends the relevant initial-invite allowance. Learned signals can make outreach quieter. More outreach requires the member's choice.

Models: [profile learning](../models/profile_learning.md), [outbound queue](../models/outbound_queue.md).

## Story F7 — Connect my own information

> As a member, I want to approve useful facts from a source I control.

### Imports are limited to the member and require confirmation

Offer authorized Google Calendar free/busy, pasted LinkedIn profile text, an allowed X profile or approved connection, or a summary from the member's agent. Mark proposed facts with source, confidence and scope. Persist confirmed facts, remove raw pasted summaries after confirmation, and support revocation. Exclude sensitive inferences and other people's private details.

Models: [OAuth and MCP](../models/oauth_mcp.md), [profile learning](../models/profile_learning.md), [generated suggestion review](../profileSuggestionReview.md).

## Story F8 — Ask for something

> As a member, I want to ask a question or ask for help without learning the system's categories.

### Search and tools come before asking another person

Classify the request into an answer, a recommendation, a standing intent, or a draft member opportunity. Use available knowledge before spending a person's attention. Explain what will happen and give a likely time when creating a draft. Avoid promising a match. A draft that would contact a person passes review and consent.

Models: [agent loop](../models/chatjson_loop.md), [opportunity](../models/opportunity.md), [review desk](../models/review_desk.md).

## Story F9 — Keep a standing intent

> As a member, I want the agent to keep looking for a thing I want and stop when I ask.

### A standing intent can be managed and goes stale

Record the objective, essential constraints, source and time horizon. List, pause or close it on request. Re-evaluate when relevant evidence or supply changes. Expire or reconfirm at 60 days. A later suggestion still needs current eligibility and consent.

Models: [profile learning](../models/profile_learning.md), [matching engine](../models/matching_engine.md).

## Story F10 — Get concierge value

> As a member, I want useful suggestions even when the Network knows nobody who fits.

### Recommendations come from fresh, permitted sources

Return 1–3 options with a useful reason based on interests, location, availability and age. Use permitted public sources and do not imply another member is involved. Minors may receive age-appropriate solo suggestions. A resulting co-attendance proposal follows F13.

Model: [matching engine](../models/matching_engine.md).

## Story F11 — Consider a one-to-one introduction

> As an eligible member, I want enough information to decide whether I want an introduction while my identity stays private.

### Review, anonymous probe and independent consent precede reveal

Approve a proposal before any contact. Check budget and eligibility again at dispatch. The first person gets an anonymous text-only probe with a shareable reason, time or effort and an easy decline. Ask the second person only after the first says yes. Both must opt in independently before first names or a relay are revealed. A decline stays private. Expire generic probes after the configured window, normally 48 hours. Slop probes and scheduling each use a 24-hour window.

Models: [opportunity](../models/opportunity.md), [matching engine](../models/matching_engine.md), [review desk](../models/review_desk.md), [outbound queue](../models/outbound_queue.md).

## Story F12 — Join a small group

> As a member, I want to join a public activity if enough eligible people accept.

### A reviewed group needs quorum

Anchor a group of 3–6 to a public activity, place or event and add a host when needed. Probe anonymously under review. Enforce the approved deadline and quorum, typically three for a plan. Use eligible alternates under review and release members without revealing declines if quorum fails. Book and relay only for consenting participants.

Models: [plan run](../models/plan_run.md), [opportunity](../models/opportunity.md), [plan crew](../models/plan_crew.md).

## Story F13 — Meet at an event

> As a member already interested in an event, I want the option to meet others there.

### An event suggestion and a member introduction are different actions

Suggest public events independently. When connecting members at the event, check compatible plans, review the proposal and ask each participant independently before disclosing identities. A minor's event suggestion is solo.

Models: [matching engine](../models/matching_engine.md), [opportunity](../models/opportunity.md).

## Story F14 — Ask for bounded help

> As a member, I want a specific, manageable form of help when a tool or service cannot solve it.

### A help request names its effort and passes safety review

Try information and services first. Consider adults who opted into that kind of help and have capacity. State the request, time and effort clearly, review it before contacting anyone, and collect feedback afterwards. Requests requiring entry to a home are medium-risk exceptions to the public venue default. Require two or more helpers or a helper already known to the requester, plus review and consent from everyone before revealing an address. Route a request with a single unfamiliar helper to safety review.

Models: [matching engine](../models/matching_engine.md), [review desk](../models/review_desk.md), [safety and trust](../models/safety_trust.md).

## Story F15 — Ask for an introduction

> As a member, I want to suggest or request an introduction that people can decline privately.

### A member request follows the same review and consent path

Route the request to a reviewed member opportunity. Probe the two adults independently and connect them only on mutual yes. If the person is outside the Network, use the invitation rules. Keep information about their enrollment and their reply private.

Models: [opportunity](../models/opportunity.md), [review desk](../models/review_desk.md).

## Story F16 — Relay what I choose

> As a matched member, I want to send a message, a chosen photo or my number through the agent while keeping control of what is shared.

### Every relay item has consent and a dispatch check

Open the thread after the required match consent. Identify the sender and share only approved content. Optional number exchange requires both sides to agree. Forward a photo only when a member selects it and per-item policy allows it. Apply moderation and leak checks, hold risk for staff, and close affected access on STOP, leave, block, hold or match closure. Announce delivery only when the sender system confirms it.

Models: [relay](../models/relay.md), [photo relay item](../models/photo_relay_item.md), [outbound queue](../models/outbound_queue.md), [safety and trust](../models/safety_trust.md).

## Story F17 — Schedule a meeting

> As a participant, I want the agent to help choose a time and place that work for everyone.

### An agreed slot and venue make the plan

Use stated availability or authorized calendar free/busy, travel constraints and a public venue. Offer 2–3 viable times when a slot is unsettled. If consenting probe answers select a shared slot, the reveal can carry the booked plan. A changed time requires renewed consent. A cancellation notifies participants with minimal detail. The agent suggests booking links and gives requested calendar invites. It holds no money.

Models: [opportunity](../models/opportunity.md), [plan run](../models/plan_run.md).

## Story F18 — Keep a meeting on track

> As a participant, I want reminders and a way to tell the group when plans change.

### Logistics follow the accepted opportunity and sending rules

Send permitted reminders and a day-of check-in. Relay a late arrival. Offer a reviewed, eligible replacement or reschedule when someone drops, or cancel gracefully if minimum participation fails. A booked group cannot continue with fewer than three people. Record attendance and apply the contextual no-show rule. STOP, bans, blocks and quiet hours still apply.

Models: [plan run](../models/plan_run.md), [outbound queue](../models/outbound_queue.md).

## Story F19 — Give feedback and meet again

> As a participant, I want to say how it went without forcing a conversation with the other person.

### Feedback changes future context privately

Ask factual questions first, then whether it was worthwhile and whether the person wants to meet again. Update contextual reliability, intent and edges. Offer a second encounter when mutual evidence and current policy support it. Keep negative feedback private. Sample whether an interruption was worthwhile under the one-open-question rule.

Models: [opportunity](../models/opportunity.md), [profile learning](../models/profile_learning.md), [notification and capital](../models/notify_capital.md).

## Story F20 — Set my participation

> As a member, I want to say when and about what the agent may contact me.

### Text controls change permission before later sends

Interpret plain-language categories, quiet hours, pause and resume. Confirm the new setting briefly. STOP and STOP ALL stop the shared line across apps. Leave removes one app. START and HELP have their own consent-aware path. Preserve the member's control across channels and prevent ordinary sends during an opt-out.

Models: [turn consent](../models/turn_consent.md), [outbound queue](../models/outbound_queue.md), [safety and trust](../models/safety_trust.md).

## Story F21 — Hear when nothing fits

> As a member, I want an honest response when the Network has nothing useful yet.

### Explain the next available step without sending filler

If nothing clears the bar for an intent after the configured interval, normally ten days, record the reason. Offer a short relevant question, an outside-world suggestion, another format or a vouch invitation where permitted. Respect category and interruption settings.

Models: [matching engine](../models/matching_engine.md), [profile learning](../models/profile_learning.md).

## Story F22 — Attend a Network gathering

> As a Network member, I want a periodic local gathering where I can meet people without managing the logistics.

### A gathering has invitations, opt-in and follow-up

An admin creates the monthly public city gathering and approves eligible invitation priority. Collect RSVPs, suggest small groupings, remind as permitted and ask whom members would like to see again. Apply adult eligibility and review to member connections. This follows the slop pilot in the NYC Network rollout.

Models: [plan run](../models/plan_run.md), [review desk](../models/review_desk.md), [matching engine](../models/matching_engine.md).

## Story F23 — Block or report

> As a member, I want to stop contact and tell safety staff about a concern.

### A block takes effect now and a report has an accountable owner

A block stops pair contact across apps and invalidates queued work for the pair. Record a report with necessary evidence and route by severity. Authorized safety staff can impose a hold or ban, triage urgent cases and process a decision with a recorded reason. For immediate danger, tell the person to contact emergency services.

Models: [safety and trust](../models/safety_trust.md), [outbound queue](../models/outbound_queue.md), [console privacy](../models/console_privacy.md).

## Story F24 — Export or delete my data

> As a member, I want to get a copy of my data or remove it.

### Data requests use the support path and reach derived data

Direct the person to help@ntwrk.party for formal export and erasure requests. Verify ownership and scope. An authorized agent can read the person's own profile on the current app for confirmation. Export includes stored and derived data where permitted. Erasure closes open opportunities, clears affected records and derived state, and propagates through restore. Preserve only retained safety and suppression evidence under policy. A per-app leave affects that app alone.

Models: [identity lifecycle](../models/identity_sagas.md), [profile read](../models/profile_read.md), [backup and restore](../models/backup_restore.md).

## Story F25 — Keep my account when my number changes

> As a member, I want my new number to keep my profile, grants and history without handing them to the next owner of my old number.

### Change possession without changing the person

Verify the new number and confirm from the old number or use steward recovery. Update authorized identity mappings and grants. End stale sessions. Preserve the person ID and membership history. Reusing a released number must not expose the former person's account.

Models: [phone identity](../models/phone_identity.md), [identity lifecycle](../models/identity_sagas.md), [OAuth and MCP](../models/oauth_mcp.md).

## Story F26 — Set travel and presence

> As a member, I want to tell the agent where I will be and when I am available there.

### Presence is time-bounded and coarse

Store confirmed city and time windows. Use travel tolerance and any visitor opt-in in the relevant app. Expire the travel window automatically. A supported signup or presence region does not enable live matching there. Expose only coarse area or travel bands.

Models: [matching engine](../models/matching_engine.md), [candidate pool](../models/candidate_pool.md).

## Story F27 — Review before contact

> As a reviewer, I want enough safe context to approve, edit, swap, re-roll or reject a proposal.

### Review is authorized, current and recorded

Show the app, origin, scrubbed context, reasons, proposed copy, timeline and deadline to the assigned reviewer. Store the decision, reviewer, reason and evidence as audit data. Recheck all participants on approval and dispatch. A materially changed proposal must pass review again. Expiry prevents a late send. Simulated review is confined to the simulation.

Models: [review desk](../models/review_desk.md), [staff console](../models/staff_console.md), [console privacy](../models/console_privacy.md).

## Story F28 — Stop asking when I do not answer

> As a member, I want the agent to stop offering things when I leave messages unanswered.

### Two unanswered invitations pause new offers

Count an invitation when it expires or reaches 72 hours unanswered. After two in succession, accept only requested opportunities and permitted notices or logistics. An eligible later inbound turn may offer to resume. A tightly limited high-value re-engagement follows carrier rules and the [delivery policy](policies.md#interruption-and-delivery).

Models: [outbound queue](../models/outbound_queue.md), [turn consent](../models/turn_consent.md).

## Story F29 — Close an expired or underfilled opportunity

> As a participant, I want the agent to release my time if an offer expires or a group cannot reach quorum.

### Expiry is terminal for that invitation

Expire with the Clock. Use eligible reviewed alternates only within the permitted window. Once expiry or quorum failure is final, close all affected pending work and notify participating members without exposing other replies.

Models: [opportunity](../models/opportunity.md), [plan run](../models/plan_run.md), [outbound queue](../models/outbound_queue.md).

## Story F30 — Join the app I asked for

> As someone already using an agent or the shared line, I want to join the right app with my own approved information.

### Routing and authorization are app-bound

A named app or domain selects that app. A no-keyword text join starts at The Network and asks what the person seeks. Keep the invite boundary on app-bound Network signup. Check consent version and approved profile before submitting, then read back the app and the profile. Join mode, matching activation and send approval are separate states. A different app cannot see that the person already has another membership.

Models: [generated site enrollment](../siteEnrollment.md), [Cloud authentication](../models/cloud_auth.md), [OAuth and MCP](../models/oauth_mcp.md), [turn consent](../models/turn_consent.md), [profile read](../models/profile_read.md).

## Story F31 — Add my adult dating photos privately

> As an adult Slop member, I want to choose photos for matching and retain control of sharing them.

### Private rating eligibility is checked again after rating

Confirm adult age, consent, app and ban status before fetching or processing a photo. Store it privately, remove unneeded metadata, and never include a photo in a probe. Clef ratings can affect matching as soft inputs. Scores stay private and are removed when the member, age or photo is no longer eligible. A member can choose an item to share only through F16.

Models: [photos and rating](../models/photos_rating.md), [photo relay item](../models/photo_relay_item.md), [member age rules](../memberAge.md).

## Story F32 — Keep meeting a public activity group

> As a member of a group that went well, I want to meet again without starting over.

### Recurrence uses a fresh session with its own consent

Build a new session around the shared activity, overlapping availability, travel limits and a rotating host. Recheck membership, blocks and eligibility before each session. When a group is ready for its own chat, let its consenting members take it forward. Friends targets the same members meeting again.

Models: [plan crew](../models/plan_crew.md), [plan run](../models/plan_run.md).

## Story F33 — Choose a hiring introduction

> As a candidate or hiring team, I want an introduction I can evaluate without being ranked for an employer by the service.

### The candidate consents first and hiring stays human

Only verified employers with pay ranges can reach a candidate. Exclude protected traits and proxies from automated matching. Respect current-employer blocks and qualification filters. Ask candidates first and send unranked slates with must-have checks after consent. Staff review introductions. Hiring teams make the decisions.

Models: [matching engine](../models/matching_engine.md), [candidate pool](../models/candidate_pool.md), [review desk](../models/review_desk.md).

## Story F34 — See my contribution history

> As an adult member, I want to know what I have contributed without competing for a visible rank.

### Contributions have evidence and limited effects

Record vouches, attendance, feedback, confirmed help and organizing. Show the member their itemized history in conversation. Apply effort, invite and organizing limits privately. Maintain a baseline of access and separate contextual reliability. Do not penalize declines, pause or inactivity.

Model: [notification and capital](../models/notify_capital.md).

## Story F35 — Inspect a member's experience as staff

> As authorized staff, I want to inspect a flow and its evidence in the Observatory without seeing unrelated private data.

### The console limits scope and audits access

Provide app-scoped member history, review, proposal and match evidence, safety, demand, costs, growth, fairness, event, health and simulation views. Show messages, prior decisions, send or suppress reasons and leak results within two clicks from a member. Keep real and simulated environments explicit. Scrub data by default, write the access audit before a sensitive read and use the admin API for actions. Require a reason for a limited reveal.

Models: [staff console](../models/staff_console.md), [console views](../models/console_views.md), [console privacy](../models/console_privacy.md), [Observatory synchronization](../models/observatory_sync.md).

## Story F36 — Recover service without duplicate sends or lost data

> As an operator, I want a retry, restart, restore or cutover to keep member state and send authority consistent.

### Durable identity and dispatch survive handoff

Persist jobs, message IDs, provider outcomes, consent, app scope and erasure evidence. Claim work with ownership and expiry, recheck eligibility at dispatch and reconcile unknown provider outcomes. Restore in isolation and replay erasures before activation. Keep only one live owner of inbound turns and delivery. Inspect build identity, logs, budget, heartbeat, queue age, failures and safety alerts.

Models: [runtime operations](../models/runtime_ops.md), [backup and restore](../models/backup_restore.md), [boot configuration](../models/boot_config.md), [outbound queue](../models/outbound_queue.md).

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
