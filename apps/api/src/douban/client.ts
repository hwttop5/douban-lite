import type { Medium, RankingBoardConfig, RankingItem, ShelfStatus, SubjectComment, SubjectCommentsResponse, SubjectRecord, TimelineScope } from "../../../../packages/shared/src";
import type { AppConfig } from "../config";
import {
  parseAuthToken,
  DoubanSessionError,
  ensureNoAccessChallenge,
  parseDoubanProfile,
  parseInterestForm,
  parseInterestSelection,
  parsePeopleId,
  parseRanking,
  parseSearchResults,
  parseSubjectCommentVoteAction,
  parseSubjectComments,
  parseSubjectDetail,
  parseSubjectDetailExtras,
  parseTimeline,
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

function readCookieValue(cookie: string, key: string) {
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${key}=([^;]+)`));
  return match?.[1] ?? null;
}

export class DoubanClient {
  constructor(private readonly config: Pick<AppConfig, "doubanPublicBaseUrl" | "doubanWebBaseUrl">) {}

  private readonly authorAvatarCache = new Map<string, string | null>();
  private readonly timelinePageSize = 20;
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

  private async voteComment(url: string, commentId: string, cookie: string, referer: string): Promise<VoteResult> {
    const authToken = readCookieValue(cookie, "ck");
    if (!authToken) {
      throw new Error("Douban session is missing ck token.");
    }
    const payload = await this.requestJson<{ msg?: string; r?: number; digg_n?: number }>(url, {
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
    return {
      commentId,
      votes: payload.digg_n ?? 0,
      userVoteState: /cancel_vote/.test(url) ? "not_voted" : "voted"
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

  async voteSubjectComment(medium: Medium, doubanId: string, commentId: string, cookie: string) {
    const commentPageUrl =
      medium === "game"
        ? `${this.config.doubanWebBaseUrl}/game/${doubanId}/comments?comment_id=${encodeURIComponent(commentId)}`
        : `${this.authBaseUrl(medium)}/subject/${doubanId}/comments?comment_id=${encodeURIComponent(commentId)}`;
    const { text } = await this.request(commentPageUrl, {
      headers: {
        cookie,
        referer: this.authSubjectUrl(medium, doubanId)
      }
    });
    const action = parseSubjectCommentVoteAction(text, commentId);
    if (!action) {
      throw new Error("Unable to resolve Douban comment vote action.");
    }
    if (action.userVoteState === "voted") {
      return {
        commentId,
        votes: action.votes,
        userVoteState: action.userVoteState
      } satisfies VoteResult;
    }
    const referer =
      medium === "game"
        ? `${this.config.doubanWebBaseUrl}/game/${doubanId}/comments`
        : `${this.authBaseUrl(medium)}/subject/${doubanId}/comments`;
    return this.voteComment(action.voteUrl, commentId, cookie, referer);
  }

  async getRanking(medium: Medium, board: RankingBoardConfig, cookie?: string) {
    if (board.sourceType === "movie_hot") {
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
    const url =
      scope === "following"
        ? `${this.config.doubanWebBaseUrl}/?start=${start}`
        : `${this.config.doubanWebBaseUrl}/people/${peopleId ?? ""}/statuses?start=${start}`;
    if (scope === "mine" && !peopleId) {
      throw new Error("peopleId is required for mine timeline.");
    }
    const { text, url: finalUrl } = await this.request(url, {
      headers: {
        cookie
      }
    });
    const items = parseTimeline(text, finalUrl);
    return {
      start,
      items,
      nextStart: items.length > 0 ? start + items.length : null,
      hasMore: items.length >= this.timelinePageSize
    };
  }

  async getUserCollection(medium: Medium, status: ShelfStatus, page: number, cookie: string, peopleId: string) {
    const start = (page - 1) * 15;
    const statusValue = this.toDoubanStatus(status);
    const url =
      medium === "game"
        ? `${this.config.doubanWebBaseUrl}/people/${peopleId}/games?action=${statusValue}&start=${start}`
        : `${this.authBaseUrl(medium)}/mine?status=${statusValue}&start=${start}`;
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
