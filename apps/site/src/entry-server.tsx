// spec/brandIdentity.md, "Each site has one brand record with its name, domain, app, keyword, join mode, accent, logo and headline"
import { StrictMode } from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import type { BrandId } from "@thenetwork/design-system/brands";
import friendsTokens from "@thenetwork/design-system/friends/tokens.json";
import networkTokens from "@thenetwork/design-system/network/tokens.json";
import peonTokens from "@thenetwork/design-system/peon/tokens.json";
import slopTokens from "@thenetwork/design-system/slop/tokens.json";
import { BrandMark, brandIdFor, landingLinks, privacyFor, termsFor } from "@thenetwork/ui";
import { type AppKey, type Brand, accentTokens, brandFor } from "../../../packages/core/src/generated/brandIdentity.ts";
import { type SitePage, siteHasPage } from "../../../packages/core/src/generated/sitePages.ts";
import { landingDescriptionFor } from "../../../packages/ui/src/content/landing.ts";
import { App, type SiteView } from "./App.tsx";
import { type SiteData, pageNeedsScript, rootAttributes } from "./site.ts";

/** What the build gives each page. */
export interface PageInput extends Omit<SiteData, "links"> {
  /** The path of the site's hashed favicon. */
  favicon: string;
  /** The version in the front matter of the site's skill. */
  skillVersion: string;
  /** The number of the shared text line. */
  textLine: string;
  /** The host of a staging build; "" on a production build. */
  siteHost: string;
}

/** One prerendered page: the parts that the build puts into the page template. */
export interface RenderedPage {
  /** The `data-brand` value of `<html>`. */
  brandId: BrandId;
  /** The title, description, theme colors, favicon and, on the join page, the security check key. */
  head: string;
  /** The attributes of the root element. */
  rootAttributes: string;
  /** The markup inside the root element. */
  html: string;
  /** True when the page ships the page script. */
  script: boolean;
}

/** Prerenders one page of one site. */
export type RenderPage = (app: AppKey, page: SitePage, input: PageInput) => RenderedPage;

/** Draws the favicon of one site as a complete SVG file. */
export type RenderFavicon = (app: AppKey) => string;

function pageText(brand: Brand, page: SitePage): { title: string; description: string } {
  switch (page) {
    case "LandingPage":
      return { title: brand.name, description: landingDescriptionFor[brand.app] };
    case "PrivacyPage":
      return { title: `Privacy policy · ${brand.name}`, description: `How ${brand.name} collects, uses and protects your data.` };
    case "TermsPage":
      return { title: `Terms · ${brand.name}`, description: `The terms for using ${brand.name}.` };
    case "NotFoundPage":
      return { title: `Not found · ${brand.name}`, description: "Page not found." };
    case "JoinPage":
      return { title: `Join · ${brand.name}`, description: `Join ${brand.name}.` };
    default: {
      const unknownPage: never = page;
      return unknownPage;
    }
  }
}

function viewOf(app: AppKey, page: SitePage): SiteView {
  if (page === "PrivacyPage") return { page, legal: privacyFor[app] };
  if (page === "TermsPage") return { page, legal: termsFor[app] };
  return { page };
}

const escapeText = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Prerenders one page of one site that the site has (the generated `siteHasPage`). */
export const render: RenderPage = (app, page, input) => {
  if (!siteHasPage(app, page)) throw new Error(`${app} has no ${page}`);
  const brand = brandFor(app);
  const accent = accentTokens(brand.accent);
  const text = pageText(brand, page);
  const head = [
    `<title>${escapeText(text.title)}</title>`,
    `<meta name="description" content="${escapeText(text.description)}">`,
    `<meta name="theme-color" content="${escapeText(accent.light)}" media="(prefers-color-scheme: light)">`,
    `<meta name="theme-color" content="${escapeText(accent.dark)}" media="(prefers-color-scheme: dark)">`,
    `<link rel="icon" href="${escapeText(input.favicon)}" type="image/svg+xml">`,
    ...(page === "JoinPage" ? ['<meta name="turnstile-sitekey" content="{{TURNSTILE_SITE_KEY}}">'] : []),
  ].join("\n    ");
  const site: SiteData = {
    links: landingLinks(app, { skillVersion: input.skillVersion, textLine: input.textLine, siteHost: input.siteHost }),
    minJoinAge: input.minJoinAge,
    consentText: input.consentText,
    turnstileSiteKey: input.turnstileSiteKey,
  };
  const html = renderToString(
    <StrictMode>
      <App brand={brand} view={viewOf(app, page)} site={site} />
    </StrictMode>,
  );
  return { brandId: brandIdFor[app], head, rootAttributes: rootAttributes(page, brand, site), html, script: pageNeedsScript(page) };
};

type MarkColor = "background" | "foreground" | "primary" | "primary-foreground";

const lightColors: Record<BrandId, Record<MarkColor, string>> = {
  network: networkTokens.color.light,
  slop: slopTokens.color.light,
  friends: friendsTokens.color.light,
  peon: peonTokens.color.light,
};

const markAttributes: Record<string, (color: Record<MarkColor, string>) => string> = {
  "size-8": () => "",
  "shrink-0": () => "",
  "text-foreground": (color) => ` color="${color.foreground}"`,
  "fill-current": () => ' fill="currentColor"',
  "fill-background": (color) => ` fill="${color.background}"`,
  "fill-primary": (color) => ` fill="${color.primary}"`,
  "fill-primary-foreground": (color) => ` fill="${color["primary-foreground"]}"`,
  "stroke-primary-foreground": (color) => ` stroke="${color["primary-foreground"]}"`,
};

/**
 * The favicon of one site: the header mark (`BrandMark`) with its token classes written as presentation attributes in the
 * light colors of the brand, because a favicon loads no stylesheet and the content security policy refuses inline styles.
 */
export const favicon: RenderFavicon = (app) => {
  const color = lightColors[brandIdFor[app]];
  const mark = renderToStaticMarkup(<BrandMark logo={brandFor(app).logo} xmlns="http://www.w3.org/2000/svg" />);
  return mark.replace(/ class="([^"]*)"/g, (_whole, classes: string) =>
    classes
      .split(/\s+/)
      .filter(Boolean)
      .map((name) => {
        const attribute = markAttributes[name];
        if (!attribute) throw new Error(`the favicon of ${app} has no color for the class ${name}`);
        return attribute(color);
      })
      .join(""),
  );
};
