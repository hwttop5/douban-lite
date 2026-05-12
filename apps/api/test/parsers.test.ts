import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { boardCatalog, mediums } from "../../../packages/shared/src";
import {
  parseAuthToken,
  parseDoubanProfile,
  parseInterestSelection,
  parseRanking,
  parseSearchResults,
  parseSubjectComments,
  parseSubjectDetail,
  parseSubjectDetailExtras,
  parseTimeline,
  parseUserCollection
} from "../src/douban/parsers";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

const expectedIds = {
  movie: "1292052",
  book: "6082808",
  music: "1417590",
  game: "30347464"
} as const;

function loadFixture(name: string) {
  return readFileSync(join(fixtureDir, name), "utf8");
}

describe("Douban parsers", () => {
  for (const medium of mediums) {
    it(`parses ${medium} search results`, () => {
      const items = parseSearchResults(loadFixture(`${medium}.search.html`), `https://example.test/${medium}/search`, medium);
      expect(items[0].doubanId).toBe(expectedIds[medium]);
      expect(items[0].title.length).toBeGreaterThan(0);
    });

    it(`parses ${medium} detail page`, () => {
      const subject = parseSubjectDetail(loadFixture(`${medium}.detail.html`), `https://example.test/${medium}/subject/${expectedIds[medium]}`, medium);
      expect(subject.doubanId).toBe(expectedIds[medium]);
      expect(subject.title.length).toBeGreaterThan(0);
      expect(subject.averageRating).not.toBeNull();
    });

    it(`parses ${medium} collection page`, () => {
      const result = parseUserCollection(loadFixture(`${medium}.library.html`), `https://example.test/${medium}/people/demo/wish?page=1`, medium, "wish");
      expect(result.items).toHaveLength(1);
      expect(result.items[0].subject.doubanId).toBe(expectedIds[medium]);
      expect(result.items[0].status).toBe("wish");
      expect(result.items[0].comment).toBeNull();
    });

    it(`parses ${medium} ranking page`, () => {
      const board = boardCatalog[medium][0];
      const items = parseRanking(loadFixture(`${medium}.ranking.html`), `https://example.test${board.path}`, medium, board);
      expect(items).toHaveLength(1);
      expect(items[0].subject.doubanId).toBe(expectedIds[medium]);
    });
  }

  it("parses auth token from detail page", () => {
    const html = loadFixture("movie.detail.html");
    expect(parseAuthToken(html)).toBe("test-ck");
  });

  it("parses movie detail extras", () => {
    const extras = parseSubjectDetailExtras(
      `
      <div id="celebrities">
        <h2><a href="/subject/37116612/celebrities">Cast and crew</a></h2>
        <ul>
          <li class="celebrity">
            <a href="/celebrity/1/"><div class="avatar" style="background-image:url(/images/staff.jpg)"></div></a>
            <div class="info">
              <span class="name"><a href="/celebrity/1/">Director One</a></span>
              <span class="role" title="Director">Director</span>
            </div>
          </li>
        </ul>
      </div>
      <a class="related-pic-video" href="/trailer/1/" title="Official Trailer" style="background-image:url(/images/trailer.jpg)">
        <span class="type-title">Trailer</span>
      </a>
      <a href="/photos/photo/1/"><img src="/images/still.jpg" alt="Still One" /></a>
      <div id="recommendations">
        <h2><a href="/subject/37116612/recommendations">Recommendations</a></h2>
        <dl>
          <dt><a href="/subject/1292720/"><img src="/images/forrest.jpg" alt="Forrest Gump" /></a></dt>
          <dd><a href="/subject/1292720/">Forrest Gump</a><span class="rating_nums">9.5</span></dd>
        </dl>
      </div>
      `,
      "https://movie.douban.com/subject/37116612/",
      "movie",
      "37116612"
    );

    expect(extras.staff).toHaveLength(1);
    expect(extras.staff[0]).toMatchObject({ name: "Director One", role: "Director" });
    expect(extras.media.videos[0]?.url).toBe("https://movie.douban.com/trailer/1/");
    expect(extras.media.images[0]?.url).toBe("https://movie.douban.com/photos/photo/1/");
    expect(extras.relatedSubjects[0]?.doubanId).toBe("1292720");
    expect(extras.sectionLinks.map((item) => item.key)).toEqual(expect.arrayContaining(["related", "staff", "videos", "images"]));
  });

  it("parses music detail extras", () => {
    const extras = parseSubjectDetailExtras(
      `
      <div class="track-list">
        <ul class="track-items indent">
          <li>1. Track One</li>
          <li>2. Track Two</li>
        </ul>
      </div>
      <div id="db-rec-section">
        <h2><a href="/subject/30401866/recommend">People also liked</a></h2>
        <dl>
          <dt><a href="/subject/20427949/"><img src="/images/music.jpg" alt="Related Album" /></a></dt>
          <dd><a href="/subject/20427949/">Related Album</a></dd>
        </dl>
      </div>
      `,
      "https://music.douban.com/subject/30401866/",
      "music",
      "30401866"
    );

    expect(extras.trackList).toEqual(["Track One", "Track Two"]);
    expect(extras.relatedSubjects[0]?.doubanId).toBe("20427949");
    expect(extras.sectionLinks.find((item) => item.key === "related")?.url).toBe("https://music.douban.com/subject/30401866/recommend");
  });

  it("parses book detail extras", () => {
    const extras = parseSubjectDetailExtras(
      `
      <div id="dir_37817685_short">Prologue<br/>Chapter One<br/>...</div>
      <div id="dir_37817685_full">Prologue<br/>Chapter One<br/>Chapter Two<br/>Epilogue<br/></div>
      <div id="db-rec-section">
        <dl>
          <dt><a href="/subject/1003078/"><img src="/images/book.jpg" alt="Related Book" /></a></dt>
          <dd><a href="/subject/1003078/">Related Book</a></dd>
        </dl>
      </div>
      `,
      "https://book.douban.com/subject/37817685/",
      "book",
      "37817685"
    );

    expect(extras.tableOfContents).toEqual(["Prologue", "Chapter One", "Chapter Two", "Epilogue"]);
    expect(extras.relatedSubjects[0]?.doubanId).toBe("1003078");
  });

  it("parses game detail extras", () => {
    const extras = parseSubjectDetailExtras(
      `
      <div class="mod">
        <h2>Game videos</h2>
        <ul>
          <li class="video-mini">
            <a class="video" href="/game/21355730/video/1/"><img src="/images/game-video.jpg" alt="Gameplay video" /></a>
            <a class="title" href="/game/21355730/video/1/"><span>Gameplay video</span></a>
          </li>
        </ul>
      </div>
      <div class="mod">
        <h2>Game photos</h2>
        <ul>
          <li><a href="/game/21355730/photo/1/"><img src="/images/game-photo.jpg" alt="Screenshot" /></a></li>
        </ul>
      </div>
      <div id="db-rec-section">
        <dl>
          <dt><a href="/game/26791492/"><img src="/images/game-related.jpg" alt="Related Game" /></a></dt>
          <dd><a href="/game/26791492/">Related Game</a></dd>
        </dl>
      </div>
      `,
      "https://www.douban.com/game/21355730/",
      "game",
      "21355730"
    );

    expect(extras.media.videos[0]?.url).toBe("https://www.douban.com/game/21355730/video/1/");
    expect(extras.media.images[0]?.url).toBe("https://www.douban.com/game/21355730/photo/1/");
    expect(extras.relatedSubjects[0]?.doubanId).toBe("26791492");
    expect(extras.sectionLinks.map((item) => item.key)).toEqual(expect.arrayContaining(["related", "videos", "images"]));
  });

  it("parses selected status and rating from interest form", () => {
    const html = loadFixture("movie.detail.html");
    expect(parseInterestSelection(html, "https://example.test/movie/subject/1292052")).toEqual({
      status: "wish",
      rating: 5,
      comment: null
    });
  });

  it("parses the current user's comment from interest form", () => {
    const selection = parseInterestSelection(
      `
      <form data-interest-form action="/j/subject/interest" method="POST">
        <input type="hidden" name="interest" value="collect" />
        <select name="rating"><option value="4" selected>4</option></select>
        <textarea name="comment">这次主要看系统设计。</textarea>
      </form>
      `,
      "https://movie.douban.com/subject/1292052/"
    );

    expect(selection).toEqual({
      status: "done",
      rating: 4,
      comment: "这次主要看系统设计。"
    });
  });

  it("parses the user's collection comment from collection items", () => {
    const result = parseUserCollection(
      `
      <article class="collection-item" data-status="collect">
        <a href="https://movie.douban.com/subject/1292052/"><img src="/cover.jpg" /></a>
        <h3>肖申克的救赎</h3>
        <p class="meta">1994 / Frank Darabont</p>
        <span class="rating" data-rating="4"></span>
        <span class="comment">喔喔喔喔喔</span>
      </article>
      `,
      "https://movie.douban.com/people/demo/collect",
      "movie",
      "done"
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0].comment).toBe("喔喔喔喔喔");
  });

  it("cleans script and report noise from subject summary", () => {
    const subject = parseSubjectDetail(
      `
      <html><body>
        <h1>测试电影</h1>
        <div class="rating-value">8.8</div>
        <div id="link-report">
          干净简介。
          <style>.report { color: #bbb; }</style>
          <script>window.createReportButton({ text: "投诉" })</script>
        </div>
      </body></html>
      `,
      "https://movie.douban.com/subject/1000001/",
      "movie"
    );

    expect(subject.summary).toBe("干净简介。");
  });

  it("parses paginated subject comments", () => {
    const comments = parseSubjectComments(
      `
      <div class="comment-item" data-cid="c1">
        <div class="comment-info"><a>用户 A</a><span class="comment-time">2026-05-10</span></div>
        <p><span class="short">第一条短评。</span></p>
        <span class="rating" title="力荐"></span>
        <span class="vote-count">12</span>
      </div>
      <div class="comment-item" data-cid="c2">
        <div class="comment-info"><a>用户 B</a><span class="comment-time">2026-05-11</span></div>
        <p><span class="short">第二条短评。</span></p>
        <span class="rating" title="推荐"></span>
        <span class="vote-count">7</span>
      </div>
      `,
      20
    );

    expect(comments).toHaveLength(2);
    expect(comments[0]).toMatchObject({ id: "c1", author: "用户 A", content: "第一条短评。", rating: "力荐", votes: 12 });
  });

  it("parses profile name and avatar without edit controls", () => {
    const profile = parseDoubanProfile(
      `
      <div id="db-usr-profile">
        <div class="pic"><img src="/avatar.jpg" alt="Demo User" /></div>
        <div class="info">
          <h1>
            Demo User
            <div id="edit_signature">(<a>编辑</a>)</div>
          </h1>
        </div>
      </div>
      `,
      "https://www.douban.com/people/demo/"
    );

    expect(profile.displayName).toBe("Demo User");
    expect(profile.avatarUrl).toBe("https://www.douban.com/avatar.jpg");
  });

  it("parses music homepage artist boards", () => {
    const html = `
      <div class="popular-artists section">
        <ul class="header">
          <li class="artists-tab">本周流行音乐人</li>
          <li class="new-artists-tab">上升最快音乐人</li>
        </ul>
        <div class="artists">
          <div class="artist-item">
            <a class="artist-photo" href="https://site.douban.com/weekly/">
              <div class="artist-photo-img" style="background-image:url('https://img.example.test/weekly.jpg')"></div>
            </a>
            <a class="title primary-link" href="https://site.douban.com/weekly/">Weekly Artist</a>
            <p class="genre">电子 Electronica</p>
          </div>
        </div>
        <div class="new-artists">
          <div class="artist-item">
            <a class="artist-photo" href="https://site.douban.com/rising/">
              <div class="artist-photo-img" style="background-image:url('https://img.example.test/rising.jpg')"></div>
            </a>
            <a class="title primary-link" href="https://site.douban.com/rising/">Rising Artist</a>
            <p class="genre">摇滚 Rock</p>
          </div>
        </div>
      </div>
    `;

    const weekly = parseRanking(html, "https://music.douban.com/", "music", boardCatalog.music[0]);
    const rising = parseRanking(html, "https://music.douban.com/", "music", boardCatalog.music[1]);

    expect(weekly).toHaveLength(1);
    expect(weekly[0].subject.title).toBe("Weekly Artist");
    expect(weekly[0].subject.coverUrl).toBe("https://img.example.test/weekly.jpg");
    expect(rising).toHaveLength(1);
    expect(rising[0].subject.title).toBe("Rising Artist");
    expect(rising[0].subject.summary).toBe("摇滚 Rock");
  });

  it("parses timeline items with engagement text", () => {
    const items = parseTimeline(
      `
      <div class="new-status status-wrapper" data-sid="s1">
        <div class="status-item" data-sid="s1" data-action="看过电影">
          <a href="/people/demo-user/"><img src="/avatar.jpg" />好友 A</a>
          <p class="status-saying">好友 A 看过电影</p>
          <blockquote>很喜欢这个结尾。</blockquote>
          <a href="/movie/subject/1292052/"><img src="/cover.jpg" />肖申克的救赎</a>
          <a href="/people/demo-user/status/s1/">今天 12:00</a>
          <span>2 回应</span><span>1 转发</span><span>5 赞</span>
        </div>
      </div>
      `,
      "https://www.douban.com/"
    );
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("s1");
    expect(items[0].authorName).toBe("好友 A");
    expect(items[0].subjectTitle).toBe("肖申克的救赎");
    expect(items[0].engagements).toEqual([
      { label: "回应", count: 2 },
      { label: "转发", count: 1 },
      { label: "赞", count: 5 }
    ]);
  });

  it("strips trailing engagement text from timeline body and preserves display order", () => {
    const items = parseTimeline(
      `
      <div class="new-status status-wrapper" data-sid="s-tail">
        <div class="status-item" data-sid="s-tail">
          <a href="/people/demo-user/"><img src="/avatar.jpg" />Jun</a>
          <p class="status-saying">Jun 说：</p>
          <blockquote>北海道三天之旅结束了，绕渡岛半岛、羊蹄山、支笏洞爷一圈自驾。 回应 赞 (6) 转发 (2)</blockquote>
          <a href="/people/demo-user/status/s-tail/">5月3日</a>
        </div>
      </div>
      `,
      "https://www.douban.com/"
    );

    expect(items).toHaveLength(1);
    expect(items[0].content).toBe("北海道三天之旅结束了，绕渡岛半岛、羊蹄山、支笏洞爷一圈自驾。");
    expect(items[0].engagements).toEqual([
      { label: "回应", count: null },
      { label: "赞", count: 6 },
      { label: "转发", count: 2 }
    ]);
  });

  it("ignores inline script payloads in timeline content", () => {
    const items = parseTimeline(
      `
      <div class="new-status status-wrapper" data-sid="s2">
        <div class="status-item" data-sid="s2" data-action="玩过">
          <a href="/people/demo-user/"><img src="/avatar.jpg" />好友 B</a>
          <p class="status-saying">好友 B 玩过</p>
          <blockquote>北海道三天之旅结束了，绕渡岛半岛、羊蹄山、支笏洞爷一圈自驾。</blockquote>
          <script>
            (function () {
              var currentScript = document.currentScript;
              var photos = [{"image":{"normal":{"url":"https://img3.doubanio.com/view/group_topic/l/public/p1.jpg"}}}];
              currentScript.parentElement.appendChild(document.createElement('div'));
            })();
          </script>
          <a href="/game/33398281/"><img src="/cover.jpg" />剑星</a>
          <a href="/people/demo-user/status/s2/">5月3日</a>
        </div>
      </div>
      `,
      "https://www.douban.com/"
    );

    expect(items).toHaveLength(1);
    expect(items[0].content).toContain("北海道三天之旅结束了");
    expect(items[0].content).not.toContain("currentScript");
    expect(items[0].content).not.toContain("photos");
  });
  it("treats image-only statuses as photo posts instead of linked subjects", () => {
    const items = parseTimeline(
      `
      <div class="new-status status-wrapper" data-sid="s3">
        <div class="status-item" data-sid="s3">
          <a href="/people/demo-user/"><img src="/avatar.jpg" />Friend C</a>
          <p class="status-saying">Friend C said</p>
          <blockquote>Trip wrap-up with photos.</blockquote>
          <script>
            const photos = [{"image":{"normal":{"url":"https://img3.doubanio.com/view/group_topic/l/public/p1.jpg"}}}];
          </script>
          <a href="/people/demo-user/status/s3/">May 3</a>
        </div>
      </div>
      `,
      "https://www.douban.com/"
    );

    expect(items).toHaveLength(1);
    expect(items[0].subjectTitle).toBeNull();
    expect(items[0].subjectUrl).toBeNull();
    expect(items[0].subjectCoverUrl).toBeNull();
    expect(items[0].photoUrls).toEqual(["https://img3.doubanio.com/view/group_topic/l/public/p1.jpg"]);
    expect(items[0].content).toContain("Trip wrap-up with photos.");
  });
});
