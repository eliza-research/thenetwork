// spec/consoleNavigation.md, "Search offers names and places from two characters and ids from three"
import { type ComponentProps, type KeyboardEvent, type ReactNode, useState } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import type { HitGroups } from "../../../../core/src/generated/consoleNavigation.ts";
import { cn } from "../../lib/cn.ts";
import { Input } from "../Input.tsx";
import { Link } from "../Link.tsx";
import { PopoverContent } from "../Popover.tsx";
import { VisuallyHidden } from "../VisuallyHidden.tsx";

/** A member, a neighborhood or an opportunity that matches the search text. */
export type SearchHit = { key: string; label: string; meta?: string };
/** A Network message or system event that matches the search text. */
export type ConversationHit = SearchHit & { snippet: string };
/** The state of one conversation search: no `hits` and no `error` while it runs. */
export type ConversationResults = { query: string; hits?: ConversationHit[]; error?: string };

export type SearchBoxProps = Omit<ComponentProps<"div">, "children"> & {
  /** The search text. */
  value: string;
  onValueChange: (value: string) => void;
  /** Which hits the box offers: the generated `hitGroups(nav.queryChars)`. With `NoHits` the list stays closed. */
  groups: HitGroups;
  /** The hits of the groups that `groups` names, best first. */
  hits: SearchHit[];
  /** Moves the focus to a hit; the owner then clears the search text. */
  onPick: (hit: SearchHit) => void;
  /** Offers the conversation search: the generated `conversationSearchShown(safetyRole, queryChars)`. */
  conversationSearch?: boolean;
  /** Starts a conversation search for the text. Every search is logged. */
  onSearchConversations?: () => void;
  /** The last conversation search, while it shows. */
  conversation?: ConversationResults | null;
  onPickConversation?: (hit: ConversationHit) => void;
  /** Goes back from the conversation results to the hits. */
  onCloseConversation?: () => void;
  /** The id of the text field, for the "/" key. */
  inputId?: string;
  /** The accessible name of the text field. */
  label?: string;
  placeholder?: string;
  /** What the field searches, shown on hover. */
  hint?: string;
};

const row = "flex w-full cursor-pointer flex-col items-start gap-1 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground aria-selected:bg-accent aria-selected:text-accent-foreground";

type Choice = { id: string; select: () => void; content: ReactNode; className?: string; title?: string };

/** The text that announces the state of the list to assistive technology. */
function resultText(open: boolean, conversation: ConversationResults | null | undefined, hits: number): string {
  if (!open) return "";
  if (conversation) {
    if (conversation.error) return conversation.error;
    if (!conversation.hits) return "Searching conversations";
    return `${conversation.hits.length} conversation ${conversation.hits.length === 1 ? "result" : "results"}`;
  }
  return `${hits} ${hits === 1 ? "result" : "results"}`;
}

/**
 * The search box of the app page and its list of hits, as a WAI-ARIA combobox: the arrow keys move through the hits, Enter opens the active hit or the first one, Shift+Enter searches the conversations, and Escape closes the list. The number of hits is announced.
 * @model spec/consoleNavigation.md
 */
