import type {
  DoubanSessionStatus,
  LibraryResponse,
  Medium,
  OverviewResponse,
  RankingResponse,
  SearchResponse,
  ShelfStatus,
  SubjectCommentsResponse,
  SubjectDetailResponse,
  SyncEventRecord,
  SyncJobRecord,
  TimelineResponse,
  TimelineScope
} from "../../../packages/shared/src";

export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

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
    throw new ApiError(typeof payload === "string" ? payload : payload.error ?? "Request failed", response.status);
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

export function getRanking(medium: Medium, board: string) {
  const params = new URLSearchParams({
    medium,
    board
  });
  return request<RankingResponse>(`/api/rankings?${params.toString()}`);
}

export function getTimeline(scope: TimelineScope) {
  const params = new URLSearchParams({ scope });
  return request<TimelineResponse>(`/api/timeline?${params.toString()}`);
}

export function updateLibraryState(medium: Medium, doubanId: string, input: { status: ShelfStatus; rating: number | null }) {
  return request<{ job: SyncJobRecord; userItem: SubjectDetailResponse["userItem"] }>(`/api/library/${medium}/${doubanId}/state`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function importDoubanSession(cookie: string) {
  return request<DoubanSessionStatus>("/api/settings/douban-session/import", {
    method: "POST",
    body: JSON.stringify({ cookie })
  });
}

export function logoutDoubanSession() {
  return request<DoubanSessionStatus>("/api/settings/douban-session/logout", {
    method: "POST"
  });
}

export function getDoubanSessionStatus() {
  return request<DoubanSessionStatus>("/api/settings/douban-session/status");
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
