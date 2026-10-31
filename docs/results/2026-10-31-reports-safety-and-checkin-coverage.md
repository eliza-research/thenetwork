# Safety Reports and Post-Date Check-In Report Classification Coverage

## Summary
- Expands safety report kind detection in `packages/network/src/reports.ts` (`reportKindOf` and `checkInReport`):
  - **`unsafe`**: Recognizes explicit physical violence, weapons, and assault terminology (`weapon`, `knife`, `gun`, `punched`, `hit me`, `struck me`, `shoved me`, `beat me`, `attack(ed)?`, `violence`).
  - **`minor`**: Recognizes third-party noun subjects (`the guy/girl/dude/person/date/man/woman`), named individuals, and `yo` abbreviations (`15yo`, `16 yo`), while protecting temporal durations and units (`years?`, `yrs?`, `months?`, etc.) via negative lookaheads.
  - **`scam`**: Recognizes modern payment methods and transfer scams (`paypal`, `apple pay`, `crypto`, `bitcoin`, `usdt`, `borrow(ed)? money`, `ponzi`, `pyramid scheme`).
  - **`harassment`**: Recognizes stalking phrasing (`stalk(ed|ing)?`).
  - **`no_show`**: Recognizes common no-show variations (`didn't arrive`, `never arrived`, `never showed up`, `bailed on me`).

## Rationale & Impact
Under PRD 36.3 and 40.5, urgent report kinds (`unsafe`, `minor`, `scam`, `harassment`) carry a 1-hour staff resolution SLA and immediate protection measures (e.g. member safety holds and automatic pair blocks). Furthermore, `checkInReport` silently dropped critical post-date member check-in replies reporting physical violence, weapons, or no-shows unless they happened to contain the explicit word "report" or fit the previously narrow regexes.

## Test & Verification
- Unit test added: `packages/network/test/reports-kinds-classification.test.ts` (7 tests pass, 0 fail, 89 expect assertions).
- Evals simulation: `bun run sim --only evals` (25/25 blocking gates pass, 0.4s).
- Quick network simulation: `bun run sim --only network --quick` (47/47 blocking gates pass).
- Typecheck: `bun run typecheck` (pass 100%).

## Slop Contribution Receipt
```json
{
  "provider": "google",
  "model": "gemini-2.5-pro",
  "client": "antigravity"
}
```
