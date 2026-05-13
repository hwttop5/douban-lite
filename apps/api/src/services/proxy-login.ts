import { randomUUID } from "node:crypto";
import type {
  DoubanProxyLoginErrorCode,
  DoubanProxyLoginFallback,
  DoubanProxyLoginMode,
  DoubanProxyLoginNextAction,
  DoubanProxyLoginStatus,
  DoubanProxyLoginStatusResponse,
  DoubanProxyVerificationMethod,
  DoubanSupportedCountry
} from "../../../../packages/shared/src";
import { DoubanClient } from "../douban/client";

interface ProxyLoginOptions {
  accountsBaseUrl: string;
  attemptTtlMinutes: number;
  rateLimitPerIp: number;
}

interface LoginAttempt {
  id: string;
  status: DoubanProxyLoginStatus;
  expiresAt: Date;
  cookieJar: CookieJar;
  errorCode: DoubanProxyLoginErrorCode | null;
  message: string | null;
  nextAction: DoubanProxyLoginNextAction;
  verificationMethod: DoubanProxyVerificationMethod;
  maskedTarget: string | null;
  resendAvailableAt: Date | null;
  phoneNumber: string | null;
  country: DoubanSupportedCountry;
  mode: DoubanProxyLoginMode | null;
}

interface CookieCarrier {
  cookieJar: CookieJar;
}

interface SubmitPasswordInput {
  loginAttemptId: string;
  account: string;
  password: string;
  countryCode?: string;
}

interface SendSmsInput {
  loginAttemptId: string;
  phoneNumber: string;
  countryCode?: string;
}

interface VerifySmsInput {
  loginAttemptId: string;
  smsCode: string;
}

interface SubmitResult extends DoubanProxyLoginStatusResponse {
  cookie?: string;
}

interface LoginPageSnapshot {
  supportedCountries: DoubanSupportedCountry[];
  defaultCountry: DoubanSupportedCountry;
}

interface ParsedLoginResponse {
  status: string;
  messageCode: string;
  description: string;
  localizedMessage: string;
  payload: Record<string, unknown>;
  rawText: string;
}

const COOKIE_IMPORT_FALLBACKS: DoubanProxyLoginFallback[] = ["cookie_import"];
const LOGIN_PAGE_CACHE_MS = 10 * 60 * 1000;
const DEFAULT_RETRY_AFTER_SECONDS = 60;
const FALLBACK_COUNTRIES: DoubanSupportedCountry[] = [
  {
    label: "中国",
    englishLabel: "China",
    areaCode: "+86",
    countryCode: "CN"
  }
];

class CookieJar {
  private readonly cookies = new Map<string, string>();

  addFromHeaders(headers: Headers) {
    const getSetCookie = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
    const values = typeof getSetCookie === "function" ? getSetCookie.call(headers) : [headers.get("set-cookie")].filter(Boolean) as string[];
    values.forEach((value) => this.add(value));
  }

  add(setCookie: string) {
    const [pair] = setCookie.split(";");
    const separator = pair.indexOf("=");
    if (separator <= 0) {
      return;
    }
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (name.length === 0) {
      return;
    }
    this.cookies.set(name, value);
  }

  get(name: string) {
    return this.cookies.get(name) ?? null;
  }

