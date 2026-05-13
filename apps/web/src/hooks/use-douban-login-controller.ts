import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  DoubanProxyLoginMode,
  DoubanProxyLoginStatusResponse,
  DoubanProxyLoginSubmitResponse,
  DoubanSupportedCountry
} from "../../../../packages/shared/src";
import {
  getAuthMe,
  getDoubanProxyLoginConfig,
  getDoubanProxyLoginStatus,
  importDoubanSession,
  sendDoubanProxySmsCode,
  startDoubanProxyLogin,
  startDoubanProxyQrLogin,
  submitDoubanProxyPassword,
  verifyDoubanProxySmsCode
} from "../api";

const DEFAULT_SUPPORTED_COUNTRIES: DoubanSupportedCountry[] = [
  {
    label: "中国",
    englishLabel: "China",
    areaCode: "+86",
    countryCode: "CN"
  }
];

const DEFAULT_AVAILABLE_MODES: DoubanProxyLoginMode[] = ["qr", "sms", "password"];

type ProxyResult = DoubanProxyLoginStatusResponse | DoubanProxyLoginSubmitResponse;
type ProxyFlowMode = "qr" | "sms" | "password" | null;

function isWarningFallbackErrorCode(errorCode: ProxyResult["errorCode"] | null | undefined) {
  return errorCode === "needs_captcha" || errorCode === "security_challenge";
}

function isTerminalProxyStatus(result: ProxyResult | null) {
  if (!result) {
    return false;
  }
  return ["claimed", "blocked", "failed", "expired", "cancelled"].includes(result.status);
}

function resolveCountryCode(
  countries: DoubanSupportedCountry[],
  currentCountryCode: string,
  defaultCountryCode: string | null | undefined
) {
  if (countries.length === 0) {
    return "CN";
  }
  if (countries.some((item) => item.countryCode === currentCountryCode)) {
    return currentCountryCode;
  }
  if (defaultCountryCode && countries.some((item) => item.countryCode === defaultCountryCode)) {
    return defaultCountryCode;
  }
  return countries[0].countryCode;
}

export function getProxyMessageTone(result: ProxyResult | null) {
  if (!result) {
    return "notice notice--subtle";
  }
  if (isWarningFallbackErrorCode(result.errorCode)) {
    return "notice";
  }
  if (result.status === "blocked" || result.status === "failed" || result.status === "expired") {
    return "form-error";
  }
  return "notice notice--subtle";
}

export function getProxyErrorTone(error: Error | null) {
  if (!error) {
    return "form-error";
  }
  return error.message.includes("图形验证") || error.message.includes("安全验证") ? "notice" : "form-error";
}

export function getSmsSendButtonLabel(retryAfterSeconds: number, hasSentCode: boolean) {
  if (retryAfterSeconds > 0) {
    return `${retryAfterSeconds}s 后重发`;
  }
  return hasSentCode ? "重新发送 SMS 验证码" : "发送 SMS 验证码";
}

interface UseDoubanLoginControllerOptions {
  onAuthenticated?: () => Promise<void> | void;
}

