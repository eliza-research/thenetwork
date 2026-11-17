// spec/authorizationPages.md, "Every page shows the brand mark and the legal links"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile, optimize } from "@tailwindcss/node";
import { allSamples } from "./samples.ts";
import { connectorCssFile } from "./styles.ts";

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, "connector.css");
const tailwindIndex = join(dirname(fileURLToPath(import.meta.resolve("tailwindcss"))), "..", "index.css");

const entities: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#x27;": "'" };
const unescape = (s: string) => s.replace(/&(?:amp|lt|gt|quot|#x27);/g, e => entities[e]!);

const html = (await Promise.all(allSamples().map(({ app, sample }) => sample.render(app).text()))).join("\n");
const candidates = [...new Set([...html.matchAll(/\sclass="([^"]*)"/g)].flatMap(m => unescape(m[1]!).split(/\s+/)).filter(Boolean))];

const compiler = await compile(readFileSync(entry, "utf8"), {
  base: here,
  from: entry,
  onDependency: () => {},
  customCssResolver: async id => (id === "tailwindcss" ? tailwindIndex : undefined),
});
const css = optimize(compiler.build(candidates), { file: entry, minify: true }).code;
if (!candidates.length || !css.trim()) throw new Error("the connector pages have no classes or the CSS is empty; run `pnpm run design:build` first");

mkdirSync(dirname(fileURLToPath(connectorCssFile)), { recursive: true });
writeFileSync(connectorCssFile, css);
console.log(`${fileURLToPath(connectorCssFile)}: ${css.length} bytes, ${candidates.length} classes`);
