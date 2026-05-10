import { z } from "zod";

export const mediums = ["movie", "music", "book", "game"] as const;
export type Medium = (typeof mediums)[number];

export const shelfStatuses = ["wish", "doing", "done"] as const;
export type ShelfStatus = (typeof shelfStatuses)[number];

export const syncStates = ["synced", "pending_push", "needs_attention"] as const;
export type SyncState = (typeof syncStates)[number];

export const syncJobTypes = ["manual_pull", "scheduled_pull", "push_reconcile"] as const;
export type SyncJobType = (typeof syncJobTypes)[number];

export const syncJobStatuses = ["queued", "running", "completed", "failed"] as const;
export type SyncJobStatus = (typeof syncJobStatuses)[number];

export const timelineScopes = ["following", "mine"] as const;
export type TimelineScope = (typeof timelineScopes)[number];

export type RankingBoardSource =
  | "html_list"
  | "movie_showing"
  | "movie_hot"
  | "homepage_section"
  | "doulist";

export const mediumLabels: Record<Medium, string> = {
  movie: "电影",
  music: "音乐",
  book: "图书",
  game: "游戏"
};

export const statusLabels: Record<Medium, Record<ShelfStatus, string>> = {
  movie: { wish: "想看", doing: "在看", done: "看过" },
  music: { wish: "想听", doing: "在听", done: "听过" },
  book: { wish: "想读", doing: "在读", done: "读过" },
  game: { wish: "想玩", doing: "在玩", done: "玩过" }
};

export interface SubjectRecord {
  medium: Medium;
  doubanId: string;
  title: string;
  subtitle: string | null;
  year: string | null;
  coverUrl: string | null;
  averageRating: number | null;
  summary: string | null;
  creators: string[];
  metadata: Record<string, string | string[]>;
  updatedAt: string;
}

export interface SubjectComment {
  id: string | null;
  author: string | null;
  content: string;
  rating: string | null;
  createdAt: string | null;
  votes: number | null;
}

export interface UserItemRecord {
  medium: Medium;
  doubanId: string;
  status: ShelfStatus;
  rating: number | null;
  syncState: SyncState;
  errorMessage: string | null;
  updatedAt: string;
  lastSyncedAt: string | null;
  lastPushedAt: string | null;
}

export interface LibraryEntry extends UserItemRecord {
  subject: SubjectRecord;
}

export interface SyncJobRecord {
  id: string;
  type: SyncJobType;
  status: SyncJobStatus;
  payload: Record<string, unknown>;
  startedAt: string;
  finishedAt: string | null;
  errorMessage: string | null;
}

export interface SyncEventRecord {
  id: number;
  level: "info" | "warn" | "error";
  message: string;
  context: Record<string, unknown>;
  createdAt: string;
}

export interface DoubanSessionStatus {
  status: "missing" | "valid" | "invalid";
  peopleId: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  ipLocation?: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
}

export interface OverviewTotal {
  medium: Medium;
  status: ShelfStatus;
  count: number;
}

export interface OverviewResponse {
  totals: OverviewTotal[];
  recentItems: LibraryEntry[];
  lastSyncJob: SyncJobRecord | null;
  sessionStatus: DoubanSessionStatus;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export interface LibraryResponse {
  items: LibraryEntry[];
  pagination: Pagination;
}

export interface SearchResponse {
  items: SubjectRecord[];
}

export interface SubjectDetailResponse {
  subject: SubjectRecord;
  userItem: UserItemRecord | null;
  comments: SubjectComment[];
}

export interface SubjectCommentsResponse {
  items: SubjectComment[];
  start: number;
  nextStart: number | null;
  hasMore: boolean;
}

export interface RankingBoardConfig {
  key: string;
  name: string;
  path: string;
  sourceType?: RankingBoardSource;
  tag?: string;
  sectionTitle?: string;
  maxPages?: number;
}

export interface RankingItem {
  rank: number;
  blurb: string | null;
  subject: SubjectRecord;
}

export interface RankingResponse {
  board: RankingBoardConfig;
  items: RankingItem[];
  fetchedAt: string;
  stale: boolean;
}

export interface TimelineEngagement {
  label: "回应" | "转发" | "赞";
  count: number | null;
}

export interface TimelineItem {
  id: string;
  authorName: string | null;
  authorUrl: string | null;
  authorAvatarUrl: string | null;
  actionText: string | null;
  content: string | null;
  createdAtText: string | null;
  detailUrl: string | null;
  subjectTitle: string | null;
  subjectUrl: string | null;
  subjectCoverUrl: string | null;
  engagements: TimelineEngagement[];
}

export interface TimelineResponse {
  scope: TimelineScope;
  items: TimelineItem[];
  fetchedAt: string;
  stale: boolean;
}

export const boardCatalog: Record<Medium, RankingBoardConfig[]> = {
  movie: [
    { key: "showing", name: "正在热映", path: "https://movie.douban.com/cinema/nowplaying/beijing/", sourceType: "movie_showing" },
    { key: "hot-movies", name: "热门电影", path: "https://movie.douban.com/j/search_subjects", sourceType: "movie_hot", tag: "热门" },
    { key: "hot-tv", name: "热门电视剧", path: "https://movie.douban.com/j/search_subjects", sourceType: "movie_hot", tag: "热门电视剧" },
    { key: "top250", name: "TOP250", path: "https://movie.douban.com/top250", sourceType: "html_list" }
  ],
  music: [
    { key: "weekly-artists", name: "本周流行", path: "https://music.douban.com/", sourceType: "homepage_section", sectionTitle: "本周流行音乐人" },
    { key: "rising-artists", name: "上升最快", path: "https://music.douban.com/", sourceType: "homepage_section", sectionTitle: "上升最快音乐人" },
    { key: "new-albums", name: "新碟榜", path: "https://music.douban.com/chart", sourceType: "html_list" }
  ],
  book: [
    { key: "new-books", name: "新书速递", path: "https://book.douban.com/latest", sourceType: "html_list" },
    { key: "monthly-hot", name: "热门图书榜", path: "https://book.douban.com/chart?subcat=all", sourceType: "html_list" },
    { key: "top250", name: "TOP250", path: "https://book.douban.com/top250", sourceType: "html_list" }
  ],
  game: [
    { key: "top500", name: "豆瓣游戏TOP500", path: "https://www.douban.com/doulist/122952913/", sourceType: "doulist", maxPages: 20 }
  ]
};

export const mediumSchema = z.enum(mediums);
export const shelfStatusSchema = z.enum(shelfStatuses);
export const syncStateSchema = z.enum(syncStates);
export const syncJobTypeSchema = z.enum(syncJobTypes);
export const timelineScopeSchema = z.enum(timelineScopes);

export const importDoubanSessionSchema = z.object({
  cookie: z.string().min(10, "cookie looks too short")
});

export const updateLibraryStateSchema = z.object({
  status: shelfStatusSchema,
  rating: z.number().int().min(1).max(5).nullable().optional()
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});

export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}
