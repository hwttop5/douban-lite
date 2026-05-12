import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, type AppContext } from "../src/server";
import { createMockDoubanServer } from "./mock-douban";

describe("API integration", () => {
  let context: AppContext;
  let dbFile: string;
  let mock: Awaited<ReturnType<typeof createMockDoubanServer>>;
  let agent: ReturnType<typeof request.agent>;
  let secondAgent: ReturnType<typeof request.agent>;

  beforeEach(async () => {
    mock = await createMockDoubanServer();
    dbFile = join(tmpdir(), `douban-lite-${randomUUID()}.db`);
    context = createApp({
      databaseFile: dbFile,
      dataDir: tmpdir(),
      doubanPublicBaseUrl: mock.url,
      doubanWebBaseUrl: mock.url,
      disableAutoSync: true,
      allowedOrigin: null
    });
    agent = request.agent(context.app);
    secondAgent = request.agent(context.app);
  });

  afterEach(async () => {
    context.close();
    await mock.close();
    rmSync(dbFile, { force: true });
  });

  it("imports a douban session and performs a manual sync including games", async () => {
    await agent.post("/api/auth/douban").send({ cookie: "dbcl2=fake; ck=test;", peopleId: "demo-user" }).expect(200);

    const jobResponse = await agent.post("/api/sync/pull").send({}).expect(200);
    expect(jobResponse.body.type).toBe("manual_pull");

    await context.sync.drainQueue();

    const overview = await agent.get("/api/me/overview").expect(200);
    expect(overview.body.sessionStatus.status).toBe("valid");
    expect(overview.body.totals.length).toBeGreaterThan(0);

    const movieLibrary = await agent.get("/api/library?medium=movie&status=wish").expect(200);
    expect(movieLibrary.body.items[0].subject.doubanId).toBe("1292052");

    const gameLibrary = await agent.get("/api/library?medium=game&status=wish").expect(200);
    expect(gameLibrary.body.items[0].subject.doubanId).toBe("30347464");
  });

  it("serves public search, detail, and ranking data", async () => {
    await agent.post("/api/auth/douban").send({ cookie: "dbcl2=fake; ck=test;", peopleId: "demo-user" }).expect(200);

    const search = await agent.get("/api/subjects/search?medium=movie&q=shawshank").expect(200);
    expect(search.body.items[0].doubanId).toBe("1292052");

    const detail = await agent.get("/api/subjects/movie/1292052").expect(200);
    expect(detail.body.subject.summary).not.toContain("report");
    expect(detail.body.subject.summary).not.toContain("createReportButton");
    expect(detail.body.subject.doubanId).toBe("1292052");
    expect(detail.body.comments[0].content.length).toBeGreaterThan(0);
    expect(detail.body.staff.length).toBeGreaterThan(0);
    expect(detail.body.media.videos.length).toBeGreaterThan(0);
    expect(detail.body.media.images.length).toBeGreaterThan(0);
    expect(detail.body.relatedSubjects.length).toBeGreaterThan(0);

    const musicDetail = await agent.get("/api/subjects/music/1417590").expect(200);
    expect(musicDetail.body.trackList.length).toBeGreaterThan(0);
    expect(musicDetail.body.relatedSubjects.length).toBeGreaterThan(0);

    const bookDetail = await agent.get("/api/subjects/book/6082808").expect(200);
    expect(bookDetail.body.tableOfContents.length).toBeGreaterThan(0);
    expect(bookDetail.body.relatedSubjects.length).toBeGreaterThan(0);

    const gameDetail = await agent.get("/api/subjects/game/30347464").expect(200);
    expect(gameDetail.body.media.videos.length).toBeGreaterThan(0);
    expect(gameDetail.body.media.images.length).toBeGreaterThan(0);
    expect(gameDetail.body.relatedSubjects.length).toBeGreaterThan(0);

    const ranking = await agent.get("/api/rankings?medium=movie&board=hot-movies").expect(200);
    expect(ranking.body.items.length).toBeGreaterThan(0);
    expect(ranking.body.items[0].subject.title.length).toBeGreaterThan(0);
  });

  it("fetches and stores complete top250 rankings", async () => {
    await agent.post("/api/auth/douban").send({ cookie: "dbcl2=fake; ck=test;", peopleId: "demo-user" }).expect(200);

    const ranking = await agent.get("/api/rankings?medium=book&board=top250").expect(200);
    expect(ranking.body.items).toHaveLength(250);
    expect(ranking.body.items[0].rank).toBe(1);
    expect(ranking.body.items[249].rank).toBe(250);

    const cached = await agent.get("/api/rankings?medium=book&board=top250").expect(200);
    expect(cached.body.items).toHaveLength(250);
  });

  it("serves paginated subject comments", async () => {
    await agent.post("/api/auth/douban").send({ cookie: "dbcl2=fake; ck=test;", peopleId: "demo-user" }).expect(200);

    const comments = await agent.get("/api/subjects/movie/1292052/comments?start=20&limit=10").expect(200);
    expect(comments.body.start).toBe(20);
    expect(comments.body.items).toHaveLength(10);
    expect(comments.body.items[0].content.length).toBeGreaterThan(0);
    expect(comments.body.nextStart).toBe(30);
    expect(comments.body.hasMore).toBe(true);
  });

  it("proxies allowed image assets", async () => {
    const image = await agent.get(`/api/image?url=${encodeURIComponent(`${mock.url}/images/movie-1292052.jpg`)}`).expect(200);
    expect(image.headers["content-type"]).toContain("image/jpeg");
    expect(image.body.length).toBeGreaterThan(0);
  });

  it("serves following and mine timelines", async () => {
    await agent.post("/api/auth/douban").send({ cookie: "dbcl2=fake; ck=test;", peopleId: "demo-user" }).expect(200);

    const following = await agent.get("/api/timeline?scope=following").expect(200);
    expect(following.body.scope).toBe("following");
    expect(following.body.items[0].authorName.length).toBeGreaterThan(0);
    expect(following.body.hasMore).toBe(true);

    const mine = await agent.get("/api/timeline?scope=mine").expect(200);
    expect(mine.body.scope).toBe("mine");
    expect(mine.body.items[0].authorName.length).toBeGreaterThan(0);
  });

  it("serves timeline pagination pages", async () => {
    await agent.post("/api/auth/douban").send({ cookie: "dbcl2=fake; ck=test;", peopleId: "demo-user" }).expect(200);

    const nextPage = await agent.get("/api/timeline?scope=following&start=20").expect(200);
    expect(nextPage.body.start).toBe(20);
    expect(nextPage.body.items.length).toBeGreaterThan(0);
    expect(nextPage.body.hasMore).toBe(false);
  });

  it("isolates personal state between users", async () => {
    await agent.post("/api/auth/douban").send({ cookie: "dbcl2=fake-a; ck=test-a;", peopleId: "demo-user-a" }).expect(200);
    await secondAgent.post("/api/auth/douban").send({ cookie: "dbcl2=fake-b; ck=test-b;", peopleId: "demo-user-b" }).expect(200);

    await agent.post("/api/library/movie/1292052/state").send({ status: "done", rating: 5 }).expect(200);
    await secondAgent.post("/api/library/movie/1292052/state").send({ status: "wish", rating: null }).expect(200);
    await context.sync.drainQueue();

    const firstDetail = await agent.get("/api/subjects/movie/1292052").expect(200);
    const secondDetail = await secondAgent.get("/api/subjects/movie/1292052").expect(200);
    expect(firstDetail.body.userItem.status).toBe("done");
    expect(firstDetail.body.userItem.rating).toBe(5);
    expect(secondDetail.body.userItem.status).toBe("wish");
    expect(secondDetail.body.userItem.rating).toBe(null);
  });

  it("returns 401 for personal endpoints without auth", async () => {
    await request(context.app).get("/api/me/overview").expect(401);
    await request(context.app).get("/api/timeline?scope=following").expect(401);
    await request(context.app).post("/api/sync/pull").send({}).expect(401);
  });
});
