import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthMeResponse } from "../../../../packages/shared/src";
import * as api from "../api";
import { AppContextProvider } from "../app-context";
import { SettingsPage } from "./settings-page";

function createAuthMeResponse(status: AuthMeResponse["sessionStatus"]["status"]): AuthMeResponse {
  if (status === "valid") {
    return {
      authenticated: true,
      user: {
        id: "user-1",
        peopleId: "demo-user",
        displayName: "Demo",
        avatarUrl: null,
        ipLocation: "Shanghai",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      sessionStatus: {
        status,
        peopleId: "demo-user",
        displayName: "Demo",
        avatarUrl: null,
        ipLocation: "Shanghai",
        lastCheckedAt: null,
        lastError: null
      }
    };
  }

  return {
    authenticated: false,
    user: null,
    sessionStatus: {
      status,
      peopleId: status === "invalid" ? "demo-user" : null,
      displayName: status === "invalid" ? "Demo" : null,
      avatarUrl: null,
      ipLocation: "Shanghai",
      lastCheckedAt: null,
      lastError: status === "invalid" ? "需要重新登录" : null
    }
  };
}

function renderSettingsPage(authMe: AuthMeResponse, initialEntry = "/settings") {
  vi.spyOn(api, "getAuthMe").mockResolvedValue(authMe);
  vi.spyOn(api, "logoutDoubanSession").mockResolvedValue({
    status: "missing"
  });
  vi.spyOn(api, "triggerManualSync").mockResolvedValue({
    id: "job-1",
    userId: "user-1",
    type: "manual_pull",
    status: "completed",
    payload: {},
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    errorMessage: null
  });
  vi.spyOn(api, "getSyncJob").mockResolvedValue({
    id: "job-1",
    userId: "user-1",
    type: "manual_pull",
    status: "completed",
    payload: {},
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    errorMessage: null
  });

  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <AppContextProvider>
          <Routes>
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/login" element={<div>登录页</div>} />
          </Routes>
        </AppContextProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("SettingsPage", () => {
  it("renders only session, menu, and sync panels without any login forms", async () => {
    renderSettingsPage(createAuthMeResponse("missing"));

    expect(await screen.findByText("豆瓣会话状态")).toBeInTheDocument();
    expect(screen.getByText("菜单显示")).toBeInTheDocument();
    expect(screen.getByText("同步任务")).toBeInTheDocument();
    expect(screen.getByText("当前没有可用豆瓣会话，请前往登录页完成登录后再同步个人数据。")).toBeInTheDocument();

    expect(screen.queryByText("代理豆瓣登录")).not.toBeInTheDocument();
    expect(screen.queryByText("如何获取 Cookie 并在 PWA 里登录")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "短信验证登录" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Cookie")).not.toBeInTheDocument();
  });

  it("keeps current account and logout controls when the session is valid", async () => {
    renderSettingsPage(createAuthMeResponse("valid"));

    expect(await screen.findByText("当前账号：Demo")).toBeInTheDocument();
    expect(screen.queryByText("如需切换账号或刷新会话，请前往登录页。")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "退出登录" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "立即同步" })).toBeEnabled();
  });

  it("keeps the sync gate clickable and sends unauthenticated users to the login page", async () => {
    renderSettingsPage(createAuthMeResponse("invalid"));

    expect(await screen.findByText("需要重新登录")).toBeInTheDocument();
    const loginButton = screen.getByRole("button", { name: "请先登录" });
    expect(loginButton).toBeEnabled();
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);

    fireEvent.click(loginButton);

    await waitFor(() => {
      expect(screen.getByText("登录页")).toBeInTheDocument();
    });
  });
});
