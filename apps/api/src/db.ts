import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type {
  DoubanSessionStatus,
  LibraryEntry,
  LibraryResponse,
  Medium,
  OverviewResponse,
  RankingBoardConfig,
  RankingItem,
  RankingResponse,
  ShelfStatus,
  SubjectRecord,
  TimelineItem,
  TimelineResponse,
  TimelineScope,
  SyncEventRecord,
  SyncJobRecord,
  SyncJobStatus,
  SyncJobType,
  UserItemRecord
} from "../../../packages/shared/src";
import { shelfStatuses } from "../../../packages/shared/src";

type Row = Record<string, unknown>;

function nowIso() {
  return new Date().toISOString();
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value.length === 0) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mapSubject(row: Row, prefix = ""): SubjectRecord {
  return {
    medium: row[`${prefix}medium`] as Medium,
    doubanId: String(row[`${prefix}douban_id`]),
    title: String(row[`${prefix}title`]),
    subtitle: (row[`${prefix}subtitle`] as string | null) ?? null,
    year: (row[`${prefix}year`] as string | null) ?? null,
    coverUrl: (row[`${prefix}cover_url`] as string | null) ?? null,
    averageRating: row[`${prefix}average_rating`] == null ? null : Number(row[`${prefix}average_rating`]),
    summary: (row[`${prefix}summary`] as string | null) ?? null,
    creators: parseJson<string[]>(row[`${prefix}creators_json`], []),
    metadata: parseJson<Record<string, string | string[]>>(row[`${prefix}metadata_json`], {}),
    updatedAt: String(row[`${prefix}updated_at`])
  };
}

function mapUserItem(row: Row, prefix = ""): UserItemRecord {
  return {
    medium: row[`${prefix}medium`] as Medium,
    doubanId: String(row[`${prefix}douban_id`]),
    status: row[`${prefix}status`] as ShelfStatus,
    rating: row[`${prefix}rating`] == null ? null : Number(row[`${prefix}rating`]),
    syncState: row[`${prefix}sync_state`] as UserItemRecord["syncState"],
    errorMessage: (row[`${prefix}error_message`] as string | null) ?? null,
    updatedAt: String(row[`${prefix}updated_at`]),
    lastSyncedAt: (row[`${prefix}last_synced_at`] as string | null) ?? null,
    lastPushedAt: (row[`${prefix}last_pushed_at`] as string | null) ?? null
  };
}

function mapLibraryEntry(row: Row): LibraryEntry {
  return {
    ...mapUserItem(row, "user_"),
    subject: mapSubject(row, "subject_")
  };
}

