# PoC: can enrichment fetch a member-supplied LinkedIn / X URL? (P13, PRD 32.5)

Probe run 2026-10-06 with plain HTTP GET (no login, honest user agent), one well-known public profile per site.

| Source | HTTP result | What the page exposes without login | Terms / robots | Verdict |
|---|---|---|---|---|
| LinkedIn `/in/<handle>` | 200, ~550 KB | `<title>` (name + headline) and `og:description` (headline + short about) only; no experience list without JS/login | robots.txt: "use of robots or other automated means to access LinkedIn without the express permission of LinkedIn is strictly prohibited"; crawling needs a whitelist | **Do not fetch.** Paste fallback (member pastes their About/Experience) is the default path; or member exports their LinkedIn data archive |
| X `x.com/<handle>` | 200, ~190 KB HTML shell | `og:description` = bio only; no posts without JS/API | robots allows search engines; X ToS forbids scraping without consent; official API is paid | Bio via one-time og: tag is technically possible but thin; prefer paste or official API if X becomes important |
| X oEmbed (`publish.twitter.com/oembed`) | 200 for profile URL, empty body | nothing useful for profiles | public API | Not useful for profiles |

**Conclusion:** the PRD's line "If a profile URL cannot be fetched within the source's terms, the member pastes the text instead" is in practice the **main** path for LinkedIn, not a fallback. Design the onboarding step as "paste your LinkedIn About and Experience, or your AI assistant's memory summary". The paste parser (P13) and the AI-memory paste are the enrichment features to build. Keep a per-source terms register with LinkedIn = `no_fetch` and X = `og_only`.
