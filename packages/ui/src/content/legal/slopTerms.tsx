// spec/sitePages.md, "The terms name the join page as a way to opt in only where the site serves it"
import type { LegalText } from "./types.ts";
import { PrivacyLink, SupportEmail } from "./parts.tsx";

/** The terms of slop.date. slop.date has no join page, so a person opts in through the agent or by text. */
export const slopTerms: LegalText = {
  title: "Terms of service",
  effective: "Effective October 8, 2026.",
  intro: 'These terms cover your use of slop.date, operated by Eliza Research Corporation ("we"). When you join, you agree to them.',
  sections: [
    {
      heading: "Who can join",
      body: <p>You must be 13 or older to join. Only adults 18 and older are matched or introduced, and only adults can share photos. Members aged 13 to 17 are never matched or introduced to anyone. Give your real first name and your real age, and keep your phone number current. One person, one membership.</p>,
    },
    {
      sms: {
        heading: "Text messaging terms",
        lead: "slop.date works by text.",
        optIn: {
          label: <strong>How you opt in:</strong>,
          ways: {
            OptInInAgent: <>in your AI agent, you ask the agent to sign you up, confirm your number with a code, and approve this wording: "I agree to receive recurring text messages from slop.date at this number: questions from the matchmaker, introductions I agree to, date plans and reminders. Message frequency varies. Message and data rates may apply. Reply STOP to stop and HELP for help. Consent is not a condition of any purchase." We record that wording with the date and time.</>,
            OptInByText: <>You can also opt in by text: send <strong>slop</strong> or <strong>slop.date</strong> as your first message to our number. We record that message as your opt-in.</>,
          },
        },
        optInNote: <strong>Consent is not a condition of any purchase.</strong>,
        items: {
          SmsProgram: <><strong>Program:</strong> slop.date sends conversational text messages (SMS and iMessage): questions from the matchmaker, introductions you agree to, first-date plans, reminders and check-ins after a date.</>,
          SmsFrequency: <><strong>Frequency:</strong> message frequency varies with how you use slop.date. Unprompted messages are limited (two a week by default), and we do not text during quiet hours in your time zone.</>,
          SmsStopEverything: <><strong>Stop:</strong> reply <strong>STOP</strong> to stop every text from our number, for slop.date and every other app on the same number. You get one confirmation and nothing else.</>,
          SmsLeaveOne: <><strong>Leave:</strong> to stop slop.date only, text <strong>leave slop.date</strong>.</>,
          SmsStartAgain: <><strong>Start again:</strong> reply <strong>START</strong>.</>,
          SmsHelp: <><strong>Help:</strong> reply <strong>HELP</strong>, or email <SupportEmail />.</>,
          SmsCosts: <><strong>Costs:</strong> message and data rates may apply. Carriers are not liable for delayed or undelivered messages.</>,
          SmsNoMarketingShare: <><strong>Privacy:</strong> Mobile numbers and opt-in data are not shared with third parties or affiliates for marketing. See the <PrivacyLink />.</>,
        },
      },
    },
    {
      heading: "Safety",
      body: <p><strong>slop.date does not run criminal background checks or identity checks on members.</strong> You are responsible for your own decisions and safety when you meet someone. Text us or email us to block or report a member. A person reviews every report.</p>,
    },
    {
      heading: "Acceptable use",
      body: <p>Do not harass, deceive, spam or sell to other members. Do not try to get information about other members that they did not share with you. We may pause or remove a member who breaks these rules or puts others at risk.</p>,
    },
    {
      heading: "The service",
      body: <p>slop.date is new and provided as it is. Features may change. Suggestions come from software and from people, so they can be wrong. To the extent the law allows, we are not liable for indirect or consequential damages from your use of slop.date or from meetings with other members.</p>,
    },
    {
      heading: "Leaving",
      body: <p>You can stop this app at any time by texting "leave slop.date". For deletion, email <SupportEmail />. See the <PrivacyLink /> for what we delete.</p>,
    },
    {
      heading: "Changes and contact",
      body: <p>We will text you about material changes before they take effect. Questions: <SupportEmail />.</p>,
    },
  ],
};
