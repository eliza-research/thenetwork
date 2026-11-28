# Member domains

One member account can enable one or more relationship domains: `Dating`, `Friendship`, and `Business`. Brands (`NtwrkBrand`, `SlopBrand`, `PeonBrand`, `FriendsBrand`) are entry doors that set default domains at join time. Age eligibility, photo permission, and the business firewall depend on the domain and the member's age.

The platform shell stores enabled domains per person in `platform.member_domains` and checks these generated decisions before enabling a domain, collecting photos, or sharing data across the business firewall.

## Story: Enable domains safely by brand and age

> As a member joining through any brand door, I want only age-appropriate domains enabled by default, and I want domain toggles, photos, and business data isolation to follow strict age and domain rules.

### Each brand maps to its default set of domains

Slop defaults to Dating. Peon defaults to Business. Friends defaults to Friendship. The Network defaults to Dating, Friendship, and Business.

```quint
type Domain = Dating | Friendship | Business
type Brand = NtwrkBrand | SlopBrand | PeonBrand | FriendsBrand

pure def brandDefaultDomains(brand: Brand): Set[Domain] =
  match brand {
    | SlopBrand => Set(Dating)
    | PeonBrand => Set(Business)
    | FriendsBrand => Set(Friendship)
    | NtwrkBrand => Set(Dating, Friendship, Business)
  }
```

### Age determines which domains a member may enable

A person under 13 cannot enable any domain and gets an empty default domain set at join. A minor aged 13 through 17 can only enable Friendship; Dating and Business stay unavailable. An adult aged 18 or older may enable any domain. Default domains at join filter the brand defaults by age eligibility. A banned or held member cannot enable any domain.

```quint
pure val ageValues = Set(-1, 0, 12, 13, 15, 17, 18, 25, 65)

pure def domainAllowedForAge(domain: Domain, age: int): bool =
  if (age < 13) false
  else if (age >= 18) true
  else domain == Friendship

pure def defaultDomainsForJoin(brand: Brand, age: int): Set[Domain] =
  brandDefaultDomains(brand).filter(d => domainAllowedForAge(d, age))

pure def canEnableDomain(domain: Domain, age: int, banned: bool, held: bool): bool =
  not(banned) and not(held) and domainAllowedForAge(domain, age)

pure def lawUnder13EmptyDefaults(brand: Brand, domain: Domain, age: int): bool =
  age < 13 implies not(defaultDomainsForJoin(brand, age).contains(domain))

pure def lawUnder13CannotEnableAnyDomain(domain: Domain, age: int, banned: bool, held: bool): bool =
  age < 13 implies not(canEnableDomain(domain, age, banned, held))

pure def lawMinorOnlyFriendship(domain: Domain, age: int, banned: bool, held: bool): bool =
  (age >= 13 and age < 18 and canEnableDomain(domain, age, banned, held)) implies domain == Friendship

pure def lawMinorNeverDatingOrBusiness(age: int, banned: bool, held: bool): bool =
  (age >= 13 and age < 18) implies (
    not(canEnableDomain(Dating, age, banned, held)) and not(canEnableDomain(Business, age, banned, held))
  )

pure def lawMinorDefaultsOnlyFriendship(brand: Brand, domain: Domain, age: int): bool =
  (age >= 13 and age < 18 and defaultDomainsForJoin(brand, age).contains(domain)) implies domain == Friendship

pure def lawBannedOrHeldCannotEnable(domain: Domain, age: int, banned: bool, held: bool): bool =
  (banned or held) implies not(canEnableDomain(domain, age, banned, held))
```

### Photos apply only to adult dating and the business firewall applies only to business

Photos and looks ratings are allowed only in the Dating domain for adults aged 18 or older. Minors never get photos in any domain. The business data firewall applies strictly to the Business domain.

```quint
pure def domainAllowsPhotos(domain: Domain, age: int): bool =
  domain == Dating and age >= 18

pure def domainRequiresBusinessFirewall(domain: Domain): bool =
  domain == Business

pure def lawMinorNeverPhotos(domain: Domain, age: int): bool =
  age < 18 implies not(domainAllowsPhotos(domain, age))

pure def lawPhotosOnlyAdultDating(domain: Domain, age: int): bool =
  domainAllowsPhotos(domain, age) iff (domain == Dating and age >= 18)

pure def lawBusinessFirewallStrict(domain: Domain): bool =
  domainRequiresBusinessFirewall(domain) iff domain == Business
```
