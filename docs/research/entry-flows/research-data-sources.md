# Profile enrichment data sources for The Network (iMessage-first) — research 2026-10-08

Scope: what a consenting member can let us pull, cost/lead time, legal risk, value for friends / slop.date / peon.biz matching.
Baseline already in PRD (sec 17 line ~885, 32.5): calendar (Google OAuth), LinkedIn/X profile URL or **paste** (LinkedIn terms forbid automated fetching, validated 2026-10-06), AI-memory paste, vouch notes; Gmail/Instagram deferred as "sensitive". PRD forbids shadow profiles of non-members (line 75, 438). This document does not repeat that; it adds per-source facts and a ranking.

Confidence: H = official doc/court record read directly; M = multiple consistent secondary sources or official snippet; L = single secondary source or my inference.

---

## 1. Google

| Source | Data with consent | Scope(s) | Review / verification | Cost & lead time | Value for profile |
|---|---|---|---|---|---|
| Gmail API | Full messages, or headers/labels only | `gmail.readonly`, `gmail.metadata` — **both RESTRICTED** (H) | Restricted-scope verification + annual CASA security assessment if data touches our servers (H). **Use-case gate: only email clients, backup, productivity, reporting/monitoring apps qualify; "Applications that export email on a one-time or manual basis" are explicitly prohibited** (Gmail API policy, updated 2026-09-03) (H) | CASA Tier 2 via TAC Security ~$540-$1,800/app/yr (vendor pricing, M); Leviathan $3k-$4.5k (M); older quotes $15k-$75k (legacy). Verification "several weeks" (H); vendors say 2-8 wks (M). Re-assess every 12 months (H) | High in theory (newsletters, receipts, travel, employers), but **a profile-enrichment one-shot read is very likely not an approvable use case**. Limited Use: only user-facing features, no ads, no transfer to brokers, no human reading without affirmative consent, no generalized-model training (H). |
| Gmail metadata-only | From/To/Subject/labels, no body | `gmail.metadata` | Same as above — restricted (H) | Same | Does **not** help: same tier, same assessment. |
| Google Calendar | Events, or free/busy only | `calendar.freebusy`, `calendar.events.readonly`, `calendar.readonly` | Sensitive (not restricted) per Nylas (M) → brand verification + demo video, no CASA. Unverified apps work with warning screen and a user cap (100) (M) | Free; days to a few weeks for verification (L) | Medium: routines, availability, events attended, gym/class patterns. Already in PRD. |
| People / Contacts API | Own profile (birthday, etc.), contacts | `contacts.readonly` (sensitive, M); `user.birthday.read` etc. | Sensitive verification | Free | Low for profile; **contacts = shadow-graph risk, PRD says no**. |
| YouTube Data API | Subscriptions (`subscriptions.list mine=true`), liked videos (`videos.list myRating=like` or likes playlist) | `youtube.readonly` | Sensitive verification (L, classification not confirmed on official page) + YouTube API Services ToS/audit for quota increases | Free; default quota 10k units/day | **High for taste** (channels = interests, humor, hobbies). Underrated, cheap. |
| Data Portability API | Search, YouTube history, Maps, Play, Shopping, Chrome etc. (time-based transfers) | `dataportability.*` | App verification; security assessment "where required" (H) | **Users only in EU/EEA countries, Switzerland, UK** (Google help page answer/14452558, read 2026-10-08) (H). Not US. | N/A for US pilot (SF/NYC). |
| Google Takeout upload | Anything the user picks (MBOX, JSON) | none | none (user-driven) | Minutes to days; Gmail MBOX can be GBs; links expire 7 days (M) | Possible but heavy; Gmail MBOX too large for iMessage. Better: YouTube/Maps/Search-history slices only via web upload. |
| User forwards emails | Whatever they forward | none | none | Free, immediate | Low-medium; good for specific things (e.g. "forward your Strava/Spotify Wrapped/Goodreads year email"). No Google policy applies because Google is not the data source. |

**Cheaper path for Gmail:** do not request Gmail scopes for enrichment. Equivalent signal comes cheaper from the AI-memory paste (ChatGPT has often seen the same life), Calendar, YouTube, and targeted forwards.

