import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthMeResponse, Medium, SubjectDetailResponse, SubjectRecord } from "../../../../packages/shared/src";
import * as api from "../api";
import { SubjectDetailPage } from "./subject-detail-page";

function buildSubject(medium: Medium, doubanId: string, title: string): SubjectRecord {
  return {
    medium,
    doubanId,
    title,
    subtitle: null,
    year: "2024",
    coverUrl: null,
    averageRating: 8.8,
    summary: `${title} summary`,
    creators: ["Creator One"],
    metadata: {},
    updatedAt: new Date().toISOString()
  };
}

function buildDetailResponse(medium: Medium, doubanId: string, title: string, overrides: Partial<SubjectDetailResponse> = {}): SubjectDetailResponse {
  return {
    subject: buildSubject(medium, doubanId, title),
    userItem: null,
    comments: [
      {
        id: "c1",
        author: "Commenter",
        authorUrl: null,
        authorAvatarUrl: null,
        userVoteState: "not_voted",
        content: "Nice detail page",
        rating: null,
        createdAt: "2026-05-13",
        platform: null,
        votes: 3
      }
    ],
    staff: [],
    media: {
      videos: [],
      images: []
    },
    trackList: [],
    tableOfContents: [],
    relatedSubjects: [],
    sectionLinks: [],
    ...overrides
  };
}

function LoginRouteEcho() {
  const location = useLocation();
  return <div>{`${location.pathname}${location.search}`}</div>;
}

