import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const VIEWPORTS = [
  { key: "desktop", width: 1512, height: 982 },
  { key: "tablet", width: 980, height: 1194 },
  { key: "mobile", width: 440, height: 956 }
];

const PRE_CAPTURE_WAIT_MS = 15_000;

const FRAME_FILES = {
  wish: "01-me-movie-wish.png",
  doing: "02-me-movie-doing.png",
  done: "03-me-movie-done.png",
  search: "04-search.png",
  rankings: "05-rankings.png",
  timeline: "06-timeline.png",
  timelineExpanded: "07-timeline-expanded.png",
  settings: "08-settings.png",
  detailTop: "09-detail-top.png",
  detailBottom: "10-detail-bottom.png"
};

const TAB_LABELS = {
  movie: "\u7535\u5f71",
  wish: "\u60f3\u770b",
  doing: "\u5728\u770b",
  done: "\u770b\u8fc7",
  reply: "\u56de\u590d"
};

function normalizeSearchTerm(title) {
  return String(title ?? "")
    .split("/")
    .map((part) => part.trim())
    .find(Boolean) ?? String(title ?? "").trim();
}

async function waitForPageSettled(page, waitMs = 700) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(waitMs);
}

async function resetViewportDir(viewportDir) {
  await rm(viewportDir, { recursive: true, force: true });
  await mkdir(viewportDir, { recursive: true });
}

async function gotoPath(page, baseUrl, pathname) {
  await page.goto(new URL(pathname, baseUrl).toString());
  await waitForPageSettled(page);
}