Sources: https://developers.google.com/gmail/api/auth/scopes (read 2026-10-08); https://developers.google.com/gmail/api/policy (updated 2026-09-03); https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification; https://developers.google.com/terms/api-services-user-data-policy (updated 2024-02-15); https://support.google.com/cloud/answer/13805798 (no generalized AI/ML training on Workspace data); https://support.google.com/accounts/answer/14452558 (DPAPI regions); https://tacsecurity.com/esof/ and https://www.switchlabs.dev/post/casa-tier-2-tier-3-security-review-providers-pricing-and-the-cheapest-option (CASA pricing, vendor); https://developer.nylas.com/docs/cookbook/use-cases/build/google-oauth-scopes/ ; https://developers.google.com/youtube/v3/guides/implementation/ratings ; https://developers.google.com/workspace/calendar/api/auth

## 2. Meta

| Source | Data | Scopes | Review | Cost/lead | Value |
|---|---|---|---|---|---|
| Instagram Basic Display API | — | — | **Shut down 2024-12-04** (announced 2024-09-04, Meta dev blog) (H) | — | Dead. |
| Instagram API (Instagram Login or Facebook Login for Business) | Own media, insights, comments, messaging | `instagram_business_basic` etc. | App Review + Business Verification | Free; weeks | **Professional (Business/Creator) accounts only** per official overview (H). Personal accounts: no official API exists. Most dating-app users have personal accounts → near-useless. |
| Facebook Login | `public_profile` (auto-granted), `email`; `user_likes` (Pages liked; allowed usage explicitly lists dating/music apps), `user_gender` (dating listed), `user_hometown`, `user_location`, `user_birthday`, `user_age_range` (dating listed), `user_photos`, `user_videos` (dating/social display listed), `user_posts` (allowed usage only books/albums/memories and parental monitoring), `user_friends` (only friends who also use the app) | as named | Everything beyond public_profile/email needs App Review; **Business Verification required for Advanced Access** + annual Data Use Checkup (H) | Free; App Review typically 1-4 weeks (L) | Medium: `user_likes` is a real interest signal and dating is a named allowed use; but young US users barely use Facebook; requires a web hop (no OAuth inside iMessage). `user_posts` for profiling is NOT an allowed use. |
| Threads API | Own profile + own posts (`threads_basic`), replies, insights | `threads_basic` (required), `threads_read_replies`, `threads_manage_insights`, `threads_content_publish`, `threads_manage_replies` | App Review per permission for public users (M) | Free | Low-medium; reportedly works for any Threads profile, not only professional (L — not confirmed in official text). |
| Meta "Download Your Information" | Full JSON/HTML incl. likes, follows, ads interests, posts | none | none | Hours to days (Meta says up to 48h; guides up to 14 days); often >1-2.5 GB with media; link expires ~4 days (M) | IG "ad interests", "accounts you follow", liked posts are rich but the zip is too big for iMessage; user must pick JSON + low media/no media. |

Sources: https://developers.facebook.com/blog/post/2024/09/04/update-on-instagram-basic-display-api (H via snippet); https://developers.facebook.com/docs/instagram-platform/overview (read 2026-10-08); https://developers.facebook.com/docs/permissions (read 2026-10-08); https://developers.facebook.com/docs/threads/get-started/get-access-tokens-and-permissions ; https://pirg.org/resources/how-to-request-and-download-instagram-data/

## 3. Other platforms

