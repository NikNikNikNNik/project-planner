import { pgTable, text } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";

export const projectCredentialsTable = pgTable("project_credentials", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  username: text("username").notNull(),
  passwordSalt: text("password_salt").notNull(),
  passwordHash: text("password_hash").notNull(),
});
