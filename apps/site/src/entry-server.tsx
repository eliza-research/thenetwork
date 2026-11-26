// spec/brandIdentity.md, "Each site has one brand record with its name, domain, app, keyword, join mode, accent, logo and headline"
import { StrictMode } from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import type { BrandId } from "@thenetwork/design-system/brands";
import friendsTokens from "@thenetwork/design-system/friends/tokens.json";
import networkTokens from "@thenetwork/design-system/network/tokens.json";
import peonTokens from "@thenetwork/design-system/peon/tokens.json";
import slopTokens from "@thenetwork/design-system/slop/tokens.json";
import { BrandMark, brandIdFor, landingLinks, privacyFor, termsFor } from "@thenetwork/ui";
import { type AppKey, type Brand, type ColorScheme, accentTokens, brandFor, colorSchemes, faviconMedia } from "../../../packages/core/src/generated/brandIdentity.ts";
import { isOneStepPage, type SitePage, siteHasPage } from "../../../packages/core/src/generated/sitePages.ts";
import { buttonPageButtons, UPDATE_HANDOFF_ASSISTANTS } from "../../../packages/notify/src/links.ts";
import { UPDATE_HANDOFF_TEMPLATE_REFERENCE } from "../../../packages/notify/src/reference.ts";
import { UpdateHandoffView } from "../../../packages/ui/src/components/UpdateHandoffView.tsx";
import { landingDescriptionFor } from "../../../packages/ui/src/content/landing.ts";
import { App, type SiteView } from "./App.tsx";
import { type SiteData, pageNeedsScript, rootAttributes } from "./site.ts";

/** What the build gives each page. */
export interface PageInput extends Omit<SiteData, "links"> {
  /** The path of the site's hashed favicon. */
  favicon: string;
  faviconDark?: string;
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
export type RenderFavicon = (app: AppKey, scheme?: ColorScheme) => string;

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
    case "UpdateHandoffPage":
      return { title: `Open your update · ${brand.name}`, description: `Open your ${brand.name} update in your assistant.` };
    case "PhonePage":
      return { title: `Change your number · ${brand.name}`, description: `Change the number you use with ${brand.name}.` };
    case "HomeHelpPage":
      return { title: `Home-help address · ${brand.name}`, description: "Add or read a home-help address." };
    case "PhotosAddPage":
      return { title: `Add photos · ${brand.name}`, description: `Add your photos to ${brand.name}.` };
    case "PhotosCheckPage":
      return { title: `Check your photo · ${brand.name}`, description: "Check a photo before you send it." };
    case "PhotosMinePage":
      return { title: `Your photos · ${brand.name}`, description: "See your photos and who has each one." };
    case "PhotosViewPage":
      return { title: `Your photo · ${brand.name}`, description: "Open the photo a match sent you." };
    default: {
      const unknownPage: never = page;
      return unknownPage;
    }
  }
}

function viewOf(app: AppKey, page: SiteView["page"]): SiteView {
  if (page === "PrivacyPage") return { page, legal: privacyFor[app] };
  if (page === "TermsPage") return { page, legal: termsFor[app] };
  return { page };
}

const escapeText = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const faviconLinks = (hrefs: Partial<Record<ColorScheme, string>>): string[] =>
  colorSchemes.flatMap((scheme) => {
    const href = hrefs[scheme];
    if (!href) return [];
    const media = faviconMedia(scheme);
    return [`<link rel="icon" href="${escapeText(href)}" type="image/svg+xml"${media ? ` media="${escapeText(media)}"` : ""}>`];
  });

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
    ...faviconLinks({ LightScheme: input.favicon, DarkScheme: input.faviconDark }),
    ...(page === "JoinPage" || page === "PhonePage" || page === "HomeHelpPage" ? ['<meta name="turnstile-sitekey" content="{{TURNSTILE_SITE_KEY}}">'] : []),
    ...(isOneStepPage(page) ? ['<meta name="robots" content="noindex">'] : []),
  ].join("\n    ");
  const site: SiteData = {
    links: landingLinks(app, { skillVersion: input.skillVersion, textLine: input.textLine, siteHost: input.siteHost }),
    minJoinAge: input.minJoinAge,
    consentText: input.consentText,
    turnstileSiteKey: input.turnstileSiteKey,
  };
  const html = renderToString(
    <StrictMode>
      {page === "UpdateHandoffPage" ? <UpdateHandoffView brand={brand} buttons={buttonPageButtons(UPDATE_HANDOFF_TEMPLATE_REFERENCE, UPDATE_HANDOFF_ASSISTANTS)} /> : <App brand={brand} view={viewOf(app, page)} site={site} />}
    </StrictMode>,
  );
  return { brandId: brandIdFor[app], head, rootAttributes: rootAttributes(page, brand, site), html, script: pageNeedsScript(page) };
};

type MarkColor = "background" | "foreground" | "primary" | "primary-foreground";

const brandTokens: Record<BrandId, { color: Record<"light" | "dark", Record<MarkColor, string>> }> = {
  network: networkTokens,
  slop: slopTokens,
  friends: friendsTokens,
  peon: peonTokens,
};

const schemeKey: Record<ColorScheme, "light" | "dark"> = { LightScheme: "light", DarkScheme: "dark" };

const markAttributes: Record<string, (color: Record<MarkColor, string>) => string> = {
  "size-8": () => "",
  "shrink-0": () => "",
  "fill-background": (color) => ` fill="${color.background}"`,
  "fill-foreground": (color) => ` fill="${color.foreground}"`,
  "fill-primary": (color) => ` fill="${color.primary}"`,
  "fill-primary-foreground": (color) => ` fill="${color["primary-foreground"]}"`,
  "stroke-primary-foreground": (color) => ` stroke="${color["primary-foreground"]}"`,
};

/**
 * The favicon of one site in one color scheme: the header mark (`BrandMark`) with its token classes written as presentation
 * attributes in the colors of that scheme, because a favicon loads no stylesheet and the content security policy refuses inline styles.
 */
export const favicon: RenderFavicon = (app, scheme = "LightScheme") => {
  const color = brandTokens[brandIdFor[app]].color[schemeKey[scheme]];
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
