import type { Project, TrainingEvent } from '@workspace/api-client-react';
import { isTrainingEventIncludedForShop, isTrainingEventIncludedInCalculation } from './calculation-scope.ts';
import type { ScheduledTraining } from './training-planning';
import { getProjectDayType, isKazakhstanWorkday } from './kazakhstan-calendar.ts';

export type TrainingCostReportKind = 'cumulative' | 'monthly';
export const INTERNSHIP_GROUP_SIZE = 10;

export interface InternshipCostBasis {
  participantCount: number;
  groupCount: number;
  groupSize: number;
  pricePerGroupKzt: number | null;
}

export interface TrainingCostEntry {
  event: TrainingEvent;
  totalCostKzt: number | null;
  internshipCostBasis: InternshipCostBasis | null;
  unassignedAudience: boolean;
  startDate: string | null;
  endDate: string | null;
  activeDates: string[];
  approximate: boolean;
}

export interface TrainingCostLine {
  event: TrainingEvent;
  totalCostKzt: number;
  internshipCostBasis: InternshipCostBasis | null;
  amountKzt: number;
  activeDaysInPeriod: number;
  activeDaysTotal: number;
  startDate: string;
  endDate: string;
  approximate: boolean;
}

export interface TrainingCostReport {
  projectTitle: string;
  reportDate: string;
  kind: TrainingCostReportKind;
  totalKzt: number;
  lines: TrainingCostLine[];
  unallocatedEvents: TrainingCostEntry[];
  unallocatedCostKzt: number;
  unpricedEvents: TrainingCostEntry[];
  unassignedAudienceEvents: TrainingCostEntry[];
  partial: boolean;
  approximate: boolean;
}

function isIsoDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateRange(startDate: string, endDate: string) {
  if (!isIsoDate(startDate) || !isIsoDate(endDate) || endDate <= startDate) return [];
  const dates: string[] = [];
  for (let current = startDate, count = 0; current < endDate && count < 10_000; current = addDays(current, 1), count++) {
    dates.push(current);
  }
  return dates;
}

function scheduledDays(
  startDate: string,
  durationDays: number,
  dayType: 'calendar' | 'working',
  additionalNonWorkingDates: Project['settings']['additionalNonWorkingDates'],
) {
  if (durationDays <= 0 || !isIsoDate(startDate)) return [];
  const dates: string[] = [];
  for (let current = startDate, count = 0; dates.length < durationDays && count < 20_000; current = addDays(current, 1), count++) {
    if (dayType === 'calendar' || isKazakhstanWorkday(current, additionalNonWorkingDates)) dates.push(current);
  }
  return dates;
}

export function getTrainingCostEntries(project: Project, schedule: ScheduledTraining[]): TrainingCostEntry[] {
  const scheduleById = new Map(schedule.map(item => [item.event.id, item]));
  const dayType = getProjectDayType(project.settings);
  const additionalNonWorkingDates = project.settings.additionalNonWorkingDates ?? [];

  return project.training.map(event => {
    const hasAssignedAudience = event.shopIds.length > 0 || event.roleIds.length > 0;
    const includedInCalculation = !hasAssignedAudience || isTrainingEventIncludedInCalculation(project, event);
    const scheduled = scheduleById.get(event.id);
    const enteredCostKzt = event.costUsd === undefined
      ? null
      : Number.isFinite(event.costUsd) && event.costUsd >= 0
        ? Math.round(event.costUsd)
        : null;
    const internshipCostBasis = event.category === 'internship'
      ? getInternshipCostBasis(project, event, enteredCostKzt)
      : null;
    const totalCostKzt = internshipCostBasis
      ? enteredCostKzt === null
        ? null
        : enteredCostKzt * internshipCostBasis.groupCount
      : includedInCalculation ? enteredCostKzt : 0;
    const startDate = includedInCalculation && isIsoDate(scheduled?.startDate)
      ? scheduled.startDate
      : includedInCalculation && isIsoDate(event.startDate) ? event.startDate : null;
    const endDate = includedInCalculation && isIsoDate(scheduled?.endDate) ? scheduled.endDate : null;

    let activeDates = scheduled && startDate && endDate
      ? dateRange(startDate, endDate).filter(date =>
          dayType === 'calendar' || isKazakhstanWorkday(date, additionalNonWorkingDates))
      : [];

    if (!activeDates.length && startDate) {
      if (scheduled?.durationDays) {
        activeDates = scheduledDays(startDate, scheduled.durationDays, dayType, additionalNonWorkingDates);
      } else if (event.duration > 0) {
        const durationDays = event.unit === 'days'
          ? Math.ceil(event.duration)
          : Math.ceil(event.duration * (event.unit === 'weeks' ? (dayType === 'working' ? 5 : 7) : (dayType === 'working' ? 22 : 30)));
        activeDates = scheduledDays(startDate, durationDays, dayType, additionalNonWorkingDates);
      } else {
        // A costed event with a date but no duration is booked on that date.
        activeDates = [startDate];
      }
    }

    const resolvedEndDate = endDate ?? (activeDates.length ? addDays(activeDates[activeDates.length - 1], 1) : null);
    return {
      event,
      totalCostKzt,
      internshipCostBasis,
      unassignedAudience: Boolean(internshipCostBasis && internshipCostBasis.participantCount === 0 && totalCostKzt !== null && enteredCostKzt !== null && enteredCostKzt > 0),
      startDate,
      endDate: resolvedEndDate,
      activeDates,
      approximate: scheduled?.approximate ?? false,
    };
  });
}

