// spec/landingEntry.md, "The landing page shows the brand, the prompt, the agents, the Messages entry, the status line and two legal links"
import { renderToString } from "react-dom/server";
import { JoinView, LandingView, landingLinks } from "@thenetwork/ui";
import { type AppKey, brandFor } from "../../../packages/core/src/generated/brandIdentity.ts";
import type { JoinPage } from "../../../packages/core/src/generated/browserJoin.ts";
import type { Landing } from "../../../packages/core/src/generated/landingEntry.ts";

const ignore = () => {};

/** The landing view of one site in a given landing state, as the page script shows it after the state changed. */
export function renderLanding(app: AppKey, state: Landing, options: { skillVersion: string; textLine: string }): string {
  const brand = brandFor(app);
  return renderToString(
    <LandingView
      brand={brand}
      links={landingLinks(app, options)}
      state={state}
      onCopy={ignore}
      onChooseAgent={ignore}
      onChooseMessages={ignore}
    />,
  );
}

/** The join view in a given join state, with no request running. */
export function renderJoin(page: JoinPage, options: { consentText: string; minJoinAge: number; siteKey: string; homeLabel: string }): string {
  return renderToString(
    <JoinView
      page={page}
      values={{ firstName: "", birthdate: "", consent: false }}
      phone=""
      code=""
      phoneShown=""
      firstName=""
      minJoinAge={options.minJoinAge}
      failure={undefined}
      checkRound={0}
      siteKey={options.siteKey}
      onPhoneChange={ignore}
      onSubmitPhone={ignore}
      onCodeChange={ignore}
      onSubmitCode={ignore}
      onResend={ignore}
      onChangeNumber={ignore}
      onContinueWithPhone={ignore}
      onValuesChange={ignore}
      onSubmitProfile={ignore}
      onCheckPassed={ignore}
      onCheckFailed={ignore}
      onCheckExpired={ignore}
      consentText={options.consentText}
      homeLabel={options.homeLabel}
    />,
  );
}
