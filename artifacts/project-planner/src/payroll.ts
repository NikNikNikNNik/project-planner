import type { Project } from '@workspace/api-client-react';
import { isShopIncludedInCalculation } from './calculation-scope.ts';
import { getShopReadyDate } from './readiness.ts';
import { getRoleTrainingPlan } from './training-planning.ts';

export interface PayrollEntry {
  roleId: string;
  contractDate: string;
  monthlyTotalKzt: number;
}

function calendarDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

const daysInMonth = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();

/** Calendar-month accrual, inclusive of the contract date and the reporting date. */
export function payrollMonthFraction(contractDate: string, throughDate: string): number {
  const start = calendarDate(contractDate);
  const end = calendarDate(throughDate);
  if (!start || !end || end < start) return 0;
  const monthDistance = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
  if (monthDistance === 0) return (end.getUTCDate() - start.getUTCDate() + 1) / daysInMonth(start);
  return (daysInMonth(start) - start.getUTCDate() + 1) / daysInMonth(start)
    + Math.max(0, monthDistance - 1)
    + end.getUTCDate() / daysInMonth(end);
}

export function getCumulativePayrollKzt(entries: PayrollEntry[], throughDate: string): number {
  return Math.round(entries.reduce((total, entry) =>
    total + entry.monthlyTotalKzt * payrollMonthFraction(entry.contractDate, throughDate), 0));
}

/** One month's payroll, prorating the month from each person's individual contract day. */
export function getMonthlyPayrollKzt(entries: PayrollEntry[], throughDate: string): number {
  const through = calendarDate(throughDate);
  if (!through) return 0;
  const monthStart = `${throughDate.slice(0, 8)}01`;
  return Math.round(entries.reduce((total, entry) => {
    const firstAccruedDay = entry.contractDate > monthStart ? entry.contractDate : monthStart;
    return total + entry.monthlyTotalKzt * payrollMonthFraction(firstAccruedDay, throughDate);
  }, 0));
}

export type PayrollReportKind = 'cumulative' | 'monthly';

export interface PayrollBreakdownLine {
  shop: string;
  role: string;
  people: number;
  monthlyRateKzt: number | null;
  contractDate: string | null;
  accruedMonths: number | null;
  accruedDays: number | null;
  daysInMonth: number;
  amountKzt: number | null;
  issue: string | null;
}

export interface PayrollBreakdown {
  projectTitle: string;
  reportDate: string;
  kind: PayrollReportKind;
  totalKzt: number;
  plannedPeople: number;
  includedPeople: number;
  missingSalaryPeople: number;
  missingContractPeople: number;
  partial: boolean;
  lines: PayrollBreakdownLine[];
}

