import { get, type IncomingMessage } from "node:http";

/** Send an actual HTTP upgrade so the test can inspect a refusal or unexpected 101. */
export function webSocketUpgradeStatus(url: string, token: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const finish = (response: IncomingMessage) => {
      if (response.statusCode === undefined) reject(new Error("WebSocket upgrade returned no HTTP status"));
      else resolve(response.statusCode);
    };
    get(url, {
      agent: false,
      signal: AbortSignal.timeout(15_000),
      headers: {
        authorization: `Bearer ${token}`,
        upgrade: "websocket",
        connection: "Upgrade",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-version": "13",
      },
    }, response => {
      response.resume();
      finish(response);
    }).once("upgrade", (response, socket) => {
      socket.destroy();
      finish(response);
    }).once("error", reject);
  });
}