function mapJob(row: Row): SyncJobRecord {
  return {
    id: String(row.id),
    type: row.type as SyncJobType,
    status: row.status as SyncJobStatus,
    payload: parseJson<Record<string, unknown>>(row.payload_json, {}),
    startedAt: String(row.started_at),
    finishedAt: (row.finished_at as string | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null
  };
}

export class AppDatabase {
  private readonly db: DatabaseSync;

  constructor(file: string) {
    mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS subjects (
        medium TEXT NOT NULL,
        douban_id TEXT NOT NULL,
        title TEXT NOT NULL,
        subtitle TEXT,
        year TEXT,
        cover_url TEXT,
        average_rating REAL,
        summary TEXT,
        creators_json TEXT NOT NULL DEFAULT '[]',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (medium, douban_id)
      );

      CREATE TABLE IF NOT EXISTS user_items (
        medium TEXT NOT NULL,
        douban_id TEXT NOT NULL,
        status TEXT NOT NULL,
        rating INTEGER,
        sync_state TEXT NOT NULL,
        error_message TEXT,
        updated_at TEXT NOT NULL,
        last_synced_at TEXT,
        last_pushed_at TEXT,
        PRIMARY KEY (medium, douban_id)
      );

      CREATE TABLE IF NOT EXISTS ranking_snapshots (
        medium TEXT NOT NULL,
        board_key TEXT NOT NULL,
        board_name TEXT NOT NULL,
        items_json TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        PRIMARY KEY (medium, board_key)
      );

      CREATE TABLE IF NOT EXISTS timeline_snapshots (
        scope TEXT PRIMARY KEY,
        items_json TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sync_jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        started_at TEXT NOT NULL,
        finished_at TEXT,
        error_message TEXT
      );

      CREATE TABLE IF NOT EXISTS sync_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        context_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS douban_session (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        cookie TEXT NOT NULL,
        people_id TEXT,
        display_name TEXT,
        avatar_url TEXT,
        ip_location TEXT,
        status TEXT NOT NULL,
        last_checked_at TEXT,
        last_error TEXT
      );
    `);
    this.ensureColumn("douban_session", "display_name", "TEXT");
    this.ensureColumn("douban_session", "avatar_url", "TEXT");
    this.ensureColumn("douban_session", "ip_location", "TEXT");
  }

  private ensureColumn(table: string, column: string, definition: string) {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Row[];
    if (!columns.some((row) => row.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  close() {
    this.db.close();
  }

  upsertSubject(subject: Omit<SubjectRecord, "updatedAt"> & { updatedAt?: string }) {
    const updatedAt = subject.updatedAt ?? nowIso();
    this.db
      .prepare(`
        INSERT INTO subjects (
          medium, douban_id, title, subtitle, year, cover_url, average_rating,
          summary, creators_json, metadata_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(medium, douban_id) DO UPDATE SET
          title = excluded.title,
          subtitle = excluded.subtitle,
          year = excluded.year,
          cover_url = COALESCE(excluded.cover_url, subjects.cover_url),
          average_rating = excluded.average_rating,
          summary = excluded.summary,
          creators_json = excluded.creators_json,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at
      `)
      .run(
        subject.medium,
        subject.doubanId,
        subject.title,
        subject.subtitle,
        subject.year,
        subject.coverUrl,
        subject.averageRating,
        subject.summary,
        JSON.stringify(subject.creators),
        JSON.stringify(subject.metadata),
        updatedAt
      );
  }

  getSubject(medium: Medium, doubanId: string): SubjectRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM subjects WHERE medium = ? AND douban_id = ?`)
      .get(medium, doubanId) as Row | undefined;
    return row ? mapSubject(row) : null;
  }

  searchSubjects(medium: Medium, query: string, limit = 20): SubjectRecord[] {
    const like = `%${query}%`;
    const rows = this.db
      .prepare(`
        SELECT * FROM subjects
        WHERE medium = ?
          AND (
            title LIKE ?
            OR subtitle LIKE ?
            OR summary LIKE ?
            OR creators_json LIKE ?
            OR metadata_json LIKE ?
          )
        ORDER BY updated_at DESC
        LIMIT ?
      `)
      .all(medium, like, like, like, like, like, limit) as Row[];
    return rows.map((row) => mapSubject(row));
  }

  getUserItem(medium: Medium, doubanId: string): UserItemRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM user_items WHERE medium = ? AND douban_id = ?`)
      .get(medium, doubanId) as Row | undefined;
    return row ? mapUserItem(row) : null;
  }

  getSubjectDetail(medium: Medium, doubanId: string) {
    const subject = this.getSubject(medium, doubanId);
    const userItem = this.getUserItem(medium, doubanId);
    return { subject, userItem };
  }

  upsertUserItem(item: {
    medium: Medium;
    doubanId: string;
    status: ShelfStatus;
    rating: number | null;
    syncState: UserItemRecord["syncState"];
    errorMessage?: string | null;
    updatedAt?: string;
    lastSyncedAt?: string | null;
    lastPushedAt?: string | null;
  }) {
    const updatedAt = item.updatedAt ?? nowIso();
    this.db
      .prepare(`
        INSERT INTO user_items (
          medium, douban_id, status, rating, sync_state, error_message,
          updated_at, last_synced_at, last_pushed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(medium, douban_id) DO UPDATE SET
          status = excluded.status,
          rating = excluded.rating,
          sync_state = excluded.sync_state,
          error_message = excluded.error_message,
          updated_at = excluded.updated_at,
          last_synced_at = excluded.last_synced_at,
          last_pushed_at = excluded.last_pushed_at
      `)
      .run(
        item.medium,
        item.doubanId,
        item.status,
        item.rating,
        item.syncState,
        item.errorMessage ?? null,
        updatedAt,
        item.lastSyncedAt ?? null,
        item.lastPushedAt ?? null
      );
  }

  listLibrary(input: {
    medium: Medium;
    status?: ShelfStatus;
    page: number;
    pageSize: number;
  }): LibraryResponse {
    const conditions = [`u.medium = ?`];
    const params: Array<string | number> = [input.medium];
    if (input.status) {
      conditions.push(`u.status = ?`);
      params.push(input.status);
    }

    const where = conditions.join(" AND ");
    const totalRow = this.db
      .prepare(`SELECT COUNT(*) AS total FROM user_items u WHERE ${where}`)
      .get(...params) as Row;
    const total = Number(totalRow.total ?? 0);
    const offset = (input.page - 1) * input.pageSize;
    const rows = this.db
      .prepare(`
        SELECT
          u.medium AS user_medium,
          u.douban_id AS user_douban_id,
          u.status AS user_status,
          u.rating AS user_rating,
          u.sync_state AS user_sync_state,
          u.error_message AS user_error_message,
          u.updated_at AS user_updated_at,
          u.last_synced_at AS user_last_synced_at,
          u.last_pushed_at AS user_last_pushed_at,
          s.medium AS subject_medium,
          s.douban_id AS subject_douban_id,
          s.title AS subject_title,
          s.subtitle AS subject_subtitle,
          s.year AS subject_year,
          s.cover_url AS subject_cover_url,
          s.average_rating AS subject_average_rating,
          s.summary AS subject_summary,
          s.creators_json AS subject_creators_json,
          s.metadata_json AS subject_metadata_json,
          s.updated_at AS subject_updated_at
        FROM user_items u
        JOIN subjects s
          ON s.medium = u.medium AND s.douban_id = u.douban_id
        WHERE ${where}
        ORDER BY u.updated_at DESC
        LIMIT ? OFFSET ?
      `)
      .all(...params, input.pageSize, offset) as Row[];
    return {
      items: rows.map(mapLibraryEntry),
      pagination: {
        page: input.page,
        pageSize: input.pageSize,
        total,
        hasMore: offset + rows.length < total
      }
    };
  }

  getOverview(): OverviewResponse {
    const totalsRows = this.db
      .prepare(`
        SELECT medium, status, COUNT(*) AS count
        FROM user_items
        GROUP BY medium, status
      `)
      .all() as Row[];
    const totals = totalsRows.map((row) => ({
      medium: row.medium as Medium,
      status: row.status as ShelfStatus,
      count: Number(row.count)
    }));

    const recentRows = this.db
      .prepare(`
        SELECT
          u.medium AS user_medium,
          u.douban_id AS user_douban_id,
          u.status AS user_status,
          u.rating AS user_rating,
          u.sync_state AS user_sync_state,
          u.error_message AS user_error_message,
          u.updated_at AS user_updated_at,
          u.last_synced_at AS user_last_synced_at,
          u.last_pushed_at AS user_last_pushed_at,
          s.medium AS subject_medium,
          s.douban_id AS subject_douban_id,
          s.title AS subject_title,
          s.subtitle AS subject_subtitle,
          s.year AS subject_year,
          s.cover_url AS subject_cover_url,
          s.average_rating AS subject_average_rating,
          s.summary AS subject_summary,
          s.creators_json AS subject_creators_json,
          s.metadata_json AS subject_metadata_json,
          s.updated_at AS subject_updated_at
        FROM user_items u
        JOIN subjects s
          ON s.medium = u.medium AND s.douban_id = u.douban_id
        ORDER BY u.updated_at DESC
        LIMIT 8
      `)
      .all() as Row[];

    const lastJobRow = this.db
      .prepare(`SELECT * FROM sync_jobs ORDER BY started_at DESC LIMIT 1`)
      .get() as Row | undefined;

    return {
      totals,
      recentItems: recentRows.map(mapLibraryEntry),
      lastSyncJob: lastJobRow ? mapJob(lastJobRow) : null,
      sessionStatus: this.getDoubanSessionStatus()
    };
  }

  getDoubanSessionStatus(): DoubanSessionStatus {
    const row = this.db.prepare(`SELECT * FROM douban_session WHERE id = 1`).get() as Row | undefined;
    if (!row) {
      return {
        status: "missing",
        peopleId: null,
        displayName: null,
        avatarUrl: null,
        ipLocation: null,
        lastCheckedAt: null,
        lastError: null
      };
    }

    return {
      status: row.status as DoubanSessionStatus["status"],
      peopleId: (row.people_id as string | null) ?? null,
      displayName: (row.display_name as string | null) ?? null,
      avatarUrl: (row.avatar_url as string | null) ?? null,
      ipLocation: (row.ip_location as string | null) ?? null,
      lastCheckedAt: (row.last_checked_at as string | null) ?? null,
      lastError: (row.last_error as string | null) ?? null
    };
  }

  getDoubanCookie(): { cookie: string; peopleId: string | null } | null {
    const row = this.db.prepare(`SELECT cookie, people_id FROM douban_session WHERE id = 1`).get() as Row | undefined;
    if (!row) {
      return null;
    }
    return {
      cookie: String(row.cookie),
      peopleId: (row.people_id as string | null) ?? null
    };
  }

  saveDoubanSession(input: {
    cookie: string;
    peopleId: string | null;
    displayName?: string | null;
    avatarUrl?: string | null;
    ipLocation?: string | null;
    status: DoubanSessionStatus["status"];
    lastCheckedAt?: string;
    lastError?: string | null;
  }) {
    this.db
      .prepare(`
        INSERT INTO douban_session (id, cookie, people_id, display_name, avatar_url, ip_location, status, last_checked_at, last_error)
        VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          cookie = excluded.cookie,
          people_id = excluded.people_id,
          display_name = COALESCE(excluded.display_name, douban_session.display_name),
          avatar_url = COALESCE(excluded.avatar_url, douban_session.avatar_url),
          ip_location = COALESCE(excluded.ip_location, douban_session.ip_location),
          status = excluded.status,
          last_checked_at = excluded.last_checked_at,
          last_error = excluded.last_error
      `)
      .run(
        input.cookie,
        input.peopleId,
        input.displayName ?? null,
        input.avatarUrl ?? null,
        input.ipLocation ?? null,
        input.status,
        input.lastCheckedAt ?? nowIso(),
        input.lastError ?? null
      );
  }

  updateDoubanSessionStatus(status: DoubanSessionStatus["status"], errorMessage: string | null) {
    this.db
      .prepare(`
        UPDATE douban_session
        SET status = ?, last_error = ?, last_checked_at = ?
        WHERE id = 1
      `)
      .run(status, errorMessage, nowIso());
  }

  clearDoubanSession() {
    this.db.prepare(`DELETE FROM douban_session WHERE id = 1`).run();
  }

  saveRankingSnapshot(medium: Medium, board: RankingBoardConfig, items: RankingItem[], fetchedAt = nowIso()) {
    this.db
      .prepare(`
        INSERT INTO ranking_snapshots (medium, board_key, board_name, items_json, fetched_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(medium, board_key) DO UPDATE SET
          board_name = excluded.board_name,
          items_json = excluded.items_json,
          fetched_at = excluded.fetched_at
      `)
      .run(medium, board.key, board.name, JSON.stringify(items), fetchedAt);
  }

  getRankingSnapshot(medium: Medium, board: RankingBoardConfig): RankingResponse | null {
    const row = this.db
      .prepare(`SELECT * FROM ranking_snapshots WHERE medium = ? AND board_key = ?`)
      .get(medium, board.key) as Row | undefined;
    if (!row) {
      return null;
    }
    return {
      board,
      items: parseJson<RankingItem[]>(row.items_json, []),
      fetchedAt: String(row.fetched_at),
      stale: false
    };
  }

  saveTimelineSnapshot(scope: TimelineScope, items: TimelineItem[], fetchedAt = nowIso()) {
    this.db
      .prepare(`
        INSERT INTO timeline_snapshots (scope, items_json, fetched_at)
        VALUES (?, ?, ?)
        ON CONFLICT(scope) DO UPDATE SET
          items_json = excluded.items_json,
          fetched_at = excluded.fetched_at
      `)
      .run(scope, JSON.stringify(items), fetchedAt);
  }

  getTimelineSnapshot(scope: TimelineScope): TimelineResponse | null {
    const row = this.db
      .prepare(`SELECT * FROM timeline_snapshots WHERE scope = ?`)
      .get(scope) as Row | undefined;
    if (!row) {
      return null;
    }
    return {
      scope,
      items: parseJson<TimelineItem[]>(row.items_json, []),
      fetchedAt: String(row.fetched_at),
      stale: false
    };
  }

  insertSyncJob(type: SyncJobType, payload: Record<string, unknown> = {}): SyncJobRecord {
    const job: SyncJobRecord = {
      id: randomUUID(),
      type,
      status: "queued",
      payload,
      startedAt: nowIso(),
      finishedAt: null,
      errorMessage: null
    };
    this.db
      .prepare(`
        INSERT INTO sync_jobs (id, type, status, payload_json, started_at, finished_at, error_message)
        VALUES (?, ?, ?, ?, ?, NULL, NULL)
      `)
      .run(job.id, job.type, job.status, JSON.stringify(job.payload), job.startedAt);
    return job;
  }

  getSyncJob(jobId: string): SyncJobRecord | null {
    const row = this.db.prepare(`SELECT * FROM sync_jobs WHERE id = ?`).get(jobId) as Row | undefined;
    return row ? mapJob(row) : null;
  }

  countOpenSyncJobs() {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS total FROM sync_jobs WHERE status IN ('queued', 'running')`)
      .get() as Row;
    return Number(row.total ?? 0);
  }

  claimNextQueuedJob(): SyncJobRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM sync_jobs WHERE status = 'queued' ORDER BY started_at ASC LIMIT 1`)
      .get() as Row | undefined;
    if (!row) {
      return null;
    }
    this.db.prepare(`UPDATE sync_jobs SET status = 'running' WHERE id = ?`).run(String(row.id));
    return {
      ...mapJob({ ...row, status: "running" }),
      status: "running"
    };
  }

  updateSyncJob(jobId: string, status: SyncJobStatus, errorMessage?: string | null) {
    this.db
      .prepare(`
        UPDATE sync_jobs
        SET status = ?, finished_at = ?, error_message = ?
        WHERE id = ?
      `)
      .run(status, status === "running" || status === "queued" ? null : nowIso(), errorMessage ?? null, jobId);
  }

  addSyncEvent(level: SyncEventRecord["level"], message: string, context: Record<string, unknown> = {}) {
    this.db
      .prepare(`
        INSERT INTO sync_events (level, message, context_json, created_at)
        VALUES (?, ?, ?, ?)
      `)
      .run(level, message, JSON.stringify(context), nowIso());
  }

  listSyncEvents(limit = 50): SyncEventRecord[] {
    const rows = this.db
      .prepare(`
        SELECT * FROM sync_events ORDER BY created_at DESC LIMIT ?
      `)
      .all(limit) as Row[];
    return rows.map((row) => ({
      id: Number(row.id),
      level: row.level as SyncEventRecord["level"],
      message: String(row.message),
      context: parseJson<Record<string, unknown>>(row.context_json, {}),
      createdAt: String(row.created_at)
    }));
  }
}

export function emptyTotals() {
  return shelfStatuses.flatMap((status) =>
    (["movie", "music", "book", "game"] as Medium[]).map((medium) => ({
      medium,
      status,
      count: 0
    }))
  );
}
