import express from "express";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { Medium, ShelfStatus } from "../../../packages/shared/src";

interface MockRemoteState {
  status: ShelfStatus;
  rating: number | null;
  comment: string;
  tags: string[];
  syncToTimeline: boolean;
}

interface MockSubject {
  medium: Medium;
  doubanId: string;
  title: string;
  subtitle: string;
  creators: string;
  year: string;
  rating: string;
  summary: string;
  cover: string;
  metaLabel: string;
  metaValue: string;
  blurb: string;
}

interface MockTimelineState {
  id: string;
  peopleId: string;
  author: string;
  actionText: string;
  content: string;
  createdAtText: string;
  subjectMedium: Medium;
  engagements: {
    reply: number;
    repost: number;
    like: number;
  };
  liked: boolean;
}

const subjects: Record<Medium, MockSubject> = {
  movie: {
    medium: "movie",
    doubanId: "1292052",
    title: "肖申克的救赎",
    subtitle: "The Shawshank Redemption",
    creators: "Frank Darabont / Tim Robbins",
    year: "1994",
    rating: "9.7",
    summary: "希望让人自由。",
    cover: "/images/movie-1292052.jpg",
    metaLabel: "类型",
    metaValue: "剧情",
    blurb: "常年稳居榜单。"
  },
  book: {
    medium: "book",
    doubanId: "6082808",
    title: "百年孤独",
    subtitle: "Cien anos de soledad",
    creators: "加西亚·马尔克斯",
    year: "1967",
    rating: "9.3",
    summary: "布恩迪亚家族七代人的命运。",
    cover: "/images/book-6082808.jpg",
    metaLabel: "出版社",
    metaValue: "南海出版公司",
    blurb: "拉美文学代表作。"
  },
  music: {
    medium: "music",
    doubanId: "1417590",
    title: "范特西",
    subtitle: "Fantasy",
    creators: "周杰伦",
    year: "2001",
    rating: "9.1",
    summary: "周杰伦经典专辑。",
    cover: "/images/music-1417590.jpg",
    metaLabel: "流派",
    metaValue: "流行",
    blurb: "华语流行经典。"
  },
  game: {
    medium: "game",
    doubanId: "30347464",
    title: "塞尔达传说：王国之泪",
    subtitle: "The Legend of Zelda: Tears of the Kingdom",
    creators: "Nintendo",
    year: "2023",
    rating: "9.6",
    summary: "天空、地底与海拉鲁的再次探索。",
    cover: "/images/game-30347464.jpg",
    metaLabel: "平台",
    metaValue: "Nintendo Switch",
    blurb: "Switch 平台代表作。"
  }
};

const relatedSubjects: Record<Medium, { doubanId: string; title: string; cover: string }> = {
  movie: { doubanId: "1292720", title: "Forrest Gump", cover: "/images/movie-related.jpg" },
  book: { doubanId: "1003078", title: "Related Book", cover: "/images/book-related.jpg" },
  music: { doubanId: "20427949", title: "Related Album", cover: "/images/music-related.jpg" },
  game: { doubanId: "26791492", title: "Related Game", cover: "/images/game-related.jpg" }
};

function interestValue(status: ShelfStatus) {
  switch (status) {
    case "wish":
      return "wish";
    case "doing":
      return "do";
    case "done":
      return "collect";
  }
}

