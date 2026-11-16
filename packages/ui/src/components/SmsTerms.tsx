// spec/sitePages.md, "The terms page has a text messaging section that a link can open"
import { Fragment, type ComponentProps } from "react";
import type { AppKey } from "../../../core/src/generated/brandIdentity.ts";
import { optInWays, smsTermsAnchor, smsTermsItems } from "../../../core/src/generated/sitePages.ts";
import type { SmsTermsText } from "../content/legal/types.ts";

export type SmsTermsProps = ComponentProps<"section"> & {
  /** The site whose terms these are; it sets the ways a person can opt in. */
  app: AppKey;
  /** The words of each item of the section. */
  text: SmsTermsText;
};

/**
 * The text messaging section of the terms. It shows the items in the order of the spec, and it names only the opt-in ways that the site offers, so the terms never name a join page that the site does not serve. A link to `#sms` opens it.
 * Its rules come from `spec/sitePages.md`, a spec of decisions with no state of its own.
 */
export function SmsTerms({ app, text, ...props }: SmsTermsProps) {
  return (
    <section aria-labelledby={smsTermsAnchor} {...props}>
      <h2 id={smsTermsAnchor}>{text.heading}</h2>
      {text.lead ? <p>{text.lead}</p> : null}
      <ul>
        {smsTermsItems.map((item) =>
          item === "SmsOptIn" ? (
            <Fragment key={item}>
              <li>
                {text.optIn.label}
                {optInWays(app).map((way) => (
                  <Fragment key={way}> {text.optIn.ways[way]}</Fragment>
                ))}
                {text.optIn.close ? <> {text.optIn.close}</> : null}
              </li>
              {text.optInNote ? <li>{text.optInNote}</li> : null}
            </Fragment>
          ) : (
            <li key={item}>{text.items[item]}</li>
          ),
        )}
      </ul>
    </section>
  );
}
