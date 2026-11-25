// spec/brandIdentity.md, "An app site never names The Network or another app"
import type { LegalText } from "./types.ts";
import { SupportEmail } from "./parts.tsx";

/** The privacy policy of friends.help. */
export const friendsPrivacy: LegalText = {
  title: "Privacy policy",
  effective: "Effective October 8, 2026.",
  intro: "friends.help offers friend-finding by text: small groups and plans at public places. Only adults 18 and older are matched or put in groups. This policy says what we collect, how we use it, who can see it, and what you can do about it.",
  sections: [
    {
      heading: "What we collect",
      body: (
        <>
          <ul>
            <li><strong>Your phone number</strong>, to check that it is yours and to text you.</li>
            <li><strong>Your age</strong>. You type your birth date on the signup page, or you tell us your age. We count your age from the birth date and keep the age, not the birth date. We use it only to apply the age rules: who can join, and that members under 18 are never matched on dates or for work. Other members never see it.</li>
            <li><strong>Your short profile</strong>: first name, area (neighbourhood or ZIP code), interests and one line about you.</li>
            <li><strong>What you tell the friends.help agent</strong> by text.</li>
            <li><strong>Plans and availability</strong>: the kinds of plans you like, the times you are usually free, and plans you accepted or skipped.</li>
            <li><strong>Activity</strong>: introductions or plans offered, accepted or declined, and feedback you give.</li>
            <li><strong>Your consent</strong>: the exact opt-in wording you agreed to, with the date and time.</li>
          </ul>
          <p>We do not collect device location. We do not build profiles of people who are not members.</p>
        </>
      ),
    },
    {
      heading: "How we use it",
      body: (
        <ul>
          <li>To invite you to small group plans at public places that fit what you like and when you are free.</li>
          <li>To text you, relay messages, and send reminders you asked for.</li>
          <li>To keep members safe: reports, blocks, and stopping spam and abuse.</li>
        </ul>
      ),
    },
    {
      heading: "Who can see what",
      body: <p>Other members see only what you agree to share, and only a coarse area, never your exact location. Your phone number is shared with another member only when you both agree. A small team reviews introductions before we send them. Reviewers see what they need to judge the fit, without your phone number.</p>,
    },
    {
      heading: "Kept apart from our other services",
      body: <p>Eliza Research Corporation runs more than one service. Your friends.help data stays in friends.help. We do not use it in another service. We never tell anyone whether a phone number uses another of our services. If you block someone, we block them for you in every service we run. Your age is one fact about you: if you give different ages, we use the lowest one.</p>,
    },
    {
      heading: "Service providers",
      body: <p>We use messaging providers, cloud hosting and database providers, and AI model providers that process message text. They process data only on our instructions. We do not sell your personal information. <strong>Mobile numbers and opt-in data are not shared with third parties or affiliates for marketing.</strong></p>,
    },
    {
      heading: "Your choices",
      body: (
        <>
          <ul>
            <li><strong>Export</strong> this site's data about you by emailing <SupportEmail />.</li>
            <li><strong>Stop messages</strong> by replying STOP.</li>
            <li><strong>Leave friends.help</strong> by texting "leave friends.help" to stop this app. To delete your profile, messages and matching data, email <SupportEmail />.</li>
            <li><strong>Request deletion</strong> by emailing <SupportEmail />. We delete all data tied to your phone number in every service we run. We keep a scrambled one-way copy of the number so that we never text it again, and records the law requires us to keep.</li>
          </ul>
          <p>We delete data from storage within 24 hours, and from encrypted backups when they expire, within 30 days. Depending on where you live, including California and New York, you may have more rights. We will not treat you differently for using them. Email <SupportEmail />.</p>
        </>
      ),
    },
    {
      heading: "Age",
      body: <p>You must be 13 or older to join. Members aged 13 to 17 can use the agent for their own ideas, questions, public events and plans. They are never matched on dates or for work. On friends.help, members aged 13 to 17 receive friendship introductions only, to people aged 13 to 18 born at most 2 years apart, after an automatic check approves each one. We ask for your birth date or your age at signup to apply these rules. If you tell us different ages, we use the lowest one. We do not knowingly collect data from children under 13; if we learn of any, we delete it.</p>,
    },
    {
      heading: "Security and changes",
      body: <p>We encrypt data in transit and at rest, and we limit and log staff access. If a breach affects your data, we will tell you as the law requires. We will text you before a material change to this policy takes effect.</p>,
    },
  ],
};