function renderDetail(subject: MockSubject, state: MockRemoteState) {
  const canonical =
    subject.medium === "game"
      ? `https://example.test/game/${subject.doubanId}/`
      : `https://example.test/${subject.medium}/subject/${subject.doubanId}`;
  const action =
    subject.medium === "game"
      ? `/game/${subject.doubanId}/interest`
      : `/${subject.medium}/subject/${subject.doubanId}/interest`;
  const related = relatedSubjects[subject.medium];
  const relatedHref = subject.medium === "game" ? `/game/${related.doubanId}/` : `/${subject.medium}/subject/${related.doubanId}/`;
  const relatedSection = `
      <div id="db-rec-section">
        <h2>People also liked</h2>
        <div class="content clearfix">
          <dl>
            <dt><a href="${relatedHref}"><img src="${related.cover}" alt="${related.title}" /></a></dt>
            <dd><a href="${relatedHref}">${related.title}</a><span class="subject-rate">8.8</span></dd>
          </dl>
        </div>
      </div>`;
  const movieExtras =
    subject.medium === "movie"
      ? `
      <div id="celebrities">
        <h2><span>Cast and crew</span><span class="pl">(<a href="/subject/${subject.doubanId}/celebrities">all</a>)</span></h2>
        <ul>
          <li class="celebrity">
            <a href="/personage/1/" title="Frank Darabont"><div class="avatar" style="background-image: url(/images/staff.jpg)"></div></a>
            <div class="info"><span class="name"><a href="/personage/1/">Frank Darabont</a></span><span class="role" title="Director">Director</span></div>
          </li>
        </ul>
      </div>
      <a class="related-pic-video" href="/trailer/1/#content" title="Trailer" style="background-image:url(/images/trailer.jpg)"><p class="type-title">Trailer</p></a>
      <a href="/photos/photo/1/"><img src="/images/movie-photo.jpg" alt="Still" /></a>`
      : "";
  const musicExtras =
    subject.medium === "music"
      ? `
      <div class="track-list">
        <ul class="track-items indent">
          <li data-track-order="1.">Track One</li>
          <li data-track-order="2.">Track Two</li>
        </ul>
      </div>`
      : "";
  const bookExtras =
    subject.medium === "book"
      ? `
      <div class="indent" id="dir_${subject.doubanId}_short">Prologue<br/>Chapter One<br/>...</div>
      <div class="indent" id="dir_${subject.doubanId}_full" style="display:none">Prologue<br/>Chapter One<br/>Chapter Two<br/>Epilogue<br/></div>`
      : "";
  const gameExtras =
    subject.medium === "game"
      ? `
      <div class="mod">
        <h2>Game videos</h2>
        <ul><li class="video-mini"><a class="video" href="/game/${subject.doubanId}/video/1/"><img src="/images/game-video.jpg" /></a><a class="title" href="/game/${subject.doubanId}/video/1/"><span>Gameplay video</span></a></li></ul>
      </div>
      <div class="mod">
        <h2>Game photos</h2>
        <ul><li><a href="/game/${subject.doubanId}/photo/1/"><img src="/images/game-photo.jpg" /></a></li></ul>
      </div>`
      : "";

  return `
  <html>
    <head><link rel="canonical" href="${canonical}" /></head>
    <body>
      <h1>${subject.title}</h1>
      <p class="subject-subtitle">${subject.subtitle}</p>
      <div class="year" data-year="${subject.year}">${subject.year}</div>
      <div class="cover"><img src="${subject.cover}" /></div>
      <div class="rating-value">${subject.rating}</div>
      <div class="creators">${subject.creators}</div>
      <div class="summary">${subject.summary}<style>.report { color: #bbb; }</style><script>window.createReportButton({ text: "投诉" })</script></div>
      <div class="meta-row"><span class="label">${subject.metaLabel}</span><span class="value">${subject.metaValue}</span></div>
      ${movieExtras}
      ${musicExtras}
      ${bookExtras}
      ${gameExtras}
      ${relatedSection}
      <div class="comment-item" data-cid="c1">
        <div class="comment-info"><a>测试用户</a><span class="comment-time">2026-05-10</span></div>
        <p><span class="short">这是一条公开短评。</span></p>
        <span class="vote-count">12</span>
      </div>
      <form data-interest-form action="${action}" method="POST">
        <input type="hidden" name="ck" value="test-ck" />
        <input type="hidden" name="interest" value="${interestValue(state.status)}" />
        <select name="rating"><option value="${state.rating ?? ""}" selected>${state.rating ?? ""}</option></select>
        <input type="text" name="tags" value="${state.tags.join(" ")}" />
        <textarea name="comment">${state.comment}</textarea>
        <input type="checkbox" name="sync_douban" value="1" ${state.syncToTimeline ? "checked" : ""} />
      </form>
    </body>
  </html>`;
}

function renderInterestEditor(subject: MockSubject, state: MockRemoteState) {
  const action =
    subject.medium === "game"
      ? `/game/${subject.doubanId}/interest`
      : `/${subject.medium}/j/subject/${subject.doubanId}/interest`;

  return `
  <form data-interest-form action="${action}" method="POST">
    <input type="hidden" name="ck" value="test-ck" />
    <label><input type="radio" name="interest" value="wish" ${state.status === "wish" ? "checked" : ""} />wish</label>
    <label><input type="radio" name="interest" value="do" ${state.status === "doing" ? "checked" : ""} />do</label>
    <label><input type="radio" name="interest" value="collect" ${state.status === "done" ? "checked" : ""} />collect</label>
    <select name="rating"><option value="${state.rating ?? ""}" selected>${state.rating ?? ""}</option></select>
    <input type="text" name="tags" value="${state.tags.join(" ")}" />
    <textarea name="comment">${state.comment}</textarea>
    <input type="checkbox" name="sync_douban" value="1" ${state.syncToTimeline ? "checked" : ""} />
  </form>`;
}

