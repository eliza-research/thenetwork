// spec/sitePages.md, "Each site has a landing page, a privacy page, terms and a not-found page, and only peon.biz has a join page"
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build, type InlineConfig, type Rolldown } from "vite";
import type { AppKey } from "../../packages/core/src/generated/brandIdentity.ts";
import type { SitePage } from "../../packages/core/src/generated/sitePages.ts";
import type { PageInput, RenderFavicon, RenderPage, RenderedPage } from "./src/entry-server.tsx";

const appDir = import.meta.dirname;

/** The site app built once for every site: the client files, the page template and the prerender. */
export interface SiteApp {
  /** The client build: hashed scripts and styles and the public files, all at its root. Its index.html is the template. */
  clientDir: string;
  /** Writes one page of one site as complete HTML. */
  page: (app: AppKey, page: SitePage, input: PageInput) => string;
  /** Draws the favicon of one site from its brand mark. */
  favicon: RenderFavicon;
}

let pending: Promise<SiteApp> | undefined;
const runs: string[] = [];

function entryOf(result: Awaited<ReturnType<typeof build>>): string {
  const outputs = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[];
  const entry = outputs.flatMap((out) => out.output).find((chunk) => chunk.type === "chunk" && chunk.isEntry);
  if (!entry) throw new Error("the prerender build has no entry chunk");
  return entry.fileName;
}

/** Puts one prerendered page into the template. A page without the page script loses the script tag. */
export function assemble(template: string, rendered: RenderedPage): string {
  const filled = template
    .replace('<html lang="en">', `<html lang="en" data-brand="${rendered.brandId}">`)
    .replace("<!--app-head-->", rendered.head)
    .replace('<div id="root"><!--app-html--></div>', `<div id="root"${rendered.rootAttributes}>${rendered.html}</div>`);
  return rendered.script ? filled : filled.replace(/\s*<script type="module"[^>]*><\/script>/g, "").replace(/\s*<link rel="modulepreload"[^>]*>/g, "");
}

/**
 * Runs the builds as production builds. Vite and the React plugin choose the JSX runtime from `process.env.NODE_ENV`, and a test
 * runner sets it to "test": the client would then ship the development runtime, and the prerender would call a runtime that its
 * production React does not have.
 */
async function asProduction<T>(work: () => Promise<T>): Promise<T> {
  const before = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    return await work();
  } finally {
    if (before === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = before;
  }
}

async function buildApp(): Promise<SiteApp> {
  mkdirSync(join(appDir, ".build"), { recursive: true });
  const run = mkdtempSync(join(appDir, ".build", "run-"));
  runs.push(run);
  const clientDir = join(run, "client");
  const serverDir = join(run, "server");
  const shared: InlineConfig = { root: appDir, configFile: join(appDir, "vite.config.ts"), mode: "production", logLevel: "warn" };
  const server = await asProduction(async () => {
    await build({ ...shared, build: { outDir: clientDir, emptyOutDir: true } });
    return build({
      ...shared,
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
      ssr: { noExternal: true },
      build: { ssr: "src/entry-server.tsx", outDir: serverDir, emptyOutDir: true },
    });
  });
  const { render, favicon } = (await import(pathToFileURL(join(serverDir, entryOf(server))).href)) as { render: RenderPage; favicon: RenderFavicon };
  rmSync(serverDir, { recursive: true, force: true });
  const template = readFileSync(join(clientDir, "index.html"), "utf8");
  if (!template.includes("<!--app-head-->") || !template.includes("<!--app-html-->")) throw new Error("the built index.html lost its prerender slots");
  return { clientDir, page: (app, page, input) => assemble(template, render(app, page, input)), favicon };
}

/** The site app for this process: built on the first call, then shared by every site. */
export function siteApp(): Promise<SiteApp> {
  pending ??= buildApp().catch((error: unknown) => {
    pending = undefined;
    throw error;
  });
  return pending;
}

/** Forgets the built app, so that the next `siteApp` builds again (the dev server calls it after a source change). */
export function resetSiteApp(): void {
  pending = undefined;
}

/** Removes every run folder of this process. */
function removeRuns(): void {
  for (const run of runs.splice(0)) rmSync(run, { recursive: true, force: true });
}

process.once("exit", removeRuns);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.once(signal, () => {
    removeRuns();
    if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
  });
}
