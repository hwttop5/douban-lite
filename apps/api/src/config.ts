import { join } from "node:path";

export interface AppConfig {
  port: number;
  allowedOrigin: string | null;
  dataDir: string;
  databaseFile: string;
  webDistDir: string;
  doubanPublicBaseUrl: string;
  doubanWebBaseUrl: string;
  syncIntervalHours: number;
  disableAutoSync: boolean;
}

export function loadConfig(env = process.env): AppConfig {
  const dataDir = env.DATA_DIR ?? join(process.cwd(), "data");
  return {
    port: Number(env.PORT ?? 8787),
    allowedOrigin: env.WEB_ORIGIN ?? null,
    dataDir,
    databaseFile: join(dataDir, "douban-lite.db"),
    webDistDir: env.WEB_DIST_DIR ?? join(process.cwd(), "apps", "web", "dist"),
    doubanPublicBaseUrl: env.DOUBAN_PUBLIC_BASE_URL ?? "https://m.douban.com",
    doubanWebBaseUrl: env.DOUBAN_WEB_BASE_URL ?? "https://www.douban.com",
    syncIntervalHours: Number(env.SYNC_INTERVAL_HOURS ?? 12),
    disableAutoSync: env.DISABLE_AUTO_SYNC === "true"
  };
}
