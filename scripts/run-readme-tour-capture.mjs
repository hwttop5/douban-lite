import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "file:///C:/Users/ttop5/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";

import { captureReadmeTour } from "./capture-readme-tour.mjs";

function parseArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const match = process.argv.find((value) => value.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = parseArg("base-url", "http://localhost:5177");
const storageStatePath = path.resolve(workspaceRoot, parseArg("storage-state", "output/readme-tour-storage-state.json"));

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ storageState: storageStatePath });
  const page = await context.newPage();
  const result = await captureReadmeTour(page, { workspaceRoot, baseUrl });
  console.log(JSON.stringify(result, null, 2));
  await context.close();
} finally {
  await browser.close();
}
