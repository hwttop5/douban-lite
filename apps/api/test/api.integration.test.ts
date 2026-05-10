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
  });

  afterEach(async () => {
    context.close();
    await mock.close();
    rmSync(dbFile, { force: true });
  });

  it("imports a douban session and performs a manual sync including games", async () => {
    await agent
      .post("/api/settings/douban-session/import")
      .send({ cookie: "dbcl2=fake; ck=test;", peopleId: "demo-user" })
      .expect(200);

    const jobResponse = await agent.post("/api/sync/pull").send({}).expect(200);
    expect(jobResponse.body.type).toBe("manual_pull");

    await context.sync.drainQueue();

    const overview = await agent.get("/api/me/overview").expect(200);
    expect(overview.body.sessionStatus.status).toBe("valid");
    expect(overview.body.totals.length).toBeGreaterThan(0);

    const movieLibrary = await agent.get("/api/library?medium=movie&status=wish").expect(200);
    expect(movieLibrary.body.items[0].subject.title).toBe("肖申克的救赎");

    const gameLibrary = await agent.get("/api/library?medium=game&status=wish").expect(200);
    expect(gameLibrary.body.items[0].subject.title).toBe("塞尔达传说：王国之泪");
  });

  it("serves public search, detail, and ranking data", async () => {
    await agent
      .post("/api/settings/douban-session/import")
      .send({ cookie: "dbcl2=fake; ck=test;", peopleId: "demo-user" })
      .expect(200);

    const search = await agent.get("/api/subjects/search?medium=movie&q=shawshank").expect(200);
    expect(search.body.items[0].doubanId).toBe("1292052");

    const detail = await agent.get("/api/subjects/movie/1292052").expect(200);
    expect(detail.body.subject.summary).not.toContain("report");
    expect(detail.body.subject.summary).not.toContain("createReportButton");
    expect(detail.body.subject.title).toBe("肖申克的救赎");
    expect(detail.body.comments[0].content).toBe("这是一条公开短评。");

    const ranking = await agent.get("/api/rankings?medium=movie&board=showing").expect(200);
    expect(ranking.body.items[0].subject.title).toBe("肖申克的救赎");
  });

  it("serves paginated subject comments", async () => {
    await agent
      .post("/api/settings/douban-session/import")
      .send({ cookie: "dbcl2=fake; ck=test;", peopleId: "demo-user" })
      .expect(200);

    const comments = await agent.get("/api/subjects/movie/1292052/comments?start=20&limit=10").expect(200);
    expect(comments.body.start).toBe(20);
    expect(comments.body.items).toHaveLength(10);
    expect(comments.body.items[0].content).toContain("第 21 条短评");
    expect(comments.body.nextStart).toBe(30);
    expect(comments.body.hasMore).toBe(true);
  });

  it("proxies allowed image assets", async () => {
    const image = await agent.get(`/api/image?url=${encodeURIComponent(`${mock.url}/images/movie-1292052.jpg`)}`).expect(200);
    expect(image.headers["content-type"]).toContain("image/jpeg");
    expect(image.body.length).toBeGreaterThan(0);
  });

  it("serves following and mine timelines", async () => {
    await agent
      .post("/api/settings/douban-session/import")
      .send({ cookie: "dbcl2=fake; ck=test;", peopleId: "demo-user" })
      .expect(200);

    const following = await agent.get("/api/timeline?scope=following").expect(200);
    expect(following.body.scope).toBe("following");
    expect(following.body.items[0].authorName).toBe("好友 A");
    expect(following.body.items[0].engagements).toContainEqual({ label: "赞", count: 5 });

    const mine = await agent.get("/api/timeline?scope=mine").expect(200);
    expect(mine.body.scope).toBe("mine");
    expect(mine.body.items[0].authorName).toBe("我");
  });
});
