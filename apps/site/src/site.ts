// spec/sitePages.md, "Each site has a landing page, a privacy page, terms and a not-found page, and only peon.biz has a join page"
import type { LandingLinks } from "@thenetwork/ui";
import { type Brand, accents, appKeys, joinModes, logoMarks } from "../../../packages/core/src/generated/brandIdentity.ts";
import { type SitePage, sitePageList } from "../../../packages/core/src/generated/sitePages.ts";

/** What a page needs beside the brand: the build writes it into the page, and the page script reads it back. */
export interface SiteData {
  /** The prompt, the skill URL, the join message and the Messages link, as the prerender made them for this build. */
  links: LandingLinks;
  /** The minimum join age of the app, from the platform registry. */
  minJoinAge: number;
  /** The text consent that the join page shows and sends; "" on a page without the join flow. */
  consentText: string;
  /** The security check key of the join page; "" when the site has no security check. */
  turnstileSiteKey: string;
}

/** The pages that need the page script: the landing page (Copy, the agent tiles and Messages) and the browser join flow. */
export type ScriptPage = "LandingPage" | "JoinPage";

/** True when the page ships the page script. The legal pages and the not-found page are complete without it. */
export function pageNeedsScript(page: SitePage): page is ScriptPage {
  switch (page) {
    case "LandingPage":
    case "JoinPage":
      return true;
    case "PrivacyPage":
    case "TermsPage":
    case "NotFoundPage":
      return false;
    default: {
      const unknownPage: never = page;
      return unknownPage;
    }
  }
}

const escapeAttribute = (value: string): string => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The attributes of the root element that carry the page and its data to the page script. A page with the page script also
 * carries its one brand record and its links as data, so that the page script imports no brand table and shows the same prompt.
 */
export function rootAttributes(page: SitePage, brand: Brand, data: SiteData): string {
  const fields: [string, string][] = [
    ["data-page", page],
    ["data-min-age", String(data.minJoinAge)],
    ...(page === "JoinPage" ? ([["data-consent-wording", data.consentText]] as [string, string][]) : []),
    ...(pageNeedsScript(page)
      ? ([
          ["data-brand-record", JSON.stringify(brand)],
          ["data-landing-links", JSON.stringify(data.links)],
        ] as [string, string][])
      : []),
  ];
  return fields.map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`).join("");
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function parseJson(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function textField(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field];
  return typeof value === "string" ? value : undefined;
}

/** The brand record that `rootAttributes` wrote, checked against the generated value lists, or undefined. */
export function parseBrand(value: unknown): Brand | undefined {
  if (!isRecord(value)) return undefined;
  const app = appKeys.find((known) => known === value.app);
  const joinMode = joinModes.find((known) => known === value.joinMode);
  const accent = accents.find((known) => known === value.accent);
  const logo = logoMarks.find((known) => known === value.logo);
  const name = textField(value, "name");
  const domain = textField(value, "domain");
  const keyword = textField(value, "keyword");
  const headlineLead = textField(value, "headlineLead");
  const headlineMark = textField(value, "headlineMark");
  const headlineTail = textField(value, "headlineTail");
  const skillName = textField(value, "skillName");
  if (app === undefined || joinMode === undefined || accent === undefined || logo === undefined) return undefined;
  if (name === undefined || domain === undefined || keyword === undefined || skillName === undefined) return undefined;
  if (headlineLead === undefined || headlineMark === undefined || headlineTail === undefined) return undefined;
  return { app, name, domain, keyword, joinMode, accent, logo, headlineLead, headlineMark, headlineTail, skillName };
}

/** The landing links that `rootAttributes` wrote, or undefined. */
export function parseLinks(value: unknown): LandingLinks | undefined {
  if (!isRecord(value)) return undefined;
  const prompt = textField(value, "prompt");
  const skillUrl = textField(value, "skillUrl");
  const joinMessage = textField(value, "joinMessage");
  const textLine = textField(value, "textLine");
  const messagesHref = textField(value, "messagesHref");
  if (prompt === undefined || skillUrl === undefined || joinMessage === undefined || textLine === undefined || messagesHref === undefined) return undefined;
  return { prompt, skillUrl, joinMessage, textLine, messagesHref };
}

/** Reads back what `rootAttributes` wrote, or undefined when the root does not carry a known page with its brand and links. */
export function readRoot(root: HTMLElement, turnstileSiteKey: string): { page: SitePage; brand: Brand; data: SiteData } | undefined {
  const { page, minAge, consentWording, brandRecord, landingLinks } = root.dataset;
  const known = sitePageList.find((candidate) => candidate === page);
  const minJoinAge = Number(minAge);
  const brand = parseBrand(parseJson(brandRecord));
  const links = parseLinks(parseJson(landingLinks));
  if (known === undefined || brand === undefined || links === undefined || !Number.isSafeInteger(minJoinAge)) return undefined;
  return { page: known, brand, data: { links, minJoinAge, consentText: consentWording ?? "", turnstileSiteKey } };
}
