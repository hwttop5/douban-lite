import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import type { DoubanSessionStatus, SyncJobRecord } from "../../../../packages/shared/src";
import { getAuthMe, getHealth, getSyncJob, logoutDoubanSession, RENDER_DEMO_WARNING_MESSAGE, triggerManualSync } from "../api";
import { useAppContext } from "../app-context";
import { LoadingButtonLabel, LoadingInline, PanelLoading } from "../components/loading-state";
import { buildLoginPath, getRelativeLocation } from "../login-routing";

const GITHUB_REPOSITORY_URL = "https://github.com/hwttop5/douban-lite";

const sessionStatusLabels: Record<DoubanSessionStatus["status"], string> = {
  valid: "正常",
  invalid: "已失效",
  missing: "未导入"
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function triggerAndWaitForSync() {
  const job = await triggerManualSync();
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const latest = await getSyncJob(job.id);
    if (latest.status === "completed" || latest.status === "failed") {
      return latest;
    }
    await sleep(1000);
  }
  return { ...job, status: "running" as const };
}

function GitHubIcon() {
  return (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.21 11.39.6.11.79-.26.79-.58v-2.23c-3.34.73-4.03-1.42-4.03-1.42-.55-1.38-1.33-1.75-1.33-1.75-1.09-.75.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.49 1 .11-.77.42-1.3.76-1.6-2.67-.31-5.47-1.34-5.47-5.93 0-1.31.47-2.39 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23.96-.27 1.99-.4 3.01-.4 1.02 0 2.05.13 3.01.4 2.29-1.55 3.3-1.23 3.3-1.23.65 1.66.24 2.88.12 3.18.76.83 1.23 1.91 1.23 3.22 0 4.6-2.8 5.62-5.48 5.92.43.37.82 1.1.82 2.22v3.29c0 .32.19.69.8.58C20.57 21.8 24 17.3 24 12 24 5.37 18.63 0 12 0Z" />
    </svg>
  );
}

