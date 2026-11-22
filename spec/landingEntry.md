# Landing entry

The landing page of each public site sends the person to their own agent with one signup prompt, or to Messages with one join message. This spec owns what the page shows, what each control does, and what the status line says. The page script owns the clipboard, the device test, the timer and the links. The agent skill and the shared text line own the signup after the person leaves the page. Brand data comes from [brand identity](./brandIdentity.md), and the page set from [site pages](./sitePages.md).

## Story: Take the signup prompt to my agent

> As a person on a landing page, I want one short prompt that I can copy into my own agent, so that my agent can sign me up for this app.

### The prompt tells the agent to read the site's skill and follow it

The prompt is `Read https://<domain>/SKILL.md?version=<version> and follow it.` The version is the version in the skill's front matter. The slop.date prompt has no version query. The page shows the prompt as text that a person can select without the page script.

```quint
import brandIdentity.* from "./brandIdentity"

pure val promptLead = "Read https://"
pure val promptSkillPath = "/SKILL.md"
pure val promptVersionQuery = "?version="
pure val promptTail = " and follow it."

pure def promptCarriesVersion(app: AppKey): bool = app != Slop

pure def promptDomain(app: AppKey): str = brandFor(app).domain

pure def lawOnlySlopPromptHasNoVersion(app: AppKey): bool = not(promptCarriesVersion(app)) iff (app == Slop)
```

### The prompt names the host of the site that serves it

The build gives the page the host of the site. A production build gives no host, and the prompt names the domain of the brand. A staging build gives its staging host, and the prompt names that host. The prerendered page and the page script get the same host from the build, so that both show the same prompt.

```quint
pure val siteHostValues = Set("", "slop-stage.example.test")

pure def promptHost(app: AppKey, siteHost: str): str = if (siteHost == "") promptDomain(app) else siteHost

pure def lawProductionPromptNamesBrandDomain(app: AppKey): bool = promptHost(app, "") == brandFor(app).domain

pure def lawStagingPromptNamesItsHost(app: AppKey, siteHost: str): bool =
  siteHost != "" implies promptHost(app, siteHost) == siteHost
```

### The Copy button shows only when the page script runs

Without the page script the Copy button stays hidden, and the page detects no device. When the script runs before any click, it detects the device and shows the Copy button with the label "Copy".

```quint
type DeviceKind = NotDetected | Phone | MacDesktop | OtherDesktop
type CopyState = CopyHidden | CopyReady | CopyCopied | CopySelected
type StatusLine = StatusEmpty | AgentOpening | PasteInAgent | SendToAgentApp | CopyByHand | MessageCopied | TextTheNumber
type MessagesState = MessagesIdle | MessagesLinkFollowed | MessagesWaiting | MessagesOpened | MessagesFallback
type AgentId = ChatGpt | Claude | Grok | Muse | Gemini | Perplexity | Cursor | OpenClaw | Hermes

type Landing = {
  mounted: bool,
  device: DeviceKind,
  copy: CopyState,
  status: StatusLine,
  messages: MessagesState,
  messageCopied: bool,
  agentFollowed: bool,
  lastAgent: AgentId,
  statusAgent: AgentId,
}

pure val initial: Landing = {
  mounted: false, device: NotDetected, copy: CopyHidden, status: StatusEmpty,
  messages: MessagesIdle, messageCopied: false, agentFollowed: false, lastAgent: ChatGpt, statusAgent: ChatGpt,
}

pure val deviceValues = Set(Phone, MacDesktop, OtherDesktop)

pure def canMount(s: Landing, device: DeviceKind): bool =
  not(s.mounted) and device != NotDetected and s.messages == MessagesIdle and not(s.agentFollowed)

pure def mount(s: Landing, device: DeviceKind): Landing = { ...s, mounted: true, device: device, copy: CopyReady }

pure def alwaysCopyButtonNeedsScript(s: Landing): bool = s.mounted iff (s.copy != CopyHidden)
pure def alwaysDeviceKnownOnlyWithScript(s: Landing): bool = s.mounted iff (s.device != NotDetected)
```

