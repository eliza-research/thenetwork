// The route table of the public port, free of imports so that it can be proved. The two facts about the
// path come from backend.ts (the INTERNAL_PATHS set and the MCP_PATH regex) and are trusted here.
export type PublicRoute = "healthz" | "metrics" | "draining" | "api" | "service" | "mcp" | "not_found";

//@ verify
//@ ensures \result === "service" ==> internal || path === "/webhooks/blooio" || path.startsWith("/webhooks/blooio/")
//@ ensures draining && path !== "/healthz" && path !== "/ops/metrics" ==> \result === "draining"
//@ ensures !internal && !path.startsWith("/webhooks/") ==> \result !== "service"
//@ ensures \result === "mcp" ==> mcp
export function publicRoute(path: string, draining: boolean, internal: boolean, mcp: boolean): PublicRoute {
  if (path === "/healthz") return "healthz";
  if (path === "/ops/metrics") return "metrics";
  if (draining) return "draining";
  if (path === "/api" || path.startsWith("/api/")) return "api";
  if (path === "/webhooks/blooio" || path.startsWith("/webhooks/blooio/") || internal) return "service";
  if (mcp) return "mcp";
  // The staff API never answers on the public port.
  return "not_found";
}
