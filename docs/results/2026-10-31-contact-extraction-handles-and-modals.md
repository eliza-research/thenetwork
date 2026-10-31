# Network classifier: recognize messaging handles, phone variations, and request verbs in contact extraction

## Problem and root cause

In `@thenetwork/network` (`packages/network/src/classify.ts`), inbound message understanding identifies abuse signals before any downstream model or handler touches a member message (PRD 32.14, 36.1). `RX.extraction` detects contact extraction abuse (attempts by members to solicit contact details of other members from the agent).

Several critical blindspots were present in `RX.extraction`:

1. **Singular "their number" missed due to missing quantifier**:
   The pattern contained `\b(their|members'?) (phone )?numbers\b` requiring the plural `numbers`. Natural singular inquiries like `"what about their number"` or `"how about their phone number"` completely evaded detection and returned empty abuse signals (`risk: 0`).
2. **Missing common contact request verbs**:
   The request verb prefix only matched `what's`, `give me`, `send me`, `share`, `get me`, `can i get/have`, `i need`, `i want`, and `pass me`. It omitted frequent and polite forms:
   - `tell me` / `can you tell me` ("can you tell me her number", "tell me his number")
   - `do you have` ("do you have her number?", "do you have their email?")
   - `have you got` ("have you got their phone?")
   - `send over` ("send over their number")
   - `pass along` ("pass along her number")
   - `text me` ("text me her number")
   - `drop me` ("drop me her number")
   - `provide` ("provide their contact details", "can you provide their number")
   - `forward` ("forward me their number")
3. **Missing common messaging platforms and colloquial phone terms**:
   Modern contact solicitation frequently targets non-SMS platforms or colloquial terms:
   - Colloquial phone terms: `digits` ("give me her digits"), `mobile` ("send me her mobile")
   - Messaging apps: `whatsapp` ("give me his whatsapp"), `telegram` ("what is their telegram"), `signal` ("send me her signal"), `wechat` ("what's their wechat"), `discord` ("share their discord")
   While these platforms are strictly protected in `LeakGuard` (`packages/core/src/guard.ts`), `RX.extraction` did not include them, leaving inbound extraction attempts for these platforms unflagged.
4. **Possessive and prepositional phrase omissions**:
   Phrases like `Alice's whatsapp`, `Bob's telegram`, `the telegram of that girl`, and `phone numbers for` were not caught under the restrictive target lists.

## Fix

In `packages/network/src/classify.ts`:
1. Updated `RX.extraction` to:
   - Make the plural marker optional in `\b(their|members'?) (phone |cell |mobile )?numbers?\b` and `\bnumbers? of (everyone|all|members|the)\b`.
   - Expand request verbs:
     `(\b(what'?s|whats|what is|what are|give me|tell me|send me|send over|share|get me|can i (get|have)|do you have|have you got|i need|i want|pass me|pass along|text me|drop me|provide( me)?|forward( me)?)\s+...)`
   - Expand contact types to include `mobile`, `digits`, `whatsapp`, `telegram`, `signal`, `wechat`, and `discord`:
     `((phone |cell |mobile )?numbers?|phone|cell|mobile|digits|address(es)?|emails?|instagram|ig|insta|socials|snap(chat)?|whatsapp|telegram|signal|wechat|discord|handles?|contacts?|last names?)`
   - Cover possessive and relational variants:
     `\b(?!(?:venue|...)'s)\w+'s (number|phone|cell|mobile|digits|address|email|instagram|ig|insta|whatsapp|telegram|signal)\b`
     `\bthe (number|phone|cell|mobile|digits|insta|instagram|email|whatsapp|telegram|signal) (of|for) (the |that )?(girl|guy|person|woman|man|one)\b`
2. Preserved negative lookaheads preventing false positives on legitimate public venue and business inquiries (`venue`, `place`, `restaurant`, `bar`, `cafe`, etc.).
3. Added dedicated unit tests in `packages/network/test/classify-contact-extraction.test.ts` verifying comprehensive detection across all verbs, platforms, and possessive structures, as well as zero false positives on benign conversational phrases and venue questions.

## Verification

```sh
bun test packages/network/test/classify-contact-extraction.test.ts
bun run sim --only network --quick
bun run typecheck
```

Results:
- `packages/network/test/classify-contact-extraction.test.ts`: 4 pass, 0 fail, 48 expect assertions (40ms).
- `bun run sim --only network --quick`: 47/47 blocking gates pass (185.9s).
- `bun run typecheck`: exit 0 (100% clean).

Deterministic classifier rules. Zero model calls. No UI or copy files changed.
