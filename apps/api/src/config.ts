import { join } from "node:path";

export interface AppConfig {
  port: number;
  appPassword: string;
  sessionSecret: string;
  secureCookies: boolean;
  allowedOrigin: string | null;
  dataDir: string;
  databaseFile: string;
  doubanPublicBaseUrl: string;
  doubanWebBaseUrl: string;
  syncIntervalHours: number;
  disableAutoSync: boolean;
}

export function loadConfig(env = process.env): AppConfig {
  const dataDir = env.DATA_DIR ?? join(process.cwd(), "data");
  return {
    port: Number(env.PORT ?? 8787),
    appPassword: env.APP_PASSWORD ?? "douban-lite-dev",
    sessionSecret: env.APP_SESSION_SECRET ?? "douban-lite-secret",
    secureCookies: env.NODE_ENV === "production",
    allowedOrigin: env.WEB_ORIGIN ?? null,
    dataDir,
    databaseFile: join(dataDir, "douban-lite.db"),
    doubanPublicBaseUrl: env.DOUBAN_PUBLIC_BASE_URL ?? "https://m.douban.com",
    doubanWebBaseUrl: env.DOUBAN_WEB_BASE_URL ?? "https://www.douban.com",
    syncIntervalHours: Number(env.SYNC_INTERVAL_HOURS ?? 12),
    disableAutoSync: env.DISABLE_AUTO_SYNC === "true"
  };
}

