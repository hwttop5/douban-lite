import express from "express";
import cors from "cors";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Express, Request, Response } from "express";
import {
  importDoubanSessionSchema,
  mediumSchema,
  paginationSchema,
  shelfStatusSchema,
  timelineScopeSchema,
  updateLibraryStateSchema
} from "../../../packages/shared/src";
import type { AppConfig } from "./config";
import { loadConfig } from "./config";
import { AppDatabase } from "./db";
import { DoubanClient } from "./douban/client";
import { SyncService } from "./services/sync";

export interface AppContext {
  app: Express;
  config: AppConfig;
  db: AppDatabase;
  sync: SyncService;
  close: () => void;
}

function badRequest(response: Response, message: string, issues?: unknown) {
  response.status(400).json({ error: message, issues });
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
    host.endsWith(".doubanio.com")
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
    // Keep the configured origin as-is.
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

export function createApp(overrides?: Partial<AppConfig>): AppContext {
  const config = { ...loadConfig(), ...overrides };
  const db = new AppDatabase(config.databaseFile);
  const client = new DoubanClient(config);
  const sync = new SyncService(db, client, config);
  const app = express();

  app.use(
    cors({
      origin: allowedOrigins(config.allowedOrigin),
      credentials: true
    })
  );
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_request, response) => {
    response.json({
      status: "ok",
      app: "douban-lite",
      schedulerEnabled: !config.disableAutoSync
    });
  });

  app.get("/api/me/overview", (_request, response) => {
    response.json(sync.getOverview());
  });

  app.get("/api/library", async (request, response, next) => {
    try {
      const medium = mediumSchema.safeParse(request.query.medium);
      const status = request.query.status == null ? null : shelfStatusSchema.safeParse(request.query.status);
      const pagination = paginationSchema.safeParse(request.query);
      if (!medium.success || (status != null && !status.success) || !pagination.success) {
        badRequest(response, "Invalid library query", {
          medium: medium.success ? null : medium.error.flatten(),
          status: status == null || status.success ? null : status.error.flatten(),
          pagination: pagination.success ? null : pagination.error.flatten()
        });
        return;
      }
      response.json(
        await sync.listLibrary({
          medium: medium.data,
          status: status?.success ? status.data : undefined,
          page: pagination.data.page,
          pageSize: pagination.data.pageSize
        })
      );
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/subjects/search", async (request, response, next) => {
    try {
      const medium = mediumSchema.safeParse(request.query.medium);
      const query = String(request.query.q ?? "").trim();
      if (!medium.success || query.length === 0) {
        badRequest(response, "Invalid search query");
        return;
      }
      response.json(await sync.searchSubjects(medium.data, query));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/subjects/:medium/:doubanId/comments", async (request, response, next) => {
    try {
      const medium = mediumSchema.safeParse(request.params.medium);
      const start = Math.max(0, Number(request.query.start ?? 0));
      const limit = Math.min(50, Math.max(1, Number(request.query.limit ?? 20)));
      if (!medium.success || !Number.isFinite(start) || !Number.isFinite(limit)) {
        badRequest(response, "Invalid comments query");
        return;
      }
      response.json(await sync.getSubjectComments(medium.data, request.params.doubanId, Math.floor(start), Math.floor(limit)));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/subjects/:medium/:doubanId", async (request, response, next) => {
    try {
      const medium = mediumSchema.safeParse(request.params.medium);
      if (!medium.success) {
        badRequest(response, "Invalid medium");
        return;
      }
      response.json(await sync.getSubjectDetail(medium.data, request.params.doubanId));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/rankings", async (request, response, next) => {
    try {
      const medium = mediumSchema.safeParse(request.query.medium);
      const board = String(request.query.board ?? "");
      if (!medium.success || board.length === 0) {
        badRequest(response, "Invalid ranking query");
        return;
      }
      response.json(await sync.getRanking(medium.data, board));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/timeline", async (request, response, next) => {
    try {
      const scope = timelineScopeSchema.safeParse(request.query.scope ?? "following");
      if (!scope.success) {
        badRequest(response, "Invalid timeline query", scope.error.flatten());
        return;
      }
      response.json(await sync.getTimeline(scope.data));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/library/:medium/:doubanId/state", async (request, response, next) => {
    try {
      const medium = mediumSchema.safeParse(request.params.medium);
      const body = updateLibraryStateSchema.safeParse(request.body);
      if (!medium.success || !body.success) {
        badRequest(response, "Invalid state update", {
          medium: medium.success ? null : medium.error.flatten(),
          body: body.success ? null : body.error.flatten()
        });
        return;
      }
      response.json(
        await sync.updateLibraryState(medium.data, request.params.doubanId, {
          status: body.data.status,
          rating: body.data.rating ?? null
        })
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/settings/douban-session/import", async (request, response, next) => {
    try {
      const body = importDoubanSessionSchema.safeParse(request.body);
      if (!body.success) {
        badRequest(response, "Invalid douban session payload", body.error.flatten());
        return;
      }
      response.json(await sync.importDoubanSession(body.data));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/settings/douban-session/logout", (_request, response) => {
    response.json(sync.logoutDoubanSession());
  });

  app.get("/api/settings/douban-session/status", (_request, response) => {
    response.json(sync.getSessionStatus());
  });

  app.get("/api/image", async (request, response, next) => {
    try {
      const rawUrl = String(request.query.url ?? "");
      let imageUrl: URL;
      try {
        imageUrl = new URL(rawUrl);
      } catch {
        badRequest(response, "Invalid image URL");
        return;
      }
      if (!isAllowedImageUrl(imageUrl)) {
        badRequest(response, "Image host is not allowed");
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
        response.status(upstream.status).json({ error: `Image request failed: ${upstream.status}` });
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

  app.post("/api/sync/pull", async (_request, response, next) => {
    try {
      response.json(await sync.triggerManualPull());
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/sync/jobs/:jobId", (request, response) => {
    const job = sync.getSyncJob(request.params.jobId);
    if (!job) {
      response.status(404).json({ error: "Job not found" });
      return;
    }
    response.json(job);
  });

  app.get("/api/sync/events", (_request, response) => {
    response.json({ items: sync.listSyncEvents() });
  });

  serveWebApp(app, config.webDistDir);

  app.use((error: unknown, _request: Request, response: Response, _next: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
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
