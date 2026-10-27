import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, projectsTable } from "@workspace/db";
import {
  CopyProjectParams,
  CopyProjectResponse,
  CreateProjectBody,
  CreateProjectResponse,
  DeleteProjectParams,
  GetPlanningSummaryResponse,
  GetProjectParams,
  GetProjectResponse,
  ListProjectsResponse,
  UpdateProjectBody,
  UpdateProjectParams,
  UpdateProjectResponse,
  type ProjectInput,
} from "@workspace/api-zod";
import { projectPlanForStorage, projectPlanFromStorage } from "../lib/project-plan";
import { actualRecordErrors } from "../lib/actual-records";

const router: IRouter = Router();

function toDateString(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}
function projectFromRow(row: typeof projectsTable.$inferSelect) {
  const plan = projectPlanFromStorage(row.plan);
  return {
    id: row.id,
    title: row.title,
    startDate: row.startDate,
    endDate: row.endDate,
    updatedAt: row.updatedAt.toISOString(),
    ...plan,
  };
}

function projectSummaryFromRow(row: typeof projectsTable.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    startDate: row.startDate,
    endDate: row.endDate,
    updatedAt: row.updatedAt.toISOString(),
    phaseCount: row.plan.phases.length,
    trainingCount: row.plan.training.length,
  };
}

function getInvalidTrainingRoleReferences(
  input: Pick<ProjectInput, "shops" | "training">,
): string[] {
  const roleIds = new Set(input.shops.flatMap((shop) => shop.roles.map((role) => role.id)));
  return input.training.flatMap((event) => {
    const missingRoleIds = [...new Set(event.roleIds.filter((roleId) => !roleIds.has(roleId)))];
    return missingRoleIds.map((roleId) => `${event.title}: ${roleId}`);
  });
}

function rejectInvalidTrainingRoleReferences(
  input: Pick<ProjectInput, "shops" | "training">,
  res: Parameters<Parameters<typeof router.post>[1]>[1],
): boolean {
  const invalidRoleReferences = getInvalidTrainingRoleReferences(input);
  if (!invalidRoleReferences.length) return false;
  res.status(400).json({
    error: `Обучение ссылается на отсутствующие роли: ${invalidRoleReferences.join(", ")}`,
  });
  return true;
}

router.get("/projects", async (req, res): Promise<void> => {
  const rows = await db.select().from(projectsTable).orderBy(desc(projectsTable.updatedAt));
  res.json(ListProjectsResponse.parse(rows.map(projectSummaryFromRow)));
});

router.post("/projects", async (req, res): Promise<void> => {
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const input = parsed.data;
  const actualErrors = actualRecordErrors(input);
  if (actualErrors.length) { res.status(400).json({ error: actualErrors.join(' ') }); return; }
  if (rejectInvalidTrainingRoleReferences(input, res)) return;
  const id = crypto.randomUUID();
  const [row] = await db
    .insert(projectsTable)
    .values({
      id,
      title: input.title,
      startDate: toDateString(input.startDate),
      endDate: toDateString(input.endDate),
      plan: projectPlanForStorage(input) as unknown as typeof projectsTable.$inferInsert.plan,
    })
    .returning();
  res.status(201).json(CreateProjectResponse.parse(projectFromRow(row)));
});

router.get("/projects/:projectId", async (req, res): Promise<void> => {
  const params = GetProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, params.data.projectId));
  if (!row) {
    res.status(404).json({ error: "Проект не найден" });
    return;
  }
  res.json(GetProjectResponse.parse(projectFromRow(row)));
});

router.put("/projects/:projectId", async (req, res): Promise<void> => {
  const params = UpdateProjectParams.safeParse(req.params);
  const parsed = UpdateProjectBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const input = parsed.data;
  const actualErrors = actualRecordErrors(input);
  if (actualErrors.length) { res.status(400).json({ error: actualErrors.join(' ') }); return; }
  if (rejectInvalidTrainingRoleReferences(input, res)) return;
  const [row] = await db
    .update(projectsTable)
    .set({
      title: input.title,
      startDate: toDateString(input.startDate),
      endDate: toDateString(input.endDate),
      plan: projectPlanForStorage(input) as unknown as typeof projectsTable.$inferInsert.plan,
      updatedAt: new Date(),
    })
    .where(eq(projectsTable.id, params.data.projectId))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Проект не найден" });
    return;
  }
  res.json(UpdateProjectResponse.parse(projectFromRow(row)));
});

router.delete("/projects/:projectId", async (req, res): Promise<void> => {
  const params = DeleteProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .delete(projectsTable)
    .where(eq(projectsTable.id, params.data.projectId))
    .returning({ id: projectsTable.id });
  if (!row) {
    res.status(404).json({ error: "Проект не найден" });
    return;
  }
  res.sendStatus(204);
});

router.post("/projects/:projectId/copy", async (req, res): Promise<void> => {
  const params = CopyProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [source] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, params.data.projectId));
  if (!source) {
    res.status(404).json({ error: "Проект не найден" });
    return;
  }
  const id = crypto.randomUUID();
  const [copy] = await db
    .insert(projectsTable)
    .values({
      id,
      title: `${source.title} — копия`,
      startDate: source.startDate,
      endDate: source.endDate,
      plan: source.plan,
    })
    .returning();
  res.status(201).json(CopyProjectResponse.parse(projectFromRow(copy)));
});

router.get("/planning/summary", async (_req, res): Promise<void> => {
  const rows = await db.select().from(projectsTable);
  const summary = {
    projectCount: rows.length,
    phaseCount: rows.reduce((total, row) => total + row.plan.phases.length, 0),
    trainingCount: rows.reduce((total, row) => total + row.plan.training.length, 0),
    activeTrainingCount: rows.reduce(
      (total, row) =>
        total +
        row.plan.training.filter((event) => {
          if (!event || typeof event !== "object" || !("status" in event)) return false;
          return event.status === "in_progress";
        }).length,
      0,
    ),
  };
  res.json(GetPlanningSummaryResponse.parse(summary));
});

export default router;
