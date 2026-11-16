# Reach the agent experience

A person reaches the agent experience in four ways: the prompt on an app's landing page, a plugin in their agent, the agent skill catalog of a site, or a link in an update text. The landing page, its prompt and its agent tiles are in [landing entry](landingEntry.md). The skill files and the skill catalog of each site are in [site pages](sitePages.md). The brand data, with the skill name of each app, is in [brand identity](brandIdentity.md). The plugin build owns the plugin skill copies and their MCP endpoints. The notification service owns the update reference and the link in the text. The agent owns what it does with the skill ([agent signup](agentSignup.md)) and with the connector ([connector tools](connectorTools.md)). This spec models how each entry resolves to one app skill or to the updates tool. Public sites have no sign-in link, settings page or member dashboard.

The person's agent follows the text of the site prompt and of the app's SKILL.md. No code of this repository runs inside that agent. The plugin build calls `pluginListsSkill`, `pluginEndpoint` and `skillFor` when it writes the plugin skill copies. The site build checks the signup step markers of each SKILL.md against the [agent signup](agentSignup.md) model. No runtime code enforces the entry routes of this model, or `canSubmitProfile` and `canRequestNewCode` of the agent signup model, on the agent side. The connector server enforces its own rules on each tool call ([connector tools](connectorTools.md)).

## Story: Get from an app site or a text into my own agent

> As a person who found an app, I want one prompt or one link to open my own agent with the right app's skill, so that the agent can sign me up or show my update without a website account.

### The Claude plugin lists four skills and the OpenAI plugin lists three, never slop.date

The Claude plugin lists the skills of all four apps and connects each app to its own site endpoint, `https://<domain>/mcp`. The OpenAI plugin, for ChatGPT and Codex, lists the ntwrk.party, peon.biz and friends.help skills only. It connects to one endpoint, `https://ntwrk.party/mcp/openai`, and it has no endpoint for slop.date.

```quint
import brandIdentity.* from "./brandIdentity"

type Plugin = ClaudePlugin | OpenAiPlugin
type McpEndpoint = NoEndpoint | SiteEndpoint | OpenAiEndpoint

pure def pluginListsSkill(plugin: Plugin, app: AppKey): bool = plugin == ClaudePlugin or app != Slop

pure def pluginEndpoint(plugin: Plugin, app: AppKey): McpEndpoint =
  if (plugin == ClaudePlugin) SiteEndpoint
  else if (app == Slop) NoEndpoint
  else OpenAiEndpoint

pure def lawClaudePluginListsEverySkill(app: AppKey): bool =
  pluginListsSkill(ClaudePlugin, app) and pluginEndpoint(ClaudePlugin, app) == SiteEndpoint

pure def lawOpenAiPluginOmitsSlop(app: AppKey): bool =
  (pluginListsSkill(OpenAiPlugin, app) iff app != Slop) and
  ((pluginEndpoint(OpenAiPlugin, app) == NoEndpoint) iff app == Slop)
```

### The entry decides the route, and the agent loads only the app's own skill

The agent starts at the entry. A site prompt, a plugin skill and a catalog entry lead to the app's own skill, which is the skill with the app's skill name. The site prompt asks the agent to read the skill and follow it, so the agent starts signup. Another entry starts signup only when the person asks for it. Otherwise the agent explains the app and does not start signup. The OpenAI plugin has no route to slop.date. An update link leads to the connector's updates tool and loads no skill.

```quint
type EntryKind = NoEntry | FromSite | FromClaudePlugin | FromOpenAiPlugin | FromSkillCatalog | FromUpdateLink
type EntryPhase =
  NotArrived | InAgent | FollowingSkill | Explaining |
  UpdateShown | NothingNewShown | NeedsConnection | EntryRefused
type Route = SkillRoute | UpdatesRoute | NoRoute
type Entry = { phase: EntryPhase, entry: EntryKind, app: AppKey, skill: str }

pure val noSkill = ""
pure val initial: Entry = { phase: NotArrived, entry: NoEntry, app: Ntwrk, skill: noSkill }

pure def skillFor(app: AppKey): str = brandFor(app).skillName

pure def routeFor(entryKind: EntryKind, app: AppKey): Route =
  if (entryKind == NoEntry) NoRoute
  else if (entryKind == FromUpdateLink) UpdatesRoute
  else if (entryKind == FromOpenAiPlugin and app == Slop) NoRoute
  else SkillRoute

pure def canArrive(s: Entry, entryKind: EntryKind): bool = s.phase == NotArrived and entryKind != NoEntry

pure def arrive(s: Entry, entryKind: EntryKind, app: AppKey): Entry =
  { ...s, entry: entryKind, app: app, phase: InAgent }

pure def canResolveSkill(s: Entry): bool = s.phase == InAgent and routeFor(s.entry, s.app) != UpdatesRoute

pure def resolveSkill(s: Entry, wantsSignup: bool): Entry =
  if (routeFor(s.entry, s.app) == NoRoute) { ...s, phase: EntryRefused }
  else { ...s, skill: skillFor(s.app),
         phase: if (wantsSignup or s.entry == FromSite) FollowingSkill else Explaining }

pure def lawOpenAiPluginHasNoSlopRoute(entryKind: EntryKind): bool =
  (entryKind == FromOpenAiPlugin) implies routeFor(entryKind, Slop) == NoRoute

pure def lawRouteNeedsAPluginSkill(app: AppKey): bool =
  (routeFor(FromOpenAiPlugin, app) == SkillRoute) iff pluginListsSkill(OpenAiPlugin, app)

pure def alwaysStartHasNoEntry(s: Entry): bool = (s.phase == NotArrived) iff (s.entry == NoEntry)

pure def alwaysSkillOnlyAfterResolution(s: Entry): bool =
  (s.phase != FollowingSkill and s.phase != Explaining) implies s.skill == noSkill

pure def alwaysSkillMatchesApp(s: Entry): bool =
  (s.phase == FollowingSkill or s.phase == Explaining) implies s.skill == skillFor(s.app)

pure def alwaysOpenAiPluginNeverReachesSlop(s: Entry): bool =
  s.entry == FromOpenAiPlugin implies s.skill != skillFor(Slop)

pure def alwaysSitePromptStartsSignup(s: Entry): bool =
  s.entry == FromSite implies s.phase != Explaining
```

