// spec/landingEntry.md, "The landing page shows the brand, the prompt, the agents, the Messages entry, the status line and two legal links"
import type { ComponentProps, MouseEvent, Ref } from "react";
import type { Brand } from "../../../core/src/generated/brandIdentity.ts";
import { type AgentId, type Landing, canPressCopy, landingShows } from "../../../core/src/generated/landingEntry.ts";
import { footerOf } from "../../../core/src/generated/sitePages.ts";
import type { LandingLinks } from "../brand/landing.ts";
import { cn } from "../lib/cn.ts";
import { AgentRow } from "./AgentRow.tsx";
import { Headline } from "./Headline.tsx";
import { MessagesButton } from "./MessagesButton.tsx";
import { PromptCopy } from "./PromptCopy.tsx";
import { SiteFooter } from "./SiteFooter.tsx";
import { SkipLink } from "./SkipLink.tsx";
import { StatusLine } from "./StatusLine.tsx";
import { Wordmark } from "./Wordmark.tsx";

export type LandingViewProps = Omit<ComponentProps<"div">, "children"> & {
  /** The brand record of the site. */
  brand: Brand;
  /** The prompt, the skill URL, the join message and the Messages link of the site. */
  links: LandingLinks;
  /** The landing state. */
  state: Landing;
  /** Receives the prompt text element. */
  promptRef?: Ref<HTMLElement>;
  /** Called when the person presses Copy. */
  onCopy?: () => void;
  /** Called when the person presses an agent tile. */
  onChooseAgent?: (agent: AgentId) => void;
  /** Called when the person presses the Messages entry, before the browser follows it. */
  onChooseMessages?: (event: MouseEvent<HTMLAnchorElement>) => void;
};

const wrap = "mx-auto w-full max-w-6xl px-5 sm:px-10 lg:px-16";

/**
 * The landing page of a site: the brand mark, the headline, the prompt and Copy, the agent row, the Messages entry, the status line and the legal links, each only where the generated `landingShows` allows it.
 * @model spec/landingEntry.md
 */
export function LandingView({ brand, links, state, promptRef, onCopy, onChooseAgent, onChooseMessages, className, ...props }: LandingViewProps) {
  return (
    <div className={cn("flex min-h-svh flex-col bg-background font-sans text-foreground antialiased", className)} {...props}>
      <SkipLink>Skip to content</SkipLink>
      {landingShows("BrandMarkItem") && (
        <header className={cn(wrap, "py-5 sm:py-8")}>
          <Wordmark brand={brand} />
        </header>
      )}
      <main id="main" className={cn(wrap, "flex flex-1 flex-col justify-center py-10 sm:py-24")}>
        {landingShows("HeadlineItem") && <Headline lead={brand.headlineLead} mark={brand.headlineMark} tail={brand.headlineTail} />}
        {landingShows("PromptItem") && (
          <PromptCopy
            className="mt-9 sm:mt-14"
            prompt={links.prompt}
            copy={state.copy}
            canCopy={landingShows("CopyButtonItem") && canPressCopy(state)}
            onCopy={onCopy}
            promptRef={promptRef}
          />
        )}
        {landingShows("AgentRowItem") && <AgentRow className="mt-3.5" links={links} mounted={state.mounted} device={state.device} onChoose={onChooseAgent} />}
        {landingShows("MessagesItem") && (
          <div className="mt-7">
            <MessagesButton href={links.messagesHref} onClick={onChooseMessages} />
          </div>
        )}
        {landingShows("StatusItem") && <StatusLine className="mt-5" status={state.status} agent={state.statusAgent} links={links} />}
      </main>
      <SiteFooter className={wrap} pages={footerOf("LandingPage")} />
    </div>
  );
}
