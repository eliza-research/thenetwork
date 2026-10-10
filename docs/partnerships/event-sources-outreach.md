# Event source partnerships: outreach drafts

Why: the event-ingestion PoC ([results](../../prototypes/poc-event-ingestion/RESULTS.md)) found that sources whose terms allow ingestion give enough raw events per city, but mostly civic ones. The relevant tech and social events sit behind Eventbrite, Meetup and Partiful, whose terms forbid scraping, and behind Cerebral Valley's capped feed. PRD 32.6 now requires partner or API agreements for these.

What we ask every source for is the same. Each draft states it, so nobody over-promises:
- Read-only access to **public** events in **San Francisco and New York**: title, start/end, venue or neighbourhood, category, and the canonical URL.
- We **store minimal metadata, always link back** to the source page for RSVP or tickets, never re-host or resell, and attribute the source in every recommendation.
- Volume: a private, invite-only pilot of about 150-300 members per city, with a nightly pull and one refresh during the day.
- Nothing about the source's users flows to us, and we never message their attendees.

Status: **drafts, not sent.** Each should go from the founders' account (sender to be confirmed).

## 1. Cerebral Valley (highest value: most of the relevant SF/NYC tech events)

- **Channel:** platform message at https://cerebralvalley.ai/u/cv. The site lists no email; the summit team is at summits@newcomer.co, but that is a different business.
- **Ask:** lift the 760-listing cap on `llms-full.txt`, or provide a city- and date-filtered feed or API key.

> Hi Cerebral Valley team, we're building The Network, an invite-only service that introduces people in SF and NYC to each other and to things worth doing together, over iMessage/SMS. Your events are the backbone of what our members want, and your llms.txt says agents are welcome, so thank you. The catch: llms-full.txt stops at the first ~760 listings worldwide, which during busy weeks only reaches a day or two ahead. Could we get a city/date-filtered feed (or an API key for the paged endpoint that robots.txt currently blocks)? We'd pull nightly, store only title/time/place/link, always link back to your event page, credit Cerebral Valley in every recommendation, and never message attendees. Happy to share anonymised stats on which events our members go to, if that's useful to you. — [name], The Network (ntwrk.party)

## 2. Luma

- **Channel:** support@luma.com, asking for Enterprise or partner API access.
- **Ask:** read access to the public city discovery data (`luma.com/{city}`), not only calendars we own. The Luma Plus API covers your own calendars only.

> Subject: Partner API access for public SF/NYC event discovery
>
> Hi Luma team, we're The Network, an invite-only service in San Francisco and New York that recommends events and small-group plans to members over iMessage/SMS. Many of the events our members want are on Luma. Today we only use public calendar subscription (ICS) feeds for calendars we choose to follow, which keeps us within your terms but misses most of the city. Is there a partner or Enterprise path to read the public discovery listings for SF and NYC (title, time, location, link)? We'd always send members to the Luma event page to RSVP, store minimal metadata, attribute Luma, and never contact attendees. Happy to get on a call. — [name], The Network (ntwrk.party)

## 3. Meetup

- **Channel:** Meetup Community Support request (https://www.meetup.com/graphql/support/), asking about partner access.
- **Ask:** read access to public events in SF and NYC across groups. The Pro GraphQL API ($55/group/month) covers only your own Pro network.

> Hi Meetup team, we're The Network, an invite-only community service in SF and NYC that helps members find people and groups to do things with. Members regularly want Meetup groups (running clubs, language exchanges, hobby groups). Is there a partner programme for read-only access to public event listings in those two cities? Pro API access looks scoped to a Pro network's own groups. We'd link every recommendation back to the Meetup event page for RSVP, store minimal metadata, and never message members or attendees. — [name], The Network (ntwrk.party)

## 4. Eventbrite

- **Channel:** apply to the Distribution Partner Program. Public event search was retired in December 2019, and distribution partners are the documented route; ask for the application through the developer portal or partner team.
- **Ask:** distribution-partner read access for SF and NYC public events. Ticket purchase stays on Eventbrite.

> Hi Eventbrite partnerships, we'd like to apply to the Distribution Partner Program. The Network is an invite-only service in SF and NYC that recommends events to members over iMessage/SMS and helps small groups go together. We'd surface public Eventbrite events with a link to the Eventbrite page for tickets (we never sell or re-host tickets), store minimal metadata, attribute Eventbrite, and drive attendance from small groups that already know each other. Could you share the application process? — [name], The Network (ntwrk.party)

## 5. Partiful

- **Channel:** partnerships@partiful.com.
- **Ask:** a sanctioned way to include **public** Partiful events. Partiful is mostly private invites, so expect a narrow scope; their links already reach us through Cerebral Valley.

> Subject: Public events in SF/NYC: partnership question
>
> Hi Partiful team, we're The Network, an invite-only service in SF and NYC that recommends things to do and helps small groups go together, over iMessage/SMS. A lot of the public events our members want are hosted on Partiful (we see them linked from community calendars). We don't scrape and never would; is there a sanctioned way to include public Partiful events (title, time, neighbourhood, link) in recommendations, sending people to the Partiful page to RSVP? We'd never touch private invites or guest lists. — [name], The Network (ntwrk.party)

Sources: [Luma API help](https://help.luma.com/p/luma-api), [Meetup API access](https://help.meetup.com/hc/en-us/articles/41453576628749-How-can-I-get-access-to-Meetup-s-API), [Eventbrite changelog](https://www.eventbrite.com/platform/docs/changelog), [Partiful partnerships](https://help.partiful.com/en-us/articles/15525618-how-can-i-contact-partiful-for-brand-partnership-opportunities), [Cerebral Valley](https://cerebralvalley.ai/).
