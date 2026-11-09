# Safety report recognition: uncontracted modals, physical violence, weapons, and scams

## Problem and root cause

In `@network/network` (`packages/network/src/reports.ts`), `KINDS` maps regular expressions to report categories: `"minor"`, `"unsafe"`, `"harassment"`, `"scam"`, `"lying"`, and `"no_show"`.
In `Network.onFeedback` (`packages/network/src/network.ts:2608-2616`), `checkInReport(body)` parses a member's check-in response following an in-person meeting:
```typescript
const reportKind = this.opts.hooks?.postDateReports && !o.plan ? checkInReport(body) ?? (f.otherNoShow ? "no_show" : undefined) : undefined;
if (reportKind) {
  for (const other of others) {
    this.fileReport(m.id, other, reportKind, { oppId: o.id, source: "check_in", met: true });
    this.blocks.add(pairKey(m.id, other));
    this.ctx.recordBlock(m.id, other);
    if (reportKind === "minor") { const t = this.members.get(other); if (t) this.minorReported(t, m.id); }
  }
  this.send(m, copy.reported, { type: "info" }, "reply");
}
```
If `reportKindOf(text)` returns `"other"` and the text does not contain explicit meta keywords (`"report"`, `"flag"`, `"safety team"`), `checkInReport(text)` returns `undefined`.

Prior to this fix, `KINDS` suffered from critical omissions across high-severity safety categories:
1. **Uncontracted modal negations**:
   - `unsafe`: Only matched `wouldn'?t let me (go|leave)`. Statements like `"he would not let me leave"`, `"he did not let me leave"`, or `"he refused to let me go"` were returned as `"other"`.
   - `no_show`: Only matched `didn'?t (show|come|turn up)`. Natural phrases like `"she did not show up"`, `"he did not come"`, or `"they never arrived"` were missed.
   - `lying`: Only matched `(didn'?t|doesn'?t) look like`. Phrases like `"he did not look like his photos"` or `"does not look like her pictures"` were missed.
   - `harassment`: Only matched `wouldn'?t stop`. Phrases like `"he would not stop texting me"` or `"refused to stop"` were missed.
2. **Physical violence and battery in `unsafe`**:
   - Critical physical assault verbs (`"he hit me"`, `"he punched me"`, `"he attacked me"`, `"he choked me"`, `"he strangled me"`, `"he slapped me"`, `"he shoved me"`, `"he pushed me"`) and confinement (`"cornered me"`, `"trapped me"`, `"locked me in"`) were not matched.
   - Weapons (`"had a weapon"`, `"pulled a knife"`, `"pulled a gun"`, `"threatened me with a knife"`) and stalkers (`"stalked me"`, `"a stalker"`) were missing.
   - Extreme distress (`"I was terrified"`, `"terrifying"`) was uncatalogued.
3. **Direct scams and harassment**:
   - `scam`: Demands for cash (`"demanded cash"`, `"asked for cash"`, `"asked to borrow money"`, `"wire funds"`, `"paypal"`) were missing.
   - `harassment`: Unsolicited photos (`"unsolicited pics"`, `"unsolicited photos"`, `"dick pic"`) and unwanted physical touch (`"unwanted touching"`, `"inappropriate physical contact"`) were missing.

### Safety impact:
When a victim reported physical violence, confinement, or stalking during post-date check-in without using the meta word `"report"`:
- No `SafetyReport` was filed;
- The subject was not placed on safety hold (`reportHeld`);
- Mutual blocks were not recorded;
- The offender remained active in the pool to be matched with further members.

## Fix

1. `packages/network/src/reports.ts`:
   - Expanded `KINDS["unsafe"]` to recognize uncontracted detainment (`(?:wouldn'?t|would not|didn'?t|did not|refused to) let me (?:go|leave|out)`), physical battery anchored to person subjects (`(?:(?:he|she|they|the (?:guy|girl|dude|person|date|man|woman)|(?:that|this) (?:guy|girl|dude|person|date|man|woman)|my date)\s+(?:hit\s+me(?!\s+up\b)|struck\s+me(?!\s+as\b)|punched\s+me|attacked\s+me|choked\s+me|strangled\s+me|slapped\s+me|shoved\s+me|cornered\s+me|trapped\s+me|locked\s+me|pushed\s+me(?!\s+(?:to|out of|into trying)\b)))`), weapons (`(?:had|pulled|threatened me with) a (?:weapon|knife|gun)`), stalking (`stalk(?:ed|ing)? me`, `a stalker`), and extreme distress (`terrified`). Excludes benign idioms (`"it hit me later..."`, `"she pushed me out of my comfort zone"`, `"watched a terrifying movie"`).
   - Expanded `KINDS["harassment"]` to recognize uncontracted persistence (`(?:wouldn'?t|would not|refused to) stop`), unsolicited images (`unsolicited (?:pics?|photos?|pictures?|nudes?)`, `dick pics?`), and unwanted touch (`(?:unwanted|inappropriate) (?:touch(?:ed|ing)?|physical contact)`).
   - Expanded `KINDS["scam"]` to recognize cash demands (`(?:asked|demanded)(?: me)?(?: for)? (?:money|cash)`), borrowing pitches (`asked to borrow money`, `borrow money`, `lend money`), wire transfers (`wire (?:me|money|funds)`), and PayPal (`paypal`).
   - Expanded `KINDS["lying"]` to recognize uncontracted discrepancies (`(?:didn'?t|did not|doesn'?t|does not) look like (?:their|his|her) (?:photos?|pics?|pictures?)`).
   - Expanded `KINDS["no_show"]` to recognize uncontracted absence phrases (`(?:didn'?t|did not) (?:show|come|turn up)`, `never (?:showed|came|turned up)`, `stood (?:me|us) up`), and person-anchored arrival negations (`(?:he|she|they|the (?:guy|girl|dude|person|date)|my date|partner)\s+(?:never|didn'?t|did not)\s+arriv(e|ed)`), preventing false positives on transit or food deliveries (`"our food did not arrive on time"`).

2. `scripts/sim/safety.ts`:
   - Added assertions to the `check-in after a date (slop live path)` blocking gate covering detainment, physical violence, weapons, stalking, cash demands, paypal, unsolicited photos, uncontracted photo discrepancies, and uncontracted absence.

3. `packages/network/test/reports-safety-violence.test.ts`:
   - Added unit test suite with 10 tests and 68 assertions verifying classification, check-in detection, urgency tags, and negative controls.

## Verification

```sh
bun test packages/network/test/reports-safety-violence.test.ts
bun run sim --only safety
bun run typecheck
```

Results:
- `bun test packages/network/test/reports-safety-violence.test.ts`: 12 pass, 0 fail, 75 assertions (15ms).
- `bun run sim --only safety`: 11/11 blocking gates pass (4.4s).
- `bun run typecheck`: exit 0.

Deterministic rules-first logic. Zero model calls. No UI or copy files changed.
