import { parse as parseCookie, serialize as serializeCookie } from "cookie";
import cors from "cors";
import express from "express";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Express, Request, Response } from "express";
import {
  doubanProxyLoginQrStartSchema,
  doubanProxyLoginPasswordSchema,
  doubanProxyLoginSmsSendSchema,
  doubanProxyLoginSmsVerifySchema,
  importDoubanSessionSchema,
  mediumSchema,
  paginationSchema,
  shelfStatusSchema,
  subjectCommentVoteSchema,
  timelineActionTargetSchema,
  timelineReplySchema,
  timelineRepostSchema,
  timelineScopeSchema,
  updateLibraryStateSchema
} from "../../../packages/shared/src";
import type { AppConfig } from "./config";
import { loadConfig } from "./config";
import { AppDatabase } from "./db";
import { DoubanClient, DoubanSessionError } from "./douban/client";
import { createSessionToken } from "./security";
import { ProxyLoginAttemptNotFoundError, ProxyLoginService } from "./services/proxy-login";
import { SyncService } from "./services/sync";

const sessionCookieName = "douban_lite_session";

export interface AppContext {
  app: Express;
  config: AppConfig;
  db: AppDatabase;
  sync: SyncService;
  close: () => void;
}

interface AuthenticatedRequest extends Request {
  currentUserId?: string | null;
}

function badRequest(response: Response, message: string, issues?: unknown) {
  response.status(400).json({ error: message, issues });
}

function unauthorized(response: Response, message = "需要先登录。") {
  response.status(401).json({ error: message });
}

function isAllowedImageUrl(url: URL) {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return false;
  }
  const host = url.hostname.toLowerCase();
  return (
    host === "127.0.0.1" ||
    host === "localhost" ||
    host === "douban.com" ||
    host.endsWith(".douban.com") ||
    host === "doubanio.com" ||
    host.endsWith(".doubanio.com") ||
    host === "hdslb.com" ||
    host.endsWith(".hdslb.com") ||
    host === "bilibili.com" ||
    host.endsWith(".bilibili.com")
  );
}

function allowedOrigins(origin: string | null) {
  if (!origin) {
    return true;
  }
  const origins = new Set([origin]);
  try {
    const parsed = new URL(origin);
    if (parsed.hostname === "127.0.0.1") {
      parsed.hostname = "localhost";
      origins.add(parsed.toString().replace(/\/$/, ""));
    } else if (parsed.hostname === "localhost") {
      parsed.hostname = "127.0.0.1";
      origins.add(parsed.toString().replace(/\/$/, ""));
    }
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
      for (let port = 5173; port <= 5179; port += 1) {
        origins.add(`http://localhost:${port}`);
        origins.add(`http://127.0.0.1:${port}`);
      }
    }
  } catch {
    // ignore malformed origin
  }
  return Array.from(origins);
}

function serveWebApp(app: Express, webDistDir: string) {
  const indexFile = join(webDistDir, "index.html");
  if (!existsSync(indexFile)) {
    return;
  }
  app.use(express.static(webDistDir));
  app.get(/^\/(?!api(?:\/|$)|health$).*/, (_request, response) => {
    response.sendFile(indexFile);
  });
}

function resolveSessionToken(request: Request) {
  const cookies = parseCookie(request.headers.cookie ?? "");
  return cookies[sessionCookieName] ?? null;
}

function writeSessionCookie(response: Response, config: AppConfig, token: string | null, expiresAt?: Date) {
  response.append(
    "Set-Cookie",
    serializeCookie(sessionCookieName, token ?? "", {
      httpOnly: true,
      sameSite: "lax",
      secure: config.nodeEnv === "production",
      path: "/",
      expires: token && expiresAt ? expiresAt : new Date(0)
    })
  );
}

function requireUser(request: AuthenticatedRequest, response: Response) {
  if (!request.currentUserId) {
    unauthorized(response);
    return null;
  }
  return request.currentUserId;
}

