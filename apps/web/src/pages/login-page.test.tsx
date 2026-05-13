import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthMeResponse, DoubanProxyLoginConfigResponse } from "../../../../packages/shared/src";
import * as api from "../api";
import { LoginPage } from "./login-page";

const defaultProxyConfig: DoubanProxyLoginConfigResponse = {
  enabled: true,
  supportedCountries: [
    {
      label: "中国",
      englishLabel: "China",
      areaCode: "+86",
      countryCode: "CN"
    }
  ],
  defaultCountryCode: "CN",
  availableModes: ["sms", "password"]
};

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

function renderLoginPage({
  initialEntry = "/login",
  authMe = createAuthMeResponse("missing")
}: {
  initialEntry?: string;
  authMe?: AuthMeResponse;
} = {}) {
  vi.spyOn(api, "getAuthMe").mockResolvedValue(authMe);
  vi.spyOn(api, "getDoubanProxyLoginConfig").mockResolvedValue(defaultProxyConfig);
  vi.spyOn(api, "importDoubanSession").mockResolvedValue({
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

  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/me" element={<div>已回到我的</div>} />
          <Route path="/subject/:medium/:doubanId" element={<div>已回到详情页</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("LoginPage", () => {
  it("defaults to the SMS tab and allows switching across all three login methods", async () => {
    renderLoginPage();

    expect(await screen.findByRole("tab", { name: "短信验证登录" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("登录连接到豆瓣。")).toBeInTheDocument();
    expect(screen.getByText("遇到风控或异常时，请改用导入 Cookie 登录。")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "账号密码登录" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "导入 Cookie 登录" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("输入手机号")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "账号密码登录" }));
    expect(screen.getByRole("tab", { name: "账号密码登录" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByPlaceholderText("手机号或邮箱")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("豆瓣密码")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认登录" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "导入 Cookie 登录" }));
    expect(screen.getByRole("tab", { name: "导入 Cookie 登录" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Cookie")).toBeInTheDocument();
    expect(screen.getByText("如何获取 Cookie 并在 PWA 里登录")).toBeInTheDocument();
  });

  it("keeps the login methods visible even when the current session is already valid", async () => {
    renderLoginPage({
      authMe: createAuthMeResponse("valid")
    });

    expect(await screen.findByText("当前已登录账号")).toBeInTheDocument();
    expect(screen.getByText("Demo / Shanghai")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "短信验证登录" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "账号密码登录" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "导入 Cookie 登录" })).toBeInTheDocument();
  });

  it("redirects to returnTo after Cookie login succeeds", async () => {
    renderLoginPage({
      initialEntry: "/login?returnTo=%2Fsubject%2Fmovie%2F1292052"
    });

    fireEvent.click(await screen.findByRole("tab", { name: "导入 Cookie 登录" }));
    fireEvent.change(screen.getByLabelText("Cookie"), {
      target: { value: "dbcl2=demo; ck=demo-cookie;" }
    });
    fireEvent.click(screen.getByRole("button", { name: "导入并登录" }));

    expect(await screen.findByText("已回到详情页")).toBeInTheDocument();
  });

  it("falls back to /me when returnTo is missing or invalid", async () => {
    renderLoginPage({
      initialEntry: "/login?returnTo=https%3A%2F%2Fevil.example%2Flogin"
    });

    fireEvent.click(await screen.findByRole("tab", { name: "导入 Cookie 登录" }));
    fireEvent.change(screen.getByLabelText("Cookie"), {
      target: { value: "dbcl2=demo; ck=demo-cookie;" }
    });
    fireEvent.click(screen.getByRole("button", { name: "导入并登录" }));

    await waitFor(() => {
      expect(screen.getByText("已回到我的")).toBeInTheDocument();
    });
  });
});