| Source | Data with consent | Scopes | Review | Cost / lead | Dating/social value |
|---|---|---|---|---|---|
| X (OAuth 2.0 PKCE) | Profile, own posts, follows, likes, bookmarks, lists, DMs | `users.read tweet.read follows.read like.read bookmark.read list.read offline.access` (H) | Developer account; no app review for these | **Pay-per-use only for new devs** (since ~2026-02): user read $0.010, post read $0.005, follow/followers read $0.010/resource, likes $0.001, "owned reads" $0.001 (H, docs.x.com pricing; no dates on page). One member's 500 follows + 200 likes + 100 posts ≈ $1-6 | Medium-high for the subset who use X (follows/likes reveal interests). Cheap enough per member. |
| LinkedIn — Sign In with LinkedIn (OIDC) | name, given/family name, picture, locale, email (optional) | `openid profile email` | Self-serve product | Free, instant | **Low**: no headline, positions, education. |
| LinkedIn — Member Data Portability API (DMA) | Full profile, positions, skills, etc. | `r_dma_portability_3rd_party` | Application | Free | **EU/EEA + Switzerland members only** (LinkedIn Help a6214075) (M). Not US. Other member-data APIs (positions etc.) are closed partner programs. |
| LinkedIn data export | Profile.csv, Positions.csv, Education.csv, Skills.csv, Connections.csv | none | none | "Within minutes" for selected files; full archive within 24 h; link 72 h (LinkedIn help 50191) (M) | High for peon.biz; small zip (KB-MB) — works over iMessage/web. But **Connections.csv = non-member data → do not ingest**. PRD paste path is simpler. |
| TikTok Login Kit + Display API | open_id, avatar, display name; bio, profile link, verified; follower/following/like/video counts; own public videos | `user.info.basic`, `user.info.profile`, `user.info.stats`, `video.list` (H) | App review before production (M) | Free; weeks | Low: **no liked videos, no following list** (H). Own captions only. |
| Snapchat Login Kit | display name, Bitmoji avatar URL, external id | 3 scopes (H) | Snap Kit review | Free | Very low (identity only). |
| Spotify Web API | `GET /me/top/{artists,tracks}` **still available**, recently played, saved tracks, followed artists (H, Feb-2026 changelog) | `user-top-read`, `user-read-recently-played`, `user-library-read`, `user-follow-read` | **Since 2026-03-09 Development Mode = 5 users per client ID, owner needs Premium, non-commercial personal projects only. Extended access (since 2025-05-15) = established, scalable businesses; secondary sources say ≥250k MAU** (H for dev-mode limits; M for 250k) | Free but practically **unavailable to a startup**; artist/track popularity and follower fields removed | Would be the single best dating signal, but we **cannot use the API at scale**. Workaround: ask for a screenshot of Spotify Wrapped / "top artists" or a stats.fm/receiptify screenshot; or Spotify "Download your data" (Account privacy; ~5-30 days, small JSON) (L on timing). |
| Apple | Sign in with Apple: name (first time only), email/relay (M). Apple Music API: recently played, library, recommendations via Music User Token from MusicKit JS (H for recent played endpoint) | MusicKit dev token + user token | Apple Developer Program ($99/yr) | Low | Apple Music recently played = taste signal for iPhone-heavy users; needs a web hop. No iOS-only data (Health, Photos, Contacts) without a native app; we have none. |
| Strava | Activities, stats | `read`, `activity:read` | Since 2024-11-11 API agreement: data shown only to that user, **no use in AI models**; 2026: Standard tier devs need a Strava subscription (M) | Free/subscription | Medium value (runner/cyclist), but **AI-use ban conflicts with LLM profile extraction** → use screenshot/self-report instead. |
| Discord OAuth | identify (username, avatar), email, guilds (server names), connections (linked accounts e.g. Spotify, Steam, X) | `identify guilds connections` (H) | none for these | Free, instant | Medium for gamer/online-community users: server names are interest signals; `connections` reveals other handles. |
| Reddit | identity, subreddits | — | **Since Nov 2025 Responsible Builder Policy: self-serve Data API access closed; new OAuth tokens need approval** (M) | Unknown lead time | Subreddits = excellent interest signal but gated. Use self-report/screenshot. |
| Letterboxd | Diary, ratings | OAuth2 | API by request only (api@letterboxd.com) (L) | Unknown | Medium for film people; Letterboxd offers a CSV export a user can upload (L). |
| Goodreads | — | — | **No new API keys since 2020-12-08** (M) | — | Use Goodreads CSV export (Settings > Import/Export) upload (M) or screenshot. |

