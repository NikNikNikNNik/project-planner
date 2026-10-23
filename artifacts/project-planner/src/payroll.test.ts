import assert from 'node:assert/strict';
import test from 'node:test';
import type { Project } from '@workspace/api-client-react';
import { getCumulativePayrollKzt, getMonthlyPayrollKzt, getPayrollBreakdown, getProjectPayroll, payrollMonthFraction, payrollReportingDates } from './payroll.ts';
import { parseProjectBackup, serializeProjectBackup } from './project-backup.ts';
import { createPayrollBreakdownWorkbook } from './payroll-export.ts';

function fixture(): Project {
  return {
    id: 'payroll-test', title: 'ФОТ', startDate: '2028-01-01', endDate: '2028-12-31', updatedAt: '2026-01-01T00:00:00Z',
    shops: [{ id: 'shop', name: 'Цех', roles: [
      { id: 'a', name: 'Инженер', group: 'itr', visible: true, headcount: 2, monthlyPayrollKzt: 310_000, monthlyPayrollNote: 'Оценка, источник' },
      { id: 'b', name: 'Оператор', group: 'workers', visible: true, headcount: 1, monthlyPayrollKzt: 290_000 },
    ] }],
    phases: [],
    milestones: {
      mc: { date: null, note: null, shopIds: [] },
      rfsu: { date: null, note: null, shopIds: [] },
    },
    training: [
      { id: 'course-a', title: 'Обучение А', category: 'technology', duration: 5, unit: 'days', startDate: '2028-01-16', shopIds: ['shop'], roleIds: ['a'], note: null, status: 'planned', sortOrder: 0 },
      { id: 'course-b', title: 'Обучение Б', category: 'mandatory', duration: 2, unit: 'days', startDate: '2028-02-01', shopIds: ['shop'], roleIds: ['b'], note: null, status: 'planned', sortOrder: 1 },
    ],
    settings: { calculationMode: 'sequential', readyMode: 'relative', readyDate: null, daysBeforeMc: 45, dayType: 'calendar', contractDate: null },
  };
}

test('one full calendar month is one monthly salary, including leap February', () => {
  assert.equal(payrollMonthFraction('2028-02-01', '2028-02-29'), 1);
  assert.equal(payrollMonthFraction('2027-02-01', '2027-02-28'), 1);
  assert.equal(payrollMonthFraction('2028-01-01', '2028-12-31'), 12);
});

test('accrues from the contract day inclusive, never before it', () => {
  assert.equal(payrollMonthFraction('2028-01-16', '2028-01-15'), 0);
  assert.equal(payrollMonthFraction('2028-01-16', '2028-01-16'), 1 / 31);
  assert.equal(payrollMonthFraction('2028-01-16', '2028-01-31'), 16 / 31);
  assert.equal(payrollMonthFraction('2027-12-31', '2028-02-29'), 1 / 31 + 2);
  assert.equal(payrollMonthFraction('2028-02-30', '2028-03-01'), 0);
});

test('project-wide sum uses each role contract and multiplies by headcount', () => {
  const summary = getProjectPayroll(fixture());
  assert.equal(summary.partial, false);
  assert.equal(summary.plannedPeople, 3);
  assert.deepEqual(summary.entries.map(e => [e.roleId, e.contractDate, e.monthlyTotalKzt]), [
    ['a', '2028-01-16', 620_000], ['b', '2028-02-01', 290_000],
  ]);
  assert.equal(getCumulativePayrollKzt(summary.entries, '2028-01-31'), 320_000);
  assert.equal(getCumulativePayrollKzt(summary.entries, '2028-02-29'), 1_230_000);
  // The reporting window does not reset prior accrued salary.
  assert.equal(getCumulativePayrollKzt(summary.entries, '2028-03-31'), 2_140_000);
});

test('onboarding shifts the same role contract date used by payroll', () => {
  const p = fixture();
  p.settings.onboardingDuration = 3;
  p.settings.onboardingUnit = 'days';
  assert.equal(getProjectPayroll(p).entries[0].contractDate, '2028-01-13');
});

test('changing headcount changes total payroll, not the salary per person', () => {
  const p = fixture();
  p.shops[0].roles[0].headcount = 4;
  const summary = getProjectPayroll(p);
  assert.equal(summary.plannedPeople, 5);
  assert.equal(getCumulativePayrollKzt(summary.entries, '2028-01-31'), 640_000);
  assert.equal(p.shops[0].roles[0].monthlyPayrollKzt, 310_000);
  p.shops[0].roles[0].headcount = undefined;
  assert.equal(getCumulativePayrollKzt(getProjectPayroll(p).entries, '2028-01-31'), 160_000);
});

test('monthly payroll sums roles project-wide, prorates first month, then reports each full month', () => {
  const summary = getProjectPayroll(fixture());
  assert.equal(getMonthlyPayrollKzt(summary.entries, '2028-01-31'), 320_000);
  assert.equal(getMonthlyPayrollKzt(summary.entries, '2028-02-29'), 910_000);
  assert.equal(getMonthlyPayrollKzt(summary.entries, '2028-03-31'), 910_000);
  assert.equal(getMonthlyPayrollKzt(summary.entries, '2027-12-31'), 0);
});

