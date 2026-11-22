import { createInterface } from "node:readline";

type Command<Event> =
  | { method: "reset" }
  | { method: "observe" | "observeOutput"; key: string }
  | { method: "dispatch"; key: string; event: Event };

export async function serveJourney<Event>(journey: {
  reset(): unknown;
  dispatch(key: string, event: Event): "accepted" | "refused" | Promise<"accepted" | "refused">;
  observe(key: string): unknown;
  observeOutput(key: string): unknown;
}) {
  function handle(command: Command<Event>) {
    switch (command.method) {
      case "reset": return journey.reset();
      case "dispatch": return journey.dispatch(command.key, command.event);
      case "observe": return journey.observe(command.key);
      case "observeOutput": return journey.observeOutput(command.key);
    }
  }

  for await (const line of createInterface({ input: process.stdin })) {
    try {
      const value = await handle(JSON.parse(line));
      process.stdout.write(JSON.stringify({ value }) + "\n");
    } catch (error) {
      process.stdout.write(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) + "\n");
    }
  }
}
