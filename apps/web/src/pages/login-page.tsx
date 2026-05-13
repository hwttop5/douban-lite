import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { DoubanProxyLoginMode } from "../../../../packages/shared/src";
import { LoadingButtonLabel, LoadingInline, PanelLoading } from "../components/loading-state";
import {
  getProxyMessageTone,
  getSmsSendButtonLabel,
  useDoubanLoginController
} from "../hooks/use-douban-login-controller";
import { resolveLoginSuccessPath } from "../login-routing";

type LoginTab = DoubanProxyLoginMode | "cookie";

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

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState<LoginTab>("sms");
  const postLoginPath = resolveLoginSuccessPath(location.search);
  const controller = useDoubanLoginController({
    onAuthenticated: () => navigate(postLoginPath, { replace: true })
  });

  const auth = controller.authQuery.data;
  const sessionStatus = auth?.sessionStatus.status ?? "missing";
  const hasDoubanSession = auth?.authenticated && sessionStatus === "valid";
  const currentAccountLabel = auth?.user?.displayName ?? auth?.sessionStatus.displayName ?? "豆瓣用户";
  const currentAccountMeta = auth?.user?.ipLocation ?? auth?.sessionStatus.ipLocation ?? "未知地区";
  const isProxyTab = activeTab !== "cookie";
  const activeProxyMode = activeTab === "cookie" ? null : activeTab;
  const activeProxyModeAvailable =
    activeProxyMode != null && controller.proxyLoginEnabled && controller.availableModes.includes(activeProxyMode);
  const proxyMutationError = isProxyTab
    ? controller.proxyConfigQuery.error ??
      controller.smsSendMutation.error ??
      controller.smsVerifyMutation.error ??
      controller.passwordLoginMutation.error
    : null;

  const renderProxyUnavailable = (mode: DoubanProxyLoginMode) => {
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
                <p>{currentAccountLabel} / {currentAccountMeta}</p>
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
              <p>遇到风控或异常时，请改用导入 Cookie 登录。</p>
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
            activeProxyModeAvailable ? (
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
                    <input
                      value={controller.smsCode}
                      onChange={(event) => controller.setSmsCode(event.target.value)}
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      placeholder="输入 6 位验证码"
                    />
                  </label>
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
            activeProxyModeAvailable ? (
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
              {controller.importMutation.error ? <p className="form-error">{controller.importMutation.error.message}</p> : null}
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

          {isProxyTab && controller.proxyResult && controller.proxyResult.status !== "created" ? (
            <p className={getProxyMessageTone(controller.proxyResult)}>{controller.proxyResult.message}</p>
          ) : null}
          {proxyMutationError ? <p className="form-error">{proxyMutationError.message}</p> : null}
        </section>
      </div>
    </div>
  );
}
