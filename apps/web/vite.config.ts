import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";

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
        target: process.env.VITE_API_PROXY_TARGET ?? "http://localhost:8787",
        changeOrigin: true
      },
      "/health": {
        target: process.env.VITE_API_PROXY_TARGET ?? "http://localhost:8787",
        changeOrigin: true
      }
    }
  }
});