export function SearchBox({
  value,
  onValueChange,
  groups,
  hits,
  onPick,
  conversationSearch = false,
  onSearchConversations,
  conversation,
  onPickConversation,
  onCloseConversation,
  inputId = "obs-search",
  label = "Search members, neighborhoods and opportunity ids",
  placeholder = "Search",
  hint,
  className,
  ...props
}: SearchBoxProps) {
  const [active, setActive] = useState(-1);
  const [dismissed, setDismissed] = useState(false);
  const query = value.trim();
  const shownHits = conversation ? [] : hits;
  const open = !dismissed && groups !== "NoHits" && (shownHits.length > 0 || conversationSearch || !!conversation);
  const listId = `${inputId}-hits`;
  const optionId = (index: number) => `${inputId}-option-${index}`;
  const choices: Choice[] = conversation
    ? (conversation.hits ?? []).map((hit) => ({
        id: hit.key,
        select: () => onPickConversation?.(hit),
        content: (
          <>
            <span>
              {hit.label} {hit.meta ? <span className="text-muted-foreground">· {hit.meta}</span> : null}
            </span>
            <span className="text-muted-foreground">{hit.snippet}</span>
          </>
        ),
      }))
    : [
        ...shownHits.map((hit) => ({
          id: hit.key,
          select: () => onPick(hit),
          content: (
            <span>
              {hit.label} {hit.meta ? <span className="text-muted-foreground">· {hit.meta}</span> : null}
            </span>
          ),
        })),
        ...(conversationSearch && onSearchConversations
          ? [
              {
                id: "conversations",
                select: onSearchConversations,
                className: "flex-row items-center text-primary",
                title: "The Network's messages and system events. Logged.",
                content: (
                  <>
                    <span>Search conversations for “{query}”</span>
                    <kbd className="ml-auto font-mono text-muted-foreground">⇧↵</kbd>
                  </>
                ),
              },
            ]
          : []),
      ];
  const current = open && active >= 0 && active < choices.length ? active : -1;
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setDismissed(false);
        return;
      }
      if (!choices.length) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current + step + choices.length + (current < 0 && step < 0 ? 1 : 0)) % choices.length);
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setDismissed(true);
      setActive(-1);
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    const conversations = () => conversationSearch && onSearchConversations?.();
    if (event.shiftKey || (conversation && !conversation.hits)) return void conversations();
    if (current >= 0) return void choices[current]?.select();
    const firstConversation = conversation?.hits?.[0];
    if (firstConversation) return void onPickConversation?.(firstConversation);
    const first = shownHits[0];
    if (first) onPick(first);
    else conversations();
  };
  return (
    <PopoverPrimitive.Root open={open}>
      <PopoverPrimitive.Anchor asChild>
        <div className={cn("w-64", className)} {...props}>
          <Input
            id={inputId}
            type="search"
            role="combobox"
            value={value}
            placeholder={placeholder}
            aria-label={label}
            title={hint}
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-activedescendant={current >= 0 ? optionId(current) : undefined}
            onChange={(event) => {
              setDismissed(false);
              setActive(-1);
              onValueChange(event.target.value);
            }}
            onKeyDown={onKeyDown}
          />
          <VisuallyHidden aria-live="polite">{resultText(open, conversation, shownHits.length)}</VisuallyHidden>
        </div>
      </PopoverPrimitive.Anchor>
      <PopoverContent
        align="start"
        aria-label={label}
        className="max-h-96 w-(--radix-popover-trigger-width) gap-1 overflow-y-auto p-1"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          if ((event.target as Element | null)?.closest?.(`#${CSS.escape(inputId)}`)) event.preventDefault();
          else setDismissed(true);
        }}
        onEscapeKeyDown={() => setDismissed(true)}
      >
        {conversation ? (
          <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
            <span>
              Conversations · “{conversation.query}”{conversation.hits ? ` · ${conversation.hits.length}` : ""}
            </span>
            <Link asChild className="ml-auto">
              <button type="button" onClick={onCloseConversation}>
                back
              </button>
            </Link>
          </div>
        ) : null}
        {conversation?.error ? (
          <p role="alert" className="px-3 py-2 text-sm text-destructive">
            {conversation.error}
          </p>
        ) : null}
        {conversation && !conversation.hits && !conversation.error ? <p className="px-3 py-2 text-sm text-muted-foreground">Searching…</p> : null}
        {conversation?.hits?.length === 0 ? <p className="px-3 py-2 text-sm text-muted-foreground">No matches.</p> : null}
        <ul id={listId} role="listbox" aria-label={conversation ? "Conversation results" : "Search results"} className="flex flex-col">
          {choices.map((choice, index) => (
            <li
              key={choice.id}
              id={optionId(index)}
              role="option"
              aria-selected={index === current}
              title={choice.title}
              className={cn(row, choice.className)}
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => setActive(index)}
              onClick={choice.select}
            >
              {choice.content}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </PopoverPrimitive.Root>
  );
}
