// spec/sitePages.md, "The terms name the join page as a way to opt in only where the site serves it"
import type { LegalText } from "./types.ts";
import { PrivacyLink, SupportEmail } from "./parts.tsx";

/** The terms of friends.help. friends.help has no join page, so a person opts in through the agent or by text. */
export const friendsTerms: LegalText = {
  title: "Terms of service",
  effective: "Effective October 8, 2026.",
  intro: 'These terms cover your use of friends.help, operated by Eliza Research Corporation ("we"). When you join, you agree to them.',
  sections: [
    {
      heading: "Who can join",
      body: <p>You must be 13 or older to join. Members aged 13 to 17 are never matched on dates or for work. On friends.help, members under 18 receive friendship introductions only, to people aged 13 to 18 born at most 2 years apart, after an automatic check approves each one. Give your real first name and your real birth date or age, and keep your phone number current. One person, one membership.</p>,
    },
    {
      sms: {
        heading: "Text messaging terms",
        lead: "friends.help works by text.",
        optIn: {
          label: <strong>How you opt in:</strong>,
          ways: {
            OptInInAgent: <>in your AI agent, you ask the agent to sign you up, confirm your number with a code, and approve this wording: "I agree to receive recurring text messages from friends.help at this number: questions about what I like to do, invitations to plans, plan details and reminders. Message frequency varies. Message and data rates may apply. Reply STOP to stop and HELP for help. Consent is not a condition of any purchase." We record that wording with the date and time.</>,
            OptInByText: <>You can also opt in by text: send <strong>friends</strong> or <strong>friends.help</strong> as your first message to our number. We record that message as your opt-in.</>,
          },
        },
        optInNote: <strong>Consent is not a condition of any purchase.</strong>,
        items: {
          SmsProgram: <><strong>Program:</strong> friends.help sends conversational text messages (SMS and iMessage): questions about what you like to do, invitations to small group plans you can accept or skip, plan details, reminders and check-ins.</>,
          SmsFrequency: <><strong>Frequency:</strong> message frequency varies with how you use friends.help. Unprompted messages are limited (two a week by default), and we do not text during quiet hours in your time zone.</>,
          SmsStopEverything: <><strong>Stop:</strong> reply <strong>STOP</strong> to stop every text from our number, for friends.help and every other app on the same number. You get one confirmation and nothing else.</>,
          SmsLeaveOne: <><strong>Leave:</strong> to stop friends.help only, text <strong>leave friends.help</strong>.</>,
          SmsStartAgain: <><strong>Start again:</strong> reply <strong>START</strong>.</>,
          SmsHelp: <><strong>Help:</strong> reply <strong>HELP</strong>, or email <SupportEmail />.</>,
          SmsCosts: <><strong>Costs:</strong> message and data rates may apply. Carriers are not liable for delayed or undelivered messages.</>,
          SmsNoMarketingShare: <><strong>Privacy:</strong> Mobile numbers and opt-in data are not shared with third parties or affiliates for marketing. See the <PrivacyLink />.</>,
        },
      },
    },
    {
      heading: "Plans and safety",
      body: <p>friends.help suggests plans at public places only. We do not run background checks on members. You are responsible for your own decisions and safety. Text us or email us to block or report a member. A person reviews every report.</p>,
    },
    {
      heading: "Acceptable use",
      body: <p>Do not harass, deceive, spam or sell to other members. Do not try to get information about other members that they did not share with you. We may pause or remove a member who breaks these rules or puts others at risk.</p>,
    },
    {
      heading: "The service",
      body: <p>friends.help is new and provided as it is. Features may change. Suggestions come from software and from people, so they can be wrong. To the extent the law allows, we are not liable for indirect or consequential damages from your use of friends.help or from meetings with other members.</p>,
    },
    {
      heading: "Leaving",
      body: <p>You can stop this app at any time by texting "leave friends.help". For deletion, email <SupportEmail />. See the <PrivacyLink /> for what we delete.</p>,
    },
    {
      heading: "Changes and contact",
      body: <p>We will text you about material changes before they take effect. Questions: <SupportEmail />.</p>,
    },
  ],
};