### A phone user agent or a touch Mac is a phone

An Android, iPhone, iPad or iPod user agent is a phone. iPadOS reports a Mac user agent, so a Mac user agent with more than one touch point is a phone too. Another Mac is a Mac desktop. Every other device is another desktop.

```quint
pure def deviceFor(phoneUserAgent: bool, macUserAgent: bool, touchPoints: int): DeviceKind =
  if (phoneUserAgent or (macUserAgent and touchPoints > 1)) Phone
  else if (macUserAgent) MacDesktop
  else OtherDesktop

pure val touchPointsValues = Set(0, 1, 2, 5)

pure def lawTouchMacIsPhone(touchPoints: int): bool =
  touchPoints > 1 implies deviceFor(false, true, touchPoints) == Phone

pure def lawDeviceIsAlwaysDetected(phoneUserAgent: bool, macUserAgent: bool, touchPoints: int): bool =
  deviceFor(phoneUserAgent, macUserAgent, touchPoints) != NotDetected
```

### Copy puts the prompt on the clipboard, or selects it when the clipboard refuses

When the clipboard accepts the prompt, the button says "Copied". When the clipboard refuses, the page selects the prompt text and the button says "Selected: press copy". Only the Copy button and the script start change the button label.

```quint
pure def canPressCopy(s: Landing): bool = s.mounted and s.copy != CopyHidden

pure def pressCopy(s: Landing, copied: bool): Landing = { ...s, copy: if (copied) CopyCopied else CopySelected }

pure def copyLabel(copyState: CopyState): str =
  if (copyState == CopyCopied) "Copied" else if (copyState == CopySelected) "Selected: press copy" else "Copy"

pure def stepCopyLabelChangesOnlyByCopy(before: Landing, via: str, after: Landing): bool =
  after.copy != before.copy implies (via == "mount" or via == "pressCopy")

pure def sometimesCopied(s: Landing): bool = s.copy == CopyCopied
pure def sometimesSelectedForHandCopy(s: Landing): bool = s.copy == CopySelected
```

## Story: Open my agent from its tile

> As a person who uses a known agent, I want to press its logo, so that the agent opens with the prompt, or I know where to paste it.

### The agent row lists nine agents in a fixed order, each with a kind, a name, a logo and a link

The row shows logos only. The hover label is the name of the agent. The accessible name tells what the tile does: "Open in <name>" for a tile with a link, and "Copy the prompt for <name>" for a copy-only tile. A tile that opens with the prompt fills the prompt in the agent. A tile that opens for paste opens the agent, but the person pastes the prompt. A tile that opens an installed app uses the app's own link, and nothing opens when the app is not installed. A copy-only tile has no link: it copies the prompt and tells the person where to paste it. In a link, `{q}` is the encoded prompt and `{skill}` is the encoded skill URL. The row has no Codex tile. A person who uses Codex gets the app skills through the OpenAI plugin ([agent entry](./agentEntry.md)), or copies the prompt into Codex.

