import type {
  DoubanSessionStatus,
  LibraryResponse,
  Medium,
  RankingResponse,
  SearchResponse,
  ShelfStatus,
  SubjectCommentsResponse,
  SubjectDetailResponse,
  SyncJobRecord,
  SyncJobType,
  TimelineResponse,
  TimelineScope
} from "../../../../packages/shared/src";
import { boardCatalog, mediums, shelfStatuses } from "../../../../packages/shared/src";
import type { AppConfig } from "../config";
import { AppDatabase } from "../db";
import { DoubanClient, DoubanSessionError } from "../douban/client";

const RANKING_CACHE_TTL_MS = 1000 * 60 * 60 * 24;

function nowIso() {
  return new Date().toISOString();
}

export class SyncService {
  private processing = false;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly db: AppDatabase,
    private readonly client: DoubanClient,
    private readonly config: Pick<AppConfig, "syncIntervalHours" | "disableAutoSync">
  ) {}

  start() {
    this.stopped = false;
    if (this.config.disableAutoSync) {
      return;
    }
    const intervalMs = this.config.syncIntervalHours * 60 * 60 * 1000;
    this.timer = setInterval(() => {
      void this.enqueueJob("scheduled_pull");
    }, intervalMs);
  }

  stop() {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getSessionStatus(): DoubanSessionStatus {
    return this.db.getDoubanSessionStatus();
  }

  async importDoubanSession(input: { cookie: string; peopleId?: string }) {
    const validation = await this.client.validateSession(input.cookie, input.peopleId);
    this.db.saveDoubanSession({
      cookie: input.cookie,
      peopleId: validation.peopleId ?? null,
      displayName: validation.displayName ?? null,
      avatarUrl: validation.avatarUrl ?? null,
      ipLocation: validation.ipLocation ?? null,
      status: validation.status,
      lastCheckedAt: nowIso(),
      lastError: null
    });
    this.db.addSyncEvent("info", "豆瓣登录态已更新", {
      peopleId: validation.peopleId
    });
    return this.db.getDoubanSessionStatus();
  }

  logoutDoubanSession() {
    this.db.clearDoubanSession();
    this.db.addSyncEvent("info", "豆瓣登录态已退出", {});
    return this.db.getDoubanSessionStatus();
  }

  async searchSubjects(medium: Medium, query: string): Promise<SearchResponse> {
    const session = this.db.getDoubanCookie();
    try {
      const items = await this.client.searchSubjects(medium, query, session?.cookie);
      items.forEach((item) => this.db.upsertSubject(item));
      return { items };
    } catch (error) {
      const cachedItems = this.db.searchSubjects(medium, query);
      if (cachedItems.length > 0) {
        this.db.addSyncEvent("warn", "豆瓣实时搜索失败，已返回本地镜像结果", {
          medium,
          query,
          message: error instanceof Error ? error.message : "Unknown search error"
        });
        return { items: cachedItems };
      }
      throw error;
    }
  }

  async getSubjectDetail(medium: Medium, doubanId: string): Promise<SubjectDetailResponse> {
    const session = this.db.getDoubanCookie();
    let subject = this.db.getSubject(medium, doubanId);
    let comments: SubjectDetailResponse["comments"] = [];

    if (session?.cookie || !subject) {
      try {
        const detail = await this.client.getSubjectDetail(medium, doubanId, session?.cookie);
        this.db.upsertSubject(detail.subject);
        subject = this.db.getSubject(medium, doubanId) ?? detail.subject;
        comments = detail.comments;
      } catch (error) {
        if (!subject) {
          throw error;
        }
        this.db.addSyncEvent("warn", "豆瓣详情实时抓取失败，已返回本地镜像详情", {
          medium,
          doubanId,
          message: error instanceof Error ? error.message : "Unknown detail error"
        });
      }
    }

    const userItem = session?.cookie ? this.db.getUserItem(medium, doubanId) : null;
    if (!subject) {
      throw new Error("Subject not found");
    }
    return { subject, userItem, comments };
  }

  async getSubjectComments(medium: Medium, doubanId: string, start: number, limit: number): Promise<SubjectCommentsResponse> {
    const session = this.db.getDoubanCookie();
    return this.client.getSubjectComments(medium, doubanId, start, limit, session?.cookie);
  }

  async getRanking(medium: Medium, boardKey: string): Promise<RankingResponse> {
    const normalizedBoardKey = boardKey === "hot" ? boardCatalog[medium][0].key : boardKey;
    const board = boardCatalog[medium].find((item) => item.key === normalizedBoardKey);
    if (!board) {
      throw new Error(`Unknown board ${boardKey}`);
    }

    const cached = this.db.getRankingSnapshot(medium, board);
    if (cached) {
      const age = Date.now() - new Date(cached.fetchedAt).getTime();
      if (age < RANKING_CACHE_TTL_MS && cached.items.length > 0) {
        return cached;
      }
    }

    const session = this.db.getDoubanCookie();
    try {
      const items = await this.client.getRanking(medium, board, session?.cookie);
      items.forEach((item) => this.db.upsertSubject(item.subject));
      const fetchedAt = nowIso();
      this.db.saveRankingSnapshot(medium, board, items, fetchedAt);
      return {
        board,
        items,
        fetchedAt,
        stale: false
      };
    } catch (error) {
      if (cached && cached.items.length > 0) {
        this.db.addSyncEvent("warn", "榜单刷新失败，已返回缓存结果", {
          medium,
          board: board.key,
          message: error instanceof Error ? error.message : "Unknown ranking error"
        });
        return { ...cached, stale: true };
      }
      throw error;
    }
  }

  async getTimeline(scope: TimelineScope): Promise<TimelineResponse> {
    const session = this.requireSession();
    try {
      const items = await this.client.getTimeline(scope, session.cookie, session.peopleId);
      const fetchedAt = nowIso();
      this.db.saveTimelineSnapshot(scope, items, fetchedAt);
      return {
        scope,
        items,
        fetchedAt,
        stale: false
      };
    } catch (error) {
      const cached = this.db.getTimelineSnapshot(scope);
      if (cached) {
        this.db.addSyncEvent("warn", "动态抓取失败，已返回最近缓存", {
          scope,
          message: error instanceof Error ? error.message : "Unknown timeline error"
        });
        return { ...cached, stale: true };
      }
      throw error;
    }
  }

  async listLibrary(input: { medium: Medium; status?: ShelfStatus; page: number; pageSize: number }): Promise<LibraryResponse> {
    const session = this.db.getDoubanCookie();
    if (!session?.cookie) {
      return {
        items: [],
        pagination: {
          page: input.page,
          pageSize: input.pageSize,
          total: 0,
          hasMore: false
        }
      };
    }

    const response = this.db.listLibrary(input);
    const missingCoverItems = response.items.filter((item) => !item.subject.coverUrl);
    if (missingCoverItems.length === 0) {
      return response;
    }

    let refreshed = false;
    for (const item of missingCoverItems) {
      try {
        const detail = await this.client.getSubjectDetail(item.medium, item.doubanId, session?.cookie);
        this.db.upsertSubject(detail.subject);
        refreshed = refreshed || Boolean(detail.subject.coverUrl);
      } catch (error) {
        this.db.addSyncEvent("warn", "条目封面补全失败，继续返回本地镜像", {
          medium: item.medium,
          doubanId: item.doubanId,
          message: error instanceof Error ? error.message : "Unknown cover refresh error"
        });
      }
    }

    return refreshed ? this.db.listLibrary(input) : response;
  }

  getOverview() {
    const overview = this.db.getOverview();
    const session = this.db.getDoubanCookie();
    if (!session?.cookie) {
      return {
        ...overview,
        totals: [],
        recentItems: [],
        lastSyncJob: null
      };
    }
    return overview;
  }

  listSyncEvents(limit = 50) {
    return this.db.listSyncEvents(limit);
  }

  getSyncJob(jobId: string) {
    return this.db.getSyncJob(jobId);
  }

  async triggerManualPull() {
    this.requireSession();
    return this.enqueueJob("manual_pull");
  }

  async updateLibraryState(medium: Medium, doubanId: string, nextState: { status: ShelfStatus; rating: number | null }) {
    this.requireSession();
    const detail = await this.getSubjectDetail(medium, doubanId);
    this.db.upsertUserItem({
      medium,
      doubanId,
      status: nextState.status,
      rating: nextState.rating,
      syncState: "pending_push",
      errorMessage: null,
      updatedAt: nowIso()
    });
    const job = await this.enqueueJob("push_reconcile", {
      medium,
      doubanId
    });
    return {
      job,
      subject: detail.subject,
      userItem: this.db.getUserItem(medium, doubanId)
    };
  }

  async drainQueue() {
    let attempts = 0;
    while (attempts < 200) {
      await this.processQueue();
      if (!this.processing && this.db.countOpenSyncJobs() === 0) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
      attempts += 1;
    }
  }

  private async enqueueJob(type: SyncJobType, payload: Record<string, unknown> = {}) {
    const job = this.db.insertSyncJob(type, payload);
    this.db.addSyncEvent("info", "同步任务已入队", { jobId: job.id, type });
    queueMicrotask(() => {
      if (!this.stopped) {
        void this.processQueue();
      }
    });
    return job;
  }

  private async processQueue() {
    if (this.processing || this.stopped) {
      return;
    }
    this.processing = true;
    try {
      let job: SyncJobRecord | null = null;
      while ((job = this.db.claimNextQueuedJob())) {
        try {
          if (job.type === "manual_pull" || job.type === "scheduled_pull") {
            await this.runPull(job);
          } else if (job.type === "push_reconcile") {
            await this.runPush(job);
          }
          this.db.updateSyncJob(job.id, "completed");
          this.db.addSyncEvent("info", "同步任务已完成", { jobId: job.id, type: job.type });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown sync error";
          this.db.updateSyncJob(job.id, "failed", message);
          this.db.addSyncEvent("error", "同步任务失败", { jobId: job.id, type: job.type, message });
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private requireSession() {
    const session = this.db.getDoubanCookie();
    if (!session?.cookie) {
      throw new Error("请先登录豆瓣。");
    }
    return session;
  }

  private async runPull(job: SyncJobRecord) {
    const session = this.requireSession();
    const validation = await this.client.validateSession(session.cookie, session.peopleId);
    if (!validation.peopleId) {
      throw new Error("Unable to resolve Douban people id.");
    }
    this.db.saveDoubanSession({
      cookie: session.cookie,
      peopleId: validation.peopleId,
      displayName: validation.displayName ?? null,
      avatarUrl: validation.avatarUrl ?? null,
      ipLocation: validation.ipLocation ?? null,
      status: "valid",
      lastCheckedAt: nowIso(),
      lastError: null
    });

    for (const medium of mediums) {
      for (const status of shelfStatuses) {
        await this.syncCollectionStatus(medium, status, session.cookie, validation.peopleId);
      }
    }

    this.db.addSyncEvent("info", "全量同步完成", { jobId: job.id });
  }

  private async syncCollectionStatus(medium: Medium, status: ShelfStatus, cookie: string, peopleId: string) {
    let page = 1;
    let hasNext = true;
    let pageCount = 0;
    while (hasNext && pageCount < 20) {
      const result = await this.client.getUserCollection(medium, status, page, cookie, peopleId);
      result.items.forEach((item) => {
        this.db.upsertSubject(item.subject);
        this.db.upsertUserItem({
          medium,
          doubanId: item.subject.doubanId,
          status: item.status,
          rating: item.rating,
          syncState: "synced",
          errorMessage: null,
          updatedAt: nowIso(),
          lastSyncedAt: nowIso()
        });
      });
      hasNext = result.hasNext;
      page = result.nextPage ?? page + 1;
      pageCount += 1;
    }
  }

  private async runPush(job: SyncJobRecord) {
    const session = this.requireSession();
    const medium = job.payload.medium as Medium;
    const doubanId = String(job.payload.doubanId);
    const current = this.db.getUserItem(medium, doubanId);
    if (!current) {
      throw new Error("Local item missing for push.");
    }

    try {
      const result = await this.client.pushState(medium, doubanId, session.cookie, {
        status: current.status,
        rating: current.rating
      });
      this.db.saveDoubanSession({
        cookie: session.cookie,
        peopleId: session.peopleId,
        status: "valid",
        lastCheckedAt: nowIso(),
        lastError: null
      });
      this.db.upsertSubject(result.subject);
      this.db.upsertUserItem({
        medium,
        doubanId,
        status: current.status,
        rating: current.rating,
        syncState: "synced",
        errorMessage: null,
        updatedAt: nowIso(),
        lastSyncedAt: nowIso(),
        lastPushedAt: nowIso()
      });
    } catch (error) {
      if (error instanceof DoubanSessionError) {
        this.db.updateDoubanSessionStatus("invalid", error.message);
      }
      this.db.upsertUserItem({
        medium,
        doubanId,
        status: current.status,
        rating: current.rating,
        syncState: "needs_attention",
        errorMessage: error instanceof Error ? error.message : "Push failed",
        updatedAt: nowIso(),
        lastSyncedAt: current.lastSyncedAt,
        lastPushedAt: current.lastPushedAt
      });
      throw error;
    }
  }
}
