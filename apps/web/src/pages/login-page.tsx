import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { proxiedImageUrl } from "../api";
import { LoadingButtonLabel, LoadingInline, PanelLoading } from "../components/loading-state";
import { getProxyErrorTone, getProxyMessageTone, useDoubanLoginController } from "../hooks/use-douban-login-controller";
import { resolveLoginSuccessPath } from "../login-routing";

type LoginTab = "qr" | "cookie";

function CookieLoginGuide() {
  return (
    <div className="settings-guide login-page__guide" aria-label="Cookie 获取说明">
      <strong>如何获取 Cookie 并在 PWA 里登录</strong>
      <p className="supporting settings-guide__intro">
        douban-lite 不会直接读取系统浏览器里的豆瓣登录态。你需要先在已经登录豆瓣的 Chrome 或 Edge 里复制 Cookie，再回到这里导入。
      </p>

      <ol className="guide-steps">
        <li className="guide-step">
          <strong>获取 Cookie</strong>
          <p>
            在桌面 Chrome 或 Edge 打开任意一个已经登录豆瓣的页面，按 <code>F12</code> 打开开发者工具，进入 <code>Application</code> 或 <code>Storage</code>，
            再打开 <code>Cookies</code> 里的 <code>douban.com</code>。
          </p>
          <p>
            把需要的项按 <code>name=value</code> 拼成一行，用分号和空格连接，例如 <code>dbcl2=...; ck=...;</code>，然后粘贴回本页。
          </p>
        </li>
        <li className="guide-step">
          <strong>在 PWA 里登录</strong>
          <p>留在这个登录页，把复制好的 Cookie 粘贴到输入框，点击“导入并登录”。后端会校验 Cookie，并为当前设备写入 douban-lite 自己的会话。</p>
        </li>
        <li className="guide-step">
          <strong>Cookie 失效后重新登录</strong>
          <p>如果你看到会话失效、同步失败，或豆瓣要求重新验证，请回到浏览器复制最新 Cookie，再回到这里重新导入。旧 Cookie 不建议继续复用。</p>
        </li>
      </ol>

      <div className="guide-tips" role="note" aria-label="安全提示">
        <strong>安全提示</strong>
        <ul>
          <li>只在你自己信任的自部署实例里粘贴豆瓣 Cookie。</li>
          <li>导入成功后，前端使用的是 douban-lite 自己的会话，不需要长期保留原始豆瓣 Cookie。</li>
        </ul>
      </div>
    </div>
  );
}