export function useDoubanLoginController({ onAuthenticated }: UseDoubanLoginControllerOptions = {}) {
  const queryClient = useQueryClient();
  const [cookie, setCookie] = useState("");
  const [proxyLoginAttemptId, setProxyLoginAttemptId] = useState<string | null>(null);
  const [proxyResult, setProxyResult] = useState<ProxyResult | null>(null);
  const [currentFlowMode, setCurrentFlowMode] = useState<ProxyFlowMode>(null);
  const [proxyAccount, setProxyAccount] = useState("");
  const [proxyPassword, setProxyPassword] = useState("");
  const [smsCountryCode, setSmsCountryCode] = useState("CN");
  const [smsPhoneNumber, setSmsPhoneNumber] = useState("");
  const [smsCode, setSmsCode] = useState("");
  const [smsRetryAfterSeconds, setSmsRetryAfterSeconds] = useState(0);

  const authQuery = useQuery({
    queryKey: ["auth-me"],
    queryFn: getAuthMe,
    retry: false
  });

  const proxyConfigQuery = useQuery({
    queryKey: ["douban-proxy-login-config"],
    queryFn: getDoubanProxyLoginConfig,
    retry: false
  });

  const supportedCountries = proxyConfigQuery.data?.supportedCountries ?? DEFAULT_SUPPORTED_COUNTRIES;
  const availableModes = proxyConfigQuery.data?.availableModes ?? DEFAULT_AVAILABLE_MODES;
  const proxyLoginEnabled = proxyConfigQuery.data?.enabled ?? false;
  const hasSentSmsCode = proxyResult?.status === "needs_verification" && proxyResult.verificationMethod === "sms";
  const canImportCookie = cookie.trim().length >= 10;
  const canSendSmsCode = smsPhoneNumber.trim().length > 0 && smsRetryAfterSeconds === 0;
  const canVerifySmsCode = hasSentSmsCode && smsCode.trim().length > 0;
  const canSubmitPassword = proxyAccount.trim().length > 0 && proxyPassword.length > 0;
  const currentQrCodeImageUrl = proxyResult?.verificationMethod === "qr" ? proxyResult.qrCodeImageUrl : null;
  const shouldPollQrStatus =
    proxyResult?.verificationMethod === "qr" &&
    proxyResult.nextAction === "poll_qr_status" &&
    !isTerminalProxyStatus(proxyResult);

  useEffect(() => {
    setSmsCountryCode((currentCountryCode) =>
      resolveCountryCode(supportedCountries, currentCountryCode, proxyConfigQuery.data?.defaultCountryCode)
    );
  }, [proxyConfigQuery.data?.defaultCountryCode, supportedCountries]);

  useEffect(() => {
    if (smsRetryAfterSeconds <= 0) {
      return;
    }
    const timer = window.setInterval(() => {
      setSmsRetryAfterSeconds((current) => (current > 0 ? current - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [smsRetryAfterSeconds]);

  async function invalidateUserQueries() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["auth-me"] }),
      queryClient.invalidateQueries({ queryKey: ["douban-session-status"] }),
      queryClient.invalidateQueries({ queryKey: ["overview"] }),
      queryClient.invalidateQueries({ queryKey: ["library"] }),
      queryClient.invalidateQueries({ queryKey: ["timeline"] })
    ]);
  }

  function resetProxyFlow() {
    setProxyLoginAttemptId(null);
    setProxyResult(null);
    setCurrentFlowMode(null);
    setProxyAccount("");
    setProxyPassword("");
    setSmsPhoneNumber("");
    setSmsCode("");
    setSmsRetryAfterSeconds(0);
  }

  async function finishAuthenticatedFlow() {
    setCookie("");
    resetProxyFlow();
    await invalidateUserQueries();
    await onAuthenticated?.();
  }

  async function ensureProxyAttempt() {
    if (proxyLoginAttemptId) {
      return proxyLoginAttemptId;
    }
    const attempt = await startDoubanProxyLogin();
    setProxyLoginAttemptId(attempt.loginAttemptId);
    setProxyResult(attempt);
    return attempt.loginAttemptId;
  }

  async function handleProxyResult(result: ProxyResult) {
    setProxyResult(result);
    setProxyLoginAttemptId(result.status === "claimed" ? null : result.loginAttemptId);
    setSmsRetryAfterSeconds(result.retryAfterSeconds ?? 0);

    if (result.status === "claimed") {
      await finishAuthenticatedFlow();
      return;
    }

    if (result.status === "expired" || result.status === "cancelled") {
      setProxyLoginAttemptId(null);
    }
  }

  const importMutation = useMutation({
    mutationFn: () => importDoubanSession(cookie),
    onSuccess: async () => {
      await finishAuthenticatedFlow();
    }
  });

  const qrStartMutation = useMutation({
    onMutate: () => {
      setCurrentFlowMode("qr");
    },
    mutationFn: async () => {
      const loginAttemptId = await ensureProxyAttempt();
      return startDoubanProxyQrLogin({ loginAttemptId });
    },
    onSuccess: async (result) => {
      await handleProxyResult(result);
    }
  });

  const qrStatusQuery = useQuery({
    queryKey: ["douban-proxy-login-status", proxyLoginAttemptId, proxyResult?.qrCode ?? null],
    queryFn: async () => getDoubanProxyLoginStatus(proxyLoginAttemptId!),
    enabled: Boolean(proxyLoginAttemptId && shouldPollQrStatus),
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: shouldPollQrStatus ? Math.max(1, proxyResult?.pollIntervalSeconds ?? 3) * 1000 : false
  });

  useEffect(() => {
    if (!qrStatusQuery.data) {
      return;
    }
    void handleProxyResult(qrStatusQuery.data);
  }, [qrStatusQuery.data]);

  const smsSendMutation = useMutation({
    onMutate: () => {
      setCurrentFlowMode("sms");
    },
    mutationFn: async () => {
      const loginAttemptId = await ensureProxyAttempt();
      return sendDoubanProxySmsCode({
        loginAttemptId,
        phoneNumber: smsPhoneNumber,
        countryCode: smsCountryCode
      });
    },
    onSuccess: async (result) => {
      setSmsCode("");
      await handleProxyResult(result);
    }
  });

  const smsVerifyMutation = useMutation({
    onMutate: () => {
      setCurrentFlowMode("sms");
    },
    mutationFn: async () => {
      const loginAttemptId = await ensureProxyAttempt();
      return verifyDoubanProxySmsCode({
        loginAttemptId,
        smsCode
      });
    },
    onSuccess: async (result) => {
      await handleProxyResult(result);
    }
  });

  const passwordLoginMutation = useMutation({
    onMutate: () => {
      setCurrentFlowMode("password");
    },
    mutationFn: async () => {
      const loginAttemptId = await ensureProxyAttempt();
      return submitDoubanProxyPassword({
        loginAttemptId,
        account: proxyAccount,
        password: proxyPassword
      });
    },
    onSuccess: async (result) => {
      setProxyPassword("");
      await handleProxyResult(result);
    },
    onError: () => {
      setProxyPassword("");
    }
  });

  return {
    authQuery,
    proxyConfigQuery,
    qrStatusQuery,
    supportedCountries,
    availableModes,
    proxyLoginEnabled,
    proxyResult,
    currentFlowMode,
    currentQrCodeImageUrl,
    cookie,
    setCookie,
    proxyAccount,
    setProxyAccount,
    proxyPassword,
    setProxyPassword,
    smsCountryCode,
    setSmsCountryCode,
    smsPhoneNumber,
    setSmsPhoneNumber,
    smsCode,
    setSmsCode,
    smsRetryAfterSeconds,
    hasSentSmsCode,
    canImportCookie,
    canSendSmsCode,
    canVerifySmsCode,
    canSubmitPassword,
    qrStartMutation,
    importMutation,
    smsSendMutation,
    smsVerifyMutation,
    passwordLoginMutation
  };
}
