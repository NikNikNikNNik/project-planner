import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Router, type RequestHandler, type CookieOptions } from "express";
import session, { type Store } from "express-session";
import { LoginAppBody } from "@workspace/api-zod";

declare module "express-session" {
  interface SessionData {
    appCredentialStamp?: string;
  }
}

type AuthOptions = {
  username?: string;
  password?: string;
  sessionSecret?: string;
  store: Store;
  secureCookies: boolean | "auto";
};

const cookieName = "planner_session";
const sessionLifetime = 8 * 60 * 60 * 1000;
const attemptWindow = 15 * 60 * 1000;

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

/** All credentials are supplied by server configuration, never by project data. */
export function createAppAuth(options: AuthOptions) {
  const { username, password, sessionSecret } = options;
  const configured = Boolean(username && password && sessionSecret);
  const stamp = configured
    ? createHmac("sha256", sessionSecret!).update(JSON.stringify([username, password])).digest("hex")
    : "";
  const router = Router();
  const attempts = new Map<string, { count: number; expires: number }>();
  const cookie: CookieOptions = {
    httpOnly: true,
    sameSite: "lax",
    path: "/api",
    maxAge: sessionLifetime,
  };
  const sessionMiddleware = configured ? session({
    name: cookieName,
    secret: sessionSecret!,
    store: options.store,
    resave: false,
    saveUninitialized: false,
    cookie: { ...cookie, secure: options.secureCookies },
  }) : null;

  const middleware: RequestHandler = (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    // Without CORS, foreign origins cannot send JSON or DELETE requests.
    // Reject simple form POSTs too, preventing login/logout and write CSRF.
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (req.get("sec-fetch-site") === "cross-site") {
        res.status(403).json({ error: "Запрос с другого сайта запрещён." });
        return;
      }
      if (req.method !== "DELETE" && !req.is("application/json")) {
        res.status(415).json({ error: "Ожидается запрос в формате JSON." });
        return;
      }
    }
    if (!sessionMiddleware) { next(); return; }
    sessionMiddleware(req, res, error => {
      if (error) {
        req.log?.error("Application session store unavailable");
        if (res.headersSent) { next(error); return; }
        res.status(503).json({ error: "Не удалось проверить сессию. Попробуйте ещё раз." });
        return;
      }
      next();
    });
  };

  const authenticated = (req: Parameters<RequestHandler>[0]) =>
    configured && req.session?.appCredentialStamp === stamp;

  const requireAuth: RequestHandler = (req, res, next) => {
    if (!configured) {
      res.status(503).json({ error: "Вход в приложение не настроен." });
      return;
    }
    if (!authenticated(req)) {
      res.status(401).json({ error: "Для доступа к проектам войдите в приложение." });
      return;
    }
    next();
  };

  router.get("/session", (req, res) => {
    res.json({ authenticated: authenticated(req), configured });
  });

  router.post("/login", (req, res) => {
    if (!configured) {
      res.status(503).json({ error: "Вход не настроен: добавьте APP_LOGIN, APP_PASSWORD и SESSION_SECRET." });
      return;
    }
    const now = Date.now();
    // Expire entries and bound memory use even when many IPs send requests.
    for (const [key, value] of attempts) if (value.expires <= now) attempts.delete(key);
    const ip = req.ip ?? "unknown";
    const attempt = attempts.get(ip);
    if ((attempt?.count ?? 0) >= 10 || (!attempt && attempts.size >= 10000)) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil(((attempt?.expires ?? now + attemptWindow) - now) / 1000))));
      res.status(429).json({ error: "Слишком много попыток входа. Попробуйте позже." });
      return;
    }
    const parsed = LoginAppBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Укажите логин и пароль." });
      return;
    }
    const usernameMatches = timingSafeEqual(digest(parsed.data.username), digest(username!));
    const passwordMatches = timingSafeEqual(digest(parsed.data.password), digest(password!));
    if (!usernameMatches || !passwordMatches) {
      attempts.set(ip, { count: (attempt?.count ?? 0) + 1, expires: attempt?.expires ?? now + attemptWindow });
      res.status(401).json({ error: "Неверный логин или пароль." });
      return;
    }
    attempts.delete(ip);
    // Regenerate before granting access to prevent session fixation.
    req.session.regenerate(error => {
      if (error) {
        req.session.destroy(() => {
          res.status(503).json({ error: "Не удалось начать сессию. Попробуйте ещё раз." });
        });
        return;
      }
      req.session.appCredentialStamp = stamp;
      req.session.save(saveError => {
        if (saveError) {
          req.session.destroy(() => {
            res.status(503).json({ error: "Не удалось сохранить сессию. Попробуйте ещё раз." });
          });
          return;
        }
        res.json({ authenticated: true, configured: true });
      });
    });
  });

  router.post("/logout", (req, res) => {
    const finish = () => {
      res.clearCookie(cookieName, { ...cookie, maxAge: undefined, secure: options.secureCookies === true || req.secure });
      res.status(204).end();
    };
    if (!req.session) { finish(); return; }
    req.session.destroy(error => {
      if (error) {
        res.status(503).json({ error: "Не удалось завершить сессию. Попробуйте ещё раз." });
        return;
      }
      finish();
    });
  });

  return { middleware, router, requireAuth };
}
