# Brand identity

Four public sites share one backend: ntwrk.party (The Network), slop.date, peon.biz and friends.help. This spec owns the brand data of each site and the rules that keep each brand separate. The landing page and the page set ([landing entry](./landingEntry.md), [site pages](./sitePages.md)) read their brand data from here. The site build, the shared React components and the platform app registry own the files, the markup and the text messages.

## Story: Know which app I am joining

> As a person who opens one of the sites, I want the name, domain, logo, color and headline to tell me which app I am joining, so that I give my number to the app that I chose.

### Each site has one brand record with its name, domain, app, keyword, join mode, accent, logo and headline

The brand record is the only data that differs between the four sites. The name is the text in the header mark and the title of the landing page. The other pages put the name after the page name in their titles. The keyword is the word that joins the app on the shared text line. The headline has three parts: the text before the highlighted word, the highlighted word, and the text after it. The skill name is the folder of the app's agent skill.

```quint
type AppKey = Ntwrk | Slop | Peon | Friends
type JoinMode = InviteOnly | OpenJoin
type Accent = Black | Chartreuse | Orange | Green
type LogoMark = GraphMark | HeartMark | NecktieMark | TwoCirclesMark
type Brand = {
  app: AppKey,
  name: str,
  domain: str,
  keyword: str,
  joinMode: JoinMode,
  accent: Accent,
  logo: LogoMark,
  headlineLead: str,
  headlineMark: str,
  headlineTail: str,
  skillName: str,
}

pure val appKeys: List[AppKey] = List(Ntwrk, Slop, Peon, Friends)
pure val joinModes: List[JoinMode] = List(InviteOnly, OpenJoin)
pure val accents: List[Accent] = List(Black, Chartreuse, Orange, Green)
pure val logoMarks: List[LogoMark] = List(GraphMark, HeartMark, NecktieMark, TwoCirclesMark)

pure val ntwrkBrand: Brand = {
  app: Ntwrk, name: "The Network", domain: "ntwrk.party", keyword: "network", joinMode: InviteOnly,
  accent: Black, logo: GraphMark, headlineLead: "Build your ", headlineMark: "network", headlineTail: ".",
  skillName: "ntwrk-party",
}
pure val slopBrand: Brand = {
  app: Slop, name: "slop.date", domain: "slop.date", keyword: "slop", joinMode: OpenJoin,
  accent: Chartreuse, logo: HeartMark, headlineLead: "Let your agent find you the perfect ", headlineMark: "date", headlineTail: ".",
  skillName: "slop-date",
}
pure val peonBrand: Brand = {
  app: Peon, name: "peon.biz", domain: "peon.biz", keyword: "peon", joinMode: OpenJoin,
  accent: Orange, logo: NecktieMark, headlineLead: "Let your agent find you the perfect ", headlineMark: "job", headlineTail: ".",
  skillName: "peon-biz",
}
pure val friendsBrand: Brand = {
  app: Friends, name: "friends.help", domain: "friends.help", keyword: "friends", joinMode: OpenJoin,
  accent: Green, logo: TwoCirclesMark, headlineLead: "Let your agent find your best ", headlineMark: "friends", headlineTail: ".",
  skillName: "friends-help",
}

pure def brandFor(app: AppKey): Brand =
  if (app == Ntwrk) ntwrkBrand
  else if (app == Slop) slopBrand
  else if (app == Peon) peonBrand
  else friendsBrand

pure def lawBrandNamesItsApp(app: AppKey): bool = brandFor(app).app == app
```

### Two sites never share a name, domain, keyword, accent, logo or skill

A person can tell the sites apart by each item of the brand. The shared text line can route a first message by its keyword to one app only.

```quint
pure def lawBrandsAreDistinct(a: AppKey, b: AppKey): bool =
  val x = brandFor(a)
  val y = brandFor(b)
  a != b implies (
    x.name != y.name and x.domain != y.domain and x.keyword != y.keyword and
    x.accent != y.accent and x.logo != y.logo and x.skillName != y.skillName
  )
```

### Only The Network asks for an invitation

ntwrk.party is invite-only. slop.date, peon.biz and friends.help are open to every person who is old enough to join.

```quint
pure def lawOnlyTheNetworkIsInviteOnly(app: AppKey): bool =
  (brandFor(app).joinMode == InviteOnly) iff (app == Ntwrk)
```

### Each accent has one color for light mode and one for dark mode

The accent fills the highlighted word of the headline and the Copy button, and it is the theme color of the browser. The ink color is the text color on the accent. The Network and friends.help change the accent in dark mode. slop.date and peon.biz use their bright color as the accent in dark mode only. In light mode their accent is the dark ink and the bright color is the text on it, because the bright color on the light page does not meet the WCAG AA contrast ratio of 3:1 for controls. The design-system tokens `primary` and `primary-foreground` of each brand have these values.

```quint
type AccentTokens = { light: str, lightInk: str, dark: str, darkInk: str }

pure def accentTokens(accent: Accent): AccentTokens =
  if (accent == Black) { light: "oklch(0.16 0 0)", lightInk: "oklch(0.985 0 0)", dark: "oklch(0.96 0 0)", darkInk: "oklch(0.15 0 0)" }
  else if (accent == Chartreuse) { light: "oklch(0.2 0.04 118)", lightInk: "oklch(0.91 0.2 118)", dark: "oklch(0.91 0.2 118)", darkInk: "oklch(0.2 0.04 118)" }
  else if (accent == Orange) { light: "oklch(0.2 0.04 62)", lightInk: "oklch(0.78 0.16 62)", dark: "oklch(0.78 0.16 62)", darkInk: "oklch(0.2 0.04 62)" }
  else { light: "oklch(0.5 0.13 150)", lightInk: "oklch(0.985 0 0)", dark: "oklch(0.72 0.17 150)", darkInk: "oklch(0.17 0.04 150)" }

pure def lawAccentInkDiffersFromAccent(accent: Accent): bool =
  val t = accentTokens(accent)
  t.light != t.lightInk and t.dark != t.darkInk
```

