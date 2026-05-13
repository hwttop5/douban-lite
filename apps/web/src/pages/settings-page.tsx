import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import type { DoubanSessionStatus, SyncJobRecord } from "../../../../packages/shared/src";
import { getAuthMe, getSyncJob, logoutDoubanSession, triggerManualSync } from "../api";
import { useAppContext } from "../app-context";
import { LoadingButtonLabel, LoadingInline, PanelLoading } from "../components/loading-state";
import { buildLoginPath, getRelativeLocation } from "../login-routing";

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

export function SettingsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const { showTimelineNav, setShowTimelineNav, showRankingsNav, setShowRankingsNav } = useAppContext();

  const statusQuery = useQuery({
    queryKey: ["auth-me"],
    queryFn: getAuthMe,
    retry: false
  });

  const auth = statusQuery.data;
  const sessionStatus = auth?.sessionStatus.status ?? "missing";

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
        <section className="page-header">
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
      <section className="page-header">
        <p className="eyebrow">设置</p>
        <h1>偏好设置</h1>
        <p className="supporting">会话状态、菜单显示和同步任务分区管理。</p>
      </section>

      {statusQuery.error ? <p className="form-error">{statusQuery.error.message}</p> : null}

      <div className="settings-page__content">
        <div className="settings-page__column">
          <section className="panel settings-session-panel">
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
        </div>
      </div>
    </div>
  );
}
