import type {
  AuthMeResponse,
  DoubanLoginResponse,
  DoubanProxyLoginConfigResponse,
  DoubanProxyLoginStatusResponse,
  DoubanProxyLoginSubmitResponse,
  DoubanSessionStatus,
  HealthResponse,
  LibraryResponse,
  Medium,
  OverviewResponse,
  RankingResponse,
  SearchResponse,
  ShelfStatus,
  SubjectCommentsResponse,
  SubjectCommentVoteResponse,
  SubjectDetailResponse,
  SyncEventRecord,
  SyncJobRecord,
  TimelineActionResponse,
  TimelineCommentsResponse,
  TimelineResponse,
  TimelineScope,
  UpdateLibraryStateInput
} from "../../../packages/shared/src";

export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";
export const RENDER_DEMO_WARNING_MESSAGE =
  "这是免费实例；服务会休眠；本地 SQLite 不持久；重启或重新部署后数据可能丢失；不建议长期保存重要数据。";

export function proxiedImageUrl(url: string | null | undefined) {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url, window.location.href);
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
      return parsed.toString();
    }
    return `${API_BASE}/api/image?url=${encodeURIComponent(parsed.toString())}`;
  } catch {
    return url;
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...options,
    headers: {
      "content-type": "application/json",
      ...options.headers
    }
  });

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    if (typeof payload === "string" && contentType.includes("text/html")) {
      throw new ApiError("douban-lite API 没有连到当前前端，请启动项目自带 API，或检查 VITE_API_BASE_URL / VITE_API_PROXY_TARGET。", response.status);
    }
    throw new ApiError(typeof payload === "string" ? payload : payload.error ?? "请求失败。", response.status);
  }
  return payload as T;
}

export function getOverview() {
  return request<OverviewResponse>("/api/me/overview");
}

export function getLibrary(medium: Medium, status: ShelfStatus | undefined, page = 1) {
  const params = new URLSearchParams({
    medium,
    page: String(page)
  });
  if (status) {
    params.set("status", status);
  }
  return request<LibraryResponse>(`/api/library?${params.toString()}`);
}

export function searchSubjects(medium: Medium, query: string) {
  const params = new URLSearchParams({
    medium,
    q: query
  });
  return request<SearchResponse>(`/api/subjects/search?${params.toString()}`);
}

export function getSubjectDetail(medium: Medium, doubanId: string) {
  return request<SubjectDetailResponse>(`/api/subjects/${medium}/${doubanId}`);
}

export function getSubjectComments(medium: Medium, doubanId: string, start = 0, limit = 20) {
  const params = new URLSearchParams({
    start: String(start),
    limit: String(limit)
  });
  return request<SubjectCommentsResponse>(`/api/subjects/${medium}/${doubanId}/comments?${params.toString()}`);
}

export function voteSubjectComment(medium: Medium, doubanId: string, commentId: string) {
  return request<SubjectCommentVoteResponse>(`/api/subjects/${medium}/${doubanId}/comments/vote`, {
    method: "POST",
    body: JSON.stringify({ commentId })
  });
}

export function getRanking(medium: Medium, board: string) {
  const params = new URLSearchParams({
    medium,
    board
  });
  return request<RankingResponse>(`/api/rankings?${params.toString()}`);
}

export function getTimeline(scope: TimelineScope, start = 0) {
  const params = new URLSearchParams({
    scope,
    start: String(start)
  });
  return request<TimelineResponse>(`/api/timeline?${params.toString()}`);
}

export function getTimelineComments(statusId: string, detailUrl: string) {
  return request<TimelineCommentsResponse>(`/api/timeline/${statusId}/comments`, {
    method: "POST",
    body: JSON.stringify({ detailUrl })
  });
}

export function likeTimelineStatus(statusId: string, detailUrl: string) {
  return request<TimelineActionResponse>(`/api/timeline/${statusId}/like`, {
    method: "POST",
    body: JSON.stringify({ detailUrl })
  });
}

export function replyTimelineStatus(statusId: string, detailUrl: string, text: string) {
  return request<TimelineActionResponse>(`/api/timeline/${statusId}/reply`, {
    method: "POST",
    body: JSON.stringify({ detailUrl, text })
  });
}

export function repostTimelineStatus(statusId: string, detailUrl: string, text?: string) {
  return request<TimelineActionResponse>(`/api/timeline/${statusId}/repost`, {
    method: "POST",
    body: JSON.stringify(text != null ? { detailUrl, text } : { detailUrl })
  });
}

export function updateLibraryState(medium: Medium, doubanId: string, input: UpdateLibraryStateInput) {
  return request<{ job: SyncJobRecord; userItem: SubjectDetailResponse["userItem"] }>(`/api/library/${medium}/${doubanId}/state`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function importDoubanSession(cookie: string) {
  return request<DoubanLoginResponse>("/api/settings/douban-session/import", {
    method: "POST",
    body: JSON.stringify({ cookie })
  });
}

export function getDoubanProxyLoginConfig() {
  return request<DoubanProxyLoginConfigResponse>("/api/auth/douban/proxy/config");
}

export function startDoubanProxyLogin() {
  return request<DoubanProxyLoginStatusResponse>("/api/auth/douban/proxy/start", {
    method: "POST"
  });
}

export function startDoubanProxyQrLogin(input: { loginAttemptId: string }) {
  return request<DoubanProxyLoginStatusResponse>("/api/auth/douban/proxy/qr/start", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function getDoubanProxyLoginStatus(loginAttemptId: string) {
  return request<DoubanProxyLoginSubmitResponse>(`/api/auth/douban/proxy/${encodeURIComponent(loginAttemptId)}/status`);
}

export function submitDoubanProxyPassword(input: { loginAttemptId: string; account: string; password: string; countryCode?: string }) {
  return request<DoubanProxyLoginSubmitResponse>("/api/auth/douban/proxy/password", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function sendDoubanProxySmsCode(input: { loginAttemptId: string; phoneNumber: string; countryCode?: string }) {
  return request<DoubanProxyLoginStatusResponse>("/api/auth/douban/proxy/sms/send", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function verifyDoubanProxySmsCode(input: { loginAttemptId: string; smsCode: string }) {
  return request<DoubanProxyLoginSubmitResponse>("/api/auth/douban/proxy/sms/verify", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function logoutDoubanSession() {
  return request<{ status: DoubanSessionStatus["status"] }>("/api/settings/douban-session/logout", {
    method: "POST"
  });
}

export function getDoubanSessionStatus() {
  return request<DoubanSessionStatus>("/api/settings/douban-session/status");
}

export function getAuthMe() {
  return request<AuthMeResponse>("/api/session/me");
}

export function getHealth() {
  return request<HealthResponse>("/health");
}

export function triggerManualSync() {
  return request<SyncJobRecord>("/api/sync/pull", {
    method: "POST"
  });
}

export function getSyncJob(jobId: string) {
  return request<SyncJobRecord>(`/api/sync/jobs/${jobId}`);
}

export function getSyncEvents() {
  return request<{ items: SyncEventRecord[] }>("/api/sync/events");
}
