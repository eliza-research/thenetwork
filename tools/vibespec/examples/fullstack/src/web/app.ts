// spec/client.md, "Story: Edit the list in the browser"; spec/client.md, "Story: Hear back from the server"
// The React page. Its state is a client of spec/client.md and its reducer is
// the generated `step`: a click is an event, an answer from the server is an
// event, and an event the rules do not allow changes nothing. React comes
// from a CDN through the import map in index.html and is passed in, so this
// file needs neither a bundler nor React's type declarations.
import {
  type Client, type Event, canCreate, canRemove, canRename, canSetDone, initial, step, visible,
} from "../../gen/client.ts";
import type { Todo } from "../../gen/todo.ts";
import { drain } from "../inbox.ts";
import { fetchSnapshot, listen, newId, sendEdit } from "./sync.ts";

/** The part of React this page uses. */
export interface ReactLike {
  createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): unknown;
  useReducer<S, A>(reducer: (state: S, action: A) => S, init: S): [S, (action: A) => void];
  useEffect(effect: () => void | (() => void), deps: unknown[]): void;
  useRef<T>(value: T): { current: T };
  useState<T>(value: T): [T, (value: T) => void];
}
export type CreateRoot = (el: Element) => { render(node: unknown): void };

/** Several events at once, applied in order by the proved `drain`. */
type Action = Event | Event[];
const reducer = (c: Client, a: Action): Client => (Array.isArray(a) ? drain(c, a) : step(c, a));

export function mount(React: ReactLike, createRoot: CreateRoot, el: Element, base = ""): void {
  const name = Math.random().toString(36).slice(2, 8);
  createRoot(el).render(React.createElement(page(React, base, name)));
}

function page(React: ReactLike, base: string, name: string) {
  const h = React.createElement;
  return function TodoPage() {
    const [c, dispatch] = React.useReducer<Client, Action>(reducer, initial);
    const [draft, setDraft] = React.useState("");
    const [retry, setRetry] = React.useState(0);
    const inFlight = React.useRef<number | undefined>(undefined);

    // Pushes from the server, for as long as the page is open.
    React.useEffect(() => {
      const stop = new AbortController();
      void listen(base, (events) => dispatch(events), stop.signal);
      return () => stop.abort();
    }, []);

    // Send the oldest queued edit, one request at a time (spec/system.md:
    // "Only a tab's oldest queued edit can be on its way unanswered"). Its
    // answer takes it out of the queue, and the next one goes out. Sending
    // the whole queue at once would let the network reorder the user's own
    // edits. Offline, nothing is sent; a failed request is tried again later.
    React.useEffect(() => {
      const p = c.pending[0];
      if (!c.online || !p || inFlight.current !== undefined) return;
      inFlight.current = p.seq;
      void sendEdit(base, name, p).then((answer) => {
        inFlight.current = undefined;
        if (answer) return dispatch(answer);
        setTimeout(() => setRetry(Date.now()), 2000);
      });
    }, [c, retry]);

    const goOnline = async () => {
      dispatch({ type: "goOnline" });
      dispatch(await fetchSnapshot(base));
    };
    const id = newId(name, c);
    const row = (t: Todo) =>
      h("li", { key: t.id, className: t.done ? "done" : "" },
        h("input", {
          type: "checkbox", checked: t.done, disabled: !canSetDone(c, t.id, !t.done),
          "aria-label": `Mark ${t.title} ${t.done ? "incomplete" : "done"}`,
          onChange: () => dispatch({ type: "setDone", id: t.id, done: !t.done }),
        }),
        h("button", {
          type: "button", className: "title", "aria-label": `Rename ${t.title}`,
          onClick: () => {
            const title = window.prompt("Rename", t.title) ?? "";
            if (canRename(c, t.id, title)) dispatch({ type: "rename", id: t.id, title });
          },
        }, t.title),
        h("button", { "aria-label": `Remove ${t.title}`, disabled: !canRemove(c, t.id), onClick: () => dispatch({ type: "remove", id: t.id }) }, "remove"));

    return h("main", null,
      h("h1", null, "Shared to-do list"),
      h("form", {
        onSubmit: (e: { preventDefault(): void }) => {
          e.preventDefault();
          if (!canCreate(c, id, draft.trim())) return;
          dispatch({ type: "create", id, title: draft.trim() });
          setDraft("");
        },
      },
        h("input", { value: draft, "aria-label": "New to-do", placeholder: "What needs doing?", onChange: (e: { target: { value: string } }) => setDraft(e.target.value) }),
        h("button", { disabled: !canCreate(c, id, draft.trim()) }, "add")),
      h("ul", null, ...visible(c).map(row)),
      h("p", { className: "status" },
        `tab ${name} · version ${c.seen} · ${c.pending.length} waiting for the server`,
        c.refusals ? ` · ${c.refusals} refused` : "",
        " · ",
        h("label", null,
          h("input", { type: "checkbox", checked: c.online, onChange: () => (c.online ? dispatch({ type: "goOffline" }) : void goOnline()) }),
          " online")));
  };
}
