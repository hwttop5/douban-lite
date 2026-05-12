import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DoubanSessionStatus, SyncJobRecord } from "../../../../packages/shared/src";
import { getAuthMe, getSyncJob, importDoubanSession, logoutDoubanSession, triggerManualSync } from "../api";
import { useAppContext } from "../app-context";
import { LoadingButtonLabel, LoadingInline, PanelLoading } from "../components/loading-state";

const sessionStatusLabels: Record<DoubanSessionStatus["status"], string> = {
  valid: "正常",
  invalid: "已失效",
  missing: "未导入"
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function CookieLoginGuide() {
  return (
    <section className="panel settings-guide" aria-label="Cookie 登录引导">
      <strong>如何获取 Cookie 并在 PWA 中登录</strong>
      <p className="supporting settings-guide__intro">
        这个应用不会直接读取你系统浏览器里的豆瓣登录态。你需要先在已登录的 Chrome 或 Edge 里复制 Cookie，再回到这里导入。
      </p>

      <ol className="guide-steps">
        <li className="guide-step">
          <strong>获取 Cookie</strong>
          <p>
            在桌面 Chrome 或 Edge 打开任一已登录的豆瓣页面，按 <code>F12</code> 打开开发者工具，进入
            <code>Application</code> 或 <code>Storage</code>，再打开 <code>Cookies</code> 下的 <code>douban.com</code>。
          </p>
          <p>
            把需要的项按 <code>name=value</code> 形式拼成一行，使用分号和空格连接，例如
            <code>dbcl2=...; ck=...;</code>，然后粘贴回本页。
          </p>
        </li>
        <li className="guide-step">
          <strong>在 PWA 中登录</strong>
          <p>
            回到这个 PWA 的设置页，把复制好的 Cookie 粘贴到输入框，点击“导入并登录”。后端会校验 Cookie，并为当前设备写入
            douban-lite 自己的登录会话。
          </p>
        </li>
        <li className="guide-step">
          <strong>Cookie 失效后重新登录</strong>
          <p>
            如果你看到会话失效、同步失败或豆瓣要求重新验证，请回到浏览器重新复制最新 Cookie，再回来重新导入。旧 Cookie 不建议继续复用。
          </p>
        </li>
      </ol>

      <div className="guide-tips" role="note" aria-label="安全提示">
        <strong>安全提示</strong>
        <ul>
          <li>只在你自己信任的自部署实例里粘贴豆瓣 Cookie。</li>
          <li>导入成功后，前端使用的是 douban-lite 自己的会话，不需要长期保留原始豆瓣 Cookie。</li>
        </ul>
      </div>
    </section>
  );
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
    queryKey: ["auth-me"],
    queryFn: getAuthMe,
    retry: false
  });

  const auth = statusQuery.data;
  const sessionStatus = auth?.sessionStatus.status ?? "missing";
  const showImport = sessionStatus !== "valid";

  const importMutation = useMutation({
    mutationFn: () => importDoubanSession(cookie),
    onSuccess: async () => {
      setCookie("");
      await queryClient.invalidateQueries({ queryKey: ["auth-me"] });
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
      await queryClient.invalidateQueries({ queryKey: ["auth-me"] });
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
      await queryClient.invalidateQueries({ queryKey: ["auth-me"] });
      await queryClient.invalidateQueries({ queryKey: ["douban-session-status"] });
    },
    onError: (error) => {
      setSyncMessage(`同步失败：${error instanceof Error ? error.message : "未知错误"}`);
    }
  });

  const sessionPanel = (
    <section className="panel settings-session-panel">
      <div className="panel__header">
        <div>
          <strong>豆瓣会话状态</strong>
          <p>{sessionStatus === "valid" ? "会话正常，可以抓取和写回。" : "当前没有可用会话，或会话已失效。"}</p>
        </div>
        <span className={`pill pill--${sessionStatus}`}>{sessionStatusLabels[sessionStatus]}</span>
      </div>
      {auth?.user?.displayName ? <p className="supporting">当前账号：{auth.user.displayName}</p> : null}
      {sessionStatus === "valid" ? (
        <p className="notice notice--subtle">如豆瓣会话失效，重新复制最新 Cookie 并再次导入即可。</p>
      ) : null}
      {auth?.sessionStatus.lastError ? <p className="form-error">{auth.sessionStatus.lastError}</p> : null}
      {logoutMutation.error ? <p className="form-error">{logoutMutation.error.message}</p> : null}
      {sessionStatus === "valid" ? (
        <div className="settings-actions">
          <button className="secondary-button secondary-button--danger" type="button" onClick={() => logoutMutation.mutate()} disabled={logoutMutation.isPending}>
            {logoutMutation.isPending ? <LoadingButtonLabel label="退出中" /> : "退出登录"}
          </button>
        </div>
      ) : null}
    </section>
  );

  const menuPanel = (
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

  const importPanel = showImport ? (
    <section className="panel settings-import-panel">
      <strong>导入 Cookie</strong>
      <p className="supporting">把已登录豆瓣浏览器里的 Cookie 粘贴到这里，作为同步节点的登录态。</p>
      <label className="field">
        <span>Cookie</span>
        <textarea value={cookie} onChange={(event) => setCookie(event.target.value)} rows={6} placeholder="dbcl2=...; ck=...;" />
      </label>
      {importMutation.error ? <p className="form-error">{importMutation.error.message}</p> : null}
      <div className="settings-actions settings-actions--import">
        <button className="primary-button" type="button" onClick={() => importMutation.mutate()} disabled={importMutation.isPending || cookie.length < 10}>
          {importMutation.isPending ? <LoadingButtonLabel label="登录中" /> : "导入并登录"}
        </button>
      </div>
    </section>
  ) : null;

  const syncPanel = (
    <section className="panel settings-sync-panel">
      <div className="panel__header">
        <div>
          <strong>同步任务</strong>
          <p>手动触发一次全量拉取，后台会继续串行处理写回队列。</p>
        </div>
        <div className="settings-actions">
          <button className="secondary-button" type="button" onClick={() => syncMutation.mutate()} disabled={sessionStatus !== "valid" || syncMutation.isPending}>
            {sessionStatus !== "valid" ? "请先登录" : syncMutation.isPending ? <LoadingButtonLabel label="同步中" /> : "立即同步"}
          </button>
        </div>
      </div>
      {syncMutation.isPending ? (
        <p className="loading-row"><LoadingInline label="同步队列运行中" tone="soft" /></p>
      ) : syncMessage ? (
        <p className={syncMessage.includes("失败") ? "form-error" : "notice"}>{syncMessage}</p>
      ) : null}
    </section>
  );

  if (statusQuery.isPending && !statusQuery.data) {
    return (
      <div className="page settings-page">
        <section className="page-header">
          <p className="eyebrow">设置</p>
          <h1>偏好设置</h1>
          <p className="supporting">账号、菜单和同步任务分区管理。</p>
        </section>
        <PanelLoading title="正在检查账号" detail="会话状态、本地菜单偏好和同步入口会一起加载。" />
        <PanelLoading title="正在准备设置项" detail="界面会在准备完后再展示可操作内容。" />
        <PanelLoading title="正在连接同步任务" detail="最近一次同步状态和手动触发入口马上可用。" />
      </div>
    );
  }

  return (
    <div className="page settings-page">
      <section className="page-header">
        <p className="eyebrow">设置</p>
        <h1>偏好设置</h1>
        <p className="supporting">账号、菜单和同步任务分区管理。</p>
      </section>

      <div className="settings-page__content">
        {showImport ? (
          <>
            <div className="settings-page__column">
              <CookieLoginGuide />
              {sessionPanel}
            </div>

            <div className="settings-page__column">
              {importPanel}
              {menuPanel}
              {syncPanel}
            </div>
          </>
        ) : (
          <>
            <div className="settings-page__column">
              {menuPanel}
            </div>

            <div className="settings-page__column">
              {syncPanel}
              {sessionPanel}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
