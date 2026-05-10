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

  it("parses selected status and rating from interest form", () => {
    const html = loadFixture("movie.detail.html");
    expect(parseInterestSelection(html, "https://example.test/movie/subject/1292052")).toEqual({
      status: "wish",
      rating: 5
    });
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
});
