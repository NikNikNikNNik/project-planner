import { Router, type IRouter } from "express";
import healthRouter from "./health";
import projectsRouter from "./projects";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";
import { createAppAuth } from "../lib/app-auth";

const router: IRouter = Router();
const PgSessionStore = connectPgSimple(session);
const store = new PgSessionStore({
  pool,
  tableName: "app_login_sessions",
  createTableIfMissing: true,
  errorLog: () => logger.error("Application session store error"),
});
const auth = createAppAuth({
  username: process.env.APP_LOGIN,
  password: process.env.APP_PASSWORD,
  sessionSecret: process.env.SESSION_SECRET,
  secureCookies: process.env.NODE_ENV === "production" ? true : "auto",
  store,
});

router.use(healthRouter);
router.use(auth.middleware);
router.use("/auth", auth.router);
router.use(auth.requireAuth, projectsRouter);

export default router;
