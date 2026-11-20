# Network classifier: recognize messaging handles, phone variations, and request verbs in contact extraction

## Problem and root cause

In `@thenetwork/network` (`packages/network/src/classify.ts`), inbound message understanding identifies abuse signals before any downstream model or handler touches a member message (PRD 32.14, 36.1). `RX.extraction` detects contact extraction abuse (attempts by members to solicit contact details of other members from the agent).

Several critical blindspots were addressed:
1. **Singular "their number"** now recognized without requiring plural `numbers`.
2. **Contact request verbs expanded**: `tell me`, `do you have`, `have you got`, `send over`, `pass along`, `text me`, `drop me`, `provide`, `forward`, `what about`, `how about`, and `can you (send|tell|give|share|provide|forward)`.
3. **Messaging platforms and colloquial phone terms**: `digits`, `mobile`, `whatsapp`, `telegram`, `signal`, `wechat`, and `discord`.
4. **Scoping possessives to requests and exclusions**:
   - Possessive requests (`can you send me Alice's signal`, `what's Alice's whatsapp`, `do you have Bob's telegram`) and standalone queries (`Alice's whatsapp?`) are flagged.
   - Benign possessive statements (`Alice's WhatsApp is broken`, `Bob's Telegram account got hacked`, `Charlie's mobile was stolen`, `the store's number is busy`, `the driver's phone died`, `here's my friend's number if needed`) and non-member entities (`venue`, `place`, `restaurant`, `shop`, `store`, `building`, `hotel`, `driver`, `uber`, `lyft`, `friend`, `coworker`, `roommate`, `nobody`, `everyone`, etc.) are protected from false abuse flags.

## Verification

```sh
bun test packages/network/test/classify-contact-extraction.test.ts
bun x tsc --noEmit
bun run sim --only evals,friends,network
```

Results:
- `packages/network/test/classify-contact-extraction.test.ts`: 5 pass, 0 fail, 57 expect assertions.
- Typecheck: 0 errors across 4 tsconfigs.
- Simulation: 104/104 blocking gates pass.

## Slop Contribution Receipt
```json
{
  "provider": "google",
  "model": "gemini-2.5-pro",
  "client": "antigravity"
}
```
