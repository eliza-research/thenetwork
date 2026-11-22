# Plain, factual replies from onboarding skills

Historical record. The [original revision](https://github.com/eliza-research/thenetwork/blob/1e2caa5028ade43ec7cb6a90de16466584f7ead0/docs/results/2026-10-15-agent-reply-guidance.md) retains the commands and toolchain used for the observations. Updated command spellings here describe the current project where the same entrypoints exist.

## Problem and scope

In a real, already connected Friends conversation, a simple status/next-step question received a
long answer that offered editing interests in account settings and promised future texts. Current
settings edits home and account controls, not interests; that isolated acceptance service had
delivery disabled. Earlier technical tool tables were explicitly requested and are not the failure
being claimed here. The private account screenshots and conversation contents are not published.

The user requested short, ordinary-language replies and truthful next steps. This change adds one
shared instruction block to the canonical Network, Slop and Friends skills. Both site generation
and plugin snapshot generation expand it. Tool instructions, connection addresses, authorization,
app boundaries and consent/safety restrictions are otherwise unchanged. Peon's skill is unchanged.

## Before and after the instruction change

At base `4ecfd9aa76efbde011da01826669661bbcd02e1a`, generated Friends instructions have no shared
reply-style block. The candidate adds these directions:

- Default to one short paragraph of one to three sentences, usually at most 60 words: useful status
  and one next action, without headings, filler or unnecessary tool narration.
- Keep tool output and technical details internal; show only a needed setup address in plain terms.
- Ask only for missing facts. Handle requested interest changes here, with approval before submission.
- Do not mistake active membership or a suggested next step for enabled matching or confirmed delivery.
- Preserve necessary consent, legal, safety, privacy and age restrictions.

These are instructions to the assistant, not a deterministic response formatter. Generated text
and successful build checks do not prove that a model follows them. The first comparisons used
candidate attachments rendered against the isolated staging authorities. Those comparisons used
pasted context, not a newly retrieved skill.

The owner evaluated the first candidate in the real conversation. It corrected the settings advice
and future-text promise, but remained too long and described connection/submission mechanics. The
revised candidate tightens the length instruction and adds one plain example, explicitly conditional
on confirmed signup, saved profile and unconfirmed introductions. That example is not a default
success claim.

In the owner's second real ChatGPT comparison, the revised guidance produced one paragraph of
57 words. The answer kept interest changes in the conversation and made no future-text or enabled-
matching claim. It still used four sentences rather than the preferred one to three. This is a
bounded improvement, not strict acceptance of every style criterion or proof across all three apps.
The generated candidate was pasted as context in the existing isolated conversation; the assistant
did not retrieve a newly deployed skill. No personal screenshots or raw profile text are included.

## Follow-up after published-skill checks

The owner later published the reviewed staging assembly and checked ordinary explanation-only prompts.
The Network response cited skill version 1.1.3 but used 117 words across five paragraphs and asked
a personal onboarding question despite the request not to sign up or change anything. Slop cited
version 1.1.2 but used 168 words across six text blocks, announced the guide version, and described
private onboarding with operator and connection jargon. These are observed failures, not style passes.

This follow-up tells the assistant to answer explanation-only requests without starting signup or
asking profile questions. It removes guide/version announcements and asks for ordinary supported
choices instead of internal approval mechanics. A short signup explanation should cover the app's
invitation rule, one supported first step, relevant age limits and agreement before introductions.
Actual app eligibility, age and consent facts stay unchanged.

The follow-up receives new skill and plugin patch versions. The owner has candidate-context probes
prepared; no after-response pass is claimed here. A pasted-candidate result is not served-skill proof.
Host readers can cache content independently. A cited version helps identify a read, but does not
attest every instruction byte. Preserve the observed failures and verify the actual served artifact
and later real response separately; do not explain a failure away merely as caching.

## Validation

From a clean checkout with the repository's existing dependencies:

```sh
node --import tsx --env-file-if-exists=.env plugins/build.ts
node --import tsx --env-file-if-exists=.env plugins/build.ts --check
pnpm exec vitest run sites
pnpm run typecheck
git diff --check
```

Local results: 81 site cases / 1,419 assertions pass; root and sites TypeScript checks pass; generated
plugin snapshots match; whitespace check passes. Local the former runtime was 1.3.14 and cached TypeScript 5.9.3;
the normal CI uses the repository-pinned former runtime 1.4.2. No installation was performed.

The staging entry test now derives its expected prompt version from the built skill, so the landing
prompt and that skill must agree after a legitimate version bump. This checks generated artifacts,
not response quality. Canonical skills receive patch versions; the two plugin manifests receive patch
versions because their imported skill snapshots changed.

No browser, GPT/model, provider, OTP, deployment or runtime action was performed by the implementation
or independent source review. The owner's real comparisons and later published-skill failures are
reported separately above. The follow-up's candidate and served-skill response acceptance remain
separate gates; this patch does not enable matching or messages.
