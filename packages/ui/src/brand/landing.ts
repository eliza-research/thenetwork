// spec/landingEntry.md, "The prompt tells the agent to read the site's skill and follow it"
import type { BrandId } from "@thenetwork/design-system/brands";
import type { AppKey } from "../../../core/src/generated/brandIdentity.ts";
import {
  type AgentId,
  type StatusLine,
  agentLinkTemplate,
  agentToastText,
  copyByHandText,
  joinKeyword,
  joinMessagePrefix,
  messagesFallbackTemplate,
  promptCarriesVersion,
  promptHost,
  promptLead,
  promptSkillPath,
  promptTail,
  promptVersionQuery,
} from "../../../core/src/generated/landingEntry.ts";
import type { SitePage } from "../../../core/src/generated/sitePages.ts";

/** The `data-brand` value of the design system for each app of the brand record. */
export const brandIdFor: Record<AppKey, BrandId> = { Ntwrk: "network", Slop: "slop", Peon: "peon", Friends: "friends" };

/** What the landing page of one site sends: the prompt, the skill URL it names, and the join message to the shared line. */
export interface LandingLinks {
  /** The signup prompt the person copies into their agent. */
  prompt: string;
  /** The skill URL inside the prompt. */
  skillUrl: string;
  /** The text that joins this app on the shared line. */
  joinMessage: string;
  /** The shared line number, as the `sms:` link and the status line show it. */
  textLine: string;
  /** The `sms:` link of the Messages entry. */
  messagesHref: string;
}

/** What the build gives the landing links beside the app. */
export interface LandingInput {
  /** The version in the front matter of the site's skill. */
  skillVersion: string;
  /** The number of the shared text line. */
  textLine: string;
  /** The host of a staging build; "" on a production build, where the prompt names the brand domain. */
  siteHost?: string;
}

/**
 * The prompt, skill URL and Messages link of one app. The skill version, the text line number and the site host are inputs, never constants.
 * Only the prerender calls it: the page script reads the links that the prerender wrote, so that both show the same prompt.
 */
export function landingLinks(app: AppKey, { skillVersion, textLine, siteHost = "" }: LandingInput): LandingLinks {
  // spec/landingEntry.md, "The prompt names the host of the site that serves it"
  const query = promptCarriesVersion(app) ? `${promptVersionQuery}${encodeURIComponent(skillVersion)}` : "";
  const location = `${promptHost(app, siteHost)}${promptSkillPath}${query}`;
  const joinMessage = `${joinMessagePrefix}${joinKeyword(app)}`;
  return {
    prompt: `${promptLead}${location}${promptTail}`,
    skillUrl: `https://${location}`,
    joinMessage,
    textLine,
    messagesHref: `sms:${textLine}?body=${encodeURIComponent(joinMessage)}`,
  };
}

/** The link of an agent tile, with `{q}` and `{skill}` filled in; none for a copy-only tile. */
export function agentHref(agent: AgentId, links: Pick<LandingLinks, "prompt" | "skillUrl">): string | undefined {
  const template = agentLinkTemplate(agent);
  if (template === "") return undefined;
  return template.replace("{q}", encodeURIComponent(links.prompt)).replace("{skill}", encodeURIComponent(links.skillUrl));
}

/** The text of the status line for a generated status value. `agent` is the agent of the last tile press, the `statusAgent` of the landing state. */
export function statusText(status: StatusLine, agent: AgentId, links: Pick<LandingLinks, "joinMessage" | "textLine">): string {
  switch (status) {
    case "StatusEmpty":
      return "";
    case "AgentOpening":
    case "PasteInAgent":
    case "SendToAgentApp":
      return agentToastText(agent);
    case "CopyByHand":
      return copyByHandText;
    case "MessageCopied":
    case "TextTheNumber":
      // spec/landingEntry.md, "The device decides whether the entry opens Messages or shows the number"
      return messagesFallbackTemplate(status === "MessageCopied")
        .replace(/\{message\}|\{number\}/g, field => field === "{message}" ? links.joinMessage : links.textLine);
  }
}

/** The path and the link text of each page that the footer can link. */
export const sitePageLinks: Partial<Record<SitePage, { href: string; label: string }>> = {
  LandingPage: { href: "/", label: "Home" },
  PrivacyPage: { href: "/privacy", label: "Privacy" },
  TermsPage: { href: "/terms", label: "Terms" },
  NotFoundPage: { href: "/404", label: "Not found" },
  JoinPage: { href: "/join", label: "Join" },
};