Sources: https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code.md ; https://docs.x.com/x-api/getting-started/pricing (read 2026-10-08); https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2 ; https://www.linkedin.com/help/linkedin/answer/a6214075 ; https://www.linkedin.com/help/linkedin/answer/50191 ; https://developers.tiktok.com/doc/tiktok-api-scopes ; https://developers.snap.com/snap-kit/login-kit/Tutorials/web ; https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security ; https://developer.spotify.com/documentation/web-api/references/changes/february-2026 ; https://developer.spotify.com/blog/2025-04-15-updating-the-criteria-for-web-api-extended-access ; https://developer.apple.com/documentation/applemusicapi ; https://www.techradar.com/health-fitness/strava-could-soon-stop-working-with-some-of-your-third-party-apps-heres-what-you-need-to-know ; https://docs.discord.com/developers/topics/oauth2 ; r/redditdev "Introducing the Responsible Builder Policy" (2025-11-11, via mirrors); https://www.goodreads.com/topic/show/21788520-api-deprecation

## 4. User-driven exports

| Export | Format / size | Time to receive | Practical over iMessage? |
|---|---|---|---|
| Instagram/Facebook DYI | JSON or HTML zip; often 100 MB-several GB with media | hours to days (up to 48h stated; reports up to 14 days); link ~4 days (M) | No (size, multi-step, delayed). Web upload with "JSON, no media, last year" preset is feasible but heavy friction. |
| Google Takeout | zip/tgz split 1-50 GB; MBOX for Gmail | minutes to days; links 7 days (M) | No for Gmail. YouTube-only slice (subscriptions CSV, history JSON) is small → web upload OK. |
| X archive | zip with JS/JSON; size scales with media | ~24-48 h (third-party; X help confirms path only) (M/L) | Web upload only. |
| LinkedIn export | CSVs, KB-MB | minutes (selected) / 24 h (full) (M) | Yes via web upload; iMessage can carry small files (Blooio delivers inbound attachments as URLs; size limit undocumented — test) (L). |
| ChatGPT export | zip with conversations.json + chat.html; can be large | minutes to days (M) | Not needed — memory summary paste is better. ChatGPT memory isn't in the export as a clean file (M). |
| AI memory summary paste | plain text, 1-5 KB | instant | **Yes, ideal.** Claude ships an official "Import memory" flow built on exactly this pattern (ask other assistant to summarize what it knows → paste) (M, techcabal 2026-05-27). |

General: any zip should go to a web upload page linked from iMessage (signed, expiring), parsed server-side, raw file deleted after extraction; show proposed facets to the member for confirmation (PRD 32.5 already requires this).

## 5. Scraping public profiles — legal landscape (US)

Court record / primary facts:
- **hiQ v. LinkedIn**: 9th Cir. 2022-04-18 (41 F.4th 1180) — accessing public pages likely not "without authorization" under CFAA post-Van Buren (2021, "gates up or down"). But district court 2022-11-04 held LinkedIn's user agreement anti-scraping terms enforceable as contract; **consent judgment + permanent injunction 2022-12-08, $500k against hiQ**, covering logged-in or not, fake accounts (H/M). Net: CFAA mostly off the table for public pages; contract and other claims are not.
- **Meta v. Bright Data** (N.D. Cal. 3:23-cv-00077, Judge Chen): summary judgment for Bright Data 2024-01-23 — Meta terms do not bar **logged-off** scraping of public data; Meta dropped the case and waived appeal (Feb 2024) (H via law-firm and TechCrunch summaries).
- **X Corp v. Bright Data** (N.D. Cal. 3:23-cv-03698, Judge Alsup): 2024-05-09 dismissal — contract claims against scraping public data preempted by Copyright Act; X later allowed to plead server-impairment/access claims (Nov 2024); **settled in principle June 2025**, confidential (M).
- **LinkedIn v. Nubela (Proxycurl)** (N.D. Cal. 3:25-cv-00828, filed 2025-01-24; contract, fraud, CFAA, UCL, Lanham; alleged hundreds of thousands of fake accounts). **Proxycurl shut down 2025-07-04**; founder cites legal cost; founder later says "we settled" (M). Confirmed.
- **LinkedIn v. ProAPIs** (N.D. Cal. 5:25-cv-08393, filed Oct 2025, fake-account mill): settled Feb 2026; final judgment on consent reported 2026-09-16 (M).
- **Reddit v. SerpApi/Perplexity** (S.D.N.Y.): MTD largely denied 2026-07-31 — DMCA anti-circumvention theory survives against scrapers bypassing access controls (M). New vector: circumvention (DMCA 1201) rather than CFAA.
- Clearview AI BIPA settlement vacated by 7th Cir. 2026-07-13 (M) — reminder that biometric use of scraped photos (IL BIPA) is a separate hazard.

