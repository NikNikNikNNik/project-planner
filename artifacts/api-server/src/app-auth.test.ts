import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import cookieParser from "cookie-parser";
import session from "express-session";
import { createAppAuth } from "./lib/app-auth.ts";

const testLogin = { username: "auth-test-user", password: "test-only-not-a-real-password" };
type FixtureOptions = {
  password?: string;
  configured?: boolean;
  secureCookies?: boolean;
  store?: session.MemoryStore;
};

async function fixture(t: test.TestContext, options: FixtureOptions = {}) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use(cookieParser());
  const store = options.store ?? new session.MemoryStore();
  const auth = createAppAuth({
    username: options.configured === false ? undefined : testLogin.username,
    password: options.password ?? testLogin.password,
    sessionSecret: "test-session-secret-not-used-in-the-app",
    secureCookies: options.secureCookies ?? false,
    store,
  });
  app.get("/api/healthz", (_req, res) => { res.json({ status: "ok" }); });
  app.use("/api", auth.middleware);
  app.use("/api/auth", auth.router);
  app.use("/api", auth.requireAuth);
  app.all(["/api/projects", "/api/projects/example", "/api/projects/example/copy", "/api/planning/summary"], (_req, res) => {
    res.json({ protected: true });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => { server.once("listening", resolve); });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  t.after(() => { server.closeAllConnections(); server.close(); store.clear(() => {}); });
  const url = `http://127.0.0.1:${address.port}`;
  const request = (path: string, init: RequestInit = {}) => fetch(`${url}${path}`, init);
  const login = (body = testLogin, cookie?: string) => request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  return { request, login, store };
}

function cookieFrom(response: Response) {
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie);
  return cookie.split(";")[0]!;
}

test("health remains public; all project and planning operations reject anonymous access", async t => {
  const { request } = await fixture(t);
  assert.equal((await request("/api/healthz")).status, 200);
  assert.deepEqual(await (await request("/api/auth/session")).json(), { authenticated: false, configured: true });
  for (const [method, path] of [
    ["GET", "/api/projects"], ["POST", "/api/projects"], ["GET", "/api/projects/example"],
    ["PUT", "/api/projects/example"], ["DELETE", "/api/projects/example"],
    ["POST", "/api/projects/example/copy"], ["GET", "/api/planning/summary"],
  ]) {
    const response = await request(path!, { method, headers: { "Content-Type": "application/json" } });
    assert.equal(response.status, 401, `${method} ${path}`);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

test("correct credentials establish an HttpOnly session that survives later requests", async t => {
  const { request, login } = await fixture(t);
  const response = await login();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authenticated: true, configured: true });
  assert.match(response.headers.get("set-cookie")!, /HttpOnly/i);
  assert.match(response.headers.get("set-cookie")!, /SameSite=Lax/i);
  assert.match(response.headers.get("set-cookie")!, /Path=\/api/i);
  const cookie = cookieFrom(response);
  assert.doesNotMatch(cookie, /auth-test-user|test-only-not-a-real-password/);
  assert.equal((await request("/api/projects", { headers: { cookie } })).status, 200);
  assert.deepEqual(await (await request("/api/auth/session", { headers: { cookie } })).json(), { authenticated: true, configured: true });
});

test("invalid credentials use one generic error; excessive attempts are limited", async t => {
  const { login } = await fixture(t);
  for (let attempt = 0; attempt < 10; attempt++) {
    const response = await login({ username: attempt % 2 ? testLogin.username : "unknown", password: "incorrect" });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.deepEqual(await response.json(), { error: "Неверный логин или пароль." });
  }
  const limited = await login();
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
});

test("body validation and CSRF defenses reject malformed and foreign-site requests", async t => {
  const { request } = await fixture(t);
  assert.equal((await request("/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: '{"username":12}',
  })).status, 400);
  assert.equal((await request("/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "username=test&password=test",
  })).status, 415);
  assert.equal((await request("/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "cross-site" }, body: JSON.stringify(testLogin),
  })).status, 403);
  const preflight = await request("/api/auth/login", { method: "OPTIONS", headers: { Origin: "https://untrusted.example" } });
  assert.equal(preflight.headers.get("access-control-allow-origin"), null);
});

test("login rotates the session and logout revokes the server-side session", async t => {
  const { request, login } = await fixture(t);
  const original = cookieFrom(await login());
  const replacement = cookieFrom(await login(testLogin, original));
  assert.notEqual(original, replacement);
  assert.equal((await request("/api/projects", { headers: { cookie: original } })).status, 401);
  assert.equal((await request("/api/projects", { headers: { cookie: replacement } })).status, 200);
  assert.equal((await request("/api/auth/logout", {
    method: "POST", headers: { "Content-Type": "application/json", cookie: replacement }, body: "{}",
  })).status, 204);
  assert.equal((await request("/api/projects", { headers: { cookie: replacement } })).status, 401);
});

test("tampered cookies, expired sessions and changed credentials cannot grant access", async t => {
  const store = new session.MemoryStore();
  const first = await fixture(t, { store });
  const cookie = cookieFrom(await first.login());
  const invalid = `${cookie}tampered`;
  assert.equal((await first.request("/api/projects", { headers: { cookie: invalid } })).status, 401);
  const changed = await fixture(t, { store, password: "a-new-test-only-password" });
  assert.equal((await changed.request("/api/projects", { headers: { cookie } })).status, 401);
  const storedSessions = await new Promise<Record<string, session.SessionData>>((resolve, reject) => {
    store.all((error, value) => error ? reject(error) : resolve(value as Record<string, session.SessionData>));
  });
  for (const [sid, data] of Object.entries(storedSessions)) {
    data.cookie.expires = new Date(Date.now() - 1000);
    await new Promise<void>((resolve, reject) => { store.set(sid, data, error => error ? reject(error) : resolve()); });
  }
  assert.equal((await first.request("/api/projects", { headers: { cookie } })).status, 401);
});

test("missing configuration fails closed and HTTPS sessions use Secure cookies", async t => {
  const missing = await fixture(t, { configured: false });
  assert.equal((await missing.request("/api/projects")).status, 503);
  assert.equal((await missing.login()).status, 503);
  assert.deepEqual(await (await missing.request("/api/auth/session")).json(), { authenticated: false, configured: false });
  const secure = await fixture(t, { secureCookies: true });
  const response = await secure.request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-Proto": "https" },
    body: JSON.stringify(testLogin),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie")!, /;\s*Secure/i);
});

test("session persistence failures return 503 without granting access or crashing", async t => {
  const store = new session.MemoryStore();
  store.set = (_sid, _session, callback) => { callback?.(new Error("Test-only store failure")); };
  const { login, request } = await fixture(t, { store });
  const failed = await login();
  assert.equal(failed.status, 503);
  assert.equal(failed.headers.get("set-cookie"), null);
  assert.equal((await request("/api/healthz")).status, 200);
  assert.equal((await request("/api/projects")).status, 401);
});
