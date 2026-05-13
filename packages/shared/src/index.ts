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
  authorUrl: string | null;
  authorAvatarUrl: string | null;
  userVoteState: "voted" | "not_voted" | null;
  content: string;
  rating: string | null;
  createdAt: string | null;
  platform: string | null;
  votes: number | null;
}

export interface SubjectStaffMember {
  name: string;
  role: string | null;
  avatarUrl: string | null;
  profileUrl: string | null;
}

export interface SubjectMediaItem {
  type: "video" | "image";
  title: string | null;
  thumbnailUrl: string | null;
  url: string;
}

export interface SubjectMediaGroup {
  videos: SubjectMediaItem[];
  images: SubjectMediaItem[];
}

export interface SubjectSectionLink {
  key: string;
  label: string;
  url: string;
}

export interface UserItemRecord {
  medium: Medium;
  doubanId: string;
  status: ShelfStatus;
  rating: number | null;
  comment: string | null;
  tags: string[];
  syncToTimeline: boolean;
  syncState: SyncState;
  errorMessage: string | null;
  updatedAt: string;
  lastSyncedAt: string | null;
  lastPushedAt: string | null;
}

export interface AppUser {
  id: string;
  peopleId: string;
  displayName: string | null;
  avatarUrl: string | null;
  ipLocation?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LibraryEntry extends UserItemRecord {
  subject: SubjectRecord;
}

export interface SyncJobRecord {
  id: string;
  userId: string;
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

export interface AuthMeResponse {
  authenticated: boolean;
  user: AppUser | null;
  sessionStatus: DoubanSessionStatus;
}

export interface DoubanLoginResponse {
  user: AppUser;
  sessionStatus: DoubanSessionStatus;
}

export const doubanProxyLoginStatuses = [
  "created",
  "submitting",
  "needs_verification",
  "authorized",
  "claimed",
  "blocked",
  "failed",
  "expired",
  "cancelled"
] as const;
export type DoubanProxyLoginStatus = (typeof doubanProxyLoginStatuses)[number];

export const doubanProxyLoginModes = ["qr", "sms", "password"] as const;
export type DoubanProxyLoginMode = (typeof doubanProxyLoginModes)[number];

export const doubanProxyVerificationMethods = ["none", "sms", "captcha", "qr"] as const;
export type DoubanProxyVerificationMethod = (typeof doubanProxyVerificationMethods)[number];

export const doubanProxyQrStatuses = ["pending", "scan", "login", "invalid", "cancel"] as const;
export type DoubanProxyQrStatus = (typeof doubanProxyQrStatuses)[number];

export const doubanProxyLoginNextActions = [
  "none",
  "start_qr",
  "poll_qr_status",
  "send_sms",
  "enter_sms_code",
  "enter_password",
  "wait_retry",
  "use_cookie_import"
] as const;
export type DoubanProxyLoginNextAction = (typeof doubanProxyLoginNextActions)[number];

export const doubanProxyLoginFallbacks = ["cookie_import"] as const;
export type DoubanProxyLoginFallback = (typeof doubanProxyLoginFallbacks)[number];

export type DoubanProxyLoginErrorCode =
  | "proxy_login_disabled"
  | "attempt_not_found"
  | "attempt_expired"
  | "qr_expired"
  | "qr_cancelled"
  | "invalid_credentials"
  | "invalid_sms_code"
  | "needs_captcha"
  | "needs_sms"
  | "sms_cooldown"
  | "registration_required"
  | "security_challenge"
  | "douban_unavailable"
  | "login_not_verified";

export interface DoubanSupportedCountry {
  label: string;
  englishLabel: string;
  areaCode: string;
  countryCode: string;
}

export interface DoubanProxyLoginConfigResponse {
  enabled: boolean;
  supportedCountries: DoubanSupportedCountry[];
  defaultCountryCode: string;
  availableModes: DoubanProxyLoginMode[];
}

export interface DoubanProxyLoginStartResponse {
  loginAttemptId: string;
  status: DoubanProxyLoginStatus;
  expiresAt: string;
  nextAction: DoubanProxyLoginNextAction;
  verificationMethod: DoubanProxyVerificationMethod;
  maskedTarget: string | null;
  retryAfterSeconds: number | null;
  pollIntervalSeconds: number | null;
  qrCode: string | null;
  qrCodeImageUrl: string | null;
  qrStatus: DoubanProxyQrStatus | null;
  availableFallbacks: DoubanProxyLoginFallback[];
}

export interface DoubanProxyLoginStatusResponse extends DoubanProxyLoginStartResponse {
  errorCode: DoubanProxyLoginErrorCode | null;
  message: string | null;
}

export interface DoubanProxyLoginSubmitResponse extends DoubanProxyLoginStatusResponse {
  user?: AppUser;
  sessionStatus?: DoubanSessionStatus;
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
  staff: SubjectStaffMember[];
  media: SubjectMediaGroup;
  trackList: string[];
  tableOfContents: string[];
  relatedSubjects: SubjectRecord[];
  sectionLinks: SubjectSectionLink[];
}

export interface SubjectCommentsResponse {
  items: SubjectComment[];
  start: number;
  nextStart: number | null;
  hasMore: boolean;
}

export interface SubjectCommentVoteResponse {
  commentId: string;
  votes: number;
  userVoteState: "voted" | "not_voted";
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

export type TimelineLikeState = "liked" | "not_liked" | "unknown";

export interface TimelineAvailableActions {
  like: boolean;
  reply: boolean;
  repost: boolean;
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
  photoUrls: string[];
  engagements: TimelineEngagement[];
  userLikeState: TimelineLikeState;
  availableActions: TimelineAvailableActions;
}

export interface TimelineResponse {
  scope: TimelineScope;
  start: number;
  items: TimelineItem[];
  nextStart: number | null;
  hasMore: boolean;
  fetchedAt: string;
  stale: boolean;
}

export const boardCatalog: Record<Medium, RankingBoardConfig[]> = {
  movie: [
    { key: "hot-movies", name: "热门电影", path: "https://movie.douban.com/j/search_subjects", sourceType: "movie_hot", tag: "热门" },
    { key: "hot-tv", name: "热门电视剧", path: "https://movie.douban.com/j/search_subjects", sourceType: "movie_hot", tag: "热门电视剧" },
    { key: "top250", name: "TOP250", path: "https://movie.douban.com/top250", sourceType: "html_list", maxPages: 10 }
  ],
  music: [
    { key: "weekly-artists", name: "本周流行", path: "https://music.douban.com/", sourceType: "homepage_section", sectionTitle: "本周流行音乐人" },
    { key: "rising-artists", name: "上升最快", path: "https://music.douban.com/", sourceType: "homepage_section", sectionTitle: "上升最快音乐人" },
    { key: "new-albums", name: "新碟榜", path: "https://music.douban.com/chart", sourceType: "html_list" }
  ],
  book: [
    { key: "new-books", name: "新书速递", path: "https://book.douban.com/latest", sourceType: "html_list" },
    { key: "monthly-hot", name: "热门图书榜", path: "https://book.douban.com/chart?subcat=all", sourceType: "html_list" },
    { key: "top250", name: "TOP250", path: "https://book.douban.com/top250", sourceType: "html_list", maxPages: 10 }
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
  cookie: z.string().min(10, "Cookie 长度看起来不够"),
  peopleId: z.string().trim().min(1).optional()
});

export const doubanProxyLoginPasswordSchema = z.object({
  loginAttemptId: z.string().trim().min(1),
  account: z.string().trim().min(1, "账号不能为空").max(200),
  password: z.string().min(1, "密码不能为空").max(200),
  countryCode: z.string().trim().max(10).optional()
});

export const doubanProxyLoginSmsSendSchema = z.object({
  loginAttemptId: z.string().trim().min(1),
  phoneNumber: z.string().trim().min(1, "手机号不能为空").max(32),
  countryCode: z.string().trim().max(10).optional()
});

export const doubanProxyLoginSmsVerifySchema = z.object({
  loginAttemptId: z.string().trim().min(1),
  smsCode: z.string().trim().min(1, "SMS 验证码不能为空").max(20)
});

export const doubanProxyLoginQrStartSchema = z.object({
  loginAttemptId: z.string().trim().min(1)
});

export const updateLibraryStateSchema = z.object({
  status: shelfStatusSchema,
  rating: z.number().int().min(1).max(5).nullable().optional(),
  comment: z.string().trim().max(140).optional(),
  tags: z.array(z.string().trim().min(1).max(20)).max(12).optional(),
  syncToTimeline: z.boolean().optional()
});

export const subjectCommentVoteSchema = z.object({
  commentId: z.string().trim().min(1)
});

export const timelineActionTargetSchema = z.object({
  detailUrl: z.string().trim().url()
});

export const timelineReplySchema = timelineActionTargetSchema.extend({
  text: z.string().trim().min(1, "回复内容不能为空").max(1000)
});

export const timelineRepostSchema = timelineActionTargetSchema.extend({
  text: z.string().trim().max(1000).optional()
});

export interface TimelineActionResponse {
  statusId: string;
  engagements: TimelineEngagement[];
  userLikeState?: Exclude<TimelineLikeState, "unknown">;
}

export type UpdateLibraryStateInput = z.infer<typeof updateLibraryStateSchema>;

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});

export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}
