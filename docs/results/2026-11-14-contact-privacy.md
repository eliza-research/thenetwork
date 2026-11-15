# Contact privacy in outbound messages and model input

On November 14, 2026, we ran `bun run sim --only evals` before and after
the changes. This corpus is hand-written and deterministic. There is no
seed, model call, sampling estimate, or request cost.

- The 188-row corpus found four missed Cash App handles before the fix.
  That gate passed after the fix.
- The expanded 222-row corpus covers grouped phone numbers, letter-spaced
  email addresses, and explicit handle cues. It passes with ordinary app
  references and number lists left clear.
- Before the redaction change, 52 of 95 contact rows still contained contact
  information after masking. After the change, zero did. A profile's stated
  age and interest remain in the masked input beside a contact replacement.
- `bun run sim --only evals,relay` passed 91 of 91 blocking gates.
  The relay simulation uses automatic review and sends no live messages.
