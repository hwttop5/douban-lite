import {
  type Medium,
  type RankingBoardConfig,
  type RankingItem,
  type ShelfStatus,
  type SubjectComment,
  type SubjectCommentsResponse,
  type SubjectRecord,
  type TimelineActionResponse,
  type TimelineCommentsResponse,
  type TimelineScope,
  timelinePageSize
} from "../../../../packages/shared/src";
import type { AppConfig } from "../config";
import {
  parseAuthToken,
  DoubanSessionError,
  ensureNoAccessChallenge,
  parseDoubanProfile,
  parseProfileCollectionTotals,
  parseInterestForm,
  parseInterestSelection,
  parsePeopleId,
  parseRanking,
  parseSearchResults,
  parseSubjectCommentVoteAction,
  inferSubjectCommentCancelVoteUrl,
  parseSubjectComments,
  parseSubjectDetail,
  parseSubjectDetailExtras,
  parseTimelineActionContext,
  parseTimelineCommentsConfig,
  parseTimelineComments,
  parseTimelinePage,
  parseUserCollection
} from "./parsers";

interface PushStateInput {
  status: ShelfStatus;
  rating: number | null;
  comment?: string | null;
  tags?: string[];
  syncToTimeline?: boolean;
}

interface VoteResult {
  commentId: string;
  votes: number;
  userVoteState: "voted" | "not_voted";
}

interface TimelineActionResolveResult {
  authToken: string | null;
  detailUrl: string;
  resolvedStatusId: string;
  context: NonNullable<ReturnType<typeof parseTimelineActionContext>>;
}

