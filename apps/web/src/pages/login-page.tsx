import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { proxiedImageUrl } from "../api";
import { LoadingButtonLabel, LoadingInline, PanelLoading } from "../components/loading-state";
import {
  getProxyErrorTone,
  getProxyMessageTone,
  getSmsSendButtonLabel,
  useDoubanLoginController
} from "../hooks/use-douban-login-controller";
import { resolveLoginSuccessPath } from "../login-routing";

type LoginTab = "sms" | "password" | "cookie";

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
            在桌面 Chrome 或 Edge 打开任意一个已登录豆瓣页面，按 <code>F12</code> 打开开发者工具，进入 <code>Application</code> 或{" "}
            <code>Storage</code>，再打开 <code>Cookies</code> 里的 <code>douban.com</code>。
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
  const [activeTab, setActiveTab] = useState<LoginTab>("sms");
  const [didAutoStartQr, setDidAutoStartQr] = useState(false);
  const postLoginPath = resolveLoginSuccessPath(location.search);
  const controller = useDoubanLoginController({
    onAuthenticated: () => navigate(postLoginPath, { replace: true })
  });

  const auth = controller.authQuery.data;
  const sessionStatus = auth?.sessionStatus.status ?? "missing";
  const hasDoubanSession = auth?.authenticated && sessionStatus === "valid";
  const currentAccountLabel = auth?.user?.displayName ?? auth?.sessionStatus.displayName ?? "豆瓣用户";
  const currentAccountMeta = auth?.user?.ipLocation ?? auth?.sessionStatus.ipLocation ?? "未知地区";
  const isSmsAvailable = controller.proxyLoginEnabled && controller.availableModes.includes("sms");
  const isPasswordAvailable = controller.proxyLoginEnabled && controller.availableModes.includes("password");
  const isQrAvailable = controller.proxyLoginEnabled && controller.availableModes.includes("qr");
  const secondaryMutationError =
    activeTab === "sms"
      ? controller.smsSendMutation.error ?? controller.smsVerifyMutation.error
      : activeTab === "password"
        ? controller.passwordLoginMutation.error
        : null;
  const qrError = controller.qrStartMutation.error ?? controller.qrStatusQuery.error;
  const qrMessage = controller.proxyResult?.verificationMethod === "qr" ? controller.proxyResult.message : null;
  const qrMessageTone = getProxyMessageTone(controller.proxyResult);
  const qrImageSrc = proxiedImageUrl(controller.currentQrCodeImageUrl);
  const showQrWarning = controller.proxyResult?.verificationMethod === "qr" && Boolean(qrMessage);
  const showSecondaryResult =
    controller.proxyResult &&
    activeTab !== "cookie" &&
    controller.currentFlowMode === activeTab &&
    (controller.proxyResult.verificationMethod !== "qr" || controller.proxyResult.status === "claimed");
  const secondaryResult = showSecondaryResult ? controller.proxyResult : null;
  const secondaryResultMessage = secondaryResult?.message ?? null;

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

  const renderProxyUnavailable = (mode: Exclude<LoginTab, "cookie">) => {
    if (controller.proxyConfigQuery.isPending && !controller.proxyConfigQuery.data) {
      return (
        <p className="loading-row">
          <LoadingInline label="正在准备代理登录" tone="soft" />
        </p>
      );
    }

    if (!controller.proxyLoginEnabled) {
      return <p className="notice notice--subtle">当前环境未启用代理登录，请使用导入 Cookie 登录。</p>;
    }

    return (
      <p className="notice notice--subtle">
        {mode === "sms" ? "当前环境暂不支持短信验证登录，请改用账号密码登录或导入 Cookie 登录。" : "当前环境暂不支持账号密码登录，请改用短信验证登录或导入 Cookie 登录。"}
      </p>
    );
  };

  if (controller.authQuery.isPending && !controller.authQuery.data && controller.proxyConfigQuery.isPending && !controller.proxyConfigQuery.data) {
    return (
      <div className="page login-page">
        <section className="page-header">
          <p className="eyebrow">登录</p>
          <h1>登录</h1>
          <p className="supporting">登录连接到豆瓣。</p>
        </section>
        <PanelLoading title="正在准备登录页" detail="当前会话状态和代理登录配置会一起加载。" />
      </div>
    );
  }

  return (
    <div className="page login-page">
      <section className="page-header">
        <p className="eyebrow">登录</p>
        <h1>登录</h1>
        <p className="supporting">登录连接到豆瓣。</p>
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

        <section className="panel login-page__qr-panel">
          <div className="panel__header">
            <div>
              <strong>二维码登录</strong>
              <p>用另一台已安装豆瓣 App 的手机扫码。遇到风控或异常时，请改用导入 Cookie 登录。</p>
            </div>
          </div>

          {!isQrAvailable ? (
            <p className="notice notice--subtle">当前环境暂不支持二维码登录，请改用下方其它登录方式。</p>
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
                <p className={showQrWarning ? qrMessageTone : "notice notice--subtle"}>{qrMessage ?? getQrStatusText(controller.proxyResult?.qrStatus)}</p>
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
        </section>

        <section className="panel login-page__panel">
          <div className="panel__header">
            <div>
              <strong>其它登录方式</strong>
              <p>短信验证、账号密码和导入 Cookie 都保留在这里，作为次级入口和兜底。</p>
            </div>
          </div>

          <div className="settings-auth-tabs login-page__tabs" role="tablist" aria-label="登录方式">
            <button
              className={activeTab === "sms" ? "settings-auth-tab is-active" : "settings-auth-tab"}
              type="button"
              role="tab"
              aria-selected={activeTab === "sms"}
              onClick={() => setActiveTab("sms")}
            >
              短信验证登录
            </button>
            <button
              className={activeTab === "password" ? "settings-auth-tab is-active" : "settings-auth-tab"}
              type="button"
              role="tab"
              aria-selected={activeTab === "password"}
              onClick={() => setActiveTab("password")}
            >
              账号密码登录
            </button>
            <button
              className={activeTab === "cookie" ? "settings-auth-tab is-active" : "settings-auth-tab"}
              type="button"
              role="tab"
              aria-selected={activeTab === "cookie"}
              onClick={() => setActiveTab("cookie")}
            >
              导入 Cookie 登录
            </button>
          </div>

          {activeTab === "sms" ? (
            isSmsAvailable ? (
              <div className="settings-auth-panel settings-auth-panel--sms">
                <p className="notice notice--subtle">
                  只支持已有账号的手机号 + SMS 验证码登录。如果豆瓣要求图形验证、设备验证、补充资料或其它非标准挑战，请直接改用导入 Cookie 登录。
                </p>
                <label className="field">
                  <span>国家或地区</span>
                  <select value={controller.smsCountryCode} onChange={(event) => controller.setSmsCountryCode(event.target.value)}>
                    {controller.supportedCountries.map((country) => (
                      <option key={country.countryCode} value={country.countryCode}>
                        {country.label} {country.areaCode}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>手机号</span>
                  <input
                    value={controller.smsPhoneNumber}
                    onChange={(event) => controller.setSmsPhoneNumber(event.target.value)}
                    autoComplete="tel"
                    inputMode="tel"
                    placeholder="输入手机号"
                  />
                </label>
                <div className="settings-code-row">
                  <label className="field settings-code-row__field">
                    <span>SMS 验证码</span>
                    <div className="settings-code-row__control">
                      <input
                        value={controller.smsCode}
                        onChange={(event) => controller.setSmsCode(event.target.value)}
                        autoComplete="one-time-code"
                        inputMode="numeric"
                        placeholder="输入 6 位验证码"
                      />
                      <button
                        className="secondary-button settings-code-row__button"
                        type="button"
                        onClick={() => controller.smsSendMutation.mutate()}
                        disabled={controller.smsSendMutation.isPending || !controller.canSendSmsCode}
                      >
                        {controller.smsSendMutation.isPending ? (
                          <LoadingButtonLabel label="发送中" />
                        ) : (
                          getSmsSendButtonLabel(controller.smsRetryAfterSeconds, controller.hasSentSmsCode)
                        )}
                      </button>
                    </div>
                  </label>
                </div>
                <div className="settings-actions settings-actions--import">
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => controller.smsVerifyMutation.mutate()}
                    disabled={controller.smsVerifyMutation.isPending || !controller.canVerifySmsCode}
                  >
                    {controller.smsVerifyMutation.isPending ? <LoadingButtonLabel label="登录中" /> : "确认登录"}
                  </button>
                </div>
              </div>
            ) : (
              renderProxyUnavailable("sms")
            )
          ) : null}

          {activeTab === "password" ? (
            isPasswordAvailable ? (
              <div className="settings-auth-panel settings-auth-panel--password">
                <p className="notice notice--subtle">
                  账号密码不会被持久化保存。如果豆瓣要求 SMS、图形验证或设备安全验证，请切换到短信验证登录，或直接导入 Cookie 登录。
                </p>
                <label className="field">
                  <span>账号</span>
                  <input
                    value={controller.proxyAccount}
                    onChange={(event) => controller.setProxyAccount(event.target.value)}
                    autoComplete="username"
                    placeholder="手机号或邮箱"
                  />
                </label>
                <label className="field">
                  <span>密码</span>
                  <input
                    value={controller.proxyPassword}
                    onChange={(event) => controller.setProxyPassword(event.target.value)}
                    autoComplete="current-password"
                    type="password"
                    placeholder="豆瓣密码"
                  />
                </label>
                <div className="settings-actions settings-actions--import">
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => controller.passwordLoginMutation.mutate()}
                    disabled={controller.passwordLoginMutation.isPending || !controller.canSubmitPassword}
                  >
                    {controller.passwordLoginMutation.isPending ? <LoadingButtonLabel label="登录中" /> : "确认登录"}
                  </button>
                </div>
              </div>
            ) : (
              renderProxyUnavailable("password")
            )
          ) : null}

          {activeTab === "cookie" ? (
            <div className="settings-auth-panel settings-auth-panel--cookie">
              <p className="notice notice--subtle">适合切换账号、刷新会话，或在代理登录遇到风控时作为稳定兜底入口。</p>
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

          {secondaryResultMessage ? <p className={getProxyMessageTone(secondaryResult)}>{secondaryResultMessage}</p> : null}
          {secondaryMutationError ? <p className={getProxyErrorTone(secondaryMutationError)}>{secondaryMutationError.message}</p> : null}
        </section>
      </div>
    </div>
  );
}
