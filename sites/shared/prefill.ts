// Approved name and age travel only in the fragment. No account owns them until the person signs in.
import { MAX_FIRST_NAME } from "./join-core.ts";

export function prefillJoin(root: HTMLElement): void {
  const fields = new URLSearchParams(location.hash.slice(1));
  if (!fields.has("firstName") && !fields.has("age")) return;
  history.replaceState(null, "", location.pathname + location.search);
  const name = root.querySelector<HTMLInputElement>('input[name="firstName"]');
  const age = root.querySelector<HTMLInputElement>('input[name="age"]');
  if (name) name.value = (fields.get("firstName") ?? "").slice(0, MAX_FIRST_NAME);
  const value = fields.get("age") ?? "";
  if (age && /^\d{1,3}$/.test(value) && Number(value) <= 120) age.value = value;
}
