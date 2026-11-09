# Safety Reports and Post-Date Check-In Report Classification Coverage

## Summary
- Expands safety report kind detection in `packages/network/src/reports.ts` (`reportKindOf` and `checkInReport`):
  - **`unsafe`**: Recognizes explicit physical violence, weapons, and assault terminology (`weapon`, `knife`, `gun`, `attack(ed)?`, `violence`, `physically beat me`, `beat me up`, `punched me`, `shoved me`), while requiring person subjects and guards against figurative idioms (`hit me(?!\s+up\b)`, `struck me(?!\s+as\b)`).
  - **`minor`**: Recognizes third-party person noun subjects (`(?:he|she|they|the (?:guy|girl|dude|person|date|man|woman)|(?:that|this) (?:guy|girl|dude|person|date|man|woman))`) and `yo` abbreviations (`15yo`, `16 yo`), requiring explicit units (`(?:years?|yrs?|yo)\s*old`) to protect temporal durations, group counts, ratings, and weather (`March was 12 degrees`, `dinner was 10/10`, `6 of us`, `2 old friends`).
  - **`scam`**: Recognizes modern payment methods and transfer scams (`venmo`, `cashapp`, `zelle`, `crypto`, `bitcoin`, `usdt`, `borrow(ed)? money`, `ponzi`, `pyramid scheme`), while requiring payment-request context for retail methods like `paypal` and `apple pay` to avoid false positives on split bills (`we split dinner on apple pay`).
  - **`harassment`**: Recognizes stalking phrasing (`stalk(ed|ing)?`).
  - **`no_show`**: Recognizes common no-show variations with person subjects (`(?:he|she|they|the (?:guy|girl|date|person)|my date|partner)\s+(?:never|didn'?t)\s+arriv(e|ed)`, `bailed on me`, `stood me up`, `ghosted me`), preventing false positives on transit delays (`my train didn't arrive until 8`).

## Rationale & Impact
Under PRD 36.3 and 40.5, urgent report kinds (`unsafe`, `minor`, `scam`, `harassment`) carry a 1-hour staff resolution SLA and immediate protection measures (e.g. member safety holds and automatic pair blocks). Furthermore, `checkInReport` silently dropped critical post-date member check-in replies reporting physical violence, weapons, or no-shows unless they happened to contain the explicit word "report" or fit the previously narrow regexes.

## Test & Verification
- Unit test added: `packages/network/test/reports-kinds-classification.test.ts` (10 tests pass, 0 fail, 138 expect assertions).
- Evals simulation: `bun run sim --only evals` (25/25 blocking gates pass, 0.3s).
- Full simulation suite: `bun run sim --only evals,friends,network` (104/104 blocking gates pass).
- Typecheck: `bun x tsc --noEmit` across all 4 tsconfigs (0 errors).

## Slop Contribution Receipt
```json
{
  "provider": "google",
  "model": "gemini-2.5-pro",
  "client": "antigravity"
}
```
