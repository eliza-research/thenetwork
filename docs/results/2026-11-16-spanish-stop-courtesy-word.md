# The consent ledger does not read a Spanish STOP with a courtesy or emphasis word

On November 16, 2026 the deterministic Evals block passed 29 of 30 blocking
gates before this change and 30 of 30 after it. The changed gate reads 164
hand-written opt-out lines in English and Spanish. The reader is
deterministic. It calls no model and sends no message.

## Result

`detectKeyword` (`packages/platform/src/consent.ts`) is the strict reader that
the consent ledger acts on. It reads an English STOP with a courtesy or
urgency word around it: `KEYWORDS.stopTail` and `STOP_TAIL_RX` accept
"STOP PLEASE", "PLS STOP NOW" and "STOP ALL PLS".

Spanish has no such rule. A Spanish stop word was a STOP only as the whole
message. One extra word dropped the opt-out:

| Message | `main` before | This branch | Corpus label |
|---|---|---|---|
| basta ya | none | stop | stop |
| ya basta | none | stop | stop |
| basta por favor | none | stop | stop |
| ya basta por favor | none | stop | stop |
| para ya | none | stop | stop |
| alto ya | none | stop | stop |
| basta de hablar de mi ex | none | none | not_stop |
| baja ya, te espero abajo | none | none | not_stop |

"Ya" is the common Spanish emphasis ("enough already"). "Por favor" is the
Spanish "please". A Spanish-speaking member who sends "basta ya" gets no
opt-out event, no STOP confirmation, and keeps the normal message path. The
member asked to stop and the platform did not read it. That is the
"reasonable means" rule in the comment above `OPT_OUT_EN`: a short message
that clearly asks the sender to stop texting is a STOP.

## Reproduction

```bash
cd /tmp/wt-tn   # a checkout of main
bun -e '
import { detectKeyword } from "./packages/platform/src/consent.ts";
for (const t of ["basta ya","ya basta","basta por favor","para ya","alto ya"]) console.log(t, "->", detectKeyword(t) ?? "none");
'
```

`main` (`ebf3e61`): every line prints `-> none`.

The gate fails on `main` with the corpus rows added (a labels-only change):

```
$ bun run sim --only evals
FAIL  platform opt-out (n 164, en + es): every opt-out line is a STOP, no other line is: stop: basta ya -> none; stop: ya basta -> none; stop: basta por favor -> none; stop: ya basta por favor -> none; stop: para ya -> none
FAIL: 29/30 blocking gates, 0 tracked off target, 2.6s (evals 2.6s)
```

With the fix:

```
$ bun run sim --only evals
PASS: 30/30 blocking gates, 0 tracked off target, 1.2s (evals 1.2s)
```

## Fix

One anchored pattern in `OPT_OUT_ES` (`packages/core/src/replies.ts`), which
`optOutPhrase` and the ledger already call:

```
/^(?:ya )?(?:no mas mensajes|no mas|para|parar|alto|basta|cancelar|detener)(?: (?:ya|por favor|porfavor|please|pls|gracias|ahora|ahora mismo|de una vez))*$/
```

The pattern is anchored to the whole message, so a sentence about something
else is not a stop ("basta de hablar de mi ex"). "Baja" is left out on
purpose, because "baja ya" can mean "come down now". "Baja" alone is still a
STOP through `KEYWORDS.stopEs`.

Two other implementations were rejected:

1. Add the Spanish words to `KEYWORDS.stopTail` and reuse `STOP_TAIL_RX`.
   That regex is built around the English word `STOP`. A Spanish stop word
   would still need its own alternation, and the table would claim that
   `YA` is a courtesy word for an English STOP ("STOP YA"), which is not the
   rule.
2. Read the case in the service (`packages/network/service/service.ts`).
   That is a second reader of the same field. The comment above `OPT_OUT_EN`
   says one strict reading exists for the whole platform.

## Limits

- This change covers the strict ledger reader only. The conversational reader
  (`parseOptOut`) already returns `likely` for "basta ya".
- "basta de mensajes" ("enough of messages") is not in this change. It needs
  a noun-tail rule and its own corpus rows.
- The change reads text only. It sends no message and changes no safety gate.

Commands: `bun run sim --only evals` (164 corpus rows, no seeds, deterministic,
no provider, no model).
