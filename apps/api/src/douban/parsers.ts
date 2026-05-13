import * as cheerio from "cheerio";
import type {
  Medium,
  RankingBoardConfig,
  RankingItem,
  ShelfStatus,
  SubjectComment,
  SubjectMediaGroup,
  SubjectRecord,
  SubjectSectionLink,
  SubjectStaffMember,
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
  items: Array<{ subject: SubjectRecord; status: ShelfStatus; rating: number | null; comment: string | null }>;
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
  comment: string | null;
}

export interface ParsedTimelineActionForm {
  actionUrl: string;
  method: "POST" | "GET";
  defaultFields: Record<string, string>;
  textFieldName: string | null;
}

export interface ParsedTimelineActionContext {
  statusId: string;
  engagements: TimelineEngagement[];
  userLikeState: TimelineItem["userLikeState"];
  availableActions: TimelineItem["availableActions"];
  likeForm: ParsedTimelineActionForm | null;
  unlikeForm: ParsedTimelineActionForm | null;
  replyForm: ParsedTimelineActionForm | null;
  repostForm: ParsedTimelineActionForm | null;
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

function extractCollectionComment($: cheerio.CheerioAPI, root?: cheerio.Cheerio<any>) {
  const scope = root ?? $.root();
  const selectors = root
    ? ".collection-comment, .comment, .short-note, .comment-text"
    : "#interest_sectl .collection-comment, .item-subject-rating .collection-comment, .subject-collection .collection-comment, .collection-comment";
  return safeText(scope.find(selectors).first().text());
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
  const normalized = maybeRelative.startsWith("//") ? `https:${maybeRelative}` : maybeRelative;
  const subjectTarget = decodedCandidates(normalized)
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
    return new URL(subjectTarget ?? normalized, baseUrl).toString();
  } catch {
    return subjectTarget ?? normalized;
  }
}

