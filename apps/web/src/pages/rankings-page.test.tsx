import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RankingResponse, SubjectRecord } from "../../../../packages/shared/src";
import { boardCatalog } from "../../../../packages/shared/src";
import * as api from "../api";
import { AppContextProvider } from "../app-context";
import { RankingsPage } from "./rankings-page";

function buildSubject(title: string, medium: SubjectRecord["medium"] = "book"): SubjectRecord {
  return {
    medium,
    doubanId: "1001",
    title,
    subtitle: null,
    year: "2026",
    coverUrl: null,
    averageRating: 8.7,
    summary: `${title} summary`,
    creators: ["Author One"],
    metadata: {},
    updatedAt: new Date().toISOString()
  };
}

function renderRankingsPage(response: RankingResponse) {
  window.localStorage.setItem("douban-lite:medium", "book");
  vi.spyOn(api, "getRanking").mockResolvedValue(response);

  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false }
          }
        })
      }
    >
      <MemoryRouter initialEntries={["/rankings"]}>
        <AppContextProvider>
          <RankingsPage />
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

describe("RankingsPage", () => {
  it("renders rank-only extra metadata without the ranking blurb", async () => {
    renderRankingsPage({
      board: boardCatalog.book[0]!,
      items: [
        {
          rank: 1,
          blurb: "This blurb should not render in the extra meta line.",
          subject: buildSubject("The Argonauts")
        }
      ],
      fetchedAt: new Date().toISOString(),
      stale: false
    });

    const card = (await screen.findByText("The Argonauts")).closest("a");
    expect(card).not.toBeNull();
    const metaRows = card?.querySelectorAll(".subject-card__meta");
    expect(metaRows?.length).toBe(2);
    expect(metaRows?.item(1)?.textContent).toBe("第 1 名");
    expect(card).not.toHaveTextContent("This blurb should not render in the extra meta line.");
  });

  it("uses the updated music board labels in the segmented control", async () => {
    window.localStorage.setItem("douban-lite:medium", "music");
    vi.spyOn(api, "getRanking").mockResolvedValue({
      board: boardCatalog.music[0]!,
      items: [
        {
          rank: 1,
          blurb: null,
          subject: buildSubject("Yamato Ryou", "music")
        }
      ],
      fetchedAt: new Date().toISOString(),
      stale: false
    });

    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: {
              queries: { retry: false }
            }
          })
        }
      >
        <MemoryRouter initialEntries={["/rankings"]}>
          <AppContextProvider>
            <RankingsPage />
          </AppContextProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(await screen.findByRole("button", { name: "本周流行歌手" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上升最快歌手" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新碟榜" })).toBeInTheDocument();
  });
});
