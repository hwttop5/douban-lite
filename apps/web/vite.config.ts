import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";

const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const devTargetsFile = join(workspaceRoot, ".codex-run", "dev-targets.json");
const defaultApiProxyTarget = "http://127.0.0.1:8787";

function resolveApiProxyTarget() {
  const explicitTarget = process.env.VITE_API_PROXY_TARGET?.trim();
  if (explicitTarget) {
    return explicitTarget;
  }
  try {
    const raw = readFileSync(devTargetsFile, "utf8");
    const parsed = JSON.parse(raw) as { apiTarget?: unknown };
    if (typeof parsed.apiTarget === "string" && /^https?:\/\//.test(parsed.apiTarget)) {
      return parsed.apiTarget;
    }
  } catch {
    // Fall back to the documented default when no local API marker is available.
  }
  return defaultApiProxyTarget;
}

const apiProxyTarget = resolveApiProxyTarget();

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "douban-lite",
        short_name: "douban-lite",
        description: "单用户、移动优先的豆瓣轻量 PWA",
        theme_color: "#173222",
        background_color: "#eef4ef",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable"
          }
        ]
      },
      workbox: {
        runtimeCaching: [
          {
            urlPattern: /\/api\/(me\/overview|library|rankings|subjects)/,
            handler: "NetworkFirst",
            options: {
              cacheName: "douban-lite-api",
              expiration: {
                maxEntries: 40,
                maxAgeSeconds: 60 * 60 * 24
              }
            }
          }
        ]
      }
    })
  ],
  test: {
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"]
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true
      },
      "/health": {
        target: apiProxyTarget,
        changeOrigin: true
      }
    }
  }
});
