import express from "express";
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

function renderTimeline(scope: "following" | "mine", peopleId = "demo-user", start = 0) {
  const count = start === 0 ? 30 : 10;
  return `
  <html><body>
    ${Array.from({ length: count }, (_, index) => {
      const number = start + index + 1;
      const id = `${scope}-${number}`;
      const author = scope === "mine" ? "?" : number === 1 ? "?? A" : `?? ${number}`;
      return `
      <div class="new-status status-wrapper" data-sid="${id}">
        <div class="status-item" data-sid="${id}" data-action="????">
          <a href="/people/${peopleId}/"><img src="/avatar.jpg" />${author}</a>
          <p class="status-saying">${author} ????</p>
          <blockquote>??????????????????????????????${number}</blockquote>
          <a href="/movie/subject/${subjects.movie.doubanId}/"><img src="${subjects.movie.cover}" />${subjects.movie.title}</a>
          <a href="/people/${peopleId}/status/${id}/">?? ${String(12 + (number % 10)).padStart(2, "0")}:00</a>
          <span>2 ??</span><span>1 ??</span><span>5 ?</span>
        </div>
      </div>`;
    }).join("")}
  </body></html>`;
}

export async function createMockDoubanServer() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));

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

  app.get("/", (request, response) => {
    response.send(renderTimeline("following", "demo-user", Number(request.query.start ?? 0)));
  });

  app.get("/mine/", (_request, response) => {
    response.send(`<html><body><a href="/people/demo-user/">demo-user</a></body></html>`);
  });

  app.get("/people/:peopleId/", (request, response) => {
    response.send(`<html><body><a href="/people/${request.params.peopleId}/">${request.params.peopleId}</a></body></html>`);
  });

  app.get("/people/:peopleId/statuses", (request, response) => {
    response.send(renderTimeline("mine", request.params.peopleId, Number(request.query.start ?? 0)));
  });

  app.get("/images/:name", (_request, response) => {
    response.type("image/jpeg").send(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  });

  app.get("/search", (request, response) => {
    const medium = request.query.medium as Medium;
    response.send(renderSearch(subjects[medium]));
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
    setState(medium: Medium, nextState: Partial<MockRemoteState>) {
      const subject = subjects[medium];
      const key = `${medium}:${subject.doubanId}`;
      states.set(key, { ...states.get(key)!, ...nextState });
    },
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}
