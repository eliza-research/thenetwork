# Product

Status: written by a Claude agent from the founder direction of 2026-10-08 and from
`docs/research/2026-10-08-platform-architecture.md`. The founders have not reviewed it.

## Register

brand

## Users

People in New York (and San Francisco for The Network) who read a site on a phone, often after
a friend sends a link. They want to know what the service is, whether it is safe, and how to
join or leave. Each site has one job: explain one app, let a person join it by phone, and let a
member see, export, stop or delete their data.

## Product Purpose

One backend, one admin panel and one database serve four apps. Each app has its own site:

| App | Site | What it does |
|---|---|---|
| ntwrk | ntwrk.love | The Network: invite-only introductions and plans, by text |
| slop | slop.date | Dating by text, 18+ |
| peon | peon.biz | Hiring by text: candidates and teams (waitlist until matching is live) |
| buddies | buddies.nyc | Friends in New York City: small groups and plans at public places |

A site never shows, links or hints at another app a phone number uses.

## Brand Personality

- ntwrk.love: calm, plain, trusted. Keep the existing look.
- slop.date: wry, warm, honest. It jokes about dating apps, never about safety.
- peon.biz: practical, fair, no hype. Reads like a good job posting.
- buddies.nyc: friendly, local, outdoors. Plans in parks and public places.

## Anti-references

- Swipe-app gloss (gradients, glass cards, stock couples).
- SaaS landing templates (hero metric, three icon cards, logo walls).
- Recruiting-platform blue with stock handshakes.
- Subway-sign pastiche for New York.

## Design Principles

1. Say what happens to the person's number and data before asking for it.
2. One clear action per page. Joining is three short steps.
3. Every safety and legal sentence is easy to find and plain to read.
4. Never reveal another app. Same words and same flow for every phone number.
5. The landing page works with no JavaScript.

## Accessibility & Inclusion

WCAG 2.2 AA. Body text contrast 4.5:1 or more. Labels on every field. Errors in text, announced
with `aria-live`. Visible focus. Works at 320 px wide. Respects `prefers-reduced-motion`.