function renderComments(subject: MockSubject, start = 0, limit = 20) {
  return `
  <html><body>
    <div class="comments">
      ${Array.from({ length: limit }, (_, index) => {
        const number = start + index + 1;
        return `
        <div class="comment-item" data-cid="${subject.doubanId}-${number}">
          <div class="comment-info"><a>短评用户 ${number}</a><span class="comment-time">2026-05-${String((number % 28) + 1).padStart(2, "0")}</span></div>
          <p><span class="short">${subject.title} 的第 ${number} 条短评。</span></p>
          <span class="rating" title="${number % 2 === 0 ? "推荐" : "力荐"}"></span>
          <span class="vote-count">${number}</span>
        </div>`;
      }).join("")}
    </div>
  </body></html>`;
}

function renderSearch(subject: MockSubject) {
  const href = subject.medium === "game" ? `/game/${subject.doubanId}/` : `/${subject.medium}/subject/${subject.doubanId}`;
  return `
  <html><body>
    <article class="search-card">
      <a href="${href}"><img src="${subject.cover}" /></a>
      <h3>${subject.title}</h3>
      <p class="subtitle">${subject.subtitle}</p>
      <p class="meta">${subject.creators} / ${subject.year}</p>
      <span class="rating-value">${subject.rating}</span>
    </article>
  </body></html>`;
}

function renderLibrary(subject: MockSubject, status: ShelfStatus, state: MockRemoteState) {
  if (state.status !== status) {
    return "<html><body></body></html>";
  }
  const href = subject.medium === "game" ? `/game/${subject.doubanId}/` : `/${subject.medium}/subject/${subject.doubanId}`;
  return `
  <html><body>
    <article class="collection-item" data-status="${interestValue(state.status)}">
      <a href="${href}"><img src="${subject.cover}" /></a>
      <h3>${subject.title}</h3>
      <p class="meta">${subject.creators} / ${subject.year}</p>
      <span class="rating" data-rating="${state.rating ?? ""}"></span>
      ${state.comment ? `<span class="comment">${state.comment}</span>` : ""}
      <span class="average-rating" data-average-rating="${subject.rating}"></span>
    </article>
  </body></html>`;
}

function renderGameLibrary(subject: MockSubject, status: ShelfStatus, state: MockRemoteState) {
  if (state.status !== status) {
    return "<html><body></body></html>";
  }
  return `
  <html><body>
    <div class="interest-item">
      <a href="https://www.douban.com/game/${subject.doubanId}/"><img src="${subject.cover}" /></a>
      <div>
        <a href="https://www.douban.com/game/${subject.doubanId}/">${subject.title}</a>
        <div class="meta">${subject.creators} / ${subject.year}</div>
        <span class="rating" data-rating="${state.rating ?? ""}"></span>
        ${state.comment ? `<span class="comment">${state.comment}</span>` : ""}
      </div>
    </div>
  </body></html>`;
}

function renderRanking(subject: MockSubject) {
  const href = subject.medium === "game" ? `/game/${subject.doubanId}/` : `/${subject.medium}/subject/${subject.doubanId}`;
  return `
  <html><body>
    <article class="ranking-card" data-rank="1">
      <a href="${href}"><img src="${subject.cover}" /></a>
      <h3>${subject.title}</h3>
      <p class="meta">${subject.creators} / ${subject.year}</p>
      <span class="rating-value">${subject.rating}</span>
      <p class="blurb">${subject.blurb}</p>
    </article>
  </body></html>`;
}

function renderTop250RankingPage(subject: MockSubject, start = 0) {
  return `
  <html><body>
    ${Array.from({ length: 25 }, (_, index) => {
      const rank = start + index + 1;
      const doubanId = `${subject.doubanId}${String(rank).padStart(3, "0")}`;
      const href = subject.medium === "game" ? `/game/${doubanId}/` : `/${subject.medium}/subject/${doubanId}/`;
      return `
      <article class="ranking-card" data-rank="${rank}">
        <a href="${href}"><img src="${subject.cover}" /></a>
        <h3>${subject.title} ${rank}</h3>
        <p class="meta">${subject.creators} / ${subject.year}</p>
        <span class="rating-value">${subject.rating}</span>
        <p class="blurb">${subject.blurb}</p>
      </article>`;
    }).join("")}
  </body></html>`;
}