Doctrinal summary (my synthesis, M):
- CFAA: weak claim against logged-out access to truly public pages; strong against fake accounts, circumventing blocks/logins.
- Contract: logged-in scraping by anyone who accepted ToS = breach (hiQ 2022). Logged-off: Meta's ToS lost (Bright Data), X's contract claims preempted, but LinkedIn's terms and consent judgments treat logged-out scraping as prohibited too; **LinkedIn litigates aggressively and the cost alone killed Proxycurl**.
- DMCA 1201 / anti-circumvention and state laws (CA CDAFA) are the growing claims.
- Platform enforcement: LinkedIn, Meta, X, Strava (moving public profile pages behind login in 2026, M), Reddit all actively block and sue.

State privacy law:
- CCPA/CPRA "publicly available" carve-out covers only info the consumer made available to the general public; friends-only content is not (M). SB 435 (2025-26) would narrow it further; status unverified (L). CCPA applies only above thresholds ($25M+ indexed revenue, or 100k+ consumers' data, or 50%+ revenue from selling/sharing) — The Network is probably below them now (L, from general knowledge), but the 19+ state laws have similar structures and Colorado/Connecticut/etc. treat **sex life/sexual orientation as sensitive data needing opt-in** — relevant for slop.date regardless of source.
- CA Delete Act: anyone compiling and selling data on people they have no direct relationship with is a data broker; registry enforcement live (DROP since 2026-01-01; brokers must process every 45 days from 2026-08-01) (M). Building non-member profiles would push us toward that definition.

Third-party providers:
- **Bright Data**: won vs Meta, settled with X; continues to sell public-web data; posture "public, logged-out only".
- **Apify**: marketplace of community "actors" (Instagram, LinkedIn, TikTok scrapers); Apify puts legal responsibility on the user; LinkedIn actors typically need cookies/accounts (logged-in → contract breach) (L).
- **People Data Labs**: data broker; $6.36M Colorado class settlement (prelim. approval 2026-06-30) over listing cellphone numbers without consent (M).
- **Clay**: enrichment orchestrator over PDL/others (L).
- **Proxycurl**: dead (2025-07). Successors (NinjaPear etc.) avoid LinkedIn.
All of these are B2B enrichment of people who did not consent → exactly the PRD's forbidden shadow profiles when used on non-members, and many unpermitted under platform ToS.

(a) Consenting member's own public profile, at their request, handle they provide:
- Privacy-law risk: minimal (the member is the data subject, consented, we tell them what we fetched).
- Platform risk: unchanged — the member's consent does not license us under LinkedIn/Meta/X terms. A single logged-out fetch of one public page is low-volume and low-practical-risk (Meta v. Bright Data favors logged-off), but LinkedIn forbids it and blocks it; X logged-out pages show little. Never use logged-in sessions, cookies, fake accounts, or residential-proxy evasion.
- Better: official API where it exists (X OAuth), or member-performed export/paste/screenshot.
(b) Non-members: don't. PRD forbids; legal exposure (data broker, BIPA if photos/face, state sensitive data), and ToS.

**Screenshots over iMessage + vision/OCR:** cleanest alternative for Instagram, Spotify, TikTok, Strava, Letterboxd, Hinge-style prompts. The member captures their own screen and sends it; no automated access to the platform, no ToS we're party to, no API quota. Caveats: screenshots contain other people (follower names, comments, tagged faces) — extract only the member's facets and discard the image; no face-geometry processing (BIPA); show extracted facets for confirmation. Confidence M (legal reasoning, not tested in court).

## 6. Bring-your-own-AI context

- Users paste a "tell me everything you know about me" summary from ChatGPT/Claude/Gemini. Anthropic itself productized this pattern (Claude "Import memory": copy a prompt into ChatGPT, paste result back), which is good evidence it is a normal, understood user action (M).
- Richest per unit friction: one copy-paste yields job, city, relationships context, hobbies, health/fitness goals, values, writing style. Risks: sensitive categories (health, sexuality, mental health, finances), stale or hallucinated facts, third-party info (partner names, coworkers). Handle with: give users a crafted prompt that asks for interests/values/goals and excludes health/third parties; extract facets with provenance "ai_memory"; confirm with the member; never store raw paste beyond extraction window.
- No platform ToS issue: the user copies their own data. ChatGPT data export is a fallback but large and noisy.
- The PRD's MCP surface (share_profile_with_network) is the zero-copy version of the same thing for members who connect Claude/ChatGPT to the Network.

## 7. Recommended ranking (iMessage-first, value per friction and risk)

1. **AI memory paste** (we send a tailored prompt; they paste the answer). Highest value, ~30 s, zero platform risk. Already in PRD; make it step 1.
2. **Conversation + vouch notes** (existing).
3. **Screenshots** of profiles/stats the member chooses: Spotify top artists/Wrapped, Instagram grid/bio, Letterboxd, Strava, LinkedIn profile, dating-app prompts. Vision extraction, confirm, discard image. Replaces the Spotify/Instagram APIs we cannot get.
4. **LinkedIn profile paste or LinkedIn export CSV** (Profile/Positions/Education/Skills only; ignore Connections) — peon.biz priority.
5. **Google Calendar** (free/busy or events.readonly) — sensitive scope, no CASA. Existing.
6. **X via OAuth** (follows, likes, bio) — pay-per-use, ~$1-6 per member one-time; only for members who are on X.
7. **YouTube subscriptions + likes** (`youtube.readonly`) — cheap, strong taste signal; can share Google verification with Calendar.
8. **Discord OAuth** (guilds, connections) — free, instant, for the gamer/community segment.
9. **Apple Music recently played** (MusicKit JS) — optional for music-heavy iPhone users.
10. Facebook Login `user_likes` (+ `user_age_range`/`user_gender`) — dating is a named allowed use, but needs App Review + Business Verification and FB usage is low among the target age. Later.

## 8. Don't do

- Don't request Gmail scopes (incl. `gmail.metadata`) for enrichment: restricted tier, annual CASA, and one-time/manual export use cases are prohibited by Gmail API policy; profile-building isn't an approved category.
- Don't build on the Spotify Web API (5-user dev mode, extended access closed to startups) or Instagram API (professional accounts only) or Reddit API (approval-gated).
- Don't use Strava API data in LLM extraction (Strava terms ban AI-model use).
- Don't scrape LinkedIn in any form (logged-in, logged-out, via Apify/Bright Data/PDL/Proxycurl-successors), even for the member's own profile.
- Don't use logged-in sessions, member cookies/passwords, fake accounts, or anti-bot circumvention on any platform.
- Don't buy enrichment from data brokers (PDL, Clay waterfalls) about anyone, including members (member didn't consent to the broker's collection; also tilts us toward data-broker status).
- Don't ingest contacts, LinkedIn Connections.csv, follower lists, or friends lists as people records (shadow graph). Use them only as aggregate counts, if at all.
- Don't run face recognition/face geometry on scraped or screenshot photos (IL BIPA; TX CUBI; WA).
- Don't ask for zip exports over iMessage; use a signed web upload link if at all.
- Don't keep raw pastes, screenshots or exports after extraction + member confirmation.

## 9. What I could not verify

- Exact Google sensitive-scope classification of `youtube.readonly`, `calendar.*` (secondary sources only); current unverified-app user cap number.
- Current CASA Tier 2 price (vendor pages only; TAC prices may have changed).
- Whether Threads API `threads_basic` works for non-professional accounts in production (secondary only).
- Facebook App Review timelines in 2026; whether Meta revised terms after Bright Data to cover logged-off scraping.
- X Corp v. Bright Data final settlement terms; whether any Ninth Circuit scraping appeal is pending in 2026.
- Proxycurl case: settlement vs injunction (founder says settled; docket not checked).
- California SB 435 final status.
- Blooio inbound attachment size limit (undocumented; test).
- Spotify "Download your data" timing; Letterboxd API availability in 2026.
- Spotify 250k MAU figure appears in secondary sources only; official text says "established, scalable, and impactful".