/** Detailed, project-only inputs behind a single payroll timeline amount. */
export function getPayrollBreakdown(project: Project, reportDate: string, kind: PayrollReportKind): PayrollBreakdown {
  const summary = getProjectPayroll(project);
  const through = calendarDate(reportDate);
  const days = through ? daysInMonth(through) : 0;
  const monthStart = `${reportDate.slice(0, 8)}01`;
  const lines: PayrollBreakdownLine[] = [];
  let includedPeople = 0;

  for (const shop of project.shops) {
    if (!isShopIncludedInCalculation(shop)) continue;
    const readyDate = getShopReadyDate(project, shop.id);
    for (const role of shop.roles) {
      const people = role.headcount ?? 1;
      if (role.visible === false || people <= 0) continue;

      const rateIsValid = role.monthlyPayrollKzt !== undefined
        && Number.isFinite(role.monthlyPayrollKzt) && role.monthlyPayrollKzt >= 0;
      const rawContractDate = getRoleTrainingPlan(project, shop.id, role.id, readyDate).contractDate;
      const contractDate = rawContractDate && calendarDate(rawContractDate) ? rawContractDate : null;
      const valid = rateIsValid && contractDate !== null;
      if (valid) includedPeople += people;

      const accruedMonths = contractDate ? payrollMonthFraction(contractDate, reportDate) : null;
      const firstAccruedDay = contractDate && contractDate > monthStart ? contractDate : monthStart;
      const monthFraction = contractDate && through
        ? payrollMonthFraction(firstAccruedDay, reportDate)
        : null;
      const accruedDays = monthFraction === null ? null : Math.round(monthFraction * days);
      const monthlyTotal = valid ? (role.monthlyPayrollKzt as number) * people : 0;
      const amountKzt = valid
        ? kind === 'monthly'
          ? getMonthlyPayrollKzt([{ roleId: role.id, contractDate: contractDate as string, monthlyTotalKzt: monthlyTotal }], reportDate)
          : getCumulativePayrollKzt([{ roleId: role.id, contractDate: contractDate as string, monthlyTotalKzt: monthlyTotal }], reportDate)
        : null;
      const issue = [
        !rateIsValid ? 'Не указана месячная ставка на человека' : '',
        !contractDate ? 'Не определена дата «контракт»' : '',
        contractDate && contractDate > reportDate ? 'Дата «контракт» позже даты расчёта' : '',
      ].filter(Boolean).join('; ') || null;

      lines.push({
        shop: shop.name,
        role: role.name,
        people,
        monthlyRateKzt: rateIsValid ? role.monthlyPayrollKzt as number : null,
        contractDate,
        accruedMonths,
        accruedDays,
        daysInMonth: days,
        amountKzt,
        issue,
      });
    }
  }

  const totalKzt = kind === 'monthly'
    ? getMonthlyPayrollKzt(summary.entries, reportDate)
    : getCumulativePayrollKzt(summary.entries, reportDate);
  return {
    projectTitle: project.title,
    reportDate,
    kind,
    totalKzt,
    plannedPeople: summary.plannedPeople,
    includedPeople,
    missingSalaryPeople: summary.missingSalaryPeople,
    missingContractPeople: summary.missingContractPeople,
    partial: summary.partial,
    lines,
  };
}

/** Uses the very same role contract date as the timeline, never a shop-wide substitute. */
export function getProjectPayroll(project: Project) {
  const entries: PayrollEntry[] = [];
  let missingSalaryPeople = 0;
  let missingContractPeople = 0;
  let plannedPeople = 0;
  let estimatedRoles = 0;
  for (const shop of project.shops) {
    if (!isShopIncludedInCalculation(shop)) continue;
    const readyDate = getShopReadyDate(project, shop.id);
    for (const role of shop.roles) {
      const people = role.headcount ?? 1;
      if (role.visible === false || people <= 0) continue;
      plannedPeople += people;
      const salary = role.monthlyPayrollKzt;
      const validSalary = salary !== undefined && Number.isFinite(salary) && salary >= 0;
      const contractDate = getRoleTrainingPlan(project, shop.id, role.id, readyDate).contractDate;
      const validContract = contractDate !== null && calendarDate(contractDate) !== null;
      if (!validSalary) missingSalaryPeople += people;
      if (!validContract) missingContractPeople += people;
      if (role.monthlyPayrollNote) estimatedRoles++;
      if (validSalary && validContract) entries.push({
        roleId: role.id,
        contractDate,
        monthlyTotalKzt: salary * people,
      });
    }
  }
  return { entries, plannedPeople, missingSalaryPeople, missingContractPeople, estimatedRoles,
    partial: missingSalaryPeople > 0 || missingContractPeople > 0 };
}

export const formatKzt = (value: number) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value)} ₸`;

/** Dates at month ends in the viewport; the last point is always its actual end. */
export function payrollReportingDates(start: string, end: string): string[] {
  const first = calendarDate(start);
  const last = calendarDate(end);
  if (!first || !last || last < first) return [];
  const result: string[] = [];
  let month = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1));
  while (month <= last && result.length < 2400) {
    const monthEnd = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0));
    const reportingDay = monthEnd > last ? last : monthEnd;
    result.push(reportingDay.toISOString().slice(0, 10));
    month = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1));
  }
  return result;
}
