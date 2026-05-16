import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type {
  AppUser,
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
  SyncEventRecord,
  SyncJobRecord,
  SyncJobStatus,
  SyncJobType,
  TimelineItem,
  TimelineResponse,
  TimelineScope,
  UserItemRecord
} from "../../../packages/shared/src";
import { shelfStatuses, timelinePageSize } from "../../../packages/shared/src";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

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
    comment: (row[`${prefix}comment`] as string | null) ?? null,
    tags: parseJson<string[]>(row[`${prefix}tags_json`], []),
    syncToTimeline: row[`${prefix}sync_to_timeline`] == null ? true : Boolean(Number(row[`${prefix}sync_to_timeline`])),
    syncState: row[`${prefix}sync_state`] as UserItemRecord["syncState"],
    errorMessage: (row[`${prefix}error_message`] as string | null) ?? null,
    updatedAt: String(row[`${prefix}updated_at`]),
    lastSyncedAt: (row[`${prefix}last_synced_at`] as string | null) ?? null,
    lastPushedAt: (row[`${prefix}last_pushed_at`] as string | null) ?? null
  };
}

function mapAppUser(row: Row): AppUser {
  return {
    id: String(row.id),
    peopleId: String(row.people_id),
    displayName: (row.display_name as string | null) ?? null,
    avatarUrl: (row.avatar_url as string | null) ?? null,
    ipLocation: (row.ip_location as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
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
    userId: String(row.user_id),
    type: row.type as SyncJobType,
    status: row.status as SyncJobStatus,
    payload: parseJson<Record<string, unknown>>(row.payload_json, {}),
    startedAt: String(row.started_at),
    finishedAt: (row.finished_at as string | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null
  };
}

function quoted(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

export class AppDatabase {
  private readonly db: InstanceType<typeof DatabaseSync>;

  constructor(file: string) {
    mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.createSharedTables();
    this.createMultiUserTables();
    this.migrateLegacySchema();
  }

  private createSharedTables() {
    this.db.exec(`
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

      CREATE TABLE IF NOT EXISTS ranking_snapshots (
        medium TEXT NOT NULL,
        board_key TEXT NOT NULL,
        board_name TEXT NOT NULL,
        items_json TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        PRIMARY KEY (medium, board_key)
      );
    `);
  }

  private createMultiUserTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        people_id TEXT NOT NULL UNIQUE,
        display_name TEXT,
        avatar_url TEXT,
        ip_location TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS douban_sessions (
        user_id TEXT PRIMARY KEY,
        cookie_encrypted TEXT NOT NULL,
        people_id TEXT,
        display_name TEXT,
        avatar_url TEXT,
        ip_location TEXT,
        status TEXT NOT NULL,
        last_checked_at TEXT,
        last_error TEXT
      );

      CREATE TABLE IF NOT EXISTS user_items (
        user_id TEXT NOT NULL,
        medium TEXT NOT NULL,
        douban_id TEXT NOT NULL,
        status TEXT NOT NULL,
        rating INTEGER,
        comment TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        sync_to_timeline INTEGER NOT NULL DEFAULT 1,
        sync_state TEXT NOT NULL,
        error_message TEXT,
        updated_at TEXT NOT NULL,
        last_synced_at TEXT,
        last_pushed_at TEXT,
        PRIMARY KEY (user_id, medium, douban_id)
      );

      CREATE TABLE IF NOT EXISTS timeline_snapshots (
        user_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        items_json TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        PRIMARY KEY (user_id, scope)
      );

      CREATE TABLE IF NOT EXISTS sync_jobs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        started_at TEXT NOT NULL,
        finished_at TEXT,
        error_message TEXT
      );

      CREATE TABLE IF NOT EXISTS sync_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        context_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
    `);
  }

  private tableExists(name: string) {
    const row = this.db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name) as Row | undefined;
    return Boolean(row);
  }

  private columnExists(table: string, column: string) {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Row[];
    return columns.some((row) => row.name === column);
  }

  private migrateLegacySchema() {
    this.migrateLegacyDoubanSession();
    this.migrateLegacyUserItems();
    this.migrateLegacyTimelineSnapshots();
    this.migrateLegacySyncJobs();
    this.migrateLegacySyncEvents();
  }

  private migrateLegacyDoubanSession() {
    if (!this.tableExists("douban_session")) {
      return;
    }
    const row = this.db.prepare(`SELECT * FROM douban_session WHERE id = 1`).get() as Row | undefined;
    if (!row) {
      return;
    }
    const peopleId = (row.people_id as string | null) ?? null;
    if (!peopleId) {
      return;
    }
    const user = this.upsertUserByPeopleId({
      peopleId,
      displayName: (row.display_name as string | null) ?? null,
      avatarUrl: (row.avatar_url as string | null) ?? null,
      ipLocation: (row.ip_location as string | null) ?? null
    });
    const existing = this.db.prepare(`SELECT 1 FROM douban_sessions WHERE user_id = ?`).get(user.id) as Row | undefined;
    if (!existing) {
      this.db
        .prepare(`
          INSERT INTO douban_sessions (user_id, cookie_encrypted, people_id, display_name, avatar_url, ip_location, status, last_checked_at, last_error)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          user.id,
          String(row.cookie),
          peopleId,
          (row.display_name as string | null) ?? null,
          (row.avatar_url as string | null) ?? null,
          (row.ip_location as string | null) ?? null,
          String(row.status ?? "valid"),
          (row.last_checked_at as string | null) ?? null,
          (row.last_error as string | null) ?? null
        );
    }
  }

  private migrateLegacyUserItems() {
    if (!this.tableExists("user_items") || this.columnExists("user_items", "user_id")) {
      return;
    }
    const legacyOwner = this.legacyOwnerId();
    if (!legacyOwner) {
      return;
    }
    this.db.exec(`
      ALTER TABLE user_items RENAME TO user_items_legacy;
      CREATE TABLE IF NOT EXISTS user_items (
        user_id TEXT NOT NULL,
        medium TEXT NOT NULL,
        douban_id TEXT NOT NULL,
        status TEXT NOT NULL,
        rating INTEGER,
        comment TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        sync_to_timeline INTEGER NOT NULL DEFAULT 1,
        sync_state TEXT NOT NULL,
        error_message TEXT,
        updated_at TEXT NOT NULL,
        last_synced_at TEXT,
        last_pushed_at TEXT,
        PRIMARY KEY (user_id, medium, douban_id)
      );
      INSERT INTO user_items (
        user_id, medium, douban_id, status, rating, comment, tags_json, sync_to_timeline, sync_state, error_message,
        updated_at, last_synced_at, last_pushed_at
      )
      SELECT
        ${quoted(legacyOwner)},
        medium, douban_id, status, rating, comment,
        COALESCE(tags_json, '[]'),
        COALESCE(sync_to_timeline, 1),
        sync_state, error_message, updated_at, last_synced_at, last_pushed_at
      FROM user_items_legacy;
      DROP TABLE user_items_legacy;
    `);
  }

  private migrateLegacyTimelineSnapshots() {
    if (!this.tableExists("timeline_snapshots") || this.columnExists("timeline_snapshots", "user_id")) {
      return;
    }
    const legacyOwner = this.legacyOwnerId();
    if (!legacyOwner) {
      return;
    }
    this.db.exec(`
      ALTER TABLE timeline_snapshots RENAME TO timeline_snapshots_legacy;
      CREATE TABLE IF NOT EXISTS timeline_snapshots (
        user_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        items_json TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        PRIMARY KEY (user_id, scope)
      );
      INSERT INTO timeline_snapshots (user_id, scope, items_json, fetched_at)
      SELECT ${quoted(legacyOwner)}, scope, items_json, fetched_at FROM timeline_snapshots_legacy;
      DROP TABLE timeline_snapshots_legacy;
    `);
  }

  private migrateLegacySyncJobs() {
    if (!this.tableExists("sync_jobs") || this.columnExists("sync_jobs", "user_id")) {
      return;
    }
    const legacyOwner = this.legacyOwnerId();
    if (!legacyOwner) {
      return;
    }
    this.db.exec(`
      ALTER TABLE sync_jobs RENAME TO sync_jobs_legacy;
      CREATE TABLE IF NOT EXISTS sync_jobs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        started_at TEXT NOT NULL,
        finished_at TEXT,
        error_message TEXT
      );
      INSERT INTO sync_jobs (id, user_id, type, status, payload_json, started_at, finished_at, error_message)
      SELECT id, ${quoted(legacyOwner)}, type, status, payload_json, started_at, finished_at, error_message
      FROM sync_jobs_legacy;
      DROP TABLE sync_jobs_legacy;
    `);
  }

  private migrateLegacySyncEvents() {
    if (!this.tableExists("sync_events") || this.columnExists("sync_events", "user_id")) {
      return;
    }
    const legacyOwner = this.legacyOwnerId();
    if (!legacyOwner) {
      return;
    }
    this.db.exec(`
      ALTER TABLE sync_events RENAME TO sync_events_legacy;
      CREATE TABLE IF NOT EXISTS sync_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        context_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      INSERT INTO sync_events (id, user_id, level, message, context_json, created_at)
      SELECT id, ${quoted(legacyOwner)}, level, message, context_json, created_at
      FROM sync_events_legacy;
      DROP TABLE sync_events_legacy;
    `);
  }

  private legacyOwnerId() {
    const row = this.db.prepare(`SELECT user_id FROM douban_sessions LIMIT 1`).get() as Row | undefined;
    return row ? String(row.user_id) : null;
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
          average_rating = COALESCE(excluded.average_rating, subjects.average_rating),
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
    const row = this.db.prepare(`SELECT * FROM subjects WHERE medium = ? AND douban_id = ?`).get(medium, doubanId) as Row | undefined;
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

  upsertUserByPeopleId(input: {
    peopleId: string;
    displayName?: string | null;
    avatarUrl?: string | null;
    ipLocation?: string | null;
  }): AppUser {
    const existing = this.db.prepare(`SELECT * FROM users WHERE people_id = ?`).get(input.peopleId) as Row | undefined;
    const now = nowIso();
    if (!existing) {
      const user: AppUser = {
        id: randomUUID(),
        peopleId: input.peopleId,
        displayName: input.displayName ?? null,
        avatarUrl: input.avatarUrl ?? null,
        ipLocation: input.ipLocation ?? null,
        createdAt: now,
        updatedAt: now
      };
      this.db
        .prepare(`
          INSERT INTO users (id, people_id, display_name, avatar_url, ip_location, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(user.id, user.peopleId, user.displayName ?? null, user.avatarUrl ?? null, user.ipLocation ?? null, user.createdAt, user.updatedAt);
      return user;
    }
    this.db
      .prepare(`
        UPDATE users
        SET display_name = COALESCE(?, display_name),
            avatar_url = COALESCE(?, avatar_url),
            ip_location = COALESCE(?, ip_location),
            updated_at = ?
        WHERE id = ?
      `)
      .run(input.displayName ?? null, input.avatarUrl ?? null, input.ipLocation ?? null, now, String(existing.id));
    return this.getUserById(String(existing.id))!;
  }

  getUserById(userId: string): AppUser | null {
    const row = this.db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as Row | undefined;
    return row ? mapAppUser(row) : null;
  }

  listUserIdsWithDoubanSessions() {
    const rows = this.db.prepare(`SELECT user_id FROM douban_sessions`).all() as Row[];
    return rows.map((row) => String(row.user_id));
  }

  createAppSession(userId: string, tokenHash: string, expiresAt: string) {
    const id = randomUUID();
    this.db
      .prepare(`
        INSERT INTO app_sessions (id, user_id, token_hash, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(id, userId, tokenHash, nowIso(), expiresAt);
  }

  getSessionByTokenHash(tokenHash: string): { userId: string; expiresAt: string } | null {
    const row = this.db
      .prepare(`SELECT user_id, expires_at FROM app_sessions WHERE token_hash = ?`)
      .get(tokenHash) as Row | undefined;
    if (!row) {
      return null;
    }
    return {
      userId: String(row.user_id),
      expiresAt: String(row.expires_at)
    };
  }

  deleteSessionByTokenHash(tokenHash: string) {
    this.db.prepare(`DELETE FROM app_sessions WHERE token_hash = ?`).run(tokenHash);
  }

  deleteExpiredSessions() {
    this.db.prepare(`DELETE FROM app_sessions WHERE expires_at <= ?`).run(nowIso());
  }

  getUserItem(userId: string, medium: Medium, doubanId: string): UserItemRecord | null {
    const row = this.db.prepare(`SELECT * FROM user_items WHERE user_id = ? AND medium = ? AND douban_id = ?`).get(userId, medium, doubanId) as Row | undefined;
    return row ? mapUserItem(row) : null;
  }

  getSubjectDetail(userId: string | null, medium: Medium, doubanId: string) {
    const subject = this.getSubject(medium, doubanId);
    const userItem = userId ? this.getUserItem(userId, medium, doubanId) : null;
    return { subject, userItem };
  }

  upsertUserItem(userId: string, item: {
    medium: Medium;
    doubanId: string;
    status: ShelfStatus;
    rating: number | null;
    comment?: string | null;
    tags?: string[];
    syncToTimeline?: boolean;
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
          user_id, medium, douban_id, status, rating, comment, tags_json, sync_to_timeline, sync_state, error_message,
          updated_at, last_synced_at, last_pushed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, medium, douban_id) DO UPDATE SET
          status = excluded.status,
          rating = excluded.rating,
          comment = excluded.comment,
          tags_json = excluded.tags_json,
          sync_to_timeline = excluded.sync_to_timeline,
          sync_state = excluded.sync_state,
          error_message = excluded.error_message,
          updated_at = excluded.updated_at,
          last_synced_at = excluded.last_synced_at,
          last_pushed_at = excluded.last_pushed_at
      `)
      .run(
        userId,
        item.medium,
        item.doubanId,
        item.status,
        item.rating,
        item.comment ?? null,
        JSON.stringify(item.tags ?? []),
        item.syncToTimeline === false ? 0 : 1,
        item.syncState,
        item.errorMessage ?? null,
        updatedAt,
        item.lastSyncedAt ?? null,
        item.lastPushedAt ?? null
      );
  }

  deleteMissingSyncedUserItems(userId: string, medium: Medium, doubanIds: string[]) {
    if (doubanIds.length === 0) {
      this.db.prepare(`DELETE FROM user_items WHERE user_id = ? AND medium = ? AND sync_state = 'synced'`).run(userId, medium);
      return;
    }
    const placeholders = doubanIds.map(() => "?").join(", ");
    this.db
      .prepare(`
        DELETE FROM user_items
        WHERE user_id = ? AND medium = ? AND sync_state = 'synced' AND douban_id NOT IN (${placeholders})
      `)
      .run(userId, medium, ...doubanIds);
  }

  listLibrary(userId: string, input: { medium: Medium; status?: ShelfStatus; page: number; pageSize: number }): LibraryResponse {
    const conditions = [`u.user_id = ?`, `u.medium = ?`];
    const params: Array<string | number> = [userId, input.medium];
    if (input.status) {
      conditions.push(`u.status = ?`);
      params.push(input.status);
    }
    const where = conditions.join(" AND ");
    const totalRow = this.db.prepare(`SELECT COUNT(*) AS total FROM user_items u WHERE ${where}`).get(...params) as Row;
    const total = Number(totalRow.total ?? 0);
    const offset = (input.page - 1) * input.pageSize;
    const rows = this.db
      .prepare(`
        SELECT
          u.medium AS user_medium,
          u.douban_id AS user_douban_id,
          u.status AS user_status,
          u.rating AS user_rating,
          u.comment AS user_comment,
          u.tags_json AS user_tags_json,
          u.sync_to_timeline AS user_sync_to_timeline,
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
        JOIN subjects s ON s.medium = u.medium AND s.douban_id = u.douban_id
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

  getOverview(userId: string): OverviewResponse {
    const totalsRows = this.db
      .prepare(`
        SELECT medium, status, COUNT(*) AS count
        FROM user_items
        WHERE user_id = ?
        GROUP BY medium, status
      `)
      .all(userId) as Row[];
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
          u.comment AS user_comment,
          u.tags_json AS user_tags_json,
          u.sync_to_timeline AS user_sync_to_timeline,
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
        JOIN subjects s ON s.medium = u.medium AND s.douban_id = u.douban_id
        WHERE u.user_id = ?
        ORDER BY u.updated_at DESC
        LIMIT 8
      `)
      .all(userId) as Row[];

    const lastJobRow = this.db
      .prepare(`SELECT * FROM sync_jobs WHERE user_id = ? ORDER BY started_at DESC LIMIT 1`)
      .get(userId) as Row | undefined;

    return {
      totals,
      recentItems: recentRows.map(mapLibraryEntry),
      lastSyncJob: lastJobRow ? mapJob(lastJobRow) : null,
      sessionStatus: this.getDoubanSessionStatus(userId)
    };
  }

  getDoubanSessionStatus(userId: string): DoubanSessionStatus {
    const row = this.db.prepare(`SELECT * FROM douban_sessions WHERE user_id = ?`).get(userId) as Row | undefined;
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

  getEncryptedDoubanCookie(userId: string): { cookieEncrypted: string; peopleId: string | null } | null {
    const row = this.db.prepare(`SELECT cookie_encrypted, people_id FROM douban_sessions WHERE user_id = ?`).get(userId) as Row | undefined;
    if (!row) {
      return null;
    }
    return {
      cookieEncrypted: String(row.cookie_encrypted),
      peopleId: (row.people_id as string | null) ?? null
    };
  }

  saveDoubanSession(userId: string, input: {
    cookieEncrypted: string;
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
        INSERT INTO douban_sessions (
          user_id, cookie_encrypted, people_id, display_name, avatar_url, ip_location, status, last_checked_at, last_error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          cookie_encrypted = excluded.cookie_encrypted,
          people_id = excluded.people_id,
          display_name = COALESCE(excluded.display_name, douban_sessions.display_name),
          avatar_url = COALESCE(excluded.avatar_url, douban_sessions.avatar_url),
          ip_location = COALESCE(excluded.ip_location, douban_sessions.ip_location),
          status = excluded.status,
          last_checked_at = excluded.last_checked_at,
          last_error = excluded.last_error
      `)
      .run(
        userId,
        input.cookieEncrypted,
        input.peopleId,
        input.displayName ?? null,
        input.avatarUrl ?? null,
        input.ipLocation ?? null,
        input.status,
        input.lastCheckedAt ?? nowIso(),
        input.lastError ?? null
      );
  }

  updateDoubanSessionStatus(userId: string, status: DoubanSessionStatus["status"], errorMessage: string | null) {
    this.db
      .prepare(`
        UPDATE douban_sessions
        SET status = ?, last_error = ?, last_checked_at = ?
        WHERE user_id = ?
      `)
      .run(status, errorMessage, nowIso(), userId);
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
    const row = this.db.prepare(`SELECT * FROM ranking_snapshots WHERE medium = ? AND board_key = ?`).get(medium, board.key) as Row | undefined;
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

  saveTimelineSnapshot(userId: string, scope: TimelineScope, items: TimelineItem[], fetchedAt = nowIso()) {
    this.db
      .prepare(`
        INSERT INTO timeline_snapshots (user_id, scope, items_json, fetched_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, scope) DO UPDATE SET
          items_json = excluded.items_json,
          fetched_at = excluded.fetched_at
      `)
      .run(userId, scope, JSON.stringify(items), fetchedAt);
  }

  getTimelineSnapshot(userId: string, scope: TimelineScope): TimelineResponse | null {
    const row = this.db.prepare(`SELECT * FROM timeline_snapshots WHERE user_id = ? AND scope = ?`).get(userId, scope) as Row | undefined;
    if (!row) {
      return null;
    }
    const items = parseJson<TimelineItem[]>(row.items_json, []).map((item) => ({
      ...item,
      photoUrls: Array.isArray(item.photoUrls) ? item.photoUrls : [],
      engagements: Array.isArray(item.engagements) ? item.engagements : [],
      userLikeState:
        item.userLikeState === "liked" || item.userLikeState === "not_liked" || item.userLikeState === "unknown"
          ? item.userLikeState
          : "unknown",
      availableActions: {
        like: item.availableActions?.like ?? Boolean(item.detailUrl),
        reply: item.availableActions?.reply ?? Boolean(item.detailUrl),
        repost: item.availableActions?.repost ?? Boolean(item.detailUrl)
      }
    }));
    return {
      scope,
      start: 0,
      items,
      nextStart: items.length > 0 ? items.length : null,
      hasMore: items.length >= timelinePageSize,
      fetchedAt: String(row.fetched_at),
      stale: false
    };
  }

  insertSyncJob(userId: string, type: SyncJobType, payload: Record<string, unknown> = {}): SyncJobRecord {
    const job: SyncJobRecord = {
      id: randomUUID(),
      userId,
      type,
      status: "queued",
      payload,
      startedAt: nowIso(),
      finishedAt: null,
      errorMessage: null
    };
    this.db
      .prepare(`
        INSERT INTO sync_jobs (id, user_id, type, status, payload_json, started_at, finished_at, error_message)
        VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)
      `)
      .run(job.id, userId, job.type, job.status, JSON.stringify(job.payload), job.startedAt);
    return job;
  }

  getSyncJob(userId: string, jobId: string): SyncJobRecord | null {
    const row = this.db.prepare(`SELECT * FROM sync_jobs WHERE id = ? AND user_id = ?`).get(jobId, userId) as Row | undefined;
    return row ? mapJob(row) : null;
  }

  countOpenSyncJobs(userId?: string) {
    if (!userId) {
      const row = this.db.prepare(`SELECT COUNT(*) AS total FROM sync_jobs WHERE status IN ('queued', 'running')`).get() as Row;
      return Number(row.total ?? 0);
    }
    const row = this.db
      .prepare(`SELECT COUNT(*) AS total FROM sync_jobs WHERE user_id = ? AND status IN ('queued', 'running')`)
      .get(userId) as Row;
    return Number(row.total ?? 0);
  }

  claimNextQueuedJob(): SyncJobRecord | null {
    const row = this.db.prepare(`SELECT * FROM sync_jobs WHERE status = 'queued' ORDER BY started_at ASC LIMIT 1`).get() as Row | undefined;
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

  addSyncEvent(userId: string, level: SyncEventRecord["level"], message: string, context: Record<string, unknown> = {}) {
    this.db
      .prepare(`
        INSERT INTO sync_events (user_id, level, message, context_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(userId, level, message, JSON.stringify(context), nowIso());
  }

  listSyncEvents(userId: string, limit = 50): SyncEventRecord[] {
    const rows = this.db
      .prepare(`
        SELECT * FROM sync_events WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
      `)
      .all(userId, limit) as Row[];
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
