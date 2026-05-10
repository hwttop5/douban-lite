import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, type AppContext } from "../src/server";
import { createMockDoubanServer } from "./mock-douban";

describe("End-to-end sync flow", () => {
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
    await agent.post("/api/settings/douban-session/import").send({ cookie: "dbcl2=fake; ck=test;", peopleId: "demo-user" }).expect(200);
    await agent.post("/api/sync/pull").send({}).expect(200);
    await context.sync.drainQueue();
  });

  afterEach(async () => {
    context.close();
    await mock.close();
    rmSync(dbFile, { force: true });
  });

  it("updates local state, pushes to douban, and reconciles", async () => {
    const updateResponse = await agent
      .post("/api/library/movie/1292052/state")
      .send({ status: "done", rating: 4 })
      .expect(200);

    expect(updateResponse.body.userItem.syncState).toBe("pending_push");

    await context.sync.drainQueue();

    const detail = await agent.get("/api/subjects/movie/1292052").expect(200);
    expect(detail.body.userItem.status).toBe("done");
    expect(detail.body.userItem.rating).toBe(4);
    expect(detail.body.userItem.syncState).toBe("synced");

    const remoteState = mock.readState("movie");
    expect(remoteState.status).toBe("done");
    expect(remoteState.rating).toBe(4);
  });
});
