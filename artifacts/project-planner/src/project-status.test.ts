import assert from 'node:assert/strict';
import test from 'node:test';
import type { Project } from '@workspace/api-client-react';
import { getStatusReport, validateActualRecord } from './project-status.ts';
import { getTrainingCostEntries, getTrainingCostSummary } from './training-costs.ts';
import { scheduleTrainingTimeline } from './training-planning.ts';
import { parseProjectBackup, serializeProjectBackup } from './project-backup.ts';

function fixture(): Project {
  return {
    id: 'status-test', title: 'Статусы', startDate: '2026-01-01', endDate: '2026-12-31', updatedAt: '',
    shops: [2, 1].map((headcount, i) => ({
      id: `s${i}`, name: `Цех ${i}`, roles: [{ id: `r${i}`, name: 'Оператор', group: 'workers', visible: true, headcount, monthlyPayrollKzt: 3100 }],
    })),
    phases: [], milestones: { mc: { date: null, note: null, shopIds: [] }, rfsu: { date: null, note: null, shopIds: [] } },
    training: [{ id: 'e', title: 'Курс', category: 'technology', deliveryMode: 'offsite',
      travelCostPerPersonKzt: 50, duration: 2, unit: 'days', costUsd: 300, shopIds: ['s0', 's1'], roleIds: [], note: null, status: 'completed', sortOrder: 0 }],
    settings: { calculationMode: 'sequential', readyMode: 'fixed', readyDate: '2026-01-12', daysBeforeMc: 0, dayType: 'calendar', staffingMode: 'shift', contractDate: null,
      actualRecords: [
        { id: 'h', kind: 'hire', shopId: 's0', roleId: 'r0', date: '2026-01-10', people: 1 },
        { id: 't', kind: 'training', shopId: 's0', roleId: 'r0', eventId: 'e', date: '2026-01-10', people: 1, days: 0.5, deliveryMode: 'offsite' },
        { id: 'p', kind: 'payroll', shopId: 's0', date: '2026-01-10', amountKzt: 99 },
        { id: 'c', kind: 'training_cost', shopId: 's0', eventId: 'e', date: '2026-01-10', amountKzt: 20 },
      ] },
  };
}
const metric = (report: ReturnType<typeof getStatusReport>, key: string) => report.rows.find(r => r.key === key)!;

test('status compares scheduled to journal actuals as of date, including headcount and travel', () => {
  const report = getStatusReport(fixture(), '2026-01-10');
  assert.equal(metric(report, 'hire').plan, 3);
  assert.equal(metric(report, 'hire').fact, 1);
  assert.equal(metric(report, 'hire').delta, -2);
  assert.ok(Math.abs(metric(report, 'hire').percent! - 100 / 3) < 1e-6);
  assert.equal(metric(report, 'offsite').plan, 3);
  assert.equal(metric(report, 'offsite').fact, 0.5);
  assert.equal(metric(report, 'payroll').plan, 300);
  assert.equal(metric(report, 'payroll').fact, 99);
  assert.equal(metric(report, 'training_cost').plan, 225);
  assert.equal(metric(report, 'training_cost').fact, 20);
  assert.equal(report.shops[0].rows.find(r => r.key === 'training_cost')!.plan, 150);
  assert.equal(report.shops[1].rows.find(r => r.key === 'training_cost')!.plan, 75);
  for (const row of report.rows) {
    assert.equal(row.fact, report.shops.reduce((sum, s) => sum + s.rows.find(r => r.key === row.key)!.fact, 0));
  }
});
test('no future facts, no percentage division by zero, completed status never invents fact', () => {
  const project = fixture();
  const early = getStatusReport(project, '2026-01-09');
  assert.ok(early.rows.every(r => r.fact === 0 && r.plan === 0 && r.percent === null && r.deltaPercent === null));
  project.settings.actualRecords = [];
  assert.ok(getStatusReport(project, '2026-01-31').rows.every(r => r.fact === 0));
});
test('unknown formats do not fabricate person-days and onboarding is excluded', () => {
  const project = fixture();
  project.settings.onboardingDuration = 2;
  project.settings.onboardingUnit = 'days';
  delete project.training[0].deliveryMode;
  const report = getStatusReport(project, '2026-01-31');
  assert.ok(['online', 'atyrau', 'offsite'].every(key => metric(report, key).plan === 0));
  assert.ok(report.warnings.some(w => w.includes('без формата')));
});
test('shop and role scope excludes both plan and facts, invalid records are flagged', () => {
  const project = fixture();
  project.shops[0].includedInCalculations = false;
  assert.ok(getStatusReport(project, '2026-01-31').rows.every(r => r.fact === 0));
  assert.equal(getStatusReport(project, '2026-01-31').shops.length, 1);
  project.shops[0].includedInCalculations = true;
  project.shops[0].roles[0].visible = false;
  assert.equal(metric(getStatusReport(project, '2026-01-31'), 'hire').fact, 0);
  project.settings.actualRecords!.push({ id: 'invalid', kind: 'training', shopId: 's1', date: '2026-01-10' });
  assert.ok(getStatusReport(project, '2026-01-31').warnings.some(w => w.includes('не учтены')));
});
test('travel is per actual planned participant, not per rounded internship group', () => {
  const p = fixture();
  p.shops = [p.shops[0]];
  p.shops[0].roles[0].headcount = 11;
  Object.assign(p.training[0], { category: 'internship', costUsd: 50_000_000, travelCostPerPersonKzt: 1000 });
  const entries = getTrainingCostEntries(p, scheduleTrainingTimeline(p, '2026-01-12'));
  assert.equal(entries[0].participantCount, 11);
  assert.equal(entries[0].travelCostKzt, 11000);
  assert.equal(entries[0].totalCostKzt, 100_011_000);
  p.training[0].deliveryMode = 'online';
  assert.equal(getTrainingCostEntries(p, [])[0].totalCostKzt, 100_000_000);
});
test('known travel is counted with missing tuition but report remains explicitly incomplete', () => {
  const p = fixture();
  delete p.training[0].costUsd;
  const entries = getTrainingCostEntries(p, []);
  assert.equal(entries[0].totalCostKzt, 150);
  assert.equal(getTrainingCostSummary(entries).unpricedEvents.length, 1);
});
test('record validation and backups retain confirmed facts and travel fields', () => {
  const p = fixture();
  const restored = parseProjectBackup(serializeProjectBackup(p));
  assert.deepEqual(restored.settings.actualRecords, p.settings.actualRecords);
  assert.equal(restored.training[0].travelCostPerPersonKzt, 50);
  assert.equal(validateActualRecord(p, p.settings.actualRecords![1]).length, 0);
  assert.ok(validateActualRecord(p, { ...p.settings.actualRecords![1], date: '2026-02-30' }).length);
  assert.ok(validateActualRecord(p, { ...p.settings.actualRecords![1], people: 0 }).length);
  assert.ok(validateActualRecord(p, { ...p.settings.actualRecords![1], days: NaN }).length);
});
