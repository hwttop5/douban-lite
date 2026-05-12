import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthMeResponse } from "../../../../packages/shared/src";
import * as api from "../api";
import { AppContextProvider } from "../app-context";
import { SettingsPage } from "./settings-page";

function renderSettingsPage(authMe: AuthMeResponse) {
  vi.spyOn(api, "getAuthMe").mockResolvedValue(authMe);

  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <AppContextProvider>
          <SettingsPage />
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
  it("shows the full cookie login guide when the session is missing", async () => {
    renderSettingsPage({
      authenticated: false,
      user: null,
      sessionStatus: {
        status: "missing",
        peopleId: null,
        displayName: null,
        avatarUrl: null,
        ipLocation: null,
        lastCheckedAt: null,
        lastError: null
      }
    });

    expect(await screen.findByText("如何获取 Cookie 并在 PWA 中登录")).toBeInTheDocument();
    expect(screen.getByText("获取 Cookie")).toBeInTheDocument();
    expect(screen.getByText("在 PWA 中登录")).toBeInTheDocument();
    expect(screen.getByText("Cookie 失效后重新登录")).toBeInTheDocument();
    expect(screen.getByText("安全提示")).toBeInTheDocument();
    expect(screen.getByLabelText("Cookie")).toBeInTheDocument();
  });

  it("hides the full guide and shows a concise hint when the session is valid", async () => {
    renderSettingsPage({
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
        status: "valid",
        peopleId: "demo-user",
        displayName: "Demo",
        avatarUrl: null,
        ipLocation: "Shanghai",
        lastCheckedAt: null,
        lastError: null
      }
    });

    expect(await screen.findByText("豆瓣会话状态")).toBeInTheDocument();
    expect(screen.queryByText("如何获取 Cookie 并在 PWA 中登录")).not.toBeInTheDocument();
    expect(screen.getByText("如豆瓣会话失效，重新复制最新 Cookie 并再次导入即可。")).toBeInTheDocument();
    expect(screen.queryByLabelText("Cookie")).not.toBeInTheDocument();
  });

  it("shows the full guide again when the session is invalid", async () => {
    renderSettingsPage({
      authenticated: false,
      user: null,
      sessionStatus: {
        status: "invalid",
        peopleId: "demo-user",
        displayName: "Demo",
        avatarUrl: null,
        ipLocation: "Shanghai",
        lastCheckedAt: null,
        lastError: "需要重新登录"
      }
    });

    expect(await screen.findByText("如何获取 Cookie 并在 PWA 中登录")).toBeInTheDocument();
    expect(screen.getByText("当前没有可用会话，或会话已失效。")).toBeInTheDocument();
    expect(screen.getByText("需要重新登录")).toBeInTheDocument();
  });
});
