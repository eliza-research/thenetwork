# Product

Status: written by a Claude agent from the founder direction of 2026-10-08 and from
`docs/research/2026-10-08-platform-architecture.md`. The founders have not reviewed it.

## Register

brand

## Users

People who read a site on a phone, often after a friend sends a link. Most already use an AI agent
that knows them. They want to know what the service is, whether it is safe, and how to
join or leave. Each site has one job: explain one app, let a person join it by phone, and let a
member see, export, stop or delete their data.

## Product Purpose

One backend, one admin panel and one database serve four apps. Each app has its own site:

| App | Site | What it does |
|---|---|---|
| ntwrk | ntwrk.party | The Network: a person joins and says which they want: friends, dating, work |
| slop | slop.date | Dating by text. 13+ may join; matching and photos are 18+ only |
| peon | peon.biz | Hiring by text: candidates and teams (waitlist until matching is live) |
| friends | friends.help | Friends: small groups and plans at public places |

Each site is its own brand (founder direction, 2026-10-10). No app site names The Network or another
app, and ntwrk.party names no app. A site never shows or hints at another app that a phone number uses.

## Brand Personality

One system: black and white, much empty space, one typeface (Host Grotesk), and one colour per site
on the highlighted word of the headline.

- ntwrk.party: black. Calm, plain, trusted.
- slop.date: acid chartreuse. Wry, warm, honest. It jokes about dating apps, never about safety.
- peon.biz: orange. Practical, fair, no hype.
- friends.help: green. Friendly, outdoors.

## Anti-references

- Swipe-app gloss (gradients, glass cards, stock couples).
- SaaS landing templates (hero metric, three icon cards, logo walls).
- Recruiting-platform blue with stock handshakes.
- Eyebrows, section labels and explanation blocks on a landing page.

## Design Principles

1. Say what happens to the person's number and data before asking for it.
2. One clear action per page. Joining is three short steps.
3. Every safety and legal sentence is easy to find and plain to read.
4. Never reveal another app a number uses. Same words and same flow for every phone number.
5. The landing page works with no JavaScript.

## Accessibility & Inclusion

WCAG 2.2 AA. Body text contrast 4.5:1 or more. Labels on every field. Errors in text, announced
with `aria-live`. Visible focus. Works at 320 px wide. Respects `prefers-reduced-motion`.
