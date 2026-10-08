# Runbook: deeplink device test

Purpose: confirm every link we plan to text before notifications or the paste-prompt flow ship (entry-flows doc, decision 5). Repeat monthly and after any assistant app update that changes link handling.

## Setup

1. Generate the test page: `bun run packages/notify/scripts/link-test-page.ts deeplink-test.html +1<network line>`.
2. Put the page on a phone. Text it to yourself from the Network line or AirDrop it. Opening it from Messages is the realistic case.
3. Each phone needs the ChatGPT, Claude and Grok apps, signed in. Repeat once with an app uninstalled to see the web fallback.

## What to record per link

- App or browser?
- Prompt filled in?
- Sent without tapping Send? (This must be "no" for every link we use.)
- On an `sms:` link: did Messages open with the right number and body?

## Results

| ID | Link | Desktop web, logged out (2026-10-08) | Desktop, signed in | iPhone (iMessage) | Android (SMS) |
|---|---|---|---|---|---|
| A1 | ChatGPT `?prompt=` update | Fills the box, does not send | | | |
| A2 | ChatGPT `?q=` update | Auto-sends (agent test 2026-10-08). **Do not use** | | | |
| A3 | ChatGPT `?prompt=` import prompt | | | | |
| B1 | Claude `/new?q=` update | Redirects to login and keeps `q` in the return URL; prefill after sign-in not yet checked | | | |
| B2 | Claude import prompt | | | | |
| B3 | Claude "add custom connector" | | | | |
| C1 | Grok `?q=` update | "Send this message?" confirm; sends only on Send | | | |
| C2 | Grok import prompt | | | | |
| C3 | `x.com/i/grok?text=` | | | | |
| D1 | `sms:…&body=` | n/a | n/a | | |
| D2 | `sms:…?body=` | n/a | n/a | | |

## Decide from the results

- Any assistant link that opens the browser instead of the app on iPhone: send our button page for that assistant instead (`resolveDelivery` treats it like SMS).
- Any link that auto-sends: remove it.
- Whichever `sms:` form works on both platforms becomes the paste-prompt join link.
