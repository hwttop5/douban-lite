import { describe, expect, it } from "vitest";
import { buildLoginPath, resolveLoginSuccessPath, sanitizeReturnTo } from "./login-routing";

describe("login-routing", () => {
  it("builds login URLs from safe relative paths only", () => {
    expect(buildLoginPath("/subject/movie/1292052?from=search#hero")).toBe(
      "/login?returnTo=%2Fsubject%2Fmovie%2F1292052%3Ffrom%3Dsearch%23hero"
    );
    expect(buildLoginPath("https://evil.example/login")).toBe("/login");
    expect(buildLoginPath("//evil.example/login")).toBe("/login");
  });

  it("falls back to /me when returnTo is invalid", () => {
    expect(resolveLoginSuccessPath("?returnTo=%2Fsearch")).toBe("/search");
    expect(resolveLoginSuccessPath("?returnTo=https://evil.example/login")).toBe("/me");
    expect(resolveLoginSuccessPath("")).toBe("/me");
  });

  it("rejects protocol-relative and malformed paths", () => {
    expect(sanitizeReturnTo("//evil.example/path")).toBeNull();
    expect(sanitizeReturnTo("not-a-path")).toBeNull();
  });
});
