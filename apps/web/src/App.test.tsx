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
  availableModes: ["sms", "password"]
};

function renderApp(authMe: AuthMeResponse) {
  vi.spyOn(api, "getAuthMe").mockResolvedValue(authMe);
  vi.spyOn(api, "getDoubanProxyLoginConfig").mockResolvedValue(defaultProxyConfig);

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
