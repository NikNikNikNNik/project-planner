import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectPlan } from "./project-plan.ts";
import { projectPlanForStorage, projectPlanFromStorage } from "./project-plan.ts";

const plan: ProjectPlan = {
  shops: [{
    id: "shop-a",
    name: "Цех A",
    roles: [{ id: "role-b", name: "Оператор", group: "workers", visible: true }],
  }],
  phases: [],
  milestones: {
    mc: { date: null, note: null, shopIds: [] },
    rfsu: { date: null, note: null, shopIds: [] },
  },
  training: [
    {
      id: "general",
      title: "Общее обучение",
      category: "mandatory",
      duration: 2,
      unit: "days",
      shopIds: ["shop-a"],
      roleIds: [],
      note: null,
      status: "planned",
      sortOrder: 0,
    },
    {
      id: "remaining-role",
      title: "Обучение оператора",
      category: "mandatory",
      duration: 4,
      unit: "days",
      shopIds: ["shop-a"],
      roleIds: ["role-b"],
      note: null,
      status: "planned",
      sortOrder: 1,
    },
  ],
  settings: {
    calculationMode: "sequential",
    readyMode: "fixed",
    readyDate: "2026-06-20",
    daysBeforeMc: 0,
    dayType: "calendar",
    contractDate: null,
  },
};

test("project plan keeps cleaned training assignments through storage and reload", () => {
  const storedJson = JSON.stringify(projectPlanForStorage(plan));
  const reloaded = projectPlanFromStorage(JSON.parse(storedJson) as ProjectPlan);

  assert.deepEqual(reloaded, plan);
  assert.deepEqual(reloaded.shops[0].roles.map((role) => role.id), ["role-b"]);
  assert.deepEqual(reloaded.training.map((event) => event.id), ["general", "remaining-role"]);
  assert.deepEqual(reloaded.training[0].roleIds, []);
  assert.deepEqual(reloaded.training[1].roleIds, ["role-b"]);
});