async function applyPrivacyMask(page) {
  await page.evaluate(() => {
    const styleId = "readme-tour-privacy-mask";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
        .readme-tour-mask-text {
          display: inline-flex !important;
          align-items: center !important;
          min-height: 1em !important;
          padding: 0.1em 0.5em !important;
          border-radius: 999px !important;
          background: #d8e2d8 !important;
          color: transparent !important;
          text-shadow: none !important;
          user-select: none !important;
        }
        .readme-tour-mask-block {
          border-radius: 18px !important;
          background: #d8e2d8 !important;
          color: transparent !important;
          text-shadow: none !important;
          user-select: none !important;
        }
        .readme-tour-mask-avatar,
        .readme-tour-mask-avatar img,
        .readme-tour-mask-avatar span {
          background: #d8e2d8 !important;
          color: transparent !important;
          border-color: transparent !important;
          text-shadow: none !important;
        }
        .readme-tour-mask-avatar img,
        .readme-tour-mask-avatar span {
          opacity: 0 !important;
        }
      `;
      document.head.appendChild(style);
    }

    const applyMaskText = (selector, replacement = "hidden") => {
      for (const element of document.querySelectorAll(selector)) {
        element.textContent = replacement;
        element.classList.add("readme-tour-mask-text");
      }
    };

    const applyMaskAvatar = (selector) => {
      for (const element of document.querySelectorAll(selector)) {
        element.classList.add("readme-tour-mask-avatar");
        if (element instanceof HTMLElement) {
          const rect = element.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) {
            continue;
          }
          element.style.overflow = "hidden";
        }
      }
    };

    applyMaskText(".desktop-sidebar__account strong");
    applyMaskText(".desktop-sidebar__account small");
    applyMaskText(".profile-hero__info h1");
    applyMaskText(".profile-hero__id");
    applyMaskText(".profile-hero__session");
    applyMaskText(".settings-session-panel .supporting");
    applyMaskText(".login-page__session-banner .panel__header p");
    applyMaskText(".timeline-card__header strong");
    applyMaskText(".timeline-comments__meta a");
    applyMaskText(".timeline-comments__meta strong");
    applyMaskText(".comment-card__identity strong");
    applyMaskText(".detail-my-rating__summary strong");
    applyMaskText(".detail-my-rating__comment p");
    applyMaskText(".comments-panel .form-error");

    applyMaskAvatar(".desktop-sidebar__avatar");
    applyMaskAvatar(".profile-hero__avatar");
    applyMaskAvatar(".timeline-card__avatar");
    applyMaskAvatar(".timeline-comments__avatar");
    applyMaskAvatar(".comment-card__avatar");
  });
}

async function saveFrame(page, outputPath) {
  await page.waitForTimeout(PRE_CAPTURE_WAIT_MS);
  await applyPrivacyMask(page);
  await page.screenshot({ path: outputPath });
}

async function clickRoleButton(page, label) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await waitForPageSettled(page);
}

async function chooseMovieMedium(page) {
  const movieButton = page.getByRole("button", { name: TAB_LABELS.movie, exact: true });
  await movieButton.waitFor({ state: "visible" });
  const pressed = await movieButton.getAttribute("aria-pressed").catch(() => null);
  if (pressed !== "true") {
    await movieButton.click();
    await waitForPageSettled(page);
  }
}

async function captureMeFrames(page, baseUrl, viewportDir) {
  await gotoPath(page, baseUrl, "/me");
  await chooseMovieMedium(page);

  await clickRoleButton(page, TAB_LABELS.wish);
  await saveFrame(page, path.join(viewportDir, FRAME_FILES.wish));

  await clickRoleButton(page, TAB_LABELS.doing);
  await saveFrame(page, path.join(viewportDir, FRAME_FILES.doing));

  await clickRoleButton(page, TAB_LABELS.done);
  await saveFrame(page, path.join(viewportDir, FRAME_FILES.done));

  const cards = await page.locator(".subject-card").evaluateAll((elements) =>
    elements.slice(0, 12).map((element) => {
      const heading = element.querySelector("h3");
      const link = element.closest("a") ?? element;
      return {
        title: heading?.textContent?.trim() ?? "",
        href: link.getAttribute("href") ?? "",
        text: element.textContent ?? ""
      };
    })
  );

  const candidates = cards.filter((card) => card.href && card.title).filter((card) => !card.text.includes("\u672a\u8bc4\u5206"));
  let chosen = null;
  for (const candidate of candidates) {
    const detailApiUrl = new URL(candidate.href, baseUrl);
    detailApiUrl.pathname = detailApiUrl.pathname.replace(/^\/subject\//, "/api/subjects/");
    const detail = await page.evaluate(async (href) => {
      const response = await fetch(href, { credentials: "include" });
      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok) {
        throw new Error(`Failed to load subject detail candidate: ${response.status}`);
      }
      if (!contentType.includes("application/json")) {
        throw new Error(`Expected JSON from ${href}, got ${contentType || "unknown content-type"}`);
      }
      return response.json();
    }, detailApiUrl.toString());
    if (detail?.userItem) {
      chosen = candidate;
      break;
    }
    if (!chosen) {
      chosen = candidate;
    }
  }
  chosen ??= cards[0] ?? null;
  if (!chosen?.href || !chosen.title) {
    throw new Error("Unable to choose a detail candidate from the done list.");
  }

  return {
    detailHref: new URL(chosen.href, baseUrl).toString(),
    detailTitle: chosen.title,
    searchTerm: normalizeSearchTerm(chosen.title)
  };
}

async function captureSearchFrame(page, baseUrl, viewportDir, searchTerm) {
  await gotoPath(page, baseUrl, "/search");
  await chooseMovieMedium(page);
  const input = page.locator("input").first();
  await input.waitFor({ state: "visible" });
  await input.fill(searchTerm);
  await waitForPageSettled(page, 1200);
  await saveFrame(page, path.join(viewportDir, FRAME_FILES.search));
}

async function captureRankingsFrame(page, baseUrl, viewportDir) {
  await gotoPath(page, baseUrl, "/rankings");
  await chooseMovieMedium(page);
  await saveFrame(page, path.join(viewportDir, FRAME_FILES.rankings));
}

async function captureTimelineFrames(page, baseUrl, viewportDir) {
  await gotoPath(page, baseUrl, "/timeline");
  await saveFrame(page, path.join(viewportDir, FRAME_FILES.timeline));

  const replyButtons = page.locator(`button[aria-label^="${TAB_LABELS.reply}"]:not([disabled])`);
  if ((await replyButtons.count()) > 0) {
    await replyButtons.first().click();
    await waitForPageSettled(page, 1000);
    await saveFrame(page, path.join(viewportDir, FRAME_FILES.timelineExpanded));
    return { expandedCaptured: true };
  }

  return { expandedCaptured: false };
}

async function captureSettingsFrame(page, baseUrl, viewportDir) {
  await gotoPath(page, baseUrl, "/settings");
  await page.evaluate(() => window.scrollTo(0, 0));
  await waitForPageSettled(page, 300);
  await saveFrame(page, path.join(viewportDir, FRAME_FILES.settings));
}

async function captureDetailFrames(page, viewportDir, detailHref, timelineExpandedCaptured) {
  await page.goto(detailHref);
  await waitForPageSettled(page, 1200);
  await page.evaluate(() => window.scrollTo(0, 0));
  await waitForPageSettled(page, 300);

  if (!timelineExpandedCaptured) {
    const fallbackAnchorY = await page.evaluate(() => {
      const candidate =
        document.querySelector(".detail-related-grid") ??
        document.querySelector(".detail-media-grid") ??
        document.querySelector(".detail-staff-grid") ??
        document.querySelector(".detail-list-wrap") ??
        document.querySelector(".detail-list") ??
        document.querySelector(".comments-panel") ??
        null;
      if (!candidate) {
        return 640;
      }
      const rect = candidate.getBoundingClientRect();
      return Math.max(0, Math.round(rect.top + window.scrollY - 80));
    });
    await page.evaluate((anchorY) => window.scrollTo(0, anchorY), fallbackAnchorY);
    await waitForPageSettled(page, 700);
    await saveFrame(page, path.join(viewportDir, FRAME_FILES.timelineExpanded));
    await page.evaluate(() => window.scrollTo(0, 0));
    await waitForPageSettled(page, 300);
  }

  await saveFrame(page, path.join(viewportDir, FRAME_FILES.detailTop));

  const bottomAnchorY = await page.evaluate(() => {
    const candidate =
      document.querySelector(".detail-related-grid") ??
      document.querySelector(".detail-media-grid") ??
      document.querySelector(".detail-staff-grid") ??
      document.querySelector(".detail-list-wrap") ??
      document.querySelector(".detail-list") ??
      document.querySelector(".comments-panel") ??
      null;
    if (!candidate) {
      return 780;
    }
    const rect = candidate.getBoundingClientRect();
    return Math.max(0, Math.round(rect.top + window.scrollY - 80));
  });
  await page.evaluate((anchorY) => window.scrollTo(0, anchorY), bottomAnchorY);
  await waitForPageSettled(page, 700);
  await saveFrame(page, path.join(viewportDir, FRAME_FILES.detailBottom));
}

export async function captureReadmeTour(page, { workspaceRoot, baseUrl }) {
  if (!workspaceRoot) {
    throw new Error("workspaceRoot is required");
  }
  if (!baseUrl) {
    throw new Error("baseUrl is required");
  }

  const outputRoot = path.join(workspaceRoot, "output", "readme-tour");
  await mkdir(outputRoot, { recursive: true });

  let detailHref = null;
  let searchTerm = null;
  let detailTitle = null;
  const results = [];

  for (const viewport of VIEWPORTS) {
    const viewportDir = path.join(outputRoot, viewport.key);
    await resetViewportDir(viewportDir);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    const meSelection = await captureMeFrames(page, baseUrl, viewportDir);
    if (!detailHref) {
      detailHref = meSelection.detailHref;
      searchTerm = meSelection.searchTerm;
      detailTitle = meSelection.detailTitle;
    }

    await captureSearchFrame(page, baseUrl, viewportDir, searchTerm);
    await captureRankingsFrame(page, baseUrl, viewportDir);
    const timelineState = await captureTimelineFrames(page, baseUrl, viewportDir);
    await captureSettingsFrame(page, baseUrl, viewportDir);
    await captureDetailFrames(page, viewportDir, detailHref, timelineState.expandedCaptured);

    results.push({
      viewport: viewport.key,
      size: { width: viewport.width, height: viewport.height },
      detailHref,
      detailTitle,
      searchTerm,
      timelineExpandedCaptured: timelineState.expandedCaptured
    });
  }

  const summaryPath = path.join(outputRoot, "summary.json");
  await writeFile(summaryPath, JSON.stringify(results, null, 2), "utf8");
  return {
    outputRoot,
    detailHref,
    detailTitle,
    searchTerm,
    results
  };
}