### An update reference shows only the person's own update on their own connection

An update link opens the agent with the prompt `Ask The Network for update T-7F3K9Q`. The reference is not a credential: the agent passes it to the updates tool on the person's own connection and never asks for it. Without a connection, the agent asks the person to sign in on the app's page and allow access. A reference of another person, or an unknown or expired one, shows nothing, the same as an empty inbox.

```quint
pure def canResolveUpdate(s: Entry): bool = s.phase == InAgent and routeFor(s.entry, s.app) == UpdatesRoute

pure def resolveUpdate(s: Entry, connected: bool, referenceOwn: bool): Entry =
  { ...s, phase: if (not(connected)) NeedsConnection else if (referenceOwn) UpdateShown else NothingNewShown }

pure def alwaysUpdatesOnlyFromReference(s: Entry): bool =
  (s.phase == UpdateShown or s.phase == NothingNewShown or s.phase == NeedsConnection) implies
    (s.entry == FromUpdateLink and s.skill == noSkill)

pure def stepUpdateShownOnlyByTheUpdatesTool(before: Entry, via: str, after: Entry): bool =
  (after.phase == UpdateShown and before.phase != UpdateShown) implies via == "resolveUpdate"
```

### An update text links to an assistant only when the person uses one

An update text carries only the reference, in the prompt `Ask The Network for update T-7F3K9Q`, and nothing else about the update. When the person uses no assistant that the service can link to (ChatGPT, Claude or Grok), the update itself goes in the text thread. On iMessage, the text links straight to the assistant with the prompt filled in. On SMS and Telegram, the text links to one ntwrk.party page with a button for each assistant. Each assistant link fills the prompt and never sends it: ChatGPT takes `?prompt=`, because its `?q=` sends the prompt at once on the web.

```quint
type Channel = IMessage | Sms | Telegram
type LinkedAssistant = ChatGptAssistant | ClaudeAssistant | GrokAssistant
type UpdateDelivery = InThread | AssistantLink | ButtonPage

pure val updatePromptLead = "Ask The Network for update "

pure def updateLinkTemplate(assistant: LinkedAssistant): str =
  if (assistant == ChatGptAssistant) "https://chatgpt.com/?prompt={q}"
  else if (assistant == ClaudeAssistant) "https://claude.ai/new?q={q}"
  else "https://grok.com/?q={q}"

pure def updateDeliveryFor(channel: Channel, assistantUsable: bool): UpdateDelivery =
  if (not(assistantUsable)) InThread
  else if (channel == IMessage) AssistantLink
  else ButtonPage

pure def lawNoAssistantMeansThread(channel: Channel): bool = updateDeliveryFor(channel, false) == InThread

pure def lawOnlyIMessageLinksDirectly(channel: Channel): bool =
  (updateDeliveryFor(channel, true) == AssistantLink) iff channel == IMessage

pure def lawChatGptLinkNeverSends(assistant: LinkedAssistant): bool =
  updateLinkTemplate(assistant) != "https://chatgpt.com/?q={q}"
```

### Every entry can reach its result

The supported paths include signup through a skill from each kind of entry, an explanation, a shown update, an update that shows nothing, a request to connect, and a refused route.

```quint
pure def sometimesFollowingSkill(s: Entry): bool = s.phase == FollowingSkill
pure def sometimesFollowingSkillFromSite(s: Entry): bool = s.phase == FollowingSkill and s.entry == FromSite
pure def sometimesFollowingSkillFromCatalog(s: Entry): bool = s.phase == FollowingSkill and s.entry == FromSkillCatalog
pure def sometimesExplaining(s: Entry): bool = s.phase == Explaining
pure def sometimesUpdateShown(s: Entry): bool = s.phase == UpdateShown
pure def sometimesNothingNewShown(s: Entry): bool = s.phase == NothingNewShown
pure def sometimesNeedsConnection(s: Entry): bool = s.phase == NeedsConnection
pure def sometimesEntryRefused(s: Entry): bool = s.phase == EntryRefused
```
