import type { ProjectInput } from "@workspace/api-zod";

export type ProjectPlan = Pick<
  ProjectInput,
  "shops" | "phases" | "milestones" | "training" | "settings"
>;

function normalizePlanDates<T>(value: T, key = ""): T {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10) as T;
  }
  if (
    typeof value === "string" &&
    ["startDate", "endDate", "date", "readyDate", "contractDate"].includes(key) &&
    /^\d{4}-\d{2}-\d{2}T/.test(value)
  ) {
    return value.slice(0, 10) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizePlanDates(item)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        normalizePlanDates(childValue, childKey),
      ]),
    ) as T;
  }
  return value;
}

export function projectPlanForStorage(input: ProjectPlan): ProjectPlan {
  return normalizePlanDates({
    shops: input.shops,
    phases: input.phases,
    milestones: input.milestones,
    training: input.training,
    settings: input.settings,
  });
}

export function projectPlanFromStorage<T>(plan: T): T {
  return normalizePlanDates(plan);
}