test('payroll breakdown attributes totals to project roles, rates, headcount, and each contract date', () => {
  const p = fixture();
  const cumulative = getPayrollBreakdown(p, '2028-01-31', 'cumulative');
  assert.equal(cumulative.totalKzt, 320_000);
  assert.equal(cumulative.lines.length, 2);
  assert.deepEqual(
    [cumulative.lines[0].shop, cumulative.lines[0].role, cumulative.lines[0].people,
      cumulative.lines[0].monthlyRateKzt, cumulative.lines[0].contractDate, cumulative.lines[0].amountKzt],
    ['Цех', 'Инженер', 2, 310_000, '2028-01-16', 320_000],
  );
  assert.equal(cumulative.lines[1].amountKzt, 0);
  assert.equal(cumulative.lines[1].issue, 'Дата «контракт» позже даты расчёта');

  const monthly = getPayrollBreakdown(p, '2028-02-29', 'monthly');
  assert.equal(monthly.totalKzt, 910_000);
  assert.equal(monthly.lines[0].amountKzt, 620_000);
  assert.equal(monthly.lines[1].amountKzt, 290_000);
  assert.equal(monthly.lines[1].accruedDays, 29);
});

test('breakdown names project data missing from roles instead of treating it as zero payroll', () => {
  const p = fixture();
  p.shops[0].roles[0].monthlyPayrollKzt = undefined;
  p.training = p.training.filter(event => event.id !== 'course-b');
  const report = getPayrollBreakdown(p, '2028-03-31', 'monthly');
  assert.equal(report.partial, true);
  assert.equal(report.lines[0].amountKzt, null);
  assert.equal(report.lines[0].issue, 'Не указана месячная ставка на человека');
  assert.equal(report.lines[1].amountKzt, null);
  assert.equal(report.lines[1].issue, 'Не определена дата «контракт»');
});

test('payroll Excel export contains only project inputs and the selected breakdown', async () => {
  const report = getPayrollBreakdown(fixture(), '2028-01-31', 'cumulative');
  const workbook = await createPayrollBreakdownWorkbook(report);
  const sheet = workbook.getWorksheet('Расчёт ФОТ');
  assert.ok(sheet);
  assert.equal(sheet.getCell('A1').value, 'ФОТ, нарастающим итогом');
  assert.equal(sheet.getCell('B2').value, 'Проект: ФОТ');
  assert.equal(sheet.getCell('B4').value, 320_000);
  assert.equal(sheet.getCell('B10').value, 'Инженер');
  assert.equal(sheet.getCell('C10').value, 2);
  assert.equal(sheet.getCell('D10').value, 310_000);
  assert.equal(sheet.getCell('H10').value, 320_000);
  assert.equal(sheet.getCell('I10').value, null);
});

test('unset salary and unknown contract are explicit gaps; hidden/zero headcount excluded', () => {
  const p = fixture();
  p.shops[0].roles[0].monthlyPayrollKzt = undefined;
  p.training = p.training.filter(e => e.id !== 'course-b');
  let summary = getProjectPayroll(p);
  assert.equal(summary.partial, true);
  assert.equal(summary.missingSalaryPeople, 2);
  assert.equal(summary.missingContractPeople, 1);
  assert.equal(summary.entries.length, 0);
  p.shops[0].roles[0].visible = false;
  p.shops[0].roles[1].headcount = 0;
  summary = getProjectPayroll(p);
  assert.equal(summary.plannedPeople, 0);
  assert.equal(summary.partial, false);
});

test('zero salary is a known zero, not an unset field', () => {
  const p = fixture();
  p.shops[0].roles[0].monthlyPayrollKzt = 0;
  const summary = getProjectPayroll(p);
  assert.equal(summary.missingSalaryPeople, 0);
  assert.equal(summary.entries[0].monthlyTotalKzt, 0);
});

test('payroll and provenance survive project backup export/import', () => {
  const restored = parseProjectBackup(serializeProjectBackup(fixture()));
  assert.equal(restored.shops[0].roles[0].monthlyPayrollKzt, 310_000);
  assert.equal(restored.shops[0].roles[0].monthlyPayrollNote, 'Оценка, источник');
});

test('shop and role calculation switches survive backup export/import', () => {
  const project = fixture();
  project.shops[0].includedInCalculations = false;
  project.shops[0].roles[1].visible = false;
  const restored = parseProjectBackup(serializeProjectBackup(project));
  assert.equal(restored.shops[0].includedInCalculations, false);
  assert.equal(restored.shops[0].roles[1].visible, false);
});

test('reporting dates are month ends with an exact partial final date', () => {
  assert.deepEqual(payrollReportingDates('2028-01-16', '2028-03-10'), ['2028-01-31', '2028-02-29', '2028-03-10']);
  assert.deepEqual(payrollReportingDates('2028-02-01', '2028-02-29'), ['2028-02-29']);
  assert.deepEqual(payrollReportingDates('2028-01-31', '2028-03-01'), ['2028-01-31', '2028-02-29', '2028-03-01']);
  assert.deepEqual(payrollReportingDates('2028-03-10', '2028-03-01'), []);
});

test('shop and role calculation switches exclude their payroll rows', () => {
  const project = fixture();
  project.shops[0].roles[1].visible = false;
  const sourceShop = fixture().shops[0];
  project.shops.push({
    ...sourceShop,
    id: 'excluded-shop',
    name: 'Исключённый цех',
    includedInCalculations: false,
    roles: sourceShop.roles.map(role => ({ ...role, id: `excluded-${role.id}` })),
  });

  const summary = getProjectPayroll(project);
  assert.equal(summary.plannedPeople, 2);
  assert.deepEqual(summary.entries.map(entry => entry.roleId), ['a']);
});
