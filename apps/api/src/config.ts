import { join } from "node:path";

export interface AppConfig {
  port: number;
  allowedOrigin: string | null;
  dataDir: string;
  databaseFile: string;
  webDistDir: string;
  doubanPublicBaseUrl: string;
  doubanWebBaseUrl: string;
  doubanAccountsBaseUrl: string;
  doubanProxyLoginEnabled: boolean;
  doubanProxyLoginAttemptTtlMinutes: number;
  doubanProxyLoginRateLimitPerIp: number;
  syncIntervalHours: number;
  disableAutoSync: boolean;
  appSecret: string;
  sessionTtlDays: number;
  publicSignupMode: "open";
  nodeEnv: string;
}

export function loadConfig(env = process.env): AppConfig {
  const dataDir = env.DATA_DIR ?? join(process.cwd(), "data");
  const nodeEnv = env.NODE_ENV ?? "development";
  const appSecret = env.APP_SECRET ?? (nodeEnv === "production" ? "" : "development-only-douban-lite-secret");
  if (nodeEnv === "production" && appSecret.length === 0) {
    throw new Error("APP_SECRET is required in production.");
  }
  return {
    port: Number(env.PORT ?? 8787),
    allowedOrigin: env.WEB_ORIGIN ?? null,
    dataDir,
    databaseFile: join(dataDir, "douban-lite.db"),
    webDistDir: env.WEB_DIST_DIR ?? join(process.cwd(), "apps", "web", "dist"),
    doubanPublicBaseUrl: env.DOUBAN_PUBLIC_BASE_URL ?? "https://m.douban.com",
    doubanWebBaseUrl: env.DOUBAN_WEB_BASE_URL ?? "https://www.douban.com",
    doubanAccountsBaseUrl: env.DOUBAN_ACCOUNTS_BASE_URL ?? "https://accounts.douban.com",
    doubanProxyLoginEnabled: env.DOUBAN_PROXY_LOGIN_ENABLED == null ? nodeEnv !== "production" : env.DOUBAN_PROXY_LOGIN_ENABLED === "true",
    doubanProxyLoginAttemptTtlMinutes: Number(env.DOUBAN_PROXY_LOGIN_ATTEMPT_TTL_MINUTES ?? 10),
    doubanProxyLoginRateLimitPerIp: Number(env.DOUBAN_PROXY_LOGIN_RATE_LIMIT_PER_IP ?? 5),
    syncIntervalHours: Number(env.SYNC_INTERVAL_HOURS ?? 12),
    disableAutoSync: env.DISABLE_AUTO_SYNC === "true",
    appSecret,
    sessionTtlDays: Number(env.SESSION_TTL_DAYS ?? 30),
    publicSignupMode: "open",
    nodeEnv
  };
}
