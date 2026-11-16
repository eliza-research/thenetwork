import type { Window } from "happy-dom";

/** Every property name of the window and of its prototypes, without `Object.prototype`. */
function windowNames(window: Window): string[] {
  const names = new Set<string>();
  for (let level: object | null = window; level && level !== Object.prototype; level = Object.getPrototypeOf(level)) for (const name of Object.getOwnPropertyNames(level)) names.add(name);
  return [...names];
}

/**
 * Makes a happy-dom window the browser of the test: the named globals, and each window class and function that Bun does not have (such as `HTMLFormElement` and `getComputedStyle`, which Radix controls read).
 * Returns the function that puts the earlier globals back.
 */
export function installDom(window: Window, named: Record<string, unknown>): () => void {
  const source = window as unknown as Record<string, unknown>;
  const missing = windowNames(window).filter((name) => name !== "constructor" && !(name in globalThis) && typeof source[name] === "function");
  const values: Record<string, unknown> = {
    ...Object.fromEntries(missing.map((name) => {
      const value = source[name] as (...args: unknown[]) => unknown;
      return [name, /^[A-Z]/.test(name) ? value : value.bind(window)];
    })),
    ...named,
  };
  const saved = Object.keys(values).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  for (const [name, value] of Object.entries(values)) Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  return () => {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  };
}

/** The part of a DOM element, from happy-dom or the browser, that the role queries read. */
type Queried = {
  tagName: string;
  textContent: string | null;
  getAttribute(name: string): string | null;
  closest(selector: string): { textContent: string | null } | null;
  ownerDocument: { getElementById(id: string): { textContent: string | null } | null; querySelector(selector: string): { textContent: string | null } | null };
};
/** A document or element whose descendants the role queries search. */
type Root = { querySelectorAll(selector: string): ArrayLike<unknown> };

/** The accessible name of an element: `aria-label`, the text of its `aria-labelledby` elements, or the text of its label. */
export function accessibleName(element: Queried): string {
  const label = element.getAttribute("aria-label");
  if (label) return label.trim();
  const ids = element.getAttribute("aria-labelledby");
  if (ids) return ids.split(/\s+/).map((id) => element.ownerDocument.getElementById(id)?.textContent ?? "").join(" ").trim();
  const id = element.getAttribute("id");
  const byFor = id ? element.ownerDocument.querySelector(`label[for="${id}"]`) : null;
  const wrapping = element.closest("label");
  return (byFor ?? wrapping)?.textContent?.trim() ?? "";
}

const implicitRole: Record<string, (element: Queried) => string | null> = {
  BUTTON: () => "button",
  TEXTAREA: () => "textbox",
  IMG: () => "img",
  INPUT: (element) => {
    const type = (element.getAttribute("type") ?? "text").toLowerCase();
    if (type === "checkbox") return "checkbox";
    if (type === "search") return "searchbox";
    return ["text", "email", "tel", "url", "password"].includes(type) ? "textbox" : null;
  },
};

/** The role of an element: its `role` attribute, else the implicit role of its tag. */
export function roleOf(element: Queried): string | null {
  return element.getAttribute("role") ?? implicitRole[element.tagName]?.(element) ?? null;
}

/** Every element under `root` with the role and, when given, the accessible name. */
export function allByRole<T>(root: Root, role: string, name?: string | RegExp): T[] {
  return (Array.from(root.querySelectorAll("*")) as Queried[]).filter((element) => {
    if (roleOf(element) !== role) return false;
    if (name === undefined) return true;
    const shown = accessibleName(element) || (element.textContent ?? "").trim();
    return typeof name === "string" ? shown === name : name.test(shown);
  }) as T[];
}

/** The one element under `root` with the role and the accessible name, or null. */
export function byRole<T>(root: Root, role: string, name?: string | RegExp): T | null {
  return allByRole<T>(root, role, name)[0] ?? null;
}
