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
      doubanAccountsBaseUrl: mock.url,
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

  it("reports deployment mode and scheduler state from /health", async () => {
    const standardHealth = await request(context.app).get("/health").expect(200);
    expect(standardHealth.body).toEqual({
      status: "ok",
      app: "douban-lite",
      schedulerEnabled: false,
      deploymentMode: "standard"
    });

    const demoDbFile = join(tmpdir(), `douban-lite-demo-${randomUUID()}.db`);
    const demoContext = createApp({
      databaseFile: demoDbFile,
      dataDir: tmpdir(),
      doubanAccountsBaseUrl: mock.url,
      doubanPublicBaseUrl: mock.url,
      doubanWebBaseUrl: mock.url,
      disableAutoSync: true,
      deploymentMode: "render-demo",
      allowedOrigin: null
    });

    try {
      const demoHealth = await request(demoContext.app).get("/health").expect(200);
      expect(demoHealth.body).toEqual({
        status: "ok",
        app: "douban-lite",
        schedulerEnabled: false,
        deploymentMode: "render-demo"
      });
    } finally {
      demoContext.close();
      rmSync(demoDbFile, { force: true });
    }
  });

  it("imports a douban session and performs a manual sync including games", async () => {
    await agent.post("/api/auth/douban").send({ cookie: "dbcl2=fake; ck=test;", peopleId: "demo-user" }).expect(200);

    const jobResponse = await agent.post("/api/sync/pull").send({}).expect(200);
    expect(jobResponse.body.type).toBe("manual_pull");

    await context.sync.drainQueue();

    const overview = await agent.get("/api/me/overview").expect(200);
    expect(overview.body.sessionStatus.status).toBe("valid");
    expect(overview.body.totals.length).toBeGreaterThan(0);
    expect(overview.body.totals.find((item: { medium: string; status: string; count: number }) => item.medium === "movie" && item.status === "wish")?.count).toBe(1);

    const movieLibrary = await agent.get("/api/library?medium=movie&status=wish").expect(200);
    expect(movieLibrary.body.items[0].subject.doubanId).toBe("1292052");
    expect(movieLibrary.body.pagination.total).toBe(1);

    const gameLibrary = await agent.get("/api/library?medium=game&status=wish").expect(200);
    expect(gameLibrary.body.items[0].subject.doubanId).toBe("30347464");
  });

  it("drops synced medium rows that disappear from the remote collection on the next pull", async () => {
    await agent.post("/api/auth/douban").send({ cookie: "dbcl2=fake; ck=test;", peopleId: "demo-user" }).expect(200);

    await agent.post("/api/sync/pull").send({}).expect(200);
    await context.sync.drainQueue();

    let movieLibrary = await agent.get("/api/library?medium=movie&status=wish").expect(200);
    expect(movieLibrary.body.items).toHaveLength(1);

    mock.setState("movie", { status: undefined as unknown as "wish" });

    await agent.post("/api/sync/pull").send({}).expect(200);
    await context.sync.drainQueue();

    const overview = await agent.get("/api/me/overview").expect(200);
    expect(overview.body.totals.some((item: { medium: string; count: number }) => item.medium === "movie" && item.count > 0)).toBe(false);

    movieLibrary = await agent.get("/api/library?medium=movie&status=wish").expect(200);
    expect(movieLibrary.body.items).toHaveLength(0);
  });

  it("reads overview totals from the remote profile page", async () => {
    await agent.post("/api/auth/douban").send({ cookie: "dbcl2=fake; ck=test;", peopleId: "demo-user" }).expect(200);

    const overview = await agent.get("/api/me/overview").expect(200);
    expect(overview.body.totals).toEqual(
      expect.arrayContaining([
        { medium: "movie", status: "wish", count: 1 },
        { medium: "movie", status: "doing", count: 0 },
        { medium: "movie", status: "done", count: 0 },
        { medium: "book", status: "wish", count: 1 },
        { medium: "music", status: "wish", count: 1 },
        { medium: "game", status: "wish", count: 1 }
      ])
    );
  });

  it("backfills book done ratings from subject detail when the collection page is unavailable", async () => {
    await agent.post("/api/auth/douban").send({ cookie: "dbcl2=fake; ck=test;", peopleId: "demo-user" }).expect(200);
    mock.setState("book", { status: "done", rating: null, comment: "" });
    await agent.post("/api/sync/pull").send({}).expect(200);
    await context.sync.drainQueue();

    const client = (context.sync as any).client as {
      getUserCollection: (...args: any[]) => Promise<any>;
      getSubjectDetail: (...args: any[]) => Promise<any>;
    };
    const originalGetUserCollection = client.getUserCollection.bind(client);
    const originalGetSubjectDetail = client.getSubjectDetail.bind(client);

    client.getUserCollection = async (medium, status, page, cookie, peopleId) => {
      if (medium === "book" && status === "done") {
        throw new Error("Douban request failed: 403 Forbidden");
      }
      return originalGetUserCollection(medium, status, page, cookie, peopleId);
    };

    client.getSubjectDetail = async (medium, doubanId, cookie) => {
      const result = await originalGetSubjectDetail(medium, doubanId, cookie);
      if (medium === "book") {
        return {
          ...result,
          userSelection: {
            status: "done",
            rating: 4,
            comment: "Recovered from detail"
          }
        };
      }
      return result;
    };

    const library = await agent.get("/api/library?medium=book&status=done").expect(200);
    expect(library.body.items).toHaveLength(1);
    expect(library.body.items[0].rating).toBe(4);
    expect(library.body.items[0].comment).toBe("Recovered from detail");
  });

  it("keeps the cached public average rating when the collection page only exposes the user rating", async () => {
    await agent.post("/api/auth/douban").send({ cookie: "dbcl2=fake; ck=test;", peopleId: "demo-user" }).expect(200);

    const detail = await agent.get("/api/subjects/game/30347464").expect(200);
    expect(detail.body.subject.averageRating).toBe(9.6);

    await agent.post("/api/sync/pull").send({}).expect(200);
    await context.sync.drainQueue();

    const library = await agent.get("/api/library?medium=game&status=wish").expect(200);
    expect(library.body.items).toHaveLength(1);
    expect(library.body.items[0].rating).toBe(5);
    expect(library.body.items[0].subject.averageRating).toBe(9.6);
  });

  it("backfills the public average rating from subject detail when the collection page omits it", async () => {
    await agent.post("/api/auth/douban").send({ cookie: "dbcl2=fake; ck=test;", peopleId: "demo-user" }).expect(200);

    const library = await agent.get("/api/library?medium=game&status=wish").expect(200);
    expect(library.body.items).toHaveLength(1);
    expect(library.body.items[0].subject.averageRating).toBe(9.6);
  });

  it("logs in through the douban proxy login flow", async () => {
    const started = await agent.post("/api/auth/douban/proxy/start").send({}).expect(200);
    expect(started.body.status).toBe("created");
    expect(started.body.loginAttemptId).toBeTruthy();

    const login = await agent
      .post("/api/auth/douban/proxy/password")
      .send({ loginAttemptId: started.body.loginAttemptId, account: "demo@example.com", password: "secret" })
      .expect(200);

    expect(login.body.status).toBe("claimed");
    expect(login.body.user.peopleId).toBe("demo-user");
    expect(login.body.sessionStatus.status).toBe("valid");
    expect(login.body.cookie).toBeUndefined();

    const overview = await agent.get("/api/me/overview").expect(200);
    expect(overview.body.sessionStatus.status).toBe("valid");
  });

  it("returns QR-first proxy login config", async () => {
    const configResponse = await agent.get("/api/auth/douban/proxy/config").expect(200);
    expect(configResponse.body.enabled).toBe(true);
    expect(configResponse.body.availableModes).toEqual(["qr", "sms", "password"]);
    expect(configResponse.body.defaultCountryCode).toBe("CN");
    expect(configResponse.body.supportedCountries[0]).toMatchObject({
      label: "中国",
      englishLabel: "China",
      areaCode: "+86",
      countryCode: "CN"
    });
  });

  it("logs in through the QR proxy login flow", async () => {
    const started = await agent.post("/api/auth/douban/proxy/start").send({}).expect(200);

    const qrStarted = await agent
      .post("/api/auth/douban/proxy/qr/start")
      .send({ loginAttemptId: started.body.loginAttemptId })
      .expect(200);

    expect(qrStarted.body.status).toBe("created");
    expect(qrStarted.body.verificationMethod).toBe("qr");
    expect(qrStarted.body.nextAction).toBe("poll_qr_status");
    expect(qrStarted.body.qrCode).toContain("douban-qrlogin|");
    expect(qrStarted.body.qrCodeImageUrl).toContain("/dae/qrgen/");
    expect(qrStarted.body.qrStatus).toBe("pending");

    const pending = await agent.get(`/api/auth/douban/proxy/${started.body.loginAttemptId}/status`).expect(200);
    expect(pending.body.qrStatus).toBe("pending");

    const scanned = await agent.get(`/api/auth/douban/proxy/${started.body.loginAttemptId}/status`).expect(200);
    expect(scanned.body.status).toBe("needs_verification");
    expect(scanned.body.qrStatus).toBe("scan");

    await agent.get(`/api/auth/douban/proxy/${started.body.loginAttemptId}/status`).expect(200);
    const claimed = await agent.get(`/api/auth/douban/proxy/${started.body.loginAttemptId}/status`).expect(200);
    expect(claimed.body.status).toBe("claimed");
    expect(claimed.body.user.peopleId).toBe("demo-user");
    expect(claimed.body.sessionStatus.status).toBe("valid");

    const overview = await agent.get("/api/me/overview").expect(200);
    expect(overview.body.sessionStatus.status).toBe("valid");
  });

  it("reports QR cancellation and expiry without creating a session", async () => {
    const started = await agent.post("/api/auth/douban/proxy/start").send({}).expect(200);
    const qrStarted = await agent
      .post("/api/auth/douban/proxy/qr/start")
      .send({ loginAttemptId: started.body.loginAttemptId })
      .expect(200);

    mock.setQrState(qrStarted.body.qrCode, "cancel");

    const cancelled = await agent.get(`/api/auth/douban/proxy/${started.body.loginAttemptId}/status`).expect(200);
    expect(cancelled.body.status).toBe("blocked");
    expect(cancelled.body.errorCode).toBe("qr_cancelled");

    const expiredAttempt = await agent.post("/api/auth/douban/proxy/start").send({}).expect(200);
    const expiredQr = await agent
      .post("/api/auth/douban/proxy/qr/start")
      .send({ loginAttemptId: expiredAttempt.body.loginAttemptId })
      .expect(200);

    mock.setQrState(expiredQr.body.qrCode, "invalid");

    const expired = await agent.get(`/api/auth/douban/proxy/${expiredAttempt.body.loginAttemptId}/status`).expect(200);
    expect(expired.body.status).toBe("expired");
    expect(expired.body.errorCode).toBe("qr_expired");

    await agent.get("/api/me/overview").expect(401);
  });

  it("logs in through the SMS proxy login flow", async () => {
    const started = await agent.post("/api/auth/douban/proxy/start").send({}).expect(200);

    const sent = await agent
      .post("/api/auth/douban/proxy/sms/send")
      .send({ loginAttemptId: started.body.loginAttemptId, countryCode: "CN", phoneNumber: "13800138001" })
      .expect(200);

    expect(sent.body.status).toBe("needs_verification");
    expect(sent.body.verificationMethod).toBe("sms");
    expect(sent.body.nextAction).toBe("enter_sms_code");
    expect(sent.body.retryAfterSeconds).toBeGreaterThan(0);
    expect(sent.body.maskedTarget).toContain("138");

    const verified = await agent
      .post("/api/auth/douban/proxy/sms/verify")
      .send({ loginAttemptId: started.body.loginAttemptId, smsCode: "246810" })
      .expect(200);

    expect(verified.body.status).toBe("claimed");
    expect(verified.body.user.peopleId).toBe("demo-user");
    expect(verified.body.sessionStatus.status).toBe("valid");

    const overview = await agent.get("/api/me/overview").expect(200);
    expect(overview.body.sessionStatus.status).toBe("valid");
  });

  it("keeps failed proxy login attempts from creating a session", async () => {
    const started = await agent.post("/api/auth/douban/proxy/start").send({}).expect(200);

    const login = await agent
      .post("/api/auth/douban/proxy/password")
      .send({ loginAttemptId: started.body.loginAttemptId, account: "demo@example.com", password: "wrong" })
      .expect(200);

    expect(login.body.status).toBe("failed");
    expect(login.body.errorCode).toBe("invalid_credentials");
    await agent.get("/api/me/overview").expect(401);
  });

  it("keeps SMS attempts reusable after a wrong code and enforces cooldown", async () => {
    const started = await agent.post("/api/auth/douban/proxy/start").send({}).expect(200);

    await agent
      .post("/api/auth/douban/proxy/sms/send")
      .send({ loginAttemptId: started.body.loginAttemptId, countryCode: "CN", phoneNumber: "13800138001" })
      .expect(200);

    const cooldown = await agent
      .post("/api/auth/douban/proxy/sms/send")
      .send({ loginAttemptId: started.body.loginAttemptId, countryCode: "CN", phoneNumber: "13800138001" })
      .expect(200);

    expect(cooldown.body.status).toBe("needs_verification");
    expect(cooldown.body.errorCode).toBe("sms_cooldown");
    expect(cooldown.body.nextAction).toBe("wait_retry");

    const wrongCode = await agent
      .post("/api/auth/douban/proxy/sms/verify")
      .send({ loginAttemptId: started.body.loginAttemptId, smsCode: "000000" })
      .expect(200);

    expect(wrongCode.body.status).toBe("needs_verification");
    expect(wrongCode.body.errorCode).toBe("invalid_sms_code");
    expect(wrongCode.body.nextAction).toBe("enter_sms_code");

    await agent.get("/api/me/overview").expect(401);
  });

  it("returns an expired status when the proxy login attempt has timed out", async () => {
    const expiredMock = await createMockDoubanServer();
    const expiredDbFile = join(tmpdir(), `douban-lite-expired-${randomUUID()}.db`);
    const expiredContext = createApp({
      databaseFile: expiredDbFile,
      dataDir: tmpdir(),
      doubanAccountsBaseUrl: expiredMock.url,
      doubanPublicBaseUrl: expiredMock.url,
      doubanWebBaseUrl: expiredMock.url,
      doubanProxyLoginAttemptTtlMinutes: 0,
      disableAutoSync: true,
      allowedOrigin: null
    });
    const expiredAgent = request.agent(expiredContext.app);

    try {
      const started = await expiredAgent.post("/api/auth/douban/proxy/start").send({}).expect(200);
      expect(started.body.status).toBe("created");

      const expired = await expiredAgent
        .post("/api/auth/douban/proxy/sms/send")
        .send({ loginAttemptId: started.body.loginAttemptId, countryCode: "CN", phoneNumber: "13800138001" })
        .expect(200);

      expect(expired.body.status).toBe("expired");
      expect(expired.body.errorCode).toBe("attempt_expired");
      await expiredAgent.get("/api/me/overview").expect(401);
    } finally {
      expiredContext.close();
      await expiredMock.close();
      rmSync(expiredDbFile, { force: true });
    }
  });

  it("reports proxy login verification and security challenge states", async () => {
    const captchaAttempt = await agent.post("/api/auth/douban/proxy/start").send({}).expect(200);
    const captcha = await agent
      .post("/api/auth/douban/proxy/password")
      .send({ loginAttemptId: captchaAttempt.body.loginAttemptId, account: "captcha@example.com", password: "secret" })
      .expect(200);
    expect(captcha.body.status).toBe("blocked");
    expect(captcha.body.errorCode).toBe("needs_captcha");

    const blockedAttempt = await agent.post("/api/auth/douban/proxy/start").send({}).expect(200);
    const blocked = await agent
      .post("/api/auth/douban/proxy/password")
      .send({ loginAttemptId: blockedAttempt.body.loginAttemptId, account: "blocked@example.com", password: "secret" })
      .expect(200);
    expect(blocked.body.status).toBe("blocked");
    expect(blocked.body.errorCode).toBe("security_challenge");
  });

  it("blocks unsupported SMS verification challenges", async () => {
    const captchaAttempt = await agent.post("/api/auth/douban/proxy/start").send({}).expect(200);
    const captcha = await agent
      .post("/api/auth/douban/proxy/sms/send")
      .send({ loginAttemptId: captchaAttempt.body.loginAttemptId, countryCode: "CN", phoneNumber: "13800138002" })
      .expect(200);
    expect(captcha.body.status).toBe("blocked");
    expect(captcha.body.errorCode).toBe("needs_captcha");

    const blockedAttempt = await agent.post("/api/auth/douban/proxy/start").send({}).expect(200);
    const blocked = await agent
      .post("/api/auth/douban/proxy/sms/send")
      .send({ loginAttemptId: blockedAttempt.body.loginAttemptId, countryCode: "CN", phoneNumber: "13800138003" })
      .expect(200);
    expect(blocked.body.status).toBe("blocked");
    expect(blocked.body.errorCode).toBe("security_challenge");
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

  it("toggles subject comment votes", async () => {
    await agent.post("/api/auth/douban").send({ cookie: "dbcl2=fake; ck=test;", peopleId: "demo-user" }).expect(200);

    const voted = await agent.post("/api/subjects/game/30347464/comments/vote").send({ commentId: "vote-target" }).expect(200);
    expect(voted.body).toMatchObject({
      commentId: "vote-target",
      votes: 13,
      userVoteState: "voted"
    });

    const unvoted = await agent.post("/api/subjects/game/30347464/comments/vote").send({ commentId: "vote-target" }).expect(200);
    expect(unvoted.body).toMatchObject({
      commentId: "vote-target",
      votes: 12,
      userVoteState: "not_voted"
    });
  });

  it("toggles legacy subject comment votes when the page omits a cancel url", async () => {
    await agent.post("/api/auth/douban").send({ cookie: "dbcl2=fake; ck=test;", peopleId: "demo-user" }).expect(200);

    const voted = await agent.post("/api/subjects/music/30347464/comments/vote").send({ commentId: "legacy-vote-target" }).expect(200);
    expect(voted.body).toMatchObject({
      commentId: "legacy-vote-target",
      votes: 13,
      userVoteState: "voted"
    });

    const unvoted = await agent.post("/api/subjects/music/30347464/comments/vote").send({ commentId: "legacy-vote-target" }).expect(200);
    expect(unvoted.body).toMatchObject({
      commentId: "legacy-vote-target",
      votes: 12,
      userVoteState: "not_voted"
    });
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
    expect(following.body.nextStart).toBe(20);

    const mine = await agent.get("/api/timeline?scope=mine").expect(200);
    expect(mine.body.scope).toBe("mine");
    expect(mine.body.items[0].authorName.length).toBeGreaterThan(0);
  });

  it("serves timeline pagination pages", async () => {
    await agent.post("/api/auth/douban").send({ cookie: "dbcl2=fake; ck=test;", peopleId: "demo-user" }).expect(200);

    const firstPage = await agent.get("/api/timeline?scope=following").expect(200);
    const nextPage = await agent.get("/api/timeline?scope=following&start=20").expect(200);
    expect(firstPage.body.items[0].id).toBe("following-1");
    expect(firstPage.body.items.at(-1)?.id).toBe("following-20");
    expect(nextPage.body.start).toBe(20);
    expect(nextPage.body.items.length).toBeGreaterThan(0);
    expect(nextPage.body.items[0].id).toBe("following-21");
    expect(nextPage.body.hasMore).toBe(false);
  });

  it("skips a gapped follow-feed page when a later page still has timeline items", async () => {
    await agent.post("/api/auth/douban").send({ cookie: "dbcl2=fake; ck=test;", peopleId: "demo-user" }).expect(200);
    mock.setTimelineNextStart(20, 40);
    mock.setTimelineNextStart(40, 60);
    mock.setTimelineGapStarts([40]);

    try {
      const secondPage = await agent.get("/api/timeline?scope=following&start=20").expect(200);
      expect(secondPage.body.items[0].id).toBe("following-21");
      expect(secondPage.body.hasMore).toBe(true);
      expect(secondPage.body.nextStart).toBe(40);

      const recoveredPage = await agent.get("/api/timeline?scope=following&start=40").expect(200);
      expect(recoveredPage.body.start).toBe(40);
      expect(recoveredPage.body.items[0].id).toBe("following-61");
      expect(recoveredPage.body.truncated).not.toBe(true);
      expect(recoveredPage.body.hasMore).toBe(false);
      expect(recoveredPage.body.nextStart).toBeNull();
    } finally {
      mock.setTimelineGapStarts([]);
      mock.setTimelineNextStart(20, null);
      mock.setTimelineNextStart(40, null);
    }
  });

  it("likes, replies to, and reposts timeline statuses", async () => {
    await agent.post("/api/auth/douban").send({ cookie: "dbcl2=fake; ck=test;", peopleId: "demo-user" }).expect(200);

    const timeline = await agent.get("/api/timeline?scope=following").expect(200);
    const item = timeline.body.items[0];
    expect(item.detailUrl).toBeTruthy();

    const comments = await agent.post(`/api/timeline/${item.id}/comments`).send({ detailUrl: item.detailUrl }).expect(200);
    expect(comments.body.statusId).toBe(item.id);
    expect(comments.body.comments).toHaveLength(2);
    expect(comments.body.comments[0].content.length).toBeGreaterThan(0);

    const liked = await agent.post(`/api/timeline/${item.id}/like`).send({ detailUrl: item.detailUrl }).expect(200);
    expect(["liked", "not_liked"]).toContain(liked.body.userLikeState);
    const afterLike = mock.readTimelineState(item.id);
    expect(afterLike).not.toBeNull();
    const replyBaseline = afterLike!.engagements.reply;
    const repostBaseline = afterLike!.engagements.repost;

    const replied = await agent
      .post(`/api/timeline/${item.id}/reply`)
      .send({ detailUrl: item.detailUrl, text: "这条动态我来回复一下。" })
      .expect(200);
    expect(replied.body.engagements.find((entry: { label: string; count: number | null }) => entry.label === "回应")?.count).toBe(replyBaseline + 1);

    const reposted = await agent.post(`/api/timeline/${item.id}/repost`).send({ detailUrl: item.detailUrl, text: "转一下。" }).expect(200);
    expect(reposted.body.engagements.find((entry: { label: string; count: number | null }) => entry.label === "转发")?.count).toBe(repostBaseline + 1);
  });

  it("validates timeline action payloads", async () => {
    await agent.post("/api/auth/douban").send({ cookie: "dbcl2=fake; ck=test;", peopleId: "demo-user" }).expect(200);

    await agent.post("/api/timeline/following-1/comments").send({ detailUrl: "not-a-url" }).expect(400);
    await agent.post("/api/timeline/following-1/like").send({ detailUrl: "not-a-url" }).expect(400);
    await agent.post("/api/timeline/following-1/reply").send({ detailUrl: "https://example.com/status", text: "" }).expect(400);
  });

  it("returns stale timeline snapshots and rejects timeline actions when Douban blocks the session", async () => {
    await agent.post("/api/auth/douban").send({ cookie: "dbcl2=fake; ck=test;", peopleId: "demo-user" }).expect(200);

    const timeline = await agent.get("/api/timeline?scope=following").expect(200);
    const item = timeline.body.items[0];
    mock.setTimelineBlocked(true);

    const stale = await agent.get("/api/timeline?scope=following").expect(200);
    expect(stale.body.stale).toBe(true);
    expect(stale.body.items[0].id).toBe(item.id);

    for (const [path, payload] of [
      [`/api/timeline/${item.id}/like`, { detailUrl: item.detailUrl }],
      [`/api/timeline/${item.id}/comments`, { detailUrl: item.detailUrl }],
      [`/api/timeline/${item.id}/reply`, { detailUrl: item.detailUrl, text: "reply" }],
      [`/api/timeline/${item.id}/repost`, { detailUrl: item.detailUrl, text: "repost" }]
    ] as const) {
      const failed = await agent.post(path).send(payload).expect(401);
      expect(failed.body.error).toContain("Cookie");
    }

    const auth = await agent.get("/api/auth/me").expect(200);
    expect(auth.body.sessionStatus.status).toBe("invalid");
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
    await request(context.app).post("/api/timeline/following-1/comments").send({ detailUrl: "https://www.douban.com/people/demo-user/status/following-1/" }).expect(401);
    await request(context.app).post("/api/timeline/following-1/like").send({ detailUrl: "https://www.douban.com/people/demo-user/status/following-1/" }).expect(401);
    await request(context.app).post("/api/sync/pull").send({}).expect(401);
  });
});
