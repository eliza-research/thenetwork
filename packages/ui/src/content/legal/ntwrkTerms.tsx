// spec/sitePages.md, "The terms name the join page as a way to opt in only where the site serves it"
import type { LegalText } from "./types.ts";
import { PrivacyLink, SupportEmail } from "./parts.tsx";

/** The terms of The Network. ntwrk.party has no join page, so a person opts in through the agent, by text or by an invitation. */
export const ntwrkTerms: LegalText = {
  title: "Terms of service",
  effective: "Effective October 7, 2026",
  intro: 'These terms govern your use of The Network, an invite-only service operated by Eliza Research Corporation ("we"). By accepting an invitation, you agree to them.',
  sections: [
    {
      heading: "Membership",
      body: <p>Membership is by invitation. You must be at least 13. Members under 18 receive personal help and recommendations and are never matched on dates or for work. On The Network, members under 18 receive friendship introductions only, to people aged 13 to 18 born at most 2 years apart, after an automatic check approves each one. You agree to give accurate information about yourself, including your birth date or age, and to keep your phone number current.</p>,
    },
    {
      sms: {
        heading: "Text messaging terms",
        optIn: {
          label: <><strong>Consent:</strong> you opt in in one of these ways.</>,
          ways: {
            OptInInAgent: <>You ask your AI agent to sign you up, confirm your number with a code, and approve the consent wording.</>,
            OptInByText: <>You text our number first, with an app keyword such as "slop", "friends" or "peon", or with no keyword to join The Network itself.</>,
          },
          close: <>Or you accept an invitation and agree to receive texts at the number you provide. We record how and when you opted in. Consent is not a condition of any purchase.</>,
        },
        items: {
          SmsProgram: <><strong>Program:</strong> The Network sends conversational text messages: replies to you, introductions and plans you asked for, scheduling, reminders and check-ins, and occasional suggestions within the limits you set.</>,
          SmsFrequency: <><strong>Frequency:</strong> message frequency varies. Unsolicited suggestions are capped (two per week by default, fewer if you choose), and we don't text during quiet hours in your time zone.</>,
          SmsStopEverything: <><strong>Opt out:</strong> reply <strong>STOP</strong> to stop every text from our number, for The Network and every app it powers (slop.date, friends.help and peon.biz).</>,
          SmsLeaveOne: <><strong>Leave one app:</strong> to stop one app only, text <strong>leave</strong> and the app name, for example "leave slop.date".</>,
          SmsStartAgain: <><strong>Start again:</strong> reply <strong>START</strong> to resume.</>,
          SmsHelp: <><strong>Help:</strong> reply <strong>HELP</strong>, or email <SupportEmail />.</>,
          SmsCosts: <><strong>Costs:</strong> message and data rates may apply. Carriers are not liable for delayed or undelivered messages.</>,
          SmsNoMarketingShare: <><strong>Privacy:</strong> see our <PrivacyLink />. Mobile numbers and opt-in data are not shared with third parties or affiliates for marketing.</>,
        },
      },
    },
    {
      heading: "Meeting people",
      body: <p>Introductions happen only when both people agree. We suggest public places for first meetings. We don't run background checks on members, and you are responsible for your own decisions and safety when meeting anyone. You can block or report anyone by texting The Network, and we act on reports promptly.</p>,
    },
    {
      heading: "Acceptable use",
      body: <p>Don't harass, deceive, spam, or solicit other members commercially; don't misrepresent your age or identity; and don't try to access information about other members that they haven't shared with you. We may suspend or remove members who break these rules or put others at risk.</p>,
    },
    {
      heading: "The service",
      body: <p>The Network is provided as-is during its pilot. Features may change, and suggestions come from software and human reviewers, so they can be wrong. To the extent the law allows, we aren't liable for indirect or consequential damages arising from your use of the service or from meetings with other members.</p>,
    },
    {
      heading: "Changes and contact",
      body: <p>We'll tell you by text about material changes before they apply. Questions: <SupportEmail />.</p>,
    },
  ],
};
