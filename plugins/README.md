# plugins: The Network for ChatGPT, Codex and Claude

Two plugin packages. Both point at the MCP server in [packages/mcp](../packages/mcp/README.md). Both carry snapshots of the skills in [sites/skills](../sites/skills).

| Folder | For | Skills | MCP server |
|---|---|---|---|
| `openai/` | ChatGPT and Codex (public plugin) | ntwrk-party, peon-biz, friends-help | one per skill: `https://ntwrk.party/mcp/<app>/openai` (`/mcp/openai` for The Network); `mcp.json` lists only `https://ntwrk.party/mcp/openai` (OpenAI allows one server per plugin) |
| `claude/` | Claude Code (marketplace in `.claude-plugin/marketplace.json`) | all four, with slop-date | one per app: `https://ntwrk.party/mcp/<app>` (`/mcp` for The Network) |

slop.date is not in the OpenAI plugin. OpenAI requires plugins that suit people aged 13-17. slop.date keeps its own SKILL.md on its site and in the Claude plugin. ChatGPT can still sign a person up for slop.date: the slop.date page sends ChatGPT to that skill, and the skill names `https://ntwrk.party/mcp/slop/openai`.

**Caution: do not edit a SKILL.md in this folder.** Change `sites/skills/<name>/SKILL.md`. Then run `node --import tsx --env-file-if-exists=.env plugins/build.ts`. The build fails when "slop" or "dating" is in `openai/`. The site test `sites/test/sites.test.ts` fails when a snapshot differs from a fresh build, or when a skill or its MCP dependency names another app's endpoint.

Every app's MCP endpoint is on ntwrk.party, and its path names the app. The MCP server binds each connection to the app of that path. So each skill and its `agents/openai.yaml` dependency use that app's own path. A person who uses the peon.biz or friends.help skill in ChatGPT adds that app's endpoint as a connector.

Checks:

```bash
node --import tsx --env-file-if-exists=.env plugins/build.ts --check
claude plugin validate --strict plugins/claude
claude plugin validate --strict plugins
```

The icons in `openai/assets/` are placeholders.
