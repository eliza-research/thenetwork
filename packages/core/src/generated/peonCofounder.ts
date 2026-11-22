// GENERATED from spec/peonCofounder.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny



/** Story: Meet another member who wants a cofounder / Two eligible peers must share a home market (spec/peonCofounder.md) */
//@ pure
export function peonCofounderMayProfile(appMember: boolean, jobSeat: boolean, currentIntent: boolean, professionalOptIn: boolean, acceptsOneToOne: boolean, contactOpen: boolean, noOpenOpportunity: boolean): boolean {
  return appMember && !jobSeat && currentIntent && professionalOptIn && acceptsOneToOne && contactOpen && noOpenOpportunity;
}

/** Story: Meet another member who wants a cofounder / Two eligible peers must share a home market (spec/peonCofounder.md) */
//@ pure
export function peonCofounderMayPair(firstEligible: boolean, secondEligible: boolean, sameMarket: boolean): boolean {
  return firstEligible && secondEligible && sameMarket;
}

/** Story: Meet another member who wants a cofounder / Two eligible peers must share a home market (spec/peonCofounder.md) */
//@ pure
export function lawCofounderRequiresTwoEligiblePeers(appMember: boolean, jobSeat: boolean, currentIntent: boolean, professionalOptIn: boolean, acceptsOneToOne: boolean, contactOpen: boolean, noOpenOpportunity: boolean, secondEligible: boolean, sameMarket: boolean): boolean {
  //@ ensures \result === true
  return !peonCofounderMayPair(peonCofounderMayProfile(appMember, jobSeat, currentIntent, professionalOptIn, acceptsOneToOne, contactOpen, noOpenOpportunity), secondEligible, sameMarket) || (appMember && !jobSeat && currentIntent && professionalOptIn && acceptsOneToOne && contactOpen && noOpenOpportunity && secondEligible && sameMarket);
}
