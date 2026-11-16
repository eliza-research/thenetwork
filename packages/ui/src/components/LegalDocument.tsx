// spec/brandIdentity.md, "Every site uses the same parts, and only peon.biz adds the browser join flow"
import type { AppKey } from "../../../core/src/generated/brandIdentity.ts";
import type { LegalText } from "../content/legal/types.ts";
import { Prose, type ProseProps } from "./Prose.tsx";
import { SmsTerms } from "./SmsTerms.tsx";

export type LegalDocumentProps = ProseProps & {
  /** The site whose legal text this is. */
  app: AppKey;
  /** The privacy policy or the terms of the site, from `content/legal`. */
  text: LegalText;
};

/**
 * A privacy policy or the terms of one site: the title, the effective date, the opening paragraph and the sections. The text messaging section of the terms comes from `SmsTerms`.
 * @model spec/sitePages.md
 */
export function LegalDocument({ app, text, ...props }: LegalDocumentProps) {
  return (
    <Prose {...props}>
      <h1>{text.title}</h1>
      <p className="text-sm text-muted-foreground">{text.effective}</p>
      <p>{text.intro}</p>
      {text.sections.map((section) =>
        "sms" in section ? (
          <SmsTerms key={section.sms.heading} app={app} text={section.sms} />
        ) : (
          <section key={section.heading}>
            <h2>{section.heading}</h2>
            {section.body}
          </section>
        ),
      )}
    </Prose>
  );
}
