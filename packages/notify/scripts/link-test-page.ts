// Device test day (entry-flows doc, decision 5). Writes one HTML page with every link we plan to
// send, so a person can open it on an iPhone, an Android phone and a desktop and tap each one.
// Usage: bun run scripts/link-test-page.ts [out.html] [+1NETWORKLINE]
// Record the results in docs/runbook-deeplink-test.md.

import { writeFileSync } from "node:fs";
import { assistantLink, updatePrompt } from "../src/links.ts";

const out = process.argv[2] ?? "deeplink-test.html";
const line = process.argv[3] ?? "+15555550100";
const token = "T-7F3K9Q";
const prompt = updatePrompt(token);
const importPrompt = "Write a short profile of me for The Network. Use only what you know from our past chats.";
const enc = encodeURIComponent;

const rows: [string, string, string][] = [
  ["A1", "ChatGPT update, fill-only", assistantLink("chatgpt", prompt)],
  ["A2", "ChatGPT update, ?q= (auto-sends on web)", `https://chatgpt.com/?q=${enc(prompt)}`],
  ["A3", "ChatGPT import prompt, fill-only", `https://chatgpt.com/?prompt=${enc(importPrompt)}`],
  ["B1", "Claude update", assistantLink("claude", prompt)],
  ["B2", "Claude import prompt", `https://claude.ai/new?q=${enc(importPrompt)}`],
  ["B3", "Claude add custom connector", `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=${enc("The Network")}&connectorUrl=${enc("https://mcp.ntwrk.love/mcp")}`],
  ["C1", "Grok update", assistantLink("grok", prompt)],
  ["C2", "Grok import prompt", `https://grok.com/?q=${enc(importPrompt)}`],
  ["C3", "Grok on X (unverified)", `https://x.com/i/grok?text=${enc(prompt)}`],
  ["D1", "sms: link with body (paste-prompt join)", `sms:${line}&body=${enc("slop.date — here's my profile: ...")}`],
  ["D2", "sms: link, iOS ?body form", `sms:${line}?body=${enc("join friends.help")}`],
];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Deeplink test</title>
<style>body{font:16px system-ui;margin:16px;max-width:640px}a{display:block;padding:14px;margin:8px 0;border:1px solid #888;border-radius:10px;text-decoration:none}code{font-size:12px;word-break:break-all;color:#666}</style>
<h1>Deeplink test</h1><p>Tap each link. For each, note: app or browser? prompt filled? sent without tapping Send?</p>
${rows.map(([id, label, href]) => `<a href="${esc(href)}"><b>${id}</b> ${esc(label)}<br><code>${esc(href)}</code></a>`).join("\n")}
`;
writeFileSync(out, html);
console.log(`wrote ${out} (${rows.length} links)`);