function createTimelineState(scope: "following" | "mine", peopleId: string, number: number): MockTimelineState {
  const mediums: Medium[] = ["book", "movie", "music", "game"];
  const subjectMedium = mediums[(number - 1) % mediums.length];
  const actionVariants = ["在读", "读过", "说："] as const;
  const actionText = actionVariants[(number - 1) % actionVariants.length];
  return {
    id: `${scope}-${number}`,
    peopleId,
    author: scope === "mine" ? "ttop5" : number === 1 ? "好友 A" : `好友 ${number}`,
    actionText,
    content: actionText === "说：" ? `今天的内容补一句主观看法 ${number}` : `这次标记记录来自第 ${number} 条动态。`,
    createdAtText: startDateText(number),
    subjectMedium,
    engagements: {
      reply: 2,
      repost: 1,
      like: 5
    },
    liked: number % 2 === 0
  };
}

function startDateText(number: number) {
  const day = String(((number - 1) % 28) + 1).padStart(2, "0");
  return `05-${day}`;
}

function ensureTimelineState(timelineStates: Map<string, MockTimelineState>, scope: "following" | "mine", peopleId: string, number: number) {
  const id = `${scope}-${number}`;
  const existing = timelineStates.get(id);
  if (existing) {
    return existing;
  }
  const created = createTimelineState(scope, peopleId, number);
  timelineStates.set(id, created);
  return created;
}

function ensureTimelineStateById(timelineStates: Map<string, MockTimelineState>, peopleId: string, statusId: string) {
  const existing = timelineStates.get(statusId);
  if (existing) {
    return existing;
  }
  const match = statusId.match(/^(following|mine)-(\d+)$/);
  if (match) {
    return ensureTimelineState(timelineStates, match[1] as "following" | "mine", peopleId, Number(match[2]));
  }
  const created: MockTimelineState = {
    id: statusId,
    peopleId,
    author: "ttop5",
    actionText: "说：",
    content: "补充的默认动态。",
    createdAtText: "05-05",
    subjectMedium: "book",
    engagements: { reply: 0, repost: 0, like: 0 },
    liked: false
  };
  timelineStates.set(statusId, created);
  return created;
}

function renderTimelineActions(status: MockTimelineState, detailMode = false) {
  if (detailMode) {
    return `
      <div class="actions">
        <div class="action-react">
          <a href="javascript:void(0);"
             data-type="status"
             class="${status.liked ? "react-cancel-like" : "react-like"} react-btn"
             data-reaction_type="${status.liked ? 1 : 0}"
             data-object_id="${status.id}">
            <span class="react-text"></span>
            <span class="react-num"></span>
          </a>
        </div>
        <div class="action-reshare">
          <a href="javascript:;" class="reshare-add new-reshare" data-action-type="reshare"></a>
        </div>
        <span>${status.engagements.reply} 回应</span><span>${status.engagements.repost} 转发</span><span>${status.engagements.like} 赞</span>
      </div>`;
  }
  return `
    <div class="timeline-actions">
      <a class="timeline-action ${status.liked ? "timeline-action--liked" : "timeline-action--like"}" href="/j/status/${status.liked ? "unlike" : "like"}?sid=${status.id}" aria-label="${status.liked ? "已赞" : "赞"}"></a>
      <a class="timeline-action timeline-action--reply" href="/j/status/reply?sid=${status.id}" aria-label="回应"></a>
      <a class="timeline-action timeline-action--repost" href="/j/status/repost?sid=${status.id}" aria-label="转发"></a>
      <span>${status.engagements.reply} 回应</span><span>${status.engagements.repost} 转发</span><span>${status.engagements.like} 赞</span>
    </div>`;
}

