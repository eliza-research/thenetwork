# Reach the agent experience

A person reaches the agent experience in four ways: the prompt on an app's landing page, a plugin in their agent, the agent skill catalog of a site, or a link in an update text. The landing page, its prompt and its agent tiles are in [landing entry](landingEntry.md). The skill files and the skill catalog of each site are in [site pages](sitePages.md). The brand data, with the skill name of each app, is in [brand identity](brandIdentity.md). The plugin build owns the plugin skill copies and their MCP endpoints. The notification service owns the update reference and the link in the text. The agent owns what it does with the skill ([agent signup](agentSignup.md)) and with the connector ([connector tools](connectorTools.md)). This spec models how each entry resolves to one app skill or to the updates tool. Public sites have no sign-in link, settings page or member dashboard.

The person's agent follows the text of the site prompt and of the app's SKILL.md. No code of this repository runs inside that agent. The plugin build calls `pluginListsSkill`, `pluginEndpoint`, `endpointPath`, `appOpenAiEndpointPath`, `endpointHost`, `openAiManifestApp` and `skillFor` when it writes the plugin skill copies, the MCP dependency of each OpenAI plugin skill, the OpenAI plugin manifest and the server list of the Claude plugin. The skill sources name their endpoints in plain text. The plugin build makes the endpoint URLs of each skill from these functions and fails when a skill copy does not name them: a Claude plugin skill names the full endpoint and the OpenAI endpoint of its app, and an OpenAI plugin skill names the OpenAI endpoint of its app. The plugin build also fails when these URLs are not the same as `connectorEndpoint` and `openaiConnectorEndpoint` in [brand identity](brandIdentity.md). The connector server calls `appEndpointPath` and `appOpenAiEndpointPath` for the path of each app. The site build checks the signup step markers of each SKILL.md against the [agent signup](agentSignup.md) model. No runtime code enforces the entry routes of this model, or the agent signup model on the agent side. The connector server enforces its own rules on each tool call ([connector tools](connectorTools.md)).

## Story: Get from an app site or a text into my own agent

> As a person who found an app, I want one prompt or one link to open my own agent with the right app's skill, so that the agent can sign me up or show my update without a website account.

### The Claude plugin lists four skills and the OpenAI plugin lists three, and every skill uses the ntwrk.party endpoint of its app

All app connectors are on one server, ntwrk.party ([connector tools](connectorTools.md)). Each skill tells the agent to connect the ntwrk.party endpoint of its own app and which app to act for. The endpoint of The Network is `https://ntwrk.party/mcp`. The endpoint of each other app is `https://ntwrk.party/mcp/<app>`, for example `https://ntwrk.party/mcp/slop`. ChatGPT and Codex use the OpenAI surface of the same endpoint, which adds `/openai`, for example `https://ntwrk.party/mcp/slop/openai`. The connector server binds each connection to the app of that path.

The Claude plugin lists the skills of all four apps, and each skill uses the full endpoint of its app. The OpenAI plugin, for ChatGPT and Codex, lists the ntwrk.party, peon.biz and friends.help skills only, because the OpenAI plugin directory accepts only plugins that suit people aged 13 to 17. In the OpenAI plugin, each skill names the OpenAI endpoint of its app, and the MCP dependency of each skill points to it. OpenAI lets a plugin manifest list only one MCP server. The OpenAI plugin manifest lists the endpoint of The Network, `https://ntwrk.party/mcp/openai`. On the OpenAI surface, only the slop.date endpoint lists slop.date, and the endpoint of each other app names neither slop.date nor dating ([connector tools](connectorTools.md)). So the OpenAI plugin cannot reach slop.date through its server or through the MCP dependency of a skill. A person who uses slop.date in ChatGPT reaches its skill from the slop.date page, and the agent adds `https://ntwrk.party/mcp/slop/openai` as a connector.

