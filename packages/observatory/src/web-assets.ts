import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const web = new URL("../web/", import.meta.url);

/** Compile the fixed web entry points before opening the Observatory listener. */
export async function buildWebRoutes(development: boolean): Promise<Record<string, () => Response>> {
  const [html, { outputFiles }] = await Promise.all([
    readFile(new URL("index.html", web), "utf8"),
    build({
      absWorkingDir: fileURLToPath(web),
      entryPoints: ["main.tsx", "styles.css"],
      outdir: "dist",
      write: false,
      bundle: true,
      platform: "browser",
      format: "esm",
      target: "es2022",
      minify: !development,
      loader: { ".png": "dataurl" },
    }),
  ]);

  const page = (body: string | Uint8Array<ArrayBuffer>, contentType: string) => () => new Response(body, {
    headers: {
      "content-type": `${contentType}; charset=utf-8`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
  const routes: Record<string, () => Response> = { "/": page(html, "text/html") };
  for (const file of outputFiles) {
    const name = basename(file.path);
    routes[`/assets/${name}`] = page(new Uint8Array(file.contents), name.endsWith(".css") ? "text/css" : "text/javascript");
  }
  return routes;
}
