import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/postcss";
import { build } from "esbuild";
import postcss from "postcss";

const web = new URL("../web/", import.meta.url);
const stylesheet = fileURLToPath(new URL("styles.css", web));
const hostGrotesk = new URL("../../../apps/site/public/fonts/host-grotesk.woff2", import.meta.url);

/** Compile the fixed web entry points before opening the Observatory listener. */
export async function buildWebRoutes(development: boolean): Promise<Record<string, () => Response>> {
  const [html, font, { outputFiles }, { css }] = await Promise.all([
    readFile(new URL("index.html", web), "utf8"),
    readFile(hostGrotesk),
    build({
      absWorkingDir: fileURLToPath(web),
      entryPoints: ["main.tsx"],
      outdir: "dist",
      write: false,
      bundle: true,
      platform: "browser",
      format: "esm",
      target: "es2022",
      minify: !development,
      loader: { ".png": "dataurl" },
    }),
    readFile(stylesheet, "utf8").then(source => postcss([tailwindcss({ base: fileURLToPath(web), optimize: !development })])
      .process(source, { from: stylesheet })),
  ]);

  const page = (body: string | Uint8Array<ArrayBuffer>, contentType: string) => () => new Response(body, {
    headers: {
      "content-type": `${contentType}; charset=utf-8`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
  const routes: Record<string, () => Response> = {
    "/": page(html, "text/html"),
    "/assets/styles.css": page(css, "text/css"),
    "/fonts/host-grotesk.woff2": () => new Response(new Uint8Array(font), {
      headers: { "content-type": "font/woff2", "cache-control": "no-store", "x-content-type-options": "nosniff" },
    }),
  };
  for (const file of outputFiles) {
    const name = basename(file.path);
    routes[`/assets/${name}`] = page(new Uint8Array(file.contents), name.endsWith(".css") ? "text/css" : "text/javascript");
  }
  return routes;
}