```quint
import brandIdentity.* from "./brandIdentity"

type Plugin = ClaudePlugin | OpenAiPlugin
type McpEndpoint = NoEndpoint | SiteEndpoint | OpenAiEndpoint

pure val endpointHost: AppKey = Ntwrk

pure def pluginListsSkill(plugin: Plugin, app: AppKey): bool = plugin == ClaudePlugin or app != Slop

pure def pluginEndpoint(plugin: Plugin, app: AppKey): McpEndpoint =
  if (plugin == ClaudePlugin) SiteEndpoint
  else if (app == Slop) NoEndpoint
  else OpenAiEndpoint

pure def appEndpointPath(app: AppKey): str =
  if (app == Ntwrk) "/mcp"
  else if (app == Slop) "/mcp/slop"
  else if (app == Peon) "/mcp/peon"
  else "/mcp/friends"

pure def appOpenAiEndpointPath(app: AppKey): str =
  if (app == Ntwrk) "/mcp/openai"
  else if (app == Slop) "/mcp/slop/openai"
  else if (app == Peon) "/mcp/peon/openai"
  else "/mcp/friends/openai"

pure def endpointPath(endpoint: McpEndpoint, app: AppKey): str =
  if (endpoint == SiteEndpoint) appEndpointPath(app)
  else if (endpoint == OpenAiEndpoint) appOpenAiEndpointPath(app)
  else ""

pure val openAiManifestApp: AppKey = Ntwrk

pure def lawEveryListedSkillHasAnEndpoint(plugin: Plugin, app: AppKey): bool =
  pluginListsSkill(plugin, app) iff endpointPath(pluginEndpoint(plugin, app), app) != ""

pure def lawEveryAppHasItsOwnPath(app: AppKey, other: AppKey): bool =
  app != other implies
    (appEndpointPath(app) != appEndpointPath(other) and appOpenAiEndpointPath(app) != appOpenAiEndpointPath(other))

pure def lawOpenAiManifestServerIsAListedApp(app: AppKey): bool =
  (app == openAiManifestApp) implies
    (pluginListsSkill(OpenAiPlugin, app) and pluginEndpoint(OpenAiPlugin, app) == OpenAiEndpoint)

pure def lawClaudePluginListsEverySkill(app: AppKey): bool =
  pluginListsSkill(ClaudePlugin, app) and pluginEndpoint(ClaudePlugin, app) == SiteEndpoint

pure def lawOpenAiPluginNeverUsesTheSlopEndpoint(app: AppKey): bool =
  endpointPath(pluginEndpoint(OpenAiPlugin, app), app) != appOpenAiEndpointPath(Slop)

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

An update text that links to an assistant carries only the reference, in the prompt `Ask The Network for update T-7F3K9Q`, and nothing else about the update. When the person uses no assistant that the service can link to (ChatGPT, Claude or Grok), the update itself goes in the text thread. A member can reply `updates` on the phone text thread to read their current inbox one page at a time. On iMessage, the text links straight to the assistant with the prompt filled in. On SMS and Telegram, the text links to `https://ntwrk.party/t/<reference>` with a button for each assistant. The handoff uses the reference from the path and does not look up the update, check whether it exists, or use account data. A valid reference always produces the same page structure. Each assistant link fills the prompt and never sends it: ChatGPT takes `?prompt=`, because its `?q=` sends the prompt at once on the web.

```quint
type Channel = IMessage | Sms | Telegram
type LinkedAssistant = ChatGptAssistant | ClaudeAssistant | GrokAssistant
type UpdateDelivery = InThread | AssistantLink | ButtonPage

pure val updatePromptLead = "Ask The Network for update "
pure val updateHandoffPrefix = "/t/"
pure val linkedAssistants: List[LinkedAssistant] = List(ChatGptAssistant, ClaudeAssistant, GrokAssistant)

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

The supported paths include signup through a skill from a site, Claude plugin, OpenAI plugin, or skill catalog. A person can also reach an explanation, a shown update, an update that shows nothing, a request to connect, or a refused route.

```quint
pure def sometimesFollowingSkill(s: Entry): bool = s.phase == FollowingSkill
pure def sometimesFollowingSkillFromSite(s: Entry): bool = s.phase == FollowingSkill and s.entry == FromSite
pure def sometimesFollowingSkillFromCatalog(s: Entry): bool = s.phase == FollowingSkill and s.entry == FromSkillCatalog
pure def sometimesFollowingSkillFromClaudePlugin(s: Entry): bool = s.phase == FollowingSkill and s.entry == FromClaudePlugin
pure def sometimesFollowingSkillFromOpenAiPlugin(s: Entry): bool = s.phase == FollowingSkill and s.entry == FromOpenAiPlugin
pure def sometimesExplaining(s: Entry): bool = s.phase == Explaining
pure def sometimesUpdateShown(s: Entry): bool = s.phase == UpdateShown
pure def sometimesNothingNewShown(s: Entry): bool = s.phase == NothingNewShown
pure def sometimesNeedsConnection(s: Entry): bool = s.phase == NeedsConnection
pure def sometimesEntryRefused(s: Entry): bool = s.phase == EntryRefused
```