```quint
type TileKind = OpensWithPrompt | OpensForPaste | OpensInstalledApp | CopyOnly

pure val agentOrder: List[AgentId] = List(ChatGpt, Claude, Grok, Muse, Gemini, Perplexity, Cursor, OpenClaw, Hermes)

pure def tileKindFor(agent: AgentId): TileKind =
  if (agent == Muse) CopyOnly
  else if (agent == Gemini) OpensForPaste
  else if (agent == OpenClaw or agent == Hermes) OpensInstalledApp
  else OpensWithPrompt

pure def agentName(agent: AgentId): str =
  if (agent == ChatGpt) "ChatGPT" else if (agent == Claude) "Claude" else if (agent == Grok) "Grok"
  else if (agent == Muse) "Muse" else if (agent == Gemini) "Gemini" else if (agent == Perplexity) "Perplexity"
  else if (agent == Cursor) "Cursor" else if (agent == OpenClaw) "OpenClaw" else "Hermes"

pure def agentLogo(agent: AgentId): str =
  if (agent == ChatGpt) "openai" else if (agent == Claude) "claude" else if (agent == Grok) "grok"
  else if (agent == Muse) "muse" else if (agent == Gemini) "gemini" else if (agent == Perplexity) "perplexity"
  else if (agent == Cursor) "cursor" else if (agent == OpenClaw) "openclaw" else "hermesagent"

pure def agentLinkTemplate(agent: AgentId): str =
  if (agent == ChatGpt) "https://chatgpt.com/?q={q}"
  else if (agent == Claude) "https://claude.ai/new?q={q}"
  else if (agent == Grok) "https://grok.com/?q={q}"
  else if (agent == Gemini) "https://gemini.google.com/app?q={q}"
  else if (agent == Perplexity) "https://www.perplexity.ai/search?q={q}"
  else if (agent == Cursor) "https://cursor.com/link/prompt?text={q}"
  else if (agent == OpenClaw) "openclaw://agent?message={q}"
  else if (agent == Hermes) "hermes://skill/install?identifier={skill}"
  else ""

pure val openTileLabelLead = "Open in "
pure val copyTileLabelLead = "Copy the prompt for "

pure def tileLabelLead(agent: AgentId): str =
  if (tileKindFor(agent) == CopyOnly) copyTileLabelLead else openTileLabelLead

pure def lawOnlyCopyOnlyTilesHaveNoLink(agent: AgentId): bool =
  (tileKindFor(agent) == CopyOnly) iff (agentLinkTemplate(agent) == "")
```

### A desktop-only tile is hidden on a phone, and a copy-only tile needs the page script

Cursor is desktop-only. Without the page script every link tile shows, and the copy-only tile stays hidden because it cannot copy.

```quint
pure def desktopOnlyAgent(agent: AgentId): bool = agent == Cursor

pure def tileShown(agent: AgentId, mounted: bool, device: DeviceKind): bool =
  (tileKindFor(agent) != CopyOnly or mounted) and not(desktopOnlyAgent(agent) and device == Phone)

pure def lawCopyOnlyTileNeedsScript(agent: AgentId, device: DeviceKind): bool =
  tileKindFor(agent) == CopyOnly implies not(tileShown(agent, false, device))
```

### A tile copies the prompt, opens its link, and the status line says what to do next

A press on a shown tile follows its link, if it has one. With the page script the tile also copies the prompt. When the copy works, the status line shows the agent's message: the agent is opening, or paste the prompt into the agent, or send the prompt to the installed app. When the copy fails, the status line says "Copy the prompt, then paste it into your agent." Without the page script the status line stays empty. The state keeps the agent of the last press with the page script, copy-only tiles included, and an agent message always names that agent.

```quint
pure def toastFor(agent: AgentId): StatusLine =
  val kind = tileKindFor(agent)
  if (kind == OpensWithPrompt) AgentOpening
  else if (kind == OpensInstalledApp) SendToAgentApp
  else PasteInAgent

pure def agentToastText(agent: AgentId): str =
  if (agent == ChatGpt) "Opening ChatGPT. The prompt is copied too."
  else if (agent == Claude) "Opening Claude. The prompt is copied too."
  else if (agent == Grok) "Opening Grok. The prompt is copied too."
  else if (agent == Muse) "Copied. Paste it into Muse."
  else if (agent == Gemini) "Copied. Paste it into Gemini."
  else if (agent == Perplexity) "Opening Perplexity. The prompt is copied too."
  else if (agent == Cursor) "Opening Cursor. The prompt is copied too."
  else if (agent == OpenClaw) "Copied. If OpenClaw did not open, send it the prompt."
  else "Copied. If Hermes did not open, send it the prompt."

pure val copyByHandText = "Copy the prompt, then paste it into your agent."

pure def canChooseAgent(s: Landing, agent: AgentId): bool = tileShown(agent, s.mounted, s.device)

pure def chooseAgent(s: Landing, agent: AgentId, copied: bool): Landing =
  val opens = tileKindFor(agent) != CopyOnly
  { ...s,
    agentFollowed: s.agentFollowed or opens,
    lastAgent: if (opens) agent else s.lastAgent,
    statusAgent: if (s.mounted) agent else s.statusAgent,
    status: if (not(s.mounted)) s.status else if (copied) toastFor(agent) else CopyByHand }

pure def alwaysFollowedAgentHasLink(s: Landing): bool = s.agentFollowed implies tileKindFor(s.lastAgent) != CopyOnly
pure def alwaysNoDesktopAgentOnPhone(s: Landing): bool =
  (s.agentFollowed and s.device == Phone) implies not(desktopOnlyAgent(s.lastAgent))
pure def alwaysAgentStatusNamesPressedAgent(s: Landing): bool =
  (s.status == AgentOpening or s.status == PasteInAgent or s.status == SendToAgentApp) implies toastFor(s.statusAgent) == s.status

pure def sometimesAgentOpening(s: Landing): bool = s.agentFollowed and s.status == AgentOpening
pure def sometimesPasteOnlyAgent(s: Landing): bool = not(s.agentFollowed) and s.status == PasteInAgent
pure def sometimesInstalledAppAgent(s: Landing): bool = s.status == SendToAgentApp
pure def sometimesCopyByHand(s: Landing): bool = s.status == CopyByHand
pure def sometimesAgentWithoutScript(s: Landing): bool = not(s.mounted) and s.agentFollowed
```

