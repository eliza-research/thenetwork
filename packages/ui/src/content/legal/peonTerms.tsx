// spec/sitePages.md, "The terms name the join page as a way to opt in only where the site serves it"
import type { LegalText } from "./types.ts";
import { Link } from "../../components/Link.tsx";
import { PrivacyLink, SupportEmail } from "./parts.tsx";

/** The terms of peon.biz. peon.biz keeps its join page, so a person opts in there or by text. */
export const peonTerms: LegalText = {
  title: "Terms of service",
  effective: "Effective October 8, 2026.",
  intro: 'These terms cover your use of peon.biz, operated by Eliza Research Corporation ("we"). When you join, you agree to them.',
  sections: [
    {
      heading: "Who can join",
      body: <p>You must be 13 or older to join. Only adults 18 and older are matched or introduced. Members aged 13 to 17 are never matched for work. People under 18 receive no introductions through this app. Give your real first name and your real birth date or age, and keep your phone number current. One person, one membership.</p>,
    },
    {
      sms: {
        heading: "Text messaging terms",
        lead: "peon.biz works by text.",
        optIn: {
          label: <strong>How you opt in:</strong>,
          ways: {
            OptInOnJoinPage: <>on the <Link href="/join">join page</Link>, you enter your number, confirm it with a code, and tick a box that says: "I agree to receive recurring text messages from peon.biz at this number: questions about work or hiring, waitlist updates, introductions I agree to, and scheduling reminders. Message frequency varies. Message and data rates may apply. Reply STOP to stop and HELP for help. Consent is not a condition of any purchase." We record that wording with the date and time.</>,
            OptInByText: <>You can also opt in by text: send <strong>peon</strong> or <strong>peon.biz</strong> as your first message to our number. We record that message as your opt-in.</>,
          },
        },
        optInNote: <strong>Consent is not a condition of any purchase.</strong>,
        items: {
          SmsProgram: <><strong>Program:</strong> peon.biz sends conversational text messages (SMS and iMessage): questions about the work you want or the role you are filling, waitlist updates, introductions you agree to, interview scheduling and reminders.</>,
          SmsFrequency: <><strong>Frequency:</strong> message frequency varies with how you use peon.biz. Unprompted messages are limited (two a week by default), and we do not text during quiet hours in your time zone.</>,
          SmsStopEverything: <><strong>Stop:</strong> reply <strong>STOP</strong> to stop every text from our number, for peon.biz and every other app on the same number. You get one confirmation and nothing else.</>,
          SmsLeaveOne: <><strong>Leave:</strong> to stop peon.biz only, text <strong>leave peon.biz</strong>.</>,
          SmsStartAgain: <><strong>Start again:</strong> reply <strong>START</strong>.</>,
          SmsHelp: <><strong>Help:</strong> reply <strong>HELP</strong>, or email <SupportEmail />.</>,
          SmsCosts: <><strong>Costs:</strong> message and data rates may apply. Carriers are not liable for delayed or undelivered messages.</>,
          SmsNoMarketingShare: <><strong>Privacy:</strong> Mobile numbers and opt-in data are not shared with third parties or affiliates for marketing. See the <PrivacyLink />.</>,
        },
      },
    },
    {
      heading: "Hiring",
      body: <p>You can join peon.biz now. Introductions have not started yet. When they start, peon.biz suggests introductions. It does not make hiring decisions, it is not an employer, and it is not an employment agency. Teams that hire are responsible for following employment law. Software only suggests. A person reviews every introduction. We never charge candidates a fee.</p>,
    },
    {
      heading: "Acceptable use",
      body: <p>Do not harass, deceive, spam or sell to other members. Do not try to get information about other members that they did not share with you. We may pause or remove a member who breaks these rules or puts others at risk.</p>,
    },
    {
      heading: "The service",
      body: <p>peon.biz is new and provided as it is. Features may change. Suggestions come from software and from people, so they can be wrong. To the extent the law allows, we are not liable for indirect or consequential damages from your use of peon.biz or from meetings with other members.</p>,
    },
    {
      heading: "Leaving",
      body: <p>You can stop this app at any time by texting "leave peon.biz". For deletion, email <SupportEmail />. See the <PrivacyLink /> for what we delete.</p>,
    },
    {
      heading: "Changes and contact",
      body: <p>We will text you about material changes before they take effect. Questions: <SupportEmail />.</p>,
    },
  ],
};
