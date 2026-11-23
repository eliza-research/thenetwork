# plugins: The Network for ChatGPT and Claude

Two plugin packages. Both point at the MCP server in [packages/mcp](../packages/mcp/README.md). Both carry snapshots of the skills in [sites/skills](../sites/skills).

| Folder | For | Skills | MCP server |
|---|---|---|---|
| `openai/` | ChatGPT (public plugin) | ntwrk-party, peon-biz, friends-help | one per skill: `https://ntwrk.party/mcp/<app>/openai` (`/mcp/openai` for The Network); `mcp.json` lists only `https://ntwrk.party/mcp/openai` (OpenAI allows one server per plugin) |
| `claude/` | Claude Code (manifest in `claude/.claude-plugin/plugin.json`, marketplace in `plugins/.claude-plugin/marketplace.json`) | all four, with slop-date | one per app: `https://ntwrk.party/mcp/<app>` (`/mcp` for The Network), in `.mcp.json` |

The OpenAI plugin includes skills suitable for people aged 13 to 17. Its public MCP surface serves The Network, peon.biz and friends.help. slop.date keeps its full connector skill on its site and in the Claude plugin.

**Caution: do not edit a SKILL.md in this folder.** Change `sites/skills/<name>/SKILL.md`. Then run `node --import tsx --env-file-if-exists=.env plugins/build.ts`. The build also writes `openai/mcp.json`, each `agents/openai.yaml` and `claude/.mcp.json` from the endpoint functions of spec/agentEntry.md. The OpenAI copies remove slop.date and every dating word (for example "matched on dates or for work" becomes "matched for work"). The build fails when slop.date or a dating word (`OPENAI_EXCLUDED` in `build.ts`: "slop", "dating", "date", "dates", "romantic", "romance", "orientation") is left in `openai/`, and when a skill copy does not name the endpoints of its app (a Claude skill names its full endpoint and any public OpenAI endpoint; an OpenAI skill names its OpenAI endpoint). The site test `sites/test/sites.test.ts` fails when a snapshot differs from a fresh build, or when a skill or its MCP dependency names another app's endpoint.

Every app's MCP endpoint is on ntwrk.party, and its path names the app. The MCP server binds each connection to the app of that path. So each skill and its `agents/openai.yaml` dependency use that app's own path. A person who uses the peon.biz or friends.help skill in ChatGPT adds that app's endpoint as a connector.

Checks:

```bash
node --import tsx --env-file-if-exists=.env plugins/build.ts --check
claude plugin validate --strict plugins/claude
claude plugin validate --strict plugins
```

ChatGPT and Claude import the skills when the plugin is submitted or installed, and do not fetch them again. When a snapshot changes, increase `version` in `openai/plugin.json` (OpenAI plugin) or `claude/.claude-plugin/plugin.json` (Claude plugin), or in both. The `capabilities` of the OpenAI manifest include `Write`, because the connector has tools that write (`prepare_signup`, `submit_profile` and `get_updates`). The site test fails when `capabilities` and the connector tools do not agree.

This repository has no Codex plugin and no Codex test. Do not say that the OpenAI plugin supports Codex until a test shows it.

The icons in `openai/assets/` are placeholders.
