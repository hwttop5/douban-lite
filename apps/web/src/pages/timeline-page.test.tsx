import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthMeResponse, TimelineItem, TimelineResponse } from "../../../../packages/shared/src";
import * as api from "../api";
import { TimelinePage } from "./timeline-page";

function createTimelineItem(overrides: Partial<TimelineItem> = {}): TimelineItem {
  return {
    id: "status-1",
    authorName: "ttop5",
    authorUrl: "https://www.douban.com/people/ttop5/",
    authorAvatarUrl: null,
    actionText: "\u5728\u8bfb",
    content: "8.8 \u94f6\u6cb3\u7cfb\u642d\u8f66\u5ba2\u6307\u5357\uff085\u90e8\u66f2\uff09",
    createdAtText: "05-05",
    detailUrl: "https://www.douban.com/people/ttop5/status/status-1/",
    subjectTitle: "\u94f6\u6cb3\u7cfb\u642d\u8f66\u5ba2\u6307\u5357\uff085\u90e8\u66f2\uff09",
    subjectUrl: "https://book.douban.com/subject/6082808/",
    subjectCoverUrl: null,
    photoUrls: [],
    engagements: [
      { label: "\u56de\u5e94", count: 1 },
      { label: "\u8f6c\u53d1", count: 0 },
      { label: "\u8d5e", count: 6 }
    ],
    userLikeState: "not_liked",
    availableActions: {
      like: true,
      reply: true,
      repost: true
    },
    ...overrides
  };
}

function mockAuth(status: AuthMeResponse["sessionStatus"]["status"] = "valid") {
  vi.spyOn(api, "getAuthMe").mockResolvedValue({
    authenticated: status === "valid",
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
  } satisfies AuthMeResponse);
}

