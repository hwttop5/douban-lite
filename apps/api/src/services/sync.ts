import type {
  AppUser,
  AuthMeResponse,
  DoubanLoginResponse,
  DoubanSessionStatus,
  LibraryResponse,
  Medium,
  OverviewResponse,
  RankingResponse,
  SearchResponse,
  ShelfStatus,
  SubjectCommentVoteResponse,
  SubjectCommentsResponse,
  SubjectDetailResponse,
  SyncJobRecord,
  SyncJobType,
  TimelineActionResponse,
  TimelineCommentsResponse,
  TimelineResponse,
  TimelineScope,
  UpdateLibraryStateInput
} from "../../../../packages/shared/src";
import { boardCatalog, mediums, shelfStatuses } from "../../../../packages/shared/src";
import type { AppConfig } from "../config";
import { AppDatabase } from "../db";
import { DoubanClient, DoubanSessionError } from "../douban/client";
import { decryptText, encryptText, hashSessionToken } from "../security";

const RANKING_CACHE_TTL_MS = 1000 * 60 * 60 * 24;
const RELATED_SUBJECT_ENRICH_LIMIT = 8;

function nowIso() {
  return new Date().toISOString();
}

function emptySubjectDetailExtras(): Pick<SubjectDetailResponse, "staff" | "media" | "trackList" | "tableOfContents" | "relatedSubjects" | "sectionLinks"> {
  return {
    staff: [],
    media: {
      videos: [],
      images: []
    },
    trackList: [],
    tableOfContents: [],
    relatedSubjects: [],
    sectionLinks: []
  };
}

function hasRichSubjectFields(subject: SubjectDetailResponse["subject"]) {
  return Boolean(
    subject.subtitle ||
    subject.year ||
    subject.summary ||
    subject.creators.length > 0 ||
    Object.keys(subject.metadata).some((key) => key !== "externalUrl" && key !== "board")
  );
}

function hasSuspiciousMetadata(subject: SubjectDetailResponse["subject"]) {
  const metadataLabels = ["导演", "主演", "作者", "表演者", "流派", "专辑类型", "介质", "发行时间", "出版者", "唱片数", "开发商", "发行商", "平台"];
  const nestedLabelPattern = new RegExp(`(?:${metadataLabels.join("|")})[:：]`);
  return (
    subject.creators.some((value) => nestedLabelPattern.test(value)) ||
    Object.entries(subject.metadata).some(([key, value]) => {
      if (key === "externalUrl" || key === "board") {
        return false;
      }
      const text = Array.isArray(value) ? value.join(" / ") : value;
      return typeof text === "string" && nestedLabelPattern.test(text) && !text.startsWith(`${key}:`) && !text.startsWith(`${key}：`);
    })
  );
}

function mergeSubjectRecords(base: SubjectDetailResponse["subject"], incoming: SubjectDetailResponse["subject"]) {
  const hasIncomingMetadata = Object.keys(incoming.metadata).some((key) => key !== "externalUrl");
  return {
    ...base,
    ...incoming,
    subtitle: incoming.subtitle ?? base.subtitle,
    year: incoming.year ?? base.year,
    coverUrl: incoming.coverUrl ?? base.coverUrl,
    averageRating: incoming.averageRating ?? base.averageRating,
    summary: incoming.summary ?? base.summary,
    creators: incoming.creators.length > 0 ? incoming.creators : base.creators,
    metadata: hasIncomingMetadata ? incoming.metadata : { ...base.metadata, ...incoming.metadata }
  };
}