function getQrStatusText(status: string | null | undefined) {
  switch (status) {
    case "scan":
      return "扫码成功，请在手机上确认登录。";
    case "login":
      return "正在确认登录...";
    case "invalid":
      return "二维码已失效，请刷新后重试。";
    case "cancel":
      return "手机端已取消登录，请刷新后重试。";
    default:
      return "请打开豆瓣 App 扫码登录。";
  }
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState<LoginTab>("qr");
  const [didAutoStartQr, setDidAutoStartQr] = useState(false);
  const postLoginPath = resolveLoginSuccessPath(location.search);
  const handleBack = () => {
    if (location.key !== "default") {
      navigate(-1);
      return;
    }
    navigate(postLoginPath, { replace: true });
  };
  const controller = useDoubanLoginController({
    onAuthenticated: () => navigate(postLoginPath, { replace: true })
  });

  const auth = controller.authQuery.data;
  const sessionStatus = auth?.sessionStatus.status ?? "missing";
  const hasDoubanSession = auth?.authenticated && sessionStatus === "valid";
  const currentAccountLabel = auth?.user?.displayName ?? auth?.sessionStatus.displayName ?? "豆瓣用户";
  const currentAccountMeta = auth?.user?.ipLocation ?? auth?.sessionStatus.ipLocation ?? "未知地区";
  const isQrAvailable = controller.proxyLoginEnabled && controller.availableModes.includes("qr");
  const qrResult =
    controller.currentFlowMode === "qr" || controller.proxyResult?.verificationMethod === "qr" ? controller.proxyResult : null;
  const qrError = controller.qrStartMutation.error ?? controller.qrStatusQuery.error;
  const qrMessage = qrResult?.message ?? null;
  const qrMessageTone = getProxyMessageTone(qrResult);
  const qrImageSrc = proxiedImageUrl(controller.currentQrCodeImageUrl);

  useEffect(() => {
    if (didAutoStartQr || !isQrAvailable) {
      return;
    }
    if (controller.qrStartMutation.isPending || qrImageSrc) {
      return;
    }
    setDidAutoStartQr(true);
    controller.qrStartMutation.mutate();
  }, [controller, didAutoStartQr, isQrAvailable, qrImageSrc]);

  if (controller.authQuery.isPending && !controller.authQuery.data && controller.proxyConfigQuery.isPending && !controller.proxyConfigQuery.data) {
    return (
      <div className="page login-page">
        <button className="detail-back-button" type="button" onClick={handleBack} aria-label="返回">
          <span>‹</span>
        </button>
        <section className="page-header page-header--with-back-button">
          <p className="eyebrow">登录</p>
          <h1>登录</h1>
          <p className="supporting">登录并连接到你的豆瓣。</p>
        </section>
        <PanelLoading title="正在准备登录页" detail="当前会话状态和代理登录配置会一起加载。" />
      </div>
    );
  }

  return (
    <div className="page login-page">
      <button className="detail-back-button" type="button" onClick={handleBack} aria-label="返回">
        <span>‹</span>
      </button>
      <section className="page-header page-header--with-back-button">
        <p className="eyebrow">登录</p>
        <h1>登录</h1>
        <p className="supporting">登录并连接到你的豆瓣。</p>
      </section>

      {controller.authQuery.error ? <p className="form-error">{controller.authQuery.error.message}</p> : null}

      <div className="login-page__content">
        {hasDoubanSession ? (
          <section className="panel login-page__session-banner">
            <div className="panel__header">
              <div>
                <strong>当前已登录账号</strong>
                <p>
                  {currentAccountLabel} / {currentAccountMeta}
                </p>
              </div>
              <span className="pill pill--valid">已登录</span>
            </div>
            <p className="notice notice--subtle">你仍然可以继续切换账号，或导入最新 Cookie 刷新本地会话。</p>
          </section>
        ) : null}

        <section className="panel login-page__panel">
          <div className="panel__header">
            <div>
              <strong>选择登录方式</strong>
              <p>由于豆瓣风控的原因，短信验证登录和账号密码登录暂不可用；默认使用二维码，遇到图片验证或风控时请切到 Cookie 登录。</p>
            </div>
          </div>

          <div className="settings-auth-tabs login-page__tabs" role="tablist" aria-label="登录方式">
            <button
              className={activeTab === "qr" ? "settings-auth-tab is-active" : "settings-auth-tab"}
              type="button"
              role="tab"
              aria-selected={activeTab === "qr"}
              onClick={() => setActiveTab("qr")}
            >
              二维码登录
            </button>
            <button
              className={activeTab === "cookie" ? "settings-auth-tab is-active" : "settings-auth-tab"}
              type="button"
              role="tab"
              aria-selected={activeTab === "cookie"}
              onClick={() => setActiveTab("cookie")}
            >
              Cookie 登录
            </button>
          </div>

          {activeTab === "qr" ? (
            <div className="settings-auth-panel settings-auth-panel--qr">
              <p className="notice notice--subtle">用另一台已安装豆瓣 App 的手机扫码，或者截图保存之后进行扫码。</p>

              {!isQrAvailable ? (
                <p className="notice notice--subtle">当前环境暂不支持二维码登录，请切换到 Cookie 登录。</p>
              ) : (
                <div className="login-page__qr-body">
                  <div className="login-page__qr-card">
                    {controller.qrStartMutation.isPending && !qrImageSrc ? (
                      <p className="loading-row">
                        <LoadingInline label="正在加载二维码" tone="soft" />
                      </p>
                    ) : qrImageSrc ? (
                      <img className="login-page__qr-image" src={qrImageSrc} alt="豆瓣登录二维码" />
                    ) : (
                      <div className="login-page__qr-empty">
                        <p>二维码暂不可用</p>
                        <p>请点击刷新二维码重试。</p>
                      </div>
                    )}
                  </div>

                  <div className="login-page__qr-meta">
                    <p className={qrMessage ? qrMessageTone : "notice notice--subtle"}>{qrMessage ?? getQrStatusText(qrResult?.qrStatus)}</p>
                    {qrError ? <p className={getProxyErrorTone(qrError)}>{qrError.message}</p> : null}
                    <div className="settings-actions settings-actions--import">
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => controller.qrStartMutation.mutate()}
                        disabled={controller.qrStartMutation.isPending}
                      >
                        {controller.qrStartMutation.isPending ? <LoadingButtonLabel label="刷新中" /> : "刷新二维码"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {activeTab === "cookie" ? (
            <div className="settings-auth-panel settings-auth-panel--cookie">
              <p className="notice notice--subtle">适合代理登录遇到图片验证、切换账号或刷新会话时使用。</p>
              <label className="field">
                <span>Cookie</span>
                <textarea
                  value={controller.cookie}
                  onChange={(event) => controller.setCookie(event.target.value)}
                  rows={6}
                  placeholder="dbcl2=...; ck=...;"
                />
              </label>
              {controller.importMutation.error ? <p className={getProxyErrorTone(controller.importMutation.error)}>{controller.importMutation.error.message}</p> : null}
              <div className="settings-actions settings-actions--import">
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => controller.importMutation.mutate()}
                  disabled={controller.importMutation.isPending || !controller.canImportCookie}
                >
                  {controller.importMutation.isPending ? <LoadingButtonLabel label="登录中" /> : "导入并登录"}
                </button>
              </div>
              <CookieLoginGuide />
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
