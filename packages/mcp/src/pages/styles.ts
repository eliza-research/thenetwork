import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Where `build-css.ts` writes the design-system CSS of the connector pages. Build output, never committed. */
export const connectorCssFile = new URL("./generated/connector.css", import.meta.url);

/** The build script. It renders the pages to collect their classes, so it is the one process that loads them before the CSS exists. */
const builder = fileURLToPath(new URL("./build-css.ts", import.meta.url));

/**
 * Reads the built CSS. A missing or empty file stops the process: a connector page without its stylesheet must never be served.
 * @throws {Error} when the file is missing or empty and this process is not the build script.
 */
function read(): string {
  if (process.argv[1] === builder) return "";
  let css = "";
  try {
    css = readFileSync(connectorCssFile, "utf8");
  } catch {}
  if (!css.trim()) throw new Error(`${fileURLToPath(connectorCssFile)} is missing or empty. Run \`pnpm run connector:css\` before the server starts.`);
  return css;
}

/** The CSS that each connector page inlines, read once at start. */
export const connectorCss = read();

/** The CSP `style-src` value: the hash of exactly the inlined CSS, so no other style can load. */
export const styleSource = connectorCss ? `'sha256-${createHash("sha256").update(connectorCss, "utf8").digest("base64")}'` : "'none'";
