import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DoubanSessionStatus, SyncJobRecord } from "../../../../packages/shared/src";
import { getDoubanSessionStatus, getSyncJob, importDoubanSession, logoutDoubanSession, triggerManualSync } from "../api";
import { useAppContext } from "../app-context";

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
  const queryClient = useQueryClient();
  const [cookie, setCookie] = useState("");
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const { showTimelineNav, setShowTimelineNav, showRankingsNav, setShowRankingsNav } = useAppContext();

  const statusQuery = useQuery({
    queryKey: ["douban-session-status"],
    queryFn: getDoubanSessionStatus
  });

  const sessionStatus = statusQuery.data?.status ?? "missing";
  const showImport = sessionStatus !== "valid";

  const importMutation = useMutation({
    mutationFn: () => importDoubanSession(cookie),
    onSuccess: async () => {
      setCookie("");
      await queryClient.invalidateQueries({ queryKey: ["douban-session-status"] });
      await queryClient.invalidateQueries({ queryKey: ["overview"] });
      await queryClient.invalidateQueries({ queryKey: ["library"] });
      await queryClient.invalidateQueries({ queryKey: ["timeline"] });
    }
  });

  const logoutMutation = useMutation({
    mutationFn: logoutDoubanSession,
    onSuccess: async () => {
      setCookie("");
      await queryClient.invalidateQueries({ queryKey: ["douban-session-status"] });
      await queryClient.invalidateQueries({ queryKey: ["overview"] });
      await queryClient.invalidateQueries({ queryKey: ["library"] });
      await queryClient.invalidateQueries({ queryKey: ["timeline"] });
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
      await queryClient.invalidateQueries({ queryKey: ["overview"] });
      await queryClient.invalidateQueries({ queryKey: ["library"] });
      await queryClient.invalidateQueries({ queryKey: ["douban-session-status"] });
    },
    onError: (error) => {
      setSyncMessage(`同步失败：${error instanceof Error ? error.message : "未知错误"}`);
    }
  });

  const sessionPanel = (
    <section className="panel">
      <div className="panel__header">
        <div>
          <strong>豆瓣会话状态</strong>
          <p>{sessionStatus === "valid" ? "会话正常，可以抓取和写回。" : "当前没有可用会话，或会话已失效。"}</p>
        </div>
        <span className={`pill pill--${sessionStatus}`}>{sessionStatusLabels[sessionStatus]}</span>
      </div>
      {statusQuery.data?.displayName ? <p className="supporting">当前账号：{statusQuery.data.displayName}</p> : null}
      {statusQuery.data?.lastError ? <p className="form-error">{statusQuery.data.lastError}</p> : null}
      {logoutMutation.error ? <p className="form-error">{logoutMutation.error.message}</p> : null}
      {sessionStatus === "valid" ? (
        <div className="settings-actions">
          <button className="secondary-button secondary-button--danger" type="button" onClick={() => logoutMutation.mutate()} disabled={logoutMutation.isPending}>
            {logoutMutation.isPending ? "退出中..." : "退出登录"}
          </button>
        </div>
      ) : null}
    </section>
  );

  const menuPanel = (
    <section className="panel">
      <div className="panel__header">
        <div>
          <strong>菜单显示</strong>
          <p>动态和榜单可以按本机偏好隐藏，默认显示。</p>
        </div>
      </div>
      <label className="switch-row">
        <span>
          <strong>显示动态</strong>
          <small>只读查看自己和关注的人动态</small>
        </span>
        <input type="checkbox" checked={showTimelineNav} onChange={(event) => setShowTimelineNav(event.target.checked)} />
        <i className="switch-control" />
      </label>
      <label className="switch-row">
        <span>
          <strong>显示榜单</strong>
          <small>每天最多刷新一次榜单数据</small>
        </span>
        <input type="checkbox" checked={showRankingsNav} onChange={(event) => setShowRankingsNav(event.target.checked)} />
        <i className="switch-control" />
      </label>
    </section>
  );

  return (
    <div className="page settings-page">
      <section className="page-header">
        <p className="eyebrow">设置</p>
        <h1>偏好设置</h1>
        <p className="supporting">账号、菜单和同步任务分区管理。</p>
      </section>

      {showImport ? (
        <section className="panel">
          <strong>导入 Cookie</strong>
          <p className="supporting">把已登录豆瓣浏览器里的 Cookie 粘贴到这里，作为同步节点的登录态。</p>
          <label className="field">
            <span>Cookie</span>
            <textarea value={cookie} onChange={(event) => setCookie(event.target.value)} rows={6} placeholder="dbcl2=...; ck=...;" />
          </label>
          {importMutation.error ? <p className="form-error">{importMutation.error.message}</p> : null}
          <div className="settings-actions">
            <button className="primary-button" type="button" onClick={() => importMutation.mutate()} disabled={importMutation.isPending || cookie.length < 10}>
              {importMutation.isPending ? "登录中..." : "导入并登录"}
            </button>
          </div>
        </section>
      ) : null}

      {sessionPanel}

      <section className="panel">
        <div className="panel__header">
          <div>
            <strong>同步任务</strong>
            <p>手动触发一次全量拉取，后台会继续串行处理写回队列。</p>
          </div>
          <div className="settings-actions">
            <button className="secondary-button" type="button" onClick={() => syncMutation.mutate()} disabled={sessionStatus !== "valid" || syncMutation.isPending}>
              {sessionStatus !== "valid" ? "请先登录" : syncMutation.isPending ? "同步中..." : "立即同步"}
            </button>
          </div>
        </div>
        {syncMessage ? <p className={syncMessage.includes("失败") ? "form-error" : "notice"}>{syncMessage}</p> : null}
      </section>

      {menuPanel}
    </div>
  );
}
