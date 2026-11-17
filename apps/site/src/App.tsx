// spec/sitePages.md, "Every site serves public pages and each special page has one site"
import { JoinView, type LegalText, LandingView, LegalDocument, NotFoundView, PageShell, useJoin, useLanding } from "@thenetwork/ui";
import type { Brand } from "../../../packages/core/src/generated/brandIdentity.ts";
import type { SitePage } from "../../../packages/core/src/generated/sitePages.ts";
import type { SiteData } from "./site.ts";

/** The page to show: a legal page carries its text, which only the prerender reads. */
export type SiteView =
  | { page: Exclude<SitePage, "PrivacyPage" | "TermsPage" | "UpdateHandoffPage"> }
  | { page: "PrivacyPage" | "TermsPage"; legal: LegalText };

export interface AppProps {
  /** The brand record of the site. */
  brand: Brand;
  /** The page of the site. */
  view: SiteView;
  /** The landing links, the join age, the consent text and the security check key. */
  site: SiteData;
}

/**
 * One page of one site. Every brand uses the same parts; only the brand record and the site data differ.
 * @model spec/sitePages.md
 */
export function App({ brand, view, site }: AppProps) {
  switch (view.page) {
    case "LandingPage":
      return <Landing brand={brand} site={site} />;
    case "PrivacyPage":
    case "TermsPage":
      return (
        <PageShell brand={brand}>
          <LegalDocument app={brand.app} text={view.legal} />
        </PageShell>
      );
    case "NotFoundPage":
      return (
        <PageShell brand={brand}>
          <NotFoundView name={brand.name} />
        </PageShell>
      );
    case "JoinPage":
      return (
        <PageShell brand={brand}>
          <Join brand={brand} site={site} />
        </PageShell>
      );
    default: {
      const unknownView: never = view;
      return unknownView;
    }
  }
}

type PartProps = Pick<AppProps, "brand" | "site">;

/**
 * The landing page over the landing state of `useLanding`.
 * @model spec/landingEntry.md
 */
function Landing({ brand, site }: PartProps) {
  const landing = useLanding(site.links);
  return <LandingView brand={brand} {...landing} />;
}

/**
 * The browser join flow over the join state of `useJoin`.
 * @model spec/browserJoin.md
 */
function Join({ brand, site }: PartProps) {
  const join = useJoin({ siteKey: site.turnstileSiteKey, pageMinAge: site.minJoinAge, pageInviteOnly: brand.joinMode === "InviteOnly" });
  return (
    <JoinView
      {...join}
      consentText={site.consentText}
      homeLabel={`Back to ${brand.name}`}
      blockedMessages={{
        UnderAge: `You must be ${site.minJoinAge} or older to join ${brand.name}. We did not save your details.`,
        InviteOnly: `${brand.name} is not open to new members right now. Please try again later.`,
      }}
    />
  );
}
