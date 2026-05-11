import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { OverviewResponse } from "../../../../packages/shared/src";
import * as api from "../api";
import { AppContextProvider } from "../app-context";
import { MyPage } from "./my-page";

describe("MyPage", () => {
  it("renders library items from overview and library queries", async () => {
    vi.spyOn(api, "getOverview").mockResolvedValue({
      totals: [{ medium: "movie", status: "wish", count: 1 }],
      recentItems: [],
      lastSyncJob: null,
      sessionStatus: {
        status: "valid",
        peopleId: "demo-user",
        displayName: "Demo",
        avatarUrl: null,
        lastCheckedAt: null,
        lastError: null
      }
    } satisfies OverviewResponse);

    vi.spyOn(api, "getLibrary").mockResolvedValue({
      items: [
        {
          medium: "movie",
          doubanId: "1292052",
          status: "wish",
          rating: null,
          comment: null,
          tags: [],
          syncToTimeline: true,
          syncState: "synced",
          errorMessage: null,
          updatedAt: new Date().toISOString(),
          lastSyncedAt: new Date().toISOString(),
          lastPushedAt: null,
          subject: {
            medium: "movie",
            doubanId: "1292052",
            title: "肖申克的救赎",
            subtitle: null,
            year: "1994",
            coverUrl: null,
            averageRating: 9.7,
            summary: null,
            creators: ["Frank Darabont"],
            metadata: {},
            updatedAt: new Date().toISOString()
          }
        }
      ],
      pagination: {
        page: 1,
        pageSize: 20,
        total: 1,
        hasMore: false
      }
    });

    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <AppContextProvider>
            <MyPage />
          </AppContextProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(await screen.findByText("肖申克的救赎")).toBeInTheDocument();
  });
});