## Story: Each site keeps its own brand

> As a person who uses one app, I want its site to show only that app, so that no site tells anyone which other apps my number uses.

### An app site never names The Network or another app

slop.date, peon.biz and friends.help name only themselves on every page, in the agent skill and in the skill catalog. There are three exceptions. The support address help@ntwrk.party can show on every surface, because it is the only inbox that receives mail. The agent skill of an app can also name the connector endpoint of that app, because ntwrk.party serves the connector of every app ([agent entry](./agentEntry.md)). The full endpoint is `https://ntwrk.party/mcp/<app>`. Peon and friends also have a public ChatGPT endpoint at `https://ntwrk.party/mcp/<app>/openai`. Slop has no public ChatGPT endpoint. The agent skill of an app can also name the page where the person sees and removes the access of an agent, `https://ntwrk.party/oauth/consents`, because the person gives that access on ntwrk.party. The skill names only the endpoint of its own app, and it does not name The Network in other words. The skill of The Network names its own endpoint, `https://ntwrk.party/mcp`.

```quint
type Surface = LandingSurface | LegalSurface | NotFoundSurface | JoinSurface | SkillSurface | CatalogSurface

pure val supportEmail = "help@ntwrk.party"

pure val agentAccessPage = "https://ntwrk.party/oauth/consents"

pure def connectorEndpoint(app: AppKey): str =
  if (app == Ntwrk) "https://ntwrk.party/mcp"
  else if (app == Slop) "https://ntwrk.party/mcp/slop"
  else if (app == Peon) "https://ntwrk.party/mcp/peon"
  else "https://ntwrk.party/mcp/friends"

pure def openaiConnectorEndpoint(app: AppKey): str =
  if (app == Ntwrk) "https://ntwrk.party/mcp/openai"
  else if (app == Slop) ""
  else if (app == Peon) "https://ntwrk.party/mcp/peon/openai"
  else "https://ntwrk.party/mcp/friends/openai"

pure def hubTextsOnAppSurface(site: AppKey, surface: Surface): List[str] =
  if (surface != SkillSurface) List(supportEmail)
  else if (openaiConnectorEndpoint(site) == "") List(supportEmail, agentAccessPage, connectorEndpoint(site))
  else List(supportEmail, agentAccessPage, openaiConnectorEndpoint(site), connectorEndpoint(site))

pure def lawAppEndpointsAreDistinct(a: AppKey, b: AppKey): bool =
  a != b implies (connectorEndpoint(a) != connectorEndpoint(b) and openaiConnectorEndpoint(a) != openaiConnectorEndpoint(b)
    and connectorEndpoint(a) != openaiConnectorEndpoint(b))

pure def lawOnlyTheSkillNamesTheEndpoint(site: AppKey, surface: Surface): bool =
  surface != SkillSurface implies hubTextsOnAppSurface(site, surface) == List(supportEmail)

pure def mayName(site: AppKey, named: AppKey, surface: Surface): bool =
  site == named or (site == Ntwrk and (surface == LegalSurface or surface == CatalogSurface))

pure def lawAppSiteNeverNamesTheNetwork(site: AppKey, surface: Surface): bool =
  site != Ntwrk implies not(mayName(site, Ntwrk, surface))

pure def lawAppSiteNamesNoOtherApp(site: AppKey, named: AppKey, surface: Surface): bool =
  (site != Ntwrk and named != site) implies not(mayName(site, named, surface))
```

### ntwrk.party names no app on its landing page, its not-found page or its own skill

The landing page of The Network names no app. Only its legal pages and its skill catalog list the apps: the text messaging terms tell a person that STOP stops every app on the number, and the catalog lists the skill of each app.

```quint
pure def lawHubLandingNamesNoApp(named: AppKey, surface: Surface): bool =
  (named != Ntwrk and surface != LegalSurface and surface != CatalogSurface) implies not(mayName(Ntwrk, named, surface))
```

## Story: One component set for every brand

> As the owner of the four sites, I want every site to use the same components with different brand data, so that a fix or a design change reaches all four sites at the same time.

### Every site uses the same parts, and only peon.biz adds the browser join flow

The four sites use the same header mark, headline, prompt field, agent row, Messages entry, status line, footer, legal text and not-found notice. Each part, the logo included, gets its brand only from the brand record and the accent tokens of the site's brand. Every part of one site takes the same accent tokens, and no part holds a color of its own for one brand. peon.biz is the only site that keeps a browser join flow.

```quint
type SharedPart = PartMark | PartHeadline | PartPrompt | PartAgentRow | PartMessages | PartStatus |
  PartFooter | PartLegalText | PartNotFound | PartJoinFlow

pure def siteUsesPart(app: AppKey, part: SharedPart): bool = part != PartJoinFlow or app == Peon

pure def lawSitesShareParts(a: AppKey, b: AppKey, part: SharedPart): bool =
  siteUsesPart(a, part) != siteUsesPart(b, part) implies (part == PartJoinFlow and (a == Peon or b == Peon))

pure def partTokens(app: AppKey, part: SharedPart): AccentTokens = accentTokens(brandFor(app).accent)

pure def lawPartsTakeTheBrandTokens(app: AppKey, part: SharedPart, other: SharedPart): bool =
  partTokens(app, part) == partTokens(app, other) and partTokens(app, part) == accentTokens(brandFor(app).accent)
```
