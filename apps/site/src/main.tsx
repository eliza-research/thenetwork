// spec/landingEntry.md, "The Copy button shows only when the page script runs"
import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { turnstileSiteKey } from "@thenetwork/ui";
import { App } from "./App.tsx";
import { pageNeedsScript, readRoot } from "./site.ts";
import "./main.css";

const root = document.getElementById("root");
const found = root ? readRoot(root, turnstileSiteKey()) : undefined;

if (root && found && pageNeedsScript(found.page)) {
  hydrateRoot(
    root,
    <StrictMode>
      <App brand={found.brand} view={{ page: found.page }} site={found.data} />
    </StrictMode>,
  );
}