function readCookieValue(cookie: string, key: string) {
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${key}=([^;]+)`));
  return match?.[1] ?? null;
}

export class DoubanClient {
  constructor(private readonly config: Pick<AppConfig, "doubanPublicBaseUrl" | "doubanWebBaseUrl">) {}

  private readonly authorAvatarCache = new Map<string, string | null>();
  private readonly timelinePageSize = timelinePageSize;
  private readonly userAgent =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

  private usesCustomWebBase() {
    return this.config.doubanWebBaseUrl !== "https://www.douban.com";
  }

  private authBaseUrl(medium: Medium) {
    if (this.usesCustomWebBase()) {
      return `${this.config.doubanWebBaseUrl}/${medium}`;
    }
    switch (medium) {
      case "movie":
        return "https://movie.douban.com";
      case "book":
        return "https://book.douban.com";
      case "music":
        return "https://music.douban.com";
      case "game":
        return `${this.config.doubanWebBaseUrl}/game`;
    }
  }

  private publicSubjectUrl(medium: Medium, doubanId: string) {
    if (medium === "game") {
      return `${this.config.doubanWebBaseUrl}/game/${doubanId}/`;
    }
    return `${this.config.doubanPublicBaseUrl}/${medium}/subject/${doubanId}`;
  }

  private authSubjectUrl(medium: Medium, doubanId: string) {
    if (medium === "game") {
      return `${this.authBaseUrl(medium)}/${doubanId}/`;
    }
    return `${this.authBaseUrl(medium)}/subject/${doubanId}`;
  }

  private toDoubanStatus(status: ShelfStatus) {
    switch (status) {
      case "wish":
        return "wish";
      case "doing":
        return "do";
      case "done":
        return "collect";
    }
  }

  private applyInterestExtras(body: URLSearchParams, nextState: PushStateInput) {
    const comment = nextState.comment?.trim() ?? "";
    const tags = nextState.tags?.map((tag) => tag.trim()).filter(Boolean).join(" ") ?? "";
    const syncValue = nextState.syncToTimeline === false ? "0" : "1";

    const setFirstMatching = (patterns: RegExp[], fallback: string, value: string) => {
      const key = Array.from(body.keys()).find((name) => patterns.some((pattern) => pattern.test(name)));
      body.set(key ?? fallback, value);
    };

    setFirstMatching([/^comment$/i, /comment/i, /intro/i], "comment", comment);
    setFirstMatching([/^tags$/i, /tag/i], "tags", tags);

    for (const key of ["sync_douban", "sync_to_douban", "sync_to_timeline", "sync"]) {
      if (body.has(key)) {
        body.set(key, syncValue);
      }
    }
    if (!body.has("sync_douban")) {
      body.set("sync_douban", syncValue);
    }
  }

  private searchCategory(medium: Medium) {
    switch (medium) {
      case "movie":
        return "1002";
      case "book":
        return "1001";
      case "music":
        return "1003";
      case "game":
        return "3114";
    }
  }

  private createJsonSubject(medium: Medium, board: RankingBoardConfig, input: {
    id: string;
    title: string;
    url: string;
    cover?: string | null;
    rate?: string | number | null;
    summary?: string | null;
  }): SubjectRecord {
    return {
      medium,
      doubanId: String(input.id),
      title: input.title,
      subtitle: null,
      year: null,
      coverUrl: input.cover ?? null,
      averageRating: Number(input.rate) || null,
      summary: input.summary ?? null,
      creators: [],
      metadata: {
        board: board.key,
        externalUrl: input.url
      },
      updatedAt: new Date().toISOString()
    };
  }

  private async request(url: string, options: RequestInit = {}) {
    const response = await fetch(url, {
      redirect: "follow",
      ...options,
      headers: {
        "user-agent": this.userAgent,
        accept: "text/html,application/xhtml+xml,application/json",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
        ...options.headers
      }
    });
    const text = await response.text();
    ensureNoAccessChallenge(text, response.url);
    if (!response.ok) {
      throw new Error(`Douban request failed: ${response.status} ${response.statusText}`);
    }
    return { text, url: response.url };
  }

  private async requestJson<T>(url: string, options: RequestInit = {}) {
    const response = await fetch(url, {
      redirect: "follow",
      ...options,
      headers: {
        "user-agent": this.userAgent,
        accept: "application/json, text/javascript, */*; q=0.01",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
        ...options.headers
      }
    });
    const text = await response.text();
    ensureNoAccessChallenge(text, response.url);
    if (!response.ok) {
      throw new Error(`Douban request failed: ${response.status} ${response.statusText}`);
    }
    return JSON.parse(text) as T;
  }

  private parseTimelineCommentsFromPayload(payload: unknown, baseUrl: string) {
    if (typeof payload === "string") {
      return parseTimelineComments(payload, baseUrl);
    }
    if (!payload || typeof payload !== "object") {
      return [];
    }

    const unwrapObject = payload as Record<string, unknown>;
    const htmlCandidates = [unwrapObject.html, unwrapObject.commentsHtml, unwrapObject.comments, unwrapObject.data];
    for (const candidate of htmlCandidates) {
      if (typeof candidate === "string") {
        const comments = parseTimelineComments(candidate, baseUrl);
        if (comments.length > 0) {
          return comments;
        }
      }
    }

    const listCandidate =
      Array.isArray(unwrapObject.comments) ? unwrapObject.comments :
      Array.isArray(unwrapObject.items) ? unwrapObject.items :
      Array.isArray(unwrapObject.data) ? unwrapObject.data :
      null;
    if (!listCandidate) {
      return [];
    }

    return listCandidate
      .map((item, index) => {
        if (!item || typeof item !== "object") {
          return null;
        }
        const row = item as Record<string, unknown>;
        const authorObject = row.author && typeof row.author === "object" ? (row.author as Record<string, unknown>) : null;
        const content =
          typeof row.content === "string" ? row.content :
          typeof row.text === "string" ? row.text :
          typeof row.comment === "string" ? row.comment :
          null;
        if (!content || content.trim().length === 0) {
          return null;
        }
        return {
          id: typeof row.id === "string" ? row.id : typeof row.cid === "string" ? row.cid : `comment-${index}`,
          author:
            typeof row.authorName === "string" ? row.authorName :
            typeof row.author === "string" ? row.author :
            typeof authorObject?.name === "string" ? authorObject.name :
            typeof row.userName === "string" ? row.userName :
            null,
          authorUrl:
            typeof row.authorUrl === "string" ? new URL(row.authorUrl, baseUrl).toString() :
            typeof authorObject?.url === "string" ? new URL(authorObject.url, baseUrl).toString() :
            typeof row.userUrl === "string" ? new URL(row.userUrl, baseUrl).toString() :
            null,
          authorAvatarUrl:
            typeof row.authorAvatarUrl === "string" ? new URL(row.authorAvatarUrl, baseUrl).toString() :
            typeof authorObject?.avatar === "string" ? new URL(authorObject.avatar, baseUrl).toString() :
            typeof row.avatar === "string" ? new URL(row.avatar, baseUrl).toString() :
            null,
          content: content.trim(),
          createdAt:
            typeof row.createdAt === "string" ? row.createdAt :
            typeof row.create_time === "string" ? row.create_time :
            typeof row.time === "string" ? row.time :
            typeof row.pubtime === "string" ? row.pubtime :
            null
        };
      })
      .filter((item): item is NonNullable<typeof item> => item != null);
  }

  private parseTimelineCommentsFromInlineConfig(html: string, baseUrl: string) {
    const commentsMatch = html.match(/['"]comments['"]\s*:\s*(\[[\s\S]*?\])\s*,\s*['"]total['"]/);
    if (!commentsMatch?.[1]) {
      return [];
    }
    try {
      return this.parseTimelineCommentsFromPayload({ comments: JSON.parse(commentsMatch[1]) }, baseUrl);
    } catch {
      return [];
    }
  }

  private async readTimelineComments(statusId: string, detailHtml: string, detailUrl: string, cookie: string) {
    const directComments = parseTimelineComments(detailHtml, detailUrl);
    if (directComments.length > 0) {
      return directComments;
    }

    const inlineConfigComments = this.parseTimelineCommentsFromInlineConfig(detailHtml, detailUrl);
    if (inlineConfigComments.length > 0) {
      return inlineConfigComments;
    }

    const config = parseTimelineCommentsConfig(detailHtml, detailUrl, statusId) ?? parseTimelineCommentsConfig(detailHtml, detailUrl);
    if (!config) {
      return [];
    }

    const fallbackUrls = [
      new URL(`${config.apiBaseUrl.replace(/\/$/, "")}/${encodeURIComponent(config.statusId)}/comments`, detailUrl).toString(),
      new URL(`${config.apiBaseUrl.replace(/\/$/, "")}/${encodeURIComponent(config.statusId)}`, detailUrl).toString()
    ];

    for (const url of fallbackUrls) {
      try {
        const payload = await this.requestJson<unknown>(url, {
          headers: {
            cookie,
            referer: detailUrl,
            "x-requested-with": "XMLHttpRequest"
          }
        });
        const comments = this.parseTimelineCommentsFromPayload(payload, detailUrl);
        if (comments.length > 0) {
          return comments;
        }
      } catch {
        try {
          const response = await this.request(url, {
            headers: {
              cookie,
              referer: detailUrl,
              "x-requested-with": "XMLHttpRequest"
            }
          });
          const comments = parseTimelineComments(response.text, response.url);
          if (comments.length > 0) {
            return comments;
          }
        } catch {
          // Try the next candidate URL.
        }
      }
    }

    return [];
  }

  private async voteComment(
    url: string,
    commentId: string,
    cookie: string,
    referer: string,
    fallbackVotes: number,
    fallbackUserVoteState: VoteResult["userVoteState"],
    authTokenOverride?: string | null
  ): Promise<VoteResult> {
    const authToken = authTokenOverride ?? readCookieValue(cookie, "ck");
    if (!authToken) {
      throw new Error("Douban session is missing ck token.");
    }
    const payload = await this.requestJson<{
      msg?: string;
      r?: number;
      digg_n?: number;
      count?: number;
      vote_count?: number;
      useful_count?: number;
      data?: {
        digg_n?: number;
        count?: number;
        vote_count?: number;
        useful_count?: number;
      };
    }>(url, {
      method: "POST",
      headers: {
        cookie,
        referer,
        "x-requested-with": "XMLHttpRequest",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8"
      },
      body: new URLSearchParams({
        id: commentId,
        ck: authToken
      })
    });
    if (payload.r) {
      throw new Error(payload.msg ?? "Douban comment vote failed.");
    }
    const nextVotes =
      payload.digg_n ??
      payload.count ??
      payload.vote_count ??
      payload.useful_count ??
      payload.data?.digg_n ??
      payload.data?.count ??
      payload.data?.vote_count ??
      payload.data?.useful_count ??
      (fallbackUserVoteState === "voted" ? fallbackVotes + 1 : Math.max(0, fallbackVotes - 1));
    return {
      commentId,
      votes: nextVotes,
      userVoteState: fallbackUserVoteState
    };
  }

  private resolveSubjectCommentCancelVoteUrls(voteUrl: string, commentId: string, explicitCancelVoteUrl?: string | null) {
    const candidates = new Set<string>();
    if (explicitCancelVoteUrl) {
      candidates.add(explicitCancelVoteUrl);
    }
    const inferredPathCancelUrl = inferSubjectCommentCancelVoteUrl(voteUrl, commentId);
    if (inferredPathCancelUrl) {
      candidates.add(inferredPathCancelUrl);
    }
    try {
      const resolved = new URL(voteUrl);
      if (/\/j\/comment\/vote\/?$/.test(resolved.pathname)) {
        resolved.pathname = "/j/comment/cancel_vote";
        resolved.search = "";
        candidates.add(resolved.toString());
      }
    } catch {
      // Ignore malformed vote urls and fall through to the collected candidates.
    }
    return [...candidates];
  }

  private resolveTimelineTextField(form: TimelineActionResolveResult["context"]["replyForm"] | TimelineActionResolveResult["context"]["repostForm"]) {
    if (!form) {
      return null;
    }
    if (form.textFieldName) {
      return form.textFieldName;
    }
    return (
      Object.keys(form.defaultFields).find((key) => /(text|content|comment|reply|repost|status)/i.test(key)) ??
      null
    );
  }

  private buildTimelineActionBody(
    form: NonNullable<TimelineActionResolveResult["context"]["likeForm"]>,
    statusId: string,
    authToken: string | null,
    text?: string
  ) {
    const body = new URLSearchParams(form.defaultFields);
    const knownStatusKeys = ["sid", "status_id", "statusid", "id"];
    if (form.includeStatusFields !== false && !knownStatusKeys.some((key) => body.has(key))) {
      body.set("sid", statusId);
      body.set("status_id", statusId);
    }
    if (authToken && !body.has("ck")) {
      body.set("ck", authToken);
    }
    if (text !== undefined) {
      const textField = this.resolveTimelineTextField(form);
      if (!textField) {
        throw new Error("Unable to resolve Douban timeline text field.");
      }
      body.set(textField, text);
    }
    return body;
  }

  private async readTimelineActionContext(statusId: string, detailUrl: string, cookie: string): Promise<TimelineActionResolveResult> {
    const detailPage = await this.request(detailUrl, {
      headers: {
        cookie
      }
    });
    const context = parseTimelineActionContext(detailPage.text, detailPage.url, statusId) ?? parseTimelineActionContext(detailPage.text, detailPage.url, "");
    if (!context) {
      throw new Error("Unable to resolve Douban timeline action context.");
    }
    return {
      authToken: parseAuthToken(detailPage.text),
      detailUrl: detailPage.url,
      resolvedStatusId: context.statusId,
      context
    };
  }

  private async submitTimelineAction(
    detailUrl: string,
    form: NonNullable<TimelineActionResolveResult["context"]["likeForm"]>,
    requestedStatusId: string,
    resolvedStatusId: string,
    cookie: string,
    authToken: string | null,
    text?: string
  ): Promise<TimelineActionResponse> {
    const body = this.buildTimelineActionBody(form, resolvedStatusId, authToken, text);
    if (form.method === "GET") {
      const actionUrl = new URL(form.actionUrl);
      body.forEach((value, key) => {
        actionUrl.searchParams.set(key, value);
      });
      await this.request(actionUrl.toString(), {
        headers: {
          cookie,
          referer: detailUrl,
          "x-requested-with": "XMLHttpRequest"
        }
      });
    } else {
      await this.request(form.actionUrl, {
        method: "POST",
        headers: {
          cookie,
          referer: detailUrl,
          origin: new URL(detailUrl).origin,
          "x-requested-with": "XMLHttpRequest",
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8"
        },
        body
      });
    }
    const refreshed = await this.readTimelineActionContext(resolvedStatusId, detailUrl, cookie);
    return {
      statusId: requestedStatusId,
      engagements: refreshed.context.engagements,
      userLikeState: refreshed.context.userLikeState === "unknown" ? undefined : refreshed.context.userLikeState
    };
  }

  private async readInterestSelection(medium: Medium, doubanId: string, detailUrl: string, cookie: string, fallbackHtml: string) {
    if (medium === "game") {
      return parseInterestSelection(fallbackHtml, detailUrl);
    }

    const interestUrl = `${this.authBaseUrl(medium)}/j/subject/${doubanId}/interest`;
    try {
      const editor = await this.requestJson<{ html: string }>(interestUrl, {
        headers: {
          cookie,
          referer: detailUrl,
          "x-requested-with": "XMLHttpRequest"
        }
      });
      return parseInterestSelection(editor.html, interestUrl);
    } catch {
      return parseInterestSelection(fallbackHtml, detailUrl);
    }
  }

  async validateSession(cookie: string, peopleId?: string | null) {
    const target = peopleId
      ? `${this.config.doubanWebBaseUrl}/people/${peopleId}/`
      : `${this.config.doubanWebBaseUrl}/mine/`;
    const { text, url } = await this.request(target, {
      headers: {
        cookie
      }
    });
    const profile = parseDoubanProfile(text, url);
    return {
      peopleId: peopleId ?? profile.peopleId ?? parsePeopleId(text),
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      ipLocation: profile.ipLocation,
      status: "valid" as const
    };
  }

  async getProfileOverview(cookie: string, peopleId: string) {
    const { text, url } = await this.request(`${this.config.doubanWebBaseUrl}/people/${peopleId}/`, {
      headers: {
        cookie
      }
    });
    return {
      ...parseDoubanProfile(text, url),
      totals: parseProfileCollectionTotals(text)
    };
  }

  async searchSubjects(medium: Medium, query: string, cookie?: string) {
    const url = this.usesCustomWebBase()
      ? `${this.config.doubanPublicBaseUrl}/search?medium=${medium}&q=${encodeURIComponent(query)}`
      : `${this.config.doubanWebBaseUrl}/search?cat=${this.searchCategory(medium)}&q=${encodeURIComponent(query)}`;
    const { text } = await this.request(url, cookie ? { headers: { cookie } } : undefined);
    return parseSearchResults(text, url, medium);
  }

  private async resolveAuthorAvatar(authorUrl: string, cookie?: string) {
    if (this.authorAvatarCache.has(authorUrl)) {
      return this.authorAvatarCache.get(authorUrl) ?? null;
    }
    try {
      const { text, url } = await this.request(authorUrl, cookie ? { headers: { cookie } } : undefined);
      const avatarUrl = parseDoubanProfile(text, url).avatarUrl ?? null;
      this.authorAvatarCache.set(authorUrl, avatarUrl);
      return avatarUrl;
    } catch {
      this.authorAvatarCache.set(authorUrl, null);
      return null;
    }
  }

  private async enrichCommentAuthors(comments: SubjectComment[], cookie?: string) {
    if (comments.length === 0) {
      return comments;
    }
    const avatars = await Promise.all(
      comments.map(async (comment) => {
        if (!comment.authorUrl) {
          return null;
        }
        return this.resolveAuthorAvatar(comment.authorUrl, cookie);
      })
    );
    return comments.map((comment, index) => ({
      ...comment,
      authorAvatarUrl: comment.authorAvatarUrl ?? avatars[index] ?? null
    }));
  }

  async getSubjectDetail(medium: Medium, doubanId: string, cookie?: string) {
    const url = cookie ? this.authSubjectUrl(medium, doubanId) : this.publicSubjectUrl(medium, doubanId);
    const { text, url: finalUrl } = await this.request(url, cookie ? { headers: { cookie } } : undefined);
    const subject = parseSubjectDetail(text, url, medium);
    const comments = await this.enrichCommentAuthors(parseSubjectComments(text), cookie);
    return {
      subject,
      comments,
      extras: parseSubjectDetailExtras(text, url, medium, subject.doubanId),
      userSelection: cookie ? await this.readInterestSelection(medium, doubanId, finalUrl, cookie, text) : null
    };
  }

  async getSubjectComments(medium: Medium, doubanId: string, start: number, limit: number, cookie?: string): Promise<SubjectCommentsResponse> {
    const params = new URLSearchParams({
      start: String(start),
      limit: String(limit),
      sort: "new_score",
      status: "P"
    });
    const baseUrl = this.usesCustomWebBase()
      ? medium === "game"
        ? `${this.config.doubanWebBaseUrl}/game/${doubanId}/comments`
        : `${this.config.doubanPublicBaseUrl}/${medium}/subject/${doubanId}/comments`
      : medium === "game"
        ? `${this.config.doubanWebBaseUrl}/game/${doubanId}/comments`
        : `${this.authBaseUrl(medium)}/subject/${doubanId}/comments`;
    const url = `${baseUrl}?${params.toString()}`;
    const { text } = await this.request(url, cookie ? { headers: { cookie } } : undefined);
    const items = await this.enrichCommentAuthors(parseSubjectComments(text, limit), cookie);
    return {
      items,
      start,
      nextStart: items.length > 0 ? start + items.length : null,
      hasMore: items.length >= limit
    };
  }

  private async readSubjectCommentVoteAction(medium: Medium, doubanId: string, commentId: string, cookie: string) {
    const commentPageUrl =
      medium === "game"
        ? `${this.config.doubanWebBaseUrl}/game/${doubanId}/comments?comment_id=${encodeURIComponent(commentId)}`
        : `${this.authBaseUrl(medium)}/subject/${doubanId}/comments?comment_id=${encodeURIComponent(commentId)}`;
    const { text, url } = await this.request(commentPageUrl, {
      headers: {
        cookie,
        referer: this.authSubjectUrl(medium, doubanId)
      }
    });
    return {
      text,
      url,
      authToken: parseAuthToken(text),
      action: parseSubjectCommentVoteAction(text, commentId, url)
    };
  }

  async voteSubjectComment(medium: Medium, doubanId: string, commentId: string, cookie: string) {
    const { authToken, action } = await this.readSubjectCommentVoteAction(medium, doubanId, commentId, cookie);
    if (!action) {
      throw new Error("Unable to resolve Douban comment vote action.");
    }
    const referer =
      medium === "game"
        ? `${this.config.doubanWebBaseUrl}/game/${doubanId}/comments`
        : `${this.authBaseUrl(medium)}/subject/${doubanId}/comments`;
    if (action.userVoteState === "voted") {
      const cancelVoteUrls = this.resolveSubjectCommentCancelVoteUrls(action.voteUrl, commentId, action.cancelVoteUrl);
      if (cancelVoteUrls.length === 0) {
        throw new Error("Unable to resolve Douban comment cancel-vote action.");
      }
      let lastError: unknown;
      for (const cancelVoteUrl of cancelVoteUrls) {
        try {
          return await this.voteComment(cancelVoteUrl, commentId, cookie, referer, action.votes, "not_voted", authToken);
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError instanceof Error ? lastError : new Error("Douban comment cancel-vote failed.");
    }
    return this.voteComment(action.voteUrl, commentId, cookie, referer, action.votes, "voted", authToken);
  }

  async likeTimelineStatus(statusId: string, detailUrl: string, cookie: string): Promise<TimelineActionResponse> {
    const resolved = await this.readTimelineActionContext(statusId, detailUrl, cookie);
    const form =
      resolved.context.userLikeState === "liked"
        ? resolved.context.unlikeForm ?? resolved.context.likeForm
        : resolved.context.likeForm ?? resolved.context.unlikeForm;
    if (!form) {
      throw new Error("Unable to resolve Douban timeline like action.");
    }
    return this.submitTimelineAction(resolved.detailUrl, form, statusId, resolved.resolvedStatusId, cookie, resolved.authToken);
  }

  async replyTimelineStatus(statusId: string, detailUrl: string, text: string, cookie: string): Promise<TimelineActionResponse> {
    const resolved = await this.readTimelineActionContext(statusId, detailUrl, cookie);
    if (!resolved.context.replyForm) {
      throw new Error("Unable to resolve Douban timeline reply action.");
    }
    return this.submitTimelineAction(resolved.detailUrl, resolved.context.replyForm, statusId, resolved.resolvedStatusId, cookie, resolved.authToken, text.trim());
  }

  async repostTimelineStatus(statusId: string, detailUrl: string, text: string | undefined, cookie: string): Promise<TimelineActionResponse> {
    const resolved = await this.readTimelineActionContext(statusId, detailUrl, cookie);
    if (!resolved.context.repostForm) {
      throw new Error("Unable to resolve Douban timeline repost action.");
    }
    return this.submitTimelineAction(resolved.detailUrl, resolved.context.repostForm, statusId, resolved.resolvedStatusId, cookie, resolved.authToken, text?.trim() ?? "");
  }

  async getTimelineComments(statusId: string, detailUrl: string, cookie: string): Promise<TimelineCommentsResponse> {
    const detailPage = await this.request(detailUrl, {
      headers: {
        cookie
      }
    });
    return {
      statusId,
      comments: await this.readTimelineComments(statusId, detailPage.text, detailPage.url, cookie)
    };
  }

  async getRanking(medium: Medium, board: RankingBoardConfig, cookie?: string) {
    if (board.sourceType === "movie_hot") {
      if (this.usesCustomWebBase()) {
        const { text, url: finalUrl } = await this.request(`${this.config.doubanPublicBaseUrl}/${medium}/board/${board.key}`, cookie ? { headers: { cookie } } : undefined);
        return parseRanking(text, finalUrl, medium, board);
      }
      const params = new URLSearchParams({
        type: board.key === "hot-tv" ? "tv" : "movie",
        tag: "热门",
        sort: "recommend",
        page_limit: "25",
        page_start: "0"
      });
      const rows = await this.requestJson<{ subjects: Array<{ id: string; title: string; url: string; cover?: string; rate?: string }> }>(
        `${board.path}?${params.toString()}`,
        cookie ? { headers: { cookie, referer: "https://movie.douban.com/" } } : { headers: { referer: "https://movie.douban.com/" } }
      );
      return rows.subjects.map((row, index): RankingItem => ({
        rank: index + 1,
        blurb: null,
        subject: this.createJsonSubject(medium, board, row)
      }));
    }

    const url = this.usesCustomWebBase()
      ? `${this.config.doubanPublicBaseUrl}/${medium}/board/${board.key}`
      : board.path.startsWith("http")
        ? board.path
        : `${this.config.doubanPublicBaseUrl}${board.path}`;

    if (board.sourceType === "doulist" || (board.sourceType === "html_list" && (board.maxPages ?? 1) > 1)) {
      const allItems: RankingItem[] = [];
      const seen = new Set<string>();
      const maxPages = board.maxPages ?? 1;
      const limit = board.sourceType === "doulist" ? 500 : maxPages * 25;
      for (let page = 0; page < maxPages; page += 1) {
        const pageUrl = `${url}${url.includes("?") ? "&" : "?"}start=${page * 25}`;
        const { text, url: finalUrl } = await this.request(pageUrl, cookie ? { headers: { cookie } } : undefined);
        const pageItems = parseRanking(text, finalUrl, medium, board);
        const freshItems = pageItems.filter((item) => {
          if (seen.has(item.subject.doubanId)) {
            return false;
          }
          seen.add(item.subject.doubanId);
          return true;
        });
        allItems.push(...freshItems);
        if (freshItems.length === 0) {
          break;
        }
      }
      return allItems.map((item, index) => ({ ...item, rank: index + 1 })).slice(0, limit);
    }

    const { text } = await this.request(url, cookie ? { headers: { cookie } } : undefined);
    return parseRanking(text, url, medium, board);
  }

  async getTimeline(scope: TimelineScope, cookie: string, peopleId?: string | null, start = 0) {
    const timelinePath =
      scope === "following"
        ? "/"
        : `/people/${peopleId ?? ""}/statuses`;
    if (scope === "mine" && !peopleId) {
      throw new Error("peopleId is required for mine timeline.");
    }
    const buildTimelineUrl = (pageNumber: number) => {
      const timelineUrl = new URL(timelinePath, `${this.config.doubanWebBaseUrl.replace(/\/$/, "")}/`);
      if (pageNumber > 1) {
        timelineUrl.searchParams.set("p", String(pageNumber));
      }
      return timelineUrl.toString();
    };

    const initialPageNumber = Math.max(1, Math.floor(start / this.timelinePageSize) + 1);
    const maxFollowingEmptyPageSkips = scope === "following" ? 2 : 0;
    let attempts = 0;
    let currentPageNumber = initialPageNumber;
    let currentStart = start;
    let page = null as ReturnType<typeof parseTimelinePage> | null;

    while (attempts <= maxFollowingEmptyPageSkips) {
      const { text, url: finalUrl } = await this.request(buildTimelineUrl(currentPageNumber), {
        headers: {
          cookie
        }
      });
      page = parseTimelinePage(text, finalUrl, currentStart);
      if (page.items.length > 0 || !page.upstreamHasMore || page.upstreamNextStart == null || scope !== "following") {
        break;
      }
      attempts += 1;
      currentStart = page.upstreamNextStart;
      currentPageNumber = Math.max(currentPageNumber + 1, Math.floor(page.upstreamNextStart / this.timelinePageSize) + 1);
    }

    if (!page) {
      throw new Error("Unable to load Douban timeline.");
    }

    return {
      start,
      items: page.items,
      nextStart: page.items.length > 0 ? page.nextStart : null,
      hasMore: page.items.length > 0 ? page.hasMore : false,
      truncated: page.items.length === 0 && page.upstreamHasMore
    };
  }

  async getUserCollection(medium: Medium, status: ShelfStatus, page: number, cookie: string, peopleId: string) {
    const start = (page - 1) * 15;
    const statusValue = this.toDoubanStatus(status);
    const url =
      medium === "game"
        ? `${this.config.doubanWebBaseUrl}/people/${peopleId}/games?action=${statusValue}&start=${start}`
        : `${this.authBaseUrl(medium)}/people/${peopleId}/${statusValue}?start=${start}`;
    const { text } = await this.request(url, {
      headers: {
        cookie
      }
    });
    return parseUserCollection(text, url, medium, status);
  }

  async pushState(
    medium: Medium,
    doubanId: string,
    cookie: string,
    nextState: PushStateInput
  ) {
    const detailUrl = this.authSubjectUrl(medium, doubanId);
    const interestUrl = `${this.authBaseUrl(medium)}/j/subject/${doubanId}/interest`;
    let authToken: string | null = null;
    let form;

    if (medium === "game" && !this.usesCustomWebBase()) {
      const detailPage = await this.request(detailUrl, {
        headers: {
          cookie
        }
      });
      authToken = parseAuthToken(detailPage.text);
      const body = new URLSearchParams({
        interest: this.toDoubanStatus(nextState.status),
        rating: nextState.rating == null ? "" : String(nextState.rating),
        tags: "",
        comment: "",
        sync_douban: nextState.syncToTimeline === false ? "0" : "1"
      });
      this.applyInterestExtras(body, nextState);
      if (authToken) {
        body.set("ck", authToken);
      }
      const result = await this.requestJson<{ action: string | null; rating: number | null; r?: number }>(
        `${this.config.doubanWebBaseUrl}/j/ilmen/thing/${doubanId}/interest`,
        {
          method: "POST",
          headers: {
            cookie,
            referer: detailUrl,
            origin: this.config.doubanWebBaseUrl,
            "x-requested-with": "XMLHttpRequest",
            "content-type": "application/x-www-form-urlencoded; charset=UTF-8"
          },
          body: body.toString()
        }
      );
      const actualStatus = result.action ? ({ wish: "wish", do: "doing", collect: "done" } as const)[result.action as "wish" | "do" | "collect"] : null;
      const actualRating = result.rating == null ? null : Number(result.rating);
      if (actualStatus !== nextState.status || actualRating !== nextState.rating) {
        throw new Error(`Douban did not apply requested state. Actual state is ${actualStatus ?? "unknown"}.`);
      }
      const refreshedPage = await this.request(detailUrl, {
        headers: {
          cookie
        }
      });
      return {
        subject: parseSubjectDetail(refreshedPage.text, refreshedPage.url, medium),
        appliedState: nextState
      };
    }

    try {
      const detailPage = await this.request(detailUrl, {
        headers: {
          cookie
        }
      });
      authToken = parseAuthToken(detailPage.text);
      form = parseInterestForm(detailPage.text, detailUrl, nextState.status);
    } catch (error) {
      if (medium === "game") {
        throw error;
      }
      const detailPage = await this.request(detailUrl, {
        headers: {
          cookie
        }
      });
      authToken = parseAuthToken(detailPage.text);
      const editor = await this.requestJson<{ html: string }>(interestUrl, {
        headers: {
          cookie,
          referer: detailUrl,
          "x-requested-with": "XMLHttpRequest"
        }
      });
      form = parseInterestForm(editor.html, interestUrl, nextState.status);
    }

    const body = new URLSearchParams(form.defaultFields);
    body.set(form.statusFieldName, this.toDoubanStatus(nextState.status));
    if (form.ratingFieldName) {
      body.set(form.ratingFieldName, nextState.rating == null ? "" : String(nextState.rating));
    }
    this.applyInterestExtras(body, nextState);
    if (authToken && !body.has("ck")) {
      body.set("ck", authToken);
    }

    if (form.actionUrl.startsWith("https://movie.douban.com/j/subject/")) {
      await this.requestJson(form.actionUrl, {
        method: form.method,
        headers: {
          cookie,
          referer: detailUrl,
          origin: new URL(detailUrl).origin,
          "x-requested-with": "XMLHttpRequest",
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8"
        },
        body: body.toString()
      });

      const editor = await this.requestJson<{ html: string }>(interestUrl, {
        headers: {
          cookie,
          referer: detailUrl,
          "x-requested-with": "XMLHttpRequest"
        }
      });
      const actual = parseInterestSelection(editor.html, interestUrl);
      if (actual.status !== nextState.status || actual.rating !== nextState.rating) {
        throw new Error(`Douban did not apply requested state. Actual state is ${actual.status ?? "unknown"}.`);
      }
    } else if (/https:\/\/(book|music)\.douban\.com\/j\/subject\/\d+\/interest/.test(form.actionUrl)) {
      await this.requestJson(form.actionUrl, {
        method: form.method,
        headers: {
          cookie,
          referer: detailUrl,
          origin: new URL(detailUrl).origin,
          "x-requested-with": "XMLHttpRequest",
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8"
        },
        body: body.toString()
      });

      const editor = await this.requestJson<{ html: string }>(interestUrl, {
        headers: {
          cookie,
          referer: detailUrl,
          "x-requested-with": "XMLHttpRequest"
        }
      });
      const actual = parseInterestSelection(editor.html, interestUrl);
      if (actual.status !== nextState.status || actual.rating !== nextState.rating) {
        throw new Error(`Douban did not apply requested state. Actual state is ${actual.status ?? "unknown"}.`);
      }
    } else {
      await this.request(form.actionUrl, {
        method: form.method,
        headers: {
          cookie,
          "content-type": "application/x-www-form-urlencoded"
        },
        body: form.method === "GET" ? undefined : body.toString()
      });

      const verifyPage = await this.request(detailUrl, {
        headers: {
          cookie
        }
      });
      const actual = parseInterestSelection(verifyPage.text, detailUrl);
      if (actual.status !== nextState.status || actual.rating !== nextState.rating) {
        throw new Error(`Douban did not apply requested state. Actual state is ${actual.status ?? "unknown"}.`);
      }
    }

    const refreshedPage = await this.request(detailUrl, {
      headers: {
        cookie
      }
    });
    const refreshed = parseSubjectDetail(refreshedPage.text, refreshedPage.url, medium);
    return {
      subject: refreshed,
      appliedState: nextState
    };
  }
}

export { DoubanSessionError };
