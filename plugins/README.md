# plugins: The Network for ChatGPT, Codex and Claude

Two plugin packages. Both point at the MCP server in [packages/mcp](../packages/mcp/README.md). Both carry snapshots of the skills in [sites/skills](../sites/skills).

| Folder | For | Skills | MCP server |
|---|---|---|---|
| `openai/` | ChatGPT and Codex (public plugin) | ntwrk-love, peon-biz, friends-help | `https://ntwrk.love/mcp/openai` (one server; slop is hidden) |
| `claude/` | Claude Code (marketplace in `.claude-plugin/marketplace.json`) | all four, with slop-date | one per site: `https://<domain>/mcp` |

slop.date is not in the OpenAI plugin. OpenAI requires plugins that suit people aged 13-17. slop.date keeps its own SKILL.md on its site and in the Claude plugin.

**Caution: do not edit a SKILL.md in this folder.** Change `sites/skills/<name>/SKILL.md`. Then run `bun run plugins/build.ts`. The test `packages/mcp/test/plugins.test.ts` fails when a snapshot differs from a fresh build, or when "slop" or "dating" is in `openai/`.

Checks:

```bash
bun run plugins/build.ts --check
claude plugin validate --strict plugins/claude
claude plugin validate --strict plugins
```

The icons in `openai/assets/` are placeholders.