## Story: Start in Messages instead

> As a person who prefers text messages, I want one button that starts a text to the shared line, so that I can join this app without an agent.

### The Messages entry writes `join <keyword>` to the shared line

The entry says "Use in iMessage". It links to the shared line with the body `join <keyword>`. The keyword comes from the brand record, so the shared line routes the message to this app. The entry is not in the agent row.

```quint
pure val messagesEntryLabel = "Use in iMessage"
pure val joinMessagePrefix = "join "

pure def joinKeyword(app: AppKey): str = brandFor(app).keyword
```

### The device decides whether the entry opens Messages or shows the number

Without the page script the browser follows the link and nothing else occurs. With the page script, a press on the entry first starts to copy the join message. On a phone or a Mac the page waits for Messages to open. On another desktop the page does not follow the link. It shows the number and the message at once: "Message copied. Text it to <number> if iMessage did not open." when the copy works, or "Text “<message>” to <number>." when it fails. The page puts the shared line number in place of `{number}` and the join message in place of `{message}`. While the page waits for Messages, it ignores a new press on the entry. Without the page script, each press follows the link again.

```quint
pure def messagesOpensHere(device: DeviceKind): bool = device == Phone or device == MacDesktop

pure def messagesFallbackStatus(copied: bool): StatusLine = if (copied) MessageCopied else TextTheNumber

pure val messageCopiedTemplate = "Message copied. Text it to {number} if iMessage did not open."
pure val textTheNumberTemplate = "Text “{message}” to {number}."

pure def messagesFallbackTemplate(copied: bool): str =
  if (messagesFallbackStatus(copied) == MessageCopied) messageCopiedTemplate else textTheNumberTemplate

pure def canChooseMessages(s: Landing): bool = s.messages != MessagesWaiting

pure def chooseMessages(s: Landing, copied: bool): Landing =
  if (not(s.mounted)) { ...s, messages: MessagesLinkFollowed }
  else if (not(messagesOpensHere(s.device)))
    { ...s, messages: MessagesFallback, messageCopied: copied, status: messagesFallbackStatus(copied) }
  else { ...s, messages: MessagesWaiting, messageCopied: copied }

pure def alwaysWaitOnlyWhereMessagesOpens(s: Landing): bool =
  (s.messages == MessagesWaiting or s.messages == MessagesOpened) implies (s.mounted and messagesOpensHere(s.device))
pure def alwaysLinkFollowedOnlyWithoutScript(s: Landing): bool =
  s.messages == MessagesLinkFollowed implies not(s.mounted)
pure def alwaysFallbackNeedsScript(s: Landing): bool = s.messages == MessagesFallback implies s.mounted
```

### When Messages does not open in 1.5 seconds, the status line shows the number and the message

