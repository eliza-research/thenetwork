# Relay request parsing: modal requests, question hedges, preposition symmetry, and message body negation

Date: 2026-10-31.
Base: `origin/main` (d8d339c).
Scope: `packages/engine/src/relay.ts`, `evals/relay/requests.jsonl`, `packages/network/test/relay-request-parsing.test.ts`.

## 1. Summary of defects resolved

In the matched member relay (`parseRelayRequest`), member requests are parsed into `RelayRequest` objects (`contact_share`, `photo`, `text`, or `none`). When `none` is returned, the service silently drops the action and nothing is delivered to the counterpart. Four interconnected defects caused widespread, silent drops of valid member communications:

1. **Polite modal text requests dropped:**
   `TEXT_REQ` was anchored to `^\s*(?:please\s+)?(?:tell|let|ask)`. Common conversational requests like `"Can you tell them I'm running late"`, `"Could you tell Sam that I will be 5 minutes late"`, `"Would you tell them I arrived"`, `"Can you please let them know that I am outside"`, and `"Can you ask them what table they are at?"` failed to match and returned `{ kind: "none" }`.

2. **Unconstrained `\bwould\b` question hedge false positives:**
   Line 465 checked:
   `hedged = HEDGE.test(low) || (/\?\s*$/.test(t) && /^\s*(?:should|would|could i|is it|do you|can i)\b/i.test(t));`
   While `could i` and `can i` were properly constrained with `i`, `would` was unconstrained. Consequently, any polite question starting with `"Would you ... ?"` (e.g. `"Would you send them my number?"`, `"Would you please share my contact info with them?"`, `"Would you send them this photo?"`) was flagged as `hedged: true` and dropped as `{ kind: "none" }`. Constraining to `would (?:it|that|i)` preserves hedging checks on advice/uncertainty queries while allowing polite modal directives.

3. **Preposition and verb asymmetry in contact and photo requests:**
   - In `CONTACT_REQ`, the primary clause included `forward` and `text`, but the inverted prepositional clause `\b(?:share|send|give|pass)\s+my ... (?:with|to) ${OTHER}` omitted them, dropping `"text my number to her"` and `"forward my number to them"`.
   - In `PHOTO_REQ`, the inverted prepositional clause omitted `pass|show`, `the`, and `images?`, dropping `"show this photo to Sam"`, `"send the photo to them"`, `"send this image to her"`, and `"pass this photo to them"`.

4. **Negation scope over relayed message body:**
   Line 465 checked `negated = NEG.test(low)` across the entire input, and line 469 checked `if (m && !negated)`. When a member asked to relay a message containing ordinary negative content (e.g., `"tell them that I won't be long"`, `"let Sam know I do not eat dairy"`, `"tell her I've never been here before"`, `"tell them don't wait for me"`), the negation in the message payload caused the request itself to be treated as refused/negated, dropping the relay. Negation is now scoped to the request clause preceding the verb (`preVerb`), correctly distinguishing between request negations (`"don't tell them I'm late"`) and message payload negations (`"tell them that I won't be long"`).

## 2. Verification & Gates

### Simulation Conformance Gate
Command: `bun run sim --only relay --quick`
```
PASS  relay corpus relay/relay-heldout-1.jsonl: scam held or blocked >= 90% (n 10): 100.0%
PASS  relay corpus relay/relay-heldout-1.jsonl: harassment held or blocked >= 90% (n 10): 100.0%
PASS  relay corpus relay/relay-heldout-1.jsonl: contact held or blocked >= 95% (n 10): 100.0%
PASS  relay corpus relay/relay-heldout-1.jsonl: rating held or blocked >= 95% (n 10): 100.0%
PASS  relay corpus relay/relay-heldout-1.jsonl: honest messages held <= 5% (n 25): 0.0%
PASS  relay corpus relay/relay-heldout-2.jsonl: honest messages held <= 5% (n 25): 0.0%
PASS  relay corpus network/benign-adult.txt: held <= 2% (n 221): 0.0%
PASS  relay requests (n 60): every row read as labelled
PASS  relay requests: 0 hedged, negated or question requests read as a contact share or photo send
PASS  relay: never to or from a minor or an unknown age; a minor's self-disclosure blocks and flags the age
PASS  relay: only inside a mutual match between its two participants; blocks, opt-outs and holds win
PASS  relay: a contact share needs the sender's explicit, fresh consent for that item; one per match; never from free text
PASS  relay: a photo needs the explicit send, the sender's photo consent and their own opaque photo ids
PASS  relay: private facts, canaries, ratings and scores never pass; the sender's own words about themselves do
PASS  relay: rate limits hold a burst; the log has no body, no contact value, no photo id; ban notices from the log
PASS  relay: the plugin path (parseRelayRequest -> relayItemFromRequest -> relayItem) delivers only explicit requests
PASS  relay: the LLM hook runs only on items the rules pass; a flag or an error holds
...
-- relay: 60/60 blocking gates pass, 11 tracked (0.7s)
```

### Unit Tests
Command: `bun test packages/network/test/relay-request-parsing.test.ts`
```
(pass) parseRelayRequest: recognizes polite modal text requests and question forms [0.90ms]
(pass) parseRelayRequest: preserves negated message content without falsely marking relay request as negated [0.06ms]
(pass) parseRelayRequest: honors pre-verb request negations as none [0.03ms]
(pass) parseRelayRequest: recognizes modal requests for contact share and photo sends [0.12ms]
(pass) parseRelayRequest: continues to hold true hedges, advice questions, and explicit refusals as none [0.04ms]
(pass) relay pipeline: end-to-end delivery of modal requests and messages with negative content [3.65ms]

 6 pass
 0 fail
 111 expect() calls
Ran 6 tests across 1 file. [34.00ms]
```

### Typecheck
Command: `bun run typecheck`
All 4 TypeScript projects (`.`, `sites/tsconfig.json`, `packages/observatory/tsconfig.json`, `deploy/cloudflare`) pass with 0 errors.
