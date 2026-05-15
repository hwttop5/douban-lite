import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AuthMeResponse,
  DoubanProxyLoginConfigResponse,
  DoubanProxyLoginStatusResponse,
  DoubanProxyLoginSubmitResponse
} from "../../../../packages/shared/src";
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
  availableModes: ["qr", "sms", "password"]
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

function createProxyAttemptResult(overrides: Partial<DoubanProxyLoginStatusResponse> = {}): DoubanProxyLoginStatusResponse {
  return {
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
    message: null,
    ...overrides
  };
}

function createQrStartResult(overrides: Partial<DoubanProxyLoginStatusResponse> = {}): DoubanProxyLoginStatusResponse {
  return createProxyAttemptResult({
    nextAction: "poll_qr_status",
    verificationMethod: "qr",
    pollIntervalSeconds: 30,
    qrCode: "qr-code-1",
    qrCodeImageUrl: "https://img1.doubanio.com/view/douban_qr_login/raw/public/qr-code-1.png",
    qrStatus: "pending",
    message: "请打开豆瓣 App 扫码登录。",
    ...overrides
  });
}

function createQrStatusResult(overrides: Partial<DoubanProxyLoginSubmitResponse> = {}): DoubanProxyLoginSubmitResponse {
  return {
    ...createQrStartResult(),
    ...overrides
  };
}

function createClaimedQrResult(overrides: Partial<DoubanProxyLoginSubmitResponse> = {}): DoubanProxyLoginSubmitResponse {
  return {
    ...createQrStartResult({
      status: "claimed",
      nextAction: "none",
      qrStatus: "login",
      message: "登录成功。"
    }),
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
    },
    ...overrides
  };
}

function mockSequentialResult<T>(values: T[]) {
  const queue = [...values];
  return async () => {
    const next = queue[0];
    if (queue.length > 1) {
      queue.shift();
    }
    return next;
  };
}

