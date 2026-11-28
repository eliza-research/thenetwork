import type { RateLimitConfig } from "../chaos.ts";
import { jsonResponse, parseFormBody, parseJsonBody, strField, type ServiceContext, type ServiceResult } from "../http-helpers.ts";
import type { SocialAccountState, SocialPlatform, SocialPostRecord } from "../state.ts";

const PLATFORM_RATE_LIMITS: Record<SocialPlatform, RateLimitConfig> = {
  x: { limit: 50, windowMs: 15 * 60_000 },
  instagram: { limit: 40, windowMs: 60 * 60_000 },
  tiktok: { limit: 30, windowMs: 60 * 60_000 },
  reddit: { limit: 60, windowMs: 10 * 60_000 },
  linkedin: { limit: 45, windowMs: 60 * 60_000 },
  discord: { limit: 50, windowMs: 60_000 },
};

function getOrCreateAccount(
  ctx: ServiceContext,
  platform: SocialPlatform,
  handle: string,
): SocialAccountState {
  const norm = handle.trim().replace(/^@/, "").toLowerCase() || "brand_default";
  const key = `${platform}:${norm}`;
  let acc = ctx.state.socialAccounts.get(key);
  if (!acc) {
    acc = {
      platform,
      handle: norm,
      userId: ctx.registry.nextId(ctx.state, `${platform}_u`),
      warmupDays: 30,
      reputation: 0.9,
      shadowbanned: false,
      locked: false,
      captchaRequired: false,
      spamReports: 0,
    };
    ctx.state.socialAccounts.set(key, acc);
  }
  return acc;
}

function resolveHandle(req: Request, body: Record<string, unknown>): string {
  const headerHandle = req.headers.get("x-mock-account") ?? req.headers.get("x-account-handle");
  if (headerHandle?.trim()) return headerHandle.trim();
  const fromBody =
    strField(body, "author") ||
    strField(body, "handle") ||
    strField(body, "username") ||
    strField(body, "account");
  if (fromBody) return fromBody;
  return "ntwrk_official";
}

function buildRateHeaders(
  platform: SocialPlatform,
  rl: { limit: number; remaining: number; used: number; resetAtSec: number; resetAfterSec: number; retryAfterSec: number },
): Record<string, string> {
  const common: Record<string, string> = {
    "x-rate-limit-limit": String(rl.limit),
    "x-rate-limit-remaining": String(rl.remaining),
    "x-rate-limit-reset": String(rl.resetAtSec),
  };
  if (rl.retryAfterSec > 0) {
    common["retry-after"] = String(rl.retryAfterSec);
  }
  if (platform === "instagram") {
    const pct = Math.min(100, Math.round((rl.used / Math.max(1, rl.limit)) * 100));
    common["x-app-usage"] = JSON.stringify({ call_count: pct, total_cputime: pct, total_time: pct });
  } else if (platform === "reddit") {
    common["x-ratelimit-used"] = String(rl.used);
    common["x-ratelimit-remaining"] = String(rl.remaining);
    common["x-ratelimit-reset"] = String(rl.resetAfterSec);
  } else if (platform === "discord") {
    common["x-ratelimit-bucket"] = `discord_${platform}_route`;
    common["x-ratelimit-limit"] = String(rl.limit);
    common["x-ratelimit-remaining"] = String(rl.remaining);
    common["x-ratelimit-reset-after"] = rl.resetAfterSec.toFixed(2);
  } else if (platform === "linkedin") {
    common["x-li-ratelimit-remaining"] = String(rl.remaining);
  } else if (platform === "tiktok") {
    common["x-ratelimit-limit"] = String(rl.limit);
    common["x-ratelimit-remaining"] = String(rl.remaining);
    common["x-ratelimit-reset"] = String(rl.resetAtSec);
  }
  return common;
}

