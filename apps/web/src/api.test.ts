import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, getAuthMe, importDoubanSession, logoutDoubanSession } from "./api";

describe("auth-related API routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses session-safe endpoints instead of NextAuth-style auth paths", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ authenticated: false, user: null, sessionStatus: { status: "missing", peopleId: null, displayName: null, avatarUrl: null, lastCheckedAt: null, lastError: null } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);

    await importDoubanSession("dbcl2=fake; ck=test;");
    await logoutDoubanSession();
    await getAuthMe();

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/settings/douban-session/import",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/settings/douban-session/logout",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/session/me", expect.any(Object));
  });

  it("maps HTML error pages to a proxy-target diagnostic", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html><body>Bad Request</body></html>", {
        status: 400,
        headers: { "content-type": "text/html; charset=utf-8" }
      }))
    );

    await expect(getAuthMe()).rejects.toMatchObject({
      message: "douban-lite API 没有连到当前前端，请启动项目自带 API，或检查 VITE_API_BASE_URL / VITE_API_PROXY_TARGET。",
      status: 400
    } satisfies Pick<ApiError, "message" | "status">);
  });
});