function routeParam(value: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export function createApp(overrides?: Partial<AppConfig>): AppContext {
  const config = { ...loadConfig(), ...overrides };
  const db = new AppDatabase(config.databaseFile);
  const client = new DoubanClient(config);
  const sync = new SyncService(db, client, config);
  const proxyLogin = new ProxyLoginService(client, {
    accountsBaseUrl: config.doubanAccountsBaseUrl,
    attemptTtlMinutes: config.doubanProxyLoginAttemptTtlMinutes,
    rateLimitPerIp: config.doubanProxyLoginRateLimitPerIp
  });
  const app = express();

  app.use(
    cors({
      origin: allowedOrigins(config.allowedOrigin),
      credentials: true
    })
  );
  app.use(express.json({ limit: "1mb" }));
  app.use((request: AuthenticatedRequest, _response, next) => {
    const user = sync.getAuthenticatedUser(resolveSessionToken(request));
    request.currentUserId = user?.id ?? null;
    next();
  });

  async function finalizeAuthorizedProxyLogin(response: Response, result: { loginAttemptId: string; status: string; cookie?: string }) {
    if (result.status !== "authorized" || !result.cookie) {
      response.json(result);
      return;
    }
    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + config.sessionTtlDays * 24 * 60 * 60 * 1000);
    const payload = await sync.loginWithDoubanCookie({ cookie: result.cookie }, token, expiresAt.toISOString());
    proxyLogin.claim(result.loginAttemptId);
    writeSessionCookie(response, config, token, expiresAt);
    const { cookie: _cookie, ...safeResult } = result;
    response.json({ ...safeResult, status: "claimed", user: payload.user, sessionStatus: payload.sessionStatus });
  }

  app.get("/health", (_request, response) => {
    response.json({
      status: "ok",
      app: "douban-lite",
      schedulerEnabled: !config.disableAutoSync
    });
  });

  app.post("/api/auth/douban", async (request, response, next) => {
    try {
      const body = importDoubanSessionSchema.safeParse(request.body);
      if (!body.success) {
        badRequest(response, "Cookie 导入参数无效。", body.error.flatten());
        return;
      }
      const token = createSessionToken();
      const expiresAt = new Date(Date.now() + config.sessionTtlDays * 24 * 60 * 60 * 1000);
      const payload = await sync.loginWithDoubanCookie(body.data, token, expiresAt.toISOString());
      writeSessionCookie(response, config, token, expiresAt);
      response.json(payload);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/auth/douban/proxy/config", async (_request, response, next) => {
    try {
      response.json({
        enabled: config.doubanProxyLoginEnabled,
        ...(await proxyLogin.getClientConfig())
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/auth/douban/proxy/start", async (request, response, next) => {
    if (!config.doubanProxyLoginEnabled) {
      response.status(403).json({ error: "代理豆瓣登录未启用。" });
      return;
    }
    try {
      response.json(await proxyLogin.start(request.ip ?? "unknown"));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/auth/douban/proxy/:loginAttemptId/status", async (request, response, next) => {
    try {
      const status = await proxyLogin.getStatus(routeParam(request.params.loginAttemptId));
      if (!status) {
        response.status(404).json({ error: "代理登录会话不存在。" });
        return;
      }
      await finalizeAuthorizedProxyLogin(response, status);
    } catch (error) {
      if (error instanceof ProxyLoginAttemptNotFoundError) {
        response.status(404).json({ error: "代理登录会话不存在。" });
        return;
      }
      next(error);
    }
  });

  app.post("/api/auth/douban/proxy/qr/start", async (request, response, next) => {
    if (!config.doubanProxyLoginEnabled) {
      response.status(403).json({ error: "代理豆瓣登录未启用。" });
      return;
    }
    try {
      const body = doubanProxyLoginQrStartSchema.safeParse(request.body);
      if (!body.success) {
        badRequest(response, "二维码登录参数无效。", body.error.flatten());
        return;
      }
      response.json(await proxyLogin.startQrLogin(body.data));
    } catch (error) {
      if (error instanceof ProxyLoginAttemptNotFoundError) {
        response.status(404).json({ error: "代理登录会话不存在。" });
        return;
      }
      next(error);
    }
  });

  app.post("/api/auth/douban/proxy/password", async (request, response, next) => {
    if (!config.doubanProxyLoginEnabled) {
      response.status(403).json({ error: "代理豆瓣登录未启用。" });
      return;
    }
    try {
      const body = doubanProxyLoginPasswordSchema.safeParse(request.body);
      if (!body.success) {
        badRequest(response, "代理密码登录参数无效。", body.error.flatten());
        return;
      }
      const result = await proxyLogin.submitPassword(body.data);
      await finalizeAuthorizedProxyLogin(response, result);
    } catch (error) {
      if (error instanceof ProxyLoginAttemptNotFoundError) {
        response.status(404).json({ error: "代理登录会话不存在。" });
        return;
      }
      next(error);
    }
  });

  app.post("/api/auth/douban/proxy/sms/send", async (request, response, next) => {
    if (!config.doubanProxyLoginEnabled) {
      response.status(403).json({ error: "代理豆瓣登录未启用。" });
      return;
    }
    try {
      const body = doubanProxyLoginSmsSendSchema.safeParse(request.body);
      if (!body.success) {
        badRequest(response, "SMS 发码参数无效。", body.error.flatten());
        return;
      }
      response.json(await proxyLogin.sendSmsCode(body.data));
    } catch (error) {
      if (error instanceof ProxyLoginAttemptNotFoundError) {
        response.status(404).json({ error: "代理登录会话不存在。" });
        return;
      }
      next(error);
    }
  });

  app.post("/api/auth/douban/proxy/sms/verify", async (request, response, next) => {
    if (!config.doubanProxyLoginEnabled) {
      response.status(403).json({ error: "代理豆瓣登录未启用。" });
      return;
    }
    try {
      const body = doubanProxyLoginSmsVerifySchema.safeParse(request.body);
      if (!body.success) {
        badRequest(response, "SMS 验证码参数无效。", body.error.flatten());
        return;
      }
      const result = await proxyLogin.verifySmsCode(body.data);
      await finalizeAuthorizedProxyLogin(response, result);
    } catch (error) {
      if (error instanceof ProxyLoginAttemptNotFoundError) {
        response.status(404).json({ error: "代理登录会话不存在。" });
        return;
      }
      next(error);
    }
  });

  app.post("/api/auth/douban/proxy/:loginAttemptId/cancel", (request, response) => {
    const status = proxyLogin.cancel(routeParam(request.params.loginAttemptId));
    if (!status) {
      response.status(404).json({ error: "代理登录会话不存在。" });
      return;
    }
    response.json(status);
  });

  app.get("/api/auth/me", (request: AuthenticatedRequest, response) => {
    response.json(sync.getAuthMe(request.currentUserId ?? null));
  });

  app.get("/api/session/me", (request: AuthenticatedRequest, response) => {
    response.json(sync.getAuthMe(request.currentUserId ?? null));
  });

  app.post("/api/auth/logout", (request: AuthenticatedRequest, response) => {
    sync.logout(resolveSessionToken(request));
    writeSessionCookie(response, config, null);
    response.json({ ok: true });
  });

  app.get("/api/me/overview", async (request: AuthenticatedRequest, response, next) => {
    const userId = requireUser(request, response);
    if (!userId) {
      return;
    }
    try {
      response.json(await sync.getOverview(userId));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/library", async (request: AuthenticatedRequest, response, next) => {
    const userId = requireUser(request, response);
    if (!userId) {
      return;
    }
    try {
      const medium = mediumSchema.safeParse(request.query.medium);
      const status = request.query.status == null ? null : shelfStatusSchema.safeParse(request.query.status);
      const pagination = paginationSchema.safeParse(request.query);
      if (!medium.success || (status != null && !status.success) || !pagination.success) {
        badRequest(response, "书影音列表请求参数无效。", {
          medium: medium.success ? null : medium.error.flatten(),
          status: status == null || status.success ? null : status.error.flatten(),
          pagination: pagination.success ? null : pagination.error.flatten()
        });
        return;
      }
      response.json(await sync.listLibrary(userId, { medium: medium.data, status: status?.success ? status.data : undefined, page: pagination.data.page, pageSize: pagination.data.pageSize }));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/subjects/search", async (request: AuthenticatedRequest, response, next) => {
    try {
      const medium = mediumSchema.safeParse(request.query.medium);
      const query = String(request.query.q ?? "").trim();
      if (!medium.success || query.length === 0) {
        badRequest(response, "搜索参数无效。");
        return;
      }
      response.json(await sync.searchSubjects(request.currentUserId ?? null, medium.data, query));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/subjects/:medium/:doubanId/comments", async (request: AuthenticatedRequest, response, next) => {
    try {
      const medium = mediumSchema.safeParse(request.params.medium);
      const start = Math.max(0, Number(request.query.start ?? 0));
      const limit = Math.min(50, Math.max(1, Number(request.query.limit ?? 20)));
      if (!medium.success || !Number.isFinite(start) || !Number.isFinite(limit)) {
        badRequest(response, "短评请求参数无效。");
        return;
      }
      response.json(await sync.getSubjectComments(request.currentUserId ?? null, medium.data, routeParam(request.params.doubanId), Math.floor(start), Math.floor(limit)));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/subjects/:medium/:doubanId/comments/vote", async (request: AuthenticatedRequest, response, next) => {
    const userId = requireUser(request, response);
    if (!userId) {
      return;
    }
    try {
      const medium = mediumSchema.safeParse(request.params.medium);
      const body = subjectCommentVoteSchema.safeParse(request.body);
      if (!medium.success || !body.success) {
        badRequest(response, "短评投票参数无效。", {
          medium: medium.success ? null : medium.error.flatten(),
          body: body.success ? null : body.error.flatten()
        });
        return;
      }
      response.json(await sync.voteSubjectComment(userId, medium.data, routeParam(request.params.doubanId), body.data.commentId));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/subjects/:medium/:doubanId", async (request: AuthenticatedRequest, response, next) => {
    try {
      const medium = mediumSchema.safeParse(request.params.medium);
      if (!medium.success) {
        badRequest(response, "媒介类型无效。");
        return;
      }
      response.json(await sync.getSubjectDetail(request.currentUserId ?? null, medium.data, routeParam(request.params.doubanId)));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/rankings", async (request: AuthenticatedRequest, response, next) => {
    try {
      const medium = mediumSchema.safeParse(request.query.medium);
      const board = String(request.query.board ?? "");
      if (!medium.success || board.length === 0) {
        badRequest(response, "榜单请求参数无效。");
        return;
      }
      response.json(await sync.getRanking(request.currentUserId ?? null, medium.data, board));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/timeline", async (request: AuthenticatedRequest, response, next) => {
    const userId = requireUser(request, response);
    if (!userId) {
      return;
    }
    try {
      const scope = timelineScopeSchema.safeParse(request.query.scope ?? "following");
      if (!scope.success) {
        badRequest(response, "动态请求参数无效。", scope.error.flatten());
        return;
      }
      const start = Number(request.query.start ?? 0);
      if (!Number.isInteger(start) || start < 0) {
        badRequest(response, "动态请求参数无效。", { start: "start 必须是大于等于 0 的整数。" });
        return;
      }
      response.json(await sync.getTimeline(userId, scope.data, start));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/timeline/:statusId/comments", async (request: AuthenticatedRequest, response, next) => {
    const userId = requireUser(request, response);
    if (!userId) {
      return;
    }
    try {
      const body = timelineActionTargetSchema.safeParse(request.body);
      if (!body.success) {
        badRequest(response, "动态评论请求参数无效。", body.error.flatten());
        return;
      }
      response.json(await sync.getTimelineComments(userId, routeParam(request.params.statusId), body.data.detailUrl));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/timeline/:statusId/like", async (request: AuthenticatedRequest, response, next) => {
    const userId = requireUser(request, response);
    if (!userId) {
      return;
    }
    try {
      const body = timelineActionTargetSchema.safeParse(request.body);
      if (!body.success) {
        badRequest(response, "动态点赞参数无效。", body.error.flatten());
        return;
      }
      response.json(await sync.likeTimelineStatus(userId, routeParam(request.params.statusId), body.data.detailUrl));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/timeline/:statusId/reply", async (request: AuthenticatedRequest, response, next) => {
    const userId = requireUser(request, response);
    if (!userId) {
      return;
    }
    try {
      const body = timelineReplySchema.safeParse(request.body);
      if (!body.success) {
        badRequest(response, "动态回复参数无效。", body.error.flatten());
        return;
      }
      response.json(await sync.replyTimelineStatus(userId, routeParam(request.params.statusId), body.data.detailUrl, body.data.text));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/timeline/:statusId/repost", async (request: AuthenticatedRequest, response, next) => {
    const userId = requireUser(request, response);
    if (!userId) {
      return;
    }
    try {
      const body = timelineRepostSchema.safeParse(request.body);
      if (!body.success) {
        badRequest(response, "动态转发参数无效。", body.error.flatten());
        return;
      }
      response.json(await sync.repostTimelineStatus(userId, routeParam(request.params.statusId), body.data.detailUrl, body.data.text));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/library/:medium/:doubanId/state", async (request: AuthenticatedRequest, response, next) => {
    const userId = requireUser(request, response);
    if (!userId) {
      return;
    }
    try {
      const medium = mediumSchema.safeParse(request.params.medium);
      const body = updateLibraryStateSchema.safeParse(request.body);
      if (!medium.success || !body.success) {
        badRequest(response, "标记更新参数无效。", {
          medium: medium.success ? null : medium.error.flatten(),
          body: body.success ? null : body.error.flatten()
        });
        return;
      }
      response.json(await sync.updateLibraryState(userId, medium.data, routeParam(request.params.doubanId), { status: body.data.status, rating: body.data.rating ?? null, comment: body.data.comment ?? "", tags: body.data.tags ?? [], syncToTimeline: body.data.syncToTimeline ?? true }));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/settings/douban-session/import", async (request, response, next) => {
    try {
      const body = importDoubanSessionSchema.safeParse(request.body);
      if (!body.success) {
        badRequest(response, "Cookie 导入参数无效。", body.error.flatten());
        return;
      }
      const token = createSessionToken();
      const expiresAt = new Date(Date.now() + config.sessionTtlDays * 24 * 60 * 60 * 1000);
      const payload = await sync.loginWithDoubanCookie(body.data, token, expiresAt.toISOString());
      writeSessionCookie(response, config, token, expiresAt);
      response.json(payload.sessionStatus);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/settings/douban-session/logout", (request: AuthenticatedRequest, response) => {
    sync.logout(resolveSessionToken(request));
    writeSessionCookie(response, config, null);
    response.json({ status: "missing", peopleId: null, displayName: null, avatarUrl: null, ipLocation: null, lastCheckedAt: null, lastError: null });
  });

  app.get("/api/settings/douban-session/status", (request: AuthenticatedRequest, response) => {
    if (!request.currentUserId) {
      response.json({ status: "missing", peopleId: null, displayName: null, avatarUrl: null, ipLocation: null, lastCheckedAt: null, lastError: null });
      return;
    }
    response.json(sync.getSessionStatus(request.currentUserId));
  });

  app.get("/api/image", async (request, response, next) => {
    try {
      const rawUrl = String(request.query.url ?? "");
      let imageUrl: URL;
      try {
        imageUrl = new URL(rawUrl);
      } catch {
        badRequest(response, "图片地址无效。");
        return;
      }
      if (!isAllowedImageUrl(imageUrl)) {
        badRequest(response, "图片来源域名不被允许。");
        return;
      }
      const upstream = await fetch(imageUrl, {
        headers: {
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          referer: imageUrl.hostname.endsWith("doubanio.com") ? "https://www.douban.com/" : imageUrl.origin
        }
      });
      if (!upstream.ok) {
        response.status(upstream.status).json({ error: `图片请求失败：${upstream.status}` });
        return;
      }
      const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
      const buffer = Buffer.from(await upstream.arrayBuffer());
      response.setHeader("content-type", contentType);
      response.setHeader("cache-control", "public, max-age=86400, stale-while-revalidate=604800");
      response.send(buffer);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/sync/pull", async (request: AuthenticatedRequest, response, next) => {
    const userId = requireUser(request, response);
    if (!userId) {
      return;
    }
    try {
      response.json(await sync.triggerManualPull(userId));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/sync/jobs/:jobId", (request: AuthenticatedRequest, response) => {
    const userId = requireUser(request, response);
    if (!userId) {
      return;
    }
    const job = sync.getSyncJob(userId, routeParam(request.params.jobId));
    if (!job) {
      response.status(404).json({ error: "同步任务不存在。" });
      return;
    }
    response.json(job);
  });

  app.get("/api/sync/events", (request: AuthenticatedRequest, response) => {
    const userId = requireUser(request, response);
    if (!userId) {
      return;
    }
    response.json({ items: sync.listSyncEvents(userId) });
  });

  serveWebApp(app, config.webDistDir);

  app.use((error: unknown, _request: Request, response: Response, _next: unknown) => {
    if (error instanceof DoubanSessionError) {
      response.status(401).json({ error: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : "Unknown error.";
    response.status(500).json({ error: message });
  });

  return {
    app,
    config,
    db,
    sync,
    close: () => {
      sync.stop();
      db.close();
    }
  };
}