function checkAccountChaos(
  ctx: ServiceContext,
  platform: SocialPlatform,
  path: string,
  acc: SocialAccountState,
  rateHeaders: Record<string, string>,
): { blocked?: ServiceResult; shadowbanned: boolean; reachMultiplier: number; chaosRuleId?: string } {
  const nowMs = ctx.registry.clock.now();
  const lockRule = ctx.chaos.domainFaultOf(platform, path, nowMs, "account_lock");
  const isLocked =
    acc.locked ||
    (lockRule !== null &&
      (lockRule.fault.accounts.length === 0 ||
        lockRule.fault.accounts.includes(acc.handle) ||
        lockRule.fault.accounts.includes("*")));
  if (isLocked) {
    acc.locked = true;
    const body =
      platform === "x"
        ? { errors: [{ code: 326, message: "To protect our users from spam, this account is temporarily locked." }] }
        : platform === "instagram"
          ? { error: { code: 368, message: "Action blocked: account restricted." } }
          : { error: { code: "account_locked", message: `${platform} account @${acc.handle} is locked` } };
    return {
      blocked: {
        service: platform,
        response: jsonResponse(body, 403, rateHeaders),
        responseSummary: body as Record<string, unknown>,
        chaosApplied: lockRule?.rule.id ?? "account_locked",
      },
      shadowbanned: false,
      reachMultiplier: 0,
      chaosRuleId: lockRule?.rule.id,
    };
  }

  const captchaRule = ctx.chaos.domainFaultOf(platform, path, nowMs, "captcha_wave");
  const rng = ctx.registry.forkRng(ctx.state, "captcha", platform, acc.handle, nowMs, ctx.state.seq);
  const needsCaptcha =
    acc.captchaRequired ||
    (captchaRule !== null && rng.bool(Math.max(0, Math.min(1, captchaRule.fault.probability))));
  if (needsCaptcha) {
    const body =
      platform === "x"
        ? { errors: [{ code: 261, message: "Challenge required: captcha verification needed." }], challenge_required: true }
        : platform === "instagram"
          ? { error: { code: 400, error_subcode: 2207026, message: "checkpoint_required" }, challenge_required: true }
          : platform === "tiktok"
            ? { error: { code: 10008, message: "captcha_challenge" }, challenge_required: true }
            : platform === "discord"
              ? { code: 40000, captcha_key: ["captcha-required"], challenge_required: true }
              : { error: { code: "captcha_required", message: "Human verification challenge required" }, challenge_required: true };
    const status = platform === "instagram" || platform === "discord" ? 400 : 403;
    return {
      blocked: {
        service: platform,
        response: jsonResponse(body, status, rateHeaders),
        responseSummary: body as Record<string, unknown>,
        chaosApplied: captchaRule?.rule.id ?? "captcha_required",
      },
      shadowbanned: false,
      reachMultiplier: 0,
      chaosRuleId: captchaRule?.rule.id,
    };
  }

  const shadowRule = ctx.chaos.domainFaultOf(platform, path, nowMs, "shadowban_wave");
  const shadowActive =
    acc.shadowbanned ||
    (shadowRule !== null &&
      (!shadowRule.fault.accounts?.length ||
        shadowRule.fault.accounts.includes(acc.handle) ||
        shadowRule.fault.accounts.includes("*")));
  const reachMultiplier = shadowActive ? Math.max(0, Math.min(0.03, shadowRule?.fault.reachMultiplier ?? 0)) : 1;
  return {
    shadowbanned: shadowActive,
    reachMultiplier,
    chaosRuleId: shadowActive ? (shadowRule?.rule.id ?? "account_shadowbanned") : undefined,
  };
}

function createPost(
  ctx: ServiceContext,
  platform: SocialPlatform,
  acc: SocialAccountState,
  text: string,
  shadowbanned: boolean,
  reachMultiplier: number,
  channelOrSubreddit?: string,
): SocialPostRecord {
  const nowMs = ctx.registry.clock.now();
  const id = ctx.registry.nextId(ctx.state, `${platform}_post`);
  const rng = ctx.registry.forkRng(ctx.state, "social_reach", id);
  const baseImpressions = rng.int(120, 2200);
  const impressions = shadowbanned ? Math.floor(baseImpressions * reachMultiplier) : baseImpressions;
  const likes = shadowbanned ? 0 : Math.floor(impressions * rng.range(0.02, 0.09));
  const replies = shadowbanned ? 0 : Math.floor(impressions * rng.range(0.004, 0.02));
  const clicks = shadowbanned ? 0 : Math.floor(impressions * rng.range(0.008, 0.035));
  const shares = shadowbanned ? 0 : Math.floor(likes * rng.range(0.05, 0.25));
  const post: SocialPostRecord = {
    id,
    platform,
    authorHandle: acc.handle,
    text,
    channelOrSubreddit,
    createdAtMs: nowMs,
    shadowbanned,
    impressions,
    likes,
    replies,
    clicks,
    shares,
    status: "published",
    comments: [],
  };
  ctx.state.socialPosts.set(id, post);
  return post;
}

