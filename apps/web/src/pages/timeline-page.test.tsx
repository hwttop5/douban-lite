import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { AuthMeResponse, TimelineResponse } from "../../../../packages/shared/src";
import * as api from "../api";
import { TimelinePage } from "./timeline-page";

describe("TimelinePage", () => {
  it("renders image-only statuses without the linked-subject card", async () => {
    vi.spyOn(api, "getAuthMe").mockResolvedValue({
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
    } satisfies AuthMeResponse);

    vi.spyOn(api, "getTimeline").mockResolvedValue({
      scope: "following",
      start: 0,
      nextStart: null,
      hasMore: false,
      fetchedAt: new Date().toISOString(),
      stale: false,
      items: [
        {
          id: "status-1",
          authorName: "Jun",
          authorUrl: "https://www.douban.com/people/jun/",
          authorAvatarUrl: null,
          actionText: "说：",
          content: "北海道三天之旅结束了，绕渡岛半岛、羊蹄山、支笏洞爷一圈自驾。",
          createdAtText: "5月3日",
          detailUrl: "https://www.douban.com/people/jun/status/status-1/",
          subjectTitle: null,
          subjectUrl: null,
          subjectCoverUrl: null,
          photoUrls: ["https://img3.doubanio.com/view/group_topic/l/public/p1.jpg"],
          engagements: []
        }
      ]
    } satisfies TimelineResponse);

    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <TimelinePage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(await screen.findByText("北海道三天之旅结束了，绕渡岛半岛、羊蹄山、支笏洞爷一圈自驾。")).toBeInTheDocument();
    expect(screen.queryByText("关联条目")).not.toBeInTheDocument();
    expect(container.querySelector(".timeline-subject")).toBeNull();
    expect(container.querySelectorAll(".timeline-photos img")).toHaveLength(1);
  });

  it("renders engagements in the footer with zero fallback counts", async () => {
    vi.spyOn(api, "getAuthMe").mockResolvedValue({
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
    } satisfies AuthMeResponse);

    vi.spyOn(api, "getTimeline").mockResolvedValue({
      scope: "following",
      start: 0,
      nextStart: null,
      hasMore: false,
      fetchedAt: new Date().toISOString(),
      stale: false,
      items: [
        {
          id: "status-2",
          authorName: "Jun",
          authorUrl: "https://www.douban.com/people/jun/",
          authorAvatarUrl: null,
          actionText: "说：",
          content: "北海道三天之旅结束了，绕渡岛半岛、羊蹄山、支笏洞爷一圈自驾。",
          createdAtText: "5月3日",
          detailUrl: "https://www.douban.com/people/jun/status/status-2/",
          subjectTitle: null,
          subjectUrl: null,
          subjectCoverUrl: null,
          photoUrls: [],
          engagements: [
            { label: "回应", count: null },
            { label: "赞", count: 6 },
            { label: "转发", count: null }
          ]
        }
      ]
    } satisfies TimelineResponse);

    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <TimelinePage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(await screen.findByText("赞 (6)")).toBeInTheDocument();
    expect(screen.getByText("回复 (0)")).toBeInTheDocument();
    expect(screen.getByText("转发 (0)")).toBeInTheDocument();
  });

  it("routes game timeline subjects to the local detail page", async () => {
    vi.spyOn(api, "getAuthMe").mockResolvedValue({
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
    } satisfies AuthMeResponse);

    vi.spyOn(api, "getTimeline").mockResolvedValue({
      scope: "following",
      start: 0,
      nextStart: null,
      hasMore: false,
      fetchedAt: new Date().toISOString(),
      stale: false,
      items: [
        {
          id: "status-game",
          authorName: "Jun",
          authorUrl: "https://www.douban.com/people/jun/",
          authorAvatarUrl: null,
          actionText: "玩过",
          content: "很好玩。",
          createdAtText: "5月10日",
          detailUrl: "https://www.douban.com/people/jun/status/status-game/",
          subjectTitle: "巫师3：狂猎",
          subjectUrl: "https://www.douban.com/?start=0/game/30347464/",
          subjectCoverUrl: null,
          photoUrls: [],
          engagements: []
        }
      ]
    } satisfies TimelineResponse);

    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <TimelinePage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    const link = await screen.findByRole("link", { name: /巫师3：狂猎/i });
    expect(link).toHaveAttribute("href", "/subject/game/30347464");
  });
});
