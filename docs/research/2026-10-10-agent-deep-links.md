# Agent deep links for the landing pages (2026-10-10)

Status: web research by a Claude sub-agent on 2026-10-10. V = in official docs or in the vendor's live
`apple-app-site-association` / `assetlinks.json`. U = unverified. Nothing here was tested on a device.
**Test every link on an iPhone, an Android phone and a desktop before launch.**

The prompt: `Read https://<domain>/SKILL.md and follow it.`

| Agent | Link on the page | Phone | Desktop | Notes |
|---|---|---|---|---|
| ChatGPT (and Codex) | `https://chatgpt.com/?q=` | V: the app claims the link (iOS and Android). U: the prompt survives | Web. V: `codex://new?prompt=` opens the desktop app (never sends) | The Codex desktop app merged into the ChatGPT desktop app on 2026-07-09. Custom MCP is added on the web |
| Claude (and Claude Code) | `https://claude.ai/new?q=` | V: the app claims `/new` | Web. V: `claude://claude.ai/new?q=`, `claude://code/new?q=`, `claude-cli://open?q=` | Claude Code is a tab in the Claude apps; the CLI is separate. Connectors are added on claude.ai, then sync to the phone |
| Grok | `https://grok.com/?q=` | V: the app claims the link | Web | Grok Bot (xAI's always-on agent, beta since 2026-08-11) has no prompt link: share sheet only |
| Muse | `https://muse.ai/` | Stays in the browser | Web | Meta's personal agent at muse.ai. No prompt link found, so the page says "paste" |
| Gemini | `https://gemini.google.com/app?q=` | Stays in the browser | Web | U: sources say the parameter does not fill. The page says "paste" |
| Perplexity | `https://www.perplexity.ai/search?q=` | V: the app claims `/search` | Web | Runs as a search |
| Cursor | `https://cursor.com/link/prompt?text=` | No prompt link: hidden on a phone | V: redirects to `cursor://anysphere.cursor-deeplink/prompt?text=`; never runs by itself | URL limit about 8,000 to 10,000 characters |
| OpenClaw | `openclaw://agent?message=` (as on slop.cash) | The person's own channel | V: macOS `openclaw://agent?message=` with a confirm prompt | Skills install from ClawHub. U: a bare SKILL.md URL |
| Hermes Agent | `hermes://skill/install?identifier=<SKILL.md URL>` (as on slop.cash) | The person's own channel | CLI | V: `hermes skills install https://…/SKILL.md` takes a URL |

The page uses the https link for every agent that has one, on phone and desktop. OpenClaw and Hermes have no https link, so they use their own schemes; nothing opens where the agent
is not installed, and the page says so. `codex://` and `claude://` are not used: the https links cover both. Every click also copies the prompt, so a link that does not fill it still works by paste.

Not on the page: Microsoft Copilot and Manus (no confirmed prompt link, no custom MCP for consumers),
Poke (iMessage agent; the person texts it), Grok Bot (same logo as Grok, no link).

## Instinct

Instinct (Spear Street Technology, launched February 2026) is a personal agent the person texts on
iMessage or WhatsApp. It has its own phone number and cloud computer. It is invite-only. No MCP, skills
system, developer API or prompt link was found, so there is nothing to integrate with today. A member
can text Instinct the prompt themselves; it can probably read SKILL.md (U). No first-party source
confirmed any of this.

## Text message links

`sms:+E164?&body=<encoded text>` is the form that both Apple Messages (iOS and macOS) and Android
accept (Sendblue and Blooio guides; Apple does not document the body). Encode spaces as `%20`. Windows
and Linux have no handler, so the page hides the text tile there.

## Sources

learn.chatgpt.com/codex/app/commands · support.claude.com/en/articles/14729294 and 14898120 ·
code.claude.com/docs/en/deep-links · cursor.com/docs/reference/deeplinks · x.ai/news/introducing-grok-bot ·
docs.x.ai/grok-bot/mobile · docs.openclaw.ai/clawdhub · hermes-agent.nousresearch.com/docs ·
docs.sendblue.com/guides/imessage-link-button · help.blooio.com (SMS hyperlinks) ·
`/.well-known/apple-app-site-association` on chatgpt.com, claude.ai, grok.com, gemini.google.com,
www.perplexity.ai, meta.ai, copilot.microsoft.com, cursor.com
