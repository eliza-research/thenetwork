// spec/brandIdentity.md, "ntwrk.party names no app on its landing page, its not-found page or its own skill"
import type { LegalText } from "./types.ts";
import { SupportEmail } from "./parts.tsx";

/** The privacy policy of The Network. */
export const ntwrkPrivacy: LegalText = {
  title: "Privacy policy",
  effective: "Effective October 7, 2026",
  intro: "The Network learns what you tell it so it can introduce you to people and plans that fit. This policy explains what we collect, how we use it, who can see it, and the choices you have. In short: you decide what other people see, we never sell your data, and you can export or delete it at any time.",
  sections: [
    {
      heading: "What we collect",
      body: (
        <>
          <ul>
            <li><strong>Your phone number</strong> and the channel you use (iMessage or SMS), to verify you and to text you.</li>
            <li><strong>Your age</strong>. You type your birth date on the signup page, or you tell us your age. We count your age from the birth date and keep the age, not the birth date. We use it only to apply the age rules: who can join, and that members under 18 are never matched on dates or for work. Other members never see it.</li>
            <li><strong>What you tell The Network</strong> in conversation: your interests, what you're looking for, your availability, your city and neighbourhood, and your preferences about how often to hear from us.</li>
            <li><strong>What you choose to share from elsewhere</strong>, such as profile text you paste, a summary from your AI assistant, or calendar free/busy times if you connect a calendar. We read free/busy only, never event details.</li>
            <li><strong>Vouch notes</strong> written by the member who invited you. They are not used for matching until you accept, and are deleted if you decline or after 30 days.</li>
            <li><strong>Activity</strong>: introductions and plans offered, accepted or declined, attendance, and feedback you give after meeting someone.</li>
          </ul>
          <p>We do not collect device location. We do not build profiles of people who aren't members, including people you mention to us.</p>
        </>
      ),
    },
    {
      heading: "How we use it",
      body: (
        <ul>
          <li>To find and propose introductions, small groups, events and help that fit what you asked for.</li>
          <li>To relay messages between members, schedule plans, send reminders, and ask how things went.</li>
          <li>To keep members safe: handling reports and blocks, and preventing spam and abuse.</li>
          <li>To improve matching, using outcomes such as accepted introductions and feedback.</li>
        </ul>
      ),
    },
    {
      heading: "Who can see what",
      body: (
        <>
          <p>Everything you share has a privacy scope:</p>
          <ul>
            <li><strong>Private to your agent</strong>: helps The Network understand you, but is never shown or hinted to anyone else.</li>
            <li><strong>Matchable</strong>: used to find good fits, but never quoted or disclosed.</li>
            <li><strong>Shareable</strong>: may be mentioned to someone you're being introduced to, when relevant.</li>
          </ul>
          <p>Every outgoing message is checked automatically for anything that would reveal a private fact. Other members see only a coarse area, such as a neighbourhood or a travel time, never your exact location. Your phone number is shared with another member only when you both agree to swap contacts.</p>
          <p>During our early pilot, a small team reviews proposed introductions before they are sent. Reviewers see the information needed to judge the fit, with phone numbers and other direct identifiers removed.</p>
        </>
      ),
    },
    {
      heading: "Service providers",
      body: <p>We use service providers to run The Network: messaging providers (for iMessage and SMS delivery), cloud hosting and database providers, and AI model providers that process message text to understand requests and draft replies. They process data only on our instructions. We do not sell your personal information. <strong>Mobile numbers and opt-in data are not shared with third parties or affiliates for marketing.</strong></p>,
    },
    {
      heading: "Retention and deletion",
      body: <p>You can ask The Network to show you what it knows about you, correct it, export it, or delete your account, by text or by emailing <SupportEmail />. Deletion removes your profile, facts, messages and derived matching data. Deleted data is removed from storage within 24 hours and from encrypted backups when they expire, within 30 days. We keep a minimal record that an account was deleted, and any records we're legally required to keep.</p>,
    },
    {
      heading: "Your rights",
      body: <p>Depending on where you live, including California (CCPA/CPRA), you may have rights to know, access, correct, delete and port your data, and to opt out of sale or sharing (we don't sell or share). We won't treat you differently for using these rights. Contact <SupportEmail />.</p>,
    },
    {
      heading: "Members under 18",
      body: <p>The Network is not for children under 13. Members aged 13 to 17 can use The Network for their own help and recommendations: answers, public events and plans for themselves. They are never matched on dates or for work. Today, no member under 18 is introduced to anyone. If introductions ever open to members under 18, they will be friendship introductions only, with people within 2 years of their own age. We ask for your birth date or your age at signup to apply these rules.</p>,
    },
    {
      heading: "Security",
      body: <p>Data is encrypted in transit and at rest, staff access is limited and logged, and we review security regularly. If a breach affects your data, we'll notify you as the law requires.</p>,
    },
    {
      heading: "Changes",
      body: <p>If we make material changes, we'll tell you by text before they take effect.</p>,
    },
  ],
};
