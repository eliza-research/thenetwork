// spec/brandIdentity.md, "An app site never names The Network or another app"
import { supportEmail } from "../../../../core/src/generated/brandIdentity.ts";
import { Link } from "../../components/Link.tsx";

/** The support inbox, the one address every site names. */
export function SupportEmail() {
  return <Link href={`mailto:${supportEmail}`}>{supportEmail}</Link>;
}

/** A link to the privacy policy of the same site. */
export function PrivacyLink({ children = "privacy policy" }: { children?: string }) {
  return <Link href="/privacy">{children}</Link>;
}
