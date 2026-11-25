# Peon connector entry on November 23, 2026

The earlier Peon skill directed new members to a “Finish signup” action in
connector authorization. The verified connector rendered **Allow** for the
same request and refused a signup-open POST with HTTP 400. Peon enrollment
already has a separate documented browser entry at `peon.biz/join`.
[Product story F42](../../spec/product/stories.md#story-f42--join-peonbiz-in-the-browser)

## Before and after

| Check | Before `1b899850` | After `3fd2e2b7` |
| --- | --- | --- |
| Served Peon skill | Promises Finish signup in connector authorization | Sends new members to `https://peon.biz/join?via=agent` |
| Verified connector | Shows Allow, refuses opening enrollment | Shows Allow, refuses opening enrollment |
| Actual Codex reply | Gives the correct Peon site URL and tells the person to choose Finish signup | Gives the same URL and tells the person to complete signup there |

The paired native tool runs used Codex CLI 0.149.1, OpenAI
`gpt-5.6-sol`, and low reasoning effort. Each one used a fresh local
PostgreSQL fixture, a simulated phone code in the browser authorization
fixture, and an explicit app-scoped OAuth grant. The CLI used the grant with
native Streamable HTTP on the local hub. In both runs it called
`check_status` for `peon` once and got `not_joined` with the Peon join
URL. The served skill and public Peon facts entered the prompt. Phone
numbers and codes stayed in the local fixture. Each CLI run exited 0.
This qualifies the instruction and native tool response using a
preauthorized loopback grant.

Chromium 158.0.8127.18 displayed the exact served skill and verified
connector page in both revisions. On the revised flow it followed the
corrected link, confirmed the fictional phone in the local Peon site, entered
the signup details, accepted the text terms and showed the return-to-chat
step. An independent read of PostgreSQL confirmed Peon membership. The
recordings use one synthetic account per side. The evidence hides the
confirmation input values and the public text-line number. No real text
was sent.

- [Before screenshot](assets/2026-11-23-peon-connector/before-skill.png)
- [After screenshot](assets/2026-11-23-peon-connector/after-skill.png)
- [Before recording](assets/2026-11-23-peon-connector/before.webm)
- [After recording](assets/2026-11-23-peon-connector/after.webm)
- [Peon enrollment confirmation](assets/2026-11-23-peon-connector/after-joined.png)

## Reproduce

1. Start the local platform against a disposable PostgreSQL database as
   described in [client testing](../../CONTRIBUTING.md#8-test-in-real-agent-clients).
2. Read the served Peon `/SKILL.md`. Start an app-bound authorization
   with membership read and profile write on the local hub Peon OpenAI
   resource. Confirm a fictional phone with the local test OTP. The
   connector consent offers Allow and no signup form.
3. Let the client call `check_status` for the still-unjoined fixture. If
   the site already created a new canonical person, use a fresh grant for
   that person. The next step is Peon's separate join page.
4. Open Peon `/join?via=agent`, confirm the fictional phone, fill the join
   form, and accept the current text terms. Join should show the return to
   chat and create the Peon membership.

```sh
REQUIRE_PG=1 pnpm exec vitest run --project integration sites/test/sites.test.ts packages/mcp/test/hub-endpoint.integration.test.ts packages/mcp/test/signup-draft-prefill.test.ts packages/mcp/test/mcp.test.ts packages/mcp/test/oauth.test.ts
node --import tsx --env-file-if-exists=.env plugins/build.ts --check
pnpm run typecheck
pnpm run spec:check-generated
```

The focused suite passed all 169 tests. The plugin snapshots were rebuilt
from the hand-written Peon skill. Full typecheck and all 253 generated
artifact checks passed. The proof covers local browser enrollment and
native tool access. Hosted Cloud signup and web clients still need their
own qualification.