export class SyncService {
  private processing = false;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly db: AppDatabase,
    private readonly client: DoubanClient,
    private readonly config: Pick<AppConfig, "syncIntervalHours" | "disableAutoSync" | "appSecret">
  ) {}

  start() {
    this.stopped = false;
    if (this.config.disableAutoSync) {
      return;
    }
    const intervalMs = this.config.syncIntervalHours * 60 * 60 * 1000;
    this.timer = setInterval(() => {
      void this.enqueueScheduledJobs();
    }, intervalMs);
  }

  stop() {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getAuthenticatedUser(sessionToken: string | null): AppUser | null {
    if (!sessionToken) {
      return null;
    }
    this.db.deleteExpiredSessions();
    const session = this.db.getSessionByTokenHash(hashSessionToken(sessionToken));
    if (!session || session.expiresAt <= nowIso()) {
      return null;
    }
    return this.db.getUserById(session.userId);
  }

  getAuthMe(userId: string | null): AuthMeResponse {
    if (!userId) {
      return {
        authenticated: false,
        user: null,
        sessionStatus: {
          status: "missing",
          peopleId: null,
          displayName: null,
          avatarUrl: null,
          ipLocation: null,
          lastCheckedAt: null,
          lastError: null
        }
      };
    }
    const user = this.db.getUserById(userId);
    if (!user) {
      return {
        authenticated: false,
        user: null,
        sessionStatus: {
          status: "missing",
          peopleId: null,
          displayName: null,
          avatarUrl: null,
          ipLocation: null,
          lastCheckedAt: null,
          lastError: null
        }
      };
    }
    return {
      authenticated: true,
      user,
      sessionStatus: this.db.getDoubanSessionStatus(userId)
    };
  }

  async loginWithDoubanCookie(input: { cookie: string; peopleId?: string | null }, sessionToken: string, expiresAt: string): Promise<DoubanLoginResponse> {
    const validation = await this.client.validateSession(input.cookie, input.peopleId);
    if (!validation.peopleId) {
      throw new Error("Unable to resolve Douban people id.");
    }
    const user = this.db.upsertUserByPeopleId({
      peopleId: validation.peopleId,
      displayName: validation.displayName ?? null,
      avatarUrl: validation.avatarUrl ?? null,
      ipLocation: validation.ipLocation ?? null
    });
    this.db.saveDoubanSession(user.id, {
      cookieEncrypted: encryptText(this.config.appSecret, input.cookie),
      peopleId: validation.peopleId,
      displayName: validation.displayName ?? null,
      avatarUrl: validation.avatarUrl ?? null,
      ipLocation: validation.ipLocation ?? null,
      status: validation.status,
      lastCheckedAt: nowIso(),
      lastError: null
    });
    this.db.createAppSession(user.id, hashSessionToken(sessionToken), expiresAt);
    this.db.addSyncEvent(user.id, "info", "Douban session imported", { peopleId: validation.peopleId });
    return {
      user,
      sessionStatus: this.db.getDoubanSessionStatus(user.id)
    };
  }

  logout(sessionToken: string | null) {
    if (sessionToken) {
      this.db.deleteSessionByTokenHash(hashSessionToken(sessionToken));
    }
  }

  getSessionStatus(userId: string): DoubanSessionStatus {
    return this.db.getDoubanSessionStatus(userId);
  }

  async searchSubjects(userId: string | null, medium: Medium, query: string): Promise<SearchResponse> {
    const session = userId ? this.getDoubanCookie(userId) : null;
    try {
      const items = await this.client.searchSubjects(medium, query, session?.cookie);
      items.forEach((item) => this.db.upsertSubject(item));
      return { items };
    } catch (error) {
      const cachedItems = this.db.searchSubjects(medium, query);
      return { items: cachedItems.length > 0 ? cachedItems : (() => { throw error; })() };
    }
  }

  async getSubjectDetail(userId: string | null, medium: Medium, doubanId: string): Promise<SubjectDetailResponse> {
    const session = userId ? this.getDoubanCookie(userId) : null;
    let subject = this.db.getSubject(medium, doubanId);
    let comments: SubjectDetailResponse["comments"] = [];
    let extras = emptySubjectDetailExtras();
    let remoteComment: string | null = null;
    try {
      const detail = await this.client.getSubjectDetail(medium, doubanId, session?.cookie);
      this.db.upsertSubject(detail.subject);
      subject = this.db.getSubject(medium, doubanId) ?? detail.subject;
      comments = detail.comments;
      extras = {
        ...detail.extras,
        relatedSubjects: await this.enrichRelatedSubjects(detail.extras.relatedSubjects, session?.cookie)
      };
      remoteComment = detail.userSelection?.comment ?? null;
    } catch (error) {
      if (!subject) {
        throw error;
      }
    }
    const storedUserItem = userId ? this.db.getUserItem(userId, medium, doubanId) : null;
    const userItem =
      storedUserItem && remoteComment && storedUserItem.comment !== remoteComment
        ? { ...storedUserItem, comment: remoteComment }
        : storedUserItem;
    if (!subject) {
      throw new Error("Subject not found");
    }
    return {
      subject,
      userItem,
      comments,
      ...extras
    };
  }

  async getSubjectComments(userId: string | null, medium: Medium, doubanId: string, start: number, limit: number): Promise<SubjectCommentsResponse> {
    const session = userId ? this.getDoubanCookie(userId) : null;
    return this.client.getSubjectComments(medium, doubanId, start, limit, session?.cookie);
  }

  async voteSubjectComment(userId: string, medium: Medium, doubanId: string, commentId: string): Promise<SubjectCommentVoteResponse> {
    const session = this.requireDoubanSession(userId);
    return this.client.voteSubjectComment(medium, doubanId, commentId, session.cookie);
  }

  async likeTimelineStatus(userId: string, statusId: string, detailUrl: string): Promise<TimelineActionResponse> {
    const session = this.requireDoubanSession(userId);
    return this.runTimelineAction(userId, () => this.client.likeTimelineStatus(statusId, detailUrl, session.cookie));
  }

  async replyTimelineStatus(userId: string, statusId: string, detailUrl: string, text: string): Promise<TimelineActionResponse> {
    const session = this.requireDoubanSession(userId);
    return this.runTimelineAction(userId, () => this.client.replyTimelineStatus(statusId, detailUrl, text, session.cookie));
  }

  async repostTimelineStatus(userId: string, statusId: string, detailUrl: string, text?: string): Promise<TimelineActionResponse> {
    const session = this.requireDoubanSession(userId);
    return this.runTimelineAction(userId, () => this.client.repostTimelineStatus(statusId, detailUrl, text, session.cookie));
  }

  async getTimelineComments(userId: string, statusId: string, detailUrl: string): Promise<TimelineCommentsResponse> {
    const session = this.requireDoubanSession(userId);
    return this.runTimelineAction(userId, () => this.client.getTimelineComments(statusId, detailUrl, session.cookie));
  }

  private async enrichRelatedSubjects(subjects: SubjectDetailResponse["relatedSubjects"], cookie?: string) {
    return Promise.all(
      subjects.map(async (subject, index) => {
        const cached = this.db.getSubject(subject.medium, subject.doubanId);
        if (cached && hasRichSubjectFields(cached) && !hasSuspiciousMetadata(cached)) {
          return mergeSubjectRecords(subject, cached);
        }
        if (index >= RELATED_SUBJECT_ENRICH_LIMIT) {
          return cached ? mergeSubjectRecords(subject, cached) : subject;
        }
        try {
          const detail = await this.client.getSubjectDetail(subject.medium, subject.doubanId, cookie);
          this.db.upsertSubject(detail.subject);
          return mergeSubjectRecords(subject, detail.subject);
        } catch {
          return cached ? mergeSubjectRecords(subject, cached) : subject;
        }
      })
    );
  }

  async getRanking(userId: string | null, medium: Medium, boardKey: string): Promise<RankingResponse> {
    const normalizedBoardKey = boardKey === "hot" ? boardCatalog[medium][0].key : boardKey;
    const board = boardCatalog[medium].find((item) => item.key === normalizedBoardKey);
    if (!board) {
      throw new Error(`Unknown board ${boardKey}`);
    }
    const cached = this.db.getRankingSnapshot(medium, board);
    if (cached) {
      const age = Date.now() - new Date(cached.fetchedAt).getTime();
      const expectedMinimum = board.maxPages ? Math.min(board.maxPages * 25, board.sourceType === "doulist" ? 500 : board.maxPages * 25) : 1;
      if (age < RANKING_CACHE_TTL_MS && cached.items.length >= expectedMinimum) {
        return cached;
      }
    }
    const session = userId ? this.getDoubanCookie(userId) : null;
    try {
      const items = await this.client.getRanking(medium, board, session?.cookie);
      items.forEach((item) => this.db.upsertSubject(item.subject));
      const fetchedAt = nowIso();
      this.db.saveRankingSnapshot(medium, board, items, fetchedAt);
      return { board, items, fetchedAt, stale: false };
    } catch (error) {
      if (cached && cached.items.length > 0) {
        return { ...cached, stale: true };
      }
      throw error;
    }
  }

  async getTimeline(userId: string, scope: TimelineScope, start = 0): Promise<TimelineResponse> {
    const session = this.requireDoubanSession(userId);
    try {
      const page = await this.client.getTimeline(scope, session.cookie, session.peopleId, start);
      const fetchedAt = nowIso();
      if (start === 0) {
        this.db.saveTimelineSnapshot(userId, scope, page.items, fetchedAt);
      }
      return { scope, ...page, fetchedAt, stale: false };
    } catch (error) {
      this.handleTimelineSessionError(userId, error);
      const cached = start === 0 ? this.db.getTimelineSnapshot(userId, scope) : null;
      if (cached) {
        return { ...cached, stale: true };
      }
      throw error;
    }
  }

  async listLibrary(userId: string, input: { medium: Medium; status?: ShelfStatus; page: number; pageSize: number }): Promise<LibraryResponse> {
    const session = this.getDoubanCookie(userId);
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
    const peopleId = session.peopleId ?? this.db.getUserById(userId)?.peopleId ?? null;
    if (input.status && peopleId) {
      try {
        const remote = await this.client.getUserCollection(input.medium, input.status, input.page, session.cookie, peopleId);
        const fetchedAt = nowIso();
        const pageSize = remote.items.length > 0 ? remote.items.length : input.pageSize;
        const total =
          remote.total ??
          (remote.hasNext ? input.page * Math.max(1, pageSize) + 1 : Math.max(0, (input.page - 1) * Math.max(1, pageSize) + remote.items.length));

        return {
          items: remote.items.map((item) => {
            this.db.upsertSubject(item.subject);
            const local = this.db.getUserItem(userId, item.subject.medium, item.subject.doubanId);
            return {
              medium: item.subject.medium,
              doubanId: item.subject.doubanId,
              status: item.status,
              rating: item.rating,
              comment: item.comment,
              tags: local?.tags ?? [],
              syncToTimeline: local?.syncToTimeline ?? true,
              syncState: local?.syncState ?? "synced",
              errorMessage: local?.errorMessage ?? null,
              updatedAt: local?.updatedAt ?? fetchedAt,
              lastSyncedAt: local?.lastSyncedAt ?? fetchedAt,
              lastPushedAt: local?.lastPushedAt ?? null,
              subject: item.subject
            };
          }),
          pagination: {
            page: input.page,
            pageSize,
            total,
            hasMore: remote.hasNext
          }
        };
      } catch {
        // Fall back to the local mirror when the live collection page is unavailable.
        if (input.medium === "book" && input.status === "done") {
          await this.backfillLibraryRatingsFromDetails(userId, input.medium, input.status, session.cookie);
        }
      }
    }
    const response = this.db.listLibrary(userId, input);
    const missingCoverItems = response.items.filter((item) => !item.subject.coverUrl);
    if (missingCoverItems.length === 0) {
      return response;
    }
    let refreshed = false;
    for (const item of missingCoverItems) {
      try {
        const detail = await this.client.getSubjectDetail(item.medium, item.doubanId, session.cookie);
        this.db.upsertSubject(detail.subject);
        refreshed = refreshed || Boolean(detail.subject.coverUrl);
      } catch {
        // ignore
      }
    }
    return refreshed ? this.db.listLibrary(userId, input) : response;
  }

  private async backfillLibraryRatingsFromDetails(userId: string, medium: Medium, status: ShelfStatus, cookie: string) {
    const existing = this.db.listLibrary(userId, { medium, status, page: 1, pageSize: 40 }).items;
    const missingRatings = existing.filter((item) => item.rating == null);
    if (missingRatings.length === 0) {
      return;
    }

    const timestamp = nowIso();
    for (const item of missingRatings) {
      try {
        const detail = await this.client.getSubjectDetail(item.medium, item.doubanId, cookie);
        this.db.upsertSubject(detail.subject);
        const actual = detail.userSelection;
        if (!actual || actual.status !== status) {
          continue;
        }
        this.db.upsertUserItem(userId, {
          medium: item.medium,
          doubanId: item.doubanId,
          status: actual.status,
          rating: actual.rating,
          comment: actual.comment,
          tags: item.tags,
          syncToTimeline: item.syncToTimeline,
          syncState: item.syncState,
          errorMessage: item.errorMessage,
          updatedAt: timestamp,
          lastSyncedAt: timestamp,
          lastPushedAt: item.lastPushedAt
        });
      } catch {
        // Keep the existing mirror entry when individual detail reads fail.
      }
    }
  }

  async getOverview(userId: string): Promise<OverviewResponse> {
    const fallback = this.db.getOverview(userId);
    const session = this.getDoubanCookie(userId);
    const peopleId = session?.peopleId ?? this.db.getUserById(userId)?.peopleId ?? null;
    if (!session?.cookie || !peopleId) {
      return fallback;
    }
    try {
      const profile = await this.client.getProfileOverview(session.cookie, peopleId);
      if (profile.totals.length === 0) {
        return fallback;
      }
      const remoteCounts = new Map(profile.totals.map((item) => [`${item.medium}:${item.status}`, item.count] as const));
      return {
        ...fallback,
        totals: mediums.flatMap((medium) =>
          shelfStatuses.map((status) => ({
            medium,
            status,
            count: remoteCounts.get(`${medium}:${status}`) ?? 0
          }))
        ),
        sessionStatus: {
          ...fallback.sessionStatus,
          peopleId: profile.peopleId ?? fallback.sessionStatus.peopleId,
          displayName: profile.displayName ?? fallback.sessionStatus.displayName,
          avatarUrl: profile.avatarUrl ?? fallback.sessionStatus.avatarUrl,
          ipLocation: profile.ipLocation ?? fallback.sessionStatus.ipLocation
        }
      };
    } catch {
      return fallback;
    }
  }

  listSyncEvents(userId: string, limit = 50) {
    return this.db.listSyncEvents(userId, limit);
  }

  getSyncJob(userId: string, jobId: string) {
    return this.db.getSyncJob(userId, jobId);
  }

  async triggerManualPull(userId: string) {
    this.requireDoubanSession(userId);
    return this.enqueueJob(userId, "manual_pull");
  }

  async updateLibraryState(userId: string, medium: Medium, doubanId: string, nextState: UpdateLibraryStateInput) {
    this.requireDoubanSession(userId);
    const detail = await this.getSubjectDetail(userId, medium, doubanId);
    this.db.upsertUserItem(userId, {
      medium,
      doubanId,
      status: nextState.status,
      rating: nextState.rating ?? null,
      comment: nextState.comment ?? "",
      tags: nextState.tags ?? [],
      syncToTimeline: nextState.syncToTimeline ?? true,
      syncState: "pending_push",
      errorMessage: null,
      updatedAt: nowIso()
    });
    const job = await this.enqueueJob(userId, "push_reconcile", { medium, doubanId });
    return {
      job,
      subject: detail.subject,
      userItem: this.db.getUserItem(userId, medium, doubanId)
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

  private getDoubanCookie(userId: string) {
    const session = this.db.getEncryptedDoubanCookie(userId);
    if (!session) {
      return null;
    }
    return {
      cookie: decryptText(this.config.appSecret, session.cookieEncrypted),
      peopleId: session.peopleId
    };
  }

  private requireDoubanSession(userId: string) {
    const session = this.getDoubanCookie(userId);
    if (!session?.cookie) {
      throw new Error("Please log in to Douban first.");
    }
    return session;
  }

  private handleTimelineSessionError(userId: string, error: unknown) {
    if (!(error instanceof DoubanSessionError)) {
      return;
    }
    this.db.updateDoubanSessionStatus(userId, "invalid", error.message);
  }

  private async runTimelineAction<T>(userId: string, action: () => Promise<T>) {
    try {
      return await action();
    } catch (error) {
      this.handleTimelineSessionError(userId, error);
      if (error instanceof DoubanSessionError) {
        throw new DoubanSessionError("豆瓣登录已失效或触发校验，请重新导入 Cookie 后重试。");
      }
      throw error;
    }
  }

  private async enqueueScheduledJobs() {
    for (const userId of this.db.listUserIdsWithDoubanSessions()) {
      await this.enqueueJob(userId, "scheduled_pull");
    }
  }

  private async enqueueJob(userId: string, type: SyncJobType, payload: Record<string, unknown> = {}) {
    const job = this.db.insertSyncJob(userId, type, payload);
    this.db.addSyncEvent(userId, "info", "Sync job queued", { jobId: job.id, type });
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
          this.db.addSyncEvent(job.userId, "info", "Sync job completed", { jobId: job.id, type: job.type });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown sync error";
          this.db.updateSyncJob(job.id, "failed", message);
          this.db.addSyncEvent(job.userId, "error", "Sync job failed", { jobId: job.id, type: job.type, message });
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private async runPull(job: SyncJobRecord) {
    const session = this.requireDoubanSession(job.userId);
    const validation = await this.client.validateSession(session.cookie, session.peopleId);
    if (!validation.peopleId) {
      throw new Error("Unable to resolve Douban people id.");
    }
    this.db.saveDoubanSession(job.userId, {
      cookieEncrypted: encryptText(this.config.appSecret, session.cookie),
      peopleId: validation.peopleId,
      displayName: validation.displayName ?? null,
      avatarUrl: validation.avatarUrl ?? null,
      ipLocation: validation.ipLocation ?? null,
      status: "valid",
      lastCheckedAt: nowIso(),
      lastError: null
    });
    for (const medium of mediums) {
      const seenDoubanIds = new Set<string>();
      for (const status of shelfStatuses) {
        const ids = await this.syncCollectionStatus(job.userId, medium, status, session.cookie, validation.peopleId);
        ids.forEach((doubanId) => seenDoubanIds.add(doubanId));
      }
      this.db.deleteMissingSyncedUserItems(job.userId, medium, Array.from(seenDoubanIds));
    }
  }

  private async syncCollectionStatus(userId: string, medium: Medium, status: ShelfStatus, cookie: string, peopleId: string) {
    const seenDoubanIds = new Set<string>();
    let page = 1;
    let hasNext = true;
    let pageCount = 0;
    while (hasNext && pageCount < 20) {
      const result = await this.client.getUserCollection(medium, status, page, cookie, peopleId);
      result.items.forEach((item) => {
        seenDoubanIds.add(item.subject.doubanId);
        this.db.upsertSubject(item.subject);
        this.db.upsertUserItem(userId, {
          medium,
          doubanId: item.subject.doubanId,
          status: item.status,
          rating: item.rating,
          comment: item.comment,
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
    return Array.from(seenDoubanIds);
  }

  private async runPush(job: SyncJobRecord) {
    const session = this.requireDoubanSession(job.userId);
    const medium = job.payload.medium as Medium;
    const doubanId = String(job.payload.doubanId);
    const current = this.db.getUserItem(job.userId, medium, doubanId);
    if (!current) {
      throw new Error("Local item missing for push.");
    }
    try {
      const result = await this.client.pushState(medium, doubanId, session.cookie, {
        status: current.status,
        rating: current.rating,
        comment: current.comment,
        tags: current.tags,
        syncToTimeline: current.syncToTimeline
      });
      this.db.saveDoubanSession(job.userId, {
        cookieEncrypted: encryptText(this.config.appSecret, session.cookie),
        peopleId: session.peopleId,
        status: "valid",
        lastCheckedAt: nowIso(),
        lastError: null
      });
      this.db.upsertSubject(result.subject);
      this.db.upsertUserItem(job.userId, {
        medium,
        doubanId,
        status: current.status,
        rating: current.rating,
        comment: current.comment,
        tags: current.tags,
        syncToTimeline: current.syncToTimeline,
        syncState: "synced",
        errorMessage: null,
        updatedAt: nowIso(),
        lastSyncedAt: nowIso(),
        lastPushedAt: nowIso()
      });
    } catch (error) {
      if (error instanceof DoubanSessionError) {
        this.db.updateDoubanSessionStatus(job.userId, "invalid", error.message);
      }
      this.db.upsertUserItem(job.userId, {
        medium,
        doubanId,
        status: current.status,
        rating: current.rating,
        comment: current.comment,
        tags: current.tags,
        syncToTimeline: current.syncToTimeline,
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
