import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthMeResponse, DoubanProxyLoginConfigResponse } from "../../../packages/shared/src";
import * as api from "./api";
import { App } from "./App";

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
  availableModes: ["qr", "sms", "password"]
};

function renderApp(authMe: AuthMeResponse) {
  vi.spyOn(api, "getAuthMe").mockResolvedValue(authMe);
  vi.spyOn(api, "getDoubanProxyLoginConfig").mockResolvedValue(defaultProxyConfig);
  vi.spyOn(api, "startDoubanProxyLogin").mockResolvedValue({
    loginAttemptId: "attempt-1",
    status: "created",
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    nextAction: "start_qr",
    verificationMethod: "none",
    maskedTarget: null,
    retryAfterSeconds: null,
    pollIntervalSeconds: null,
    qrCode: null,
    qrCodeImageUrl: null,
    qrStatus: null,
    availableFallbacks: ["cookie_import"],
    errorCode: null,
    message: null
  });
  vi.spyOn(api, "startDoubanProxyQrLogin").mockResolvedValue({
    loginAttemptId: "attempt-1",
    status: "created",
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    nextAction: "poll_qr_status",
    verificationMethod: "qr",
    maskedTarget: null,
    retryAfterSeconds: null,
    pollIntervalSeconds: 30,
    qrCode: "qr-code-1",
    qrCodeImageUrl: "https://img1.doubanio.com/view/douban_qr_login/raw/public/qr-code-1.png",
    qrStatus: "pending",
    availableFallbacks: ["cookie_import"],
    errorCode: null,
    message: "请打开豆瓣 App 扫码登录。"
  });
  vi.spyOn(api, "getDoubanProxyLoginStatus").mockResolvedValue({
    loginAttemptId: "attempt-1",
    status: "created",
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    nextAction: "poll_qr_status",
    verificationMethod: "qr",
    maskedTarget: null,
    retryAfterSeconds: null,
    pollIntervalSeconds: 30,
    qrCode: "qr-code-1",
    qrCodeImageUrl: "https://img1.doubanio.com/view/douban_qr_login/raw/public/qr-code-1.png",
    qrStatus: "pending",
    availableFallbacks: ["cookie_import"],
    errorCode: null,
    message: "请打开豆瓣 App 扫码登录。"
  });

  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/search"]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("App account entry", () => {
  it("routes unauthenticated account access to /login", async () => {
    const user = userEvent.setup();
    renderApp({
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

    await user.click(await screen.findByRole("button", { name: /未登录/ }));
    expect(await screen.findByRole("heading", { name: "登录" })).toBeInTheDocument();
  });

  it("keeps authenticated account access on /settings", async () => {
    const user = userEvent.setup();
    renderApp({
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

    await user.click(await screen.findByRole("button", { name: /Demo/ }));
    expect(await screen.findByRole("heading", { name: "偏好设置" })).toBeInTheDocument();
  });
});
