import { defaultApps, type McpApp } from "../apps.ts";
import { codePage, consentPage, consentsPage, messagePage, type MessageTitle, phonePage, signupPage } from "../pages.ts";
import { SCOPES, type Grant } from "../store.ts";

/** A connector page with fictional data, named for the design preview. */
export interface SamplePage { name: string; render: (app: McpApp) => Response }

const grant = (id: string, clientName: string | null): Grant & { clientName: string | null } =>
  ({ id, clientName, createdAt: Date.UTC(2026, 9, 19), scopes: [...SCOPES] }) as Grant & { clientName: string | null };

const titles: MessageTitle[] = [
  "This link does not work", "Too many tries", "Not available", "This page has expired", "Already signed in",
  "We need to check this number", "Connect again", "Please try again", "Sign-in unavailable", "Not allowed", "Sign in first",
];

/** Each view and field error that the handler can send, with fictional data. */
export const samplePages: SamplePage[] = [
  { name: "Phone", render: app => phonePage(app, "preview") },
  { name: "Phone: number not valid", render: app => phonePage(app, "preview", { error: "Enter a US or Canada phone number." }) },
  { name: "Phone: security check", render: app => phonePage(app, "preview", { turnstileSiteKey: "preview", error: "Please complete the check and try again." }) },
  { name: "Code", render: app => codePage(app, "preview", "0123") },
  { name: "Code: not accepted", render: app => codePage(app, "preview", "0123", { error: "That code did not work. Check the newest text and try again." }) },
  { name: "Consent", render: app => consentPage(app, "preview", "Your assistant", "assistant.example", "https://assistant.example", [...SCOPES]) },
  { name: "Consent: finish signup", render: app => consentPage(app, "preview", "Your assistant", "assistant.example", "https://assistant.example", [...SCOPES], { canSignup: true }) },
  { name: "Signup", render: app => signupPage(app, "preview", {
    consent: { text: "I agree to receive recurring text messages. Reply STOP to stop and HELP for help.", version: "preview" },
    requiresInvitation: app.joinMode === "invite", signupView: "preview",
  }) },
  { name: "Consent: signup confirmed", render: app => consentPage(app, "preview", "Your assistant", "assistant.example", "https://assistant.example", [...SCOPES], { signupSaved: true, signupApproval: "preview" }) },
  { name: "Consent: unnamed, try again", render: app => consentPage(app, "preview", null, "assistant.example", "https://assistant.example", [...SCOPES], { unavailable: true }) },
  { name: "Connected assistants", render: app => consentsPage(app, [grant("grant_a", "Your assistant"), grant("grant_b", null)], ms => new Date(ms).toISOString().slice(0, 10)) },
  { name: "Connected assistants: confirm removal", render: app => consentsPage(app, [grant("grant_a", "Your assistant")], ms => new Date(ms).toISOString().slice(0, 10), { confirmation: { grantId: "grant_a", proof: "preview" } }) },
  { name: "Connected assistants: access removed", render: app => consentsPage(app, [], String, { removal: "Removed" }) },
  ...titles.map(title => ({ name: title, render: (app: McpApp) => messagePage(app, title, "Go back to the assistant and connect again.", 400, "/oauth/consents") })),
];

/** Every sample page for every app. */
export const allSamples = (): Array<{ app: McpApp; sample: SamplePage }> =>
  Object.values(defaultApps()).flatMap(app => samplePages.map(sample => ({ app, sample })));
