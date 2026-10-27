import type { ActualRecord, Project } from '@workspace/api-client-react';
import { getShopReadyDate, getProjectReadyDate } from './readiness.ts';
import { getRoleTrainingPlan, scheduleTrainingTimeline } from './training-planning.ts';
import { getProjectDayType, isKazakhstanWorkday } from './kazakhstan-calendar.ts';
import { getProjectPayroll, getCumulativePayrollKzt } from './payroll.ts';
import { getTrainingCostEntries, getTrainingCostReport, getTrainingCostSummary } from './training-costs.ts';
import { getTrainingEventsIncludedInCalculation, isShopIncludedInCalculation } from './calculation-scope.ts';

const definitions = [
  ['hire', 'Нанято персонала — всего по профессиям', 'чел.'],
  ['online', 'Онлайн-обучения', 'чел.-дн.'],
  ['atyrau', 'Обучения в г. Атырау', 'чел.-дн.'],
  ['offsite', 'Выездные обучения', 'чел.-дн.'],
  ['payroll', 'Освоено ФОТ', '₸'],
  ['training_cost', 'Освоено бюджета на обучение', '₸'],
] as const;
export interface StatusRow {
  key: string; label: string; unit: string; plan: number; fact: number;
  delta: number; percent: number | null; deltaPercent: number | null;
}
export function isRealDate(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}
export function validateActualRecord(project: Project, record: ActualRecord): string[] {
  const errors: string[] = [];
  if (!record.id || !isRealDate(record.date)) errors.push('Укажите корректную дату записи.');
  const shop = project.shops.find(s => s.id === record.shopId);
  if (!shop) errors.push('Выберите цех.');
  if (record.roleId && !shop?.roles.some(r => r.id === record.roleId)) errors.push('Профессия не принадлежит выбранному цеху.');
  const event = project.training.find(e => e.id === record.eventId);
  if (record.eventId && !event) errors.push('Обучение не найдено.');
  if (record.kind === 'hire' || record.kind === 'training') {
    if (!record.roleId) errors.push('Выберите профессию.');
    if (!Number.isInteger(record.people) || (record.people ?? 0) < 1) errors.push('Численность должна быть целым числом от 1.');
  }
  if (record.kind === 'training') {
    if (!event || !event.shopIds.includes(record.shopId) || (event.roleIds.length > 0 && !event.roleIds.includes(record.roleId ?? ''))) errors.push('Выберите обучение, назначенное этой профессии.');
    if (!['online', 'atyrau', 'offsite'].includes(record.deliveryMode ?? '')) errors.push('Укажите фактический формат обучения.');
    if (!Number.isFinite(record.days) || (record.days ?? 0) <= 0) errors.push('Укажите фактически пройденные дни обучения.');
  }
  if (record.kind === 'payroll' || record.kind === 'training_cost') {
    if (!Number.isFinite(record.amountKzt) || (record.amountKzt ?? -1) < 0) errors.push('Укажите сумму в тенге, не меньше нуля.');
  }
  if (!['hire', 'training', 'payroll', 'training_cost'].includes(record.kind)) errors.push('Неизвестный вид записи.');
  return errors;
}
const empty = () => Object.fromEntries(definitions.map(([key]) => [key, 0])) as Record<string, number>;
function rows(plan: Record<string, number>, fact: Record<string, number>): StatusRow[] {
  return definitions.map(([key, label, unit]) => {
    const p = Math.round(plan[key] * 100) / 100, f = Math.round(fact[key] * 100) / 100;
    return { key, label, unit, plan: p, fact: f, delta: Math.round((f - p) * 100) / 100,
      percent: p === 0 ? null : f / p * 100, deltaPercent: p === 0 ? null : (f - p) / p * 100 };
  });
}
function elapsedDays(start: string, end: string, through: string, project: Project) {
  if (!isRealDate(start) || !isRealDate(end) || start > through) return 0;
  let count = 0;
  const date = new Date(`${start}T00:00:00Z`);
  const working = getProjectDayType(project.settings) === 'working';
  for (let i = 0; i < 20000; i++) {
    const day = date.toISOString().slice(0, 10);
    if (day >= end || day > through) break;
    if (!working || isKazakhstanWorkday(day, project.settings.additionalNonWorkingDates)) count++;
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return count;
}
export function getStatusReport(project: Project, date: string) {
  const warnings = new Set<string>();
  if (!isRealDate(date)) return { rows: rows(empty(), empty()), shops: [], warnings: ['Укажите корректную отчётную дату.'] };
  const shops = project.shops.filter(isShopIncludedInCalculation).map(shop => ({
    shopId: shop.id, shopName: shop.name, plan: empty(), fact: empty(),
  }));
  const totals = empty(), facts = empty();
  const audience = new Map<string, Map<string, number>>();
  for (const target of shops) {
    const shop = project.shops.find(s => s.id === target.shopId)!;
    const payroll = getProjectPayroll({ ...project, shops: [shop] });
    target.plan.payroll = getCumulativePayrollKzt(payroll.entries, date);
    if (payroll.partial) warnings.add('ФОТ рассчитан не полностью: для части персонала нет ставки или даты контракта.');
    for (const role of shop.roles.filter(r => r.visible !== false)) {
      const people = role.headcount ?? 1;
      if (people <= 0) continue;
      const plan = getRoleTrainingPlan(project, shop.id, role.id, getShopReadyDate(project, shop.id));
      if (plan.contractDate && plan.contractDate <= date) target.plan.hire += people;
      if (!plan.contractDate) warnings.add('Для части профессий не определена дата контракта.');
      for (const event of plan.events) {
        const counts = audience.get(event.id) ?? new Map<string, number>();
        counts.set(shop.id, (counts.get(shop.id) ?? 0) + people);
        audience.set(event.id, counts);
        if (!event.deliveryMode) warnings.add('Есть обучения без формата: их человеко-дни не отнесены к трём форматам.');
        if (event.duration <= 0) warnings.add('Есть обучения без длительности: их плановые человеко-дни не рассчитаны.');
      }
      for (const item of plan.schedule) {
        if (item.approximate) warnings.add('Часть сроков обучения рассчитана предварительно.');
        if (item.event.deliveryMode) target.plan[item.event.deliveryMode] += people * elapsedDays(item.startDate, item.endDate, date, project);
      }
    }
  }
  const scoped = { ...project, training: getTrainingEventsIncludedInCalculation(project) };
  const entries = getTrainingCostEntries(project, scheduleTrainingTimeline(scoped, getProjectReadyDate(project)));
  const costReport = getTrainingCostReport(project.title, entries, date, 'cumulative');
  const summary = getTrainingCostSummary(entries);
  if (costReport.partial || summary.unpricedEvents.length) warnings.add('Бюджет обучения неполный: есть события без цены, даты или участников.');
  // Shared event costs are apportioned to shops by planned participating headcount,
  // including group rounding for internships already applied in the event total.
  for (const line of costReport.lines) {
    const counts = audience.get(line.event.id);
    const count = [...(counts?.values() ?? [])].reduce((a, b) => a + b, 0);
    if (!count) { warnings.add('Есть затраты на обучение без распределения по участникам; они не включены в статусы.'); continue; }
    for (const target of shops) target.plan.training_cost += line.amountKzt * (counts?.get(target.shopId) ?? 0) / count;
  }
  const seenIds = new Set<string>();
  for (const record of project.settings.actualRecords ?? []) {
    if (seenIds.has(record.id)) { warnings.add('Повторяющиеся идентификаторы фактических записей не учтены повторно.'); continue; }
    seenIds.add(record.id);
    if (validateActualRecord(project, record).length) { warnings.add('Есть фактические записи с устаревшими связями или ошибками; они не учтены.'); continue; }
    if (record.date > date) continue;
    const target = shops.find(s => s.shopId === record.shopId);
    const role = project.shops.find(s => s.id === record.shopId)?.roles.find(r => r.id === record.roleId);
    if (!target || role?.visible === false) continue;
    if (record.kind === 'hire') target.fact.hire += record.people!;
    if (record.kind === 'training') target.fact[record.deliveryMode!] += record.people! * record.days!;
    if (record.kind === 'payroll' || record.kind === 'training_cost') target.fact[record.kind] += record.amountKzt!;
  }
  for (const target of shops) for (const [key] of definitions) {
    totals[key] += target.plan[key]; facts[key] += target.fact[key];
  }
  return { rows: rows(totals, facts), shops: shops.map(s => ({ shopId: s.shopId, shopName: s.shopName, rows: rows(s.plan, s.fact) })), warnings: [...warnings] };
}
