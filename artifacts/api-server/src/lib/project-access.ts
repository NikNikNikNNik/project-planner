import {
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import type { Request, Response } from "express";

const scrypt = promisify(scryptCallback);
const COOKIE_NAME = "project_access";
const COOKIE_PATH = "/api";
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const attempts = new Map<string, { startedAt: number; failures: number }>();

function sessionSecret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error("SESSION_SECRET is required for project access");
  return value;
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: COOKIE_PATH,
  };
}

export async function makePasswordRecord(password: string) {
  const salt = randomBytes(16);
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  return {
    passwordSalt: salt.toString("base64"),
    passwordHash: hash.toString("base64"),
  };
}

export async function verifyPassword(
  password: string,
  saltBase64: string,
  hashBase64: string,
): Promise<boolean> {
  const salt = Buffer.from(saltBase64, "base64");
  const expected = Buffer.from(hashBase64, "base64");
  if (salt.length !== 16 || expected.length !== 64) return false;
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;
  return timingSafeEqual(actual, expected);
}

export function setProjectAccessCookie(res: Response, projectId: string): void {
  const expiresAt = Date.now() + SESSION_DURATION_MS;
  const encodedProjectId = Buffer.from(projectId).toString("base64url");
  const payload = `${encodedProjectId}.${expiresAt}`;
  const signature = createHmac("sha256", sessionSecret())
    .update(payload)
    .digest("base64url");
  res.cookie(COOKIE_NAME, `${payload}.${signature}`, {
    ...cookieOptions(),
    maxAge: SESSION_DURATION_MS,
  });
}

export function clearProjectAccessCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, cookieOptions());
}

export function requestHasProjectAccess(req: Request, projectId: string): boolean {
  const raw = req.cookies?.[COOKIE_NAME];
  if (typeof raw !== "string") return false;
  const [encodedProjectId, expiresAtText, suppliedSignature, extra] = raw.split(".");
  if (!encodedProjectId || !expiresAtText || !suppliedSignature || extra !== undefined) {
    return false;
  }
  const expiresAt = Number(expiresAtText);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) return false;

  let decodedProjectId: string;
  try {
    decodedProjectId = Buffer.from(encodedProjectId, "base64url").toString();
  } catch {
    return false;
  }
  if (decodedProjectId !== projectId) return false;

  const payload = `${encodedProjectId}.${expiresAtText}`;
  const expectedSignature = createHmac("sha256", sessionSecret())
    .update(payload)
    .digest();
  const supplied = Buffer.from(suppliedSignature, "base64url");
  return supplied.length === expectedSignature.length &&
    timingSafeEqual(supplied, expectedSignature);
}

export function isRateLimited(req: Request, projectId: string): boolean {
  const key = `${req.ip ?? "unknown"}:${projectId}`;
  const now = Date.now();
  const previous = attempts.get(key);
  if (!previous || now - previous.startedAt >= ATTEMPT_WINDOW_MS) {
    attempts.set(key, { startedAt: now, failures: 0 });
    return false;
  }
  return previous.failures >= MAX_ATTEMPTS;
}

export function recordFailedAccess(req: Request, projectId: string): void {
  const key = `${req.ip ?? "unknown"}:${projectId}`;
  const now = Date.now();
  const previous = attempts.get(key);
  if (!previous || now - previous.startedAt >= ATTEMPT_WINDOW_MS) {
    attempts.set(key, { startedAt: now, failures: 1 });
    return;
  }
  previous.failures += 1;
}

export function clearFailedAccess(req: Request, projectId: string): void {
  attempts.delete(`${req.ip ?? "unknown"}:${projectId}`);
}
