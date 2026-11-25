import type { KeyboardEvent } from "react";

type RowKey = Pick<KeyboardEvent<HTMLDivElement>, "key" | "type" | "target" | "currentTarget" | "repeat" | "preventDefault" | "stopPropagation">;

export function handleFeedRowKey(event: RowKey, onOpen: () => void): void {
  if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
  event.preventDefault();
  if (event.key === " " && event.type === "keydown") event.stopPropagation();
  if (!event.repeat && (event.key === "Enter" ? event.type === "keydown" : event.type === "keyup")) onOpen();
}
