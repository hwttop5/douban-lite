import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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
        content: "Nice detail page",
        rating: null,
        createdAt: "2026-05-13",
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

function renderSubjectDetailPage(medium: Medium, doubanId: string, response: SubjectDetailResponse) {
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
    expect(screen.getByRole("heading", { name: "视频 / 图片" })).toBeInTheDocument();
    expect(screen.getByText("Official Trailer")).toBeInTheDocument();
    expect(screen.getByText("Still One")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "喜欢这部电影的人也喜欢" })).toBeInTheDocument();
    expect(screen.getByText("Forrest Gump")).toBeInTheDocument();
  });

  it("renders music tracks and related albums", async () => {
    renderSubjectDetailPage(
      "music",
      "30401866",
      buildDetailResponse("music", "30401866", "Music Demo", {
        trackList: ["Track One", "Track Two"],
        relatedSubjects: [buildSubject("music", "20427949", "Related Album")],
        sectionLinks: [{ key: "related", label: "Related", url: "https://music.douban.com/subject/30401866/recommend" }]
      })
    );

    expect(await screen.findByRole("heading", { name: "曲目" })).toBeInTheDocument();
    expect(screen.getByText("Track One")).toBeInTheDocument();
    expect(screen.getByText("Track Two")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "喜欢听此专辑的人也喜欢" })).toBeInTheDocument();
    expect(screen.getByText("Related Album")).toBeInTheDocument();
  });

  it("renders book table of contents and related books", async () => {
    renderSubjectDetailPage(
      "book",
      "37817685",
      buildDetailResponse("book", "37817685", "Book Demo", {
        tableOfContents: ["Prologue", "Chapter One", "Chapter Two"],
        relatedSubjects: [buildSubject("book", "1003078", "Related Book")],
        sectionLinks: [{ key: "related", label: "Related", url: "https://book.douban.com/subject/37817685/recommend" }]
      })
    );

    expect(await screen.findByRole("heading", { name: "目录" })).toBeInTheDocument();
    expect(screen.getByText("Prologue")).toBeInTheDocument();
    expect(screen.getByText("Chapter One")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "喜欢读此书的人也喜欢" })).toBeInTheDocument();
    expect(screen.getByText("Related Book")).toBeInTheDocument();
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

    expect(await screen.findByRole("heading", { name: "视频 / 图片" })).toBeInTheDocument();
    expect(screen.getByText("Gameplay video")).toBeInTheDocument();
    expect(screen.getByText("Screenshot")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "喜欢此游戏的人也喜欢" })).toBeInTheDocument();
    expect(screen.getByText("Related Game")).toBeInTheDocument();
  });
});
