/** JSON for private API results. Preserve the explicit media type and disable caching. */
export function privateJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status,
    headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
