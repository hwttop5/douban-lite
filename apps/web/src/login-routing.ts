export const LOGIN_SUCCESS_FALLBACK_PATH = "/me";

export function getRelativeLocation({
  pathname,
  search = "",
  hash = ""
}: {
  pathname: string;
  search?: string;
  hash?: string;
}) {
  return `${pathname}${search}${hash}`;
}

export function sanitizeReturnTo(returnTo: string | null | undefined) {
  if (!returnTo || !returnTo.startsWith("/") || returnTo.startsWith("//")) {
    return null;
  }

  try {
    const parsed = new URL(returnTo, window.location.origin);
    if (parsed.origin !== window.location.origin) {
      return null;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export function buildLoginPath(returnTo: string | null | undefined) {
  const safeReturnTo = sanitizeReturnTo(returnTo);
  if (!safeReturnTo) {
    return "/login";
  }

  const params = new URLSearchParams({
    returnTo: safeReturnTo
  });
  return `/login?${params.toString()}`;
}

export function resolveLoginSuccessPath(search: string) {
  const params = new URLSearchParams(search);
  return sanitizeReturnTo(params.get("returnTo")) ?? LOGIN_SUCCESS_FALLBACK_PATH;
}
