import * as cheerio from "cheerio";
import type {
  Medium,
  RankingBoardConfig,
  RankingItem,
  ShelfStatus,
  SubjectComment,
  SubjectRecord,
  TimelineEngagement,
  TimelineItem
} from "../../../../packages/shared/src";

export class DoubanSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DoubanSessionError";
  }
}

export interface ParsedUserCollection {
  items: Array<{ subject: SubjectRecord; status: ShelfStatus; rating: number | null }>;
  hasNext: boolean;
  nextPage: number | null;
}

export interface ParsedInterestForm {
  actionUrl: string;
  method: "POST" | "GET";
  defaultFields: Record<string, string>;
  statusFieldName: string;
  ratingFieldName: string | null;
}

export interface ParsedInterestSelection {
  status: ShelfStatus | null;
  rating: number | null;
}

export function ensureNoAccessChallenge(html: string, finalUrl: string) {
  if (
    finalUrl.includes("sec.douban.com") ||
    finalUrl.includes("/misc/sorry") ||
    html.includes("登录跳转") ||
    html.includes("异常请求") ||
    html.includes("检测到有异常请求") ||
    html.includes("请登录") && html.includes("豆瓣")
  ) {
    throw new DoubanSessionError("Douban session is blocked by login redirect or security challenge.");
  }
}