function renderLoginPage({
  initialEntry = "/login",
  initialEntries,
  initialIndex,
  authMe = createAuthMeResponse("missing"),
  proxyConfig = defaultProxyConfig,
  qrStartResults = [createQrStartResult()],
  qrStatusResults = [createQrStatusResult()]
}: {
  initialEntry?: string;
  initialEntries?: string[];
  initialIndex?: number;
  authMe?: AuthMeResponse;
  proxyConfig?: DoubanProxyLoginConfigResponse;
  qrStartResults?: DoubanProxyLoginStatusResponse[];
  qrStatusResults?: DoubanProxyLoginSubmitResponse[];
} = {}) {
  vi.spyOn(api, "getAuthMe").mockResolvedValue(authMe);
  vi.spyOn(api, "getDoubanProxyLoginConfig").mockResolvedValue(proxyConfig);
  vi.spyOn(api, "startDoubanProxyLogin").mockResolvedValue(createProxyAttemptResult());
  const qrStartSpy = vi.spyOn(api, "startDoubanProxyQrLogin").mockImplementation(mockSequentialResult(qrStartResults));
  vi.spyOn(api, "getDoubanProxyLoginStatus").mockImplementation(mockSequentialResult(qrStatusResults));
  vi.spyOn(api, "sendDoubanProxySmsCode").mockResolvedValue(createProxyAttemptResult());
  vi.spyOn(api, "submitDoubanProxyPassword").mockResolvedValue(createQrStatusResult());
  vi.spyOn(api, "verifyDoubanProxySmsCode").mockResolvedValue(createQrStatusResult());
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
      <MemoryRouter initialEntries={initialEntries ?? [initialEntry]} initialIndex={initialIndex}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/me" element={<div>已回到我的页</div>} />
          <Route path="/subject/:medium/:doubanId" element={<div>已回到详情页</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );

  return { qrStartSpy };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("LoginPage", () => {
  it("defaults to QR login and only exposes QR and Cookie tabs", async () => {
    renderLoginPage();

    expect(await screen.findByText("选择登录方式")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "二维码登录" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Cookie 登录" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "短信验证登录" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "账号密码登录" })).not.toBeInTheDocument();

    expect(await screen.findByAltText("豆瓣登录二维码")).toBeInTheDocument();
    expect(screen.getByText("请打开豆瓣 App 扫码登录。")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("输入手机号")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("豆瓣密码")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Cookie 登录" }));
    expect(screen.getByRole("tab", { name: "Cookie 登录" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Cookie")).toBeInTheDocument();
    expect(screen.getByText("如何获取 Cookie 并在 PWA 里登录")).toBeInTheDocument();
    expect(screen.queryByAltText("豆瓣登录二维码")).not.toBeInTheDocument();
  });

  it("returns to the previous page from the top-left back button", async () => {
    renderLoginPage({
      initialEntries: ["/me", "/login"],
      initialIndex: 1
    });

    fireEvent.click(await screen.findByRole("button", { name: "返回" }));

    await waitFor(() => {
      expect(screen.getByText("已回到我的页")).toBeInTheDocument();
    });
  });

  it("falls back to returnTo when opened directly and the back button has no in-app history", async () => {
    renderLoginPage({
      initialEntry: "/login?returnTo=%2Fsubject%2Fmovie%2F1292052"
    });

    fireEvent.click(await screen.findByRole("button", { name: "返回" }));

    await waitFor(() => {
      expect(screen.getByText("已回到详情页")).toBeInTheDocument();
    });
  });

  it("shows QR expiry feedback and allows refreshing the code", async () => {
    const { qrStartSpy } = renderLoginPage({
      qrStartResults: [
        createQrStartResult({
          pollIntervalSeconds: 1,
          qrCode: "qr-code-1",
          qrCodeImageUrl: "https://img1.doubanio.com/view/douban_qr_login/raw/public/qr-code-1.png"
        }),
        createQrStartResult({
          pollIntervalSeconds: 1,
          qrCode: "qr-code-2",
          qrCodeImageUrl: "https://img1.doubanio.com/view/douban_qr_login/raw/public/qr-code-2.png"
        })
      ],
      qrStatusResults: [
        createQrStatusResult({
          status: "expired",
          nextAction: "start_qr",
          qrStatus: "invalid",
          errorCode: "qr_expired",
          message: "二维码已失效，请重新获取。",
          pollIntervalSeconds: 1
        }),
        createQrStatusResult({
          qrCode: "qr-code-2",
          qrCodeImageUrl: "https://img1.doubanio.com/view/douban_qr_login/raw/public/qr-code-2.png",
          pollIntervalSeconds: 1
        })
      ]
    });

    const qrImage = await screen.findByAltText("豆瓣登录二维码");
    expect(qrImage.getAttribute("src")).toContain(encodeURIComponent("https://img1.doubanio.com/view/douban_qr_login/raw/public/qr-code-1.png"));

    expect(await screen.findByText("二维码已失效，请重新获取。")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "刷新二维码" }));

    await waitFor(() => {
      expect(qrStartSpy).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.getByAltText("豆瓣登录二维码").getAttribute("src")).toContain(
        encodeURIComponent("https://img1.doubanio.com/view/douban_qr_login/raw/public/qr-code-2.png")
      );
    });
  });

  it("redirects after QR login succeeds", async () => {
    renderLoginPage({
      qrStartResults: [
        createQrStartResult({
          pollIntervalSeconds: 1
        })
      ],
      qrStatusResults: [
        createQrStatusResult({
          status: "needs_verification",
          nextAction: "poll_qr_status",
          qrStatus: "scan",
          message: "扫码成功，请在手机上确认登录。",
          pollIntervalSeconds: 1
        }),
        createClaimedQrResult()
      ]
    });

    expect(await screen.findByAltText("豆瓣登录二维码")).toBeInTheDocument();
    expect(await screen.findByText("扫码成功，请在手机上确认登录。")).toBeInTheDocument();
    await waitFor(
      () => {
        expect(screen.getByText("已回到我的页")).toBeInTheDocument();
      },
      { timeout: 3000 }
    );
  });

  it("keeps the login tabs visible even when the current session is already valid", async () => {
    renderLoginPage({
      authMe: createAuthMeResponse("valid")
    });

    expect(await screen.findByText("当前已登录账号")).toBeInTheDocument();
    expect(screen.getByText("Demo / Shanghai")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "二维码登录" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Cookie 登录" })).toBeInTheDocument();
  });

  it("redirects to returnTo after Cookie login succeeds", async () => {
    renderLoginPage({
      initialEntry: "/login?returnTo=%2Fsubject%2Fmovie%2F1292052"
    });

    fireEvent.click(await screen.findByRole("tab", { name: "Cookie 登录" }));
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

    fireEvent.click(await screen.findByRole("tab", { name: "Cookie 登录" }));
    fireEvent.change(screen.getByLabelText("Cookie"), {
      target: { value: "dbcl2=demo; ck=demo-cookie;" }
    });
    fireEvent.click(screen.getByRole("button", { name: "导入并登录" }));

    await waitFor(() => {
      expect(screen.getByText("已回到我的页")).toBeInTheDocument();
    });
  });
});