export function advanceSocialEngagement(ctx: ServiceContext, hours = 1): { updatedPosts: number; newClicks: number } {
  let updatedPosts = 0;
  let newClicks = 0;
  const nowMs = ctx.registry.clock.now();
  for (const post of ctx.state.socialPosts.values()) {
    if (post.status !== "published" || post.shadowbanned) continue;
    const ageHours = Math.max(1, (nowMs - post.createdAtMs) / 3_600_000);
    if (ageHours > 72) continue;
    const decay = Math.exp(-ageHours / 24);
    const rng = ctx.registry.forkRng(ctx.state, "social_tick", post.id, Math.floor(nowMs / 3_600_000));
    const addedImpressions = Math.max(0, Math.round(rng.int(30, 450) * decay * hours));
    const addedClicks = Math.floor(addedImpressions * rng.range(0.008, 0.03));
    post.impressions += addedImpressions;
    post.likes += Math.floor(addedImpressions * rng.range(0.02, 0.07));
    post.clicks += addedClicks;
    newClicks += addedClicks;
    updatedPosts += 1;
  }
  return { updatedPosts, newClicks };
}

export async function handleSocialRequest(
  ctx: ServiceContext,
  req: Request,
  url: URL,
): Promise<ServiceResult | null> {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const match = /^\/social\/(x|instagram|tiktok|reddit|linkedin|discord)(\/.*)?$/.exec(path);
  if (!match) return null;

  const platform = match[1] as SocialPlatform;
  const subPath = match[2] ?? "/";
  const nowMs = ctx.registry.clock.now();
  const isForm = (req.headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded");
  const body: Record<string, unknown> =
    req.method === "GET" || req.method === "HEAD"
      ? {}
      : isForm
        ? await parseFormBody(req)
        : await parseJsonBody(req);
  const handle = resolveHandle(req, body);
  const acc = getOrCreateAccount(ctx, platform, handle);

  const rlCheck = ctx.chaos.checkRateLimit(
    ctx.state.sessionId,
    platform,
    `${acc.handle}:${req.method}:${subPath.split("/").slice(0, 3).join("/")}`,
    path,
    nowMs,
    PLATFORM_RATE_LIMITS[platform],
  );
  const rateHeaders = buildRateHeaders(platform, rlCheck.result);
  const rateMeta = {
    limit: rlCheck.result.limit,
    remaining: rlCheck.result.remaining,
    resetAtSec: rlCheck.result.resetAtSec,
  };

  if (!rlCheck.result.allowed) {
    const errBody =
      platform === "discord"
        ? { message: "You are being rate limited.", retry_after: rlCheck.result.retryAfterSec, global: false }
        : platform === "tiktok"
          ? { error: { code: "rate_limit_exceeded", message: "Too many requests" } }
          : { title: "Too Many Requests", status: 429, detail: `Rate limit exceeded on ${platform}`, retry_after: rlCheck.result.retryAfterSec };
    return {
      service: platform,
      response: jsonResponse(errBody, 429, rateHeaders),
      requestSummary: { handle: acc.handle, subPath },
      responseSummary: errBody,
      rateLimit: rateMeta,
      chaosApplied: rlCheck.chaosRuleId,
    };
  }

  const accountGuard = checkAccountChaos(ctx, platform, path, acc, rateHeaders);
  if (accountGuard.blocked) {
    return { ...accountGuard.blocked, rateLimit: rateMeta };
  }

  if (platform === "x") {
    if (req.method === "POST" && subPath === "/2/tweets") {
      const text = strField(body, "text");
      if (!text.trim()) {
        return { service: "x", response: jsonResponse({ detail: "text is required", status: 400 }, 400, rateHeaders), rateLimit: rateMeta };
      }
      const post = createPost(ctx, "x", acc, text, accountGuard.shadowbanned, accountGuard.reachMultiplier);
      const data = { data: { id: post.id, text: post.text } };
      return {
        service: "x",
        response: jsonResponse(data, 201, rateHeaders),
        requestSummary: { handle: acc.handle, textLen: text.length },
        responseSummary: { id: post.id, shadowbanned: post.shadowbanned },
        rateLimit: rateMeta,
        chaosApplied: accountGuard.chaosRuleId,
      };
    }
    if (req.method === "GET" && /^\/2\/tweets\/[^/]+$/.test(subPath) && subPath !== "/2/tweets/search") {
      const id = subPath.slice("/2/tweets/".length);
      const post = ctx.state.socialPosts.get(id);
      if (!post || post.platform !== "x") {
        return { service: "x", response: jsonResponse({ errors: [{ title: "Not Found Error", detail: `Could not find tweet ${id}` }] }, 404, rateHeaders), rateLimit: rateMeta };
      }
      const data = {
        data: {
          id: post.id,
          text: post.text,
          created_at: new Date(post.createdAtMs).toISOString(),
          public_metrics: {
            impression_count: post.impressions,
            like_count: post.likes,
            reply_count: post.replies,
            retweet_count: post.shares,
            url_link_clicks: post.clicks,
          },
        },
      };
      return { service: "x", response: jsonResponse(data, 200, rateHeaders), responseSummary: data.data.public_metrics, rateLimit: rateMeta };
    }
    if (req.method === "GET" && subPath === "/2/tweets/search/recent") {
      const q = (url.searchParams.get("query") ?? "").toLowerCase();
      const hits = [...ctx.state.socialPosts.values()]
        .filter((p) => p.platform === "x" && !p.shadowbanned && (!q || p.text.toLowerCase().includes(q)))
        .slice(-25)
        .map((p) => ({
          id: p.id,
          text: p.text,
          public_metrics: { impression_count: p.impressions, like_count: p.likes, reply_count: p.replies },
        }));
      return { service: "x", response: jsonResponse({ data: hits, meta: { result_count: hits.length } }, 200, rateHeaders), rateLimit: rateMeta };
    }
    const dmMatch = /^\/2\/dm_conversations\/with\/([^/]+)\/messages$/.exec(subPath);
    if (req.method === "POST" && dmMatch) {
      const toHandle = decodeURIComponent(dmMatch[1]!);
      const text = strField(body, "text");
      const dmId = ctx.registry.nextId(ctx.state, "x_dm");
      ctx.state.socialDms.push({
        id: dmId,
        platform: "x",
        fromHandle: acc.handle,
        toHandle,
        text,
        createdAtMs: nowMs,
        delivered: !accountGuard.shadowbanned,
      });
      const resBody = { data: { dm_conversation_id: `conv_${toHandle}`, dm_event_id: dmId } };
      return {
        service: "x",
        response: jsonResponse(resBody, 201, rateHeaders),
        requestSummary: { toHandle, textLen: text.length },
        responseSummary: resBody.data,
        rateLimit: rateMeta,
        chaosApplied: accountGuard.chaosRuleId,
      };
    }
    const userMatch = /^\/2\/users\/by\/username\/([^/]+)$/.exec(subPath);
    if (req.method === "GET" && userMatch) {
      const target = getOrCreateAccount(ctx, "x", decodeURIComponent(userMatch[1]!));
      const data = { data: { id: target.userId, name: target.handle, username: target.handle } };
      return { service: "x", response: jsonResponse(data, 200, rateHeaders), rateLimit: rateMeta };
    }
  }

  if (platform === "instagram") {
    const mediaMatch = /^\/v21\.0\/([^/]+)\/media$/.exec(subPath);
    if (req.method === "POST" && mediaMatch) {
      const caption = strField(body, "caption");
      const post = createPost(ctx, "instagram", acc, caption, accountGuard.shadowbanned, accountGuard.reachMultiplier);
      return {
        service: "instagram",
        response: jsonResponse({ id: post.id }, 200, rateHeaders),
        responseSummary: { id: post.id, shadowbanned: post.shadowbanned },
        rateLimit: rateMeta,
        chaosApplied: accountGuard.chaosRuleId,
      };
    }
    const publishMatch = /^\/v21\.0\/([^/]+)\/media_publish$/.exec(subPath);
    if (req.method === "POST" && publishMatch) {
      const creationId = strField(body, "creation_id") || ctx.registry.nextId(ctx.state, "ig_pub");
      return {
        service: "instagram",
        response: jsonResponse({ id: creationId }, 200, rateHeaders),
        responseSummary: { id: creationId },
        rateLimit: rateMeta,
        chaosApplied: accountGuard.chaosRuleId,
      };
    }
    const msgMatch = /^\/v21\.0\/([^/]+)\/messages$/.exec(subPath);
    if (req.method === "POST" && msgMatch) {
      const recipient = (body.recipient as Record<string, unknown> | undefined)?.id;
      const msgObj = body.message as Record<string, unknown> | undefined;
      const text = strField(msgObj ?? body, "text");
      const dmId = ctx.registry.nextId(ctx.state, "ig_dm");
      ctx.state.socialDms.push({
        id: dmId,
        platform: "instagram",
        fromHandle: acc.handle,
        toHandle: typeof recipient === "string" ? recipient : "ig_recipient",
        text,
        createdAtMs: nowMs,
        delivered: !accountGuard.shadowbanned,
      });
      return {
        service: "instagram",
        response: jsonResponse({ recipient_id: recipient ?? "ig_recipient", message_id: dmId }, 200, rateHeaders),
        responseSummary: { message_id: dmId },
        rateLimit: rateMeta,
        chaosApplied: accountGuard.chaosRuleId,
      };
    }
    const commentMatch = /^\/v21\.0\/([^/]+)\/comments$/.exec(subPath);
    if (req.method === "POST" && commentMatch) {
      const mediaId = commentMatch[1]!;
      const text = strField(body, "message") || strField(body, "text");
      const commentId = ctx.registry.nextId(ctx.state, "ig_cmt");
      const post = ctx.state.socialPosts.get(mediaId);
      if (post) {
        post.comments.push({ id: commentId, author: acc.handle, text, createdAtMs: nowMs });
        post.replies += 1;
      }
      return { service: "instagram", response: jsonResponse({ id: commentId }, 200, rateHeaders), rateLimit: rateMeta };
    }
    const insightsMatch = /^\/v21\.0\/([^/]+)\/insights$/.exec(subPath);
    if (req.method === "GET" && insightsMatch) {
      const post = ctx.state.socialPosts.get(insightsMatch[1]!);
      const reach = post ? post.impressions : 0;
      const nonFollowerReach = post && !post.shadowbanned ? Math.round(post.impressions * 0.65) : 0;
      return {
        service: "instagram",
        response: jsonResponse({
          data: [
            { name: "impressions", values: [{ value: reach }] },
            { name: "reach", values: [{ value: reach }] },
            { name: "non_follower_reach", values: [{ value: nonFollowerReach }] },
            { name: "likes", values: [{ value: post?.likes ?? 0 }] },
          ],
        }, 200, rateHeaders),
        rateLimit: rateMeta,
      };
    }
  }

  if (platform === "tiktok") {
    if (req.method === "POST" && subPath === "/v2/post/publish/video/init") {
      const postInfo = (body.post_info as Record<string, unknown> | undefined) ?? body;
      const title = strField(postInfo, "title") || "short video";
      const post = createPost(ctx, "tiktok", acc, title, accountGuard.shadowbanned, accountGuard.reachMultiplier);
      if (accountGuard.shadowbanned) {
        post.impressions = Math.min(post.impressions, 180);
      }
      const resBody = { data: { publish_id: post.id, upload_url: `${ctx.baseUrl}/social/tiktok/upload/${post.id}` }, error: { code: "ok", message: "" } };
      return {
        service: "tiktok",
        response: jsonResponse(resBody, 200, rateHeaders),
        responseSummary: { publish_id: post.id, shadowbanned: post.shadowbanned },
        rateLimit: rateMeta,
        chaosApplied: accountGuard.chaosRuleId,
      };
    }
    if (req.method === "POST" && subPath === "/v2/post/publish/status/fetch") {
      const publishId = strField(body, "publish_id");
      const post = ctx.state.socialPosts.get(publishId);
      const status = !post ? "FAILED" : post.status === "published" ? "PUBLISH_COMPLETE" : "PROCESSING_UPLOAD";
      return {
        service: "tiktok",
        response: jsonResponse({ data: { status, publicaly_available_post_id: post ? [post.id] : [] }, error: { code: "ok", message: "" } }, 200, rateHeaders),
        rateLimit: rateMeta,
      };
    }
    if (req.method === "POST" && subPath === "/v2/video/query") {
      const filters = (body.filters as Record<string, unknown> | undefined) ?? {};
      const ids = Array.isArray(filters.video_ids) ? filters.video_ids.map(String) : [];
      const videos = [...ctx.state.socialPosts.values()]
        .filter((p) => p.platform === "tiktok" && (ids.length === 0 || ids.includes(p.id)))
        .map((p) => ({
          id: p.id,
          title: p.text,
          view_count: p.impressions,
          like_count: p.likes,
          comment_count: p.replies,
          share_count: p.shares,
        }));
      return { service: "tiktok", response: jsonResponse({ data: { videos }, error: { code: "ok", message: "" } }, 200, rateHeaders), rateLimit: rateMeta };
    }
    if (req.method === "POST" && subPath === "/v2/comment/reply") {
      const videoId = strField(body, "video_id");
      const text = strField(body, "text");
      const replyId = ctx.registry.nextId(ctx.state, "tt_cmt");
      const post = ctx.state.socialPosts.get(videoId);
      if (post) {
        post.comments.push({ id: replyId, author: acc.handle, text, createdAtMs: nowMs });
        post.replies += 1;
      }
      return { service: "tiktok", response: jsonResponse({ data: { comment_id: replyId }, error: { code: "ok", message: "" } }, 200, rateHeaders), rateLimit: rateMeta };
    }
  }

  if (platform === "reddit") {
    const subFeedMatch = /^\/r\/([^/]+)\/(new|hot)\.json$/.exec(subPath);
    if (req.method === "GET" && subFeedMatch) {
      const sub = subFeedMatch[1]!;
      const posts = [...ctx.state.socialPosts.values()]
        .filter((p) => p.platform === "reddit" && !p.shadowbanned && (!p.channelOrSubreddit || p.channelOrSubreddit.toLowerCase() === sub.toLowerCase()));
      const children = posts.map((p) => ({
        kind: "t3",
        data: {
          id: p.id,
          subreddit: sub,
          title: p.text.slice(0, 120),
          selftext: p.text,
          author: p.authorHandle,
          score: p.likes,
          num_comments: p.replies,
          created_utc: Math.floor(p.createdAtMs / 1000),
          permalink: `/r/${sub}/comments/${p.id}/post/`,
        },
      }));
      return { service: "reddit", response: jsonResponse({ kind: "Listing", data: { children } }, 200, rateHeaders), rateLimit: rateMeta };
    }
    if (req.method === "POST" && subPath === "/api/submit") {
      const sr = strField(body, "sr", "nyc");
      const title = strField(body, "title") || strField(body, "text");
      const post = createPost(ctx, "reddit", acc, title, accountGuard.shadowbanned, accountGuard.reachMultiplier, sr);
      return {
        service: "reddit",
        response: jsonResponse({ json: { errors: [], data: { id: post.id, name: `t3_${post.id}`, url: `https://www.reddit.com/r/${sr}/comments/${post.id}/` } } }, 200, rateHeaders),
        responseSummary: { id: post.id, subreddit: sr, shadowbanned: post.shadowbanned },
        rateLimit: rateMeta,
        chaosApplied: accountGuard.chaosRuleId,
      };
    }
    if (req.method === "POST" && subPath === "/api/comment") {
      const thingId = strField(body, "thing_id").replace(/^t3_/, "");
      const text = strField(body, "text");
      const commentId = ctx.registry.nextId(ctx.state, "rd_cmt");
      const post = ctx.state.socialPosts.get(thingId);
      if (post) {
        post.comments.push({ id: commentId, author: acc.handle, text, createdAtMs: nowMs });
        post.replies += 1;
      }
      return { service: "reddit", response: jsonResponse({ json: { errors: [], data: { things: [{ data: { id: commentId, body: text } }] } } }, 200, rateHeaders), rateLimit: rateMeta };
    }
    if (req.method === "POST" && subPath === "/api/compose") {
      const to = strField(body, "to");
      const text = strField(body, "text");
      const dmId = ctx.registry.nextId(ctx.state, "rd_dm");
      ctx.state.socialDms.push({ id: dmId, platform: "reddit", fromHandle: acc.handle, toHandle: to, text, createdAtMs: nowMs, delivered: !accountGuard.shadowbanned });
      return { service: "reddit", response: jsonResponse({ json: { errors: [], data: { id: dmId } } }, 200, rateHeaders), rateLimit: rateMeta };
    }
  }

  if (platform === "linkedin") {
    if (req.method === "GET" && subPath === "/v2/me") {
      return { service: "linkedin", response: jsonResponse({ id: acc.userId, localizedFirstName: acc.handle }, 200, rateHeaders), rateLimit: rateMeta };
    }
    if (req.method === "POST" && (subPath === "/v2/rest/posts" || subPath === "/rest/posts")) {
      const text = strField(body, "commentary") || strField(body, "text");
      const post = createPost(ctx, "linkedin", acc, text, accountGuard.shadowbanned, accountGuard.reachMultiplier);
      const urn = `urn:li:share:${post.id}`;
      return {
        service: "linkedin",
        response: jsonResponse({ id: urn }, 201, { ...rateHeaders, "x-restli-id": urn }),
        responseSummary: { id: urn, shadowbanned: post.shadowbanned },
        rateLimit: rateMeta,
        chaosApplied: accountGuard.chaosRuleId,
      };
    }
    if (req.method === "POST" && subPath === "/v2/messages") {
      const to = strField(body, "recipient") || "li_member";
      const text = strField(body, "body") || strField(body, "text");
      const dmId = ctx.registry.nextId(ctx.state, "li_dm");
      ctx.state.socialDms.push({ id: dmId, platform: "linkedin", fromHandle: acc.handle, toHandle: to, text, createdAtMs: nowMs, delivered: !accountGuard.shadowbanned });
      return { service: "linkedin", response: jsonResponse({ id: dmId }, 201, rateHeaders), rateLimit: rateMeta };
    }
    const commentMatch = /^\/v2\/socialActions\/([^/]+)\/comments$/.exec(subPath);
    if (req.method === "POST" && commentMatch) {
      const cmtId = ctx.registry.nextId(ctx.state, "li_cmt");
      return { service: "linkedin", response: jsonResponse({ id: cmtId, object: decodeURIComponent(commentMatch[1]!) }, 201, rateHeaders), rateLimit: rateMeta };
    }
  }

  if (platform === "discord") {
    const chMsgMatch = /^\/api\/v10\/channels\/([^/]+)\/messages$/.exec(subPath);
    if (chMsgMatch) {
      const channelId = chMsgMatch[1]!;
      if (req.method === "POST") {
        const content = strField(body, "content");
        const post = createPost(ctx, "discord", acc, content, accountGuard.shadowbanned, accountGuard.reachMultiplier, channelId);
        return {
          service: "discord",
          response: jsonResponse({ id: post.id, channel_id: channelId, content: post.text, timestamp: new Date(post.createdAtMs).toISOString() }, 200, rateHeaders),
          responseSummary: { id: post.id, channel_id: channelId },
          rateLimit: rateMeta,
          chaosApplied: accountGuard.chaosRuleId,
        };
      }
      if (req.method === "GET") {
        const msgs = [...ctx.state.socialPosts.values()]
          .filter((p) => p.platform === "discord" && p.channelOrSubreddit === channelId)
          .slice(-50)
          .map((p) => ({ id: p.id, channel_id: channelId, content: p.text, timestamp: new Date(p.createdAtMs).toISOString() }));
        return { service: "discord", response: jsonResponse(msgs, 200, rateHeaders), rateLimit: rateMeta };
      }
    }
    if (req.method === "POST" && subPath === "/api/v10/users/@me/channels") {
      const recipientId = strField(body, "recipient_id") || "discord_user";
      const channelId = `dm_${recipientId}`;
      return { service: "discord", response: jsonResponse({ id: channelId, type: 1, recipients: [{ id: recipientId }] }, 200, rateHeaders), rateLimit: rateMeta };
    }
    const threadMatch = /^\/api\/v10\/channels\/([^/]+)\/threads$/.exec(subPath);
    if (req.method === "POST" && threadMatch) {
      const threadId = ctx.registry.nextId(ctx.state, "dc_thr");
      return { service: "discord", response: jsonResponse({ id: threadId, parent_id: threadMatch[1], name: strField(body, "name", "thread") }, 201, rateHeaders), rateLimit: rateMeta };
    }
  }

  return {
    service: platform,
    response: jsonResponse({ error: `Unhandled ${platform} route ${req.method} ${subPath}` }, 404, rateHeaders),
    rateLimit: rateMeta,
  };
}
