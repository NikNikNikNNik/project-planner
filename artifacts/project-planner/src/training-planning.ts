import type { Project, Role, Shop, TrainingEvent } from '@workspace/api-client-react';

export type ScheduledTraining = {
  event: TrainingEvent;
  startDate: string;
  endDate: string;
  durationDays: number;
  approximate: boolean;
};

export type ScheduledTrainingLane = ScheduledTraining & { lane: number };

export type ShopRoleSummary = {
  roles: Role[];
  itr: Role[];
  workers: Role[];
  count: number;
};

export type RoleTrainingPlan = {
  events: TrainingEvent[];
  schedule: ScheduledTraining[];
  totalDays: number;
  onboardingDurationDays: number;
  totalPreparationDays: number;
  startDate: string | null;
  onboardingStartDate: string | null;
  endDate: string | null;
  contractDate: string | null;
  readyDate: string | null;
  hasTrainingBar: boolean;
};

export function getShopRoleSummary(shop: Shop): ShopRoleSummary {
  const activeRoles = shop.roles.filter(role => role.visible);
  return {
    roles: activeRoles,
    itr: activeRoles.filter(role => role.group === 'itr'),
    workers: activeRoles.filter(role => role.group === 'workers'),
    count: activeRoles.length,
  };
}

export function reconcileTrainingRoles(training: TrainingEvent[], shops: Shop[]) {
  const existingRoleIds = new Set(shops.flatMap(shop => shop.roles.map(role => role.id)));

  return training.flatMap(event => {
    if (!event.roleIds.length) return [event];

    const roleIds = event.roleIds.filter(id => existingRoleIds.has(id));
    return roleIds.length ? [{ ...event, roleIds }] : [];
  });
}

export function getRoleTrainingEvents(training: TrainingEvent[], shopId: string, roleId: string) {
  return training.filter(event =>
    event.shopIds.includes(shopId) && (!event.roleIds.length || event.roleIds.includes(roleId)),
  );
}

function iso(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return iso(date);
}

function shiftWorkingDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00`);
  let remaining = Math.abs(days);
  const direction = days < 0 ? -1 : 1;
  while (remaining > 0) {
    date.setDate(date.getDate() + direction);
    if (date.getDay() !== 0 && date.getDay() !== 6) remaining--;
  }
  return iso(date);
}

export function durationInDays(
  duration: number,
  unit: TrainingEvent['unit'],
  dayType: 'calendar' | 'working',
) {
  const factor = unit === 'days'
    ? 1
    : unit === 'weeks'
      ? (dayType === 'working' ? 5 : 7)
      : (dayType === 'working' ? 22 : 30);
  return Math.max(0, Math.ceil(duration * factor));
}

export function getOnboardingDurationDays(project: Project) {
  return durationInDays(
    project.settings.onboardingDuration ?? 0,
    project.settings.onboardingUnit ?? 'days',
    project.settings.dayType,
  );
}

export function getOnboardingStartDate(
  trainingStartDate: string | null,
  duration: number,
  unit: 'days' | 'weeks',
  dayType: 'calendar' | 'working',
) {
  const days = durationInDays(duration, unit, dayType);
  if (!trainingStartDate || days === 0) return null;
  return dayType === 'working'
    ? shiftWorkingDays(trainingStartDate, -days)
    : shiftDate(trainingStartDate, -days);
}

export function trainingDays(event: TrainingEvent, dayType: 'calendar' | 'working') {
  return durationInDays(event.duration, event.unit, dayType);
}

export function totalTrainingDays(
  events: TrainingEvent[],
  calculationMode: 'sequential' | 'parallel',
  dayType: 'calendar' | 'working',
) {
  const durations = events.map(event => trainingDays(event, dayType));
  return calculationMode === 'parallel'
    ? Math.max(0, ...durations)
    : durations.reduce((sum, duration) => sum + duration, 0);
}

export function scheduleTrainingTimeline(project: Project, readyDate: string | null): ScheduledTraining[] {
  const sorted = [...project.training].sort((a, b) => a.sortOrder - b.sortOrder);
  const dayType = project.settings.dayType;
  const anchor = readyDate ?? project.settings.contractDate ?? project.startDate;
  const approximate = !readyDate && !project.settings.contractDate;
  const shift = (date: string, days: number) =>
    dayType === 'working' ? shiftWorkingDays(date, days) : shiftDate(date, days);

  if (project.settings.calculationMode === 'parallel') {
    return sorted.flatMap(event => {
      const durationDays = trainingDays(event, dayType);
      if (durationDays <= 0) return [];
      const startDate = event.startDate ?? (readyDate ? shift(anchor, -durationDays) : anchor);
      const endDate = event.startDate ? shift(startDate, durationDays) : readyDate ?? shift(anchor, durationDays);
      return [{ event, startDate, endDate, durationDays, approximate: event.startDate ? false : approximate }];
    });
  }

  const scheduled = new Map<string, ScheduledTraining>();
  if (readyDate) {
    let cursor = anchor;
    for (const event of [...sorted].reverse()) {
      const durationDays = trainingDays(event, dayType);
      if (durationDays <= 0) continue;
      const startDate = event.startDate ?? shift(cursor, -durationDays);
      const endDate = event.startDate ? shift(startDate, durationDays) : cursor;
      scheduled.set(event.id, { event, startDate, endDate, durationDays, approximate: event.startDate ? false : approximate });
      cursor = startDate;
    }
  } else {
    let cursor = anchor;
    for (const event of sorted) {
      const durationDays = trainingDays(event, dayType);
      if (durationDays <= 0) continue;
      const startDate = event.startDate ?? cursor;
      const endDate = event.startDate ? shift(startDate, durationDays) : shift(cursor, durationDays);
      scheduled.set(event.id, { event, startDate, endDate, durationDays, approximate: event.startDate ? false : approximate });
      cursor = endDate;
    }
  }
  return sorted.flatMap(event => {
    const item = scheduled.get(event.id);
    return item ? [item] : [];
  });
}

export function assignTrainingLanes(schedule: ScheduledTraining[]): ScheduledTrainingLane[] {
  const laneEndDates: string[] = [];
  return [...schedule]
    .sort((a, b) =>
      a.startDate.localeCompare(b.startDate) ||
      a.endDate.localeCompare(b.endDate) ||
      a.event.sortOrder - b.event.sortOrder,
    )
    .map(item => {
      const availableLane = laneEndDates.findIndex(endDate => endDate <= item.startDate);
      const lane = availableLane === -1 ? laneEndDates.length : availableLane;
      laneEndDates[lane] = item.endDate;
      return { ...item, lane };
    });
}

export function getRoleTrainingPlan(
  project: Project,
  shopId: string,
  roleId: string,
  readyDate: string | null,
): RoleTrainingPlan {
  const events = getRoleTrainingEvents(project.training, shopId, roleId);
  const onboardingDays = getOnboardingDurationDays(project);
  const hasTraining = events.some(event => trainingDays(event, project.settings.dayType) > 0);
  const scheduleProject = !readyDate && project.settings.contractDate && hasTraining && onboardingDays > 0
    ? {
        ...project,
        settings: {
          ...project.settings,
          contractDate: project.settings.dayType === 'working'
            ? shiftWorkingDays(project.settings.contractDate, onboardingDays)
            : shiftDate(project.settings.contractDate, onboardingDays),
        },
      }
    : project;
  const schedule = scheduleTrainingTimeline({ ...scheduleProject, training: events }, readyDate);
  const startDate = schedule.length
    ? schedule.reduce((earliest, item) => item.startDate < earliest ? item.startDate : earliest, schedule[0].startDate)
    : null;
  const endDate = schedule.length
    ? schedule.reduce((latest, item) => item.endDate > latest ? item.endDate : latest, schedule[0].endDate)
    : null;
  const onboardingDurationDays = schedule.length ? onboardingDays : 0;
  const onboardingStartDate = getOnboardingStartDate(
    startDate,
    onboardingDurationDays,
    'days',
    project.settings.dayType,
  );
  const approximateContractDate = schedule.some(item => item.approximate);
  const contractDate = approximateContractDate
    ? null
    : onboardingStartDate ?? startDate ?? readyDate ?? project.settings.contractDate;
  const totalDays = totalTrainingDays(events, project.settings.calculationMode, project.settings.dayType);

  return {
    events,
    schedule,
    totalDays,
    onboardingDurationDays,
    totalPreparationDays: totalDays + onboardingDurationDays,
    startDate,
    onboardingStartDate,
    endDate,
    contractDate,
    readyDate: endDate ?? readyDate,
    hasTrainingBar: schedule.length > 0 && startDate !== null && endDate !== null,
  };
}