function renderSubjectDetailPage(
  medium: Medium,
  doubanId: string,
  response: SubjectDetailResponse,
  authMe: AuthMeResponse = {
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
  }
) {
  vi.spyOn(api, "getAuthMe").mockResolvedValue(authMe);

  vi.spyOn(api, "getSubjectDetail").mockResolvedValue(response);
  vi.spyOn(api, "getSubjectComments").mockResolvedValue({
    items: [],
    start: 0,
    nextStart: null,
    hasMore: false
  });

  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false }
          }
        })
      }
    >
      <MemoryRouter initialEntries={[`/subject/${medium}/${doubanId}`]}>
        <Routes>
          <Route path="/subject/:medium/:doubanId" element={<SubjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SubjectDetailPage", () => {
  it("renders movie staff, media, and related sections", async () => {
    renderSubjectDetailPage(
      "movie",
      "37116612",
      buildDetailResponse("movie", "37116612", "Movie Demo", {
        staff: [
          {
            name: "Director One",
            role: "Director",
            avatarUrl: "https://img.example.test/staff.jpg",
            profileUrl: "https://movie.douban.com/celebrity/1/"
          }
        ],
        media: {
          videos: [
            {
              type: "video",
              title: "Official Trailer",
              thumbnailUrl: "https://img.example.test/trailer.jpg",
              url: "https://movie.douban.com/trailer/1/"
            }
          ],
          images: [
            {
              type: "image",
              title: "Still One",
              thumbnailUrl: "https://img.example.test/still.jpg",
              url: "https://movie.douban.com/photos/photo/1/"
            }
          ]
        },
        relatedSubjects: [buildSubject("movie", "1292720", "Forrest Gump")],
        sectionLinks: [
          { key: "staff", label: "Cast and crew", url: "https://movie.douban.com/subject/37116612/celebrities" },
          { key: "videos", label: "Videos", url: "https://movie.douban.com/trailer/" },
          { key: "images", label: "Images", url: "https://movie.douban.com/photos" },
          { key: "related", label: "Related", url: "https://movie.douban.com/subject/37116612/recommendations" }
        ]
      })
    );

    expect(await screen.findByText("Director One")).toBeInTheDocument();
    expect(screen.getByText("Director")).toBeInTheDocument();
    expect(document.querySelector(".detail-staff-grid")).not.toBeNull();
    expect(document.querySelector(".detail-media-grid")).not.toBeNull();
    expect(screen.getByText("Official Trailer")).toBeInTheDocument();
    expect(screen.getByText("Still One")).toBeInTheDocument();
    expect(document.querySelector(".detail-media-grid")?.children).toHaveLength(2);
    expect(document.querySelector(".detail-related-grid")).not.toBeNull();
    expect(screen.getByText("Forrest Gump")).toBeInTheDocument();
  });

  it("renders music tracks and related albums", async () => {
    const relatedAlbum = {
      ...buildSubject("music", "20427949", "Related Album"),
      creators: ["Beck"],
      metadata: {
        alias: "Odelay",
        artist: "Beck",
        genre: "Rock",
        format: "Album",
        media: "Audio CD",
        releaseDate: "1996-06-18",
        publisher: "Geffen Records"
      }
    };
    renderSubjectDetailPage(
      "music",
      "30401866",
      buildDetailResponse("music", "30401866", "Music Demo", {
        trackList: ["Track One", "Track Two"],
        relatedSubjects: [relatedAlbum],
        sectionLinks: [{ key: "related", label: "Related", url: "https://music.douban.com/subject/30401866/recommend" }]
      })
    );

    expect(await screen.findByText("Track One")).toBeInTheDocument();
    expect(screen.getByText("Track One")).toBeInTheDocument();
    expect(screen.getByText("Track Two")).toBeInTheDocument();
    expect(document.querySelector(".detail-related-grid")).not.toBeNull();
    expect(screen.getByText("Related Album")).toBeInTheDocument();
    const relatedAlbumCard = screen.getByText("Related Album").closest("a");
    expect(relatedAlbumCard?.querySelector(".subject-card__meta-score")?.textContent).toContain("8.8");
    expect(relatedAlbumCard?.querySelector(".subject-card__meta-details")).toBeNull();
    expect(relatedAlbumCard?.querySelector(".subject-card__subtitle")).toBeNull();
    expect(relatedAlbumCard?.querySelector(".subject-card__extra")).not.toBeNull();
  });

  it("prefers the user's comment over status text when a music comment exists", async () => {
    renderSubjectDetailPage(
      "music",
      "1394576",
      buildDetailResponse("music", "1394576", "Sea Change", {
        userItem: {
          medium: "music",
          doubanId: "1394576",
          status: "wish",
          rating: null,
          comment: "Only this comment",
          tags: [],
          syncToTimeline: true,
          syncState: "synced",
          errorMessage: null,
          updatedAt: new Date().toISOString(),
          lastSyncedAt: new Date().toISOString(),
          lastPushedAt: new Date().toISOString()
        }
      }),
      {
        authenticated: true,
        user: {
          id: "user-1",
          peopleId: "demo-user",
          displayName: "Demo User",
          avatarUrl: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        sessionStatus: {
          status: "valid",
          peopleId: "demo-user",
          displayName: "Demo User",
          avatarUrl: null,
          ipLocation: null,
          lastCheckedAt: new Date().toISOString(),
          lastError: null
        }
      }
    );

    expect(await screen.findByText("Only this comment")).toBeInTheDocument();
    expect(document.querySelector(".detail-my-rating__summary strong")?.textContent).toBe("Only this comment");
    expect(document.querySelector(".detail-my-rating__summary span")).toBeNull();
  });

  it("collapses long book summaries behind a view-all action", async () => {
    const user = userEvent.setup();
    renderSubjectDetailPage(
      "book",
      "1007305",
      buildDetailResponse("book", "1007305", "Book Demo", {
        subject: {
          ...buildSubject("book", "1007305", "Book Demo"),
          summary: Array.from({ length: 24 }, (_, index) => `Paragraph ${index + 1} of the summary needs expansion.`).join(" ")
        }
      })
    );

    expect(await screen.findByText(/Paragraph 1 of the summary/)).toBeInTheDocument();
    expect(document.querySelector(".detail-summary-wrap--collapsed")).not.toBeNull();
    const expandButton = document.querySelector<HTMLButtonElement>(".detail-summary-section .detail-more-button");
    expect(expandButton).not.toBeNull();
    await user.click(expandButton!);
    expect(document.querySelector(".detail-summary-wrap--collapsed")).toBeNull();
  });

  it("collapses long music summaries behind a view-all action", async () => {
    const user = userEvent.setup();
    renderSubjectDetailPage(
      "music",
      "1394576",
      buildDetailResponse("music", "1394576", "Sea Change", {
        subject: {
          ...buildSubject("music", "1394576", "Sea Change"),
          summary: Array.from({ length: 18 }, (_, index) => `Paragraph ${index + 1} about the album release and production.`).join(" ")
        }
      })
    );

    expect(await screen.findByText(/Paragraph 1 about the album release/)).toBeInTheDocument();
    expect(document.querySelector(".detail-summary-wrap--collapsed")).not.toBeNull();
    const expandButton = document.querySelector<HTMLButtonElement>(".detail-summary-section .detail-more-button");
    expect(expandButton).not.toBeNull();
    await user.click(expandButton!);
    expect(document.querySelector(".detail-summary-wrap--collapsed")).toBeNull();
  });

  it("renders book table of contents and related books", async () => {
    const user = userEvent.setup();
    renderSubjectDetailPage(
      "book",
      "37817685",
      buildDetailResponse("book", "37817685", "Book Demo", {
        tableOfContents: Array.from({ length: 12 }, (_, index) => `Chapter ${index + 1}`),
        relatedSubjects: [buildSubject("book", "1003078", "Related Book")],
        sectionLinks: [{ key: "related", label: "Related", url: "https://book.douban.com/subject/37817685/recommend" }]
      })
    );

    expect(await screen.findByText("Chapter 1")).toBeInTheDocument();
    expect(screen.getByText("Chapter 1")).toBeInTheDocument();
    expect(document.querySelector(".detail-list-wrap--collapsed")).not.toBeNull();
    const tocExpandButton = document.querySelector<HTMLButtonElement>(".detail-list-wrap + .detail-section__footer .detail-more-button, .detail-section__footer .detail-more-button");
    expect(tocExpandButton).not.toBeNull();
    await user.click(tocExpandButton!);
    expect(document.querySelector(".detail-list-wrap--collapsed")).toBeNull();
    expect(screen.getByText("Chapter 12")).toBeInTheDocument();
    expect(document.querySelector(".detail-related-grid")).not.toBeNull();
    expect(screen.getByText("Related Book")).toBeInTheDocument();
    const relatedBookCard = screen.getByText("Related Book").closest("a");
    expect(relatedBookCard?.querySelector(".subject-card__meta-score")?.textContent).toContain("8.8");
  });

  it("renders game media and related games", async () => {
    renderSubjectDetailPage(
      "game",
      "21355730",
      buildDetailResponse("game", "21355730", "Game Demo", {
        media: {
          videos: [
            {
              type: "video",
              title: "Gameplay video",
              thumbnailUrl: "https://img.example.test/game-video.jpg",
              url: "https://www.douban.com/game/21355730/video/1/"
            }
          ],
          images: [
            {
              type: "image",
              title: "Screenshot",
              thumbnailUrl: "https://img.example.test/game-photo.jpg",
              url: "https://www.douban.com/game/21355730/photo/1/"
            }
          ]
        },
        relatedSubjects: [buildSubject("game", "26791492", "Related Game")],
        sectionLinks: [
          { key: "videos", label: "Videos", url: "https://www.douban.com/game/21355730/video/" },
          { key: "images", label: "Images", url: "https://www.douban.com/game/21355730/photo/" },
          { key: "related", label: "Related", url: "https://www.douban.com/game/21355730/recommend" }
        ]
      })
    );

    expect(await screen.findByText("Gameplay video")).toBeInTheDocument();
    expect(screen.getByText("Gameplay video")).toBeInTheDocument();
    expect(screen.getByText("Screenshot")).toBeInTheDocument();
    expect(document.querySelector(".detail-related-grid")).not.toBeNull();
    expect(screen.getByText("Related Game")).toBeInTheDocument();
  });

  it("routes the unauthenticated detail CTA to /login with a returnTo query", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "getAuthMe").mockResolvedValue({
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
    } satisfies AuthMeResponse);
    vi.spyOn(api, "getSubjectDetail").mockResolvedValue(buildDetailResponse("movie", "37116612", "Movie Demo"));
    vi.spyOn(api, "getSubjectComments").mockResolvedValue({
      items: [],
      start: 0,
      nextStart: null,
      hasMore: false
    });

    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: {
              queries: { retry: false },
              mutations: { retry: false }
            }
          })
        }
      >
        <MemoryRouter initialEntries={["/subject/movie/37116612"]}>
          <Routes>
            <Route path="/subject/:medium/:doubanId" element={<SubjectDetailPage />} />
            <Route path="/login" element={<LoginRouteEcho />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    const loginButton = await screen.findByRole("button", { name: "去登录" });
    await user.click(loginButton);
    expect(await screen.findByText("/login?returnTo=%2Fsubject%2Fmovie%2F37116612")).toBeInTheDocument();
  });

  it("renders user summary, richer comments, image preview, and load-more actions", async () => {
    const user = userEvent.setup();
    renderSubjectDetailPage(
      "game",
      "21355730",
      buildDetailResponse("game", "21355730", "Game Demo", {
        userItem: {
          medium: "game",
          doubanId: "21355730",
          status: "done",
          rating: 4,
          comment: "This system note should stay hidden",
          tags: ["Open World", "Quest Design"],
          syncToTimeline: true,
          syncState: "synced",
          errorMessage: null,
          updatedAt: new Date().toISOString(),
          lastSyncedAt: new Date().toISOString(),
          lastPushedAt: new Date().toISOString()
        },
        comments: [
          {
            id: "c1",
            author: "Commenter",
            authorUrl: "https://www.douban.com/people/commenter/",
            authorAvatarUrl: "https://img.example.test/avatar.jpg",
            userVoteState: "not_voted",
            content: "Nice detail page",
            rating: "鎺ㄨ崘",
            createdAt: "2026-05-13",
            platform: "PC",
            votes: 3
          }
        ],
        media: {
          videos: Array.from({ length: 4 }, (_, index) => ({
            type: "video" as const,
            title: `Video ${index + 1}`,
            thumbnailUrl: `https://img.example.test/video-${index + 1}.jpg`,
            url: `https://www.douban.com/game/21355730/video/${index + 1}/`
          })),
          images: Array.from({ length: 4 }, (_, index) => ({
            type: "image" as const,
            title: `Image ${index + 1}`,
            thumbnailUrl: `https://img.example.test/image-${index + 1}.jpg`,
            url: `https://www.douban.com/game/21355730/photo/${index + 1}/`
          }))
        },
        relatedSubjects: Array.from({ length: 5 }, (_, index) => ({
          ...buildSubject("game", `26791${index}`, `Related ${index + 1}`),
          metadata: {
            type: "Game / RPG",
            platform: "PC / PS5",
            developer: "CD Projekt RED",
            publisher: "Aspyr Media, Inc. / 2K Games",
            releaseDate: "2015-05-19"
          }
        }))
      }),
      {
        authenticated: true,
        user: {
          id: "user-1",
          peopleId: "demo-user",
          displayName: "Demo User",
          avatarUrl: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        sessionStatus: {
          status: "valid",
          peopleId: "demo-user",
          displayName: "Demo User",
          avatarUrl: null,
          ipLocation: null,
          lastCheckedAt: new Date().toISOString(),
          lastError: null
        }
      }
    );

    expect(await screen.findByText("This system note should stay hidden")).toBeInTheDocument();
    expect(screen.queryByText(/Open World/)).toBeNull();
    expect(screen.queryByText(/My short review/)).toBeNull();
    expect(screen.getByText("Commenter")).toBeInTheDocument();
    expect(screen.getByText("PC")).toBeInTheDocument();
    expect(screen.getByText("2026-05-13")).toBeInTheDocument();
    expect(screen.getByText("Commenter").closest("article")?.querySelector(".douban-stars")).not.toBeNull();
    expect(document.querySelector(".comment-card__votes--button")).not.toBeNull();

    expect(screen.queryByText("Image 4")).not.toBeInTheDocument();
    expect(screen.queryByText("Related 5")).not.toBeInTheDocument();

    const viewAllButtons = document.querySelectorAll<HTMLButtonElement>(".detail-more-button");
    expect(viewAllButtons).toHaveLength(2);
    await user.click(viewAllButtons[0]!);
    await user.click(viewAllButtons[1]!);

    expect(screen.getByText("Image 4")).toBeInTheDocument();
    expect(screen.getByText("Related 5")).toBeInTheDocument();
    const firstRelatedCard = screen.getByText("Related 1").closest("a");
    const firstRelatedExtra = firstRelatedCard?.querySelector(".subject-card__extra");
    expect(firstRelatedExtra).not.toBeNull();
    expect(firstRelatedExtra?.querySelector(".subject-card__meta-list")).not.toBeNull();

    await user.click(screen.getByText("Image 1").closest("button")!);
    expect(screen.getByRole("dialog", { name: "Image 1" })).toBeInTheDocument();
    const closeLightboxButton = document.querySelector<HTMLButtonElement>(".detail-lightbox__close");
    expect(closeLightboxButton).not.toBeNull();
    await user.click(closeLightboxButton!);
    expect(screen.queryByRole("dialog", { name: "Image 1" })).not.toBeInTheDocument();
  });

  it("shows load-more controls for movie staff and media", async () => {
    const user = userEvent.setup();
    renderSubjectDetailPage(
      "movie",
      "26637615",
      buildDetailResponse("movie", "26637615", "Movie Demo", {
        staff: Array.from({ length: 6 }, (_, index) => ({
          name: `Staff ${index + 1}`,
          role: index < 2 ? "瀵兼紨" : "婕斿憳",
          avatarUrl: `https://img.example.test/staff-${index + 1}.jpg`,
          profileUrl: `https://movie.douban.com/celebrity/${index + 1}/`
        })),
        media: {
          videos: Array.from({ length: 2 }, (_, index) => ({
            type: "video" as const,
            title: `Trailer ${index + 1}`,
            thumbnailUrl: `https://img.example.test/trailer-${index + 1}.jpg`,
            url: `https://movie.douban.com/trailer/${index + 1}/`
          })),
          images: Array.from({ length: 2 }, (_, index) => ({
            type: "image" as const,
            title: `Still ${index + 1}`,
            thumbnailUrl: `https://img.example.test/still-${index + 1}.jpg`,
            url: `https://movie.douban.com/photos/photo/${index + 1}/`
          }))
        }
      })
    );

    expect(await screen.findByText("Staff 1")).toBeInTheDocument();
    expect(screen.queryByText("Staff 5")).not.toBeInTheDocument();
    expect(screen.queryByText("Still 1")).not.toBeInTheDocument();

    const viewAllButtons = document.querySelectorAll<HTMLButtonElement>(".detail-more-button");
    expect(viewAllButtons).toHaveLength(2);
    await user.click(viewAllButtons[0]!);
    await user.click(viewAllButtons[1]!);

    expect(screen.getByText("Staff 5")).toBeInTheDocument();
    expect(screen.getByText("Still 1")).toBeInTheDocument();
  });

  it("uses muted hint styling for metadata-like comments and updated empty copy", async () => {
    renderSubjectDetailPage(
      "book",
      "6082808",
      buildDetailResponse("book", "6082808", "Book Demo", {
        userItem: {
          medium: "book",
          doubanId: "6082808",
          status: "done",
          rating: null,
          comment: "2026-05-10 修改 删除",
          tags: [],
          syncToTimeline: true,
          syncState: "synced",
          errorMessage: null,
          updatedAt: new Date().toISOString(),
          lastSyncedAt: new Date().toISOString(),
          lastPushedAt: new Date().toISOString()
        },
        comments: []
      }),
      {
        authenticated: true,
        user: {
          id: "user-1",
          peopleId: "demo-user",
          displayName: "Demo User",
          avatarUrl: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        sessionStatus: {
          status: "valid",
          peopleId: "demo-user",
          displayName: "Demo User",
          avatarUrl: null,
          ipLocation: null,
          lastCheckedAt: new Date().toISOString(),
          lastError: null
        }
      }
    );

    await screen.findByText(/2026-05-10/);
    expect(document.querySelector(".detail-my-rating__comment--hint")).not.toBeNull();
    expect(document.querySelector(".detail-my-rating__comment span")).toBeNull();
  });

  it("shows five muted stars for unrated comments", async () => {
    renderSubjectDetailPage("game", "21355730", buildDetailResponse("game", "21355730", "Game Demo"));

    expect(await screen.findByText("Nice detail page")).toBeInTheDocument();
    expect(document.querySelector(".comment-card .douban-stars")).not.toBeNull();
  });

  it("toggles a comment vote and updates the visible count", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "getAuthMe").mockResolvedValue({
      authenticated: true,
      user: {
        id: "user-1",
        peopleId: "demo-user",
        displayName: "Demo User",
        avatarUrl: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      sessionStatus: {
        status: "valid",
        peopleId: "demo-user",
        displayName: "Demo User",
        avatarUrl: null,
        ipLocation: null,
        lastCheckedAt: new Date().toISOString(),
        lastError: null
      }
    } satisfies AuthMeResponse);
    vi.spyOn(api, "getSubjectDetail").mockResolvedValue(
      buildDetailResponse("game", "21355730", "Game Demo", {
        comments: [
          {
            id: "c1",
            author: "Commenter",
            authorUrl: null,
            authorAvatarUrl: null,
            userVoteState: "not_voted",
            content: "Nice detail page",
            rating: "鎺ㄨ崘",
            createdAt: "2026-05-13",
            platform: "PC",
            votes: 3
          }
        ]
      })
    );
    vi.spyOn(api, "getSubjectComments").mockResolvedValue({
      items: [],
      start: 0,
      nextStart: null,
      hasMore: false
    });
    vi.spyOn(api, "voteSubjectComment")
      .mockResolvedValueOnce({
        commentId: "c1",
        votes: 4,
        userVoteState: "voted"
      })
      .mockResolvedValueOnce({
        commentId: "c1",
        votes: 3,
        userVoteState: "not_voted"
      });

    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: {
              queries: { retry: false },
              mutations: { retry: false }
            }
          })
        }
      >
        <MemoryRouter initialEntries={["/subject/game/21355730"]}>
          <Routes>
            <Route path="/subject/:medium/:doubanId" element={<SubjectDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    const voteButton = (await screen.findByText("Nice detail page")).closest("article")?.querySelector<HTMLButtonElement>(".comment-card__votes--button");
    expect(voteButton).not.toBeNull();
    expect(voteButton).toHaveTextContent("3");
    await user.click(voteButton!);
    const activeVote = (await screen.findByText("Nice detail page")).closest("article")?.querySelector(".comment-card__votes.comment-card__votes--active");
    expect(activeVote).not.toBeNull();
    expect(activeVote).toHaveTextContent("4");
  });

  it("renders voted comments without cancel support as passive state", async () => {
    vi.spyOn(api, "getAuthMe").mockResolvedValue({
      authenticated: true,
      user: {
        id: "user-1",
        peopleId: "demo-user",
        displayName: "Demo User",
        avatarUrl: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      sessionStatus: {
        status: "valid",
        peopleId: "demo-user",
        displayName: "Demo User",
        avatarUrl: null,
        ipLocation: null,
        lastCheckedAt: new Date().toISOString(),
        lastError: null
      }
    } satisfies AuthMeResponse);
    vi.spyOn(api, "getSubjectDetail").mockResolvedValue(
      buildDetailResponse("movie", "37311135", "Movie Demo", {
        comments: [
          {
            id: "c1",
            author: "Commenter",
            authorUrl: null,
            authorAvatarUrl: null,
            userVoteState: "voted",
            canCancelVote: null,
            content: "Already voted comment",
            rating: null,
            createdAt: "2026-05-13",
            platform: null,
            votes: 4
          }
        ]
      })
    );
    vi.spyOn(api, "getSubjectComments").mockResolvedValue({
      items: [],
      start: 0,
      nextStart: null,
      hasMore: false
    });

    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: {
              queries: { retry: false },
              mutations: { retry: false }
            }
          })
        }
      >
        <MemoryRouter initialEntries={["/subject/movie/37311135"]}>
          <Routes>
            <Route path="/subject/:medium/:doubanId" element={<SubjectDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(await screen.findByText("Already voted comment")).toBeInTheDocument();
    expect(document.querySelector(".comment-card__votes--button")).toBeNull();
    expect(document.querySelector(".comment-card__votes.comment-card__votes--active")?.textContent).toContain("4");
  });

  it("keeps voted comments clickable when cancel support is explicit", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "getAuthMe").mockResolvedValue({
      authenticated: true,
      user: {
        id: "user-1",
        peopleId: "demo-user",
        displayName: "Demo User",
        avatarUrl: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      sessionStatus: {
        status: "valid",
        peopleId: "demo-user",
        displayName: "Demo User",
        avatarUrl: null,
        ipLocation: null,
        lastCheckedAt: new Date().toISOString(),
        lastError: null
      }
    } satisfies AuthMeResponse);
    vi.spyOn(api, "getSubjectDetail").mockResolvedValue(
      buildDetailResponse("game", "35110438", "Game Demo", {
        comments: [
          {
            id: "c1",
            author: "Commenter",
            authorUrl: null,
            authorAvatarUrl: null,
            userVoteState: "voted",
            canCancelVote: true,
            content: "Cancelable vote comment",
            rating: null,
            createdAt: "2026-05-13",
            platform: null,
            votes: 4
          }
        ]
      })
    );
    vi.spyOn(api, "getSubjectComments").mockResolvedValue({
      items: [],
      start: 0,
      nextStart: null,
      hasMore: false
    });
    vi.spyOn(api, "voteSubjectComment").mockResolvedValue({
      commentId: "c1",
      votes: 3,
      userVoteState: "not_voted"
    });

    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: {
              queries: { retry: false },
              mutations: { retry: false }
            }
          })
        }
      >
        <MemoryRouter initialEntries={["/subject/game/35110438"]}>
          <Routes>
            <Route path="/subject/:medium/:doubanId" element={<SubjectDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    const voteButton = (await screen.findByText("Cancelable vote comment")).closest("article")?.querySelector<HTMLButtonElement>(".comment-card__votes--button.is-active");
    expect(voteButton).not.toBeNull();
    expect(voteButton).toHaveTextContent("4");
    await user.click(voteButton!);
    const unvotedButton = (await screen.findByText("Cancelable vote comment")).closest("article")?.querySelector<HTMLButtonElement>(".comment-card__votes--button");
    expect(unvotedButton).not.toBeNull();
    expect(unvotedButton).not.toHaveClass("is-active");
    expect(unvotedButton).toHaveTextContent("3");
  });
});