function renderTimelineStatus(status: MockTimelineState, detailMode = false) {
  const subject = subjects[status.subjectMedium];
  const subjectUrl = status.subjectMedium === "game" ? `/game/${subject.doubanId}/` : `/${status.subjectMedium}/subject/${subject.doubanId}/`;
  return `
    <div class="new-status status-wrapper" data-sid="${status.id}">
      <div class="status-item" data-sid="${status.id}" data-action="${status.actionText}">
        <a href="/people/${status.peopleId}/"><img src="/avatar.jpg" />${status.author}</a>
        <p class="status-saying">${status.author} ${status.actionText}</p>
        <blockquote>${status.content}</blockquote>
        <a href="${subjectUrl}"><img src="${subject.cover}" />${subject.title}</a>
        <a href="/people/${status.peopleId}/status/${status.id}/">${status.createdAtText}</a>
        ${renderTimelineActions(status, detailMode)}
      </div>
      ${
        detailMode
          ? `<div id="comments" class="comment-list"></div>
        <script>
          var _COMMENTS_CONFIG = {
            'api': '/j/status',
            'target': {"kind":3055,"id":"${status.id}","can_add_comment":true},
            'options': {'enable_comment_sync_to_status': true}
          };
        </script>`
          : ""
      }
    </div>`;
}

function renderTimeline(timelineStates: Map<string, MockTimelineState>, scope: "following" | "mine", peopleId = "demo-user", start = 0) {
  const count = start === 0 ? 30 : 10;
  return `
  <html><body>
    ${Array.from({ length: count }, (_, index) => {
      const number = start + index + 1;
      return renderTimelineStatus(ensureTimelineState(timelineStates, scope, peopleId, number));
    }).join("")}
  </body></html>`;
}

function mockBaseUrl(request: express.Request) {
  return `${request.protocol}://${request.get("host")}`;
}