function renderPage(items: TimelineItem[], options: { stale?: boolean } = {}) {
  vi.spyOn(api, "getTimeline").mockResolvedValue({
    scope: "following",
    start: 0,
    nextStart: null,
    hasMore: false,
    fetchedAt: new Date().toISOString(),
    stale: options.stale ?? false,
    items
  } satisfies TimelineResponse);

  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <TimelinePage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("TimelinePage", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders image-only statuses without the linked-subject card", async () => {
    mockAuth();
    const item = createTimelineItem({
      id: "status-image",
      actionText: "\u8bf4",
      content: "\u5317\u6d77\u9053\u4e09\u5929\u4e4b\u65c5\u7ed3\u675f\u4e86\uff0c\u7ed5\u5c9b\u534a\u5708\u3001\u7f8a\u8e44\u5c71\u3001\u652f\u7b0f\u6e56\u5140\u4e86\u4e00\u5708\u81ea\u9a7e\u3002",
      subjectTitle: null,
      subjectUrl: null,
      subjectCoverUrl: null,
      photoUrls: ["https://img3.doubanio.com/view/group_topic/l/public/p1.jpg"]
    });

    const { container } = renderPage([item]);

    expect(
      await screen.findByText("\u5317\u6d77\u9053\u4e09\u5929\u4e4b\u65c5\u7ed3\u675f\u4e86\uff0c\u7ed5\u5c9b\u534a\u5708\u3001\u7f8a\u8e44\u5c71\u3001\u652f\u7b0f\u6e56\u5140\u4e86\u4e00\u5708\u81ea\u9a7e\u3002")
    ).toBeInTheDocument();
    expect(container.querySelector(".timeline-subject")).toBeNull();
    expect(container.querySelectorAll(".timeline-photos img")).toHaveLength(1);
  });

  it("shows standalone content for linked subjects when the text differs from the subject title", async () => {
    mockAuth();
    renderPage([
      createTimelineItem({
        id: "status-note",
        actionText: "\u8bfb\u8fc7",
        content: "\u4f0a\u6717\u52a0\u6cb9\u62d6\u4f4f\u61c2\u738b\u5b50",
        subjectTitle: "\u4f0a\u6717\u4e94\u767e\u5e74"
      })
    ]);

    expect(await screen.findByText("\u4f0a\u6717\u52a0\u6cb9\u62d6\u4f4f\u61c2\u738b\u5b50")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /\u4f0a\u6717\u4e94\u767e\u5e74/i })).toBeInTheDocument();
  });

  it("updates the visible like count and active state", async () => {
    mockAuth();
    const user = userEvent.setup();
    vi.spyOn(api, "likeTimelineStatus").mockResolvedValue({
      statusId: "status-like",
      engagements: [
        { label: "\u56de\u5e94", count: 1 },
        { label: "\u8f6c\u53d1", count: 0 },
        { label: "\u8d5e", count: 7 }
      ],
      userLikeState: "liked"
    });

    renderPage([createTimelineItem({ id: "status-like" })]);

    const likeButton = await screen.findByRole("button", { name: "\u8d5e (6)" });
    await user.click(likeButton);

    await waitFor(() => {
      expect(api.likeTimelineStatus).toHaveBeenCalledWith("status-like", "https://www.douban.com/people/ttop5/status/status-1/");
    });
    expect(await screen.findByRole("button", { name: "\u8d5e (7)" })).toHaveClass("is-active");
  });

  it("submits a reply from the dialog and refreshes the count", async () => {
    mockAuth();
    const user = userEvent.setup();
    vi.spyOn(api, "replyTimelineStatus").mockResolvedValue({
      statusId: "status-reply",
      engagements: [
        { label: "\u56de\u5e94", count: 2 },
        { label: "\u8f6c\u53d1", count: 0 },
        { label: "\u8d5e", count: 6 }
      ]
    });

    renderPage([createTimelineItem({ id: "status-reply" })]);

    await user.click(await screen.findByRole("button", { name: "\u56de\u590d (1)" }));
    expect(await screen.findByRole("heading", { name: "\u56de\u590d\u52a8\u6001" })).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText("\u5199\u4e0b\u4f60\u7684\u56de\u590d"), "\u6536\u5230");
    await user.click(screen.getByRole("button", { name: "\u53d1\u9001" }));

    await waitFor(() => {
      expect(api.replyTimelineStatus).toHaveBeenCalledWith("status-reply", "https://www.douban.com/people/ttop5/status/status-1/", "\u6536\u5230");
    });
    expect(await screen.findByRole("button", { name: "\u56de\u590d (2)" })).toBeInTheDocument();
  });

  it("allows reposting without extra text", async () => {
    mockAuth();
    const user = userEvent.setup();
    vi.spyOn(api, "repostTimelineStatus").mockResolvedValue({
      statusId: "status-repost",
      engagements: [
        { label: "\u56de\u5e94", count: 1 },
        { label: "\u8f6c\u53d1", count: 1 },
        { label: "\u8d5e", count: 6 }
      ]
    });

    renderPage([createTimelineItem({ id: "status-repost" })]);

    await user.click(await screen.findByRole("button", { name: "\u8f6c\u53d1 (0)" }));
    expect(await screen.findByRole("heading", { name: "\u8f6c\u53d1\u52a8\u6001" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "\u53d1\u9001" }));

    await waitFor(() => {
      expect(api.repostTimelineStatus).toHaveBeenCalledWith("status-repost", "https://www.douban.com/people/ttop5/status/status-1/", undefined);
    });
    expect(await screen.findByRole("button", { name: "\u8f6c\u53d1 (1)" })).toBeInTheDocument();
  });

  it("disables timeline actions when the page is showing stale cached data", async () => {
    mockAuth();
    renderPage([createTimelineItem()], { stale: true });

    expect(
      await screen.findByText("\u5b9e\u65f6\u6293\u53d6\u5931\u8d25\uff0c\u5f53\u524d\u663e\u793a\u7684\u662f\u7f13\u5b58\u52a8\u6001\u3002\u8d5e\u3001\u56de\u590d\u548c\u8f6c\u53d1\u5df2\u7981\u7528\uff0c\u8bf7\u91cd\u65b0\u5bfc\u5165\u6709\u6548\u7684\u8c46\u74e3 Cookie \u540e\u91cd\u8bd5\u3002")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "\u8d5e (6)" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "\u56de\u590d (1)" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "\u8f6c\u53d1 (0)" })).toBeDisabled();
  });

  it("routes game timeline subjects to the local detail page", async () => {
    mockAuth();
    renderPage([
      createTimelineItem({
        id: "status-game",
        actionText: "\u73a9\u8fc7",
        content: "9.2 \u5f88\u597d\u73a9\u3002",
        subjectTitle: "\u5deb\u5e083\uff1a\u72c2\u730e",
        subjectUrl: "https://www.douban.com/?start=0/game/30347464/",
        engagements: []
      })
    ]);

    const link = await screen.findByRole("link", { name: /\u5deb\u5e083\uff1a\u72c2\u730e/i });
    expect(link).toHaveAttribute("href", "/subject/game/30347464");
  });
});
