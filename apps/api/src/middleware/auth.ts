import { createHash, randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { AppConfig } from "../config";

export class AuthService {
  private readonly sessions = new Map<string, string>();

  constructor(private readonly config: Pick<AppConfig, "appPassword" | "secureCookies" | "sessionSecret">) {}

  private sign(token: string) {
    return createHash("sha256").update(`${token}:${this.config.sessionSecret}`).digest("hex");
  }

  createSession() {
    const rawToken = randomBytes(24).toString("hex");
    const signed = this.sign(rawToken);
    this.sessions.set(signed, signed);
    return signed;
  }

  validatePassword(password: string) {
    return password === this.config.appPassword;
  }

  getCookieOptions() {
    return {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: this.config.secureCookies,
      maxAge: 1000 * 60 * 60 * 24 * 30
    };
  }

  isAuthenticated(token: string | undefined) {
    if (!token) {
      return false;
    }
    return this.sessions.has(token);
  }

  destroySession(token: string | undefined) {
    if (!token) {
      return;
    }
    this.sessions.delete(token);
  }

  requireAuth = (request: Request, response: Response, next: NextFunction) => {
    const token = request.cookies?.dl_session as string | undefined;
    if (!this.isAuthenticated(token)) {
      response.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  };
}