export async function createMockDoubanServer() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  const sentSmsCodes = new Map<string, string>();
  const qrStates = new Map<string, { status: "pending" | "scan" | "login" | "invalid" | "cancel"; polls: number }>();
  let timelineBlocked = false;
  const hasValidCsrf = (request: express.Request) =>
    String(request.headers["x-csrf-token"] ?? "") === String(request.body.ck ?? "");

  const states = new Map<string, MockRemoteState>();
  (Object.values(subjects) as MockSubject[]).forEach((subject) => {
    states.set(`${subject.medium}:${subject.doubanId}`, {
      status: "wish",
      rating: 5,
      comment: "",
      tags: [],
      syncToTimeline: true
    });
  });
  const timelineStates = new Map<string, MockTimelineState>();

  app.get("/", (request, response) => {
    if (timelineBlocked) {
      response.redirect("/misc/sorry");
      return;
    }
    response.send(renderTimeline(timelineStates, "following", "demo-user", Number(request.query.start ?? 0)));
  });

  app.get("/misc/sorry", (_request, response) => {
    response.status(200).send("<html><body>security challenge</body></html>");
  });

  app.get("/passport/login", (_request, response) => {
    response.setHeader("Set-Cookie", ["bid=mock-bid; Path=/"]);
    response.send(`
      <html><body>
        <script>window._CONFIG = {"douban_account":"http://mock.local","supported_countries":"[[&quot;中国&quot;,&quot;China&quot;,&quot;+86&quot;,&quot;CN&quot;],[&quot;美国&quot;,&quot;United States&quot;,&quot;+1&quot;,&quot;US&quot;]]"};</script>
        <div id="account"></div>
      </body></html>
    `);
  });

  app.post("/j/mobile/login/basic", (request, response) => {
    if (!hasValidCsrf(request)) {
      response.status(403).json({ status: "failed", message: "csrf_invalid", localized_message: "请求校验失败" });
      return;
    }
    const account = String(request.body.name ?? "");
    const password = String(request.body.password ?? "");
    if (account === "captcha@example.com") {
      response.json({ status: "failed", message: "captcha_required", description: "需要图形验证" });
      return;
    }
    if (account === "blocked@example.com") {
      response.json({ status: "failed", message: "uncommon_loc_login", description: "需要安全验证" });
      return;
    }
    if (account !== "demo@example.com" || password !== "secret") {
      response.json({ status: "failed", message: "账号或密码错误" });
      return;
    }
    response.setHeader("Set-Cookie", ["dbcl2=mock-dbcl2; Path=/", "ck=mock-ck; Path=/"]);
    response.json({ status: "success", payload: { account } });
  });

  app.post("/j/mobile/login/request_phone_code", (request, response) => {
    if (!hasValidCsrf(request) || String(request.body.analytics ?? "") !== "analytics_log") {
      response.status(403).json({ status: "failed", message: "csrf_invalid", localized_message: "请求校验失败" });
      return;
    }
    const areaCode = String(request.body.area_code ?? "");
    const number = String(request.body.number ?? "");
    if (number === "13800138002") {
      response.json({ status: "failed", message: "captcha_required", description: "需要图形验证" });
      return;
    }
    if (number === "13800138003") {
      response.json({ status: "failed", message: "uncommon_loc_login", description: "需要安全验证" });
      return;
    }
    if (number !== "13800138001") {
      response.json({ status: "failed", message: "invalid_phone", localized_message: "手机号不正确" });
      return;
    }
    sentSmsCodes.set(`${areaCode}${number}`, "246810");
    response.setHeader("Set-Cookie", ["ck=mock-ck; Path=/"]);
    response.json({ status: "success", payload: { areaCode, number } });
  });

  app.post("/j/mobile/login/verify_phone_code", (request, response) => {
    if (!hasValidCsrf(request)) {
      response.status(403).json({ status: "failed", message: "csrf_invalid", localized_message: "请求校验失败" });
      return;
    }
    const areaCode = String(request.body.area_code ?? "");
    const number = String(request.body.number ?? "");
    const code = String(request.body.code ?? "");
    const expectedCode = sentSmsCodes.get(`${areaCode}${number}`);
    if (!expectedCode) {
      response.json({ status: "failed", message: "invalid_phone", localized_message: "请先获取验证码" });
      return;
    }
    if (code !== expectedCode) {
      response.json({ status: "failed", message: "invalid_code", localized_message: "验证码错误" });
      return;
    }
    response.setHeader("Set-Cookie", ["dbcl2=mock-dbcl2; Path=/", "ck=mock-ck; Path=/"]);
    response.json({ status: "success", payload: { account_info: { id: "demo-user", phone: `${areaCode}${number}` }, vtoken: "mock-vtoken" } });
  });

  app.post("/j/mobile/login/qrlogin_code", (request, response) => {
    if (!hasValidCsrf(request)) {
      response.status(403).json({ status: "failed", message: "csrf_invalid", localized_message: "请求校验失败" });
      return;
    }
    const code = `douban-qrlogin|${randomUUID().slice(0, 12)}`;
    qrStates.set(code, { status: "pending", polls: 0 });
    response.json({
      status: "success",
      message: "success",
      description: "处理成功",
      payload: {
        code,
        img: `${mockBaseUrl(request)}/dae/qrgen/${encodeURIComponent(code)}.png`
      }
    });
  });

  app.get("/j/mobile/login/qrlogin_status", (request, response) => {
    const code = String(request.query.code ?? "");
    const state = qrStates.get(code);
    if (!state) {
      response.json({ status: "success", message: "success", description: "处理成功", payload: { login_status: "invalid" } });
      return;
    }

    state.polls += 1;
    if (state.status === "pending" && state.polls >= 2) {
      state.status = "scan";
    }
    if (state.status === "scan" && state.polls >= 4) {
      state.status = "login";
    }

    if (state.status === "login") {
      response.setHeader("Set-Cookie", ["dbcl2=mock-dbcl2; Path=/", "ck=mock-ck; Path=/"]);
    }

    response.json({
      status: "success",
      message: "success",
      description: "处理成功",
      payload: { login_status: state.status }
    });
  });

  app.get("/dae/qrgen/:name", (_request, response) => {
    response.type("image/png").send(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  app.get("/mine/", (_request, response) => {
    response.send(`<html><body><a href="/people/demo-user/">demo-user</a></body></html>`);
  });

  app.get("/people/:peopleId/", (request, response) => {
    response.send(`<html><body><a href="/people/${request.params.peopleId}/">${request.params.peopleId}</a></body></html>`);
  });

  app.get("/people/:peopleId/status/:statusId/", (request, response) => {
    if (timelineBlocked) {
      response.redirect("/misc/sorry");
      return;
    }
    const state = ensureTimelineStateById(timelineStates, request.params.peopleId, request.params.statusId);
    response.send(`<html><body>${renderTimelineStatus(state, true)}</body></html>`);
  });

  app.get("/people/:peopleId/statuses", (request, response) => {
    if (timelineBlocked) {
      response.redirect("/misc/sorry");
      return;
    }
    response.send(renderTimeline(timelineStates, "mine", request.params.peopleId, Number(request.query.start ?? 0)));
  });

  app.get("/images/:name", (_request, response) => {
    response.type("image/jpeg").send(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  });

  app.get("/search", (request, response) => {
    const medium = request.query.medium as Medium;
    response.send(renderSearch(subjects[medium]));
  });

  app.get("/j/search_subjects", (_request, response) => {
    response.json({
      subjects: [
        {
          id: subjects.movie.doubanId,
          title: subjects.movie.title,
          url: `https://movie.douban.com/subject/${subjects.movie.doubanId}/`,
          cover: subjects.movie.cover,
          rate: subjects.movie.rating
        }
      ]
    });
  });

  app.get("/movie/board/:board", (request, response) => {
    const board = String(request.params.board);
    if (board === "hot-movies" || board === "hot-tv") {
      response.send(renderRanking(subjects.movie));
      return;
    }
    response.send(renderRanking(subjects.movie));
  });

  app.get("/:medium/board/:board", (request, response) => {
    const medium = request.params.medium as Medium;
    const board = String(request.params.board);
    const start = Number(request.query.start ?? 0);
    if (board === "top250") {
      response.send(renderTop250RankingPage(subjects[medium], start));
      return;
    }
    response.send(renderRanking(subjects[medium]));
  });

  app.get("/:medium/mine", (request, response) => {
    const medium = request.params.medium as Medium;
    const statusQuery = String(request.query.status ?? "wish");
    const status = statusQuery === "collect" ? "done" : statusQuery === "do" ? "doing" : "wish";
    const subject = subjects[medium];
    const state = states.get(`${medium}:${subject.doubanId}`)!;
    response.send(renderLibrary(subject, status, state));
  });

  app.get("/people/:peopleId/games", (request, response) => {
    const action = String(request.query.action ?? "wish");
    const status = action === "collect" ? "done" : action === "do" ? "doing" : "wish";
    const subject = subjects.game;
    const state = states.get(`game:${subject.doubanId}`)!;
    response.send(renderGameLibrary(subject, status, state));
  });

  app.get("/:medium/subject/:doubanId", (request, response) => {
    const medium = request.params.medium as Medium;
    const subject = subjects[medium];
    const state = states.get(`${medium}:${subject.doubanId}`)!;
    response.send(renderDetail(subject, state));
  });

  app.get("/:medium/j/subject/:doubanId/interest", (request, response) => {
    const medium = request.params.medium as Medium;
    const subject = subjects[medium];
    const state = states.get(`${medium}:${subject.doubanId}`)!;
    response.json({ popular_tags: [], html: renderInterestEditor(subject, state) });
  });

  app.get("/:medium/subject/:doubanId/comments", (request, response) => {
    const medium = request.params.medium as Medium;
    const subject = subjects[medium];
    response.send(renderComments(subject, Number(request.query.start ?? 0), Number(request.query.limit ?? 20)));
  });

  app.get("/game/:doubanId/", (_request, response) => {
    const subject = subjects.game;
    const state = states.get(`game:${subject.doubanId}`)!;
    response.send(renderDetail(subject, state));
  });

  app.get("/game/:doubanId/comments", (request, response) => {
    response.send(renderComments(subjects.game, Number(request.query.start ?? 0), Number(request.query.limit ?? 20)));
  });

  app.post("/j/status/like", (request, response) => {
    const state = ensureTimelineStateById(timelineStates, "demo-user", String(request.body.sid ?? request.body.status_id ?? request.query.sid ?? ""));
    if (!state.liked) {
      state.liked = true;
      state.engagements.like += 1;
    }
    response.json({ ok: true });
  });

  app.post("/j/status/unlike", (request, response) => {
    const state = ensureTimelineStateById(timelineStates, "demo-user", String(request.body.sid ?? request.body.status_id ?? request.query.sid ?? ""));
    if (state.liked) {
      state.liked = false;
      state.engagements.like = Math.max(0, state.engagements.like - 1);
    }
    response.json({ ok: true });
  });

  app.post("/rexxar/api/v2/status/:statusId/react", (request, response) => {
    const state = ensureTimelineStateById(timelineStates, "demo-user", request.params.statusId);
    const reactionType = Number(request.body.reaction_type ?? 0);
    if (reactionType === 1 && !state.liked) {
      state.liked = true;
      state.engagements.like += 1;
    }
    if (reactionType === 0 && state.liked) {
      state.liked = false;
      state.engagements.like = Math.max(0, state.engagements.like - 1);
    }
    response.json({ reaction_type: state.liked ? 1 : 0 });
  });

  app.post("/j/status/reply", (request, response) => {
    const state = ensureTimelineStateById(timelineStates, "demo-user", String(request.body.sid ?? request.body.status_id ?? request.query.sid ?? ""));
    if (String(request.body.reply_text ?? "").trim().length > 0) {
      state.engagements.reply += 1;
    }
    response.json({ ok: true });
  });

  app.post("/j/status/:statusId/add_comment", (request, response) => {
    const state = ensureTimelineStateById(timelineStates, "demo-user", request.params.statusId);
    if (String(request.body.rv_comment ?? request.body.text ?? "").trim().length > 0) {
      state.engagements.reply += 1;
    }
    response.json({ code: 0, data: { id: `comment-${state.engagements.reply}`, text: request.body.rv_comment ?? request.body.text ?? "" } });
  });

  app.post("/j/status/repost", (request, response) => {
    const state = ensureTimelineStateById(timelineStates, "demo-user", String(request.body.sid ?? request.body.status_id ?? request.query.sid ?? ""));
    state.engagements.repost += 1;
    response.json({ ok: true });
  });

  app.post("/j/status/reshare", (request, response) => {
    const state = ensureTimelineStateById(timelineStates, "demo-user", String(request.body.sid ?? request.body.status_id ?? request.query.sid ?? ""));
    state.engagements.repost += 1;
    response.json({ r: 0, ok: true });
  });

  app.post("/:medium/subject/:doubanId/interest", (request, response) => {
    const medium = request.params.medium as Medium;
    const subject = subjects[medium];
    states.set(`${medium}:${subject.doubanId}`, {
      status: request.body.interest === "collect" ? "done" : request.body.interest === "do" ? "doing" : "wish",
      rating: request.body.rating ? Number(request.body.rating) : null,
      comment: String(request.body.comment ?? ""),
      tags: String(request.body.tags ?? "")
        .split(/\s+/)
        .map((tag) => tag.trim())
        .filter(Boolean),
      syncToTimeline: String(request.body.sync_douban ?? "1") !== "0"
    });
    response.send(renderDetail(subject, states.get(`${medium}:${subject.doubanId}`)!));
  });

  app.post("/:medium/j/subject/:doubanId/interest", (request, response) => {
    const medium = request.params.medium as Medium;
    const subject = subjects[medium];
    states.set(`${medium}:${subject.doubanId}`, {
      status: request.body.interest === "collect" ? "done" : request.body.interest === "do" ? "doing" : "wish",
      rating: request.body.rating ? Number(request.body.rating) : null,
      comment: String(request.body.comment ?? ""),
      tags: String(request.body.tags ?? "")
        .split(/\s+/)
        .map((tag) => tag.trim())
        .filter(Boolean),
      syncToTimeline: String(request.body.sync_douban ?? "1") !== "0"
    });
    response.json({ ok: true });
  });

  app.post("/game/:doubanId/interest", (request, response) => {
    const subject = subjects.game;
    states.set(`game:${subject.doubanId}`, {
      status: request.body.interest === "collect" ? "done" : request.body.interest === "do" ? "doing" : "wish",
      rating: request.body.rating ? Number(request.body.rating) : null,
      comment: String(request.body.comment ?? ""),
      tags: String(request.body.tags ?? "")
        .split(/\s+/)
        .map((tag) => tag.trim())
        .filter(Boolean),
      syncToTimeline: String(request.body.sync_douban ?? "1") !== "0"
    });
    response.send(renderDetail(subject, states.get(`game:${subject.doubanId}`)!));
  });

  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start mock douban server");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    readState(medium: Medium) {
      const subject = subjects[medium];
      return states.get(`${medium}:${subject.doubanId}`)!;
    },
    readTimelineState(statusId: string) {
      return timelineStates.get(statusId) ?? null;
    },
    setTimelineBlocked(blocked: boolean) {
      timelineBlocked = blocked;
    },
    setQrState(code: string, status: "pending" | "scan" | "login" | "invalid" | "cancel") {
      const current = qrStates.get(code);
      if (current) {
        current.status = status;
      }
    },
    setState(medium: Medium, nextState: Partial<MockRemoteState>) {
      const subject = subjects[medium];
      const key = `${medium}:${subject.doubanId}`;
      states.set(key, { ...states.get(key)!, ...nextState });
    },
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}