function getInternshipCostBasis(project: Project, event: TrainingEvent, pricePerGroupKzt: number | null): InternshipCostBasis {
  const participantCount = project.shops
    .filter(shop => isTrainingEventIncludedForShop(shop, event))
    .flatMap(shop => shop.roles)
    .filter(role => event.roleIds.length === 0 || event.roleIds.includes(role.id))
    .reduce((sum, role) => {
      const headcount = role.headcount ?? 0;
      return role.visible !== false && Number.isFinite(headcount) && headcount > 0
        ? sum + Math.floor(headcount)
        : sum;
    }, 0);
  return {
    participantCount,
    groupCount: Math.ceil(participantCount / INTERNSHIP_GROUP_SIZE),
    groupSize: INTERNSHIP_GROUP_SIZE,
    pricePerGroupKzt,
  };
}

export function getTrainingCostSummary(entries: TrainingCostEntry[]) {
  const unallocatedEvents = entries.filter(entry =>
    entry.totalCostKzt !== null && entry.totalCostKzt > 0 && entry.activeDates.length === 0);
  const unpricedEvents = entries.filter(entry => entry.totalCostKzt === null);
  return {
    totalCostKzt: entries.reduce((sum, entry) => sum + (entry.totalCostKzt ?? 0), 0),
    unallocatedEvents,
    unallocatedCostKzt: unallocatedEvents.reduce((sum, entry) => sum + (entry.totalCostKzt ?? 0), 0),
    unpricedEvents,
    unassignedAudienceEvents: entries.filter(entry => entry.unassignedAudience),
    approximateEvents: entries.filter(entry => entry.approximate).length,
  };
}

function allocatedAmount(totalCostKzt: number, dayCount: number, dayIndex: number) {
  if (dayCount <= 0) return 0;
  const wholeCost = Math.round(totalCostKzt);
  const base = Math.floor(wholeCost / dayCount);
  const remainder = wholeCost - base * dayCount;
  return base + (dayIndex < remainder ? 1 : 0);
}

export function getTrainingCostReport(
  projectTitle: string,
  entries: TrainingCostEntry[],
  reportDate: string,
  kind: TrainingCostReportKind,
): TrainingCostReport {
  const monthStart = `${reportDate.slice(0, 7)}-01`;
  const lines: TrainingCostLine[] = [];
  let totalKzt = 0;
  let approximate = false;

  for (const entry of entries) {
    if (entry.totalCostKzt === null || !entry.activeDates.length) continue;
    const activeIndices = entry.activeDates.flatMap((date, index) => {
      const included = kind === 'cumulative'
        ? date <= reportDate
        : date >= monthStart && date <= reportDate;
      return included ? [index] : [];
    });
    if (!activeIndices.length) continue;

    const amountKzt = activeIndices.reduce(
      (sum, index) => sum + allocatedAmount(entry.totalCostKzt as number, entry.activeDates.length, index),
      0,
    );
    if (amountKzt <= 0 && entry.totalCostKzt > 0) continue;
    totalKzt += amountKzt;
    approximate ||= entry.approximate;
    lines.push({
      event: entry.event,
      totalCostKzt: entry.totalCostKzt,
      internshipCostBasis: entry.internshipCostBasis,
      amountKzt,
      activeDaysInPeriod: activeIndices.length,
      activeDaysTotal: entry.activeDates.length,
      startDate: entry.startDate ?? entry.activeDates[0],
      endDate: entry.endDate ?? addDays(entry.activeDates[entry.activeDates.length - 1], 1),
      approximate: entry.approximate,
    });
  }

  const summary = getTrainingCostSummary(entries);
  return {
    projectTitle,
    reportDate,
    kind,
    totalKzt,
    lines,
    unallocatedEvents: summary.unallocatedEvents,
    unallocatedCostKzt: summary.unallocatedCostKzt,
    unpricedEvents: summary.unpricedEvents,
    unassignedAudienceEvents: summary.unassignedAudienceEvents,
    partial: summary.unallocatedEvents.length > 0 || summary.unpricedEvents.length > 0 || summary.unassignedAudienceEvents.length > 0,
    approximate,
  };
}

export function getTrainingCostReportingDates(start: string, end: string): string[] {
  if (!isIsoDate(start) || !isIsoDate(end) || end < start) return [];
  const result: string[] = [];
  let current = new Date(`${start.slice(0, 7)}-01T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (current <= last && result.length < 2_400) {
    const monthEnd = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 0));
    const report = monthEnd > last ? last : monthEnd;
    result.push(report.toISOString().slice(0, 10));
    current = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1));
  }
  return result;
}
