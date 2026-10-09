# Clef pair labelling tool (P2)

A single static page, `index.html`, that shows two photos side by side and records which one the rater
finds more attractive (overall, face or body) as JSONL. It reads photos from a folder you choose on your
own computer and never makes a network request: its Content-Security-Policy is `default-src 'none'` with
`connect-src 'none'`, so the browser itself blocks any upload. `bun run sim` checks this policy and that
the page contains no network call. Labels are kept in the browser's local storage while you work, and
**Save labels file** writes them to a local file.

The fitter is `bun run clef fit`. The method, the label budget and the full operator runbook are in
`docs/results/2026-10-09-clef-fitting.md`.

## Consent and handling rules

These rules are not optional. The operator (the founder or a named delegate) owns them.

1. **Adults only.** Every photo is of a verified adult (18+): ID or selfie-verified age on file. Raters
   are adults too. A rater who thinks anyone in a photo might be under 18 presses **F** and flags the
   photo. The fitter and the feature extractor drop flagged photos, and the operator removes them from
   the folder and checks the manifest.
2. **Consented photos only.** A photo is used only if its subject signed a release that covers rating
   research. The release names the purpose: an internal matching signal that is never shown to anyone,
   and fitting the rating model. Each photo has a row in the consent manifest
   (`{"photo", "subject", "age", "ageVerified": true, "consent": "<release id>"}`). Photos without a row
   are never rated, never featurised and never labelled. Never use scraped or social-media photos, or
   member photos without that release.
3. **Labels and photos stay local.** No cloud drive, email, chat or shared link. Photos reach a rater on
   an encrypted drive or a local transfer and come back the same way; so do the labels files. The only
   photo bytes that ever leave the operator's machine are those sent to Cloudflare Workers AI by
   `bun run clef features --live`, which covers manifest-listed adults only.
4. **Raters** are the founding team and paid raters who signed the rater agreement (confidentiality,
   adults only, no copies). A rater id is a pseudonym, never a name or an email.
5. **Never shared.** No rating, rank or photo is discussed outside a labelling session. Fit reports and
   audits print aggregates only: no photo id and no per-person score.
6. **Retention.** Raters delete their photo copy and labels file once the operator confirms receipt. The
   operator keeps labels, features and the manifest only while P2 runs. Then they go into an encrypted
   archive with the releases, or are deleted if a subject withdraws consent. On withdrawal, delete that
   subject's photos, labels and feature rows, then refit.

## Use

1. Open `tools/clef-label/index.html` in a current Chrome, Edge, Firefox or Safari. Open it as a local
   file; no server is needed.
2. Read the rules, tick the attestation and enter your rater id (a pseudonym from the operator).
3. Choose the photo folder, the question (overall, face, body or rotate) and the session seed the
   operator gave you.
4. Label with the keyboard:

   | Key | Action |
   |---|---|
   | **1** or **←** | Left photo |
   | **2** or **→** | Right photo |
   | **S** | Can't tell (skipped) |
   | **F** | Flag a photo |
   | **U** | Undo |

5. **Save labels file** often. **End session** saves and clears the browser's copy.

**Schedule.** One pair in five comes from a stream shared by every rater with the same seed. That
overlap is what the fitter uses for inter-rater reliability. About 5% of pairs repeat an earlier pair
with the sides swapped, as a test-retest check. Left and right are random. The operator can also hand
out a fixed pair plan (JSONL of `{"a","b","dim"}`).

## Output format (one JSON object per line)

```json
{"a":"s012/1.jpg","b":"s044/2.jpg","winner":"a","dim":"overall","rater":"rater-07","t":"2026-10-12T15:04:05.000Z","ms":1830,"shared":true,"repeat":false,"seed":3}
{"a":"s019/1.jpg","b":"s002/3.jpg","dim":"face","rater":"rater-07","t":"...","ms":5210,"shared":false,"repeat":false,"seed":3,"skip":true}
{"flag":"s031/2.jpg","reason":"may be under 18","rater":"rater-07","t":"..."}
```

- `a` is the left photo and `b` the right one.
- Photo ids are paths inside the chosen folder, the same ids the feature extractor writes.
- Skipped lines and flag lines are not labels. The fitter drops every label that involves a flagged
  photo.
