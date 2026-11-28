// GENERATED from spec/memberDomains.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Enable domains safely by brand and age / Each brand maps to its default set of domains (spec/memberDomains.md) */
export type Domain = "Dating" | "Friendship" | "Business";
/** Story: Enable domains safely by brand and age / Each brand maps to its default set of domains (spec/memberDomains.md) */
export type Brand = "NtwrkBrand" | "SlopBrand" | "PeonBrand" | "FriendsBrand";


/** Story: Enable domains safely by brand and age / Each brand maps to its default set of domains (spec/memberDomains.md) */
//@ pure
export function brandDefaultDomains(brand: Brand): Domain[] {
  return brand === "SlopBrand" ? (["Dating"] as Domain[]) : brand === "PeonBrand" ? (["Business"] as Domain[]) : brand === "FriendsBrand" ? (["Friendship"] as Domain[]) : (["Dating", "Friendship", "Business"] as Domain[]);
}

/** Story: Enable domains safely by brand and age / Age determines which domains a member may enable (spec/memberDomains.md) */
//@ pure
export function domainAllowedForAge(domain: Domain, age: number): boolean {
  return age < 13 ? false : (age >= 18 ? true : domain === "Friendship");
}

/** Story: Enable domains safely by brand and age / Age determines which domains a member may enable (spec/memberDomains.md) */
//@ pure
export function defaultDomainsForJoin(brand: Brand, age: number): Domain[] {
  return brandDefaultDomains(brand).filter((d: Domain) => domainAllowedForAge(d, age));
}

/** Story: Enable domains safely by brand and age / Age determines which domains a member may enable (spec/memberDomains.md) */
//@ pure
export function canEnableDomain(domain: Domain, age: number, banned: boolean, held: boolean): boolean {
  return !banned && !held && domainAllowedForAge(domain, age);
}

/** Story: Enable domains safely by brand and age / Age determines which domains a member may enable (spec/memberDomains.md) */
//@ pure
export function lawUnder13EmptyDefaults(brand: Brand, domain: Domain, age: number): boolean {
  //@ ensures \result === true
  return !(age < 13) || !defaultDomainsForJoin(brand, age).includes(domain);
}

/** Story: Enable domains safely by brand and age / Age determines which domains a member may enable (spec/memberDomains.md) */
//@ pure
export function lawUnder13CannotEnableAnyDomain(domain: Domain, age: number, banned: boolean, held: boolean): boolean {
  //@ ensures \result === true
  return !(age < 13) || !canEnableDomain(domain, age, banned, held);
}

/** Story: Enable domains safely by brand and age / Age determines which domains a member may enable (spec/memberDomains.md) */
//@ pure
export function lawMinorOnlyFriendship(domain: Domain, age: number, banned: boolean, held: boolean): boolean {
  //@ ensures \result === true
  return !(age >= 13 && age < 18 && canEnableDomain(domain, age, banned, held)) || domain === "Friendship";
}

/** Story: Enable domains safely by brand and age / Age determines which domains a member may enable (spec/memberDomains.md) */
//@ pure
export function lawMinorNeverDatingOrBusiness(age: number, banned: boolean, held: boolean): boolean {
  //@ ensures \result === true
  return !(age >= 13 && age < 18) || (!canEnableDomain("Dating", age, banned, held) && !canEnableDomain("Business", age, banned, held));
}

/** Story: Enable domains safely by brand and age / Age determines which domains a member may enable (spec/memberDomains.md) */
//@ pure
export function lawMinorDefaultsOnlyFriendship(brand: Brand, domain: Domain, age: number): boolean {
  //@ ensures \result === true
  return !(age >= 13 && age < 18 && defaultDomainsForJoin(brand, age).includes(domain)) || domain === "Friendship";
}

/** Story: Enable domains safely by brand and age / Age determines which domains a member may enable (spec/memberDomains.md) */
//@ pure
export function lawBannedOrHeldCannotEnable(domain: Domain, age: number, banned: boolean, held: boolean): boolean {
  //@ ensures \result === true
  return !(banned || held) || !canEnableDomain(domain, age, banned, held);
}

/** Story: Enable domains safely by brand and age / Photos apply only to adult dating and the business firewall applies only to business (spec/memberDomains.md) */
//@ pure
export function domainAllowsPhotos(domain: Domain, age: number): boolean {
  return domain === "Dating" && age >= 18;
}

/** Story: Enable domains safely by brand and age / Photos apply only to adult dating and the business firewall applies only to business (spec/memberDomains.md) */
//@ pure
export function domainRequiresBusinessFirewall(domain: Domain): boolean {
  return domain === "Business";
}

/** Story: Enable domains safely by brand and age / Photos apply only to adult dating and the business firewall applies only to business (spec/memberDomains.md) */
//@ pure
export function lawMinorNeverPhotos(domain: Domain, age: number): boolean {
  //@ ensures \result === true
  return !(age < 18) || !domainAllowsPhotos(domain, age);
}

/** Story: Enable domains safely by brand and age / Photos apply only to adult dating and the business firewall applies only to business (spec/memberDomains.md) */
//@ pure
export function lawPhotosOnlyAdultDating(domain: Domain, age: number): boolean {
  //@ ensures \result === true
  return domainAllowsPhotos(domain, age) === (domain === "Dating" && age >= 18);
}

/** Story: Enable domains safely by brand and age / Photos apply only to adult dating and the business firewall applies only to business (spec/memberDomains.md) */
//@ pure
export function lawBusinessFirewallStrict(domain: Domain): boolean {
  //@ ensures \result === true
  return domainRequiresBusinessFirewall(domain) === (domain === "Business");
}