If the page goes hidden within 1500 ms, Messages opened and the status line does not change. Otherwise the status line shows the same fallback as on another desktop. The page always settles a press that waits.

```quint
pure val messagesWaitMs = 1500

pure def canSettleMessages(s: Landing): bool = s.messages == MessagesWaiting

pure def settleMessages(s: Landing, pageLeft: bool): Landing =
  if (pageLeft) { ...s, messages: MessagesOpened }
  else { ...s, messages: MessagesFallback, status: messagesFallbackStatus(s.messageCopied) }

pure def stepMessagesFallbackShowsNumber(before: Landing, via: str, after: Landing): bool =
  ((via == "chooseMessages" or via == "settleMessages") and after.messages == MessagesFallback) implies
    (after.status == MessageCopied or after.status == TextTheNumber)

pure val fair_settleMessages = "weak"
pure def leadsToMessagesSettled(s: Landing, later: Landing): bool =
  s.messages == MessagesWaiting implies later.messages != MessagesWaiting

pure def sometimesMessagesOpened(s: Landing): bool = s.messages == MessagesOpened
pure def sometimesMessageCopiedFallback(s: Landing): bool = s.messages == MessagesFallback and s.status == MessageCopied
pure def sometimesTextTheNumber(s: Landing): bool = s.status == TextTheNumber
pure def sometimesMessagesWithoutScript(s: Landing): bool = s.messages == MessagesLinkFollowed
pure def sometimesDesktopShowsNumberAtOnce(s: Landing): bool = s.messages == MessagesFallback and s.device == OtherDesktop
```

## Story: See only what I need to start

> As a person who arrives from a link, I want a short page with one way in, so that I do not read text that I do not need.

### The landing page shows the brand, the prompt, the agents, the Messages entry, the status line and two legal links

The page shows these items in this order: the brand mark, the headline, the prompt, the Copy button, the agent row, the Messages entry, the status line, and the Privacy and Terms links. The headline is the one heading, so the page has exactly one heading. The page has fewer than 45 words. It never shows a sign-in link, a settings link, a member dashboard, a safety notice, compliance text or an explanation block. [Brand identity](./brandIdentity.md) controls which app names the page can show. The status line stays empty until the page script has something to say.

```quint
type LandingItem = BrandMarkItem | HeadlineItem | PromptItem | CopyButtonItem | AgentRowItem |
  MessagesItem | StatusItem | PrivacyLinkItem | TermsLinkItem |
  SignInItem | SettingsItem | DashboardItem | SafetyNoticeItem | ComplianceItem | ExplainerItem

pure val landingWordLimit = 45
pure val landingHeadingCount = 1

pure def landingWordsAllowed(words: int): bool = words >= 0 and words < landingWordLimit

pure def landingHeadingsAllowed(headings: int): bool = headings == landingHeadingCount

pure val landingItems: List[LandingItem] = List(BrandMarkItem, HeadlineItem, PromptItem, CopyButtonItem,
  AgentRowItem, MessagesItem, StatusItem, PrivacyLinkItem, TermsLinkItem)

pure val neverOnLanding: Set[LandingItem] =
  Set(SignInItem, SettingsItem, DashboardItem, SafetyNoticeItem, ComplianceItem, ExplainerItem)

pure def landingShows(landingItem: LandingItem): bool = landingItems.includes(landingItem)

pure def lawLandingHasNoAccountPortal(landingItem: LandingItem): bool =
  (landingItem == SignInItem or landingItem == SettingsItem or landingItem == DashboardItem) implies not(landingShows(landingItem))

pure def lawLandingHasNoSafetyOrComplianceText(landingItem: LandingItem): bool =
  (landingItem == SafetyNoticeItem or landingItem == ComplianceItem or landingItem == ExplainerItem) implies not(landingShows(landingItem))

pure def lawLandingShowsEveryOtherItem(landingItem: LandingItem): bool =
  landingShows(landingItem) iff not(neverOnLanding.contains(landingItem))

pure def alwaysStatusNeedsScript(s: Landing): bool = not(s.mounted) implies s.status == StatusEmpty
```