  toHeader() {
    return Array.from(this.cookies.entries()).map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

export class ProxyLoginAttemptNotFoundError extends Error {
  constructor() {
    super("代理登录会话不存在。");
  }
}

export class ProxyLoginService {
  private readonly attempts = new Map<string, LoginAttempt>();
  private readonly ipAttempts = new Map<string, number[]>();
  private loginPageCache: { expiresAt: number; snapshot: LoginPageSnapshot } | null = null;

  constructor(
    private readonly client: DoubanClient,
    private readonly options: ProxyLoginOptions
  ) {}

  async getClientConfig() {
    const snapshot = await this.loadLoginPageSnapshot();
    return {
      supportedCountries: snapshot.supportedCountries,
      defaultCountryCode: snapshot.defaultCountry.countryCode,
      availableModes: ["sms", "password"] as const
    };
  }

  async start(ipAddress: string): Promise<DoubanProxyLoginStatusResponse> {
    this.cleanupExpired();
    this.checkRateLimit(ipAddress);
    const snapshot = await this.loadLoginPageSnapshot();
    const attempt: LoginAttempt = {
      id: randomUUID(),
      status: "created",
      expiresAt: new Date(Date.now() + this.options.attemptTtlMinutes * 60 * 1000),
      cookieJar: new CookieJar(),
      errorCode: null,
      message: null,
      nextAction: "none",
      verificationMethod: "none",
      maskedTarget: null,
      resendAvailableAt: null,
      phoneNumber: null,
      country: snapshot.defaultCountry,
      mode: null
    };
    this.attempts.set(attempt.id, attempt);
    await this.initializeLoginPage(attempt);
    return this.snapshot(attempt);
  }

  getStatus(loginAttemptId: string): DoubanProxyLoginStatusResponse | null {
    this.cleanupExpired();
    const attempt = this.attempts.get(loginAttemptId);
    return attempt ? this.snapshot(attempt) : null;
  }

  cancel(loginAttemptId: string): DoubanProxyLoginStatusResponse | null {
    this.cleanupExpired();
    const attempt = this.attempts.get(loginAttemptId);
    if (!attempt) {
      return null;
    }
    attempt.status = "cancelled";
    attempt.errorCode = null;
    attempt.message = null;
    attempt.nextAction = "none";
    attempt.verificationMethod = "none";
    attempt.resendAvailableAt = null;
    return this.snapshot(attempt);
  }

  claim(loginAttemptId: string) {
    const attempt = this.attempts.get(loginAttemptId);
    if (attempt) {
      attempt.status = "claimed";
      this.attempts.delete(loginAttemptId);
    }
  }

  async submitPassword(input: SubmitPasswordInput): Promise<SubmitResult> {
    this.cleanupExpired();
    const attempt = this.requireActiveAttempt(input.loginAttemptId);
    if (!("cookieJar" in attempt)) {
      return attempt;
    }
    attempt.mode = "password";
    attempt.country = await this.resolveCountry(input.countryCode);
    this.prepareSubmission(attempt, "enter_password", "none");

    try {
      const body = new URLSearchParams({
        ck: attempt.cookieJar.get("ck") ?? "",
        name: input.countryCode ? `${attempt.country.areaCode}${input.account}` : input.account,
        password: input.password,
        remember: "false",
        ticket: ""
      });
      if (input.countryCode) {
        body.set("country_code", attempt.country.areaCode);
      }

      const response = await this.request(attempt, `${this.options.accountsBaseUrl}/j/mobile/login/basic`, {
        method: "POST",
        headers: this.formHeaders(attempt),
        body: body.toString()
      });

      const record = this.parseLoginResponse(response.text);
      if (!this.isSuccess(record)) {
        return this.handlePasswordFailure(attempt, record);
      }
      return this.authorizeAttempt(attempt);
    } catch (error) {
      return this.failAttempt(attempt, "douban_unavailable", "无法连接豆瓣登录服务，请稍后重试。", "enter_password", "none", error);
    }
  }

  async sendSmsCode(input: SendSmsInput): Promise<DoubanProxyLoginStatusResponse> {
    this.cleanupExpired();
    const attempt = this.requireActiveAttempt(input.loginAttemptId);
    if (!("cookieJar" in attempt)) {
      return attempt;
    }
    attempt.mode = "sms";
    attempt.country = await this.resolveCountry(input.countryCode);
    attempt.phoneNumber = input.phoneNumber.trim();
    attempt.maskedTarget = maskPhoneNumber(attempt.country.areaCode, attempt.phoneNumber);

    const retryAfterSeconds = this.computeRetryAfterSeconds(attempt);
    if (retryAfterSeconds > 0) {
      attempt.status = "needs_verification";
      attempt.errorCode = "sms_cooldown";
      attempt.message = `验证码已发送至 ${attempt.maskedTarget}，请在 ${retryAfterSeconds} 秒后重试。`;
      attempt.nextAction = "wait_retry";
      attempt.verificationMethod = "sms";
      return this.snapshot(attempt);
    }

    this.prepareSubmission(attempt, "send_sms", "sms");

    try {
      const body = new URLSearchParams({
        ck: attempt.cookieJar.get("ck") ?? "",
        area_code: attempt.country.areaCode,
        number: attempt.phoneNumber,
        analytics: "analytics_log"
      });

      const response = await this.request(attempt, `${this.options.accountsBaseUrl}/j/mobile/login/request_phone_code`, {
        method: "POST",
        headers: this.formHeaders(attempt),
        body: body.toString()
      });

      const record = this.parseLoginResponse(response.text);
      if (!this.isSuccess(record)) {
        return this.handleSmsSendFailure(attempt, record);
      }

      attempt.status = "needs_verification";
      attempt.errorCode = null;
      attempt.message = `验证码已发送至 ${attempt.maskedTarget}。`;
      attempt.nextAction = "enter_sms_code";
      attempt.verificationMethod = "sms";
      attempt.resendAvailableAt = new Date(Date.now() + this.extractRetryAfterSeconds(record) * 1000);
      return this.snapshot(attempt);
    } catch (error) {
      return this.failAttempt(attempt, "douban_unavailable", "发送 SMS 验证码失败，请稍后重试。", "send_sms", "sms", error);
    }
  }

  async verifySmsCode(input: VerifySmsInput): Promise<SubmitResult> {
    this.cleanupExpired();
    const attempt = this.requireActiveAttempt(input.loginAttemptId);
    if (!("cookieJar" in attempt)) {
      return attempt;
    }
    if (!attempt.phoneNumber) {
      return this.blockAttempt(attempt, "security_challenge", "当前登录状态不完整，请重新获取 SMS 验证码。", "send_sms", "sms");
    }
    attempt.mode = "sms";
    this.prepareSubmission(attempt, "enter_sms_code", "sms");

    try {
      const body = new URLSearchParams({
        ck: attempt.cookieJar.get("ck") ?? "",
        area_code: attempt.country.areaCode,
        number: attempt.phoneNumber,
        code: input.smsCode.trim()
      });

      const response = await this.request(attempt, `${this.options.accountsBaseUrl}/j/mobile/login/verify_phone_code`, {
        method: "POST",
        headers: this.formHeaders(attempt),
        body: body.toString()
      });

      const record = this.parseLoginResponse(response.text);
      if (!this.isSuccess(record)) {
        return this.handleSmsVerifyFailure(attempt, record);
      }

      const accountInfo = getRecord(record.payload.account_info);
      if (accountInfo && !accountInfo.id) {
        return this.blockAttempt(attempt, "registration_required", "该手机号需要继续注册或补充资料，请改用 Cookie 导入。", "use_cookie_import", "sms");
      }

      return this.authorizeAttempt(attempt);
    } catch (error) {
      return this.failAttempt(attempt, "douban_unavailable", "验证 SMS 验证码失败，请稍后重试。", "enter_sms_code", "sms", error);
    }
  }

  private async initializeLoginPage(attempt: LoginAttempt) {
    try {
      const response = await this.request(attempt, `${this.options.accountsBaseUrl}/passport/login`, {
        method: "GET",
        headers: {
          accept: "text/html,application/xhtml+xml"
        }
      });
      this.updateLoginPageCache(response.text);
    } catch {
      // The auth steps will return the definitive error if initialization fails.
    }
  }

  private async loadLoginPageSnapshot() {
    const now = Date.now();
    if (this.loginPageCache && this.loginPageCache.expiresAt > now) {
      return this.loginPageCache.snapshot;
    }

    const response = await this.request(
      { cookieJar: new CookieJar() },
      `${this.options.accountsBaseUrl}/passport/login`,
      {
        method: "GET",
        headers: {
          accept: "text/html,application/xhtml+xml"
        }
      }
    );

    return this.updateLoginPageCache(response.text);
  }

  private updateLoginPageCache(html: string) {
    const snapshot = parseLoginPage(html);
    this.loginPageCache = {
      snapshot,
      expiresAt: Date.now() + LOGIN_PAGE_CACHE_MS
    };
    return snapshot;
  }

  private async resolveCountry(countryCode?: string) {
    const snapshot = await this.loadLoginPageSnapshot();
    if (!countryCode) {
      return snapshot.defaultCountry;
    }
    return snapshot.supportedCountries.find((item) => item.countryCode === countryCode) ?? snapshot.defaultCountry;
  }

  private formHeaders(attempt: CookieCarrier) {
    const ck = attempt.cookieJar.get("ck") ?? "";
    return {
      accept: "application/json, text/javascript, */*; q=0.01",
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-requested-with": "XMLHttpRequest",
      "x-csrf-token": ck,
      referer: `${this.options.accountsBaseUrl}/passport/login`
    };
  }

  private prepareSubmission(
    attempt: LoginAttempt,
    nextAction: DoubanProxyLoginNextAction,
    verificationMethod: DoubanProxyVerificationMethod
  ) {
    attempt.status = "submitting";
    attempt.errorCode = null;
    attempt.message = null;
    attempt.nextAction = nextAction;
    attempt.verificationMethod = verificationMethod;
  }

  private async authorizeAttempt(attempt: LoginAttempt): Promise<SubmitResult> {
    const cookie = attempt.cookieJar.toHeader();
    try {
      await this.client.validateSession(cookie);
    } catch {
      return this.failAttempt(attempt, "login_not_verified", "豆瓣没有返回可用会话，请改用 Cookie 导入。", "use_cookie_import", attempt.verificationMethod);
    }
    attempt.status = "authorized";
    attempt.message = null;
    attempt.errorCode = null;
    attempt.nextAction = "none";
    return { ...this.snapshot(attempt), cookie };
  }

  private handlePasswordFailure(attempt: LoginAttempt, record: ParsedLoginResponse): SubmitResult {
    if (record.messageCode === "captcha_required" || containsCaptchaText(record)) {
      return this.blockAttempt(attempt, "needs_captcha", "豆瓣要求图形验证，请改用 Cookie 导入。", "use_cookie_import", "captcha");
    }
    if (containsSmsText(record)) {
      return this.blockAttempt(attempt, "needs_sms", "该账号需要改用手机号 + SMS 登录。", "send_sms", "sms");
    }
    if (isSecurityChallenge(record)) {
      return this.blockAttempt(attempt, "security_challenge", "豆瓣触发了安全验证，请改用 Cookie 导入。", "use_cookie_import", "none");
    }
    attempt.status = "failed";
    attempt.errorCode = "invalid_credentials";
    attempt.message = this.extractUserMessage(record) ?? "账号或密码错误。";
    attempt.nextAction = "enter_password";
    attempt.verificationMethod = "none";
    return this.snapshot(attempt);
  }

  private handleSmsSendFailure(attempt: LoginAttempt, record: ParsedLoginResponse) {
    if (record.messageCode === "captcha_required" || containsCaptchaText(record)) {
      return this.blockAttempt(attempt, "needs_captcha", "豆瓣要求图形验证，请改用 Cookie 导入。", "use_cookie_import", "captcha");
    }
    if (isSecurityChallenge(record)) {
      return this.blockAttempt(attempt, "security_challenge", "豆瓣触发了设备或账号安全验证，请改用 Cookie 导入。", "use_cookie_import", "none");
    }
    attempt.status = "failed";
    attempt.errorCode = null;
    attempt.message = this.extractUserMessage(record) ?? "发送 SMS 验证码失败。";
    attempt.nextAction = "send_sms";
    attempt.verificationMethod = "sms";
    return this.snapshot(attempt);
  }

  private handleSmsVerifyFailure(attempt: LoginAttempt, record: ParsedLoginResponse): SubmitResult {
    if (record.messageCode === "captcha_required" || containsCaptchaText(record)) {
      return this.blockAttempt(attempt, "needs_captcha", "豆瓣要求图形验证，请改用 Cookie 导入。", "use_cookie_import", "captcha");
    }
    if (isSecurityChallenge(record)) {
      return this.blockAttempt(attempt, "security_challenge", "豆瓣触发了设备或账号安全验证，请改用 Cookie 导入。", "use_cookie_import", "none");
    }
    attempt.status = "needs_verification";
    attempt.errorCode = containsCodeText(record) ? "invalid_sms_code" : null;
    attempt.message = this.extractUserMessage(record) ?? "SMS 验证码不正确，请重新输入。";
    attempt.nextAction = "enter_sms_code";
    attempt.verificationMethod = "sms";
    return this.snapshot(attempt);
  }

  private blockAttempt(
    attempt: LoginAttempt,
    errorCode: DoubanProxyLoginErrorCode,
    message: string,
    nextAction: DoubanProxyLoginNextAction,
    verificationMethod: DoubanProxyVerificationMethod
  ) {
    attempt.status = "blocked";
    attempt.errorCode = errorCode;
    attempt.message = message;
    attempt.nextAction = nextAction;
    attempt.verificationMethod = verificationMethod;
    return this.snapshot(attempt);
  }

  private failAttempt(
    attempt: LoginAttempt,
    errorCode: DoubanProxyLoginErrorCode,
    message: string,
    nextAction: DoubanProxyLoginNextAction,
    verificationMethod: DoubanProxyVerificationMethod,
    error?: unknown
  ) {
    attempt.status = "failed";
    attempt.errorCode = errorCode;
    attempt.message = message;
    attempt.nextAction = nextAction;
    attempt.verificationMethod = verificationMethod;
    return this.snapshot(attempt);
  }

  private computeRetryAfterSeconds(attempt: LoginAttempt) {
    if (!attempt.resendAvailableAt) {
      return 0;
    }
    return Math.max(0, Math.ceil((attempt.resendAvailableAt.getTime() - Date.now()) / 1000));
  }

  private parseLoginResponse(text: string): ParsedLoginResponse {
    let payload: unknown = null;
    try {
      payload = JSON.parse(text);
    } catch {
      // Some failure cases return HTML.
    }

    const record = getRecord(payload);
    return {
      status: String(record?.status ?? record?.r ?? "").toLowerCase(),
      messageCode: String(record?.message ?? record?.error ?? "").toLowerCase(),
      description: String(record?.description ?? ""),
      localizedMessage: String(record?.localized_message ?? ""),
      payload: getRecord(record?.payload),
      rawText: text
    };
  }

  private isSuccess(record: ParsedLoginResponse) {
    return record.status === "success" || record.status === "ok";
  }

  private extractUserMessage(record: ParsedLoginResponse) {
    return record.localizedMessage || record.description || null;
  }

  private extractRetryAfterSeconds(record: ParsedLoginResponse) {
    const payload = record.payload;
    const numeric = Number(payload.retry_after ?? payload.retryAfter ?? payload.seconds ?? payload.ttl);
    if (Number.isFinite(numeric) && numeric > 0) {
      return Math.floor(numeric);
    }
    const text = `${record.localizedMessage} ${record.description}`;
    const matched = text.match(/(\d{1,3})\s*秒/);
    return matched ? Number(matched[1]) : DEFAULT_RETRY_AFTER_SECONDS;
  }

  private async request(attempt: CookieCarrier, url: string, options: RequestInit, redirectCount = 0): Promise<{ text: string; url: string; status: number }> {
    const response = await fetch(url, {
      redirect: "manual",
      ...options,
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
        cookie: attempt.cookieJar.toHeader(),
        ...options.headers
      }
    });
    attempt.cookieJar.addFromHeaders(response.headers);

    if (response.status >= 300 && response.status < 400 && redirectCount < 5) {
      const location = response.headers.get("location");
      if (location) {
        return this.request(attempt, new URL(location, url).toString(), { method: "GET", headers: options.headers }, redirectCount + 1);
      }
    }

    const text = await response.text();
    if ((!response.ok && response.status < 300) || response.status >= 400) {
      throw new Error(`豆瓣登录请求失败：${response.status}`);
    }
    return { text, url: response.url, status: response.status };
  }

  private requireActiveAttempt(loginAttemptId: string): LoginAttempt | DoubanProxyLoginStatusResponse {
    const attempt = this.attempts.get(loginAttemptId);
    if (!attempt) {
      throw new ProxyLoginAttemptNotFoundError();
    }
    if (attempt.expiresAt.getTime() <= Date.now()) {
      this.markExpired(attempt);
      return this.snapshot(attempt);
    }
    return attempt;
  }

  private snapshot(attempt: LoginAttempt): DoubanProxyLoginStatusResponse {
    return {
      loginAttemptId: attempt.id,
      status: attempt.status,
      expiresAt: attempt.expiresAt.toISOString(),
      errorCode: attempt.errorCode,
      message: attempt.message,
      nextAction: attempt.nextAction,
      verificationMethod: attempt.verificationMethod,
      maskedTarget: attempt.maskedTarget,
      retryAfterSeconds: this.computeRetryAfterSeconds(attempt) || null,
      availableFallbacks: COOKIE_IMPORT_FALLBACKS
    };
  }

  private cleanupExpired() {
    const now = Date.now();
    const retentionMs = 30 * 60 * 1000;
    for (const [id, attempt] of this.attempts.entries()) {
      if (attempt.expiresAt.getTime() <= now) {
        this.markExpired(attempt);
        if (now - attempt.expiresAt.getTime() > retentionMs) {
          this.attempts.delete(id);
        }
      }
    }
  }

  private markExpired(attempt: LoginAttempt) {
    attempt.status = "expired";
    attempt.errorCode = "attempt_expired";
    attempt.message = "代理登录会话已过期，请重新开始。";
    attempt.nextAction = "none";
    attempt.verificationMethod = "none";
    attempt.resendAvailableAt = null;
  }

  private checkRateLimit(ipAddress: string) {
    if (this.options.rateLimitPerIp <= 0) {
      return;
    }
    const now = Date.now();
    const windowStart = now - 15 * 60 * 1000;
    const timestamps = (this.ipAttempts.get(ipAddress) ?? []).filter((timestamp) => timestamp > windowStart);
    if (timestamps.length >= this.options.rateLimitPerIp) {
      throw new Error("代理登录尝试过于频繁，请稍后再试。");
    }
    timestamps.push(now);
    this.ipAttempts.set(ipAddress, timestamps);
  }
}

function parseLoginPage(html: string): LoginPageSnapshot {
  const configMatch = html.match(/window\._CONFIG\s*=\s*(\{[\s\S]*?\})\s*;/);
  if (!configMatch) {
    return {
      supportedCountries: FALLBACK_COUNTRIES,
      defaultCountry: FALLBACK_COUNTRIES[0]
    };
  }

  try {
    const config = JSON.parse(configMatch[1]) as Record<string, unknown>;
    const rawSupported = config.supported_countries;
    const parsedSupported = typeof rawSupported === "string"
      ? JSON.parse(decodeHtmlEntities(rawSupported))
      : Array.isArray(rawSupported)
        ? rawSupported
        : [];

    const supportedCountries = Array.isArray(parsedSupported)
      ? parsedSupported
        .map(toSupportedCountry)
        .filter((item): item is DoubanSupportedCountry => item != null)
      : [];

    return {
      supportedCountries: supportedCountries.length > 0 ? supportedCountries : FALLBACK_COUNTRIES,
      defaultCountry: supportedCountries.length > 0 ? supportedCountries[0] : FALLBACK_COUNTRIES[0]
    };
  } catch {
    return {
      supportedCountries: FALLBACK_COUNTRIES,
      defaultCountry: FALLBACK_COUNTRIES[0]
    };
  }
}

function toSupportedCountry(value: unknown): DoubanSupportedCountry | null {
  if (!Array.isArray(value) || value.length < 4) {
    return null;
  }
  const [label, englishLabel, areaCode, countryCode] = value;
  if (![label, englishLabel, areaCode, countryCode].every((item) => typeof item === "string" && item.length > 0)) {
    return null;
  }
  return {
    label,
    englishLabel,
    areaCode,
    countryCode
  };
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&#34;/g, "\"")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'");
}

function getRecord(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function containsCaptchaText(record: ParsedLoginResponse) {
  const text = `${record.messageCode} ${record.description} ${record.localizedMessage} ${record.rawText}`.toLowerCase();
  return text.includes("captcha") || text.includes("图形验证") || text.includes("验证码校验");
}

function containsSmsText(record: ParsedLoginResponse) {
  const text = `${record.messageCode} ${record.description} ${record.localizedMessage} ${record.rawText}`.toLowerCase();
  return text.includes("sms") || text.includes("短信");
}

function containsCodeText(record: ParsedLoginResponse) {
  const text = `${record.messageCode} ${record.description} ${record.localizedMessage} ${record.rawText}`.toLowerCase();
  return text.includes("验证码") || text.includes("code");
}

function isSecurityChallenge(record: ParsedLoginResponse) {
  return [
    "unexpect_account_status",
    "uncommon_loc_login",
    "recycled_user"
  ].includes(record.messageCode);
}

function maskPhoneNumber(areaCode: string, phoneNumber: string) {
  if (phoneNumber.length < 7) {
    return `${areaCode} ${phoneNumber}`;
  }
  return `${areaCode} ${phoneNumber.slice(0, 3)}****${phoneNumber.slice(-4)}`;
}