function ratingClassToLabel(value: string | null) {
  if (!value) {
    return null;
  }
  const className = value.match(/allstar(\d+)/)?.[1];
  if (!className) {
    return null;
  }
  const score = Number(className) / 10;
  if (score >= 5) {
    return "力荐";
  }
  if (score >= 4) {
    return "推荐";
  }
  if (score >= 3) {
    return "还行";
  }
  if (score >= 2) {
    return "较差";
  }
  if (score >= 1) {
    return "很差";
  }
  return null;
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

function imageFromStyle(value: string | undefined | null) {
  return value?.match(/url\(['"]?([^'")]+)['"]?\)/)?.[1] ?? null;
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

function emptySubjectMedia(): SubjectMediaGroup {
  return {
    videos: [],
    images: []
  };
}

function pushUnique<T>(items: T[], seen: Set<string>, key: string | null, item: T) {
  if (!key || seen.has(key)) {
    return;
  }
  seen.add(key);
  items.push(item);
}

function cleanListText(value: string | null) {
  return value
    ?.replace(/·/g, " ")
    .replace(/\(\s*(更多|收起|展开全部)\s*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim() ?? null;
}

function sectionByHeading($: cheerio.CheerioAPI, pattern: RegExp) {
  const heading = $("h2, h3").filter((_, element) => pattern.test(safeText($(element).text()) ?? "")).first();
  if (heading.length === 0) {
    return heading;
  }
  const block = heading.closest("#recommendations, #db-rec-section, #rec-ebook-section, .block5, .subject_show, .mod, .related-info, .section, .article");
  return block.length > 0 ? block.first() : heading.parent();
}

function normalizeListText(value: string | null) {
  return value
    ?.replace(/[·•]/g, " ")
    .replace(/\(\s*(更多|收起|展开全部|more|collapse)\s*\)/gi, " ")
    .replace(/\s+/g, " ")
    .trim() ?? null;
}

function parseRecommendedSubjects($: cheerio.CheerioAPI, baseUrl: string, medium: Medium): SubjectRecord[] {
  const scope =
    $("#recommendations").first().length > 0
      ? $("#recommendations").first()
      : $("#db-rec-section").first().length > 0
        ? $("#db-rec-section").first()
        : sectionByHeading($, /也喜欢/);
  const items: SubjectRecord[] = [];
  const seen = new Set<string>();

  scope.find("dl").each((_, element) => {
    const root = $(element);
    const anchor = root.find("a[href]").filter((_, link) => extractDoubanId($(link).attr("href") ?? "") != null).first();
    const href = anchor.attr("href");
    const externalUrl = absoluteUrl(baseUrl, href);
    const doubanId = href ? extractDoubanId(href) : null;
    const title =
      safeText(root.find("img").first().attr("alt")) ??
      safeText(root.find("dd a[href], .title a[href], a[href]").filter((_, link) => safeText($(link).text()) != null).first().text());
    if (!doubanId || !title || seen.has(doubanId)) {
      return;
    }
    seen.add(doubanId);
    items.push(
      createSubject(baseUrl, medium, {
        doubanId,
        title,
        coverUrl: root.find("img").first().attr("src"),
        averageRating: ratingFromRoot(root),
        metadata: {
          externalUrl: externalUrl ?? ""
        }
      })
    );
  });

  return items.slice(0, 12);
}

function parseSubjectStaff($: cheerio.CheerioAPI, baseUrl: string, medium: Medium): SubjectStaffMember[] {
  if (medium !== "movie") {
    return [];
  }
  const staff: SubjectStaffMember[] = [];
  const seen = new Set<string>();
  $("#celebrities li.celebrity, #celebrities .celebrity").each((_, element) => {
    const root = $(element);
    const nameLink = root.find(".name a[href], a.name[href], a[href]").filter((_, link) => safeText($(link).text()) != null || safeText($(link).attr("title")) != null).first();
    const name = safeText(nameLink.text()) ?? safeText(nameLink.attr("title"));
    if (!name) {
      return;
    }
    pushUnique(staff, seen, name, {
      name,
      role: safeText(root.find(".role").first().attr("title")) ?? safeText(root.find(".role").first().text()),
      avatarUrl: root.find("img").first().attr("src") ?? imageFromStyle(root.find(".avatar").first().attr("style")) ?? null,
      profileUrl: absoluteUrl(baseUrl, nameLink.attr("href"))
    });
  });
  return staff.slice(0, 12);
}

function parseSubjectMedia($: cheerio.CheerioAPI, baseUrl: string, medium: Medium): SubjectMediaGroup {
  const media = emptySubjectMedia();
  const seen = new Set<string>();
  if (medium !== "movie" && medium !== "game") {
    return media;
  }

  const addMedia = (type: "video" | "image", root: cheerio.Cheerio<any>, href: string | undefined | null, fallbackTitle?: string | null) => {
    const url = absoluteUrl(baseUrl, href);
    if (!url) {
      return;
    }
    const title =
      cleanListText(safeText(root.attr("title"))) ??
      cleanListText(safeText(root.find(".type-title, .title, span").first().text())) ??
      cleanListText(safeText(root.find("img").first().attr("alt"))) ??
      fallbackTitle ??
      null;
    const thumbnailUrl =
      root.find("img").first().attr("src") ??
      imageFromStyle(root.attr("style")) ??
      imageFromStyle(root.find("[style*='background-image']").first().attr("style")) ??
      null;
    pushUnique(type === "video" ? media.videos : media.images, seen, url, {
      type,
      title,
      thumbnailUrl,
      url
    });
  };

  if (medium === "game") {
    sectionByHeading($, /游戏视频/).find("li").each((_, element) => {
      const root = $(element);
      const link = root.find("a.video[href], a[href*='/video/']").first();
      addMedia("video", root, link.attr("href"));
    });
    sectionByHeading($, /游戏图片/).find("li").each((_, element) => {
      const root = $(element);
      const link = root.find("a[href*='/photo/']").first();
      addMedia("image", root, link.attr("href"));
    });
    return {
      videos: media.videos.slice(0, 6),
      images: media.images.slice(0, 8)
    };
  }

  $("a.related-pic-video[href], a[href*='/trailer/']").each((_, element) => {
    addMedia("video", $(element), $(element).attr("href"), "预告片");
  });
  $("a[href*='/photos/photo/'], a[href*='/photo/']").each((_, element) => {
    const root = $(element);
    if (root.closest("#mainpic, #recommendations, #celebrities, .comments, .comment-item").length > 0) {
      return;
    }
    addMedia("image", root, root.attr("href"));
  });

  return {
    videos: media.videos.slice(0, 4),
    images: media.images.slice(0, 8)
  };
}

function parseTrackList($: cheerio.CheerioAPI, medium: Medium) {
  if (medium !== "music") {
    return [];
  }
  const tracks: string[] = [];
  $(".track-list .track-items li, .track-list li").each((_, element) => {
    const track = safeText($(element).text())?.replace(/^\d+\.?\s*/, "");
    if (track) {
      tracks.push(track);
    }
  });
  return tracks.slice(0, 50);
}

function parseTableOfContents($: cheerio.CheerioAPI, doubanId: string, medium: Medium) {
  if (medium !== "book") {
    return [];
  }
  const source = $(`#dir_${doubanId}_full`).first().length > 0 ? $(`#dir_${doubanId}_full`).first() : $(`#dir_${doubanId}_short`).first();
  if (source.length === 0) {
    return [];
  }
  const clone = source.clone();
  clone.find("script, style, a").remove();
  clone.find("br").replaceWith("\n");
  return clone
    .text()
    .split(/\n+/)
    .map((line) => cleanListText(line))
    .filter((line): line is string => Boolean(line && !/^·+$/.test(line)))
    .slice(0, 80);
}

function parseSectionLinks($: cheerio.CheerioAPI, baseUrl: string, medium: Medium): SubjectSectionLink[] {
  const links: SubjectSectionLink[] = [];
  const seen = new Set<string>();
  const add = (key: string, label: string, href: string | undefined | null) => {
    const url = absoluteUrl(baseUrl, href);
    if (!url) {
      return;
    }
    pushUnique(links, seen, `${key}:${url}`, { key, label, url });
  };

  add("related", "全部推荐", $("#recommendations h2 a, #db-rec-section h2 a").first().attr("href"));
  if (medium === "movie") {
    add("staff", "全部演职员", $("#celebrities h2 a").first().attr("href"));
    add("videos", "全部视频", $("a[href*='/trailer/']").first().attr("href"));
    add("images", "全部图片", $("a[href*='/photos']").first().attr("href"));
  } else if (medium === "game") {
    const videoSection = sectionByHeading($, /游戏视频/);
    const imageSection = sectionByHeading($, /游戏图片/);
    add("videos", "全部视频", videoSection.find("h2 a[href*='videos']").first().attr("href"));
    add("images", "全部图片", imageSection.find("h2 a[href*='photos']").first().attr("href"));
  }

  return links;
}

function sanitizeListText(value: string | null) {
  return value
    ?.replace(/[·•・●]/g, " ")
    .replace(/\(\s*(more|collapse|expand|show more|show less|更多|展开全部|收起)\s*\)/gi, " ")
    .replace(/^[\s\-–—*#.、]+|[\s\-–—*#.、]+$/g, "")
    .replace(/\s+/g, " ")
    .trim() ?? null;
}

function findRecommendationScope($: cheerio.CheerioAPI) {
  if ($("#recommendations").first().length > 0) {
    return $("#recommendations").first();
  }
  if ($("#db-rec-section").first().length > 0) {
    return $("#db-rec-section").first();
  }
  return sectionByHeading($, /(also like|also liked|也喜欢|喜欢.*也喜欢|推荐)/i);
}

function parseRecommendedSubjectsRobust($: cheerio.CheerioAPI, baseUrl: string, medium: Medium): SubjectRecord[] {
  const scope = findRecommendationScope($);
  const items: SubjectRecord[] = [];
  const seen = new Set<string>();

  const addSubject = (root: cheerio.Cheerio<any>) => {
    const subject = subjectFromRoot($, root, baseUrl, medium);
    if (!subject || seen.has(subject.doubanId)) {
      return;
    }
    seen.add(subject.doubanId);
    items.push(subject);
  };

  const roots = scope.find("dl");
  if (roots.length > 0) {
    roots.each((_, element) => addSubject($(element)));
  } else {
    scope.find("li, article, .subject-item, .recommend-item").each((_, element) => addSubject($(element)));
  }

  if (items.length === 0) {
    scope
      .find("a[href]")
      .filter((_, element) => extractDoubanId($(element).attr("href") ?? "") != null)
      .each((_, element) => {
        const anchor = $(element);
        const href = anchor.attr("href");
        const doubanId = href ? extractDoubanId(href) : null;
        const title = safeText(anchor.attr("title")) ?? safeText(anchor.text()) ?? safeText(anchor.find("img").attr("alt"));
        if (!doubanId || !title || seen.has(doubanId)) {
          return;
        }
        seen.add(doubanId);
        items.push(
          createSubject(baseUrl, medium, {
            doubanId,
            title,
            coverUrl: anchor.find("img").attr("src"),
            metadata: {
              externalUrl: absoluteUrl(baseUrl, href) ?? ""
            }
          })
        );
      });
  }

  return items.slice(0, 12);
}

function parseSubjectMediaRobust($: cheerio.CheerioAPI, baseUrl: string, medium: Medium): SubjectMediaGroup {
  const media = emptySubjectMedia();
  const seen = new Set<string>();
  if (medium !== "movie" && medium !== "game") {
    return media;
  }

  const addMedia = (type: "video" | "image", root: cheerio.Cheerio<any>, href: string | undefined | null, fallbackTitle?: string | null) => {
    const url = absoluteUrl(baseUrl, href);
    if (!url) {
      return;
    }
    const title =
      sanitizeListText(safeText(root.attr("title"))) ??
      sanitizeListText(safeText(root.find(".type-title, .title, span").first().text())) ??
      sanitizeListText(safeText(root.find("img").first().attr("alt"))) ??
      sanitizeListText(fallbackTitle ?? null) ??
      null;
    const thumbnailUrl =
      root.find("img").first().attr("src") ??
      imageFromStyle(root.attr("style")) ??
      imageFromStyle(root.find("[style*='background-image']").first().attr("style")) ??
      null;
    pushUnique(type === "video" ? media.videos : media.images, seen, url, {
      type,
      title,
      thumbnailUrl,
      url
    });
  };

  const collectGameVideos = (scope: cheerio.Cheerio<any>) => {
    scope.find("li.video-mini, a.video[href], a[href*='/video/']").each((_, element) => {
      const root = $(element);
      const container = root.is("li") ? root : root.closest("li").length > 0 ? root.closest("li") : root;
      const link = root.is("a") ? root : root.find("a.video[href], a[href*='/video/']").first();
      addMedia("video", container, link.attr("href"), safeText(link.text()));
    });
  };

  const collectImages = (scope: cheerio.Cheerio<any>) => {
    scope.find("a[href*='/photos/photo/'], a[href*='/photo/']").each((_, element) => {
      const root = $(element);
      if (root.closest("#mainpic, #recommendations, #db-rec-section, #celebrities, .comments, .comment-item").length > 0) {
        return;
      }
      addMedia("image", root, root.attr("href"));
    });
  };

  if (medium === "game") {
    collectGameVideos(sectionByHeading($, /(game videos?|视频|预告)/i));
    collectImages(sectionByHeading($, /(game photos?|图片|剧照)/i));
    if (media.videos.length === 0) {
      collectGameVideos($.root());
    }
    if (media.images.length === 0) {
      collectImages($.root());
    }
    return {
      videos: media.videos.slice(0, 6),
      images: media.images.slice(0, 8)
    };
  }

  $("a.related-pic-video[href], a[href*='/trailer/'], a[href*='/video/']").each((_, element) => {
    const root = $(element);
    if (root.closest("#recommendations, #db-rec-section, .comments, .comment-item").length > 0) {
      return;
    }
    addMedia("video", root, root.attr("href"), "Trailer");
  });
  collectImages($.root());

  return {
    videos: media.videos.slice(0, 4),
    images: media.images.slice(0, 8)
  };
}

function parseTrackListRobust($: cheerio.CheerioAPI, medium: Medium) {
  if (medium !== "music") {
    return [];
  }
  const tracks: string[] = [];
  const seen = new Set<string>();
  $(".track-list .track-items li, .track-list li").each((_, element) => {
    const track = sanitizeListText(safeText($(element).text())?.replace(/^\d+\.?\s*/, "") ?? null);
    if (track && !seen.has(track)) {
      seen.add(track);
      tracks.push(track);
    }
  });
  return tracks.slice(0, 50);
}

function parseTableOfContentsRobust($: cheerio.CheerioAPI, doubanId: string, medium: Medium) {
  if (medium !== "book") {
    return [];
  }
  const source = $(`#dir_${doubanId}_full`).first().length > 0 ? $(`#dir_${doubanId}_full`).first() : $(`#dir_${doubanId}_short`).first();
  if (source.length === 0) {
    return [];
  }
  const clone = source.clone();
  clone.find("script, style, a").remove();
  clone.find("br").replaceWith("\n");
  return clone
    .text()
    .split(/\n+/)
    .map((line) => sanitizeListText(line))
    .filter((line): line is string => Boolean(line && !/^[.…·•\-]+$/.test(line)))
    .slice(0, 80);
}

function parseSectionLinksRobust($: cheerio.CheerioAPI, baseUrl: string, medium: Medium): SubjectSectionLink[] {
  const links: SubjectSectionLink[] = [];
  const seen = new Set<string>();
  const add = (key: string, label: string, href: string | undefined | null) => {
    const url = absoluteUrl(baseUrl, href);
    if (!url) {
      return;
    }
    pushUnique(links, seen, `${key}:${url}`, { key, label, url });
  };

  const recommendationScope = findRecommendationScope($);
  add(
    "related",
    "All recommendations",
    recommendationScope.find("h2 a[href], h3 a[href], .pl a[href]").first().attr("href") ??
      recommendationScope.find("a[href]").filter((_, element) => extractDoubanId($(element).attr("href") ?? "") != null).first().attr("href")
  );

  if (medium === "movie") {
    add("staff", "Cast and crew", $("#celebrities h2 a[href], #celebrities .pl a[href]").first().attr("href"));
    add("videos", "Videos", $("a.related-pic-video[href], a[href*='/trailer/'], a[href*='/video/']").first().attr("href"));
    add(
      "images",
      "Images",
      $("a[href*='/photos']").first().attr("href") ??
        $("a[href*='/photo/']")
          .filter((_, element) => $(element).closest("#recommendations, #db-rec-section, .comments, .comment-item").length === 0)
          .first()
          .attr("href")
    );
  } else if (medium === "game") {
    add("videos", "Videos", $("li.video-mini a[href], a.video[href], a[href*='/video/']").first().attr("href"));
    add(
      "images",
      "Images",
      $("a[href*='/photo/']")
        .filter((_, element) => $(element).closest("#recommendations, #db-rec-section, .comments, .comment-item").length === 0)
        .first()
        .attr("href")
    );
  }

  return links;
}

export function parseSubjectDetailExtras(html: string, baseUrl: string, medium: Medium, doubanId: string) {
  const $ = cheerio.load(html);
  return {
    staff: parseSubjectStaff($, baseUrl, medium),
    media: parseSubjectMediaRobust($, baseUrl, medium),
    trackList: parseTrackListRobust($, medium),
    tableOfContents: parseTableOfContentsRobust($, doubanId, medium),
    relatedSubjects: parseRecommendedSubjectsRobust($, baseUrl, medium),
    sectionLinks: parseSectionLinksRobust($, baseUrl, medium)
  };
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
    const authorLink = root.find(".comment-info a, .user-info a").first();
    const platform = root
      .find(".user-info > span")
      .toArray()
      .map((node) => $(node))
      .map((node) => {
        const className = node.attr("class") ?? "";
        if (/pubtime|comment-location|allstar/i.test(className)) {
          return null;
        }
        return safeText(node.text());
      })
      .find((value) => value != null) ?? null;
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
    const diggLink = root.find(".digg a, .comment-vote .vote-comment").first();
    const voteStateText = safeText(root.find(".digg, .comment-vote").first().text()) ?? "";
    comments.push({
      id,
      author: safeText(authorLink.text()),
      authorUrl: absoluteUrl("https://www.douban.com", authorLink.attr("href")),
      authorAvatarUrl: null,
      userVoteState: /cancel_vote/.test(diggLink.attr("href") ?? "") ? "voted" : diggLink.length > 0 ? "not_voted" : /已投票/.test(voteStateText) ? "voted" : "not_voted",
      content,
      rating:
        safeText(root.find(".rating, .user-stars").first().attr("title") ?? null) ??
        ratingClassToLabel(root.find("[class*='allstar']").first().attr("class") ?? null),
      createdAt: safeText(root.find(".comment-time, .pubtime").first().text()),
      platform,
      votes: Number(root.find(".vote-count, .votes, .digg span").first().text()) || null
    });
  });
  return comments.slice(0, limit);
}

function extractSubjectCommentVoteApiTemplate(html: string) {
  return (
    html.match(/createVoteHandler\(\{[\s\S]*?api:\s*['"]([^'"]+)['"]/i)?.[1] ??
    html.match(/api:\s*['"]([^'"]*\/j\/comment\/:id\/vote[^'"]*)['"]/i)?.[1] ??
    null
  );
}

export function parseSubjectCommentVoteAction(html: string, commentId: string, pageUrl = "https://www.douban.com") {
  const $ = cheerio.load(html);
  const root = $(`.comment-item[data-cid="${commentId}"], #${commentId}, .review-item[data-cid="${commentId}"]`).first();
  if (root.length === 0) {
    return null;
  }
  const voteLink = root.find(".digg a").first();
  const currentVotes = Number(root.find(".vote-count, .votes, .digg span").first().text()) || 0;
  if (voteLink.length > 0) {
    const href = absoluteUrl(pageUrl, voteLink.attr("href"));
    const dataHref = absoluteUrl(pageUrl, voteLink.attr("data-href"));
    const userVoteState = /cancel_vote/.test(href ?? "") ? "voted" : "not_voted";
    const voteUrl = userVoteState === "voted" ? dataHref : href;
    const cancelVoteUrl = userVoteState === "voted" ? href : dataHref;
    if (!voteUrl) {
      return null;
    }
    return {
      voteUrl,
      cancelVoteUrl: cancelVoteUrl ?? null,
      userVoteState,
      votes: currentVotes
    };
  }

  const legacyVoteLink = root.find(".comment-vote .vote-comment").first();
  const legacyVoteTemplate = extractSubjectCommentVoteApiTemplate(html);
  const legacyVoteTarget = absoluteUrl(pageUrl, legacyVoteTemplate?.replace(":id", legacyVoteLink.attr("data-cid") ?? commentId) ?? null);
  if (!legacyVoteTarget) {
    return null;
  }
  const userVoteState = legacyVoteLink.length > 0 ? "not_voted" : /已投票/.test(root.find(".comment-vote").first().text()) ? "voted" : "not_voted";
  return {
    voteUrl: legacyVoteTarget,
    cancelVoteUrl: null,
    userVoteState,
    votes: currentVotes
  };
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
  const items = new Map<string, ParsedUserCollection["items"][number]>();
  $(".collection-item, .interest-item, .common-item, .item.comment-item, tr.item, article, li").each((_, element) => {
    const root = $(element);
    const subject = subjectFromRoot($, root, baseUrl, medium);
    if (!subject) {
      return;
    }
    const nextItem = {
      status: fromDoubanStatus(root.attr("data-status") ?? undefined, fallbackStatus),
      rating: ratingFromRoot(root),
      comment: extractCollectionComment($, root),
      subject
    };
    const existing = items.get(subject.doubanId);
    if (!existing) {
      items.set(subject.doubanId, nextItem);
      return;
    }
    items.set(subject.doubanId, {
      status: nextItem.status ?? existing.status,
      rating: existing.rating ?? nextItem.rating,
      comment: existing.comment ?? nextItem.comment,
      subject: {
        ...existing.subject,
        ...nextItem.subject,
        coverUrl: existing.subject.coverUrl ?? nextItem.subject.coverUrl,
        averageRating: existing.subject.averageRating ?? nextItem.subject.averageRating,
        summary: existing.subject.summary ?? nextItem.subject.summary,
        creators: existing.subject.creators.length > 0 ? existing.subject.creators : nextItem.subject.creators,
        metadata:
          Object.keys(existing.subject.metadata).length > 0
            ? existing.subject.metadata
            : nextItem.subject.metadata
      }
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
    items: Array.from(items.values()),
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
    const $ = cheerio.load(html);
    const commentValue =
      Object.entries(form.defaultFields).find(([name]) => /^comment$/i.test(name) || /comment/i.test(name) || /intro/i.test(name))?.[1] ??
      extractCollectionComment($) ??
      "";
    const numericRating = Number(ratingValue);
    return {
      status: rawStatus ? fromDoubanStatus(rawStatus, "wish") : null,
      rating: Number.isFinite(numericRating) && numericRating > 0 ? numericRating : null,
      comment: safeText(commentValue)
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
      rating: Number.isFinite(numericRating) && numericRating > 0 ? numericRating : null,
      comment: extractCollectionComment($)
    };
  }
}

export function parsePeopleId(html: string) {
  return html.match(/people\/([^/"'?]+)\//)?.[1] ?? null;
}

function parseTimelineActionKind(input: string) {
  const normalized = input.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (/(cancel[_-]?like|unlike|liked|取消赞|已赞|收回赞|撤销赞)/i.test(normalized)) {
    return "unlike" as const;
  }
  if (/(?:^|[^a-z])(reply|comment)(?:[^a-z]|$)|回应|回复/i.test(normalized)) {
    return "reply" as const;
  }
  if (/(?:^|[^a-z])(repost|retweet|reshare|share)(?:[^a-z]|$)|转发/i.test(normalized)) {
    return "repost" as const;
  }
  if (/(?:^|[^a-z])like(?:[^a-z]|$)|赞/i.test(normalized)) {
    return "like" as const;
  }
  return null;
}

function parseTimelineActionLikeState($: cheerio.CheerioAPI, root: cheerio.Cheerio<any>): TimelineItem["userLikeState"] {
  let state: TimelineItem["userLikeState"] = "unknown";
  root.find("form, a, button, [data-href], [data-action]").each((_, element) => {
    if (state === "liked") {
      return;
    }
    const current = $(element);
    const text = safeText(current.text()) ?? "";
    const href = current.attr("href") ?? "";
    const dataHref = current.attr("data-href") ?? "";
    const className = current.attr("class") ?? "";
    const action = `${text} ${href} ${dataHref} ${className} ${current.attr("data-action") ?? ""}`;
    const kind = parseTimelineActionKind(action);
    if (kind === "unlike") {
      state = "liked";
      return;
    }
    if (kind === "like" && state === "unknown") {
      state = "not_liked";
    }
  });
  return state;
}

function parseTimelineAvailableActions($: cheerio.CheerioAPI, root: cheerio.Cheerio<any>) {
  const available = {
    like: false,
    reply: false,
    repost: false
  };
  root.find("form, a, button, [data-href], [data-action]").each((_, element) => {
    const current = $(element);
    const action = [
      safeText(current.text()),
      current.attr("href"),
      current.attr("data-href"),
      current.attr("class"),
      current.attr("data-action"),
      current.attr("aria-label")
    ]
      .filter(Boolean)
      .join(" ");
    const kind = parseTimelineActionKind(action);
    if (kind === "like" || kind === "unlike") {
      available.like = true;
    } else if (kind === "reply") {
      available.reply = true;
    } else if (kind === "repost") {
      available.repost = true;
    }
  });
  return available;
}

function parseTimelineForm($: cheerio.CheerioAPI, root: cheerio.Cheerio<any>, baseUrl: string): ParsedTimelineActionForm | null {
  if (root.length === 0 || root[0]?.tagName !== "form") {
    return null;
  }
  const defaultFields: Record<string, string> = {};
  let textFieldName: string | null = null;
  root.find("input, textarea, select").each((_, element) => {
    const current = $(element);
    const name = current.attr("name");
    if (!name) {
      return;
    }
    const tagName = element.tagName?.toLowerCase() ?? "";
    const type = (current.attr("type") ?? "").toLowerCase();
    if (tagName === "textarea") {
      defaultFields[name] = current.text() ?? "";
      textFieldName ??= name;
      return;
    }
    if (tagName === "select") {
      const selected = current.find("option[selected]").first();
      defaultFields[name] = selected.attr("value") ?? selected.text() ?? "";
      return;
    }
    if (type === "checkbox" || type === "radio") {
      if (current.is(":checked") || current.attr("checked") != null) {
        defaultFields[name] = current.attr("value") ?? "on";
      }
      return;
    }
    defaultFields[name] = current.attr("value") ?? "";
  });
  return {
    actionUrl: new URL(root.attr("action") ?? baseUrl, baseUrl).toString(),
    method: (root.attr("method")?.toUpperCase() === "GET" ? "GET" : "POST") as "GET" | "POST",
    defaultFields,
    textFieldName
  };
}

function parseTimelineActionLink(root: cheerio.Cheerio<any>, baseUrl: string): ParsedTimelineActionForm | null {
  if (root.length === 0) {
    return null;
  }
  const href = root.attr("data-href") ?? root.attr("href");
  if (!href) {
    return null;
  }
  const actionUrl = absoluteUrl(baseUrl, href);
  if (!actionUrl) {
    return null;
  }
  const defaultFields: Record<string, string> = {};
  const params = new URL(actionUrl).searchParams;
  params.forEach((value, key) => {
    defaultFields[key] = value;
  });
  for (const attribute of ["data-sid", "data-id", "data-status-id"]) {
    const value = root.attr(attribute);
    if (!value) {
      continue;
    }
    const key = attribute.replace(/^data-/, "").replace(/-/g, "_");
    defaultFields[key] = value;
  }
  return {
    actionUrl,
    method: (root.attr("data-method")?.toUpperCase() === "GET" ? "GET" : "POST") as "GET" | "POST",
    defaultFields,
    textFieldName: null
  };
}

function parseTimelineActionFormByKind(
  $: cheerio.CheerioAPI,
  root: cheerio.Cheerio<any>,
  baseUrl: string,
  matcher: (kind: ReturnType<typeof parseTimelineActionKind>) => boolean
) {
  let fallback: ParsedTimelineActionForm | null = null;
  root.find("form").each((_, element) => {
    const current = $(element);
    const hint = [
      current.attr("action"),
      current.attr("class"),
      current.attr("id"),
      current.attr("data-action"),
      safeText(current.text())
    ]
      .filter(Boolean)
      .join(" ");
    const kind = parseTimelineActionKind(hint);
    if (!matcher(kind)) {
      return;
    }
    fallback = parseTimelineForm($, current, baseUrl);
    return false;
  });
  if (fallback) {
    return fallback;
  }
  root.find("a[href], [data-href]").each((_, element) => {
    const current = $(element);
    const hint = [
      current.attr("href"),
      current.attr("data-href"),
      current.attr("class"),
      current.attr("data-action"),
      safeText(current.text()),
      current.attr("aria-label")
    ]
      .filter(Boolean)
      .join(" ");
    const kind = parseTimelineActionKind(hint);
    if (!matcher(kind)) {
      return;
    }
    fallback = parseTimelineActionLink(current, baseUrl);
    return false;
  });
  return fallback;
}

export function parseTimelineActionContext(html: string, baseUrl: string, statusId: string): ParsedTimelineActionContext | null {
  const $ = cheerio.load(html);
  const wrapper =
    $(`.new-status.status-wrapper[data-sid="${statusId}"]`).first().length > 0
      ? $(`.new-status.status-wrapper[data-sid="${statusId}"]`).first()
      : $(`.status-item[data-sid="${statusId}"]`).first().length > 0
        ? $(`.status-item[data-sid="${statusId}"]`).first()
        : $(".new-status.status-wrapper, .status-item, .status-real-wrapper, .status").first();
  if (wrapper.length === 0) {
    return null;
  }
  const actionRoot =
    wrapper.find(".timeline-actions, .status-actions, .actions, .operations, .operation-div, .action-bar, .status-op").first().length > 0
      ? wrapper.find(".timeline-actions, .status-actions, .actions, .operations, .operation-div, .action-bar, .status-op").first()
      : wrapper;
  const engagementsSource = timelineText(actionRoot).length > 0 ? timelineText(actionRoot) : timelineText(wrapper);
  const availableActions = parseTimelineAvailableActions($, actionRoot);
  return {
    statusId,
    engagements: parseEngagements(engagementsSource),
    userLikeState: parseTimelineActionLikeState($, actionRoot),
    availableActions,
    likeForm: parseTimelineActionFormByKind($, actionRoot, baseUrl, (kind) => kind === "like"),
    unlikeForm: parseTimelineActionFormByKind($, actionRoot, baseUrl, (kind) => kind === "unlike"),
    replyForm: parseTimelineActionFormByKind($, actionRoot, baseUrl, (kind) => kind === "reply"),
    repostForm: parseTimelineActionFormByKind($, actionRoot, baseUrl, (kind) => kind === "repost")
  };
}

function splitTimelineTailMeta(text: string) {
  let body = text.trim();
  const parts: string[] = [];

  while (true) {
    const match = body.match(/\s*((?:\d+\s*)?(?:回应|转发|赞)(?:\s*\(\d+\))?|删除)$/);
    if (!match || match.index == null) {
      break;
    }
    parts.unshift(match[1].trim());
    body = body.slice(0, match.index).trimEnd();
  }

  return {
    body: body.trim(),
    meta: parts.join(" ")
  };
}

function parseEngagements(text: string): TimelineEngagement[] {
  const source = splitTimelineTailMeta(text).meta || text;
  const regex = /(\d+)\s*(回应|转发|赞)|(回应|转发|赞)(?:\s*\((\d+)\))?/g;
  const engagements: TimelineEngagement[] = [];
  const seen = new Set<string>();

  for (const match of source.matchAll(regex)) {
    const label = (match[2] ?? match[3]) as TimelineEngagement["label"] | undefined;
    if (!label || seen.has(label)) {
      continue;
    }
    const count = match[1] ?? match[4];
    engagements.push({ label, count: count ? Number(count) : null });
    seen.add(label);
  }

  return engagements;
}

function cleanTimelineContent(input: string, removeParts: Array<string | null>) {
  let output = input;
  for (const part of removeParts) {
    if (part) {
      output = output.replace(part, " ");
    }
  }
  return splitTimelineTailMeta(output).body.replace(/\s+/g, " ").trim();
}

function timelineText(root: cheerio.Cheerio<any>) {
  const clone = root.clone();
  clone.find("script, style, noscript, template").remove();
  return safeText(clone.text()) ?? "";
}

function looksLikeImageUrl(value: string) {
  return /^https?:\/\//.test(value) && /(\.avif|\.gif|\.jpe?g|\.png|\.webp)(?:[?#]|$)/i.test(value);
}

function collectTimelinePhotoUrls(input: unknown, baseUrl: string, push: (url: string) => void) {
  if (typeof input === "string") {
    const normalized = absoluteUrl(baseUrl, input);
    if (normalized && looksLikeImageUrl(normalized)) {
      push(normalized);
    }
    return;
  }
  if (Array.isArray(input)) {
    input.forEach((item) => collectTimelinePhotoUrls(item, baseUrl, push));
    return;
  }
  if (!input || typeof input !== "object") {
    return;
  }
  for (const value of Object.values(input)) {
    collectTimelinePhotoUrls(value, baseUrl, push);
  }
}

function parseTimelinePhotos($: cheerio.CheerioAPI, wrapper: cheerio.Cheerio<any>, baseUrl: string, ignoredUrls: string[]) {
  const photos: string[] = [];
  const seen = new Set<string>(ignoredUrls.filter(Boolean));
  const push = (url: string) => {
    if (seen.has(url)) {
      return;
    }
    seen.add(url);
    photos.push(url);
  };

  wrapper.find("img[src]").each((_, element) => {
    const image = $(element);
    if (image.closest("a[href*='/people/']").length > 0) {
      return;
    }
    const src = absoluteUrl(baseUrl, image.attr("src"));
    if (src && looksLikeImageUrl(src)) {
      push(src);
    }
  });

  wrapper.find("script").each((_, element) => {
    const script = $(element).html() ?? "";
    const matches = script.matchAll(/(?:var|let|const)\s+photos\s*=\s*(\[[\s\S]*?\]);/g);
    for (const match of matches) {
      try {
        collectTimelinePhotoUrls(JSON.parse(match[1]), baseUrl, push);
      } catch {
        // Ignore malformed inline photo payloads.
      }
    }
  });

  return photos;
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
    const subjectLink =
      subjectRoot.find(".title a[href]").first().length > 0
        ? subjectRoot.find(".title a[href]").first()
        : wrapper.find("a.media[href], a[href]").filter((_, link) => extractDoubanId($(link).attr("href") ?? "") != null).first();
    const authorImage = wrapper.find(".usr-pic img, a[href*='/people/'] img").first();
    const authorName = safeText(peopleLink.text());
    const targetType = statusRoot.attr("data-target-type");
    const objectId = statusRoot.attr("data-object-id");
    const hasSubject = subjectRoot.length > 0 || subjectLink.length > 0 || Boolean(targetType && objectId);
    const subjectImage =
      hasSubject
        ? (subjectRoot.length > 0 ? subjectRoot : subjectLink).find("img").filter((_, image) => $(image).closest("a[href*='/people/']").length === 0).first()
        : null;
    const subjectTitle = hasSubject
      ? safeText(subjectRoot.find(".title a").first().text()) ??
        safeText(subjectLink.attr("title")) ??
        safeText(subjectLink.text()) ??
        safeText(subjectImage?.attr("alt"))
      : null;
    const createdAtText = safeText(detailLink.text()) ?? safeText(wrapper.find(".created_at, .status-time, .pubtime").first().text());
    const actionText =
      cleanTimelineContent(safeText(wrapper.find(".hd .text").first().text()) ?? "", [authorName]) ||
      safeText(wrapper.find(".status-saying, .status-header").first().text()) ||
      statusRoot.attr("data-action") ||
      null;
    const fullText = timelineText(wrapper);
    const fallbackSubjectUrl =
      objectId && targetType === "game"
        ? `${baseUrl.replace(/\/$/, "")}/game/${objectId}/`
        : objectId
          ? `https://${targetType === "book" ? "book" : targetType === "music" ? "music" : "movie"}.douban.com/subject/${objectId}/`
          : null;
    const rawSubjectUrl = absoluteUrl(baseUrl, subjectLink.attr("href"));
    const subjectUrl = hasSubject ? (rawSubjectUrl && extractDoubanId(rawSubjectUrl) ? rawSubjectUrl : fallbackSubjectUrl ?? rawSubjectUrl) : null;
    const authorAvatarUrl = authorImage.attr("src") ? new URL(authorImage.attr("src")!, baseUrl).toString() : null;
    const subjectCoverUrl = hasSubject && subjectImage?.attr("src") ? new URL(subjectImage.attr("src")!, baseUrl).toString() : null;
    const photoUrls = parseTimelinePhotos($, wrapper, baseUrl, [authorAvatarUrl ?? "", subjectCoverUrl ?? ""]);
    const detailUrl = absoluteUrl(baseUrl, detailLink.attr("href"));
    const parsedAvailableActions = parseTimelineAvailableActions($, wrapper);
    const defaultAvailableActions = detailUrl
      ? {
          like: true,
          reply: true,
          repost: true
        }
      : {
          like: false,
          reply: false,
          repost: false
        };

    items.push({
      id,
      authorName,
      authorUrl: absoluteUrl(baseUrl, peopleLink.attr("href")),
      authorAvatarUrl,
      actionText,
      content: cleanTimelineContent(fullText, [authorName, subjectTitle, createdAtText, actionText]) || null,
      createdAtText,
      detailUrl,
      subjectTitle,
      subjectUrl,
      subjectCoverUrl,
      photoUrls,
      engagements: parseEngagements(fullText),
      userLikeState: parseTimelineActionLikeState($, wrapper),
      availableActions: {
        like: parsedAvailableActions.like || defaultAvailableActions.like,
        reply: parsedAvailableActions.reply || defaultAvailableActions.reply,
        repost: parsedAvailableActions.repost || defaultAvailableActions.repost
      }
    });
  });

  return items.slice(0, 30);
}
