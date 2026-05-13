import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { AppContextProvider } from "../app-context";
import { SearchPage } from "./search-page";

function renderSearchPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <AppContextProvider>
          <SearchPage />
        </AppContextProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("SearchPage", () => {
  it("uses Chinese placeholder examples", () => {
    renderSearchPage();

    expect(screen.getByPlaceholderText("比如：霸王别姬 / 红楼梦 / 范特西")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Sea Change/i)).not.toBeInTheDocument();
  });
});