export function SettingsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const { showTimelineNav, setShowTimelineNav, showRankingsNav, setShowRankingsNav } = useAppContext();
  const handleBack = () => {
    if (location.key !== "default") {
      navigate(-1);
      return;
    }
    navigate("/me", { replace: true });
  };

  const statusQuery = useQuery({
    queryKey: ["auth-me"],
    queryFn: getAuthMe,
    retry: false
  });
  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: getHealth,
    retry: false
  });

  const auth = statusQuery.data;
  const sessionStatus = auth?.sessionStatus.status ?? "missing";
  const showRenderDemoWarning = healthQuery.data?.deploymentMode === "render-demo";

  const logoutMutation = useMutation({
    mutationFn: logoutDoubanSession,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["auth-me"] }),
        queryClient.invalidateQueries({ queryKey: ["douban-session-status"] }),
        queryClient.invalidateQueries({ queryKey: ["overview"] }),
        queryClient.invalidateQueries({ queryKey: ["library"] }),
        queryClient.invalidateQueries({ queryKey: ["timeline"] })
      ]);
    }
  });

  const syncMutation = useMutation({
    mutationFn: triggerAndWaitForSync,
    onMutate: () => {
      setSyncMessage("正在同步，请稍等...");
    },
    onSuccess: async (job: SyncJobRecord) => {
      if (job.status === "completed") {
        setSyncMessage("同步完成，已刷新本地镜像。");
      } else if (job.status === "failed") {
        setSyncMessage(`同步失败：${job.errorMessage ?? "未知错误"}`);
      } else {
        setSyncMessage("同步任务已提交，后台仍在继续处理。");
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["overview"] }),
        queryClient.invalidateQueries({ queryKey: ["library"] }),
        queryClient.invalidateQueries({ queryKey: ["auth-me"] }),
        queryClient.invalidateQueries({ queryKey: ["douban-session-status"] })
      ]);
    },
    onError: (error) => {
      setSyncMessage(`同步失败：${error instanceof Error ? error.message : "未知错误"}`);
    }
  });

  if (statusQuery.isPending && !statusQuery.data) {
    return (
      <div className="page settings-page">
        <button className="detail-back-button" type="button" onClick={handleBack} aria-label="返回">
          <span>‹</span>
        </button>
        <section className="page-header page-header--with-back-button">
          <p className="eyebrow">设置</p>
          <h1>偏好设置</h1>
          <p className="supporting">会话状态、菜单显示和同步任务分区管理。</p>
        </section>
        <PanelLoading title="正在检查账号" detail="会话状态、本地菜单偏好和同步入口会一起加载。" />
        <PanelLoading title="正在准备设置页" detail="界面会在准备完成后再展示可操作内容。" />
        <PanelLoading title="正在连接同步任务" detail="最近一次同步状态和手动触发入口马上可用。" />
      </div>
    );
  }

  return (
    <div className="page settings-page">
      <button className="detail-back-button" type="button" onClick={handleBack} aria-label="返回">
        <span>‹</span>
      </button>
      <section className="page-header page-header--with-back-button">
        <p className="eyebrow">设置</p>
        <h1>偏好设置</h1>
        <p className="supporting">会话状态、菜单显示和同步任务分区管理。</p>
      </section>

      {statusQuery.error ? <p className="form-error">{statusQuery.error.message}</p> : null}

      <div className="settings-page__content">
        <div className="settings-page__column">
          <section className="panel settings-session-panel">
            {showRenderDemoWarning ? <p className="notice">{RENDER_DEMO_WARNING_MESSAGE}</p> : null}
            <div className="panel__header">
              <div>
                <strong>豆瓣会话状态</strong>
                <p>
                  {sessionStatus === "valid"
                    ? "当前豆瓣会话可用，可以同步、抓取和写回。"
                    : "当前没有可用豆瓣会话，请前往登录页完成登录后再同步个人数据。"}
                </p>
              </div>
              <span className={`pill pill--${sessionStatus}`}>{sessionStatusLabels[sessionStatus]}</span>
            </div>
            {auth?.user?.displayName ? <p className="supporting">当前账号：{auth.user.displayName}</p> : null}
            {auth?.sessionStatus.lastError ? <p className="form-error">{auth.sessionStatus.lastError}</p> : null}
            {logoutMutation.error ? <p className="form-error">{logoutMutation.error.message}</p> : null}
            {sessionStatus === "valid" ? (
              <div className="settings-actions">
                <button
                  className="secondary-button secondary-button--danger"
                  type="button"
                  onClick={() => logoutMutation.mutate()}
                  disabled={logoutMutation.isPending}
                >
                  {logoutMutation.isPending ? <LoadingButtonLabel label="退出中" /> : "退出登录"}
                </button>
              </div>
            ) : null}
          </section>

          <section className="panel settings-menu-panel">
            <div className="panel__header">
              <div>
                <strong>菜单显示</strong>
                <p>动态和榜单可以按本机偏好隐藏，默认显示。</p>
              </div>
            </div>
            <label className="switch-row">
              <span>
                <strong>显示动态</strong>
                <small>只查看自己和关注的人的最近动态</small>
              </span>
              <input type="checkbox" checked={showTimelineNav} onChange={(event) => setShowTimelineNav(event.target.checked)} />
              <i className="switch-control" />
            </label>
            <label className="switch-row">
              <span>
                <strong>显示榜单</strong>
                <small>榜单内容每天最多刷新一次</small>
              </span>
              <input type="checkbox" checked={showRankingsNav} onChange={(event) => setShowRankingsNav(event.target.checked)} />
              <i className="switch-control" />
            </label>
          </section>
        </div>

        <div className="settings-page__column">
          <section className="panel settings-sync-panel">
            <div className="panel__header">
              <div>
                <strong>同步任务</strong>
                <p>手动触发一次全量拉取，后台会继续串行处理写回队列。</p>
              </div>
              <div className="settings-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => {
                    if (sessionStatus !== "valid") {
                      navigate(buildLoginPath(getRelativeLocation(location)));
                      return;
                    }
                    syncMutation.mutate();
                  }}
                  disabled={sessionStatus === "valid" && syncMutation.isPending}
                >
                  {sessionStatus !== "valid" ? "请先登录" : syncMutation.isPending ? <LoadingButtonLabel label="同步中" /> : "立即同步"}
                </button>
              </div>
            </div>
            {syncMutation.isPending ? (
              <p className="loading-row">
                <LoadingInline label="同步队列运行中" tone="soft" />
              </p>
            ) : syncMessage ? (
              <p className={syncMessage.includes("失败") ? "form-error" : "notice"}>{syncMessage}</p>
            ) : null}
          </section>

          <section className="panel settings-project-panel">
            <div className="panel__header">
              <div>
                <strong>项目仓库</strong>
                <p>源码、Issue 和更新记录都在这里维护。</p>
              </div>
            </div>
            <a
              className="settings-project-link"
              href={GITHUB_REPOSITORY_URL}
              target="_blank"
              rel="noreferrer"
              aria-labelledby="settings-github-link-label"
              aria-describedby="settings-github-link-description"
            >
              <span className="settings-project-link__icon">
                <GitHubIcon />
              </span>
              <span className="settings-project-link__body">
                <strong id="settings-github-link-label">GitHub 仓库</strong>
                <span id="settings-github-link-description">查看源码、Issue 和更新记录</span>
              </span>
              <span className="settings-project-link__arrow" aria-hidden="true">
                ↗
              </span>
            </a>
          </section>
        </div>
      </div>
    </div>
  );
}