function safeText(value: string | undefined | null) {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function decodedCandidates(input: string) {
  const candidates = new Set<string>([input, input.replace(/&amp;/g, "&")]);
  for (const value of Array.from(candidates)) {
    try {
      candidates.add(decodeURIComponent(value));
    } catch {
      // Keep the original value.
    }
  }
  for (const value of Array.from(candidates)) {
    try {
      const url = new URL(value, "https://www.douban.com");
      const target = url.searchParams.get("url");
      if (target) {
        candidates.add(target);
        candidates.add(decodeURIComponent(target));
      }
    } catch {
      // Relative links are handled by callers.
    }
  }
  return Array.from(candidates);
}

function extractDoubanId(input: string) {
  for (const candidate of decodedCandidates(input)) {
    const match = candidate.match(/(?:subject|game)\/(\d+)/);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

function stableId(input: string) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return String(hash);
}

function absoluteUrl(baseUrl: string, maybeRelative: string | undefined | null) {
  if (!maybeRelative) {
    return null;
  }
  const subjectTarget = decodedCandidates(maybeRelative)
    .map((candidate) => {
      try {
        const url = new URL(candidate, baseUrl);
        return url.searchParams.get("url") ?? candidate;
      } catch {
        return candidate;
      }
    })
    .find((candidate) => extractDoubanId(candidate));
  try {
    return new URL(subjectTarget ?? maybeRelative, baseUrl).toString();
  } catch {
    return subjectTarget ?? maybeRelative;
  }
}

function parseCreators(raw: string | null) {
  if (!raw) {
    return [];
  }
  return raw
    .split(/[\/,]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 6);
}

function cleanSubjectSummary($: cheerio.CheerioAPI) {
  const source = $("#link-report .all, #link-report, .summary, .subject-summary, .related-info .indent, .item-desc").first().clone();
  if (source.length === 0) {
    return null;
  }
  source.find("script, style, noscript, iframe, form, button, .report, .rec-sec, .indent-ft, a[href*='report']").remove();
  return safeText(source.text())
    ?.replace(/\(\s*function\s*\([^)]*\)\s*\{[\s\S]*$/i, "")
    .replace(/window\.createReportButton[\s\S]*$/i, "")
    .replace(/\.report\s*\{[\s\S]*$/i, "")
    .trim() ?? null;
}

function toDoubanStatus(status: ShelfStatus) {
  switch (status) {
    case "wish":
      return "wish";
    case "doing":
      return "do";
    case "done":
      return "collect";
  }
}

function fromDoubanStatus(raw: string | undefined, fallback: ShelfStatus): ShelfStatus {
  if (raw === "collect" || raw === "done") {
    return "done";
  }
  if (raw === "do" || raw === "doing") {
    return "doing";
  }
  if (raw === "wish") {
    return "wish";
  }
  return fallback;
}

function createSubject(baseUrl: string, medium: Medium, input: Partial<SubjectRecord> & { doubanId: string; title: string }): SubjectRecord {
  return {
    medium,
    doubanId: input.doubanId,
    title: input.title,
    subtitle: input.subtitle ?? null,
    year: input.year ?? null,
    coverUrl: absoluteUrl(baseUrl, input.coverUrl ?? undefined),
    averageRating: input.averageRating ?? null,
    summary: input.summary ?? null,
    creators: input.creators ?? [],
    metadata: input.metadata ?? {},
    updatedAt: input.updatedAt ?? new Date().toISOString()
  };
}

function createExternalRankingSubject(baseUrl: string, medium: Medium, input: {
  href: string | null | undefined;
  title: string;
  coverUrl?: string | null;
  summary?: string | null;
  averageRating?: number | null;
  creators?: string[];
  boardKey: string;
}) {
  const externalUrl = absoluteUrl(baseUrl, input.href) ?? baseUrl;
  return createSubject(baseUrl, medium, {
    doubanId: extractDoubanId(externalUrl) ?? stableId(`${medium}:${input.title}:${externalUrl}`),
    title: input.title,
    coverUrl: input.coverUrl,
    averageRating: input.averageRating ?? null,
    creators: input.creators ?? [],
    summary: input.summary ?? null,
    metadata: {
      board: input.boardKey,
      externalUrl,
      externalOnly: "true"
    }
  });
}

function findSubjectAnchor($: cheerio.CheerioAPI, root: cheerio.Cheerio<any>) {
  const anchors = root.find("a[href]").filter((_, element) => extractDoubanId($(element).attr("href") ?? "") != null);
  const titleAnchor = anchors.filter((_, element) => safeText($(element).text()) != null).first();
  return titleAnchor.length > 0 ? titleAnchor : anchors.first();
}

function titleFromRoot($: cheerio.CheerioAPI, root: cheerio.Cheerio<any>, anchor: cheerio.Cheerio<any>) {
  const preferred = root
    .find(".title a, .pl2 a, h2 a, h3 a, .entry a, a.fleft")
    .filter((_, element) => extractDoubanId($(element).attr("href") ?? "") != null)
    .first();
  return (
    safeText(preferred.attr("title")) ??
    safeText(preferred.text()) ??
    safeText(root.find("h2, h3, .title, .entry, .media__body").first().text()) ??
    safeText(anchor.attr("title")) ??
    safeText(anchor.find("img").attr("alt")) ??
    safeText(anchor.text())
  );
}

function ratingFromRoot(root: cheerio.Cheerio<any>) {
  const raw =
    root.find(".rating_num, .rating_nums, .rating-value, [property='v:average'], .font-small").first().text() ||
    root.find("[data-rating], [data-average-rating]").first().attr("data-rating") ||
    root.find("[data-rating], [data-average-rating]").first().attr("data-average-rating");
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function imageFromRoot(root: cheerio.Cheerio<any>) {
  const imageSource = root.find("img").first().attr("src");
  if (imageSource) {
    return imageSource;
  }
  const backgroundStyle = root.find("[style*='background-image']").first().attr("style");
  return backgroundStyle?.match(/url\(['"]?([^'")]+)['"]?\)/)?.[1] ?? null;
}

function subjectFromRoot($: cheerio.CheerioAPI, root: cheerio.Cheerio<any>, baseUrl: string, medium: Medium) {
  const anchor = findSubjectAnchor($, root);
  const href = anchor.attr("href");
  const doubanId = href ? extractDoubanId(href) : root.attr("data-douban-id") ?? null;
  const title = titleFromRoot($, root, anchor);
  if (!doubanId || !title) {
    return null;
  }

  const metaText = safeText(root.find(".subject-cast, .pl, .meta, .subject-abstract, .bd p, .content p").first().text());
  return createSubject(baseUrl, medium, {
    doubanId,
    title,
    subtitle: safeText(root.find(".other, .subject-subtitle, .subtitle").first().text()),
    year: metaText?.match(/\b(19|20)\d{2}\b/)?.[0] ?? safeText(root.find(".year").first().text()),
    coverUrl: root.find("img").first().attr("src"),
    averageRating: ratingFromRoot(root),
    creators: parseCreators(metaText),
    summary:
      safeText(root.find(".quote .inq, .quote span, .subject-abstract, .content p, .bd p, .blurb").first().text()) ??
      safeText(root.find("p").first().text()),
    metadata: {
      externalUrl: absoluteUrl(baseUrl, href) ?? ""
    }
  });
}

export function parseAuthToken(html: string) {
  const $ = cheerio.load(html);
  const hiddenToken = $("input[name='ck']").first().attr("value");
  if (hiddenToken) {
    return hiddenToken;
  }

  const logoutHref = $("a[href*='ck=']").first().attr("href");
  if (!logoutHref) {
    return null;
  }

  try {
    return new URL(logoutHref, "https://www.douban.com").searchParams.get("ck");
  } catch {
    return logoutHref.match(/[?&]ck=([^&]+)/)?.[1] ?? null;
  }
}

export function parseDoubanProfile(html: string, baseUrl: string) {
  const $ = cheerio.load(html);
  const peopleId = parsePeopleId(html);
  const profileImage = $("#db-usr-profile .pic img, #profile img.userface, .basic-info img.userface").first();
  const displayName =
    safeText(profileImage.attr("alt")) ??
    safeText($("#db-usr-profile .info h1").first().contents().filter((_, node) => node.type === "text").text()) ??
    safeText($(".nav-user-account .bn-more span").first().text()?.replace(/的账号$/, "")) ??
    safeText($("a[href*='/people/']").filter((_, element) => safeText($(element).text()) != null).first().text());
  const avatar =
    profileImage.attr("src") ??
    $("#db-usr-profile img, .userface img, img.userface, img.avatar").first().attr("src") ??
    $("a[href*='/people/'] img").first().attr("src");
  const pageText = $("body").text().replace(/\s+/g, " ");
  const ipLocation =
    safeText(pageText.match(/IP\s*(?:属地|屬地)?\s*[:：]\s*([^\s/]+)/i)?.[1]) ??
    safeText(pageText.match(/IP\s+([^\s/]+)/i)?.[1]);
  return {
    peopleId,
    displayName,
    avatarUrl: avatar ? new URL(avatar, baseUrl).toString() : null,
    ipLocation
  };
}

export function parseSearchResults(html: string, baseUrl: string, medium: Medium) {
  const $ = cheerio.load(html);
  const results: SubjectRecord[] = [];
  const seen = new Set<string>();
  $(".result, .search-card, .result-item, article").each((_, element) => {
    const subject = subjectFromRoot($, $(element), baseUrl, medium);
    if (!subject || seen.has(subject.doubanId)) {
      return;
    }
    seen.add(subject.doubanId);
    results.push(subject);
  });
  return results;
}

function parseGameExploreResults(html: string, baseUrl: string, board: RankingBoardConfig): RankingItem[] {
  const match = html.match(/GlobalData\['results'\]\s*=\s*(\[.*?\]);/s);
  if (!match?.[1]) {
    return [];
  }
  try {
    const rows = JSON.parse(match[1]) as Array<{
      id: string;
      title: string;
      url: string;
      cover?: string;
      rating?: string;
      platforms?: string;
      genres?: string;
      review?: { content?: string };
    }>;
    return rows.slice(0, 20).map((row, index) => ({
      rank: index + 1,
      blurb: row.review?.content ?? row.platforms ?? row.genres ?? null,
      subject: createSubject(baseUrl, "game", {
        doubanId: String(row.id),
        title: row.title,
        coverUrl: row.cover,
        averageRating: Number(row.rating) || null,
        summary: row.review?.content ?? null,
        metadata: { board: board.key, externalUrl: row.url }
      })
    }));
  } catch {
    return [];
  }
}

export function parseSubjectDetail(html: string, baseUrl: string, medium: Medium): SubjectRecord {
  const $ = cheerio.load(html);
  const title = safeText($("h1, .subject-title").first().text());
  const doubanId =
    extractDoubanId(baseUrl) ??
    extractDoubanId($("link[rel='canonical']").attr("href") ?? "") ??
    extractDoubanId($("meta[property='og:url']").attr("content") ?? "") ??
    $("body").attr("data-douban-id");
  if (!title || !doubanId) {
    throw new Error("Unable to parse subject detail.");
  }

  const metadata: Record<string, string | string[]> = {};
  $("#info span.pl, .subject-meta dt, .item-subject-info dt, .meta-row .label").each((_, element) => {
    const row = $(element);
    const label = safeText(row.text())?.replace(/[:：]$/, "");
    const value = safeText(row.next("span, dd, .value").text()) ?? safeText(row.parent().text()?.replace(row.text(), ""));
    if (label && value) {
      metadata[label] = value;
    }
  });

  return createSubject(baseUrl, medium, {
    doubanId,
    title,
    subtitle: safeText($(".subject-subtitle, .subtitle").first().text()),
    year: safeText($("[data-year], .year").first().attr("data-year") ?? $(".year").first().text()) ?? title.match(/\((\d{4})\)/)?.[1] ?? null,
    coverUrl: $("img.cover, .cover img, .poster img, #mainpic img, .nbg img, .item-pic img").first().attr("src"),
    averageRating: ratingFromRoot($("body")),
    summary: cleanSubjectSummary($),
    creators: parseCreators(safeText($(".creators, .subject-creators, #info").first().text())),
    metadata
  });
}

export function parseSubjectComments(html: string, limit = 5): SubjectComment[] {
  const $ = cheerio.load(html);
  const comments: SubjectComment[] = [];
  const seen = new Set<string>();
  $(".comment-item, .comment-list li, .review-item").each((_, element) => {
    const root = $(element);
    const id = root.attr("data-cid") ?? root.attr("id") ?? null;
    const content = safeText(
      root
        .find(".comment-content .short, .comment-content, p .short, .info p .short, .comment p, .short")
        .first()
        .text()
    );
    if (!content) {
      return;
    }
    const key = id ?? content;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    comments.push({
      id,
      author: safeText(root.find(".comment-info a, .user-info a").first().text()),
      content,
      rating: safeText(root.find(".rating, .user-stars").first().attr("title") ?? null),
      createdAt: safeText(root.find(".comment-time, .pubtime").first().text()),
      votes: Number(root.find(".vote-count, .votes, .digg span").first().text()) || null
    });
  });
  return comments.slice(0, limit);
}

export function parseRanking(html: string, baseUrl: string, medium: Medium, board: RankingBoardConfig): RankingItem[] {
  if (medium === "game") {
    const fromScript = parseGameExploreResults(html, baseUrl, board);
    if (fromScript.length > 0) {
      return fromScript;
    }
  }

  const $ = cheerio.load(html);
  const items: RankingItem[] = [];
  const seen = new Set<string>();

  if (board.sourceType === "movie_showing") {
    $("#nowplaying .list-item, .lists .list-item, li[data-subject]").each((_, element) => {
      const root = $(element);
      const id = root.attr("data-subject") ?? extractDoubanId(root.find("a[href]").first().attr("href") ?? "");
      const title = safeText(root.attr("data-title")) ?? safeText(root.find(".stitle a, .title a, a").first().text());
      if (!id || !title || seen.has(id)) {
        return;
      }
      seen.add(id);
      items.push({
        rank: items.length + 1,
        blurb: safeText(root.attr("data-actors")) ?? safeText(root.find(".subject-rate, .rating, .info").first().text()),
        subject: createSubject(baseUrl, medium, {
          doubanId: id,
          title,
          coverUrl: root.find("img").first().attr("src"),
          averageRating: Number(root.attr("data-score")) || ratingFromRoot(root),
          metadata: { board: board.key, externalUrl: `https://movie.douban.com/subject/${id}/` }
        })
      });
    });
    if (items.length > 0) {
      return items;
    }
  }

  if (board.sourceType === "homepage_section" && board.sectionTitle) {
    const artistScope =
      medium === "music" && board.key === "weekly-artists"
        ? $(".popular-artists .artists").first()
        : medium === "music" && board.key === "rising-artists"
          ? $(".popular-artists .new-artists").first()
          : null;
    if (artistScope && artistScope.length > 0) {
      artistScope.find(".artist-item").each((_, element) => {
        const root = $(element);
        const anchor = root.find("a.title[href], a.primary-link[href], a[href]").filter((_, link) => safeText($(link).text()) != null).first();
        const title = safeText(anchor.attr("title")) ?? safeText(anchor.text());
        const href = anchor.attr("href");
        if (!title || !href) {
          return;
        }
        const externalUrl = absoluteUrl(baseUrl, href) ?? href;
        const key = `${title}:${externalUrl}`;
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        items.push({
          rank: items.length + 1,
          blurb: safeText(root.find(".genre, .desc, p").first().text()),
          subject: createExternalRankingSubject(baseUrl, medium, {
            href,
            title,
            coverUrl: imageFromRoot(root),
            summary: safeText(root.find(".genre, .desc, p").first().text()),
            boardKey: board.key
          })
        });
      });
      if (items.length > 0) {
        return items.slice(0, 25);
      }
    }

    const sectionTitle = board.sectionTitle;
    const heading = $("h2, h3, .section-title, .mod h2").filter((_, element) => safeText($(element).text())?.includes(sectionTitle) ?? false).first();
    const section = heading.closest(".section, .mod, .mod_t, .article, div").first();
    const scope = section.length > 0 ? section : heading.parent().next();
    scope.find("li, .item, .artist, .album, .pl2").each((_, element) => {
      const root = $(element);
      const anchor = root.find("a[href]").filter((_, link) => safeText($(link).attr("title")) != null || safeText($(link).text()) != null).first();
      const title = safeText(anchor.attr("title")) ?? safeText(anchor.text()) ?? safeText(root.find("img").attr("alt"));
      const href = anchor.attr("href");
      if (!title || !href) {
        return;
      }
      const externalUrl = absoluteUrl(baseUrl, href) ?? href;
      const key = `${title}:${externalUrl}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      items.push({
        rank: items.length + 1,
        blurb: safeText(root.find(".desc, .pl, p").first().text()),
        subject: createExternalRankingSubject(baseUrl, medium, {
          href,
          title,
          coverUrl: imageFromRoot(root),
          summary: safeText(root.find(".desc, .pl, p").first().text()),
          boardKey: board.key
        })
      });
    });
    if (items.length > 0) {
      return items.slice(0, 25);
    }
  }

  $(".grid_view > li, tr.item, li.media, ul.col3 > li, .ranking-card, .result, .doulist-item, .item").each((_, element) => {
    const root = $(element);
    const subject = subjectFromRoot($, root, baseUrl, medium);
    if (!subject || seen.has(subject.doubanId)) {
      return;
    }
    seen.add(subject.doubanId);
    items.push({
      rank: Number(root.find("em, .rank").first().text() || root.attr("data-rank")) || items.length + 1,
        blurb: safeText(root.find(".quote .inq, .quote span, .subject-abstract, .days, .bd p, .pl, .blurb").first().text()),
      subject: { ...subject, metadata: { ...subject.metadata, board: board.key } }
    });
  });
  return board.sourceType === "doulist" ? items.slice(0, 500) : items.slice(0, 25);
}

export function parseUserCollection(html: string, baseUrl: string, medium: Medium, fallbackStatus: ShelfStatus): ParsedUserCollection {
  const $ = cheerio.load(html);
  const items: ParsedUserCollection["items"] = [];
  $(".collection-item, .interest-item, .common-item, tr.item, article, li").each((_, element) => {
    const root = $(element);
    const subject = subjectFromRoot($, root, baseUrl, medium);
    if (!subject) {
      return;
    }
    items.push({
      status: fromDoubanStatus(root.attr("data-status") ?? undefined, fallbackStatus),
      rating: ratingFromRoot(root),
      subject
    });
  });

  const nextHref = $("a.next, [data-next-page]").first().attr("href");
  const nextPageValue = $("a.next").first().attr("data-next-page") ?? $("body").attr("data-next-page");
  let nextPage: number | null = null;
  if (nextPageValue) {
    nextPage = Number(nextPageValue);
  } else if (nextHref) {
    const nextUrl = new URL(nextHref, baseUrl);
    const pageParam = nextUrl.searchParams.get("page");
    const startParam = nextUrl.searchParams.get("start");
    if (pageParam) {
      nextPage = Number(pageParam);
    } else if (startParam) {
      nextPage = Math.floor(Number(startParam) / 15) + 1;
    }
  }

  return {
    items,
    hasNext: Number.isFinite(nextPage) && Number(nextPage) > 0,
    nextPage: Number.isFinite(nextPage) ? Number(nextPage) : null
  };
}

export function parseInterestForm(html: string, detailUrl: string, desiredStatus?: ShelfStatus): ParsedInterestForm {
  const $ = cheerio.load(html);
  const desiredValue = desiredStatus ? toDoubanStatus(desiredStatus) : null;
  let form = $("form[data-interest-form], form#interest-form, form[action*='interest']").first();

  if (desiredValue) {
    const exactForm = $(`form[action*='interest=${desiredValue}']`).first();
    if (exactForm.length > 0) {
      form = exactForm;
    }
  }

  if (form.length === 0 && desiredValue) {
    const link = $(`a[href*='interest=${desiredValue}'], a.collect-btn[data-action='${desiredValue}']`).first();
    if (link.length > 0) {
      return {
        actionUrl: new URL(link.attr("href") ?? detailUrl, detailUrl).toString(),
        method: "GET",
        defaultFields: {},
        statusFieldName: "interest",
        ratingFieldName: null
      };
    }
  }

  if (form.length === 0) {
    throw new Error("Unable to locate interest update form.");
  }

  const defaultFields: Record<string, string> = {};
  form.find("input, select, textarea").each((_, element) => {
    const input = $(element);
    const name = input.attr("name");
    if (!name) {
      return;
    }
    const tagName = element.tagName?.toLowerCase();
    const type = (input.attr("type") ?? "").toLowerCase();

    if (tagName === "textarea") {
      defaultFields[name] = input.text();
    } else if (tagName === "select") {
      const selected = input.find("option[selected]").first();
      defaultFields[name] = selected.attr("value") ?? input.find("option").first().attr("value") ?? "";
    } else if (type === "checkbox") {
      if (input.is(":checked") || input.attr("checked") != null) {
        defaultFields[name] = input.attr("value") ?? "on";
      }
    } else if (type === "radio") {
      if (input.is(":checked") || input.attr("checked") != null) {
        defaultFields[name] = input.attr("value") ?? "";
      }
    } else {
      defaultFields[name] = input.attr("value") ?? "";
    }
  });

  let statusFieldName = "interest";
  form.find("input[type='radio'], select, input[type='hidden']").each((_, element) => {
    const name = $(element).attr("name");
    if (name && ["interest", "status", "collection"].includes(name)) {
      statusFieldName = name;
    }
  });

  let ratingFieldName: string | null = null;
  form.find("select, input").each((_, element) => {
    const name = $(element).attr("name");
    if (name && /rating/i.test(name)) {
      ratingFieldName = name;
    }
  });

  return {
    actionUrl: new URL(form.attr("action") ?? detailUrl, detailUrl).toString(),
    method: (form.attr("method") ?? "POST").toUpperCase() === "GET" ? "GET" : "POST",
    defaultFields,
    statusFieldName,
    ratingFieldName
  };
}

export function parseInterestSelection(html: string, detailUrl: string): ParsedInterestSelection {
  try {
    const form = parseInterestForm(html, detailUrl);
    const rawStatus = form.defaultFields[form.statusFieldName];
    const ratingValue = form.ratingFieldName ? form.defaultFields[form.ratingFieldName] ?? "" : "";
    const numericRating = Number(ratingValue);
    return {
      status: rawStatus ? fromDoubanStatus(rawStatus, "wish") : null,
      rating: Number.isFinite(numericRating) && numericRating > 0 ? numericRating : null
    };
  } catch {
    const $ = cheerio.load(html);
    const collectedText = safeText($(".ckd-collect, .interest-status, .collection-section").first().text()) ?? safeText($("body").text()) ?? "";
    const ratingText = $(".rating .rating-stars, .rating").first().attr("data-rating") ?? $(".rating").first().text();
    const numericRating = Number(ratingText);
    let status: ShelfStatus | null = null;
    if (/想看|想读|想听|想玩/.test(collectedText)) {
      status = "wish";
    } else if (/在看|在读|在听|在玩/.test(collectedText)) {
      status = "doing";
    } else if (/看过|读过|听过|玩过/.test(collectedText)) {
      status = "done";
    }
    return {
      status,
      rating: Number.isFinite(numericRating) && numericRating > 0 ? numericRating : null
    };
  }
}

export function parsePeopleId(html: string) {
  return html.match(/people\/([^/"'?]+)\//)?.[1] ?? null;
}

function parseEngagements(text: string): TimelineEngagement[] {
  return (["回应", "转发", "赞"] as const)
    .filter((label) => text.includes(label))
    .map((label) => {
      const match = text.match(new RegExp(`(\\d+)\\s*${label}`));
      return { label, count: match ? Number(match[1]) : null };
    });
}

function cleanTimelineContent(input: string, removeParts: Array<string | null>) {
  let output = input;
  for (const part of removeParts) {
    if (part) {
      output = output.replace(part, " ");
    }
  }
  return output
    .replace(/\b(回应|转发|删除|赞)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseTimeline(html: string, baseUrl: string): TimelineItem[] {
  const $ = cheerio.load(html);
  const items: TimelineItem[] = [];
  const seen = new Set<string>();
  const roots = $(".new-status.status-wrapper").length > 0 ? $(".new-status.status-wrapper") : $(".status-item");

  roots.each((index, element) => {
    const wrapper = $(element);
    const statusRoot = wrapper.find(".status-item").first().length > 0 ? wrapper.find(".status-item").first() : wrapper;
    const id = statusRoot.attr("data-sid") ?? wrapper.attr("data-sid") ?? `timeline-${index}`;
    if (seen.has(id)) {
      return;
    }
    seen.add(id);

    const peopleLink =
      wrapper.find(".lnk-people[href*='/people/']").first().length > 0
        ? wrapper.find(".lnk-people[href*='/people/']").first()
        : wrapper.find("a[href*='/people/']").filter((_, link) => safeText($(link).text()) != null).first();
    const detailLink = wrapper.find(`a[href*='/status/${id}']`).first();
    const subjectRoot =
      wrapper.find(".block-subject").first().length > 0
        ? wrapper.find(".block-subject").first()
        : wrapper.find(".block").filter((_, block) => $(block).find("a[href]").filter((_, link) => extractDoubanId($(link).attr("href") ?? "") != null).length > 0).first();
    const subjectScope = subjectRoot.length > 0 ? subjectRoot : wrapper;
    const subjectLink =
      subjectScope.find(".title a[href]").first().length > 0
        ? subjectScope.find(".title a[href]").first()
        : subjectScope.find("a.media[href], a[href]").filter((_, link) => extractDoubanId($(link).attr("href") ?? "") != null).first();
    const authorImage = wrapper.find(".usr-pic img, a[href*='/people/'] img").first();
    const subjectImage = subjectScope.find(".pic img, a.media img, img").filter((_, image) => $(image).closest("a[href*='/people/']").length === 0).first();
    const authorName = safeText(peopleLink.text());
    const subjectTitle =
      safeText(subjectRoot.find(".title a").first().text()) ??
      safeText(subjectLink.attr("title")) ??
      safeText(subjectLink.text()) ??
      safeText(subjectImage.attr("alt"));
    const createdAtText = safeText(detailLink.text()) ?? safeText(wrapper.find(".created_at, .status-time, .pubtime").first().text());
    const actionText =
      cleanTimelineContent(safeText(wrapper.find(".hd .text").first().text()) ?? "", [authorName]) ||
      safeText(wrapper.find(".status-saying, .status-header").first().text()) ||
      statusRoot.attr("data-action") ||
      null;
    const fullText = safeText(wrapper.text()) ?? "";
    const targetType = statusRoot.attr("data-target-type");
    const objectId = statusRoot.attr("data-object-id");
    const fallbackSubjectUrl =
      objectId && targetType === "game"
        ? `${baseUrl.replace(/\/$/, "")}/game/${objectId}/`
        : objectId
          ? `https://${targetType === "book" ? "book" : targetType === "music" ? "music" : "movie"}.douban.com/subject/${objectId}/`
          : null;
    const rawSubjectUrl = absoluteUrl(baseUrl, subjectLink.attr("href"));
    const subjectUrl = rawSubjectUrl && extractDoubanId(rawSubjectUrl) ? rawSubjectUrl : fallbackSubjectUrl ?? rawSubjectUrl;

    items.push({
      id,
      authorName,
      authorUrl: absoluteUrl(baseUrl, peopleLink.attr("href")),
      authorAvatarUrl: authorImage.attr("src") ? new URL(authorImage.attr("src")!, baseUrl).toString() : null,
      actionText,
      content: cleanTimelineContent(fullText, [authorName, subjectTitle, createdAtText, actionText]) || null,
      createdAtText,
      detailUrl: absoluteUrl(baseUrl, detailLink.attr("href")),
      subjectTitle,
      subjectUrl,
      subjectCoverUrl: subjectImage.attr("src") ? new URL(subjectImage.attr("src")!, baseUrl).toString() : null,
      engagements: parseEngagements(fullText)
    });
  });

  return items.slice(0, 30);
}
